import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { openStore } from '../src/lib/store.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { createIntegratedStore } from '../src/server/integrated.ts';
import { createSampleStore } from '../src/server/sample.ts';
import { createServer } from '../src/server/api.ts';
import { createOnboarding, runOnboardingAnalysis } from '../src/server/onboarding.ts';
import type { LLM, Tool } from '../src/lib/agent.ts';
import type { LanceState } from '../src/lib/tools.ts';

const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const demo = JSON.parse(readFileSync(new URL('../fixtures/demo.json', import.meta.url), 'utf8'));
const first = demo.pregoes[0].id as string;
const now = () => new Date('2026-11-07T12:00:00-03:00');
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { resolve, promise }; };

async function serverFixture(t: TestContext, integrated = true, key = true) {
  const store = openStore(':memory:', { now }); t.after(() => store.close());
  const wait = deferred();
  const calls: { tenderId: string; turno: string }[] = [];
  const onboarding = createOnboarding({ company, demo, store: integrated ? store : undefined, disponivel: key,
    executar: async (job) => { calls.push(job); await wait.promise; } });
  const projection = createReadModel(store, { now, actions: () => store.getActions() });
  const app = createServer(integrated ? createIntegratedStore(store, projection) : createSampleStore(), undefined, onboarding);
  app.listen(0, '127.0.0.1'); await once(app, 'listening');
  t.after(() => { wait.resolve(); return new Promise<void>(r => app.close(() => r())); });
  const { port } = app.address() as { port: number };
  return { store, onboarding, calls, wait, get: () => fetch(`http://127.0.0.1:${port}/api/onboarding`),
    start: (body: unknown) => fetch(`http://127.0.0.1:${port}/api/onboarding/analisar`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }) };
}

test('entrada lê somente dados permitidos das fixtures, sem inventar CNPJ ou expor custos', async t => {
  const h = await serverFixture(t);
  const response = await h.get(); assert.equal(response.status, 200);
  const data = (await response.json()).dados;
  assert.deepEqual(data.empresa, company.empresa);
  assert.equal(data.arquivo, 'catalogo-distribuidora.xlsx');
  assert.deepEqual(data.produtos, company.catalogo.map(({ id, nome, marca, registroAnvisa }: any) => ({ id, nome, marca, registroAnvisa })));
  assert.deepEqual(data.pregoes.map((p: any) => p.id), demo.pregoes.map((p: any) => p.id));
  assert.ok(data.pregoes.every((p: any, i: number) => p.matches.length === demo.pregoes[i].matches.length));
  assert.equal(data.empresa.cnpj, undefined);
  assert.equal(data.produtos[0].custo, undefined); assert.equal(data.produtos[0].ficha, undefined);
  assert.equal(data.politica, undefined); assert.deepEqual(h.calls, []);
  assert.equal(data.analise.disponivel, true);
});

for (const p of demo.pregoes) test(`qualquer pregão preparado pode iniciar análise: ${p.id}`, async t => {
  const h = await serverFixture(t);
  const response = await h.start({ tenderId: p.id }); assert.equal(response.status, 202);
  const data = (await response.json()).dados;
  assert.equal(data.tenderId, p.id); assert.ok(data.turno);
  assert.deepEqual(h.calls, [{ tenderId: p.id, turno: data.turno }]);
  assert.equal(h.store.getActions().length, 0);
});

for (const invalid of [demo.evento.id, demo.editalIlegivel.id, '11111111000111/2026/1']) test(`não inicia pregão fora de demo.pregoes: ${invalid}`, async t => {
  const h = await serverFixture(t); assert.equal((await h.start({ tenderId: invalid })).status, 400); assert.deepEqual(h.calls, []);
});

for (const integrated of [true, false]) test(`sem análise disponível não executa nem devolve amostra como resultado (integrado=${integrated})`, async t => {
  const h = await serverFixture(t, integrated, false);
  const data = (await (await h.get()).json()).dados;
  assert.equal(data.analise.disponivel, false);
  const response = await h.start({ tenderId: first }); assert.equal(response.status, 503);
  const body = await response.json(); assert.match(body.erro, /ao vivo indisponível/i);
  assert.deepEqual(h.calls, []); assert.equal(body.dados, undefined);
});

test('amostra não executa mesmo quando há chave configurada', async t => {
  const h = await serverFixture(t, false, true);
  assert.equal((await h.start({ tenderId: first })).status, 503); assert.deepEqual(h.calls, []);
});

test('clique repetido compartilha execução e outro pregão aguarda; após terminar permite nova escolha', async t => {
  const h = await serverFixture(t);
  const a = (await (await h.start({ tenderId: first })).json()).dados;
  const b = (await (await h.start({ tenderId: first })).json()).dados;
  assert.equal(a.turno, b.turno); assert.equal(h.calls.length, 1);
  assert.equal((await h.start({ tenderId: demo.pregoes[1].id })).status, 409);
  h.wait.resolve(); await new Promise(r => setImmediate(r));
  assert.equal((await h.start({ tenderId: demo.pregoes[1].id })).status, 202);
  assert.equal(h.calls.length, 2);
});

