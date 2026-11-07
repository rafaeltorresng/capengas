// Porta de envio. Ordem combinada na #2: recheque → política → intenção → POST → consulta.
// Quantidade, decisão, preço e prazo vêm do store e das regras. O pedido só escolhe o pregão e os itens.
// Depois que o POST começa, falha ou timeout nunca dispara outro POST.
import { createHash } from 'node:crypto';
import { evaluate } from './policy.ts';
import { esclarecimentoDeadline } from './rules.ts';
import { consultarProtocolo, type Consulta } from './portal.ts';
import type { AcaoContexto, ItemDecision, Politica, Recheque } from './contracts.ts';
import type { LanceStore } from './store.ts';

export type PedidoProposta = { tipo: 'enviar_proposta'; tenderId: string; itens: number[] };
export type PedidoEsclarecimento = {
  tipo: 'enviar_esclarecimento'; tenderId: string; item: number; texto: string;
  motivo: 'nao_informado' | 'variante_nao_coberta' | 'marca_referencia';
};
export type PedidoAcao = (PedidoProposta | PedidoEsclarecimento) & { prazoDecisao?: string };
export type ProdutoCatalogo = { id: string; marca: string; registroAnvisa: string };

export type ResultadoAcao =
  | { resultado: 'confirmada'; key: string; protocolo: string; jaExistia: boolean }
  | { resultado: 'escalada'; motivo: string }
  | { resultado: 'bloqueada'; motivo: string }
  | { resultado: 'reconciliar'; key: string; motivo: string }
  | { resultado: 'falhou'; key: string; motivo: string };

export type Envio = { status: number; body: unknown } | { erro: string };
export type ActDeps = {
  store: LanceStore;
  politica: Politica | undefined;
  sandboxUrl: string;
  empresa: string;
  catalogo: ProdutoCatalogo[];
  now?: () => Date;
  recheck?: (tenderId: string, store: LanceStore) => Promise<Recheque>;
  enviar?: (url: string, body: unknown) => Promise<Envio>;
  consultar?: (baseUrl: string, tipo: 'proposta' | 'esclarecimento', protocolo: string) => Promise<Consulta>;
};

type Linha = { numero: number; produto: string; marca: string; registroAnvisa: string; precoUnitario: number; quantidade: number };
type Montado = {
  key: string; tipo: 'proposta' | 'esclarecimento'; item?: number; payload: unknown;
  valor: number | null; decisoes: ItemDecision[]; prazoAberto?: boolean; linhas: Linha[];
};

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const portalTipo = (tipo: PedidoAcao['tipo']): 'proposta' | 'esclarecimento' => tipo === 'enviar_proposta' ? 'proposta' : 'esclarecimento';
const dataRecife = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

