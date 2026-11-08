// Roda o agente extrator de regras da proposta em um ou mais pregões e grava o resultado em out/regras-proposta/.
// Uso: npm run regras:proposta -- 77816510000166/2026/348 [outro id]   |   npm run regras:proposta -- --demo
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { featherless } from '../src/lib/llm.ts';
import { extrairRegrasProposta } from '../src/lib/regras-proposta.ts';

const args = process.argv.slice(2);
const ids = args.includes('--demo')
  ? JSON.parse(readFileSync('fixtures/demo.json', 'utf8')).pregoes.map((p: { id: string }) => p.id)
  : args.filter(a => !a.startsWith('--'));
if (!ids.length) { console.error('informe o id cnpj/ano/seq ou --demo'); process.exit(2); }

const llm = featherless();
mkdirSync('out/regras-proposta', { recursive: true });
for (const id of ids) {
  const r = await extrairRegrasProposta({ tenderId: id, llm, onEvent: e => { if (e.type === 'tool') process.stdout.write(e.error ? 'x' : '.'); } });
  const destino = `out/regras-proposta/${id.replaceAll('/', '-')}.json`;
  writeFileSync(destino, JSON.stringify({ ...r, trace: undefined }, null, 2));
  console.log(`\n${id}: ${r.legivel ? `${r.regras.length} regras` : r.motivo} | arquivos: ${r.arquivos.join(', ')}`);
  for (const g of r.regras) console.log(`  ${g.campo.padEnd(18)} ${g.valor}  [${g.fonte?.nome}]`);
  if (r.lacunas.length) console.log(`  não especificado no edital: ${r.lacunas.join(', ')}`);
  console.log(`  ${(r.ms / 1000).toFixed(1)} s, ${r.usage.prompt_tokens + r.usage.completion_tokens} tokens, US$ ${(r.usage.cost ?? 0).toFixed(4)}, parada: ${r.stopped ?? '-'} → ${destino}`);
}
