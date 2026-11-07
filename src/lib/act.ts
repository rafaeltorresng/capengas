// Porta de envio. Ordem combinada na #2: recheque → política → intenção → POST → consulta.
// Depois que o POST começa, falha ou timeout nunca dispara outro POST: a ação fica para reconciliar.
import { createHash } from 'node:crypto';
import { evaluate } from './policy.ts';
import { consultarProtocolo, type Consulta } from './portal.ts';
import type { AcaoContexto, ItemDecision, Politica, Recheque } from './contracts.ts';
import type { LanceStore } from './store.ts';

export type ItemProposta = {
  numero: number; produto: string; marca: string; registroAnvisa: string;
  precoUnitario: number; quantidade?: number;
};
export type PedidoProposta = {
  tipo: 'enviar_proposta'; tenderId: string; empresa: string; itens: ItemProposta[]; decisoes: ItemDecision[];
};
export type PedidoEsclarecimento = {
  tipo: 'enviar_esclarecimento'; tenderId: string; item: number; texto: string;
  motivo: 'nao_informado' | 'variante_nao_coberta' | 'marca_referencia'; prazoAberto: boolean;
};
export type PedidoAcao = (PedidoProposta | PedidoEsclarecimento) & { prazoDecisao?: string };

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
  now?: () => Date;
  recheck?: (tenderId: string, store: LanceStore) => Promise<Recheque>;
  enviar?: (url: string, body: unknown) => Promise<Envio>;
  consultar?: (baseUrl: string, tipo: 'proposta' | 'esclarecimento', protocolo: string) => Promise<Consulta>;
};

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const portalTipo = (tipo: PedidoAcao['tipo']): 'proposta' | 'esclarecimento' => tipo === 'enviar_proposta' ? 'proposta' : 'esclarecimento';

function validar(pedido: PedidoAcao): string | null {
  if (!pedido.tenderId) return 'pregão ausente';
  if (pedido.tipo === 'enviar_proposta') {
    if (!pedido.empresa) return 'empresa ausente';
    if (!pedido.itens.length) return 'proposta sem itens';
    for (const item of pedido.itens) {
      if (!(item.precoUnitario > 0)) return `item ${item.numero}: preço inválido`;
      if (!((item.quantidade ?? 1) > 0)) return `item ${item.numero}: quantidade inválida`;
      if (!/^\d{11}$/.test(item.registroAnvisa)) return `item ${item.numero}: registro ANVISA ausente ou inválido`;
      if (!item.marca || !item.produto) return `item ${item.numero}: marca e produto são obrigatórios`;
    }
    return null;
  }
  if (!pedido.texto || pedido.texto.length < 30) return 'esclarecimento sem texto suficiente';
  return null;
}

