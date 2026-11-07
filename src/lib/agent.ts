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

/** Resume um resultado que o modelo já consumiu. Não inventa fato: só conta o que o JSON traz. */
export function resumirResultadoAntigo(content: string): string {
  const marca = '[histórico compactado]';
  let data: unknown;
  try { data = JSON.parse(content); }
  catch { return `${marca} ${content.slice(0, 180)}`; }
  if (!data || typeof data !== 'object') return `${marca} ${content.slice(0, 180)}`;
  const d = data as Record<string, any>;
  const partes = [marca];
  const erro = d.erro ?? d.error;
  if (typeof erro === 'string') partes.push(erro.slice(0, 160));
  if (typeof d.total_itens === 'number') {
    const nums = Array.isArray(d.itens) ? d.itens.map((i: any) => i?.numero).filter((n: unknown) => typeof n === 'number') : [];
    partes.push(`${d.filtrados ?? nums.length} de ${d.total_itens} itens, página ${d.pagina ?? '?'}`);
    if (nums.length) partes.push('números ' + nums.slice(0, 25).join(', '));
    if (d.proxima_pagina) partes.push(`próxima página ${d.proxima_pagina}`);
  }
  if (typeof d.caracteres_edital === 'number') {
    const topicos = Array.isArray(d.trechos) ? [...new Set(d.trechos.map((t: any) => t?.topico).filter(Boolean))] : [];
    const nTrechos = d.trechos?.length ?? 0;
    partes.push(`edital de ${d.caracteres_edital} caracteres, ${nTrechos} ${nTrechos === 1 ? 'trecho' : 'trechos'}`);
    if (topicos.length) partes.push('tópicos ' + topicos.slice(0, 8).join(', '));
  }
  if (typeof d.caracteres_descricao === 'number') partes.push(`descrição do item, offset ${d.offset ?? 0}, ${d.caracteres_descricao} caracteres${d.proximo_offset != null ? ', há continuação' : ''}`);
  if (typeof d.id === 'string' && d.ficha) partes.push(`ficha ${d.id}${typeof d.nome === 'string' ? ' ' + d.nome : ''}`);
  if (d.aceito === true) partes.push('aceito' + (typeof d.resultado === 'string' ? ` ${d.resultado}` : ''));
  if (d.aceito === false) partes.push('recusado');
  if (Array.isArray(d.lacunas) && d.lacunas.length) partes.push('lacunas: ' + d.lacunas.slice(0, 4).join(' | ').slice(0, 180));
  if (typeof d.estado === 'string') partes.push('estado ' + d.estado);
  if (partes.length === 1) partes.push(JSON.stringify(d).slice(0, 200));
  const texto = partes.join('; ');
  return texto.length < content.length ? texto : content;
}

/** Encolhe resultados anteriores aos dois últimos passos, para uma citação rejeitada ainda ter o texto. O rastro guarda o resultado inteiro. */
export function compactarHistorico(messages: any[], limite = 500, manter = 2): number {
  const grupos: number[][] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role !== 'tool') continue;
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.at(-1) === i - 1) ultimo.push(i);
    else grupos.push([i]);
  }
  if (grupos.length <= manter) return 0;
  let n = 0;
  for (const indice of grupos.slice(0, -manter).flat()) {
    const atual = messages[indice].content;
    if (typeof atual !== 'string' || atual.length <= limite || atual.startsWith('[histórico compactado]')) continue;
    messages[indice] = { ...messages[indice], content: resumirResultadoAntigo(atual) };
    n++;
  }
  return n;
}

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
    compactarHistorico(messages);
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
