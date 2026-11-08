// Turno de análise. O agendador grava turno_inicio/turno_fim; a execução direta grava os seus.
// O progresso ao vivo é outro evento (turno_progresso) e não entra nesse par.
// Não envia proposta nem esclarecimento.
import { randomUUID } from 'node:crypto';
import { persistAnalysis } from './persist-analysis.ts';
import { createReadModel } from './read-model.ts';
import { agruparResultados, eventoTurno, type TurnoEvento } from './turnos.ts';
import type { LanceState } from './tools.ts';
import type { LanceStore } from './store.ts';

type AoVivo = { atividade(nome: string): void; resultado(concluida: boolean): void };
const aoVivo = new WeakMap<object, AoVivo>();

/** O agente consulta isto no momento da ferramenta. O turno preenche antes de chamar o modelo. */
export function acompanhamentoDe(state: object) {
  return aoVivo.get(state);
}

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
  /** Grava as etapas para a tela de acompanhamento, sem mexer no par início/fim do turno. */
  acompanhar?: boolean;
}): Promise<AnalysisResult> {
  const direto = o.origem !== 'agendador';
  const turno = randomUUID();
  let sinal: ReturnType<typeof setInterval> | undefined;
  const registrar = (evento: TurnoEvento) => {
    if (!o.acompanhar) return;
    try { o.store.logEvent(eventoTurno({ turno, ...evento })); }
    catch (error) { console.error('Não foi possível registrar o progresso do turno.', error); }
  };
  if (o.acompanhar) {
    const pregoes = Object.keys(o.state.tenders);
    const nomesEditais = Object.fromEntries(pregoes.map(id => {
      const edital = o.state.tenders[id] as { objeto?: string; orgao?: string } | undefined;
      return [id, (edital?.objeto ?? edital?.orgao ?? '').trim()];
    }));
    registrar({ tipo: 'inicio', pregoes, nomesEditais });
    registrar({ tipo: 'atividade', atividade: 'Preparando a análise dos pregões' });
    aoVivo.set(o.state, {
      atividade: nome => registrar({ tipo: 'atividade', atividade: nome }),
      resultado: concluida => registrar({ tipo: 'resultado', concluida }),
    });
    sinal = setInterval(() => registrar({ tipo: 'sinal' }), 15_000);
    sinal.unref?.();
  }
  if (direto) o.store.logEvent({ tipo: 'turno_inicio', resumo: 'Turno de análise iniciado; ferramentas de envio indisponíveis.' });
  try {
    o.state.analysisStore = { openEscalation: (request, options) => o.store.openEscalation(request, options) };
    const result = await o.run();
    const saved = persistAnalysis(o.state, o.store);
    if (o.snapshot) {
      for (const tenderId of Object.keys(o.state.tenders)) {
        if (!o.state.items[tenderId]?.length) continue;
        const decidiu = Object.keys(o.state.decisions).some(key => key.startsWith(tenderId + '#') && o.state.decisions[key]?.estado);
        if (!decidiu) {
          o.store.logEvent({ tipo: 'bloqueio', resumo: 'análise sem decisão nova: a foto não foi renovada e o pregão continua pendente de reavaliação', tender: tenderId });
          continue;
        }
        try { await o.snapshot(tenderId, o.store); }
        catch (error: any) {
          o.store.logEvent({ tipo: 'erro_fonte', resumo: `foto da análise não gravada (${String(error?.message ?? error).slice(0, 120)}); o recheque bloqueia até haver foto`, tender: tenderId });
        }
      }
    }
    const resumo = `Análise encerrada: ${result.stopped}; ${saved.decisoes} decisões persistidas.`;
    if (o.acompanhar) {
      const model = createReadModel(o.store, { actions: () => o.store.getActions() });
      const keys = new Set(saved.items.map(item => `${item.tender}#${item.item}`));
      const resultados = keys.size
        ? agruparResultados(model.fila().filter(row => keys.has(`${row.tender}#${row.item}`)), model.dossie)
        : [];
      const concluido = result.stopped === 'final' && resultados.length > 0;
      registrar({ tipo: 'fim', status: concluido ? 'concluido' : 'incompleto', resultados: concluido ? resultados : [] });
    }
    if (direto) o.store.logEvent({ tipo: 'turno_fim', resumo });
    return { resumo, decisoes: saved.decisoes, stopped: result.stopped, ms: result.ms, usage: result.usage };
  } catch (error: any) {
    registrar({ tipo: 'fim', status: 'falhou', resultados: [] });
    if (direto) o.store.logEvent({ tipo: 'turno_fim', resumo: `turno falhou: ${String(error?.message ?? error).slice(0, 200)}` });
    throw error;
  } finally {
    clearInterval(sinal);
    aoVivo.delete(o.state);
  }
}
