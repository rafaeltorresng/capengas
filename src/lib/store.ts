// Estado persistente do Lance em SQLite (contrato Store em contracts.ts).
// Upserts idempotentes, ações com chave idempotente e escaladas resolvidas em transação com o evento.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DATA } from './data.ts';
import type {
  Store, TenderRow, ItemRow, FitRow, RequirementRow, DecisionRow, Action, ActionStatus,
  Escalation, Decision, DecisionResult, Event,
} from './contracts.ts';

export type StoreOptions = {
  now?: () => Date;
  /** Só para testes: lança erro depois de gravar a decisão, antes do evento, para provar o rollback. */
  _failAfterDecision?: boolean;
};

export type LanceStore = Store & {
  close(): void;
  /** Auxiliares de teste e diagnóstico. */
  _count(table: string): number;
  _dossieVersion(tenderId: string): number | undefined;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenders (
  id TEXT PRIMARY KEY, orgao TEXT, uf TEXT, abertura TEXT, situacao TEXT, plataforma TEXT,
  arquivos_hash TEXT, ultimo_check TEXT, reavaliar INTEGER NOT NULL DEFAULT 0, atualizado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS items (
  tender_id TEXT NOT NULL, numero INTEGER NOT NULL, descricao TEXT, catalog_code INTEGER,
  quantidade REAL, estimativa REAL, sigiloso INTEGER NOT NULL DEFAULT 0, atualizado_em TEXT NOT NULL,
  PRIMARY KEY (tender_id, numero));
CREATE TABLE IF NOT EXISTS fits (
  tender_id TEXT NOT NULL, item INTEGER NOT NULL, produto TEXT NOT NULL, fit TEXT NOT NULL,
  atributos TEXT, atualizado_em TEXT NOT NULL, PRIMARY KEY (tender_id, item, produto));
CREATE TABLE IF NOT EXISTS requirements (
  tender_id TEXT NOT NULL, tipo TEXT NOT NULL, citacao TEXT NOT NULL, atualizado_em TEXT NOT NULL,
  PRIMARY KEY (tender_id, tipo, citacao));
CREATE TABLE IF NOT EXISTS decisions (
  tender_id TEXT NOT NULL, item INTEGER NOT NULL, produto TEXT NOT NULL, estado TEXT NOT NULL,
  motivos TEXT NOT NULL, preco_proposto REAL, atualizado_em TEXT NOT NULL,
  PRIMARY KEY (tender_id, item, produto));
CREATE TABLE IF NOT EXISTS dossies (
  tender_id TEXT PRIMARY KEY, json TEXT NOT NULL, versao INTEGER NOT NULL, atualizado_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS actions (
  key TEXT PRIMARY KEY, tipo TEXT NOT NULL, tender_id TEXT NOT NULL, item INTEGER, payload TEXT,
  status TEXT NOT NULL, protocolo TEXT, verificado INTEGER, criada_em TEXT NOT NULL, atualizada_em TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS escalations (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, tender TEXT NOT NULL, item TEXT,
  motivo TEXT NOT NULL, recomendacao TEXT NOT NULL, prazo TEXT NOT NULL, status TEXT NOT NULL,
  decisao TEXT, decidida_em TEXT);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, horario TEXT NOT NULL, tipo TEXT NOT NULL,
  resumo TEXT NOT NULL, detalhe TEXT, tender TEXT, item TEXT, dossie INTEGER, rastro TEXT);
CREATE INDEX IF NOT EXISTS ix_events_horario ON events(horario);
CREATE INDEX IF NOT EXISTS ix_actions_status ON actions(status);
`;

const TABLES = new Set(['tenders', 'items', 'fits', 'requirements', 'decisions', 'dossies', 'actions', 'escalations', 'events']);
const json = (v: unknown) => (v === undefined ? null : JSON.stringify(v));
const parse = (s: unknown) => (s == null ? undefined : JSON.parse(String(s)));

export function openStore(path: string = process.env.LANCE_DB ?? join(DATA, 'lance.db'), o: StoreOptions = {}): LanceStore {
  const now = o.now ?? (() => new Date());
  const iso = () => now().toISOString();
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Migração: bancos criados antes da coluna reavaliar.
  if (!(db.prepare('PRAGMA table_info(tenders)').all() as any[]).some(c => c.name === 'reavaliar'))
    db.exec('ALTER TABLE tenders ADD COLUMN reavaliar INTEGER NOT NULL DEFAULT 0');

  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  const toTender = (r: any): TenderRow => ({
    id: r.id, orgao: r.orgao, uf: r.uf, abertura: r.abertura, situacao: r.situacao, plataforma: r.plataforma,
    arquivosHash: r.arquivos_hash, ultimoCheck: r.ultimo_check, reavaliar: !!r.reavaliar,
  });
  const toAction = (r: any): Action => ({
    key: r.key, tipo: r.tipo, tenderId: r.tender_id, ...(r.item != null ? { item: Number(r.item) } : {}),
    payload: parse(r.payload), status: r.status as ActionStatus,
    ...(r.protocolo != null ? { protocolo: r.protocolo } : {}), ...(r.verificado != null ? { verificado: !!r.verificado } : {}),
    criadaEm: r.criada_em, atualizadaEm: r.atualizada_em,
  });
  const toEscalation = (r: any): Escalation => ({
    id: r.id, tender: r.tender, ...(r.item != null ? { item: r.item } : {}),
    motivo: r.motivo, recomendacao: r.recomendacao, prazo: r.prazo, status: r.status,
  });
  const toEvent = (r: any): Event => ({
    id: r.id, horario: r.horario, tipo: r.tipo, resumo: r.resumo,
    ...(r.detalhe != null ? { detalhe: r.detalhe } : {}), ...(r.tender != null ? { tender: r.tender } : {}),
    ...(r.item != null ? { item: r.item } : {}), ...(r.dossie != null ? { dossie: !!r.dossie } : {}),
    ...(r.rastro != null ? { rastro: parse(r.rastro) } : {}),
  });

  const insertEvent = (e: Omit<Event, 'id' | 'horario'>): Event => {
    const horario = iso();
    const tmp = `tmp_${Math.random().toString(36).slice(2)}`;
    const { lastInsertRowid } = db.prepare(`INSERT INTO events (id, horario, tipo, resumo, detalhe, tender, item, dossie, rastro) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(tmp, horario, e.tipo, e.resumo, e.detalhe ?? null, e.tender ?? null, e.item ?? null, e.dossie == null ? null : Number(e.dossie), json(e.rastro));
    const id = `ev_${lastInsertRowid}`;
    db.prepare('UPDATE events SET id = ? WHERE seq = ?').run(id, lastInsertRowid);
    return { ...e, id, horario };
  };

  const getAction = (key: string) => {
    const r = db.prepare('SELECT * FROM actions WHERE key = ?').get(key);
    return r ? toAction(r) : undefined;
  };

  return {
    upsertTender(t: TenderRow) {
      // reavaliar omitido mantém o valor gravado.
      const rv = t.reavaliar == null ? null : Number(t.reavaliar);
      db.prepare(`INSERT INTO tenders (id, orgao, uf, abertura, situacao, plataforma, arquivos_hash, ultimo_check, reavaliar, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?,COALESCE(?, 0),?) ON CONFLICT(id) DO UPDATE SET orgao=excluded.orgao, uf=excluded.uf, abertura=excluded.abertura,
        situacao=excluded.situacao, plataforma=excluded.plataforma, arquivos_hash=excluded.arquivos_hash,
        ultimo_check=excluded.ultimo_check, reavaliar=COALESCE(?, tenders.reavaliar), atualizado_em=excluded.atualizado_em`)
        .run(t.id, t.orgao, t.uf, t.abertura, t.situacao, t.plataforma, t.arquivosHash, t.ultimoCheck, rv, iso(), rv);
    },
    upsertItems(tenderId: string, items: ItemRow[]) {
      const st = db.prepare(`INSERT INTO items (tender_id, numero, descricao, catalog_code, quantidade, estimativa, sigiloso, atualizado_em)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tender_id, numero) DO UPDATE SET descricao=excluded.descricao,
        catalog_code=excluded.catalog_code, quantidade=excluded.quantidade, estimativa=excluded.estimativa,
        sigiloso=excluded.sigiloso, atualizado_em=excluded.atualizado_em`);
      tx(() => { for (const i of items) st.run(tenderId, i.numero, i.descricao, i.catalogCode, i.quantidade, i.estimativa, i.sigiloso ? 1 : 0, iso()); });
    },
    upsertFit(f: FitRow) {
      db.prepare(`INSERT INTO fits (tender_id, item, produto, fit, atributos, atualizado_em) VALUES (?,?,?,?,?,?)
        ON CONFLICT(tender_id, item, produto) DO UPDATE SET fit=excluded.fit, atributos=excluded.atributos, atualizado_em=excluded.atualizado_em`)
        .run(f.tenderId, f.item, f.produto, f.fit, json(f.atributos), iso());
    },
    upsertRequirement(r: RequirementRow) {
      db.prepare(`INSERT INTO requirements (tender_id, tipo, citacao, atualizado_em) VALUES (?,?,?,?)
        ON CONFLICT(tender_id, tipo, citacao) DO UPDATE SET atualizado_em=excluded.atualizado_em`)
        .run(r.tenderId, r.tipo, r.citacao, iso());
    },
    upsertDecision(d: DecisionRow) {
      db.prepare(`INSERT INTO decisions (tender_id, item, produto, estado, motivos, preco_proposto, atualizado_em) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(tender_id, item, produto) DO UPDATE SET estado=excluded.estado, motivos=excluded.motivos,
        preco_proposto=excluded.preco_proposto, atualizado_em=excluded.atualizado_em`)
        .run(d.tenderId, d.item, d.produto, d.estado, JSON.stringify(d.motivos), d.precoProposto, iso());
    },
    upsertDossie(tenderId: string, dossie: unknown) {
      db.prepare(`INSERT INTO dossies (tender_id, json, versao, atualizado_em) VALUES (?,?,1,?)
        ON CONFLICT(tender_id) DO UPDATE SET json=excluded.json, versao=dossies.versao + 1, atualizado_em=excluded.atualizado_em`)
        .run(tenderId, JSON.stringify(dossie), iso());
    },

    recordIntent(a) {
      return tx(() => {
        const existing = getAction(a.key);
        if (existing) return { status: 'existente' as const, action: existing };
        const t = iso();
        db.prepare(`INSERT INTO actions (key, tipo, tender_id, item, payload, status, criada_em, atualizada_em) VALUES (?,?,?,?,?,'intencao',?,?)`)
          .run(a.key, a.tipo, a.tenderId, a.item ?? null, json(a.payload), t, t);
        return { status: 'nova' as const, action: getAction(a.key)! };
      });
    },
    updateAction(key, patch) {
      return tx(() => {
        const cur = getAction(key);
        if (!cur) throw new Error(`ação ${key} não existe`);
        db.prepare('UPDATE actions SET status = ?, protocolo = ?, verificado = ?, atualizada_em = ? WHERE key = ?')
          .run(patch.status ?? cur.status, patch.protocolo ?? cur.protocolo ?? null,
            patch.verificado == null ? (cur.verificado == null ? null : Number(cur.verificado)) : Number(patch.verificado), iso(), key);
        return getAction(key)!;
      });
    },
    getActions(f = {}) {
      const where: string[] = []; const args: any[] = [];
      if (f.tenderId) { where.push('tender_id = ?'); args.push(f.tenderId); }
      if (f.status) { where.push('status = ?'); args.push(f.status); }
      if (f.desde) { where.push('atualizada_em >= ?'); args.push(f.desde); }
      return db.prepare(`SELECT * FROM actions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY criada_em, key`).all(...args).map(toAction);
    },

    openEscalation(e) {
      return tx(() => {
        const { lastInsertRowid } = db.prepare(`INSERT INTO escalations (id, tender, item, motivo, recomendacao, prazo, status) VALUES (?,?,?,?,?,?,'aberta')`)
          .run(`tmp_${Math.random().toString(36).slice(2)}`, e.tender, e.item ?? null, e.motivo, e.recomendacao, e.prazo);
        const id = `esc_${lastInsertRowid}`;
        db.prepare('UPDATE escalations SET id = ? WHERE seq = ?').run(id, lastInsertRowid);
        insertEvent({ tipo: 'escalada_aberta', resumo: e.motivo, tender: e.tender, ...(e.item ? { item: e.item } : {}) });
        return toEscalation(db.prepare('SELECT * FROM escalations WHERE id = ?').get(id));
      });
    },
    resolveEscalation(id: string, d: Decision): DecisionResult {
      return tx(() => {
        const r: any = db.prepare('SELECT * FROM escalations WHERE id = ?').get(id);
        if (!r) return { status: 'ausente' };
        if (r.status === 'decidida') return { status: 'resolvida' };
        if (r.status === 'expirada' || new Date(r.prazo).getTime() < now().getTime()) {
          db.prepare(`UPDATE escalations SET status = 'expirada' WHERE id = ?`).run(id);
          return { status: 'expirada' };
        }
        const horario = iso();
        db.prepare(`UPDATE escalations SET status = 'decidida', decisao = ?, decidida_em = ? WHERE id = ?`).run(JSON.stringify(d), horario, id);
        if (o._failAfterDecision) throw new Error('falha simulada depois da decisão');
        insertEvent({ tipo: 'escalada_decidida', resumo: `${d.decisao}${d.ajuste ? `: ${d.ajuste}` : ''}`, tender: r.tender, ...(r.item != null ? { item: r.item } : {}) });
        return { status: 'salva', registro: { ...d, id, horario } };
      });
    },
    openEscalations() {
      return db.prepare(`SELECT * FROM escalations WHERE status = 'aberta' ORDER BY seq`).all().map(toEscalation);
    },

    logEvent(e) { return insertEvent(e); },
    events(f = {}) {
      const args: any[] = []; let where = '';
      if (f.desde) { where = 'WHERE horario >= ?'; args.push(f.desde); }
      const rows = f.limite
        ? db.prepare(`SELECT * FROM (SELECT * FROM events ${where} ORDER BY seq DESC LIMIT ?) ORDER BY seq`).all(...args, f.limite)
        : db.prepare(`SELECT * FROM events ${where} ORDER BY seq`).all(...args);
      return rows.map(toEvent);
    },

    getTender(id) {
      const r: any = db.prepare('SELECT * FROM tenders WHERE id = ?').get(id);
      return r ? toTender(r) : undefined;
    },
    getTenders(f = {}) {
      const rows = f.reavaliar == null
        ? db.prepare('SELECT * FROM tenders ORDER BY id').all()
        : db.prepare('SELECT * FROM tenders WHERE reavaliar = ? ORDER BY id').all(Number(f.reavaliar));
      return rows.map(toTender);
    },
    setReavaliar(tenderId, flag) {
      db.prepare('UPDATE tenders SET reavaliar = ?, atualizado_em = ? WHERE id = ?').run(Number(flag), iso(), tenderId);
    },
    getItems(tenderId) {
      return db.prepare('SELECT * FROM items WHERE tender_id = ? ORDER BY numero').all(tenderId).map((r: any) => ({
        tenderId: r.tender_id, numero: Number(r.numero), descricao: r.descricao, catalogCode: r.catalog_code == null ? null : Number(r.catalog_code),
        quantidade: Number(r.quantidade), estimativa: r.estimativa == null ? null : Number(r.estimativa), sigiloso: !!r.sigiloso,
      }));
    },
    getDecisions(tenderId?: string) {
      const rows = tenderId
        ? db.prepare('SELECT * FROM decisions WHERE tender_id = ? ORDER BY item, produto').all(tenderId)
        : db.prepare('SELECT * FROM decisions ORDER BY tender_id, item, produto').all();
      return rows.map((r: any) => ({ tenderId: r.tender_id, item: Number(r.item), produto: r.produto, estado: r.estado, motivos: JSON.parse(r.motivos), precoProposto: r.preco_proposto == null ? null : Number(r.preco_proposto) }));
    },
    getFits(tenderId: string) {
      return db.prepare('SELECT * FROM fits WHERE tender_id = ? ORDER BY item, produto').all(tenderId).map((r: any) => ({
        tenderId: r.tender_id, item: Number(r.item), produto: r.produto, fit: r.fit, atributos: JSON.parse(r.atributos),
      }));
    },
    getDossie(tenderId) {
      const r: any = db.prepare('SELECT json FROM dossies WHERE tender_id = ?').get(tenderId);
      return r ? JSON.parse(r.json) : undefined;
    },

    close() { db.close(); },
    _count(table: string) {
      if (!TABLES.has(table)) throw new Error(`tabela desconhecida: ${table}`);
      return Number((db.prepare(`SELECT count(*) AS c FROM ${table}`).get() as any).c);
    },
    _dossieVersion(tenderId: string) {
      const r: any = db.prepare('SELECT versao FROM dossies WHERE tender_id = ?').get(tenderId);
      return r ? Number(r.versao) : undefined;
    },
  };
}
