// Calendário do cofre: para cada documento que falha em alguma sessão futura, até quando renovar e quantos
// pregões se perdem sem isso. Reaproveita checkDocs (mesmo mapa exigência → documento). Datas em AAAA-MM-DD.
import { checkDocs } from './rules.ts';
import type { CofreDoc, Exigencia } from './contracts.ts';
import type { LanceStore } from './store.ts';

export type PregaoCofre = { tenderId: string; sessao: string; exigencias: Exigencia[] };
export type AlertaCofre = {
  documento: string | null; exigencia: string; tipo: string | null;
  status: 'vence_antes_sessao' | 'vencido' | 'ausente' | 'irregular';
  /** Data-limite para ter o documento renovado; null quando ausente do cofre. */
  renovarAte: string | null;
  pregoes: { tenderId: string; sessao: string }[];
  resumo: string;
};

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const nPregoes = (n: number) => `${n} ${n === 1 ? 'pregão' : 'pregões'}`;

export function calendarioCofre(cofre: CofreDoc[], pregoes: PregaoCofre[], hoje: string): AlertaCofre[] {
  const porDoc = new Map<string, AlertaCofre>();
  for (const p of [...pregoes].sort((a, b) => a.sessao.localeCompare(b.sessao))) {
    if (p.sessao < hoje) continue;
    for (const c of checkDocs(cofre, p.exigencias, p.sessao)) {
      if (c.status === 'vigente' || c.status === 'sem_vencimento') continue;
      const chave = c.documento ?? c.exigencia;
      let a = porDoc.get(chave);
      if (!a) {
        const status = c.status === 'vence_antes_sessao' && c.validade! < hoje ? 'vencido' : c.status;
        a = { documento: c.documento, exigencia: c.exigencia, tipo: cofre.find(d => d.doc === c.documento)?.tipo ?? null,
          status, renovarAte: c.validade, pregoes: [], resumo: '' };
        porDoc.set(chave, a);
      }
      if (!a.pregoes.some(x => x.tenderId === p.tenderId)) a.pregoes.push({ tenderId: p.tenderId, sessao: p.sessao });
    }
  }
  const alertas = [...porDoc.values()];
  for (const a of alertas) {
    const nome = a.documento ?? a.exigencia, perde = `ou perde ${nPregoes(a.pregoes.length)}`;
    a.resumo = a.status === 'ausente' ? `Inclua ${nome} no cofre ${perde}.`
      : a.status === 'irregular' ? `Regularize ${nome} ${perde}.`
      : a.status === 'vencido' ? `Renove ${nome} (vencido desde ${br(a.renovarAte!)}) ${perde}.`
      : `Renove ${nome} até ${br(a.renovarAte!)} ${perde}.`;
  }
  return alertas.sort((x, y) => (x.renovarAte ?? '').localeCompare(y.renovarAte ?? ''));
}

/** Pregões acompanhados no SQLite com data de sessão conhecida. */
export function calendarioDoStore(store: LanceStore, cofre: CofreDoc[], hoje: string): AlertaCofre[] {
  const pregoes = store.getTenders().filter(t => t.abertura).map(t => ({
    tenderId: t.id, sessao: t.abertura!.slice(0, 10),
    exigencias: store.getRequirements(t.id).map(r => ({ tipo: r.tipo, citacao: r.citacao })),
  }));
  return calendarioCofre(cofre, pregoes, hoje);
}
