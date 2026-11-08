// Monitor dos pregões acompanhados: relê situação e arquivos no PNCP e, quando algo mudou desde a análise,
// registra monitor_mudanca e marca o pregão para reavaliar. Não atualiza a foto da análise (arquivosHash):
// só a reanálise (snapshotTender) faz isso, para o recheque nunca liberar envio com análise velha.
// Com `errata`, o monitor também diz o que mudou (#25, fase 1): itens campo a campo e cada citação gravada
// conferida contra o texto novo, sem modelo. O diff fica no store para a pauta e para a versão do dossiê.
import { defaults, filesHash, parseId, situacao, type PncpFile, type RecheckDeps } from './recheck.ts';
import { diffErrata, mesmaAbertura, type ItemPublicado, type TextoEdital } from './errata.ts';
import { pdf, pncp } from './data.ts';
import type { Politica } from './contracts.ts';
import type { LanceStore } from './store.ts';

export type ErrataDeps = {
  politica: Politica;
  /** Custo por produto do catálogo da empresa, para recalcular preço e total. */
  custos: Record<string, number>;
  fetchItems?: (cnpj: string, ano: number, seq: number) => Promise<ItemPublicado[]>;
  /** Texto dos documentos do edital; null quando nenhum tem texto legível. */
  fetchTextos?: (files: PncpFile[]) => Promise<TextoEdital[] | null>;
};
const DOC_EDITAL = /edital|errata|retifica|adendo|aviso|termo de refer/i;
async function textosPadrao(files: PncpFile[]): Promise<TextoEdital[] | null> {
  const out: TextoEdital[] = [];
  for (const f of files.filter(f => DOC_EDITAL.test(`${f.tipo} ${f.titulo}`)).slice(0, 6)) {
    try { const p = await pdf.fromUrl(f.url); if (p.text) out.push({ nome: f.titulo || f.tipo, url: f.url, texto: p.text }); } catch {}
  }
  return out.length ? out : null;
}

export type MonitorResult = { verificados: number; mudancas: number; falhas: number; ignorados: number };

const hojeRecife = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(d);
const TERMINAIS = new Set(['revogado', 'anulado', 'cancelado']);

export async function runMonitor(store: LanceStore, d: RecheckDeps & { errata?: ErrataDeps } = {}): Promise<MonitorResult> {
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
    const ultimoDiff = store.getErrataDiff(t.id);
    const aberturaAnalise = t.aberturaAnalise !== undefined ? t.aberturaAnalise
      : t.reavaliar && ultimoDiff ? ultimoDiff.abertura.antes : t.abertura;
    const ultimaPublicacao = t.reavaliar ? ultimoDiff?.publicacao : undefined;
    const hashObservado = filesHash(files);
    // A publicação observada não é a foto analisada. Falha no diff não avança esta referência.
    const arquivosMudaram = !!t.arquivosHash && hashObservado !== (ultimaPublicacao?.arquivosHash ?? t.arquivosHash)
      && (!!d.errata || !t.reavaliar);
    if (arquivosMudaram) mudancas.push('arquivos novos desde a análise (errata, aviso ou anexo)');
    const aberturaNova = c?.dataEncerramentoProposta ? String(c.dataEncerramentoProposta).slice(0, 16) : null;
    const aberturaMudou = !mesmaAbertura(ultimaPublicacao ? ultimaPublicacao.abertura : t.abertura, aberturaNova);
    if (aberturaMudou) mudancas.push(`abertura: ${t.abertura} → ${aberturaNova}`);
    let detalhe = 'pregão marcado para reavaliar';
    if (mudancas.length) store.setReavaliar(t.id, true);
    if ((arquivosMudaram || aberturaMudou || (t.reavaliar && !ultimaPublicacao)) && d.errata) {
      try {
        const e = d.errata;
        const [itens, textos] = await Promise.all([
          (e.fetchItems ?? ((a, b, c2) => pncp.items(a, b, c2, { fresh: true })))(id.cnpj, id.ano, id.seq),
          (e.fetchTextos ?? textosPadrao)(files),
        ]);
        const diff = diffErrata({ tenderId: t.id, hoje, politica: e.politica, custos: e.custos,
          antes: { abertura: aberturaAnalise,
            itens: store.getItems(t.id), fits: store.getFits(t.id), decisoes: store.getDecisions(t.id), requisitos: store.getRequirements(t.id) },
          depois: { abertura: aberturaNova, itens, textos } });
        diff.publicacao = { arquivosHash: hashObservado, abertura: aberturaNova, observadoEm: now().toISOString() };
        store.saveErrataDiff(diff);
        const n = diff.contagem;
        detalhe = `errata conferida sem modelo: ${n.reaproveitada} reaproveitada(s), ${n.recalculada} recalculada(s), ${n.citacao_orfa} órfã(s), ${n.ilegivel} ilegível(is)`
          + (diff.prazoNaoReaberto ? `; ${diff.prazoNaoReaberto.artigo}: itens ${diff.prazoNaoReaberto.itens.join(', ')} mudaram sem a abertura andar` : '')
          + '; pregão marcado para reavaliar';
      } catch (err: any) {
        store.logEvent({ tipo: 'erro_fonte', resumo: `monitor: diff da errata não calculado (${String(err?.message ?? err).slice(0, 80)}); pregão segue marcado para reavaliar`, tender: t.id });
      }
    }
    store.upsertTender({ ...t, situacao: nova, abertura: aberturaNova, aberturaAnalise,
      reavaliar: t.reavaliar || mudancas.length > 0, ultimoCheck: now().toISOString() });
    if (mudancas.length) {
      r.mudancas++;
      store.setReavaliar(t.id, true);
      store.logEvent({ tipo: 'monitor_mudanca', resumo: mudancas.join('; '), tender: t.id, detalhe });
    }
  }
  if (r.falhas) store.logEvent({ tipo: 'erro_fonte', resumo: `monitor: ${r.falhas} pregão(ões) sem resposta do PNCP; nova tentativa no próximo ciclo` });
  return r;
}
