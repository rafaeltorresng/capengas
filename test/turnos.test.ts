import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadModel } from '../src/lib/read-model.ts';
import { openStore } from '../src/lib/store.ts';
import { eventoTurno, type TurnoEvent } from '../src/lib/turnos.ts';

const tender = '77816510000166/2026/348';
const resultado = {
  tender, pregao: '348/2026', orgao: 'Município', dossie: false,
  itens: [{ item: '1', descricao: 'Produto', estado: 'Não disputar', motivo: 'Item incompatível' }],
};

test('projeta turnos concorrentes, recupera a atualização e só publica resultados concluídos', t => {
  let clock = Date.parse('2026-11-07T15:00:00Z');
  const now = () => new Date(clock);
  const store = openStore(':memory:', { now });
  t.after(() => store.close());
  const log = (event: TurnoEvent) => store.logEvent(eventoTurno(event));
  const model = createReadModel(store, { now, actions: () => store.getActions() });
  log({ turno: 'a', tipo: 'inicio', pregoes: [tender] });
  assert.equal(eventoTurno({ turno: 'a', tipo: 'inicio', pregoes: [tender] }).tipo, 'turno_progresso');
  assert.equal(eventoTurno({ turno: 'a', tipo: 'fim', status: 'concluido', resultados: [] }).tipo, 'turno_progresso');
  log({ turno: 'a', tipo: 'atividade', atividade: 'Lendo o edital' });
  clock += 30_000;
  log({ turno: 'b', tipo: 'inicio', pregoes: [tender] });
  log({ turno: 'b', tipo: 'atividade', atividade: 'Consultando o catálogo' });
  clock += 30_000;
  assert.deepEqual(model.turnos().turnos.map(row => [row.id, row.status, row.etapas[0]?.atividade]), [
    ['b', 'ativo', 'Consultando o catálogo'], ['a', 'sem_atualizacao', 'Lendo o edital'],
  ]);
  assert.deepEqual(model.historico(), []);
  log({ turno: 'a', tipo: 'sinal' });
  assert.equal(model.turnos().turnos.find(row => row.id === 'a')?.status, 'ativo');
  log({ turno: 'a', tipo: 'resultado', concluida: true });
  log({ turno: 'b', tipo: 'resultado', concluida: false });
  assert.equal(model.turnos().turnos.find(row => row.id === 'a')?.etapas[0].estado, 'concluida');
  assert.equal(model.turnos().turnos.find(row => row.id === 'b')?.etapas[0].estado, 'pendente');
  log({ turno: 'b', tipo: 'fim', status: 'incompleto', resultados: [resultado] });
  assert.deepEqual(model.historico(), []);
  log({ turno: 'a', tipo: 'fim', status: 'concluido', resultados: [resultado] });
  assert.deepEqual(model.historico(), [{ ...resultado, turno: 'a', concluidoEm: now().toISOString(),
    pncp: 'https://pncp.gov.br/app/editais/' + tender }]);
  clock += 1000;
  log({ turno: 'c', tipo: 'inicio', pregoes: [tender] });
  log({ turno: 'c', tipo: 'fim', status: 'concluido', resultados: [{ ...resultado, itens: [{ ...resultado.itens[0], estado: 'Disputar' }] }] });
  assert.equal(model.historico().length, 1);
  assert.equal(model.historico()[0].turno, 'c');
  assert.equal(model.historico()[0].itens[0].estado, 'Disputar');
});

test('reconhece um turno legado concluído com decisões e omite atribuições ambíguas', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const model = createReadModel(store, { actions: () => store.getActions() });
  store.upsertDecision({ tenderId: tender, item: 1, produto: 'p', estado: 'nao_disputar', motivos: [], precoProposto: null });
  store.logEvent({ tipo: 'turno_inicio', resumo: 'Turno iniciado' });
  store.logEvent({ tipo: 'decisao', resumo: 'Decisão registrada', tender, item: '1' });
  store.logEvent({ tipo: 'turno_fim', resumo: 'Análise encerrada: final; 1 decisões persistidas.' });
  assert.equal(model.turnos().turnos[0].legado, true);
  assert.deepEqual(model.turnos().turnos[0].etapas, []);
  assert.equal(model.historico()[0].itens[0].estado, 'Não disputar');
  store.logEvent({ tipo: 'turno_inicio', resumo: 'Turno iniciado' });
  store.logEvent({ tipo: 'turno_inicio', resumo: 'Turno iniciado' });
  store.logEvent({ tipo: 'decisao', resumo: 'Decisão registrada', tender, item: '1' });
  store.logEvent({ tipo: 'turno_fim', resumo: 'Análise encerrada: final; 1 decisões persistidas.' });
  assert.deepEqual(model.historico(), []);
});
