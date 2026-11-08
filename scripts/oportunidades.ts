// Coleta pública verificável para preparar o feed sem modelo e sem alterar o agendador.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { criarBiblioteca } from '../src/lib/catalogos-demo.ts';
import { coletarOportunidades, type RetratoFeed } from '../src/lib/oportunidades.ts';
const company = JSON.parse(readFileSync('fixtures/company.json', 'utf8'));
const manifest = JSON.parse(readFileSync('fixtures/catalogos.json', 'utf8'));
const demo = JSON.parse(readFileSync('fixtures/demo.json', 'utf8'));
const path = 'fixtures/oportunidades.json';
const anterior: RetratoFeed = existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf8'))
  : { versao: 1, ultimaSincronizacao: null, ultimaTentativa: null, status: 'preparado', avisos: [], pregoes: [] };
const coverage = JSON.parse(readFileSync('fixtures/coverage.json', 'utf8'));
const sementes = coverage
  .filter((p: any) => p.sistema === 'Compras.gov.br' && p.nItems <= 400)
  .map((p: any) => ({ ...p, plataforma: p.sistema, situacao: 'Situação a consultar', valorEstimado: null }));
const out = await coletarOportunidades({
  sementes,
  anterior,
  produtos: criarBiblioteca(company.catalogo, manifest).produtos,
  excluidos: [demo.evento?.id, demo.editalIlegivel?.id].filter(Boolean),
});
if (!out.pregoes.length)
  throw new Error('A coleta não encontrou oportunidades verificadas. Arquivo anterior preservado.');
writeFileSync(path, JSON.stringify(out, null, 2) + '\n');
console.log(
  JSON.stringify({
    pregoes: out.pregoes.length,
    status: out.status,
    consulta: out.ultimaSincronizacao,
    avisos: out.avisos,
    produtos: criarBiblioteca(company.catalogo, manifest).produtos.length,
  }),
);
