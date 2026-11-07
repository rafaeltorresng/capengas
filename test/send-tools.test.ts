// As ferramentas de envio só passam pela porta. Sem store não há POST; preço do modelo não entra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pncp } from '../src/lib/data.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { tools, newState } from '../src/lib/tools.ts';
import { openStore } from '../src/lib/store.ts';
import { persistAnalysis } from '../src/lib/persist-analysis.ts';
import { filesHash, recheckTender } from '../src/lib/recheck.ts';
import { startSandbox } from '../src/lib/sandbox.ts';
import type { Recheque } from '../src/lib/contracts.ts';

const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const TENDER = '77816510000166/2026/348';
const ok: Recheque = { status: 'ok', situacao: 'Divulgada no PNCP', arquivosHash: 'abc', em: '2026-11-07T18:00:00.000Z' };
const tool = (name: string) => tools.find(t => t.name === name)!;

function cenario(url: string, o: { quantidade?: number; preco?: number; estado?: string; store?: boolean } = {}) {
  const store = openStore(':memory:');
  const state = newState(company, url, new Date('2026-11-07T18:00:00-03:00'));
  if (o.store !== false) state.store = store;
  state.recheck = async () => ok;
  state.tenders[TENDER] = { abertura: '2026-12-15T10:00', orgao: 'Hospital', uf: 'PR' };
  state.items[TENDER] = [{ numero: 40, descricao: 'Tesoura', quantidade: o.quantidade ?? 2, valorEstimado: 500 }];
  state.decisions[`${TENDER}#40`] = { estado: o.estado ?? 'disputar', motivos: ['ok'], produto: 'P1', product_id: 'P1', precoProposto: o.preco ?? 100 };
  state.drafts[`${TENDER}#40`] = { texto: 'Solicitamos informar a embalagem individual exigida no item, que não consta da ficha.' };
  if (o.store !== false) {
    persistAnalysis(state, store);
    const gravado = store.getTender(TENDER)!;
    store.upsertTender({ ...gravado, arquivosHash: 'foto-analise', reavaliar: false });
  }
  return { store, state, ctx: { approvals: new Set<string>(), state } };
}

test('sem store a proposta não sai', async () => {
  const sbx = await startSandbox(0);
  const { store, state, ctx } = cenario(sbx.url, { store: false });
  const r: any = await tool('submit_proposal').run({ tender_id: TENDER, itens: [40], precoUnitario: 1 }, ctx);
  assert.equal(r.resultado, 'bloqueada');
  assert.equal(sbx.propostas.size, 0);
  store.close();
  sbx.close();
});

test('proposta disputar confirma com o preço do store, ignorando preço no argumento', async () => {
  const sbx = await startSandbox(0);
  const { store, state, ctx } = cenario(sbx.url, { preco: 10, quantidade: 1 });
  const r: any = await tool('submit_proposal').run({ tender_id: TENDER, itens: [40], precoUnitario: 1, quantidade: 1 }, ctx);
  assert.equal(r.resultado, 'confirmada');
  const enviada = [...sbx.propostas.values()][0];
  assert.equal(enviada.itens[0].precoUnitario, 10);
  assert.equal(enviada.itens[0].quantidade, 1);
  store.close();
  sbx.close();
});

test('quantidade do store acima do limite escala e o portal fica vazio', async () => {
  const sbx = await startSandbox(0);
  const { store, state, ctx } = cenario(sbx.url, { quantidade: 1000, preco: 90 });
  const r: any = await tool('submit_proposal').run({ tender_id: TENDER, itens: [40] }, ctx);
  assert.equal(r.resultado, 'escalada');
  assert.match(r.motivo, /acima do limite/);
  assert.equal(sbx.propostas.size, 0);
  store.close();
  sbx.close();
});

test('pendência de cobertura não envia', async () => {
  const sbx = await startSandbox(0);
  const { store, state, ctx } = cenario(sbx.url, { estado: 'disputar_com_pendencia' });
  const r: any = await tool('submit_proposal').run({ tender_id: TENDER, itens: [40], approval_id: 'AP-1' }, ctx);
  assert.equal(r.resultado, 'escalada');
  assert.equal(sbx.propostas.size, 0);
  store.close();
  sbx.close();
});

