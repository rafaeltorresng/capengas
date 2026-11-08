// Bateria dos 10 cenários de exceção. Roda no processo, sem modelo e sem rede.
// O resultado esperado de cada um está fixado aqui; a Prova só publica o que esta função mede.
import { readFileSync } from 'node:fs';
import { openStore } from './store.ts';
import { executarAcao } from './act.ts';
import { filesHash, recheckTender, type PncpFile } from './recheck.ts';
import { runMonitor } from './monitor.ts';
import { decideItem, checkDocs } from './rules.ts';
import { motivosDaEvidencia, newState, tools } from './tools.ts';
import { leituraDoEdital } from './edital.ts';

const company = JSON.parse(readFileSync(new URL('../../fixtures/company-testes.json', import.meta.url), 'utf8'));
const TID = '77816510000166/2026/348';
const NOW = new Date('2026-11-07T15:00:00-03:00');
const TEXTO = 'Solicitamos esclarecer se a embalagem individual estéril é obrigatória para este item.';
const edital: PncpFile = { seq: 1, titulo: 'edital.pdf', tipo: 'Edital', url: 'https://exemplo.local/edital.pdf' };
const errata: PncpFile = { seq: 2, titulo: 'errata.pdf', tipo: 'Aviso', url: 'https://exemplo.local/errata.pdf' };

export type Cenario = { nome: string; resultado: string; passou: boolean };

const precoOk = { viavel: true as const, precoProposto: 10, motivo: 'dentro da estimativa' };
const baseDecisao = { regularizacao: 'vigente' as const, cobertura: 'declarada_pelo_cliente' as const, preco: precoOk, docs: [] as ReturnType<typeof checkDocs>, restritivo: false, varianteNaoCoberta: false };

function banca(o: { abertura?: string; hash?: string | null; reavaliar?: boolean; quantidade?: number; estado?: 'disputar' | 'escalar' | 'esclarecer' | 'disputar_com_pendencia'; preco?: number; atributos?: unknown } = {}) {
  const store = openStore(':memory:', { now: () => NOW });
  store.upsertTender({ id: TID, orgao: 'Órgão', uf: 'PR', abertura: o.abertura ?? '2026-11-23T09:00', situacao: 'Divulgada no PNCP',
    plataforma: 'Compras.gov.br', arquivosHash: o.hash === undefined ? 'foto' : o.hash, ultimoCheck: null, reavaliar: o.reavaliar });
  store.upsertItems(TID, [{ tenderId: TID, numero: 40, descricao: 'material: aço inoxidável', catalogCode: null, quantidade: o.quantidade ?? 10, estimativa: 100, sigiloso: false }]);
  if (o.estado) store.upsertDecision({ tenderId: TID, item: 40, produto: 'P1', estado: o.estado, motivos: ['cenário'], precoProposto: o.preco ?? 50 });
  if (o.atributos) store.upsertFit({ tenderId: TID, item: 40, produto: 'P1', fit: 'desconhecido', atributos: o.atributos });
  const posts: string[] = [];
  const deps = {
    store, politica: company.politica, sandboxUrl: 'http://sandbox', empresa: company.empresa.nome, catalogo: company.catalogo, now: () => NOW,
    recheck: async () => ({ status: 'ok' as const, situacao: 'Divulgada no PNCP', arquivosHash: 'foto', em: NOW.toISOString() }),
    enviar: async (url: string) => { posts.push(url); return { status: 201, body: { protocolo: 'P-1' } }; },
    consultar: async () => ({ encontrado: true as const, registro: {} }),
  };
  return { store, posts, deps };
}

async function rodar(nome: string, fn: () => Promise<string>): Promise<Cenario> {
  try {
    const resultado = await fn();
    return { nome, resultado, passou: true };
  } catch (e) {
    return { nome, resultado: e instanceof Error ? e.message : String(e), passou: false };
  }
}
const exige = (ok: unknown, msg: string) => { if (!ok) throw new Error(msg); };

