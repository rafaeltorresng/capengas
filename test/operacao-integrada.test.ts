import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { tools, newState, type LanceState } from '../src/lib/tools.ts';
import { runAnalysisTurn } from '../src/lib/turn.ts';
import { persistAnalysis } from '../src/lib/persist-analysis.ts';
import { openStore } from '../src/lib/store.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { createIntegratedStore } from '../src/server/integrated.ts';
import { createServer } from '../src/server/api.ts';
import { prepararDocumento } from '../src/server/documentos.ts';
import { evaluate } from '../src/lib/policy.ts';
import { executarAcao } from '../src/lib/act.ts';
import { pncp, pdf } from '../src/lib/data.ts';
import { runOnboardingAnalysis } from '../src/server/onboarding.ts';
import type { LLM, Tool } from '../src/lib/agent.ts';
const company = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));
const tid = '77816510000166/2026/348';
const quote = 'A entrega será realizada em 15 dias corridos após o recebimento da ordem de fornecimento.';
const fonte = { nome: 'TR sintético de teste', url: 'https://example.org/tr', texto: quote };
const now = () => new Date('2026-11-08T12:00:00Z');
function preparar(st: LanceState) {
  st.tenders[tid] = { orgao: 'Órgão sintético', abertura: '2026-11-23T09:00' };
  st.items[tid] = [{ numero: 4, descricao: 'Produto de teste', quantidade: 20, unidade: 'Unidade', valorEstimado: 12 }];
  st.decisions[tid + '#4'] = { produto: 'P1', estado: 'disputar', motivos: ['Encaixe de teste'], precoProposto: 7.5 };
  st.editalSources = { [tid]: [fonte] };
}
test('a etapa operacional não reduz os trechos técnicos devolvidos por read_edital', async () => {
  const st = newState(company, '', now()); preparar(st); st.operationalConditions = {};
  const topicos = ['alfa', 'bravo', 'charlie', 'delta', 'eco', 'foxtrot'];
  st.editais[tid] = topicos.map(t => t + ' ' + '.'.repeat(900)).join(' ');
  const r = await tools.find(t => t.name === 'read_edital')!.run({ tender_id: tid, topics: topicos }, { state: st } as never) as { trechos: { topico: string }[] };
  assert.deepEqual(r.trechos.map(t => t.topico), topicos);
});
test('cláusula registrada atravessa decisão, store, API, pendência, minuta e relatório, sem envio', async t => {
  const store = openStore(':memory:', { now }); t.after(() => store.close());
  const st = newState(structuredClone(company), '', now()); preparar(st);
  store.openEscalation({ tender: tid, item: '4', motivo: 'Pendência técnica anterior', recomendacao: 'Conferir cobertura', prazo: '2026-11-23T09:00:00-03:00' });
  st.company.empresa.prazoEntregaUnidade = 'corridos'; st.company.empresa.prazoEntregaMarco = 'ordem_fornecimento';
  await runAnalysisTurn({ state: st, store, origem: 'direto', acompanhar: true, turnoId: 'operacao-teste', run: async () => {
    const record = tools.find(t => t.name === 'record_operational_condition'); assert.ok(record);
    const r = await record.run({ tender_id: tid, campo: 'entrega', arquivo: fonte.nome, citacao: quote }, { state: st } as never) as { aceito: boolean };
    assert.equal(r.aceito, true);
    await tools.find(t => t.name === 'draft_proposal_document')!.run({ tender_id: tid }, { state: st } as never);
    return { stopped: 'final' };
  } });
  const model = createReadModel(store, { now, actions: () => store.getActions() });
  const d = model.dossie(tid)!;
  assert.equal(d.operacao?.linhas[0].estado, 'conflito');
  assert.equal(d.operacao?.fontes[0].texto, quote);
  assert.equal(store.getDecisions(tid)[0].estado, 'disputar_com_pendencia');
  assert.equal(store.getDecisions(tid)[0].precoProposto, 7.5);
  assert.ok(store.openEscalations().some(e => /Operação: conferir condições/.test(e.motivo)), 'pendência anterior não esconde conflito operacional');
  assert.match(prepararDocumento(d, 'relatorio').markdown, /15 dias corridos/);
  assert.match(prepararDocumento(d, 'proposta').markdown, /Condições operacionais/);
  assert.equal(evaluate('enviar_proposta', { tenderId: tid, valor: 150, decisoes: store.getDecisions(tid), recheque: { status: 'ok', arquivosHash: 'h', situacao: 'aberto', em: now().toISOString() } }, company.politica).permitido, false);
  store.upsertTender({ ...store.getTender(tid)!, arquivosHash: 'h', ultimoCheck: now().toISOString() });
  let posts = 0;
  const acao = await executarAcao({ tipo: 'enviar_proposta', tenderId: tid, itens: [4] }, {
    store, politica: company.politica, empresa: company.empresa.nome, catalogo: company.catalogo, sandboxUrl: 'http://127.0.0.1:9', now,
    recheck: async () => ({ status: 'ok', arquivosHash: 'h', situacao: 'aberto', em: now().toISOString() }),
    anvisa: () => ({ NOME_COMERCIAL: 'Straumed', VALIDADE_REGISTRO_CADASTRO: 'VIGENTE' }),
    enviar: async () => { posts++; throw new Error('Não deve fazer POST'); },
  });
  assert.equal(acao.resultado, 'escalada'); assert.equal(posts, 0);
  st.operationalConditions![tid].push({ campo: 'amostra', citacao: 'Se solicitada, apresentar amostra em 3 dias úteis.', fonte: { nome: fonte.nome, url: fonte.url } });
  persistAnalysis(st, store, { analiseId: 'operacao-teste' });
  assert.equal(store.openEscalations().filter(e => /Operação: conferir condições/.test(e.motivo)).length, 1, 'reanálise não duplica a mesma tarefa operacional');
  assert.deepEqual(store.getActions(), []);
  const server = createServer(createIntegratedStore(store, model)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(r => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/dossies/${encodeURIComponent(tid)}`;
  const data = await (await fetch(base)).json(); assert.equal(data.dados.operacao.linhas[0].estado, 'conflito');
  const pdf = await fetch(base + '/relatorio.pdf?analise=operacao-teste');
  assert.equal(pdf.status, 200); assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
});
test('agente que omite a extração não deixa recomendação irrestrita no fim do turno', async () => {
  const store = openStore(':memory:', { now });
  try {
    const st = newState(company, '', now()); preparar(st);
    await runAnalysisTurn({ state: st, store, origem: 'direto', run: async () => ({ stopped: 'final' }) });
    assert.equal(store.getDecisions(tid)[0].estado, 'disputar_com_pendencia');
    const dossie = createReadModel(store, { now, actions: () => [] }).dossie(tid)!;
    assert.ok(dossie.operacao?.requerRevisao);
    assert.equal(dossie.operacao?.revisao?.estado, 'nao_executada');
    const relatorio = prepararDocumento(dossie, 'relatorio').markdown;
    assert.match(relatorio, /Revisão não executada/);
    assert.match(relatorio, /não há conclusão sobre a presença/i);
    assert.doesNotMatch(relatorio, /Nenhum trecho registrado|Nenhuma citação registrada/);
  } finally { store.close(); }
});
test('onboarding disponibiliza ferramentas operacionais antes da viabilidade e registra citação real do contexto', async t => {
  // Modelo e fonte controlados: este teste não mede qualidade do modelo real.
  const store = openStore(':memory:', { now }); t.after(() => { store.close(); mock.restoreAll(); });
  mock.method(pncp, 'files', async () => [{ tipo: 'Edital', titulo: fonte.nome, url: fonte.url }]);
  mock.method(pdf, 'fromUrl', async () => ({ kind: 'pdf', text: quote }));
  const demo = JSON.parse(readFileSync(new URL('../fixtures/demo.json', import.meta.url), 'utf8'));
  const tender = demo.pregoes[0].id;
  const fakeDecide: Tool = { name: 'decide_item', description: 'Caso sintético', parameters: { type: 'object', properties: {} }, run: async (_, ctx) => {
    const st = ctx.state as LanceState; st.items[tender] = [{ numero: 4, descricao: 'Teste', quantidade: 2 }];
    st.decisions[tender + '#4'] = { produto: 'P1', estado: 'disputar', motivos: [], precoProposto: 7.5 }; return {};
  } };
  const chamadas = [
    ['read_edital', { tender_id: tender, topics: ['entrega'] }],
    ['record_operational_condition', { tender_id: tender, campo: 'entrega', arquivo: fonte.nome, citacao: quote }],
    ['decide_item', {}],
  ]; let n = 0;
  const llm: LLM = { model: 'controlado', chat: async (_, schemas) => {
    assert.ok(schemas.some(s => s.function.name === 'record_operational_condition'));
    if (n < 4) assert.ok(schemas.some(s => s.function.name === 'read_operational_excerpt'));
    else assert.deepEqual(schemas.map(s => s.function.name), ['record_operational_condition']);
    const chamada = chamadas[n++];
    return { message: chamada ? { tool_calls: [{ id: String(n), function: { name: chamada[0] as string, arguments: JSON.stringify(chamada[1]) } }] } : { content: 'Fim' }, usage: { prompt_tokens: 1, completion_tokens: 1 }, ms: 1 };
  } };
  await runOnboardingAnalysis({ company, demo, store, tenderId: tender, turno: 'operacao-onboarding', now, llm: () => llm, ferramentas: [fakeDecide, ...tools.filter(t => t.name !== 'decide_item')], snapshot: async () => {} });
  const dossie = createReadModel(store, { now, actions: () => [] }).dossie(tender)!;
  assert.equal(dossie.operacao?.linhas[0].citacoes[0].citacao, quote);
  assert.equal(dossie.operacao?.revisao?.estado, 'concluida');
});
