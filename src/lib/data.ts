// Fontes de dados reais: PNCP, Compras.gov (pesquisa de preço), ANVISA (CSV importado em SQLite) e pdftotext.
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson } from './http.ts';

// Raiz do projeto; CACHE guarda respostas HTTP e bancos SQLite, DATA guarda as bases baixadas (npm run setup).
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const CACHE = process.env.LANCE_CACHE_DIR ?? join(ROOT, 'cache');
export const DATA = process.env.LANCE_DATA_DIR ?? join(ROOT, 'data');
const FRESH = { ttlMs: 0, allowStale: false, retries: 3 };
const http = (url: string, extra: object = {}) => fetchJson(url, { cacheDir: CACHE, retries: 5, baseDelayMs: 800, timeoutMs: 45000, ...extra });

export type Tender = { cnpj: string; ano: number; seq: number; abertura: string; objeto: string; orgao: string; uf: string; municipio: string; modalidade: string; url: string; plataforma: string; situacao: string; valorEstimado: number | null };
export type TenderItem = { numero: number; descricao: string; quantidade: number; valorEstimado: number | null; catalogCode: number | null; beneficio: string; criterio: string; temResultado: boolean; sigiloso: boolean };

/** Converte um resultado da busca do PNCP; plataforma = sistema que publicou (só o Compras.gov.br traz código de catálogo). */
export function mapSearchItem(i: any): Tender {
  return {
    cnpj: i.orgao_cnpj, ano: Number(i.ano), seq: Number(i.numero_sequencial),
    abertura: String(i.data_fim_vigencia ?? '').slice(0, 16), objeto: i.description ?? '', orgao: i.orgao_nome ?? '',
    uf: i.uf ?? '', municipio: i.municipio_nome ?? '', modalidade: i.modalidade_licitacao_nome ?? '',
    url: `https://pncp.gov.br/app/editais/${i.orgao_cnpj}/${i.ano}/${i.numero_sequencial}`,
    plataforma: i.usuario_nome ?? '', situacao: i.situacao_nome ?? '', valorEstimado: Number(i.valor_total_estimado) || null,
  };
}

export const pncp = {
  async searchOpen(q: string, page = 1, size = 20) {
    const u = `https://pncp.gov.br/api/search/?q=${encodeURIComponent(q)}&tipos_documento=edital&ordenacao=-data&pagina=${page}&tam_pagina=${size}&status=recebendo_proposta`;
    const { data } = await http(u, { ttlMs: 30 * 60e3, retries: 8 });
    const items: Tender[] = (data.items ?? []).map(mapSearchItem);
    return { total: Number(data.total ?? 0), items };
  },
  /** fresh: lê na hora, sem cache e sem cache vencido (falha se a fonte não responder). Usado pelo recheque. */
  async compra(cnpj: string, ano: number, seq: number, o: { fresh?: boolean } = {}) {
    const { data } = await http(`https://pncp.gov.br/api/consulta/v1/orgaos/${cnpj}/compras/${ano}/${seq}`, o.fresh ? FRESH : { ttlMs: 10 * 60e3 });
    return data;
  },
  /** fresh: usado pelo monitor para comparar os itens publicados agora com os da análise. */
  async items(cnpj: string, ano: number, seq: number, o: { fresh?: boolean } = {}): Promise<TenderItem[]> {
    const out: TenderItem[] = [];
    for (let p = 1; p <= 20; p++) {
      const { data } = await http(`https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/itens?pagina=${p}&tamanhoPagina=100`, o.fresh ? FRESH : {});
      const arr = Array.isArray(data) ? data : [];
      for (const i of arr) out.push({
        numero: i.numeroItem, descricao: i.descricao ?? '', quantidade: i.quantidade, valorEstimado: i.valorUnitarioEstimado || null,
        catalogCode: i.catalogoCodigoItem ? Number(i.catalogoCodigoItem) : null, beneficio: i.tipoBeneficioNome ?? '',
        criterio: i.criterioJulgamentoNome ?? '', temResultado: !!i.temResultado, sigiloso: !!i.orcamentoSigiloso,
      });
      if (arr.length < 100) break;
    }
    return out;
  },
  async files(cnpj: string, ano: number, seq: number, o: { fresh?: boolean } = {}) {
    const { data } = await http(`https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`, o.fresh ? FRESH : {});
    return (Array.isArray(data) ? data : []).map((f: any) => ({ seq: f.sequencialDocumento, titulo: f.titulo ?? '', tipo: f.tipoDocumentoNome ?? '', url: f.url ?? f.uri }));
  },
  async download(url: string) {
    const { data } = await http(url, { raw: true, ttlMs: 7 * 86400e3 });
    return data as Buffer;
  },
};

export const compras = {
  async priceHistory(code: number) {
    const u = `https://dadosabertos.compras.gov.br/modulo-pesquisa-preco/1_consultarMaterial?pagina=1&tamanhoPagina=100&tipo=codigoItemCatalogo&codigo=${code}`;
    const { data } = await http(u, { ttlMs: 24 * 3600e3 });
    return (data.resultado ?? []).map((r: any) => ({
      dataCompra: r.dataCompra, precoUnitario: Number(r.precoUnitario), marca: r.marca ?? null, fornecedor: r.nomeFornecedor,
      uf: r.estado, orgao: r.nomeOrgao, quantidade: r.quantidade, descricao: r.descricaoItem,
    })) as { dataCompra: string; precoUnitario: number; marca: string | null; fornecedor: string; uf: string; orgao: string; quantidade: number; descricao: string }[];
  },
};

