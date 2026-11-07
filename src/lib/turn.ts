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
}): Promise<AnalysisResult> {
  const direto = o.origem !== 'agendador';
  if (direto) o.store.logEvent({ tipo: 'turno_inicio', resumo: 'Turno de análise iniciado; ferramentas de envio indisponíveis.' });
  try {
    const result = await o.run();
    const saved = persistAnalysis(o.state, o.store);
    const resumo = `Análise encerrada: ${result.stopped}; ${saved.decisoes} decisões persistidas.`;
    if (direto) o.store.logEvent({ tipo: 'turno_fim', resumo });
    return { resumo, decisoes: saved.decisoes, stopped: result.stopped, ms: result.ms, usage: result.usage };
  } catch (error: any) {
    if (direto) o.store.logEvent({ tipo: 'turno_fim', resumo: `turno falhou: ${String(error?.message ?? error).slice(0, 200)}` });
    throw error;
  }
}
