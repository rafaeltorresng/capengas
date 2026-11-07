import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { featherless, openaiCompatible } from '../src/lib/llm.ts';

let srv: Server; let base = ''; const seen: any[] = []; let fail429 = 1;
before(async () => {
  srv = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    seen.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
    if (fail429-- > 0) { res.writeHead(429, { 'retry-after': '0' }); return res.end('{}'); }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'oi' } }], usage: { prompt_tokens: 7, completion_tokens: 2 } }));
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as any).port}/v1`;
});
after(() => srv.close());

describe('openaiCompatible', () => {
  test('envia modelo, ferramentas e auth; re-tenta 429; devolve uso e latência', async () => {
    const llm = openaiCompatible({ baseURL: base, apiKey: 'k-test', model: 'm1', baseDelayMs: 1 });
    const r = await llm.chat([{ role: 'user', content: 'x' }], [{ type: 'function', function: { name: 'f', parameters: {} } }]);
    assert.equal(r.message.content, 'oi');
    assert.equal(r.usage.prompt_tokens, 7);
    assert.ok(r.ms >= 0);
    assert.equal(seen.length, 2);
    assert.equal(seen[1].url, '/v1/chat/completions');
    assert.equal(seen[1].auth, 'Bearer k-test');
    assert.equal(seen[1].body.model, 'm1');
    assert.equal(seen[1].body.tools.length, 1);
  });
  test('sem chave falha cedo com mensagem clara', () => {
    assert.throws(() => openaiCompatible({ baseURL: base, apiKey: '', model: 'm' }), /FEATHERLESS_API_KEY/);
  });
});

test('featherless aceita a chave Api_key usada no .env do hackathon', async () => {
  const names = ['FEATHERLESS_API_KEY', 'AI_API_KEY', 'Api_key', 'FEATHERLESS_BASE_URL'] as const;
  const previous = names.map(name => process.env[name]);
  try {
    delete process.env.FEATHERLESS_API_KEY;
    process.env.AI_API_KEY = '';
    process.env.Api_key = 'chave-ficticia';
    process.env.FEATHERLESS_BASE_URL = base;
    await featherless('m2').chat([{ role: 'user', content: 'x' }], []);
    assert.equal(seen.at(-1).auth, 'Bearer chave-ficticia');
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});