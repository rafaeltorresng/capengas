import type { Store } from './contracts.ts';
import type { LanceState } from './tools.ts';
import { buildDossie } from './dossie.ts';
import { checkDocs } from './rules.ts';

// Persiste somente o resultado da análise; não autoriza ou executa ações no portal.
export function persistAnalysis(state: LanceState, store: Store) {
  let decisions = 0;
  for (const [id, tender] of Object.entries(state.tenders)) {
    if (!state.items[id]) continue;
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
        fit: fit.validacao?.cobertura === 'conferida' ? fit.overall : 'desconhecido', atributos: { attributes: fit.attributes, validacao: fit.validacao } });
    }
    const docs = tender.abertura ? checkDocs(state.company.cofre, requirements.map(r => ({ tipo: r.requirement, citacao: r.quote })), tender.abertura.slice(0, 10)) : [];
    store.upsertDossie(id, buildDossie(state, id, { documentos: docs }));
    for (const [key, d] of Object.entries(state.decisions)) {
      if (!key.startsWith(id + '#') || !d.estado) continue;
      const item = Number(key.split('#')[1]);
      store.upsertDecision({ tenderId: id, item, produto: d.produto, estado: d.estado, motivos: d.motivos, precoProposto: d.precoProposto });
      store.logEvent({ tipo: 'decisao', resumo: d.motivos.join('; '), tender: id, item: String(item), dossie: true });
      decisions++;
      if (['escalar', 'disputar_com_pendencia'].includes(d.estado) && tender.abertura) {
        const exists = store.openEscalations().some(e => e.tender === id && e.item === String(item));
        if (!exists) store.openEscalation({ tender: id, item: String(item), motivo: d.motivos.join('; '), recomendacao: 'Revisar as evidências e recalcular a decisão antes de agir.',
          prazo: /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(tender.abertura) ? tender.abertura + ':00-03:00' : tender.abertura });
      }
    }
  }
  return { decisoes: decisions };
}
