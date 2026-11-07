import './_out.ts';
// Baixa o catálogo CATMAT ativo do grupo 65 (saúde) para indexação local.
import { fetchJson } from '../src/lib/http.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
const all: any[] = [];
for (let p = 1; p <= 90; p++) {
  const u = `https://dadosabertos.compras.gov.br/modulo-material/4_consultarItemMaterial?pagina=${p}&tamanhoPagina=500&codigoGrupo=65&statusItem=true`;
  const { data } = await fetchJson(u, { cacheDir: 'cache', retries: 6, baseDelayMs: 1000, timeoutMs: 60000, ttlMs: 7 * 86400e3 });
  all.push(...data.resultado.map((r: any) => ({ code: r.codigoItem, pdm: r.codigoPdm, pdmName: r.nomePdm, classe: r.codigoClasse, desc: r.descricaoItem })));
  if (p % 10 === 0) console.log('página', p, all.length);
  if (!data.paginasRestantes) break;
}
mkdirSync('data', { recursive: true });
writeFileSync('data/catmat65.json', JSON.stringify(all));
console.log('ok', all.length);
