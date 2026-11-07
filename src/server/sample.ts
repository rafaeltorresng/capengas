import type { DemoStore, Event, SavedDecision } from './contract.ts';
import seed from '../../fixtures/dev3-amostra.json' with { type: 'json' };

export function createSampleStore(): DemoStore {
  const { hoje, fila, itens, dossies, escaladas, prova } = structuredClone(seed);
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
    decidir(id, decision) {
      const escalada = escaladas.find(entry => entry.id === id);
      if (!escalada) return { status: 'ausente' };
      if (decisoes.has(id)) return { status: 'resolvida' };
      const now = new Date();
      const time = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'America/Fortaleza', timeStyle: 'medium', hourCycle: 'h23',
      }).format(now);
      const latest = Math.max(Date.parse(hoje.data + 'T' + time + '-03:00'),
        ...eventos.map(event => Date.parse(event.horario) + 1000));
      const horario = new Date(latest).toISOString();
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
