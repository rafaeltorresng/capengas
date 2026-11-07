import type { Event, Proof } from './contract.ts';

function lastCompletedTurn(events: readonly Event[]) {
  const endIndex = events.findLastIndex(event => event.tipo === 'turno_fim');
  if (endIndex < 0) return null;
  const startIndex = events.slice(0, endIndex).findLastIndex(event =>
    event.tipo === 'turno_inicio' || event.tipo === 'turno_fim',
  );
  const start = events[startIndex];
  if (start?.tipo !== 'turno_inicio') return null;
  const previousBoundary = events.slice(0, startIndex).findLast(event =>
    event.tipo === 'turno_inicio' || event.tipo === 'turno_fim',
  );
  if (previousBoundary?.tipo === 'turno_inicio') return null;
  const end = events[endIndex];
  const elapsed = Date.parse(end.horario) - Date.parse(start.horario);
  if (!Number.isFinite(elapsed) || elapsed < 0) return null;
  const turnTrace = end.rastro?.find(trace => trace.ferramenta === 'turno');
  const calls = events.slice(startIndex + 1, endIndex + 1).flatMap(event => event.rastro ?? [])
    .filter(trace => trace.ferramenta === 'llm' || trace.ferramenta.startsWith('llm:'));
  const costs = calls.map(call => call.custoUsd);
  const cost = costs.length && costs.every(value => value != null && Number.isFinite(value) && value >= 0)
    ? costs.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
  const measuredDuration = turnTrace?.ms;
  return {
    horario: end.horario,
    duracaoMs: measuredDuration != null && Number.isFinite(measuredDuration) && measuredDuration >= 0
      ? measuredDuration : elapsed,
    custoUsd: cost,
  };
}

export function buildProof(report: Proof, events: readonly Event[]): Proof {
  const turn = lastCompletedTurn(events);
  const time = turn ? new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Fortaleza', dateStyle: 'short', timeStyle: 'short',
  }).format(new Date(turn.horario)) : null;
  return {
    ...report,
    fonte: report.fonte + ' '
      + (time ? 'Custo e tempo vêm do último turno encerrado no banco, em ' + time + '.'
        : 'O banco ainda não tem um turno encerrado com horários válidos.'),
    custoUsd: turn?.custoUsd ?? null,
    duracaoMs: turn?.duracaoMs ?? null,
  };
}
