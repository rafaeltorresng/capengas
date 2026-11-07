import '../_out.ts';
// Distribuidoras de material médico (CNAE 4645-1/01, ativas no cadastro do governo) × cadastro de sanções CEIS.
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchJson } from '../../src/lib/http.ts';
const http = (u: string) => fetchJson(u, { cacheDir: 'cache', retries: 5, baseDelayMs: 1000, timeoutMs: 60000, ttlMs: 7 * 86400e3 });
const forn = new Map<string, any>();
for (let p = 1; p <= 20; p++) {
  const { data } = await http(`https://dadosabertos.compras.gov.br/modulo-fornecedor/1_consultarFornecedor?pagina=${p}&tamanhoPagina=500&codigoCnae=4645101&ativo=true`);
  for (const f of data.resultado ?? []) if (f.cnpj) forn.set(String(f.cnpj).replace(/\D/g, ''), f);
  if (p === 1) console.log('campos fornecedor:', Object.keys(data.resultado?.[0] ?? {}).join(','));
  if (!data.paginasRestantes) break;
}
console.log('distribuidoras com CNPJ:', forn.size);
const porte: Record<string, number> = {}; for (const f of forn.values()) { const k = f.porteEmpresaNome ?? f.nomePorte ?? '?'; porte[k] = (porte[k] ?? 0) + 1; } console.log('porte', porte);
const raw = new TextDecoder('latin1').decode(readFileSync(process.env.LANCE_CEIS_CSV ?? 'data/ceis.csv'));
const lines = raw.split(/\r?\n/).filter(Boolean); const head = lines[0].split('";"').map(s => s.replace(/"/g, ''));
const col = (n: string) => head.indexOf(n);
const iDoc = col('CPF OU CNPJ DO SANCIONADO'), iCat = col('CATEGORIA DA SANÇÃO'), iIni = col('DATA INÍCIO SANÇÃO'), iFim = col('DATA FINAL SANÇÃO'), iFund = col('FUNDAMENTAÇÃO LEGAL'), iEsf = col('ESFERA ÓRGÃO SANCIONADOR'), iOrg = col('ÓRGÃO SANCIONADOR'), iObs = col('OBSERVAÇÕES');
const hits: any[] = [];
for (const l of lines.slice(1)) {
  const v = l.split('";"').map(s => s.replace(/^"|"$/g, ''));
  const doc = (v[iDoc] ?? '').replace(/\D/g, '');
  if (forn.has(doc)) hits.push({ cnpj: doc, cat: v[iCat], ini: v[iIni], fim: v[iFim], fund: v[iFund], esf: v[iEsf], org: v[iOrg], obs: v[iObs] });
}
const empresas = new Set(hits.map(h => h.cnpj));
const ano = (s: string) => s.slice(6, 10);
const vigente = hits.filter(h => { const [d, m, y] = (h.fim || '31/12/9999').split('/'); return `${y}-${m}-${d}` >= '2026-11-07'; });
console.log(`\nsanções no CEIS contra essas distribuidoras: ${hits.length} (empresas distintas: ${empresas.size} = ${(100 * empresas.size / forn.size).toFixed(1)}% das distribuidoras); vigentes hoje: ${vigente.length} (${new Set(vigente.map(h => h.cnpj)).size} empresas)`);
const cat: Record<string, number> = {}; for (const h of hits) cat[h.cat] = (cat[h.cat] ?? 0) + 1; console.log('categorias', cat);
const yr: Record<string, number> = {}; for (const h of hits) yr[ano(h.ini)] = (yr[ano(h.ini)] ?? 0) + 1; console.log('por ano de início', Object.fromEntries(Object.entries(yr).sort()));
const motivo = (h: any) => { const t = (h.fund + ' ' + h.obs).toLowerCase();
  if (/entreg|atras|inexecu|não cumpr|nao cumpr|execução|fornecimento|deixar de/.test(t)) return 'entrega/execução';
  if (/manter a proposta|não manter|nao manter|assinar|recusa|retirar/.test(t)) return 'não manter proposta / não assinar';
  if (/document|falso|fraud|declara/.test(t)) return 'documentação falsa / fraude';
  if (/14.133|art\. ?155|art\. ?156|10.520|art\. ?7|8.666|87/.test(t)) return 'artigo de lei sem detalhe';
  return 'outro/sem detalhe'; };
const mot: Record<string, number> = {}; for (const h of hits) mot[motivo(h)] = (mot[motivo(h)] ?? 0) + 1; console.log('motivo (heurística sobre fundamentação + observações)', mot);
for (const h of hits.slice(0, 6)) console.log(' ex:', h.cat.slice(0, 40), '|', h.ini, '|', (h.fund + ' ' + h.obs).slice(0, 200));
writeFileSync('out/sancoes.json', JSON.stringify({ n_forn: forn.size, hits }, null, 1));