test('não aceita dados de empresa, preços ou produtos no pedido de análise', async t => {
  const h = await serverFixture(t);
  for (const body of [null, [], {}, { tenderId: 1 }, { tenderId: first, preco: 1 }, { tenderId: first, company: {} }]) {
    assert.equal((await h.start(body)).status, 400);
  }
  assert.deepEqual(h.calls, []);
});

test('análise passa pelo agente/turno e persiste o próprio resultado, progresso e dossiê', async t => {
  const store = openStore(':memory:', { now }); t.after(() => store.close());
  let calls = 0; let snapshots = 0;
  const llm: LLM = { model: 'teste', chat: async (_, schemas) => {
    assert.ok(schemas.every((s: any) => s.function.name !== 'submit_proposal'));
    return { message: ++calls === 1
    ? { tool_calls: [{ id: '1', function: { name: 'decide_item', arguments: '{}' } }] }
    : { content: 'Análise de teste encerrada.' }, usage: { prompt_tokens: 10, completion_tokens: 5 }, ms: 1 }; } };
  const tool: Tool = { name: 'decide_item', description: 'Teste', parameters: { type: 'object', properties: {} }, run: async (_, ctx) => {
    const st = ctx.state as LanceState;
    assert.equal(st.company, company); assert.deepEqual(Object.keys(st.tenders), [first]);
    st.items[first] = [{ numero: 4, descricao: 'material: aço inoxidável', quantidade: 20, valorEstimado: 12 }];
    st.decisions[`${first}#4`] = { produto: 'P1', estado: 'escalar', motivos: ['Cobertura pendente de teste'], precoProposto: null };
    return st.decisions[`${first}#4`];
  } };
  await runOnboardingAnalysis({ company, demo, store, tenderId: first, turno: 'onboarding-real-path', llm: () => llm,
    ferramentas: [tool, { ...tool, name: 'submit_proposal', run: async () => { assert.fail('não pode enviar'); } }],
    snapshot: async () => { snapshots++; }, now });
  assert.equal(calls, 2); assert.equal(snapshots, 1);
  assert.equal(store.getDecisions(first)[0].motivos[0], 'Cobertura pendente de teste');
  assert.ok(store.getDossie(first)); assert.deepEqual(store.getActions(), []);
  const model = createReadModel(store, { actions: () => [], now });
  assert.equal(model.turnos().turnos.find(p => p.id === 'onboarding-real-path')?.status, 'concluido');
  assert.equal(model.historico()[0].tender, first);
});

test('falha real do modelo chega ao acompanhamento sem inventar resultados', async t => {
  const store = openStore(':memory:', { now }); t.after(() => store.close());
  await assert.rejects(runOnboardingAnalysis({ company, demo, store, tenderId: first, turno: 'falha',
    llm: () => ({ model: 'teste', chat: async () => { throw Error('modelo fora'); } }), now }), /modelo fora/);
  const model = createReadModel(store, { actions: () => [], now });
  assert.equal(model.turnos().turnos.find(p => p.id === 'falha')?.status, 'falhou');
  assert.deepEqual(model.historico(), []); assert.deepEqual(store.getDecisions(), []);
});

test('turno já ativo no banco impede início concorrente pela entrada web', t => {
  const store = openStore(':memory:'); t.after(() => store.close());
  store.logEvent({ tipo: 'turno_progresso', resumo: 'Teste', detalhe: JSON.stringify({ turno: 'outro-processo', tipo: 'inicio', pregoes: [first] }) });
  let calls = 0;
  const onboarding = createOnboarding({ company, demo, store, disponivel: true, executar: async () => { calls++; } });
  assert.throws(() => onboarding.iniciar(first), /turno em andamento/); assert.equal(calls, 0);
});

test('turno sem decisões novas não apresenta resultado antigo como análise da escolha', async t => {
  const store = openStore(':memory:', { now }); t.after(() => store.close());
  store.upsertDecision({ tenderId: first, item: 4, produto: 'P1', estado: 'disputar', motivos: ['Resultado antigo'], precoProposto: 7.5 });
  await runOnboardingAnalysis({ company, demo, store, tenderId: first, turno: 'sem-decisao-nova',
    llm: () => ({ model: 'teste', chat: async () => ({ message: { content: 'Sem decisões.' }, usage: { prompt_tokens: 1, completion_tokens: 1 }, ms: 1 }) }), now });
  const model = createReadModel(store, { actions: () => [], now });
  assert.equal(model.turnos().turnos.find(p => p.id === 'sem-decisao-nova')?.status, 'incompleto');
  assert.deepEqual(model.historico(), []); assert.deepEqual(store.getActions(), []);
});
