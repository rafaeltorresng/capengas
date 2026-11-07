// Turno chamado pelo agendador: escolhe os pregões, monta o estado do agente, roda a análise, grava a foto e,
// na fase de ações, o código envia pela porta (executarAcao) o que a evidência e a política permitem.
// O modelo não chama envio. O agente é injetado; os eventos turno_inicio/turno_fim são do agendador.
import { newState, motivosDaEvidencia, type LanceState } from './tools.ts';
import { runAnalysisTurn, type AnalysisExecution } from './turn.ts';
import { parseId } from './recheck.ts';
import { executarAcao, type ActDeps, type ResultadoAcao } from './act.ts';
import type { Recheque, TenderRow } from './contracts.ts';
import type { LanceStore } from './store.ts';
import type { TurnContext } from './scheduler.ts';

export type PregaoDemo = { id: string; orgao: string; uf?: string; municipio?: string; abertura?: string | null; plataforma?: string; url?: string };
/** Subconjunto de fixtures/demo.json usado aqui. */
export type DemoSelecao = { pregoes: PregaoDemo[]; evento?: { id: string; orgao?: string }; editalIlegivel?: PregaoDemo };

/** Ordem: marcados pelo monitor para reavaliar; depois os da demo ainda sem foto da análise. O suspenso não entra. */
export function selecionarPregoes(store: LanceStore, demo: DemoSelecao, limite: number): string[] {
  const ids = store.getTenders({ reavaliar: true }).map(t => t.id);
  const candidatos = [...demo.pregoes, ...(demo.editalIlegivel ? [demo.editalIlegivel] : [])];
  for (const p of candidatos) if (!store.getTender(p.id)?.arquivosHash) ids.push(p.id);
  return [...new Set(ids)].filter(id => id !== demo.evento?.id).slice(0, Math.max(0, limite));
}

/** Formato de pregão que as ferramentas do agente esperam (o mesmo de fixtures/coverage.json). */
function tenderRef(id: string, base: PregaoDemo | TenderRow | undefined) {
  const p = parseId(id);
  if (!p) throw new Error(`id de pregão inválido: ${id}`);
  return {
    cnpj: p.cnpj, ano: p.ano, seq: p.seq, orgao: base?.orgao ?? '', uf: base?.uf ?? '',
    municipio: base && 'municipio' in base ? base.municipio : undefined, abertura: base?.abertura ?? null,
    sistema: base?.plataforma ?? '', url: `https://pncp.gov.br/app/editais/${id}`,
  };
}

type Contagem = Partial<Record<ResultadoAcao['resultado'], number>>;
export type ResumoAcoes = { esclarecimentos: Contagem; propostas: Contagem; bloqueados: number };

/** Mais específico primeiro: marca de referência e variante pesam mais que "não informado". */
const ORDEM_MOTIVO = ['marca_referencia', 'variante_nao_coberta', 'nao_informado'] as const;
const SEM_EVIDENCIA = 'rascunho de esclarecimento sem evidência gravada no encaixe: conferir antes de enviar';

export async function executarAcoesDoTurno(d: {
  store: LanceStore; company: any; state: LanceState; ids: string[]; sandboxUrl: string;
  recheck: NonNullable<ActDeps['recheck']>; enviar?: ActDeps['enviar']; consultar?: ActDeps['consultar']; now?: () => Date;
}): Promise<ResumoAcoes> {
  const now = d.now ?? (() => new Date());
  const r: ResumoAcoes = { esclarecimentos: {}, propostas: {}, bloqueados: 0 };
  const conta = (c: Contagem, k: ResultadoAcao['resultado']) => { c[k] = (c[k] ?? 0) + 1; };
  const deps: ActDeps = { store: d.store, politica: d.company.politica, sandboxUrl: d.sandboxUrl, empresa: d.company.empresa?.nome ?? '',
    catalogo: d.company.catalogo ?? [], now, recheck: d.recheck, enviar: d.enviar, consultar: d.consultar };
  for (const id of d.ids) {
    const t = d.store.getTender(id);
    if (!t?.arquivosHash || t.reavaliar === true) {
      r.bloqueados++;
      d.store.logEvent({ tipo: 'bloqueio', resumo: 'ações do turno suspensas: foto da análise ausente ou pregão marcado pelo monitor; reavaliar antes de agir', tender: id });
      continue;
    }
    for (const [k, draft] of Object.entries(d.state.drafts)) {
      if (!k.startsWith(id + '#') || !draft?.texto) continue;
      const item = Number(k.split('#')[1]);
      const evidencias = motivosDaEvidencia(d.store, id, item);
      const motivo = ORDEM_MOTIVO.find(m => evidencias.has(m));
      if (!motivo) {
        if (!d.store.openEscalations().some(e => e.tender === id && e.item === String(item) && e.motivo === SEM_EVIDENCIA)) {
          d.store.openEscalation({ tender: id, item: String(item), motivo: SEM_EVIDENCIA, recomendacao: 'Conferir o rascunho do modelo e a evidência do item antes de enviar.',
            prazo: draft.prazo ? `${draft.prazo}T17:00:00-03:00` : new Date(now().getTime() + 864e5).toISOString() });
        }
        conta(r.esclarecimentos, 'escalada');
        continue;
      }
      conta(r.esclarecimentos, (await executarAcao({ tipo: 'enviar_esclarecimento', tenderId: id, item, texto: draft.texto, motivo }, deps)).resultado);
    }
    const disputar = [...new Set(d.store.getDecisions(id).filter(x => x.estado === 'disputar').map(x => x.item))];
    if (disputar.length) conta(r.propostas, (await executarAcao({ tipo: 'enviar_proposta', tenderId: id, itens: disputar }, deps)).resultado);
  }
  return r;
}

