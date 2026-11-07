import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test, type TestContext } from 'node:test';
import { createServer } from '../src/server/api.ts';
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