function abertura(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const iso = /^\d{4}-\d\d-\d\d$/.test(raw) ? `${raw}T12:00:00-03:00` : /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(raw) ? `${raw}:00-03:00` : raw;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Prazo legal a partir da abertura persistida. Sem abertura, o esclarecimento não segue. */
export function prazoEsclarecimentoAberto(aberturaRaw: string | null | undefined, now: Date): { aberto: boolean; prazo: string | null } {
  const opening = abertura(aberturaRaw);
  if (!opening) return { aberto: false, prazo: null };
  const prazo = esclarecimentoDeadline(opening);
  return { aberto: dataRecife(now) <= prazo, prazo };
}

function montar(pedido: PedidoAcao, deps: ActDeps, now: Date): { erro: string } | Montado {
  if (!pedido.tenderId) return { erro: 'pregão ausente' };
  if (pedido.tipo === 'enviar_esclarecimento') {
    if (!pedido.texto || pedido.texto.length < 30) return { erro: 'esclarecimento sem texto suficiente' };
    const item = deps.store.getItems(pedido.tenderId).find(row => row.numero === pedido.item);
    if (!item) return { erro: `item ${pedido.item} ausente no store` };
    const prazo = prazoEsclarecimentoAberto(deps.store.getTender(pedido.tenderId)?.abertura, now);
    if (!prazo.prazo) return { erro: 'prazo de esclarecimento desconhecido: abertura ausente no store' };
    return {
      key: `esclarecimento:${pedido.tenderId}:${pedido.item}:${digest(pedido.texto)}`,
      tipo: 'esclarecimento', item: pedido.item, payload: { texto: pedido.texto, motivo: pedido.motivo },
      valor: null, decisoes: [], prazoAberto: prazo.aberto, linhas: [],
    };
  }
  if (!deps.empresa) return { erro: 'empresa ausente no catálogo configurado' };
  if (!pedido.itens.length) return { erro: 'proposta sem itens' };
  const numeros: number[] = [];
  for (const bruto of pedido.itens as unknown[]) {
    const numero = typeof bruto === 'number' ? bruto : bruto && typeof bruto === 'object' ? Number((bruto as { numero?: unknown }).numero) : NaN;
    if (!Number.isInteger(numero)) return { erro: 'item da proposta sem número inteiro' };
    numeros.push(numero);
  }
  const itens = deps.store.getItems(pedido.tenderId);
  const decisoesStore = deps.store.getDecisions(pedido.tenderId);
  const linhas: Linha[] = [];
  const decisoes: ItemDecision[] = [];
  for (const numero of [...new Set(numeros)].sort((a, b) => a - b)) {
    const item = itens.find(row => row.numero === numero);
    if (!item) return { erro: `item ${numero} ausente no store` };
    if (!(item.quantidade > 0)) return { erro: `item ${numero}: quantidade ausente no store` };
    const doItem = decisoesStore.filter(row => row.item === numero);
    if (doItem.length !== 1) return { erro: doItem.length === 0 ? `item ${numero}: decisão ausente no store` : `item ${numero}: mais de um produto decidido` };
    const decision = doItem[0];
    if (!(decision.precoProposto != null && decision.precoProposto > 0)) return { erro: `item ${numero}: preço calculado ausente no store` };
    const produto = deps.catalogo.find(row => row.id === decision.produto);
    if (!produto?.marca || !/^\d{11}$/.test(produto.registroAnvisa ?? '')) return { erro: `item ${numero}: produto sem marca ou registro no catálogo` };
    linhas.push({ numero, produto: produto.id, marca: produto.marca, registroAnvisa: produto.registroAnvisa, precoUnitario: decision.precoProposto, quantidade: item.quantidade });
    decisoes.push({ estado: decision.estado, motivos: decision.motivos });
  }
  const valor = linhas.reduce((sum, linha) => sum + linha.precoUnitario * linha.quantidade, 0);
  return { key: `proposta:${pedido.tenderId}:${digest(linhas)}`, tipo: 'proposta', payload: { empresa: deps.empresa, itens: linhas }, valor, decisoes, linhas };
}

async function postJson(url: string, body: unknown): Promise<Envio> {
  try {
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* corpo não JSON fica como texto */ }
    return { status: response.status, body: parsed };
  } catch (error: any) {
    return { erro: error?.name === 'TimeoutError' ? 'timeout' : String(error?.cause?.code ?? error?.message ?? error) };
  }
}

