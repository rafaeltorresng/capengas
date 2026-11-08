import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentWithOperationalReview } from '../src/lib/agente-operacional.ts';
import { tools, newState } from '../src/lib/tools.ts';
import type { LLM } from '../src/lib/agent.ts';

const quote = 'A entrega será realizada em 15 dias corridos após o recebimento da ordem de fornecimento.';
function caso() {
  const state = newState({ empresa: { prazoEntregaDias: 60 } }, '');
  state.tenders.t = {}; state.items.t = [{ numero: 4 }];
  state.decisions['t#4'] = { estado: 'disputar', motivos: [], precoProposto: 7.5 };
  state.editalSources = { t: [{ nome: 'TR sintético', url: 'https://example.org/tr', texto: quote }] };
  return state;
}
test('etapa operacional registra a cláusula já consultada sem oferecer ferramenta de nova leitura', async () => {
  const state = caso(); let n = 0; const atividades: string[] = [];
  const llm: LLM = { model: 'controlado', chat: async (_, schemas) => {
    const passo = n++;
    if (passo > 0) {
      assert.deepEqual(schemas.map(s => s.function.name), ['record_operational_condition']);
      assert.ok(atividades.includes('review_operational_conditions'), 'a tela identifica a revisão antes da espera pelo modelo');
    }
    return { message: passo === 1 ? { tool_calls: [{ id: 'registro', function: { name: 'record_operational_condition', arguments: JSON.stringify({ tender_id: 't', campo: 'entrega', arquivo: 'TR sintético', citacao: quote }) } }] } : { content: 'Conclusão controlada' }, usage: { prompt_tokens: 10, completion_tokens: 1 }, ms: 1 };
  } };
  const result = await runAgentWithOperationalReview({ llm, state, tools, system: 'Caso sintético', user: 'Analisar', maxSteps: 1, onToolStart: name => atividades.push(name) });
  assert.equal(result.stopped, 'final'); assert.equal(n, 3);
  assert.equal(state.operationalReviews?.t.estado, 'concluida');
  assert.equal(result.usage.cost, undefined, 'custo ausente no provedor não vira zero medido');
  assert.equal(state.operationalConditions?.t[0].citacao, quote);
  assert.equal(state.decisions['t#4'].estado, 'disputar_com_pendencia');
  assert.equal(state.decisions['t#4'].precoProposto, 7.5);
});
test('falha na etapa operacional preserva conclusão técnica com pendência; turno sem orçamento não a inicia', async () => {
  for (const budget of [1000, 10]) {
    const state = caso(); let n = 0; const falhas: unknown[] = [];
    const llm: LLM = { model: 'controlado', chat: async () => {
      if (n++) throw new Error('Falha controlada do provedor');
      return { message: { content: 'Conclusão' }, usage: { prompt_tokens: 10, completion_tokens: 1 }, ms: 1 };
    } };
    await runAgentWithOperationalReview({ llm, state, tools, system: '', user: '', maxTokens: budget, onEvent: e => { if (e.error) falhas.push(e); } });
    assert.equal(state.decisions['t#4'].estado, 'disputar_com_pendencia');
    assert.equal(n, budget === 10 ? 1 : 2);
    assert.equal(state.operationalReviews?.t.estado, budget === 10 ? 'nao_executada' : 'falhou');
    assert.equal(falhas.length, budget === 10 ? 0 : 1);
  }
});

test('ausência de candidato não é revisão executada nem cláusula não identificada', async () => {
  const state = caso(); state.editalSources!.t[0].texto = 'Objeto: aquisição de material hospitalar.';
  let chamadas = 0;
  const llm: LLM = { model: 'controlado', chat: async () => {
    chamadas++; return { message: { content: 'Fim técnico' }, usage: { prompt_tokens: 10, completion_tokens: 1 }, ms: 1 };
  } };
  await runAgentWithOperationalReview({ llm, state, tools, system: '', user: '' });
  assert.equal(chamadas, 1);
  assert.equal(state.operationalReviews?.t.estado, 'nao_executada');
  assert.match(state.operationalReviews!.t.motivo, /trechos candidatos/);
  assert.equal(state.decisions['t#4'].estado, 'disputar_com_pendencia');
});

test('revisão interrompida pelo limite preserva citações, mas permanece inconclusiva', async () => {
  const state = caso(); let n = 0;
  const llm: LLM = { model: 'controlado', chat: async () => ({ message: n++ === 0 ? { content: 'Fim técnico' } : {
    tool_calls: [{ id: String(n), function: { name: 'record_operational_condition', arguments: JSON.stringify({ tender_id: 't', campo: 'entrega', arquivo: 'TR sintético', citacao: quote }) } }],
  }, usage: { prompt_tokens: 10, completion_tokens: 1 }, ms: 1 }) };
  await runAgentWithOperationalReview({ llm, state, tools, system: '', user: '' });
  assert.equal(n, 3);
  assert.equal(state.operationalReviews?.t.estado, 'inconclusiva');
  assert.equal(state.operationalConditions?.t.length, 1);
});

test('interrupção técnica e ferramenta indisponível registram por que a revisão não começou', async () => {
  for (const semFerramenta of [false, true]) {
    const state = caso();
    const llm: LLM = { model: 'controlado', chat: async () => ({ message: semFerramenta ? { content: 'Fim' } : {
      tool_calls: [{ id: 'c', function: { name: 'list_catalog', arguments: '{}' } }],
    }, usage: { prompt_tokens: 10, completion_tokens: 1 }, ms: 1 }) };
    await runAgentWithOperationalReview({ llm, state, tools: semFerramenta ? tools.filter(t => t.name !== 'record_operational_condition') : tools, system: '', user: '', maxSteps: 1 });
    assert.equal(state.operationalReviews?.t.estado, 'nao_executada');
    assert.match(state.operationalReviews!.t.motivo, semFerramenta ? /ferramenta/ : /max_steps/);
  }
});
