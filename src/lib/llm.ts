// Cliente de chat compatível com OpenAI (Featherless). Sem SDK: fetch, retry em 429/5xx, uso e latência.
import type { LLM } from './agent.ts';

export function openaiCompatible(o: { baseURL: string; apiKey: string; model: string; temperature?: number; maxTokens?: number; retries?: number; baseDelayMs?: number; timeoutMs?: number }): LLM {
  if (!o.apiKey) throw new Error('FEATHERLESS_API_KEY, AI_API_KEY ou Api_key ausente no ambiente; veja .env.example');
  const { retries = 4, baseDelayMs = 1500, timeoutMs = 180_000 } = o;
  return {
    model: o.model,
    async chat(messages, tools) {
      const body = JSON.stringify({ model: o.model, messages, ...(tools.length ? { tools, tool_choice: 'auto' } : {}), temperature: o.temperature ?? 0.1, max_tokens: o.maxTokens ?? 4096 });
      let last = '';
      for (let a = 0; a <= retries; a++) {
        const t0 = performance.now();
        try {
          const res = await fetch(`${o.baseURL}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` }, body, signal: AbortSignal.timeout(timeoutMs) });
          const text = await res.text();
          if (res.ok) {
            const j = JSON.parse(text);
            return { message: j.choices?.[0]?.message ?? { role: 'assistant', content: '' }, usage: j.usage ?? { prompt_tokens: 0, completion_tokens: 0 }, ms: performance.now() - t0 };
          }
          last = `HTTP ${res.status}: ${text.slice(0, 300)}`;
          if (![429, 500, 502, 503, 504].includes(res.status)) break;
          const ra = Number(res.headers.get('retry-after'));
          await new Promise(r => setTimeout(r, ra > 0 ? ra * 1000 : baseDelayMs * 2 ** a));
        } catch (e: any) {
          last = e?.name === 'TimeoutError' ? 'timeout' : String(e?.cause?.code ?? e?.message ?? e);
          await new Promise(r => setTimeout(r, baseDelayMs * 2 ** a));
        }
      }
      throw new Error(`LLM falhou (${o.model}): ${last}`);
    },
  };
}

export function featherless(model = process.env.LANCE_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash', options: { maxTokens?: number } = {}) {
  return openaiCompatible({ baseURL: process.env.FEATHERLESS_BASE_URL ?? 'https://api.featherless.ai/v1', apiKey: process.env.FEATHERLESS_API_KEY || process.env.AI_API_KEY || process.env.Api_key || '', model, maxTokens: options.maxTokens });
}
