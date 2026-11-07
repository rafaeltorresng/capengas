// Monitor dos pregões acompanhados: relê situação e arquivos no PNCP e, quando algo mudou desde a análise,
// registra monitor_mudanca e marca o pregão para reavaliar. Não atualiza a foto da análise (arquivosHash):
// só a reanálise (snapshotTender) faz isso, para o recheque nunca liberar envio com análise velha.
import { defaults, filesHash, parseId, situacao, type RecheckDeps } from './recheck.ts';
import type { LanceStore } from './store.ts';

export type MonitorResult = { verificados: number; mudancas: number; falhas: number; ignorados: number };

const hojeRecife = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(d);
const TERMINAIS = new Set(['revogado', 'anulado', 'cancelado']);

export async function runMonitor(store: LanceStore, d: RecheckDeps = {}): Promise<MonitorResult> {
  const { fetchCompra, fetchFiles, now } = defaults(d);
  const r: MonitorResult = { verificados: 0, mudancas: 0, falhas: 0, ignorados: 0 };
  const hoje = hojeRecife(now());
  for (const t of store.getTenders()) {
    const id = parseId(t.id);
    if (!id || TERMINAIS.has(situacao(t.situacao)) || (t.abertura && t.abertura < hoje)) { r.ignorados++; continue; }
    let c: any, files: any[];
    try { [c, files] = await Promise.all([fetchCompra(id.cnpj, id.ano, id.seq), fetchFiles(id.cnpj, id.ano, id.seq)]); }
    catch { r.falhas++; continue; }
    r.verificados++;
    const mudancas: string[] = [];
    const nova = c?.situacaoCompraNome ?? t.situacao;
    if (nova !== t.situacao) mudancas.push(`situação: ${t.situacao} → ${nova}`);
    if (!t.reavaliar && t.arquivosHash && filesHash(files) !== t.arquivosHash) mudancas.push('arquivos novos desde a análise (errata, aviso ou anexo)');
    store.upsertTender({ ...t, situacao: nova, ultimoCheck: now().toISOString() });
    if (mudancas.length) {
      r.mudancas++;
      store.setReavaliar(t.id, true);
      store.logEvent({ tipo: 'monitor_mudanca', resumo: mudancas.join('; '), tender: t.id, detalhe: 'pregão marcado para reavaliar' });
    }
  }
  if (r.falhas) store.logEvent({ tipo: 'erro_fonte', resumo: `monitor: ${r.falhas} pregão(ões) sem resposta do PNCP; nova tentativa no próximo ciclo` });
  return r;
}
