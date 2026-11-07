// Cliente HTTP com retry, backoff, timeout e cache em disco.
// O PNCP reseta conexões e devolve 429 de forma intermitente; o cache é a rede de segurança da demo.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type FetchOpts = {
  retries?: number; baseDelayMs?: number; timeoutMs?: number;
  cacheDir?: string; ttlMs?: number; cacheKey?: string; allowStale?: boolean;
  init?: RequestInit; raw?: boolean;
};
export class HttpError extends Error {
  status: number | null; attempts: number;
  constructor(msg: string, status: number | null, attempts: number) { super(msg); this.status = status; this.attempts = attempts; }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// Backoff exponencial com jitter, limitado a 8 s.
const backoff = (base: number, attempt: number) => Math.min(8000, base * 2 ** (attempt - 1)) * (0.5 + Math.random());
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

function cachePath(dir: string, key: string) {
  return join(dir, createHash('sha256').update(key).digest('hex').slice(0, 32) + '.bin');
}

export async function fetchJson(url: string, o: FetchOpts = {}) {
  const { retries = 4, baseDelayMs = 500, timeoutMs = 30000, cacheDir, ttlMs = 6 * 3600e3, allowStale = true } = o;
  const key = o.cacheKey ?? url;
  const cp = cacheDir ? cachePath(cacheDir, key) : null;
  if (cp && existsSync(cp) && Date.now() - statSync(cp).mtimeMs <= ttlMs && ttlMs > 0) {
    const buf = readFileSync(cp);
    return { data: o.raw ? buf : JSON.parse(buf.toString('utf8')), fromCache: true, stale: false, attempts: 0, ms: 0 };
  }
  // Modo offline da demo (LANCE_OFFLINE=1): serve o cache mesmo vencido e nunca vai à rede.
  // Leituras "frescas" (allowStale: false, usadas no recheque) falham, e o recheque bloqueia como fonte indisponível.
  if (process.env.LANCE_OFFLINE === '1') {
    if (cp && allowStale && existsSync(cp)) {
      const buf = readFileSync(cp);
      return { data: o.raw ? buf : JSON.parse(buf.toString('utf8')), fromCache: true, stale: true, attempts: 0, ms: 0 };
    }
    throw new HttpError(`offline (LANCE_OFFLINE=1) e sem cache: ${url}`, null, 0);
  }
  let lastErr: HttpError | null = null;
  const t0 = performance.now();
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      const res = await fetch(url, { ...o.init, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) {
        lastErr = new HttpError(`HTTP ${res.status} após ${attempt} tentativas: ${url}`, res.status, attempt);
        if (!RETRYABLE.has(res.status)) throw lastErr;
        const ra = Number(res.headers.get('retry-after'));
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoff(baseDelayMs, attempt));
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (cp) { mkdirSync(cacheDir!, { recursive: true }); writeFileSync(cp, buf); }
      return { data: o.raw ? buf : JSON.parse(buf.toString('utf8')), fromCache: false, stale: false, attempts: attempt, ms: performance.now() - t0 };
    } catch (e: any) {
      if (e instanceof HttpError && !RETRYABLE.has(e.status!)) throw e;
      const msg = e?.name === 'TimeoutError' ? 'timeout' : (e?.cause?.code ?? e?.message ?? String(e));
      lastErr = e instanceof HttpError ? e : new HttpError(`${msg} após ${attempt} tentativas: ${url}`, null, attempt);
      if (attempt <= retries) await sleep(backoff(baseDelayMs, attempt));
    }
  }
  if (cp && allowStale && existsSync(cp)) {
    const buf = readFileSync(cp);
    return { data: o.raw ? buf : JSON.parse(buf.toString('utf8')), fromCache: true, stale: true, attempts: retries + 1, ms: performance.now() - t0 };
  }
  throw lastErr!;
}
