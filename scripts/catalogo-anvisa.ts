// Confere o catálogo (fixtures/company.json) contra a base oficial da ANVISA: registro existe, está vigente
// e é da marca declarada. Sai com código 1 se algum produto não conferir.
// Uso: npm run catalogo:anvisa
//      npm run catalogo:anvisa -- --buscar "cabo bisturi"   (registros vigentes para escolher o do catálogo)
// Base: npm run setup -- --atualizar baixa de novo de dados.anvisa.gov.br.
import { existsSync, readFileSync } from 'node:fs';
import { anvisa, ANVISA_CSV } from '../src/lib/data.ts';
import { conferirCatalogo, buscarRegistros } from '../src/lib/catalogo.ts';

const meta = ANVISA_CSV.replace(/\.csv$/, '.meta.json');
const origem = existsSync(meta) ? JSON.parse(readFileSync(meta, 'utf8')) : null;
console.log(`base ANVISA: ${anvisa.count()} registros; ${origem ? `baixada em ${origem.baixadoEm} de ${origem.fonte}` : 'data do download desconhecida (rode npm run setup -- --atualizar)'}`);
const hoje = new Date();
const args = process.argv.slice(2);

if (args.includes('--buscar')) {
  const termos = args[args.indexOf('--buscar') + 1] ?? '';
  for (const r of buscarRegistros(anvisa.linhas(), termos, hoje)) {
    console.log(`${r.registro} | ${r.nomeComercial} | técnico: ${r.nomeTecnico} | fabricante: ${r.fabricante} | detentor: ${r.detentor} | classe ${r.classe} | ${r.validade}`);
  }
} else {
  const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
  const resultado = conferirCatalogo(company.catalogo, n => anvisa.byRegistro(n), hoje);
  for (const r of resultado) {
    console.log(`${r.status === 'confere' ? 'ok ' : 'ERR'} ${r.produto} ${r.registro}: ${r.motivo}${r.anvisa ? ` | técnico: ${r.anvisa.nomeTecnico} | classe ${r.anvisa.classe} | ${r.anvisa.validade}` : ''}`);
  }
  if (resultado.some(r => r.status !== 'confere')) process.exitCode = 1;
}