const ROTULO: Record<ResultadoAcao['resultado'], [string, string]> = {
  confirmada: ['confirmado', 'confirmada'], escalada: ['escalado', 'escalada'], bloqueada: ['bloqueado', 'bloqueada'],
  reconciliar: ['a reconciliar', 'a reconciliar'], falhou: ['com falha', 'com falha'],
};
const plural = (n: number, s: string) => n === 1 ? s : s.split(' ').map(w => w === 'a' || w === 'com' ? w : w + 's').join(' ');
export function textoAcoes(r: ResumoAcoes): string {
  const partes: string[] = [];
  for (const [k, n] of Object.entries(r.esclarecimentos) as [ResultadoAcao['resultado'], number][]) partes.push(`${n} ${plural(n, `esclarecimento ${ROTULO[k][0]}`)}`);
  for (const [k, n] of Object.entries(r.propostas) as [ResultadoAcao['resultado'], number][]) partes.push(`${n} ${plural(n, `proposta ${ROTULO[k][1]}`)}`);
  if (r.bloqueados) partes.push(`${r.bloqueados} ${plural(r.bloqueados, 'pregão bloqueado')}`);
  return partes.length ? `ações: ${partes.join('; ')}` : 'ações: nenhuma';
}

export function createAnalysisTurn(d: {
  store: LanceStore;
  company: any;
  demo: DemoSelecao;
  /** Pregões por turno. Um turno real de 1 pregão levou 292 s (fixtures/execucoes). */
  limite?: number;
  analisar: (state: LanceState, ids: string[]) => Promise<AnalysisExecution>;
  snapshot: (tenderId: string, store: LanceStore) => Promise<unknown>;
  recheck: (tenderId: string, store: LanceStore) => Promise<Recheque>;
  /** Fase de ações depois da análise e da foto (executarAcoesDoTurno). Sem ela, o turno só analisa. */
  agir?: (state: LanceState, ids: string[]) => Promise<ResumoAcoes>;
  now?: () => Date;
}) {
  const now = d.now ?? (() => new Date());
  return async (ctx: TurnContext): Promise<{ resumo: string }> => {
    const evento = d.demo.evento?.id;
    if (evento && !d.store.events().some(e => e.tipo === 'bloqueio' && e.tender === evento)) {
      try { await d.recheck(evento, d.store); } catch { /* sem bloqueio registrado: tenta no próximo turno */ }
    }
    const ids = selecionarPregoes(d.store, d.demo, d.limite ?? 1);
    if (!ids.length) return { resumo: 'nenhum pregão novo ou alterado para analisar' };
    const state = newState(d.company, 'http://127.0.0.1:9', now());
    const porId = new Map(d.demo.pregoes.concat(d.demo.editalIlegivel ?? []).map(p => [p.id, p]));
    for (const id of ids) state.tenders[id] = tenderRef(id, porId.get(id) ?? d.store.getTender(id));
    const r = await runAnalysisTurn({ store: d.store, state, origem: ctx.origem, run: () => d.analisar(state, ids), snapshot: d.snapshot });
    const acoes = d.agir ? `; ${textoAcoes(await d.agir(state, ids))}` : '';
    return { resumo: `${ids.join(', ')}: ${r.resumo}${acoes}` };
  };
}
