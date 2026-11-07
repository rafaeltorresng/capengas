import '../_out.ts';
// Backtest sem LLM, com histórico "congelado" antes da publicação (sem ver o futuro).
// Itens de saúde do Compras.gov.br publicados em abril/2026, já concluídos.
import { writeFileSync } from 'node:fs';
import { fetchJson } from '../../src/lib/http.ts';
const http = (u: string) => fetchJson(u, { cacheDir: 'cache', retries: 5, baseDelayMs: 1000, timeoutMs: 60000, ttlMs: 7 * 86400e3 });
const items: any[] = [];
for (const cls of [6515, 6510]) for (let p = 1; p <= 6; p++) {
  const { data } = await http(`https://dadosabertos.compras.gov.br/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133?pagina=${p}&tamanhoPagina=500&codigoClasse=${cls}&dataInclusaoPncpInicial=2026-04-01&dataInclusaoPncpFinal=2026-04-30`);
  for (const i of data.resultado ?? []) if (['Homologado', 'Fracassado', 'Deserto'].includes(i.situacaoCompraItemNome) && i.codItemCatalogo && i.valorUnitarioEstimado > 0 && !i.orcamentoSigiloso)
    items.push({ code: i.codItemCatalogo, est: i.valorUnitarioEstimado, res: i.valorUnitarioResultado, sit: i.situacaoCompraItemNome, pub: i.dataInclusaoPncp.slice(0, 10) });
  if (!data.paginasRestantes) break;
}
const codes = [...new Set(items.map(i => i.code))].sort(() => Math.random() - 0.5).slice(0, 350);
const hist = new Map<number, number[]>(); let k = 0;
for (const c of codes) {
  try {
    // Histórico só com compras até 31/03/2026 (antes de qualquer item da amostra).
    const { data } = await http(`https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial?pagina=1&tamanhoPagina=100&tipo=codigoItemCatalogo&codigo=${c}&dataCompraInicio=2025-04-01&dataCompraFim=2026-03-31`);
    hist.set(c, (data.resultado ?? []).map((r: any) => Number(r.precoUnitario)).filter((x: number) => x > 0).sort((a: number, b: number) => a - b));
  } catch {}
  if (++k % 50 === 0) console.log('histórico', k, '/', codes.length);
}
const q = (a: number[], p: number) => { const i = (a.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); };
const rows = items.filter(i => (hist.get(i.code)?.length ?? 0) >= 5).map(i => { const h = hist.get(i.code)!; return { ...i, med: q(h, 0.5), p25: q(h, 0.25), n: h.length }; });
const fail = (r: any) => r.sit !== 'Homologado';
const rate = (a: any[]) => a.length ? a.filter(fail).length / a.length : NaN;
console.log('\nitens concluídos com código e estimativa:', items.length, '| com histórico ≥5 compras antes de abril:', rows.length);
console.log('taxa de fracasso geral:', (100 * rate(rows)).toFixed(1) + '%');
for (const thr of [0.6, 0.8, 1.0]) {
  const f = rows.filter(r => r.est < thr * r.med), nf = rows.filter(r => r.est >= thr * r.med);
  const tp = f.filter(fail).length, allFail = rows.filter(fail).length;
  console.log(`regra "estimativa < ${thr * 100}% da mediana": marcados ${f.length} (fracasso ${(100 * rate(f)).toFixed(1)}%) vs não marcados ${nf.length} (fracasso ${(100 * rate(nf)).toFixed(1)}%) | lift ${(rate(f) / rate(nf)).toFixed(2)}x | pega ${(100 * tp / allFail).toFixed(0)}% dos fracassos | descarta ${f.length - tp} itens que deram certo`);
}
const hom = rows.filter(r => r.sit === 'Homologado' && r.res > 0);
const mape = (pred: (r: any) => number) => { const e = hom.map(r => Math.abs(pred(r) - r.res) / r.res).sort((a, b) => a - b); return { mediana: q(e, 0.5), p75: q(e, 0.75) }; };
const fmt = (x: any) => `erro mediano ${(100 * x.mediana).toFixed(0)}% (p75 ${(100 * x.p75).toFixed(0)}%)`;
console.log(`\npreço vencedor (${hom.length} itens homologados):`);
console.log('  estimativa do órgão  →', fmt(mape(r => r.est)));
console.log('  mediana histórica    →', fmt(mape(r => r.med)));
console.log('  p25 histórico        →', fmt(mape(r => r.p25)));
console.log('  0,78 × estimativa    →', fmt(mape(r => 0.78 * r.est)), '(linha de base ingênua)');
writeFileSync('out/backtest.json', JSON.stringify({ n_items: items.length, n_rows: rows.length, rows }, null, 1));
