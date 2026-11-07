import './_out.ts';
// Eval sem LLM: a busca local no CATMAT recupera o código certo a partir do texto livre do órgão?
import { readFileSync, writeFileSync } from 'node:fs';
import { catmat } from '../src/lib/data.ts';
const cat = new Map<number, any>(JSON.parse(readFileSync('data/catmat65.json', 'utf8')).map((r: any) => [r.code, r]));
const items = JSON.parse(readFileSync('fixtures/coded-items.json', 'utf8')).filter((i: any) => cat.has(i.catalogCode));
const tk = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
const res: any[] = [];
for (const it of items) {
  const c = cat.get(it.catalogCode); const ct = new Set(tk(c.desc));
  const words = tk(it.descricao); let k = 0; while (k < words.length && ct.has(words[k])) k++;
  const orgao = words.slice(k).join(' ');
  const row: any = { code: it.catalogCode, pdm: c.pdm, orgaoTokens: words.length - k };
  for (const [name, q] of [['completa', it.descricao], ['so_orgao', orgao]] as const) {
    if (name === 'so_orgao' && words.length - k < 3) { row[name] = null; continue; }
    const hits = catmat.search(q, 8);
    row[name] = { at1: hits[0]?.code === it.catalogCode, at8: hits.some(h => h.code === it.catalogCode), pdm8: hits.some(h => cat.get(h.code)?.pdm === c.pdm) };
  }
  res.push(row);
}
const agg = (name: string) => { const r = res.filter(x => x[name]); const p = (f: string) => `${(100 * r.filter(x => x[name][f]).length / r.length).toFixed(0)}%`; return { n: r.length, recall_at1: p('at1'), recall_at8: p('at8'), mesmo_pdm_at8: p('pdm8') }; };
const out = { itens_grupo65: items.length, completa: agg('completa'), so_orgao: agg('so_orgao') };
writeFileSync('out/eval-retrieval.json', JSON.stringify({ out, res }, null, 1));
console.log(JSON.stringify(out, null, 1));
