import '../_out.ts';
// Pregões abertos hoje no PNCP por termo: quantidade e valor estimado somado (deduplicado).
import { fetchJson } from '../../src/lib/http.ts';
const seen = new Map<string, any>();
for (const q of ['material hospitalar', 'material medico hospitalar', 'equipamentos hospitalares', 'insumos hospitalares']) {
  let total = 0;
  for (let p = 1; p <= 40; p++) {
    try {
      const { data } = await fetchJson(`https://pncp.gov.br/api/search/?q=${encodeURIComponent(q)}&tipos_documento=edital&ordenacao=-data&pagina=${p}&tam_pagina=100&status=recebendo_proposta`, { cacheDir: 'cache', retries: 8, baseDelayMs: 800, timeoutMs: 45000, ttlMs: 3 * 3600e3 });
      total = data.total;
      for (const i of data.items) seen.set(i.id, { q, mod: i.modalidade_licitacao_nome, v: Number(i.valor_total_estimado) || 0, uf: i.uf, esfera: i.esfera_nome, sis: i.usuario_nome });
      if (p * 100 >= total) break;
    } catch (e: any) { console.error(q, p, e.message.slice(0, 50)); }
  }
  console.log(q, 'total na busca', total);
}
const all = [...seen.values()];
const preg = all.filter(x => (x.mod ?? '').startsWith('Pregão'));
const sum = (a: any[]) => a.reduce((s, x) => s + x.v, 0);
console.log('editais distintos abertos', all.length, '| pregões', preg.length, '| com valor informado', preg.filter(x => x.v > 0).length);
console.log('valor estimado somado (pregões): R$', (sum(preg) / 1e9).toFixed(2), 'bi | todos: R$', (sum(all) / 1e9).toFixed(2), 'bi');
const govbr = preg.filter(x => x.sis === 'Compras.gov.br'); console.log('pregões Compras.gov.br', govbr.length, 'R$', (sum(govbr) / 1e9).toFixed(2), 'bi');
const esf: Record<string, number> = {}; for (const x of preg) esf[x.esfera] = (esf[x.esfera] ?? 0) + 1; console.log('por esfera', esf);
const v = preg.map(x => x.v).filter(x => x > 0).sort((a, b) => a - b); console.log('mediana por pregão R$', v[Math.floor(v.length / 2)]?.toFixed(0), '| top 1% soma', (100 * sum(v.slice(-Math.ceil(v.length / 100)).map(x => ({ v: x }))) / sum(v.map(x => ({ v: x })))).toFixed(0) + '% do valor');
