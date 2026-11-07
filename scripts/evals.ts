import './_out.ts';
// Evals com o modelo REAL (Featherless). Uso: node scripts/evals.ts [modelo] [repeticoes]
import { readFileSync, writeFileSync } from 'node:fs';
import { featherless } from '../src/lib/llm.ts';
import { runAgent } from '../src/lib/agent.ts';
import { tools, newState } from '../src/lib/tools.ts';
import { pncp } from '../src/lib/data.ts';

const model = process.argv[2] ?? 'moonshotai/Kimi-K2.6';
const reps = Number(process.argv[3] ?? 3);
const gold = JSON.parse(readFileSync('fixtures/gold.json', 'utf8'));
const company = JSON.parse(readFileSync('fixtures/company.json', 'utf8'));
const cov = JSON.parse(readFileSync('fixtures/coverage.json', 'utf8'));
const llm = featherless(model);
const pick = (names: string[]) => tools.filter(t => names.includes(t.name));
const NOW = new Date('2026-11-07T10:00:00-03:00');
const state = () => { const s = newState(company, 'http://127.0.0.1:9', NOW); for (const c of cov) s.tenders[`${c.cnpj}/${c.ano}/${c.seq}`] = c; return s; };
const results: any = { model, reps, startedAt: new Date().toISOString(), extract: [], fit: [], code_match: [] };
const save = () => writeFileSync(`out/evals-${model.replace('/', '_')}.json`, JSON.stringify(results, null, 1));
const stat = (r: any) => ({ ms: Math.round(r.ms), tokens_in: r.usage.prompt_tokens, tokens_out: r.usage.completion_tokens, usd: r.usage.cost, steps: r.trace.filter((e: any) => e.type === 'llm').length, stopped: r.stopped, tool_errors: r.trace.filter((e: any) => e.type === 'tool' && (e.error || e.result?.aceito === false)).length });

const SYS = 'Você é o Lance, analista de licitações de uma distribuidora de produtos para saúde. Use as ferramentas; nunca invente dados. Citações devem ser cópias literais. Responda em português.';

// E1: exigências do edital com citação conferida.
for (const g of gold.extract) for (let i = 0; i < reps; i++) {
  const s = state();
  try {
    const r = await runAgent({ llm, tools: pick(['read_edital', 'record_requirement']), system: SYS, maxSteps: 14, state: s as any,
      user: `Leia o edital do pregão ${g.tender} e registre com record_requirement, com citação literal, cada uma destas exigências SE existir: registro_anvisa (registro/notificação do produto na ANVISA), afe (Autorização de Funcionamento da empresa), marca_referencia (indicação de marca de referência), prazo_esclarecimento (prazo para pedir esclarecimento). Ao final responda só um JSON: {"registro_anvisa": true|false|"parcial", "afe": true|false, "marca_referencia": true|false, "prazo_esclarecimento": "texto curto"}.` });
    let ans: any = null; try { ans = JSON.parse((r.final ?? '').match(/\{[\s\S]*\}/)?.[0] ?? 'null'); } catch {}
    const accepted = s.requirements.map(x => x.requirement);
    const correct = ans ? Object.entries(g.gold).filter(([k, v]) => ans[k] === v).length : 0;
    results.extract.push({ tender: g.tender, run: i, answer: ans, gold: g.gold, correct, of: Object.keys(g.gold).length, accepted_quotes: accepted, ...stat(r) });
  } catch (e: any) { results.extract.push({ tender: g.tender, run: i, error: e.message }); }
  save(); console.log('extract', g.tender, i, JSON.stringify(results.extract.at(-1)).slice(0, 220));
}

// E2: encaixe técnico atributo a atributo.
for (const g of gold.fit) for (let i = 0; i < reps; i++) {
  const s = state();
  try {
    const r = await runAgent({ llm, tools: pick(['get_tender_items', 'get_tender_item', 'get_product_sheet', 'record_fit']), system: SYS, maxSteps: 10, state: s as any,
      user: `Compare o item ${g.item} do pregão ${g.tender} com o produto ${g.product} do catálogo, atributo a atributo. Use get_tender_items com keywords se precisar e get_product_sheet. Registre com record_fit (citações literais; use nao_informado quando a ficha não diz). Se o produto for de outro tipo, registre o atributo "tipo de produto" como nao_atende. Termine com uma frase de conclusão.` });
    const fit = s.fits[`${g.tender}#${g.item}`]?.overall ?? null;
    results.fit.push({ id: g.id, run: i, verdict: fit, accept: g.accept, ok: g.accept.includes(fit), ...stat(r) });
  } catch (e: any) { results.fit.push({ id: g.id, run: i, error: e.message }); }
  save(); console.log('fit', g.id, i, JSON.stringify(results.fit.at(-1)).slice(0, 200));
}

