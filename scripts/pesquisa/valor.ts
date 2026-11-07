import '../_out.ts';
// Valor (R$) dos itens por situação, classes de saúde, abril/2026 (amostra em cache) + total do mês.
import { fetchJson } from '../../src/lib/http.ts';
const http = (u: string) => fetchJson(u, { cacheDir: 'cache', retries: 4, baseDelayMs: 1000, timeoutMs: 60000, ttlMs: 7 * 86400e3 });
for (const cls of [6515, 6510]) {
  const agg: Record<string, { n: number; v: number }> = {}; let total = 0;
  for (let p = 1; p <= 6; p++) {
    const { data } = await http(`https://dadosabertos.compras.gov.br/modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133?pagina=${p}&tamanhoPagina=500&codigoClasse=${cls}&dataInclusaoPncpInicial=2026-04-01&dataInclusaoPncpFinal=2026-04-30`);
    total = data.totalRegistros;
    for (const i of data.resultado ?? []) { const s = i.situacaoCompraItemNome; agg[s] ??= { n: 0, v: 0 }; agg[s].n++; agg[s].v += Number(i.valorTotal) || 0; }
    if (!data.paginasRestantes) break;
  }
  const n = Object.values(agg).reduce((a, x) => a + x.n, 0), v = Object.values(agg).reduce((a, x) => a + x.v, 0);
  const conc = n - (agg['Em andamento']?.n ?? 0), concV = v - (agg['Em andamento']?.v ?? 0);
  const failV = (agg['Fracassado']?.v ?? 0) + (agg['Deserto']?.v ?? 0), failN = (agg['Fracassado']?.n ?? 0) + (agg['Deserto']?.n ?? 0);
  console.log(`classe ${cls}: itens no mês ${total}; amostra ${n} (R$ ${(v / 1e6).toFixed(1)} mi)`);
  for (const [s, x] of Object.entries(agg)) console.log(`   ${s.padEnd(28)} ${String(x.n).padStart(5)} itens  R$ ${(x.v / 1e6).toFixed(2)} mi`);
  console.log(`   concluídos: fracassado+deserto = ${(100 * failN / conc).toFixed(1)}% dos itens e ${(100 * failV / concV).toFixed(1)}% do valor; valor médio do item que falha R$ ${(failV / failN).toFixed(0)}`);
  console.log(`   extrapolação mês (itens ${total}, valor médio ${(v / n).toFixed(0)}): R$ ${((total * (v / n)) * (failV / concV) / 1e6).toFixed(1)} mi/mês em itens que falham`);
}
