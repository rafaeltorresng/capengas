// Turno de análise. O agendador grava turno_inicio/turno_fim; a execução direta grava os seus.
// Não envia proposta nem esclarecimento.
import { persistAnalysis } from './persist-analysis.ts';
import type { LanceState } from './tools.ts';
import type { LanceStore } from './store.ts';

export type AnalysisOrigin = 'direto' | 'agendador';
export type AnalysisExecution = { stopped: string; final?: string | null; ms?: number; usage?: unknown };
export type AnalysisResult = { resumo: string; decisoes: number; stopped: string; ms?: number; usage?: unknown };

export async function runAnalysisTurn(o: {
  store: LanceStore;
  state: LanceState;
  origem: AnalysisOrigin;
  run: () => Promise<AnalysisExecution>;
  /** Foto para o recheque. Sem ela, recheckTender bloqueia por arquivos_mudaram. Falha da foto não apaga a análise. */
  snapshot?: (tenderId: string, store: LanceStore) => Promise<unknown>;
}): Promise<AnalysisResult> {
  const direto = o.origem !== 'agendador';
  if (direto) o.store.logEvent({ tipo: 'turno_inicio', resumo: 'Turno de análise iniciado; ferramentas de envio indisponíveis.' });
  try {
    const result = await o.run();
    const saved = persistAnalysis(o.state, o.store);
    if (o.snapshot) {
      for (const tenderId of Object.keys(o.state.tenders)) {
        if (!o.state.items[tenderId]?.length) continue;
        try { await o.snapshot(tenderId, o.store); }
        catch (error: any) {
          o.store.logEvent({ tipo: 'erro_fonte', resumo: `foto da análise não gravada (${String(error?.message ?? error).slice(0, 120)}); o recheque bloqueia até haver foto`, tender: tenderId });
        }
      }
    }
    const resumo = `Análise encerrada: ${result.stopped}; ${saved.decisoes} decisões persistidas.`;
    if (direto) o.store.logEvent({ tipo: 'turno_fim', resumo });
    return { resumo, decisoes: saved.decisoes, stopped: result.stopped, ms: result.ms, usage: result.usage };
  } catch (error: any) {
    if (direto) o.store.logEvent({ tipo: 'turno_fim', resumo: `turno falhou: ${String(error?.message ?? error).slice(0, 200)}` });
    throw error;
  }
}