// E3: o código de catálogo do item corresponde ao que o órgão descreveu?
for (const g of gold.code_match) for (let i = 0; i < reps; i++) {
  const [cnpj, ano, seq] = g.tender.split('/');
  const it = (await pncp.items(cnpj, +ano, +seq)).find(x => x.numero === g.item)!;
  try {
    const r = await runAgent({ llm, tools: [], system: SYS, maxSteps: 1,
      user: `No PNCP, a descrição de um item costuma ser: texto padrão do código CATMAT + texto livre do órgão. Abaixo está a descrição completa do item (código ${it.catalogCode}). Decida se o texto livre do órgão descreve o mesmo produto do texto do código. Responda só JSON {"veredito":"corresponde"|"variante_diferente"|"produto_diferente","motivo":"..."}.\n\nDESCRIÇÃO: ${it.descricao.slice(0, 1500)}` });
    let ans: any = null; try { ans = JSON.parse((r.final ?? '').match(/\{[\s\S]*\}/)?.[0] ?? 'null'); } catch {}
    results.code_match.push({ tender: g.tender, item: g.item, run: i, verdict: ans?.veredito, accept: g.accept, ok: g.accept.includes(ans?.veredito), motivo: ans?.motivo, ...stat(r) });
  } catch (e: any) { results.code_match.push({ tender: g.tender, item: g.item, run: i, error: e.message }); }
  save(); console.log('code', g.tender, g.item, i, JSON.stringify(results.code_match.at(-1)).slice(0, 200));
}
// E4: o modelo reescreve o texto livre do órgão em consulta estilo CATMAT; medimos recall@8 da busca local.
{
  const { catmat } = await import('../src/lib/data.ts');
  const ret = JSON.parse(readFileSync('out/eval-retrieval.json', 'utf8')).res.filter((x: any) => x.so_orgao);
  const coded = JSON.parse(readFileSync('fixtures/coded-items.json', 'utf8'));
  const cat = new Map<number, any>(JSON.parse(readFileSync('data/catmat65.json', 'utf8')).map((r: any) => [r.code, r]));
  const tk = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  results.rewrite = [];
  const sample = ret.filter((_: any, i: number) => i % Math.max(1, Math.floor(ret.length / 25)) === 0).slice(0, 25);
  for (const x of sample) {
    const it = coded.find((c: any) => c.catalogCode === x.code); const c = cat.get(x.code);
    const words = tk(it.descricao); const ct = new Set(tk(c.desc)); let k = 0; while (k < words.length && ct.has(words[k])) k++;
    const orgao = words.slice(k).join(' ');
    try {
      const r = await runAgent({ llm, tools: [], system: SYS, maxSteps: 1, user: `Reescreva a descrição livre de um item de licitação de saúde como consulta no estilo do catálogo CATMAT: comece pelo nome padrão do produto (PDM, ex.: "CATETER INTRAVENOSO", "LUVA PARA PROCEDIMENTO") seguido dos atributos principais. Responda só a consulta, sem explicação.\n\nDESCRIÇÃO: ${orgao.slice(0, 800)}` });
      const q = (r.final ?? '').trim();
      const hits = catmat.search(q, 8);
      results.rewrite.push({ code: x.code, query: q.slice(0, 200), at8: hits.some((h: any) => h.code === x.code), pdm8: hits.some((h: any) => cat.get(h.code)?.pdm === c.pdm), baseline_at8: x.so_orgao.at8, baseline_pdm8: x.so_orgao.pdm8, ...stat(r) });
    } catch (e: any) { results.rewrite.push({ code: x.code, error: e.message }); }
    save();
  }
  const rw = results.rewrite.filter((x: any) => !x.error); const pc = (f: string) => `${rw.filter((x: any) => x[f]).length}/${rw.length}`;
  console.log('rewrite at8', pc('at8'), 'pdm8', pc('pdm8'), '| baseline at8', pc('baseline_at8'), 'pdm8', pc('baseline_pdm8'));
}
results.finishedAt = new Date().toISOString(); save();
const acc = (a: any[]) => `${a.filter(x => x.ok).length}/${a.length}`;
console.log('RESUMO', model, 'extract campos', results.extract.reduce((s: number, x: any) => s + (x.correct ?? 0), 0) + '/' + results.extract.reduce((s: number, x: any) => s + (x.of ?? 3), 0), 'fit', acc(results.fit), 'code', acc(results.code_match));