test('esclarecimento sem evidência gravada não sai, mesmo com motivo automático', async () => {
  const sbx = await startSandbox(0);
  const { store, ctx } = cenario(sbx.url);
  const r: any = await tool('send_esclarecimento').run({ tender_id: TENDER, item: 40, motivo: 'nao_informado', prazoAberto: true }, ctx);
  assert.equal(r.resultado, 'escalada');
  assert.match(r.motivo, /não confere/);
  assert.equal(sbx.esclarecimentos.length, 0);
  assert.equal(store.openEscalations().filter(e => e.item === '40' && /não confere/.test(e.motivo)).length, 1);
  await tool('send_esclarecimento').run({ tender_id: TENDER, item: 40, motivo: 'nao_informado' }, ctx);
  assert.equal(store.openEscalations().filter(e => e.item === '40' && /não confere/.test(e.motivo)).length, 1);
  store.close();
  sbx.close();
});

test('esclarecimento com atributo não informado gravado confirma e o prazo vencido escala', async () => {
  const sbx = await startSandbox(0);
  const aberto = cenario(sbx.url);
  aberto.state.fits[`${TENDER}#40`] = { product_id: 'P1', overall: 'nao_informado', attributes: [{ atributo: 'embalagem', veredito: 'nao_informado', citacao_item: 'embalagem individual' }], validacao: { cobertura: 'nao_verificada' } };
  persistAnalysis(aberto.state, aberto.store);
  const gravado = aberto.store.getTender(TENDER)!;
  aberto.store.upsertTender({ ...gravado, arquivosHash: 'foto-analise', reavaliar: false });
  const okEnvio: any = await tool('send_esclarecimento').run({ tender_id: TENDER, item: 40, motivo: 'nao_informado', prazoAberto: false }, aberto.ctx);
  assert.equal(okEnvio.resultado, 'confirmada');
  assert.equal(sbx.esclarecimentos.length, 1);
  aberto.store.close();

  const vencido = cenario(sbx.url);
  vencido.state.fits[`${TENDER}#40`] = { product_id: 'P1', overall: 'nao_informado', attributes: [{ atributo: 'embalagem', veredito: 'nao_informado' }], validacao: {} };
  vencido.state.tenders[TENDER].abertura = '2026-11-09T10:00';
  persistAnalysis(vencido.state, vencido.store);
  const base = vencido.store.getTender(TENDER)!;
  vencido.store.upsertTender({ ...base, abertura: '2026-11-09T10:00', arquivosHash: 'foto-analise', reavaliar: false });
  const bloqueado: any = await tool('send_esclarecimento').run({ tender_id: TENDER, item: 40, motivo: 'nao_informado', prazoAberto: true }, vencido.ctx);
  assert.equal(bloqueado.resultado, 'escalada');
  assert.match(bloqueado.motivo, /prazo de esclarecimento vencido/);
  assert.equal(sbx.esclarecimentos.length, 1);
  vencido.store.close();
  sbx.close();
});

test('errata depois da foto não é absorvida pelo envio e o hash antigo permanece', async () => {
  const sbx = await startSandbox(0);
  const { store, state, ctx } = cenario(sbx.url);
  const edital = [{ seq: 1, titulo: 'Edital', tipo: 'Edital', url: 'http://edital' }];
  const hash = filesHash(edital);
  const atual = store.getTender(TENDER)!;
  store.upsertTender({ ...atual, arquivosHash: hash, reavaliar: false });
  const files = [...edital, { seq: 2, titulo: 'Errata', tipo: 'Aviso', url: 'http://errata' }];
  let fotos = 0;
  state.snapshot = async () => { fotos++; throw new Error('envio não pode gravar foto'); };
  state.recheck = (id, banco) => recheckTender(id, banco, {
    fetchCompra: async () => ({ situacaoCompraNome: 'Divulgada no PNCP', dataEncerramentoProposta: '2026-12-20T10:00:00' }),
    fetchFiles: async () => files,
  });
  const antes = store.events().filter(event => event.tipo === 'decisao').length;
  const r: any = await tool('submit_proposal').run({ tender_id: TENDER, itens: [40] }, ctx);
  assert.notEqual(r.resultado, 'confirmada');
  assert.equal(sbx.propostas.size, 0);
  assert.equal(fotos, 0);
  assert.equal(store.getTender(TENDER)?.arquivosHash, hash);
  assert.equal(store.events().filter(event => event.tipo === 'decisao').length, antes);
  store.close();
  sbx.close();
});