export async function executarAcao(pedido: PedidoAcao, deps: ActDeps): Promise<ResultadoAcao> {
  const now = (deps.now ?? (() => new Date()))();
  const consultar = deps.consultar ?? consultarProtocolo;
  const enviar = deps.enviar ?? postJson;
  const montado = montar(pedido, deps, now);
  if ('erro' in montado) return { resultado: 'bloqueada', motivo: montado.erro };

  const existente = deps.store.getActions({ tenderId: pedido.tenderId }).find(action => action.key === montado.key);
  if (existente?.status === 'confirmada' && existente.verificado === true && existente.protocolo) {
    return { resultado: 'confirmada', key: montado.key, protocolo: existente.protocolo, jaExistia: true };
  }
  if (existente?.status === 'falhou') return { resultado: 'falhou', key: montado.key, motivo: 'ação já falhou; não repito o envio' };
  if (existente && existente.status !== 'intencao') {
    if (!existente.protocolo) return { resultado: 'reconciliar', key: montado.key, motivo: 'envio anterior sem protocolo confirmado; não repito o POST' };
    return consultarEFechar(deps, pedido, montado.key, existente.protocolo, consultar);
  }

  const recheque = deps.recheck
    ? await deps.recheck(pedido.tenderId, deps.store)
    : { status: 'bloquear' as const, motivo: 'fonte_indisponivel' as const, em: now.toISOString() };
  const contexto: AcaoContexto = {
    tenderId: pedido.tenderId, valor: montado.valor, decisoes: montado.decisoes, recheque,
    ...(pedido.tipo === 'enviar_esclarecimento' ? { esclarecimento: { motivo: pedido.motivo, prazoAberto: montado.prazoAberto === true } } : {}),
  };
  const avaliacao = evaluate(pedido.tipo, contexto, deps.politica);
  if (!avaliacao.permitido) {
    if (!avaliacao.escalar) {
      deps.store.logEvent({ tipo: 'bloqueio', resumo: avaliacao.motivo, tender: pedido.tenderId, detalhe: montado.key });
      return { resultado: 'bloqueada', motivo: avaliacao.motivo };
    }
    const aberta = deps.store.openEscalations().find(escalada => escalada.tender === pedido.tenderId && escalada.motivo === avaliacao.motivo);
    if (!aberta) {
      const item = pedido.tipo === 'enviar_esclarecimento' ? String(pedido.item) : pedido.itens.length === 1 ? String(pedido.itens[0]) : undefined;
      deps.store.openEscalation({
        tender: pedido.tenderId, ...(item ? { item } : {}), motivo: avaliacao.motivo,
        recomendacao: 'A política não autorizou o envio automático. Decidir antes de qualquer POST.',
        prazo: pedido.prazoDecisao ?? new Date(now.getTime() + 864e5).toISOString(),
      });
    }
    return { resultado: 'escalada', motivo: avaliacao.motivo };
  }

  const intent = deps.store.recordIntent({ key: montado.key, tipo: montado.tipo, tenderId: pedido.tenderId, item: montado.item, payload: montado.payload });
  if (intent.status === 'existente') {
    if (intent.action.status === 'intencao') return { resultado: 'reconciliar', key: montado.key, motivo: 'intenção já aberta; não repito o POST' };
    return executarAcao(pedido, deps);
  }
  deps.store.updateAction(montado.key, { status: 'enviada' });
  const rota = portalTipo(pedido.tipo) === 'proposta' ? 'propostas' : 'esclarecimentos';
  const body = pedido.tipo === 'enviar_proposta'
    ? { tender: pedido.tenderId, empresa: deps.empresa, itens: montado.linhas }
    : { tender: pedido.tenderId, item: pedido.item, texto: pedido.texto };
  const envio = await enviar(`${deps.sandboxUrl}/api/${rota}`, body);
  if ('erro' in envio) {
    deps.store.updateAction(montado.key, { status: 'reconciliar' });
    deps.store.logEvent({ tipo: 'verificacao', resumo: `POST sem resposta confirmada (${envio.erro}); não repito o envio`, tender: pedido.tenderId, detalhe: montado.key });
    return { resultado: 'reconciliar', key: montado.key, motivo: envio.erro };
  }
  const protocolo = envio.status === 201 && envio.body && typeof envio.body === 'object' ? String((envio.body as { protocolo?: unknown }).protocolo ?? '') : '';
  if (!protocolo) {
    deps.store.updateAction(montado.key, { status: 'falhou' });
    deps.store.logEvent({ tipo: 'verificacao', resumo: `portal recusou o envio (HTTP ${envio.status})`, tender: pedido.tenderId, detalhe: montado.key });
    return { resultado: 'falhou', key: montado.key, motivo: `portal recusou (HTTP ${envio.status})` };
  }
  deps.store.updateAction(montado.key, { status: 'enviada', protocolo });
  return consultarEFechar(deps, pedido, montado.key, protocolo, consultar);
}

async function consultarEFechar(deps: ActDeps, pedido: PedidoAcao, key: string, protocolo: string, consultar: NonNullable<ActDeps['consultar']>): Promise<ResultadoAcao> {
  const tipo = portalTipo(pedido.tipo);
  const consulta = await consultar(deps.sandboxUrl, tipo, protocolo);
  if (consulta.encontrado) {
    deps.store.updateAction(key, { status: 'confirmada', protocolo, verificado: true });
    deps.store.logEvent({
      tipo: tipo === 'proposta' ? 'proposta_enviada' : 'esclarecimento_enviado',
      resumo: `${tipo} confirmada no portal: ${protocolo}`, tender: pedido.tenderId, detalhe: key,
      rastro: [{ ferramenta: 'portal', saida: protocolo }],
    });
    return { resultado: 'confirmada', key, protocolo, jaExistia: false };
  }
  deps.store.updateAction(key, { status: 'reconciliar', protocolo });
  const motivo = consulta.erro ?? 'protocolo ainda não encontrado no portal';
  deps.store.logEvent({ tipo: 'verificacao', resumo: `consulta de ${protocolo}: ${motivo}; envio não repetido`, tender: pedido.tenderId, detalhe: key });
  return { resultado: 'reconciliar', key, motivo };
}
