// Testes do harness do agente. O modelo aqui é um dublê roteirizado (test double) para exercitar
// a mecânica do loop; o comportamento do modelo real é medido nos evals e no e2e com a Featherless.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../src/lib/schema.ts';
import { runAgent, resumirResultadoAntigo, type Tool, type LLM } from '../src/lib/agent.ts';

describe('validate (JSON Schema mínimo)', () => {
  const s = { type: 'object', required: ['a', 'b'], properties: { a: { type: 'string' }, b: { type: 'integer' }, c: { type: 'string', enum: ['x', 'y'] }, d: { type: 'array', items: { type: 'number' } } } };
  test('aceita válido', () => assert.deepEqual(validate(s, { a: 'k', b: 2, c: 'x', d: [1.5] }), []));
  test('falta obrigatório', () => assert.match(validate(s, { a: 'k' }).join(), /b.*obrigatório/));
  test('tipo errado', () => assert.match(validate(s, { a: 1, b: 2 }).join(), /a.*string/));
  test('inteiro com fração', () => assert.match(validate(s, { a: 'k', b: 2.5 }).join(), /b.*integer/));
  test('enum', () => assert.match(validate(s, { a: 'k', b: 1, c: 'z' }).join(), /c.*x, y/));
  test('item de array', () => assert.match(validate(s, { a: 'k', b: 1, d: ['q'] }).join(), /d\[0\].*number/));
});

const scripted = (turns: any[]): LLM => {
  let i = 0;
  return { model: 'scripted', async chat() { const m = turns[i++]; if (!m) throw new Error('roteiro acabou'); return { message: m, usage: { prompt_tokens: 10, completion_tokens: 5 }, ms: 1 }; } };
};
const call = (name: string, args: object, id = name) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const echo: Tool = { name: 'echo', description: 'eco', parameters: { type: 'object', required: ['x'], properties: { x: { type: 'string' } } }, run: async (a: any) => ({ got: a.x }) };

