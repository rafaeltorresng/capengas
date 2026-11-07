// Loop de agente próprio: um único agente, ferramentas tipadas, rastro completo, limites e portão de aprovação.
import { validate, type Schema } from './schema.ts';

export type Usage = { prompt_tokens: number; completion_tokens: number; cost?: number };
export type LLM = { model: string; chat(messages: any[], tools: any[]): Promise<{ message: any; usage: Usage; ms: number }> };
export type Ctx = { approvals: Set<string>; state: Record<string, any> };
export type Tool = { name: string; description: string; parameters: Schema; requiresApproval?: boolean; run(args: any, ctx: Ctx): Promise<unknown> };
export type TraceEvent = { t: number; type: 'llm' | 'tool' | 'stop'; name?: string; args?: unknown; result?: unknown; ms: number; usage?: Usage; error?: boolean; text?: string };

export type RunOpts = {
  llm: LLM; tools: Tool[]; system: string; user: string;
  maxSteps?: number; maxTokens?: number; maxToolChars?: number;
  approvals?: Set<string>; state?: Record<string, any>; onEvent?: (e: TraceEvent) => void;
  history?: any[];
};

const truncate = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n) + `…[truncado: ${s.length - n} caracteres omitidos]`);

export async function runAgent(o: RunOpts) {
  const { llm, tools, maxSteps = 30, maxTokens = 400_000, maxToolChars = 12_000 } = o;
  const ctx: Ctx = { approvals: o.approvals ?? new Set(), state: o.state ?? {} };
  const byName = new Map(tools.map(t => [t.name, t]));
  const schemas = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
  const messages: any[] = o.history ?? [{ role: 'system', content: o.system }, { role: 'user', content: o.user }];
  const trace: TraceEvent[] = [];
  const usage: Usage = { prompt_tokens: 0, completion_tokens: 0, cost: 0 };
  const t0 = performance.now();
  const emit = (e: TraceEvent) => { trace.push(e); o.onEvent?.(e); };
  let stopped: 'final' | 'max_steps' | 'budget' = 'max_steps';
  let final: string | null = null;

  for (let step = 0; step < maxSteps; step++) {
    const r = await llm.chat(messages, schemas);
    usage.prompt_tokens += r.usage.prompt_tokens ?? 0;
    usage.completion_tokens += r.usage.completion_tokens ?? 0;
    usage.cost = (usage.cost ?? 0) + (r.usage.cost ?? 0);
    const m = r.message;
    emit({ t: performance.now() - t0, type: 'llm', ms: r.ms, usage: r.usage, text: m.content ?? undefined });
    messages.push({ role: 'assistant', content: m.content ?? null, ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) });
    if (!m.tool_calls?.length) { stopped = 'final'; final = m.content ?? ''; break; }

    for (const tc of m.tool_calls) {
      const ts = performance.now();
      const name = tc.function?.name;
      let args: any = null; let result: unknown; let error = false;
      const tool = byName.get(name);
      try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { result = { error: 'argumentos não são JSON válido' }; error = true; }
      if (!error && !tool) { result = { error: `ferramenta desconhecida: ${name}` }; error = true; }
      if (!error && tool) {
        const errs = validate(tool.parameters, args);
        if (errs.length) { result = { error: 'argumentos inválidos', detalhes: errs }; error = true; }
        else if (tool.requiresApproval && !ctx.approvals.has(String(args.approval_id))) {
          result = { error: 'ação bloqueada: requer aprovação humana válida (approval_id)' }; error = true;
        } else {
          try { result = await tool.run(args, ctx); }
          catch (e: any) { result = { error: `falha na ferramenta: ${e?.message ?? e}` }; error = true; }
        }
      }
      emit({ t: performance.now() - t0, type: 'tool', name, args, result, ms: performance.now() - ts, error });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: truncate(JSON.stringify(result), maxToolChars) });
    }
    if (usage.prompt_tokens + usage.completion_tokens >= maxTokens) { stopped = 'budget'; break; }
  }
  emit({ t: performance.now() - t0, type: 'stop', ms: 0, text: stopped });
  return { final, stopped, trace, usage, messages, ms: performance.now() - t0, state: ctx.state };
}