export async function executarCenarios(): Promise<Cenario[]> {
  return [
    await rodar('Pregão suspenso antes do envio', async () => {
      const foto = filesHash([edital]);
      const { store, posts, deps } = banca({ hash: foto, estado: 'disputar' });
      const recheque = await recheckTender(TID, store, {
        fetchCompra: async () => ({ situacaoCompraNome: 'Suspensa', dataEncerramentoProposta: '2026-12-20T10:00:00' }),
        fetchFiles: async () => [edital], now: () => NOW,
      });
      const acao = await executarAcao({ tipo: 'enviar_proposta', tenderId: TID, itens: [40] }, { ...deps, recheck: async () => recheque });
      exige(recheque.status === 'bloquear' && recheque.motivo === 'suspenso', 'recheque não bloqueou o suspenso');
      exige(acao.resultado === 'bloqueada' && posts.length === 0, 'a proposta saiu com o pregão suspenso');
      exige(store.events().some(e => e.tipo === 'bloqueio' && e.tender === TID), 'o bloqueio não foi registrado');
      store.close();
      return 'não envia e registra o bloqueio';
    }),
    await rodar('Errata nova num pregão acompanhado', async () => {
      const foto = filesHash([edital]);
      const { store, posts, deps } = banca({ hash: foto, estado: 'disputar' });
      const monitor = await runMonitor(store, {
        fetchCompra: async () => ({ situacaoCompraNome: 'Divulgada no PNCP' }),
        fetchFiles: async () => [edital, errata], now: () => NOW,
      });
      const recheque = await recheckTender(TID, store, {
        fetchCompra: async () => ({ situacaoCompraNome: 'Divulgada no PNCP', dataEncerramentoProposta: '2026-12-20T10:00:00' }),
        fetchFiles: async () => [edital, errata], now: () => NOW,
      });
      const acao = await executarAcao({ tipo: 'enviar_proposta', tenderId: TID, itens: [40] }, { ...deps, recheck: async () => recheque });
      exige(monitor.mudancas === 1 && store.getTender(TID)?.reavaliar === true, 'a errata não marcou o pregão para reavaliar');
      exige(store.getTender(TID)?.arquivosHash === foto, 'a errata substituiu a foto da análise');
      exige(acao.resultado !== 'confirmada' && posts.length === 0, 'a proposta saiu depois da errata');
      store.close();
      return 'marca o pregão para reavaliar, preserva a foto e não envia';
    }),
    await rodar('Edital ilegível', async () => {
      const zip = leituraDoEdital([{ titulo: 'edital.zip', texto: '' }, { titulo: 'anexo.pdf', texto: '   ' }]);
      const segundo = leituraDoEdital([{ titulo: 'edital.zip', texto: '' }, { titulo: 'termo.pdf', texto: 'O licitante deve apresentar registro na ANVISA.' }]);
      exige(zip.legivel === false && zip.escalar && zip.tentados === 2, 'ZIP sem texto não escalou');
      exige(segundo.legivel && segundo.texto.includes('ANVISA'), 'o segundo anexo com texto não foi usado');
      return 'tenta o anexo seguinte; sem texto, escala';
    }),
    await rodar('Ficha sem um atributo exigido', async () => {
      const aberto = decideItem({ ...baseDecisao, fit: 'nao_informado', prazoEsclarecimentoAberto: true });
      const vencido = decideItem({ ...baseDecisao, fit: 'nao_informado', prazoEsclarecimentoAberto: false });
      const { store, posts, deps } = banca({
        atributos: { attributes: [{ atributo: 'embalagem', veredito: 'nao_informado' }], restritivo: null, varianteNaoCoberta: false },
      });
      exige(motivosDaEvidencia(store, TID, 40).has('nao_informado'), 'a evidência de não informado não foi lida');
      const envio = await executarAcao({ tipo: 'enviar_esclarecimento', tenderId: TID, item: 40, texto: TEXTO, motivo: 'nao_informado' }, deps);
      const { store: storeVelho, posts: postsVelhos, deps: depsVelhos } = banca({
        abertura: '2026-11-09T10:00',
        atributos: { attributes: [{ atributo: 'embalagem', veredito: 'nao_informado' }], restritivo: null, varianteNaoCoberta: false },
      });
      const barrado = await executarAcao({ tipo: 'enviar_esclarecimento', tenderId: TID, item: 40, texto: TEXTO, motivo: 'nao_informado' }, depsVelhos);
      exige(aberto.estado === 'esclarecer', 'prazo aberto não pediu esclarecimento');
      exige(vencido.estado === 'escalar', 'prazo vencido não escalou');
      exige(envio.resultado === 'confirmada' && posts.length === 1, 'o esclarecimento com prazo aberto não saiu');
      exige(barrado.resultado === 'escalada' && postsVelhos.length === 0, 'o prazo vencido enviou');
      store.close(); storeVelho.close();
      return 'prazo aberto envia esclarecimento; prazo vencido escala';
    }),
    await rodar('Variante não coberta', async () => {
      const d = decideItem({ ...baseDecisao, fit: 'nao_atende', varianteNaoCoberta: true, prazoEsclarecimentoAberto: true });
      const { store, posts, deps } = banca({
        estado: 'esclarecer',
        atributos: { attributes: [{ atributo: 'variante', veredito: 'nao_atende' }], varianteNaoCoberta: true, restritivo: null },
      });
      exige(d.estado === 'esclarecer', 'a variante coberta foi disputada');
      exige(motivosDaEvidencia(store, TID, 40).has('variante_nao_coberta'), 'a variante não entrou na evidência');
      const envio = await executarAcao({ tipo: 'enviar_esclarecimento', tenderId: TID, item: 40, texto: TEXTO, motivo: 'variante_nao_coberta' }, deps);
      const proposta = await executarAcao({ tipo: 'enviar_proposta', tenderId: TID, itens: [40] }, deps);
      exige(envio.resultado === 'confirmada' && proposta.resultado === 'escalada', 'variante não coberta disputou ou não esclareceu');
      exige(posts.filter(u => u.includes('propostas')).length === 0, 'a proposta da variante saiu');
      store.close();
      return 'não disputa e envia esclarecimento';
    }),
    await rodar('Marca de referência', async () => {
      const d = decideItem({ ...baseDecisao, fit: 'atende', restritivo: true, prazoEsclarecimentoAberto: true });
      const { store, posts, deps } = banca({
        atributos: { attributes: [{ atributo: 'marca', veredito: 'atende' }], restritivo: 'marca_referencia', varianteNaoCoberta: false },
      });
      const envio = await executarAcao({ tipo: 'enviar_esclarecimento', tenderId: TID, item: 40, texto: TEXTO, motivo: 'marca_referencia' }, deps);
      exige(d.estado === 'esclarecer', 'marca de referência não pediu esclarecimento');
      exige(motivosDaEvidencia(store, TID, 40).has('marca_referencia'), 'a marca de referência não entrou na evidência');
      exige(envio.resultado === 'confirmada' && posts.length === 1, 'o esclarecimento da marca não saiu');
      store.close();
      return 'envia esclarecimento';
    }),
    await rodar('Citação inventada', async () => {
      const state = newState({ catalogo: [{ id: 'P1', ficha: 'Material: aço inoxidável.' }] }, 'http://127.0.0.1:9', NOW);
      state.items[TID] = [{ numero: 1, descricao: 'material: aço inoxidável' }];
      const r = await tools.find(t => t.name === 'record_fit')!.run({
        tender_id: TID, item: 1, product_id: 'P1',
        attributes: [{ atributo: 'material', veredito: 'atende', citacao_item: 'titânio grau médico inventado', citacao_ficha: 'Material: aço inoxidável' }],
      }, { state, approvals: new Set<string>() }) as { aceito?: boolean };
      exige(r.aceito === false && state.fits[`${TID}#1`] === undefined, 'citação inventada foi aceita');
      return 'rejeitada; o encaixe não fica registrado';
    }),
    await rodar('PNCP fora do ar', async () => {
      const { store, posts, deps } = banca({ hash: 'foto', estado: 'disputar' });
      const monitor = await runMonitor(store, { fetchCompra: async () => { throw new Error('PNCP fora'); }, fetchFiles: async () => { throw new Error('PNCP fora'); }, now: () => NOW });
      const acao = await executarAcao({ tipo: 'enviar_proposta', tenderId: TID, itens: [40] }, {
        ...deps, recheck: async () => ({ status: 'bloquear' as const, motivo: 'fonte_indisponivel' as const, em: NOW.toISOString() }),
      });
      exige(monitor.falhas === 1 && store.getTender(TID)?.arquivosHash === 'foto', 'a queda do PNCP apagou a foto');
      exige(store.events().some(e => e.tipo === 'erro_fonte'), 'a falha não ficou registrada para o próximo ciclo');
      exige(acao.resultado === 'bloqueada' && posts.length === 0, 'enviou com a fonte fora');
      store.close();
      return 'mantém o cache, registra a falha e não envia';
    }),
    await rodar('Documento do cofre vence antes da sessão', async () => {
      const docs = checkDocs(company.cofre, [{ tipo: 'certidoes', citacao: 'certidões' }], '2026-11-23');
      const d = decideItem({ ...baseDecisao, fit: 'atende', docs, prazoEsclarecimentoAberto: true });
      const { store, posts, deps } = banca({ estado: 'disputar_com_pendencia' });
      const acao = await executarAcao({ tipo: 'enviar_proposta', tenderId: TID, itens: [40] }, deps);
      exige(docs.some(x => x.status === 'vence_antes_sessao'), 'nenhum documento vence antes da sessão');
      exige(d.estado === 'disputar_com_pendencia', 'a pendência documental não entrou na decisão');
      exige(acao.resultado === 'escalada' && posts.length === 0, 'a pendência documental enviou');
      store.close();
      return 'fica com pendência e escala, sem envio';
    }),
    await rodar('Valor acima do limite da política', async () => {
      const { store, posts, deps } = banca({ estado: 'disputar', preco: 90, quantidade: 1000 });
      const acao = await executarAcao({ tipo: 'enviar_proposta', tenderId: TID, itens: [40] }, deps);
      exige(acao.resultado === 'escalada' && posts.length === 0, 'o valor acima do limite foi enviado');
      exige(store.openEscalations().some(e => /limite/.test(e.motivo)), 'a escalada do limite não foi aberta');
      store.close();
      return 'escala em vez de enviar';
    }),
  ];
}

export async function relatorioProva() {
  const cenarios = await executarCenarios();
  const passou = cenarios.filter(c => c.passou).length;
  return {
    fonte: 'Dez cenários de exceção executados neste processo, sem modelo e sem rede. O 18/18 é o eval histórico de 2026-11-07, com fichas sintéticas. Concordância com revisor humano não foi medida.',
    avaliacoes: [
      { nome: 'Encaixe técnico histórico (6 pares × 3, fichas sintéticas)', valor: '18/18' },
      { nome: 'Exigências de edital históricas', valor: '21/27' },
      { nome: 'Cenários de exceção', valor: `${passou}/10` },
    ],
    cenarios: cenarios.map(c => ({ nome: c.nome, resultado: c.passou ? c.resultado : `falhou: ${c.resultado}` })),
    concordancia: null as number | null,
    custoUsd: null as number | null,
    duracaoMs: null as number | null,
  };
}