test('pregão marcado pelo monitor não é enviado', async () => {
  const sbx = await startSandbox(0);
  const { store, ctx } = cenario(sbx.url);
  const atual = store.getTender(TENDER)!;
  store.upsertTender({ ...atual, arquivosHash: 'foto-analise', reavaliar: true });
  const r: any = await tool('submit_proposal').run({ tender_id: TENDER, itens: [40] }, ctx);
  assert.equal(r.resultado, 'bloqueada');
  assert.match(r.motivo, /reavaliar antes de agir/);
  assert.equal(sbx.propostas.size, 0);
  assert.equal(store.getTender(TENDER)?.arquivosHash, 'foto-analise');
  store.close();
  sbx.close();
});

test('motivo sem evidência chega à fila humana uma vez por item, sem POST', async () => {
  const sbx = await startSandbox(0);
  const { store, ctx } = cenario(sbx.url);
  try {
    const args = { tender_id: TENDER, item: 40, motivo: 'nao_informado' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result: any = await tool('send_esclarecimento').run(args, ctx);
      assert.equal(result.resultado, 'escalada');
    }
    ctx.state.drafts[TENDER + '#99'] = ctx.state.drafts[TENDER + '#40'];
    const invalid: any = await tool('send_esclarecimento').run({ ...args, item: 99 }, ctx);
    assert.equal(invalid.resultado, 'bloqueada');
    const model = createReadModel(store, { actions: () => store.getActions() });
    assert.deepEqual(model.escaladas().map(row => [row.tender, row.item]), [[TENDER, '40']]);
    assert.equal(store.events().filter(event => event.tipo === 'escalada_aberta').length, 1);
    assert.equal(sbx.esclarecimentos.length, 0);
  } finally {
    store.close();
    sbx.close();
  }
});

test('verifica proposta e esclarecimento no portal usando o store, mesmo em uma nova sessão', async t => {
  const sbx = await startSandbox(0);
  const { store, state, ctx } = cenario(sbx.url);
  t.mock.method(pncp, 'compra', async () => ({
    situacaoCompraNome: 'Divulgada no PNCP', dataEncerramentoProposta: '2026-12-15T10:00:00',
  }));
  try {
    store.upsertFit({ tenderId: TENDER, item: 40, produto: 'P1', fit: 'nao_informado',
      atributos: { attributes: [{ atributo: 'embalagem', veredito: 'nao_informado' }] } });
    const proposal: any = await tool('submit_proposal').run({ tender_id: TENDER, itens: [40] }, ctx);
    const question: any = await tool('send_esclarecimento').run({ tender_id: TENDER, item: 40, motivo: 'nao_informado' }, ctx);
    assert.equal(proposal.resultado, 'confirmada');
    assert.equal(question.resultado, 'confirmada');

    const freshState = newState(company, sbx.url, state.now);
    freshState.store = store;
    const fresh = { approvals: new Set<string>(), state: freshState };
    for (const result of [proposal, question]) {
      const verified: any = await tool('verify_submission').run({ tender_id: TENDER, protocolo: result.protocolo }, fresh);
      assert.equal(verified.portal_confere, true);
      assert.equal(verified.ok, true);
    }

    sbx.propostas.get(proposal.protocolo).itens[0].quantidade = 999;
    const mismatch: any = await tool('verify_submission').run({ tender_id: TENDER, protocolo: proposal.protocolo }, fresh);
    assert.equal(mismatch.portal_confere, false);
    const wrongTender: any = await tool('verify_submission').run({ tender_id: '11111111000111/2026/1', protocolo: question.protocolo }, fresh);
    assert.equal(wrongTender.ok, false);
    assert.equal(sbx.propostas.size, 1);
    assert.equal(sbx.esclarecimentos.length, 1);
  } finally {
    store.close();
    sbx.close();
  }
});
test('um encaixe antigo de outro produto não justifica esclarecer', async () => {
  const sbx = await startSandbox(0);
  const { store, ctx } = cenario(sbx.url);
  try {
    store.upsertFit({ tenderId: TENDER, item: 40, produto: 'P0-antigo', fit: 'nao_informado',
      atributos: { attributes: [{ atributo: 'embalagem', veredito: 'nao_informado' }] } });
    store.upsertFit({ tenderId: TENDER, item: 40, produto: 'P1', fit: 'atende',
      atributos: { attributes: [{ atributo: 'embalagem', veredito: 'atende' }] } });
    const result: any = await tool('send_esclarecimento').run({ tender_id: TENDER, item: 40, motivo: 'nao_informado' }, ctx);
    assert.equal(result.resultado, 'escalada');
    assert.equal(store.openEscalations().length, 1);
    assert.equal(sbx.esclarecimentos.length, 0);
  } finally {
    store.close();
    sbx.close();
  }
});