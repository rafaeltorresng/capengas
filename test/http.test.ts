import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchJson } from '../src/lib/http.ts';

// Servidor local que reproduz as falhas observadas no PNCP: reset de conexão, 429, 5xx e lentidão.
let srv: Server; let base = '';
const hits = new Map<string, number>();
before(async () => {
  srv = createServer((req, res) => {
    const n = (hits.get(req.url!) ?? 0) + 1; hits.set(req.url!, n);
    if (req.url!.startsWith('/reset') && n < 3) return req.socket.destroy();
    if (req.url!.startsWith('/429') && n < 2) { res.writeHead(429, { 'retry-after': '0' }); return res.end(); }
    if (req.url!.startsWith('/500')) { res.writeHead(500); return res.end(); }
    if (req.url!.startsWith('/404')) { res.writeHead(404); return res.end('{}'); }
    if (req.url!.startsWith('/slow')) return setTimeout(() => res.end('{"ok":1}'), 2000);
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, n }));
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as any).port}`;
});
after(() => srv.close());

const opts = () => ({ retries: 3, baseDelayMs: 5, timeoutMs: 500, cacheDir: mkdtempSync(join(tmpdir(), 'c-')) });

describe('fetchJson', () => {
  test('recupera de reset de conexão', async () => {
    const r = await fetchJson(base + '/reset', opts());
    assert.equal(r.data.ok, true); assert.equal(r.attempts, 3);
  });
  test('respeita 429 e tenta de novo', async () => {
    const r = await fetchJson(base + '/429', opts());
    assert.equal(r.data.ok, true); assert.equal(r.attempts, 2);
  });
  test('desiste após N tentativas com erro claro', async () => {
    await assert.rejects(fetchJson(base + '/500', opts()), /HTTP 500 após 4 tentativas/);
  });
  test('404 não é re-tentado', async () => {
    await assert.rejects(fetchJson(base + '/404', opts()), (e: any) => e.status === 404 && e.attempts === 1);
  });
  test('timeout vira erro re-tentável', async () => {
    await assert.rejects(fetchJson(base + '/slow', { ...opts(), retries: 1 }), /timeout|abort/i);
  });
  test('cache: segunda chamada não vai à rede', async () => {
    const o = opts();
    const a = await fetchJson(base + '/ok-cache', o);
    const b = await fetchJson(base + '/ok-cache', o);
    assert.equal(a.fromCache, false); assert.equal(b.fromCache, true);
    assert.equal(hits.get('/ok-cache'), 1);
  });
  test('cache vencido serve de fallback quando a rede falha', async () => {
    const o = { ...opts(), ttlMs: 0 };
    await fetchJson(base + '/ok-stale', o);
    const r = await fetchJson(base + '/500', { ...o, cacheKey: base + '/ok-stale', allowStale: true });
    assert.equal(r.fromCache, true); assert.equal(r.stale, true);
  });
});
