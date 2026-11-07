import '../_out.ts';
// Mede, em pregões ENCERRADOS, a situação final dos itens: homologado, fracassado, deserto, cancelado.
// Compara saúde (material hospitalar) com controle (material de expediente). Uso: node scripts/fracasso.ts
import { fetchJson } from '../../src/lib/http.ts';
import { writeFileSync } from 'node:fs';
const http = (u: string) => fetchJson(u, { cacheDir: 'cache', retries: 8, baseDelayMs: 800, timeoutMs: 45000, ttlMs: 7 * 86400e3 });
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const cats: Record<string, string> = { saude: 'material hospitalar', saude_equip: 'equipamentos hospitalares', controle: 'material de expediente' };
const out: any = {};
for (const [cat, q] of Object.entries(cats)) {
  const tenders: any[] = [];
  for (const page of [8, 9, 10, 11, 12, 13, 14, 15]) { // páginas mais antigas: itens já com desfecho
    try {
      const { data } = await http(`https://pncp.gov.br/api/search/?q=${encodeURIComponent(q)}&tipos_documento=edital&ordenacao=-data&pagina=${page}&tam_pagina=20&status=encerradas`);
      for (const i of data.items) if ((i.modalidade_licitacao_nome ?? '').startsWith('Pregão')) tenders.push(i);
    } catch (e: any) { console.error(cat, 'busca', page, e.message.slice(0, 60)); }
    if (tenders.length >= 70) break;
  }
  const sit: Record<string, number> = {}; const val: Record<string, number> = {}; let items = 0; const perTender: any[] = [];
  for (const t of tenders.slice(0, 70)) {
    try {
      let all: any[] = [];
      for (let p = 1; p <= 10; p++) { const { data } = await http(`https://pncp.gov.br/api/pncp/v1/orgaos/${t.orgao_cnpj}/compras/${t.ano}/${t.numero_sequencial}/itens?pagina=${p}&tamanhoPagina=100`); const a = Array.isArray(data) ? data : []; all.push(...a); if (a.length < 100) break; }
      const c: Record<string, number> = {};
      for (const i of all) { const s = i.situacaoCompraItemNome ?? '?'; sit[s] = (sit[s] ?? 0) + 1; c[s] = (c[s] ?? 0) + 1; val[s] = (val[s] ?? 0) + (Number(i.valorTotal) || 0); }
      items += all.length; perTender.push({ id: `${t.orgao_cnpj}/${t.ano}/${t.numero_sequencial}`, uf: t.uf, data: t.data_publicacao_pncp?.slice(0, 10), n: all.length, c });
    } catch (e: any) { console.error(cat, 'itens', e.message.slice(0, 60)); }
    await sleep(250);
  }
  out[cat] = { query: q, pregoes: perTender.length, itens: items, situacao: sit, valor_por_situacao: Object.fromEntries(Object.entries(val).map(([k, v]) => [k, Math.round(v)])), perTender };
  const pct = (k: string) => ((100 * (sit[k] ?? 0)) / items).toFixed(1) + '%';
  console.log(cat, 'pregões', perTender.length, 'itens', items, Object.keys(sit).map(k => `${k}: ${sit[k]} (${pct(k)})`).join(' | '));
  writeFileSync('out/fracasso.json', JSON.stringify(out, null, 1));
}
