import type { DemoStore, Dossier, Escalation, Event, Item, Pauta, Proof, QueueItem, SavedDecision, Today } from './contract.ts';
import seed from '../../fixtures/dev3-amostra.json' with { type: 'json' };

export type SampleState = {
  hoje: Today; fila: QueueItem[]; itens: Item[]; dossies: Dossier[];
  escaladas: Escalation[]; prova: Proof;
  /** A amostra do Dev 3 ainda não traz pauta; sem ela, a pauta vem vazia. */
  pauta?: Pauta;
};

export function createSampleStore(initial: SampleState = seed): DemoStore {
  const { hoje, fila, itens, dossies, escaladas, prova, pauta } = structuredClone(initial as SampleState);
  const eventos: Event[] = hoje.eventos;
  const decisoes = new Map<string, SavedDecision>();

  function abertas() {
    return escaladas.filter(escalada => !decisoes.has(escalada.id));
  }

  return {
    origem: 'amostra',
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
    pauta: () => pauta ?? { data: hoje.data, linhas: [], contagem: { acionaveis: 0, informativas: 0 } },
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
