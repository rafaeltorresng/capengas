// Prepara as bases locais: baixa a base de produtos para saúde da ANVISA e o CATMAT de saúde,
// e monta os bancos SQLite. Idempotente: pula o que já existe. Uso: npm run setup
// npm run setup -- --atualizar   baixa de novo a base da ANVISA (antes da demo: registro pode vencer ou ser cancelado).
import './_out.ts';
import { existsSync, mkdirSync, writeFileSync, statSync, renameSync } from 'node:fs';
import { DATA, ANVISA_CSV, CATMAT_JSON, anvisa, catmat } from '../src/lib/data.ts';

const ANVISA_URL = 'https://dados.anvisa.gov.br/dados/TA_PRODUTO_SAUDE_SITE.csv';
mkdirSync(DATA, { recursive: true });

if (existsSync(ANVISA_CSV) && !process.argv.includes('--atualizar')) {
  console.log(`ANVISA: já existe (${(statSync(ANVISA_CSV).size / 1e6).toFixed(1)} MB); use --atualizar para baixar de novo`);
} else {
  console.log(`ANVISA: baixando a base oficial (~28 MB) de ${ANVISA_URL}…`);
  const res = await fetch(ANVISA_URL, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`ANVISA: HTTP ${res.status}`);
  // O arquivo oficial vem em Latin-1; o código lê em UTF-8.
  const text = new TextDecoder('latin1').decode(await res.arrayBuffer());
  const linhas = text.split(/\r?\n/).filter(Boolean).length - 1;
  if (!text.startsWith('NUMERO_REGISTRO_CADASTRO;') || linhas < 50_000) throw new Error(`ANVISA: arquivo inesperado (${linhas} linhas); base anterior mantida`);
  writeFileSync(ANVISA_CSV + '.novo', text, 'utf8');
  renameSync(ANVISA_CSV + '.novo', ANVISA_CSV);
  writeFileSync(ANVISA_CSV.replace(/\.csv$/, '.meta.json'), JSON.stringify({ fonte: ANVISA_URL, baixadoEm: new Date().toISOString(), registros: linhas }, null, 2) + '\n');
  console.log(`ANVISA: ok (${linhas} registros)`);
}

if (existsSync(CATMAT_JSON)) {
  console.log('CATMAT: já existe');
} else {
  console.log('CATMAT: baixando o grupo 65 (saúde), ~86 páginas; pode levar de 3 a 20 min conforme a API…');
  await import('./catmat-download.ts');
}

console.log('Montando bancos locais…');
console.log(`  ANVISA: ${anvisa.count()} produtos`);
console.log(`  CATMAT: busca de teste "seringa" → ${catmat.search('seringa', 3).length} resultados`);
console.log('Pronto. Crie o .env a partir do .env.example e rode: npm test');
