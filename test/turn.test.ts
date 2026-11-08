// O turno direto grava início e fim; o agendador continua sendo o único a gravá-los no caminho dele.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { pncp, pdf } from '../src/lib/data.ts';
import { newState, tools } from '../src/lib/tools.ts';
import { runAnalysisTurn, acompanhamentoDe } from '../src/lib/turn.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { createScheduler } from '../src/lib/scheduler.ts';
import type { Politica } from '../src/lib/contracts.ts';

const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const id = '11111111000111/2026/1';
const politica: Politica = { ...company.politica, turnos: ['07:00', '11:00', '15:00'], monitorMinutos: 30 };

function prepared() {
  const now = new Date('2026-11-08T07:00:30-03:00');
  const store = openStore(':memory:', { now: () => now });
  const state = newState(company, 'http://127.0.0.1:9', now);
  state.tenders[id] = { abertura: '2026-11-23T09:00', orgao: 'Teste', uf: 'PE' };
  state.items[id] = [{ numero: 1, descricao: 'Produto de teste', quantidade: 1, valorEstimado: 10 }];
  state.decisions[id + '#1'] = { estado: 'escalar', motivos: ['Cobertura desconhecida'], produto: 'P1', precoProposto: 8 };
  return { store, state, now };
}
const tipos = (store: ReturnType<typeof openStore>, tipo: string) => store.events().filter(event => event.tipo === tipo);

test('execução direta grava um início e um fim e persiste a decisão', async () => {
  const { store, state } = prepared();
  const result = await runAnalysisTurn({ store, state, origem: 'direto', run: async () => ({ stopped: 'final', final: 'pronto' }) });
  assert.equal(result.decisoes, 1);
  assert.equal(tipos(store, 'turno_inicio').length, 1);
  assert.match(tipos(store, 'turno_fim')[0]?.resumo ?? '', /1 decisões/);
  assert.equal(store.getDecisions(id).length, 1);
  store.close();
});

test('origem agendador não grava turno_inicio nem turno_fim', async () => {
  const { store, state } = prepared();
  await runAnalysisTurn({ store, state, origem: 'agendador', run: async () => ({ stopped: 'final' }) });
  assert.equal(store.events().filter(event => event.tipo.startsWith('turno_')).length, 0);
  assert.equal(store.getDecisions(id).length, 1);
  store.close();
});

test('falha no caminho direto registra o fim e segue sem evento quando vem do agendador', async () => {
  const direto = prepared();
  await assert.rejects(() => runAnalysisTurn({ store: direto.store, state: direto.state, origem: 'direto', run: async () => { throw new Error('modelo fora'); } }));
  assert.match(tipos(direto.store, 'turno_fim')[0]?.resumo ?? '', /modelo fora/);
  direto.store.close();

  const agendado = prepared();
  await assert.rejects(() => runAnalysisTurn({ store: agendado.store, state: agendado.state, origem: 'agendador', run: async () => { throw new Error('modelo fora'); } }));
  assert.equal(agendado.store.events().filter(event => event.tipo.startsWith('turno_')).length, 0);
  agendado.store.close();
});

test('análise sem decisão nova não renova a foto nem tira a marca de reavaliar', async () => {
  const { store, state } = prepared();
  delete state.decisions[id + '#1'];
  store.upsertTender({ id, orgao: 'Teste', uf: 'PE', abertura: '2026-11-23T09:00', situacao: 'Divulgada', plataforma: 'Compras.gov.br', arquivosHash: 'foto-antiga', ultimoCheck: null, reavaliar: true });
  const fotos: string[] = [];
  await runAnalysisTurn({ store, state, origem: 'agendador', run: async () => ({ stopped: 'final' }), snapshot: async tenderId => { fotos.push(tenderId); } });
  assert.deepEqual(fotos, []);
  assert.equal(store.getTender(id)?.arquivosHash, 'foto-antiga');
  assert.equal(store.getTender(id)?.reavaliar, true);
  store.close();
});

test('a foto da análise é pedida depois de persistir e a falha dela não apaga a decisão', async () => {
  const ok = prepared();
  const fotos: string[] = [];
  await runAnalysisTurn({ store: ok.store, state: ok.state, origem: 'direto', run: async () => ({ stopped: 'final' }), snapshot: async tenderId => { fotos.push(tenderId); } });
  assert.deepEqual(fotos, [id]);
  ok.store.close();

  const falha = prepared();
  await runAnalysisTurn({ store: falha.store, state: falha.state, origem: 'direto', run: async () => ({ stopped: 'final' }), snapshot: async () => { throw new Error('PNCP fora'); } });
  assert.equal(falha.store.getDecisions(id).length, 1);
  assert.match(falha.store.events().find(event => event.tipo === 'erro_fonte')?.resumo ?? '', /foto da análise não gravada/);
  assert.equal(falha.store.events().filter(event => event.tipo === 'turno_fim').length, 1);
  falha.store.close();
});