// ANVISA: importa o CSV oficial (TA_PRODUTO_SAUDE_SITE) uma vez para SQLite.
const DB_PATH = join(CACHE, 'anvisa.sqlite');
export const ANVISA_CSV = join(DATA, 'anvisa.csv');
let db: DatabaseSync | null = null;
function anvisaDb() {
  if (db) return db;
  mkdirSync(CACHE, { recursive: true });
  // CSV baixado depois da importação: a cópia SQLite é refeita, para nunca consultar registro desatualizado.
  if (existsSync(DB_PATH) && existsSync(ANVISA_CSV) && statSync(ANVISA_CSV).mtimeMs > statSync(DB_PATH).mtimeMs) rmSync(DB_PATH);
  const fresh = !existsSync(DB_PATH);
  db = new DatabaseSync(DB_PATH);
  if (fresh) {
    const lines = readFileSync(ANVISA_CSV, 'utf8').split(/\r?\n/).filter(Boolean);
    const cols = lines[0].split(';');
    db.exec(`CREATE TABLE p (${cols.map(c => `"${c}" TEXT`).join(',')}, nome_norm TEXT)`);
    const ins = db.prepare(`INSERT INTO p VALUES (${cols.map(() => '?').join(',')}, ?)`);
    db.exec('BEGIN');
    for (const l of lines.slice(1)) {
      const v = l.split(';');
      if (v.length !== cols.length) continue;
      const nn = (v[2] + ' ' + v[4]).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
      ins.run(...v, nn);
    }
    db.exec('COMMIT');
    db.exec('CREATE INDEX ix_reg ON p(NUMERO_REGISTRO_CADASTRO)');
  }
  return db;
}
export const anvisa = {
  count: () => Number((anvisaDb().prepare('SELECT count(*) c FROM p').get() as any).c),
  linhas: () => anvisaDb().prepare('SELECT * FROM p').iterate() as Iterable<Record<string, string>>,
  byRegistro: (n: string) => anvisaDb().prepare('SELECT * FROM p WHERE NUMERO_REGISTRO_CADASTRO = ?').get(n.replace(/\D/g, '')) as Record<string, string> | undefined,
  searchName: (term: string, limit = 50) => {
    const t = term.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    return anvisaDb().prepare('SELECT * FROM p WHERE nome_norm LIKE ? LIMIT ?').all(`%${t}%`, limit) as Record<string, string>[];
  },
};

const pexec = promisify(execFile);
export const pdf = {
  async toText(path: string) {
    const { stdout } = await pexec('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], { maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  },
  /** Baixa um documento do PNCP e devolve o texto (PDF) ou null (ZIP/RAR/escaneado). */
  async fromUrl(url: string) {
    const buf = await pncp.download(url);
    const dir = join(CACHE, 'docs'); mkdirSync(dir, { recursive: true });
    const p = join(dir, createHash('sha1').update(url).digest('hex') + '.pdf');
    writeFileSync(p, buf);
    if (buf.subarray(0, 4).toString() !== '%PDF') return { text: null, kind: buf.subarray(0, 2).toString() === 'PK' ? 'zip' : 'outro', bytes: buf.length };
    const text = await pdf.toText(p);
    return { text: text.replace(/\s+/g, ' ').trim().length < 500 ? null : text, kind: text.trim().length < 500 ? 'escaneado' : 'pdf', bytes: buf.length };
  },
};

// CATMAT (grupo 65, saúde) indexado com FTS5 para achar códigos de itens publicados sem código.
let cdb: DatabaseSync | null = null;
const CATMAT_DB = join(CACHE, 'catmat.sqlite');
export const CATMAT_JSON = join(DATA, 'catmat65.json');
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'com', 'sem', 'em', 'e', 'ou', 'a', 'o', 'tipo', 'material', 'cerca', 'c', 's', 'p', 'n', 'no', 'na', 'ate', 'item', 'conforme', 'edital', 'descricao', 'caracteristicas', 'adicionais', 'uso', 'unidade']);
const toks = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2 && !STOP.has(w));
function catmatDb() {
  if (cdb) return cdb;
  const fresh = !existsSync(CATMAT_DB);
  cdb = new DatabaseSync(CATMAT_DB);
  if (fresh) {
    const rows = JSON.parse(readFileSync(CATMAT_JSON, 'utf8'));
    cdb.exec(`CREATE VIRTUAL TABLE c USING fts5(code UNINDEXED, pdm, descr, tokenize='unicode61 remove_diacritics 2')`);
    const ins = cdb.prepare('INSERT INTO c VALUES (?,?,?)');
    cdb.exec('BEGIN'); for (const r of rows) ins.run(String(r.code), r.pdmName ?? '', r.desc ?? ''); cdb.exec('COMMIT');
  }
  return cdb;
}
export const catmat = {
  search(description: string, k = 8) {
    const t = [...new Set(toks(description))].slice(0, 24);
    if (!t.length) return [];
    // OR entre termos com BM25; o nome do PDM pesa mais que a descrição.
    const q = t.map(w => `"${w}"`).join(' OR ');
    return catmatDb().prepare(`SELECT code, pdm AS pdmName, descr AS desc, bm25(c, 0, 4.0, 1.0) AS score FROM c WHERE c MATCH ? ORDER BY score LIMIT ?`).all(q, k)
      .map((r: any) => ({ code: Number(r.code), pdmName: r.pdmName, desc: r.desc, score: r.score }));
  },
};
