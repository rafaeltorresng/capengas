import type { DemoStore, Dossier, Escalation, Event, Item, Proof, QueueItem, SavedDecision, Today } from './contract.ts';
import seed from '../../fixtures/dev3-amostra.json' with { type: 'json' };
import { agruparResultados, pncpUrl } from '../lib/turnos.ts';

export type SampleState = {
  hoje: Today; fila: QueueItem[]; itens: Item[]; dossies: Dossier[];
  escaladas: Escalation[]; prova: Proof;
};

export function createSampleStore(initial: SampleState = seed): DemoStore {
  const { hoje, fila, itens, dossies, escaladas, prova } = structuredClone(initial);
  const eventos: Event[] = hoje.eventos;
  const decisoes = new Map<string, SavedDecision>();
  const inicioAtual = new Date(Date.now() - 120_000).toISOString();
  const etapaAtual = new Date(Date.now() - 60_000).toISOString();
  const inicioAnterior = hoje.data + 'T08:00:00-03:00';
  const fimAnterior = hoje.data + 'T09:00:00-03:00';

  function abertas() {
    return escaladas.filter(escalada => !decisoes.has(escalada.id));
  }

  return {
    origem: 'amostra',
    turnos: () => {
      const nomesEditais = Object.fromEntries(fila.map(row => [row.tender, row.pregao]));
      const pregoes = Object.keys(nomesEditais);
      return { aprovacoes: abertas().length, turnos: pregoes.length ? [
        { id: 'amostra-atual', inicio: inicioAtual, atualizadoEm: new Date().toISOString(), status: 'ativo', pregoes: pregoes.slice(-1), nomesEditais,
          etapas: [{ horario: inicioAtual, atividade: 'Consultando os itens do pregão', estado: 'concluida' },
            { horario: etapaAtual, atividade: 'Lendo o edital', estado: 'em_andamento' }] },
        { id: 'amostra-concluida', inicio: inicioAnterior, atualizadoEm: fimAnterior, status: 'concluido', pregoes, nomesEditais,
          etapas: [{ horario: fimAnterior, atividade: 'Registrando a análise', estado: 'concluida' }] },
      ] : [] };
    },
    historico: () => agruparResultados(fila, tender => dossies.find(row => row.tender === tender)).map(resultado => ({
      ...resultado, turno: 'amostra-concluida', concluidoEm: fimAnterior,
      pncp: pncpUrl(resultado.tender),
    })),
    hoje: () => ({
      ...hoje,
      escaladasAbertas: abertas().length,
      eventos: [...eventos].sort((a, b) => Date.parse(a.horario) - Date.parse(b.horario)),
    }),
    fila: () => fila,
    item: (tender, item) => itens.find(entry => entry.tender === tender && entry.item === item),
    dossie: tender => dossies.find(entry => entry.tender === tender),
    escaladas: abertas,
    prova: () => prova,
    decidir(id, decision) {
      const escalada = escaladas.find(entry => entry.id === id);
      if (!escalada) return { status: 'ausente' };
      if (decisoes.has(id)) return { status: 'resolvida' };
      // Advance the simulated day's clock after each human decision.
      const latest = eventos.reduce((latest, event) => Math.max(latest, Date.parse(event.horario)),
        Date.parse(hoje.data + 'T00:00:00-03:00'));
      const horario = new Date(latest + 1000).toISOString();
      const registro = { id, horario, ...decision };
      decisoes.set(id, registro);
      eventos.push({
        id: 'decisao-' + id, horario, tipo: 'decisao-humana', resumo: 'Escalada resolvida',
        detalhe: decision.ajuste ? 'Ajustar: ' + decision.ajuste : decision.decisao,
        tender: escalada.tender, item: escalada.item, dossie: escalada.dossie,
        rastro: [{ ferramenta: 'Revisão humana', entrada: escalada.motivo, saida: decision.decisao, ms: 0, custoUsd: 0 }],
      });
      return { status: 'salva', registro };
    },
  };
}
