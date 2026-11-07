// Recheque antes de agir: lê na hora a situação do pregão e a lista de arquivos no PNCP e compara com a
// "foto" guardada na análise. Falha segura: fonte indisponível ou situação desconhecida nunca liberam ação.
import { createHash } from 'node:crypto';
import { pncp } from './data.ts';
import type { Recheque, TenderRow } from './contracts.ts';
import type { LanceStore } from './store.ts';

export type PncpFile = { seq: number; titulo: string; tipo: string; url: string };
export type RecheckDeps = {
  fetchCompra?: (cnpj: string, ano: number, seq: number) => Promise<any>;
  fetchFiles?: (cnpj: string, ano: number, seq: number) => Promise<PncpFile[]>;
  now?: () => Date;
};

const parseId = (id: string) => {
  const m = /^(\d{14})\/(\d{4})\/(\d+)$/.exec(id);
  return m ? { cnpj: m[1], ano: Number(m[2]), seq: Number(m[3]) } : null;
};

/** Hash estável da lista de arquivos (independe da ordem em que a API devolve). */
export { parseId };

export function filesHash(files: PncpFile[]): string {
  const norm = files.map(f => `${f.seq}|${f.tipo}|${f.titulo}|${f.url}`).sort();
  return createHash('sha256').update(norm.join('\n')).digest('hex').slice(0, 16);
}

export type Situacao = 'aberto' | 'suspenso' | 'revogado' | 'anulado' | 'cancelado' | 'desconhecida';
export function situacao(nome: string): Situacao {
  const n = (nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (n.includes('suspens')) return 'suspenso';
  if (n.includes('revog')) return 'revogado';
  if (n.includes('anula')) return 'anulado';
  if (n.includes('cancel')) return 'cancelado';
  if (n.includes('divulgada')) return 'aberto';
  return 'desconhecida';
}

export const defaults = (d: RecheckDeps) => ({
  fetchCompra: d.fetchCompra ?? ((c: string, a: number, s: number) => pncp.compra(c, a, s, { fresh: true })),
  fetchFiles: d.fetchFiles ?? ((c: string, a: number, s: number) => pncp.files(c, a, s, { fresh: true })),
  now: d.now ?? (() => new Date()),
});

/** Guarda a foto do pregão na análise (situação + hash dos arquivos), base do recheque. */
export async function snapshotTender(tenderId: string, store: LanceStore, d: RecheckDeps & { base?: Partial<TenderRow> } = {}) {
  const { fetchCompra, fetchFiles, now } = defaults(d);
  const id = parseId(tenderId);
  if (!id) throw new Error(`id de pregão inválido: ${tenderId}`);
  const [c, files] = await Promise.all([fetchCompra(id.cnpj, id.ano, id.seq), fetchFiles(id.cnpj, id.ano, id.seq)]);
  const prev = store.getTender(tenderId);
  const row: TenderRow = {
    id: tenderId, orgao: d.base?.orgao ?? prev?.orgao ?? c?.orgaoEntidade?.razaoSocial ?? '',
    uf: d.base?.uf ?? prev?.uf ?? c?.unidadeOrgao?.ufSigla ?? '',
    abertura: d.base?.abertura ?? prev?.abertura ?? (c?.dataEncerramentoProposta ? String(c.dataEncerramentoProposta).slice(0, 10) : null),
    situacao: c?.situacaoCompraNome ?? 'desconhecida', plataforma: d.base?.plataforma ?? prev?.plataforma ?? c?.usuarioNome ?? '',
    arquivosHash: filesHash(files), ultimoCheck: now().toISOString(), reavaliar: false,
  };
  store.upsertTender(row);
  return row;
}

/** Recheque fresco. Só devolve `ok` com pregão divulgado, propostas abertas e arquivos iguais aos da análise. */
export async function recheckTender(tenderId: string, store: LanceStore, d: RecheckDeps = {}): Promise<Recheque> {
  const { fetchCompra, fetchFiles, now } = defaults(d);
  const em = now().toISOString();
  const bloquear = (motivo: Extract<Recheque, { status: 'bloquear' }>['motivo'], resumo: string, tipo: 'bloqueio' | 'erro_fonte' = 'bloqueio'): Recheque => {
    store.logEvent({ tipo, resumo, tender: tenderId });
    return { status: 'bloquear', motivo, em };
  };
  const id = parseId(tenderId);
  if (!id) return bloquear('fonte_indisponivel', `recheque: id de pregão inválido (${tenderId})`, 'erro_fonte');

  let c: any, files: PncpFile[];
  try {
    [c, files] = await Promise.all([fetchCompra(id.cnpj, id.ano, id.seq), fetchFiles(id.cnpj, id.ano, id.seq)]);
  } catch (e: any) {
    return bloquear('fonte_indisponivel', `recheque: PNCP indisponível (${String(e?.message ?? e).slice(0, 80)}); nenhuma ação`, 'erro_fonte');
  }

  const prev = store.getTender(tenderId);
  const nome = c?.situacaoCompraNome ?? '';
  if (prev) store.upsertTender({ ...prev, situacao: nome || prev.situacao, ultimoCheck: em });

  const s = situacao(nome);
  if (s === 'desconhecida') return bloquear('fonte_indisponivel', `recheque: situação não reconhecida ("${nome}"); nenhuma ação`, 'erro_fonte');
  if (s !== 'aberto') return bloquear(s, `pregão ${s} no PNCP: ação bloqueada`);

  const fim = c?.dataEncerramentoProposta ? new Date(`${String(c.dataEncerramentoProposta).slice(0, 19)}-03:00`) : null;
  if (fim && fim.getTime() <= now().getTime()) return bloquear('prazo_encerrado', 'recebimento de propostas encerrado: ação bloqueada');

  const hash = filesHash(files);
  if (!prev?.arquivosHash) return bloquear('arquivos_mudaram', 'recheque sem foto da análise: reavaliar antes de agir');
  if (prev.arquivosHash !== hash) return bloquear('arquivos_mudaram', 'arquivos novos no pregão desde a análise (errata, aviso ou anexo): reavaliar');

  return { status: 'ok', situacao: nome, arquivosHash: hash, em };
}