describe('runAgent', () => {
  test('executa ferramenta e termina com resposta final', async () => {
    const r = await runAgent({ llm: scripted([call('echo', { x: 'oi' }), { role: 'assistant', content: 'pronto' }]), tools: [echo], system: 's', user: 'u' });
    assert.equal(r.final, 'pronto');
    assert.equal(r.trace.filter(e => e.type === 'tool').length, 1);
    assert.deepEqual(r.trace.find(e => e.type === 'tool')!.result, { got: 'oi' });
    assert.equal(r.usage.prompt_tokens, 20);
  });
  test('argumento inválido volta ao modelo como erro, sem executar', async () => {
    let ran = 0;
    const t = { ...echo, run: async () => { ran++; return {}; } };
    const r = await runAgent({ llm: scripted([call('echo', { y: 1 }), { role: 'assistant', content: 'ok' }]), tools: [t], system: 's', user: 'u' });
    assert.equal(ran, 0);
    assert.match(JSON.stringify(r.trace.find(e => e.type === 'tool')!.result), /obrigatório/);
  });
  test('ferramenta inexistente vira erro recuperável', async () => {
    const r = await runAgent({ llm: scripted([call('nao_existe', {}), { role: 'assistant', content: 'ok' }]), tools: [echo], system: 's', user: 'u' });
    assert.match(JSON.stringify(r.trace.find(e => e.type === 'tool')!.result), /desconhecida/);
  });
  test('JSON malformado nos argumentos vira erro recuperável', async () => {
    const bad = { role: 'assistant', content: null, tool_calls: [{ id: '1', type: 'function', function: { name: 'echo', arguments: '{x:' } }] };
    const r = await runAgent({ llm: scripted([bad, { role: 'assistant', content: 'ok' }]), tools: [echo], system: 's', user: 'u' });
    assert.match(JSON.stringify(r.trace.find(e => e.type === 'tool')!.result), /JSON/);
  });
  test('exceção da ferramenta não derruba o loop', async () => {
    const boom = { ...echo, run: async () => { throw new Error('PNCP fora'); } };
    const r = await runAgent({ llm: scripted([call('echo', { x: 'a' }), { role: 'assistant', content: 'escalado' }]), tools: [boom], system: 's', user: 'u' });
    assert.equal(r.final, 'escalado');
    assert.match(JSON.stringify(r.trace.find(e => e.type === 'tool')!.result), /PNCP fora/);
  });
  test('para no limite de passos', async () => {
    const loop = Array.from({ length: 10 }, (_, i) => call('echo', { x: String(i) }, 'c' + i));
    const r = await runAgent({ llm: scripted(loop), tools: [echo], system: 's', user: 'u', maxSteps: 3 });
    assert.equal(r.stopped, 'max_steps');
  });
  test('para no orçamento de tokens', async () => {
    const loop = Array.from({ length: 10 }, (_, i) => call('echo', { x: String(i) }, 'c' + i));
    const r = await runAgent({ llm: scripted(loop), tools: [echo], system: 's', user: 'u', maxTokens: 30 });
    assert.equal(r.stopped, 'budget');
  });
  test('ferramenta que exige aprovação é bloqueada sem aprovação', async () => {
    let sent = 0;
    const submit: Tool = { name: 'submit', description: '', requiresApproval: true, parameters: { type: 'object', required: ['approval_id'], properties: { approval_id: { type: 'string' } } }, run: async () => { sent++; return { ok: true }; } };
    const r = await runAgent({ llm: scripted([call('submit', { approval_id: 'inventado' }), { role: 'assistant', content: 'aguardando' }]), tools: [submit], system: 's', user: 'u', approvals: new Set() });
    assert.equal(sent, 0);
    assert.match(JSON.stringify(r.trace.find(e => e.type === 'tool')!.result), /aprovação/);
  });
  test('com aprovação válida, executa', async () => {
    let sent = 0;
    const submit: Tool = { name: 'submit', description: '', requiresApproval: true, parameters: { type: 'object', required: ['approval_id'], properties: { approval_id: { type: 'string' } } }, run: async () => { sent++; return { ok: true }; } };
    await runAgent({ llm: scripted([call('submit', { approval_id: 'ap-1' }), { role: 'assistant', content: 'enviado' }]), tools: [submit], system: 's', user: 'u', approvals: new Set(['ap-1']) });
    assert.equal(sent, 1);
  });
  test('resumo de resultado antigo só repete o que o JSON traz', () => {
    const lista = JSON.stringify({ total_itens: 46, filtrados: 2, pagina: 1, proxima_pagina: null, itens: [{ numero: 40, descricao: 'x'.repeat(400) }, { numero: 54, descricao: 'y'.repeat(400) }] });
    const resumo = resumirResultadoAntigo(lista);
    assert.match(resumo, /\[histórico compactado\]/);
    assert.match(resumo, /2 de 46 itens/);
    assert.match(resumo, /números 40, 54/);
    assert.ok(resumo.length < lista.length);
    assert.equal(resumo.includes('x'.repeat(50)), false);
    const edital = JSON.stringify({ caracteres_edital: 80000, trechos: [{ topico: 'ANVISA', trecho: 'z'.repeat(2000) }] });
    assert.match(resumirResultadoAntigo(edital), /edital de 80000 caracteres, 1 trecho; tópicos ANVISA/);
    assert.equal(resumirResultadoAntigo('{"aceito":true}'), '{"aceito":true}');
  });
  test('resultados antigos encolhem e o último passo chega inteiro ao modelo', async () => {
    const fat = { s: 'item '.repeat(800) };
    const big: Tool = { ...echo, run: async () => fat };
    const vistos: string[] = [];
    const llm: LLM = {
      model: 's',
      async chat(msgs) {
        vistos.push(msgs.filter(m => m.role === 'tool').map(m => m.content).join('\n'));
        const passo = vistos.length;
        if (passo < 4) return { message: call('echo', { x: String(passo) }, 'c' + passo), usage: { prompt_tokens: 1, completion_tokens: 1 }, ms: 1 };
        return { message: { role: 'assistant', content: 'ok' }, usage: { prompt_tokens: 1, completion_tokens: 1 }, ms: 1 };
      },
    };
    const r = await runAgent({ llm, tools: [big], system: 's', user: 'u', maxToolChars: 20_000 });
    assert.equal(vistos[2].includes('[histórico compactado]'), false);
    assert.equal(vistos[2].split(fat.s).length - 1, 2);
    assert.match(vistos[3], /\[histórico compactado\]/);
    assert.equal(vistos[3].split(fat.s).length - 1, 2);
    assert.ok(vistos[3].length < fat.s.length * 3);
    assert.equal((r.trace.find(e => e.type === 'tool')!.result as any).s, fat.s);
  });
  test('resultado grande é truncado para o modelo, mas íntegro no rastro', async () => {
    const big: Tool = { ...echo, run: async () => ({ s: 'x'.repeat(50_000) }) };
    let seen = 0;
    const llm: LLM = { model: 's', async chat(msgs) { const last = msgs.at(-1); if (last.role === 'tool') { seen = last.content.length; return { message: { role: 'assistant', content: 'ok' }, usage: { prompt_tokens: 1, completion_tokens: 1 }, ms: 1 }; } return { message: call('echo', { x: 'a' }), usage: { prompt_tokens: 1, completion_tokens: 1 }, ms: 1 }; } };
    const r = await runAgent({ llm, tools: [big], system: 's', user: 'u', maxToolChars: 4000 });
    assert.ok(seen <= 4100, String(seen));
    assert.equal((r.trace.find(e => e.type === 'tool')!.result as any).s.length, 50_000);
  });
});
