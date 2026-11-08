import type { Store } from './contracts.ts';
import type { LanceState } from './tools.ts';
import { buildDossie } from './dossie.ts';
import { checkDocs } from './rules.ts';
import { aplicarOperacao } from './operacao.ts';
import type { QueueItem } from '../server/contract.ts';
import type { LanceStore } from './store.ts';
import { jaDecidida } from './decisao-humana.ts';

// Persiste somente o resultado da análise; não autoriza ou executa ações no portal.
export function persistAnalysis(state: LanceState, store: Store, options: { analiseId?: string } = {}) {
  let decisions = 0;
  const items: Pick<QueueItem, 'tender' | 'item'>[] = [];
  for (const [id, tender] of Object.entries(state.tenders)) {
    if (!state.items[id]) continue;
    aplicarOperacao(state, id);
    const previous = store.getTender(id);
    store.upsertTender({ id, orgao: tender.orgao ?? '', uf: tender.uf ?? '', abertura: tender.abertura ?? null,
      situacao: previous?.situacao ?? 'nao_verificada', plataforma: tender.sistema ?? previous?.plataforma ?? '',
      arquivosHash: previous?.arquivosHash ?? null, ultimoCheck: previous?.ultimoCheck ?? null, reavaliar: previous?.reavaliar });
    store.upsertItems(id, state.items[id].map(i => ({ tenderId: id, numero: i.numero, descricao: i.descricao,
      quantidade: i.quantidade, estimativa: i.valorEstimado ?? null, catalogCode: i.catalogCode ?? null, sigiloso: i.sigiloso === true })));
    const requirements = state.requirements.filter(r => r.tender_id === id);
    for (const r of requirements) store.upsertRequirement({ tenderId: id, tipo: r.requirement, citacao: r.quote });
    for (const [key, fit] of Object.entries(state.fits)) {
      if (!key.startsWith(id + '#')) continue;
      store.upsertFit({ tenderId: id, item: Number(key.split('#')[1]), produto: fit.product_id,
        fit: fit.validacao?.cobertura === 'conferida' ? fit.overall : 'desconhecido',
        atributos: { attributes: fit.attributes, validacao: fit.validacao, restritivo: state.restrictive[key]?.evidence ?? null, varianteNaoCoberta: fit.varianteNaoCoberta === true } });
    }
    const docs = tender.abertura ? checkDocs(state.company.cofre, requirements.map(r => ({ tipo: r.requirement, citacao: r.quote })), tender.abertura.slice(0, 10)) : [];
    store.upsertDossie(id, buildDossie(state, id, { documentos: docs, analiseId: options.analiseId }));
    for (const [key, d] of Object.entries(state.decisions)) {
      if (!key.startsWith(id + '#') || !d.estado) continue;
      const item = Number(key.split('#')[1]);
      store.upsertDecision({ tenderId: id, item, produto: d.produto, estado: d.estado, motivos: d.motivos, precoProposto: d.precoProposto });
      store.logEvent({ tipo: 'decisao', resumo: d.motivos.join('; '), tender: id, item: String(item), dossie: true });
      decisions++;
      items.push({ tender: id, item: String(item) });
      if (['escalar', 'disputar_com_pendencia'].includes(d.estado) && tender.abertura) {
        const operacional = d.motivos.some((m: string) => m.startsWith('Operação: '));
        const motivo = d.motivos.join('; ');
        const exists = store.openEscalations().some(e => e.tender === id && e.item === String(item) && e.analiseId === options.analiseId && e.motivo === motivo)
          || jaDecidida(store as LanceStore, id, String(item), motivo);
        if (!exists) store.openEscalation({ tender: id, item: String(item), analiseId: options.analiseId, motivo, recomendacao: operacional ? 'Conferir as condições listadas. A aprovação vale para as pendências desta análise; recusar descarta o item; solicitar ajuste faz o agente reanalisar com o seu texto.' : 'Revisar as evidências. A aprovação vale para as pendências desta análise; recusar descarta o item; solicitar ajuste faz o agente reanalisar com o seu texto.',
          prazo: /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(tender.abertura) ? tender.abertura + ':00-03:00' : tender.abertura });
      }
    }
    // Encaixe gravado sem decisão (limite do agente, interrupção): o item não pode sumir; vai para o humano.
    for (const key of Object.keys(state.fits)) {
      if (!key.startsWith(id + '#') || state.decisions[key]?.estado) continue;
      const item = key.split('#')[1];
      if (store.openEscalations().some(e => e.tender === id && e.item === item)) continue;
      const fit = state.fits[key];
      const lacunas: string[] = fit?.validacao?.cobertura === 'conferida' ? [] : fit?.validacao?.lacunas ?? [];
      store.openEscalation({ tender: id, item, motivo: 'análise encerrada sem decisão calculada para o item: o encaixe foi registrado, mas decide_item não concluiu'
        + (lacunas.length ? `; sem citação própria para ${lacunas.map(l => `"${l}"`).join(', ')}` : ''),
        recomendacao: 'Reanalisar o item ou decidir manualmente com as evidências gravadas.',
        prazo: tender.abertura && /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(tender.abertura) ? tender.abertura + ':00-03:00' : tender.abertura ?? new Date(state.now.getTime() + 864e5).toISOString() });
    }
  }
  return { decisoes: decisions, items };
}
