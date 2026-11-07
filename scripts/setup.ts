// Prepara as bases locais: baixa a base de produtos para saúde da ANVISA e o CATMAT de saúde,
// e monta os bancos SQLite. Idempotente: pula o que já existe. Uso: npm run setup
import './_out.ts';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { DATA, ANVISA_CSV, CATMAT_JSON, anvisa, catmat } from '../src/lib/data.ts';

const ANVISA_URL = 'https://dados.anvisa.gov.br/dados/TA_PRODUTO_SAUDE_SITE.csv';
mkdirSync(DATA, { recursive: true });

if (existsSync(ANVISA_CSV)) {
  console.log(`ANVISA: já existe (${(statSync(ANVISA_CSV).size / 1e6).toFixed(1)} MB)`);
} else {
  console.log('ANVISA: baixando a base oficial (~28 MB)…');
  const res = await fetch(ANVISA_URL, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) throw new Error(`ANVISA: HTTP ${res.status}`);
  // O arquivo oficial vem em Latin-1; o código lê em UTF-8.
  const text = new TextDecoder('latin1').decode(await res.arrayBuffer());
  writeFileSync(ANVISA_CSV, text, 'utf8');
  console.log('ANVISA: ok');
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