function identidade(pedido: PedidoAcao): { key: string; tipo: 'proposta' | 'esclarecimento'; item?: number; payload: unknown; valor: number | null } {
  if (pedido.tipo === 'enviar_proposta') {
    const itens = [...pedido.itens].sort((a, b) => a.numero - b.numero).map(item => ({
      numero: item.numero, produto: item.produto, marca: item.marca, registroAnvisa: item.registroAnvisa,
      precoUnitario: item.precoUnitario, quantidade: item.quantidade ?? 1,
    }));
    const valor = itens.reduce((sum, item) => sum + item.precoUnitario * item.quantidade, 0);
    return { key: `proposta:${pedido.tenderId}:${digest(itens)}`, tipo: 'proposta', payload: { empresa: pedido.empresa, itens }, valor };
  }
  return {
    key: `esclarecimento:${pedido.tenderId}:${pedido.item}:${digest(pedido.texto)}`,
    tipo: 'esclarecimento', item: pedido.item, payload: { texto: pedido.texto, motivo: pedido.motivo }, valor: null,
  };
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
  const now = deps.now ?? (() => new Date());
  const consultar = deps.consultar ?? consultarProtocolo;
  const enviar = deps.enviar ?? postJson;
  const invalido = validar(pedido);
  if (invalido) return { resultado: 'bloqueada', motivo: invalido };

  const id = identidade(pedido);
  const existente = deps.store.getActions({ tenderId: pedido.tenderId }).find(action => action.key === id.key);
  if (existente?.status === 'confirmada' && existente.verificado === true && existente.protocolo) {
    return { resultado: 'confirmada', key: id.key, protocolo: existente.protocolo, jaExistia: true };
  }
  if (existente?.status === 'falhou') return { resultado: 'falhou', key: id.key, motivo: 'ação já falhou; não repito o envio' };
  if (existente && existente.status !== 'intencao') {
    if (!existente.protocolo) return { resultado: 'reconciliar', key: id.key, motivo: 'envio anterior sem protocolo confirmado; não repito o POST' };
    return consultarEFechar(deps, pedido, id.key, existente.protocolo, consultar);
  }

  const recheque = deps.recheck
    ? await deps.recheck(pedido.tenderId, deps.store)
    : { status: 'bloquear' as const, motivo: 'fonte_indisponivel' as const, em: now().toISOString() };
  const contexto: AcaoContexto = {
    tenderId: pedido.tenderId, valor: id.valor, decisoes: pedido.tipo === 'enviar_proposta' ? pedido.decisoes : [], recheque,
    ...(pedido.tipo === 'enviar_esclarecimento' ? { esclarecimento: { motivo: pedido.motivo, prazoAberto: pedido.prazoAberto } } : {}),
  };
  const avaliacao = evaluate(pedido.tipo, contexto, deps.politica);
  if (!avaliacao.permitido) {
    if (!avaliacao.escalar) {
      deps.store.logEvent({ tipo: 'bloqueio', resumo: avaliacao.motivo, tender: pedido.tenderId, detalhe: id.key });
      return { resultado: 'bloqueada', motivo: avaliacao.motivo };
    }
    const aberta = deps.store.openEscalations().find(escalada => escalada.tender === pedido.tenderId && escalada.motivo === avaliacao.motivo);
    if (!aberta) {
      const item = pedido.tipo === 'enviar_esclarecimento' ? String(pedido.item)
        : pedido.itens.length === 1 ? String(pedido.itens[0].numero) : undefined;
      deps.store.openEscalation({
        tender: pedido.tenderId, ...(item ? { item } : {}), motivo: avaliacao.motivo,
        recomendacao: 'A política não autorizou o envio automático. Decidir antes de qualquer POST.',
        prazo: pedido.prazoDecisao ?? new Date(now().getTime() + 864e5).toISOString(),
      });
    }
    return { resultado: 'escalada', motivo: avaliacao.motivo };
  }

  const intent = deps.store.recordIntent({ key: id.key, tipo: id.tipo, tenderId: pedido.tenderId, item: id.item, payload: id.payload });
  // Só quem criou a intenção envia. Outra chamada simultânea, ou uma que ficou em 'intencao', não faz POST.
  if (intent.status === 'existente') {
    if (intent.action.status === 'intencao') return { resultado: 'reconciliar', key: id.key, motivo: 'intenção já aberta; não repito o POST' };
    return executarAcao(pedido, deps);
  }
  deps.store.updateAction(id.key, { status: 'enviada' });
  const rota = portalTipo(pedido.tipo) === 'proposta' ? 'propostas' : 'esclarecimentos';
  const body = pedido.tipo === 'enviar_proposta'
    ? { tender: pedido.tenderId, empresa: pedido.empresa, itens: id.payload && typeof id.payload === 'object' ? (id.payload as { itens: unknown }).itens : [] }
    : { tender: pedido.tenderId, item: pedido.item, texto: pedido.texto };
  const envio = await enviar(`${deps.sandboxUrl}/api/${rota}`, body);
  if ('erro' in envio) {
    deps.store.updateAction(id.key, { status: 'reconciliar' });
    deps.store.logEvent({ tipo: 'verificacao', resumo: `POST sem resposta confirmada (${envio.erro}); não repito o envio`, tender: pedido.tenderId, detalhe: id.key });
    return { resultado: 'reconciliar', key: id.key, motivo: envio.erro };
  }
  const protocolo = envio.status === 201 && envio.body && typeof envio.body === 'object' ? String((envio.body as { protocolo?: unknown }).protocolo ?? '') : '';
  if (!protocolo) {
    deps.store.updateAction(id.key, { status: 'falhou' });
    deps.store.logEvent({ tipo: 'verificacao', resumo: `portal recusou o envio (HTTP ${envio.status})`, tender: pedido.tenderId, detalhe: id.key });
    return { resultado: 'falhou', key: id.key, motivo: `portal recusou (HTTP ${envio.status})` };
  }
  deps.store.updateAction(id.key, { status: 'enviada', protocolo });
  return consultarEFechar(deps, pedido, id.key, protocolo, consultar);
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
