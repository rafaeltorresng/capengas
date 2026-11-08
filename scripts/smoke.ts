import './_out.ts';
// Smoke test: autenticação, latência, tool calling.
import { featherless } from '../src/lib/llm.ts';
for (const model of (process.argv[2] ?? 'deepseek-ai/DeepSeek-V4.1-Flash').split(',')) {
  const llm = featherless(model);
  const t0 = performance.now();
  try {
    const r = await llm.chat([{ role: 'user', content: 'Qual o registro ANVISA do produto P1? Use a ferramenta.' }],
      [{ type: 'function', function: { name: 'check_anvisa', description: 'consulta registro', parameters: { type: 'object', required: ['product_id'], properties: { product_id: { type: 'string' } } } } }]);
    const tc = r.message.tool_calls?.[0];
    console.log(model, `${Math.round(performance.now() - t0)}ms`, 'tool_call:', tc ? `${tc.function.name}(${tc.function.arguments})` : 'NENHUMA', '| texto:', (r.message.content ?? '').slice(0, 80), '| uso:', JSON.stringify(r.usage));
  } catch (e: any) { console.log(model, 'ERRO', e.message.slice(0, 200)); }
}
