import '../_out.ts';
import { pncp, pdf, anvisa } from '../../src/lib/data.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
mkdirSync('out/editais', { recursive: true });
for (const id of ['77816510000166/2026/348', '03648344000108/2026/14', '80257355000108/2026/493']) {
  const [cnpj, ano, seq] = id.split('/');
  const files = await pncp.files(cnpj, +ano, +seq);
  console.log('\n#', id, files.map(f => `${f.tipo}:${f.titulo.slice(0, 40)}`).join(' | '));
  for (const f of files.filter(f => /edital|termo de refer/i.test(f.tipo + f.titulo)).slice(0, 2)) {
    const r = await pdf.fromUrl(f.url);
    console.log('  ', f.titulo.slice(0, 50), r.kind, r.bytes, 'chars', r.text?.length ?? 0);
    if (r.text) {
      writeFileSync(`out/editais/${id.replaceAll('/', '_')}_${f.seq}.txt`, r.text);
      const flat = r.text.replace(/\s+/g, ' ');
      for (const kw of ['ANVISA', 'AFE', 'amostra', 'marca de refer', 'esclarecimento']) {
        const n = (flat.match(new RegExp(kw, 'gi')) ?? []).length;
        const i = flat.search(new RegExp(kw, 'i'));
        console.log(`     ${kw}: ${n}x`, i >= 0 ? '«' + flat.slice(Math.max(0, i - 80), i + 140) + '»' : '');
      }
    }
  }
}
console.log('\n# ANVISA');
for (const t of ['cabo de bisturi', 'cabo para bisturi', 'metzenbaum', 'foerster', 'cadeira de rodas', 'clorexidina', 'degermacao', 'pronga'])
  console.log(t, '→', anvisa.searchName(t, 5).map(r => `${r.NUMERO_REGISTRO_CADASTRO} ${r.CLASSE_RISCO} ${r.VALIDADE_REGISTRO_CADASTRO} ${r.NOME_COMERCIAL.slice(0, 45)}`).join(' || '));
