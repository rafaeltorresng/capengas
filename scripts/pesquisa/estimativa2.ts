import '../_out.ts';
// Itens do Compras.gov.br (Lei 14.133) publicados em mar–abr/2026, já concluídos.
// Mede: taxa de fracasso/deserto; estimativa do órgão vs mediana histórica; estimativa vs preço homologado.
import { writeFileSync } from 'node:fs';
import { fetchJson } from '../../src/lib/http.ts';
import { compras } from '../../src/lib/data.ts';
import { priceStats } from '../../src/lib/rules.ts';
const http = (u: string) => fetchJson(u, { cacheDir: 'cache', retries: 6, baseDelayMs: 1000, timeoutMs: 30000, ttlMs: 7 * 86400e3 });
const CLASSES: Record<string, number> = { 'saude_6515_instrumentos_material': 6515, 'saude_6510_cirurgico_curativos': 6510, 'controle_7510_escritorio': 7510 };
const items: any[] = [];
for (const [name, cls] of Object.entries(CLASSES)) {
  for (const [ini, fim] of [['2026-04-01', '2026-04-30']]) {
    for (let p = 1; p <= 6; p++) {
      const { data } = await http(`https://dadosabertos.compras.gov.br/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133?pagina=${p}&tamanhoPagina=500&codigoClasse=${cls}&dataInclusaoPncpInicial=${ini}&dataInclusaoPncpFinal=${fim}`);
      for (const i of data.resultado ?? []) items.push({ cls: name, code: i.codItemCatalogo, est: i.valorUnitarioEstimado, res: i.valorUnitarioResultado, sit: i.situacaoCompraItemNome, sigiloso: i.orcamentoSigiloso, ben: i.tipoBeneficioNome });
      console.log(name, ini, 'página', p, 'restantes', data.paginasRestantes);
      if (!data.paginasRestantes) break;
    }
  }
  console.log(name, 'itens', items.filter(i => i.cls === name).length);
}
const rates: any = {};
for (const name of Object.keys(CLASSES)) {
  const a = items.filter(i => i.cls === name && i.sit !== 'Em andamento');
  const c = (s: string) => a.filter(i => i.sit === s).length;
  rates[name] = { concluidos: a.length, em_andamento: items.filter(i => i.cls === name && i.sit === 'Em andamento').length, homologado: c('Homologado'), fracassado: c('Fracassado'), deserto: c('Deserto'), cancelado: c('Anulado/Revogado/Cancelado') };
  const r = rates[name]; console.log(name, `concluídos ${r.concluidos} | fracassado ${(100 * r.fracassado / r.concluidos).toFixed(1)}% deserto ${(100 * r.deserto / r.concluidos).toFixed(1)}% | em andamento ${r.em_andamento}`);
}
// Amostra para estimativa vs mercado (limita chamadas de preço).
const conc = items.filter(i => i.sit !== 'Em andamento' && i.sit !== 'Anulado/Revogado/Cancelado' && i.est > 0 && i.code);
const codes = [...new Set(conc.map(i => i.code))];
const sample = codes.sort(() => Math.random() - 0.5).slice(0, 300);
const st = new Map<number, any>(); let k = 0;
for (const c of sample) { try { st.set(c, priceStats(await compras.priceHistory(c))); } catch {} if (++k % 100 === 0) console.log('preços', k); }
const rows = conc.filter(i => st.get(i.code)?.n >= 5).map(i => ({ ...i, med: st.get(i.code).median, ratio: i.est / st.get(i.code).median }));
const bucket = (x: number) => x < 0.5 ? 'a) < 50% da mediana' : x < 0.8 ? 'b) 50–80%' : x <= 1.25 ? 'c) 80–125%' : x <= 2 ? 'd) 125–200%' : 'e) > 200%';
const agg: any = {};
for (const r of rows) { const b = `${r.cls.startsWith('saude') ? 'saude' : 'controle'} ${bucket(r.ratio)}`; agg[b] ??= { n: 0, fail: 0 }; agg[b].n++; if (r.sit === 'Fracassado' || r.sit === 'Deserto') agg[b].fail++; }
console.log('\nestimativa vs mediana histórica (itens com ≥5 compras no histórico):', rows.length);
for (const b of Object.keys(agg).sort()) console.log(`${b.padEnd(32)} itens ${String(agg[b].n).padStart(5)}  falha ${(100 * agg[b].fail / agg[b].n).toFixed(1)}%`);
// Estimativa vs preço homologado do próprio item.
const hom = items.filter(i => i.sit === 'Homologado' && i.est > 0 && i.res > 0);
for (const g of ['saude', 'controle']) {
  const h = hom.filter(i => i.cls.startsWith(g)).map(i => i.res / i.est).sort((a, b) => a - b);
  const q = (p: number) => h[Math.floor(p * (h.length - 1))];
  console.log(`${g}: homologado/estimado — n ${h.length}, mediana ${q(0.5)?.toFixed(2)}, p10 ${q(0.1)?.toFixed(2)}, p90 ${q(0.9)?.toFixed(2)}, itens homologados acima do estimado ${(100 * h.filter(x => x > 1.001).length / h.length).toFixed(1)}%`);
}
writeFileSync('out/estimativa2.json', JSON.stringify({ rates, agg, n_rows: rows.length }, null, 1));