test('o agendador e o turno juntos deixam um único par de eventos', async () => {
  const { store, state, now } = prepared();
  const scheduler = createScheduler({
    store, politica, now: () => now,
    runMonitor: async () => ({ verificados: 0, mudancas: 0, falhas: 0, ignorados: 0 }),
    runTurn: async ctx => {
      const result = await runAnalysisTurn({ store, state, origem: ctx.origem, run: async () => ({ stopped: 'final', final: 'pronto' }) });
      return { resumo: result.resumo };
    },
  });
  assert.equal((await scheduler.tick()).turno, 'concluido');
  assert.equal(tipos(store, 'turno_inicio').length, 1);
  assert.match(tipos(store, 'turno_inicio')[0]?.detalhe ?? '', /agendado: 2026-11-08 07:00/);
  assert.equal(tipos(store, 'turno_fim').length, 1);
  assert.match(tipos(store, 'turno_fim')[0]?.resumo ?? '', /turno concluído/);
  store.close();
});

test('o turno de análise registra na fila humana um edital ZIP ilegível', async t => {
  const { store, state } = prepared();
  t.mock.method(pncp, 'files', async () => [{ titulo: 'Edital.zip', tipo: 'Edital', url: 'https://example.test/edital.zip' }]);
  t.mock.method(pdf, 'fromUrl', async () => ({ kind: 'zip' }));
  const read = tools.find(tool => tool.name === 'read_edital')!;
  try {
    const result = await runAnalysisTurn({
      store, state, origem: 'direto',
      run: async () => {
        const context = { state, approvals: new Set<string>() };
        await read.run({ tender_id: id, topicos: ['ANVISA'] }, context);
        await read.run({ tender_id: id, topicos: ['ANVISA'] }, context);
        return { stopped: 'final' };
      },
    });
    assert.equal(result.decisoes, 1);
    assert.equal(store.openEscalations().filter(row => !row.item && /edital/i.test(row.motivo)).length, 1);
    assert.equal(state.store, undefined);
    assert.equal(store.getActions().length, 0);
  } finally { store.close(); }
});

test('o acompanhamento publica o histórico sem abrir um segundo par de início e fim', async () => {
  const { store, state } = prepared();
  await runAnalysisTurn({
    store, state, origem: 'direto', acompanhar: true,
    run: async () => {
      acompanhamentoDe(state)?.atividade('Lendo o edital');
      acompanhamentoDe(state)?.resultado(true);
      return { stopped: 'final', final: 'pronto' };
    },
  });
  assert.equal(tipos(store, 'turno_inicio').length, 1);
  assert.equal(tipos(store, 'turno_fim').length, 1);
  assert.equal(tipos(store, 'turno_inicio')[0]?.detalhe, undefined);
  const model = createReadModel(store, { actions: () => store.getActions() });
  assert.equal(model.historico()[0]?.itens[0]?.estado, 'Escalar');
  assert.equal(model.turnos().turnos.length, 1);
  assert.equal(model.turnos().turnos[0]?.status, 'concluido');
  store.close();
});

test('turno incompleto fica persistido e fora do histórico', async () => {
  const { store, state } = prepared();
  await runAnalysisTurn({ store, state, origem: 'direto', acompanhar: true, run: async () => ({ stopped: 'max_steps' }) });
  assert.equal(store.getDecisions(id).length, 1);
  const model = createReadModel(store, { actions: () => store.getActions() });
  assert.equal(model.historico().length, 0);
  assert.equal(model.turnos().turnos[0]?.status, 'incompleto');
  assert.match(model.turnos().turnos[0]?.motivo ?? '', /limite de passos do agente/);
  store.close();
});

test('o agendador acompanhado não grava turno_inicio nem turno_fim', async () => {
  const { store, state } = prepared();
  await runAnalysisTurn({ store, state, origem: 'agendador', acompanhar: true, run: async () => ({ stopped: 'final' }) });
  assert.equal(tipos(store, 'turno_inicio').length, 0);
  assert.equal(tipos(store, 'turno_fim').length, 0);
  assert.ok(tipos(store, 'turno_progresso').length > 0);
  store.close();
});
