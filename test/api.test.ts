import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadModel } from '../src/lib/read-model.ts';
import { openStore } from '../src/lib/store.ts';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { createServer } from '../src/server/api.ts';
import { createIntegratedStore } from '../src/server/integrated.ts';
import { createSampleStore } from '../src/server/sample.ts';

async function fixture(t: TestContext, store = createSampleStore()) {
  const server = createServer(store);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    get: (path: string) => fetch('http://127.0.0.1:' + address.port + '/api/' + path),
    decide: (id: string, body: unknown) => fetch('http://127.0.0.1:' + address.port + '/api/escaladas/' + id, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
  };
}

test('reads all six views from the demo entry point', async t => {
  const { get } = await fixture(t);
  const routes = ['hoje', 'fila', 'itens/demo-17/40', 'dossies/demo-17', 'escaladas', 'prova'];
  for (const route of routes) {
    const response = await get(route);
    assert.equal(response.status, 200, route);
    assert.equal((await response.json()).origem, 'amostra');
  }
  for (const route of ['itens/demo-17/99', 'dossies/ausente', 'desconhecido']) {
    assert.equal((await get(route)).status, 404);
  }
  assert.equal((await get('itens/%GG/40')).status, 400);
});

for (const decisao of ['aprovar', 'recusar', 'ajustar']) {
  test('records ' + decisao + ' and refreshes the open queue and timeline', async t => {
    const { get, decide } = await fixture(t);
    const response = await decide('cnd', { decisao, ...(decisao === 'ajustar' ? { ajuste: '  Atualizar a CND  ' } : {}) });
    assert.equal(response.status, 200);
    const saved = (await response.json()).dados;
    assert.equal(saved.decisao, decisao);
    if (decisao === 'ajustar') assert.equal(saved.ajuste, 'Atualizar a CND');
    assert.deepEqual((await (await get('escaladas')).json()).dados, []);
    const today = (await (await get('hoje')).json()).dados;
    assert.equal(today.escaladasAbertas, 0);
    assert.equal(today.eventos.filter((event: { tipo: string }) => event.tipo === 'decisao-humana').length, 1);
  });
}

test('rejects invalid, unknown and concurrent decisions', async t => {
  const { get, decide } = await fixture(t);
  for (const body of [null, {}, { decisao: 'enviar' }, { decisao: 'ajustar', ajuste: ' ' }, { decisao: 'aprovar', ajuste: 12 }]) {
    assert.equal((await decide('cnd', body)).status, 400);
  }
  assert.equal((await decide('ausente', { decisao: 'recusar' })).status, 404);
  const responses = await Promise.all([
    decide('cnd', { decisao: 'aprovar' }), decide('cnd', { decisao: 'recusar' }),
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const today = (await (await get('hoje')).json()).dados;
  assert.equal(today.eventos.filter((event: { tipo: string }) => event.tipo === 'decisao-humana').length, 1);
});

test('reports an expired escalation as a conflict', async t => {
  const store = createSampleStore();
  store.decidir = () => ({ status: 'expirada' });
  const { decide } = await fixture(t, store);
  const response = await decide('cnd', { decisao: 'aprovar' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).erro, 'O prazo desta escalada terminou.');
});
test('integrated API reads the projection and delegates decisions to the store', async t => {
  const projection = createSampleStore();
  const calls: string[] = [];
  const store = createIntegratedStore({
    resolveEscalation(id, decision) {
      calls.push(id);
      return projection.decidir(id, decision);
    },
  }, projection);
  const { get, decide } = await fixture(t, store);
  const initial = await (await get('escaladas')).json();
  assert.equal(initial.origem, 'integrado');
  assert.equal(initial.dados.length, 1);
  assert.equal((await decide('cnd', { decisao: 'recusar' })).status, 200);
  assert.deepEqual(calls, ['cnd']);
  assert.deepEqual((await (await get('escaladas')).json()).dados, []);
  assert.equal((await (await get('hoje')).json()).dados.eventos.at(-1).tipo, 'decisao-humana');
});
test('persists a decision and one audit event through HTTP and SQLite', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lance-api-'));
  const path = join(dir, 'test.db');
  const store = openStore(path, { now: () => new Date('2026-11-08T10:00:00-03:00') });
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const row = store.openEscalation({
    tender: '77816510000166/2026/348', motivo: 'CND', recomendacao: 'Atualizar', prazo: '2026-11-08T11:00:00-03:00',
  });
  store.upsertTender({
    id: row.tender, orgao: 'Município de Francisco Beltrão', uf: 'PR', abertura: null,
    situacao: 'Divulgada', plataforma: 'Compras.gov.br', arquivosHash: null, ultimoCheck: null,
  });
  store.upsertItems(row.tender, [{
    tenderId: row.tender, numero: 40, descricao: 'Item de teste', catalogCode: null,
    quantidade: 1, estimativa: null, sigiloso: false,
  }]);
  store.upsertDossie(row.tender, {
    tender: row.tender, pregao: 'Pregão 348/2026', versao: '1', checklist: [], documentos: [], pendencias: [], itens: [],
  });
  store.upsertDecision({ tenderId: row.tender, item: 40, produto: 'P2',
    estado: 'escalar', motivos: ['Conferir a CND'], precoProposto: null });
  const api = createIntegratedStore(store, createReadModel(store, { actions: () => store.getActions() }));
  const { get, decide } = await fixture(t, api);
  try {
    const tender = encodeURIComponent(row.tender);
    for (const route of ['hoje', 'fila', 'itens/' + tender + '/40', 'dossies/' + tender, 'escaladas', 'prova', 'turnos', 'historico']) {
      const response = await get(route);
      assert.equal(response.status, 200, route);
      assert.equal((await response.json()).origem, 'integrado');
    }
    assert.equal((await (await get('itens/' + tender + '/40')).json()).dados.prazo, null);
    assert.equal((await decide(row.id, { decisao: 'ajustar', ajuste: 'Atualizar CND' })).status, 200);
    assert.equal((await decide(row.id, { decisao: 'aprovar' })).status, 409);
    assert.deepEqual((await (await get('escaladas')).json()).dados, []);
  } finally {
    store.close();
  }
  const reopened = openStore(path);
  try {
    assert.deepEqual(reopened.openEscalations(), []);
    assert.equal(reopened.resolveEscalation(row.id, { decisao: 'aprovar' }).status, 'resolvida');
    assert.equal(reopened.events().filter(event => event.tipo === 'escalada_decidida').length, 1);
  } finally {
    reopened.close();
  }
});
