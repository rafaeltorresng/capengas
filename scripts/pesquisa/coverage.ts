import '../_out.ts';
// Mede: dos pregões abertos de saúde, quantos têm código de catálogo nos itens e PDF de edital legível.
import { pncp } from '../../src/lib/data.ts';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const out: any[] = [];
for (const q of ['material hospitalar', 'material medico hospitalar', 'equipamentos hospitalares']) {
  for (const page of [1, 2]) {
    let r; try { r = await pncp.searchOpen(q, page, 30); } catch (e: any) { console.error('search falhou', q, page, e.message.slice(0, 60)); continue; }
    for (const t of r.items.filter(i => i.modalidade.startsWith('Pregão'))) {
      if (out.some(o => o.cnpj === t.cnpj && o.seq === t.seq && o.ano === t.ano)) continue;
      try {
        const items = await pncp.items(t.cnpj, t.ano, t.seq);
        const comp = await pncp.compra(t.cnpj, t.ano, t.seq).catch(() => ({}));
        out.push({ ...t, nItems: items.length, withCode: items.filter(i => i.catalogCode).length, sistema: comp.usuarioNome ?? '?', srp: comp.srp });
      } catch (e: any) { out.push({ ...t, err: e.message.slice(0, 80) }); }
      await sleep(400);
      if (out.length >= 40) break;
    }
    if (out.length >= 40) break;
  }
  if (out.length >= 40) break;
}
const ok = out.filter(o => !o.err);
const anyCode = ok.filter(o => o.withCode > 0);
const bySys: Record<string, [number, number]> = {};
for (const o of ok) { const k = o.sistema; bySys[k] ??= [0, 0]; bySys[k][0]++; if (o.withCode) bySys[k][1]++; }
console.log(JSON.stringify({ sampled: out.length, errors: out.length - ok.length, withAnyCode: anyCode.length,
  itemsTotal: ok.reduce((a, o) => a + o.nItems, 0), itemsWithCode: ok.reduce((a, o) => a + o.withCode, 0), bySystem: bySys }, null, 1));
await import('node:fs').then(fs => fs.writeFileSync('out/coverage.json', JSON.stringify(out, null, 1)));
