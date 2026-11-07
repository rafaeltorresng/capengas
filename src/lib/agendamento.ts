// Turno chamado pelo agendador: escolhe os pregões, monta o estado do agente, roda a análise e grava a foto.
// Não envia nada. O agente (modelo) é injetado; os eventos turno_inicio/turno_fim são do agendador.
import { newState, type LanceState } from './tools.ts';
import { runAnalysisTurn, type AnalysisExecution } from './turn.ts';
import { parseId } from './recheck.ts';
import type { Recheque, TenderRow } from './contracts.ts';
import type { Tender } from './data.ts';
import type { LanceStore } from './store.ts';
import type { TurnContext } from './scheduler.ts';

export type PregaoDemo = { id: string; orgao?: string; uf?: string; municipio?: string; abertura?: string | null; plataforma?: string; url?: string };
/** Subconjunto de fixtures/demo.json usado aqui. */
export type DemoSelecao = { pregoes: PregaoDemo[]; evento?: PregaoDemo | null; editalIlegivel?: PregaoDemo | null };

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
    sistema: base?.plataforma ?? '', url: (base && 'url' in base ? base.url : undefined) ?? `https://pncp.gov.br/app/editais/${id}`,
  };
}

export function resolverPregoesSolicitados<T extends Pick<Tender, 'cnpj' | 'ano' | 'seq'>>(
  ids: string[], coverage: T[], demo: DemoSelecao,
) {
  const selecao = demo.pregoes.concat(demo.evento ?? [], demo.editalIlegivel ?? []);
  return Object.fromEntries(ids.map(id => {
    const anterior = coverage.find(t => `${t.cnpj}/${t.ano}/${t.seq}` === id);
    if (anterior) return [id, anterior] as const;
    const selecionado = selecao.find(t => t.id === id);
    if (!selecionado) throw new Error(`pregão ${id} não está nas fixtures coverage e demo; atualize a seleção antes de executar`);
    return [id, tenderRef(id, selecionado)] as const;
  }));
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
    return { resumo: `${ids.join(', ')}: ${r.resumo}` };
  };
}
