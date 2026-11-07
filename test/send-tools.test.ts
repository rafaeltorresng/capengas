// As ferramentas de envio só passam pela porta. Sem store não há POST; preço do modelo não entra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tools, newState } from '../src/lib/tools.ts';
import { openStore } from '../src/lib/store.ts';
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

test('esclarecimento usa o rascunho e o prazo da abertura, não um flag do modelo', async () => {
  const sbx = await startSandbox(0);
  const aberto = cenario(sbx.url);
  const okEnvio: any = await tool('send_esclarecimento').run({ tender_id: TENDER, item: 40, motivo: 'nao_informado', prazoAberto: false }, aberto.ctx);
  assert.equal(okEnvio.resultado, 'confirmada');
  assert.equal(sbx.esclarecimentos.length, 1);
  aberto.store.close();

  const vencido = cenario(sbx.url);
  vencido.state.tenders[TENDER].abertura = '2026-11-09T10:00';
  const bloqueado: any = await tool('send_esclarecimento').run({ tender_id: TENDER, item: 40, motivo: 'nao_informado', prazoAberto: true }, vencido.ctx);
  assert.equal(bloqueado.resultado, 'escalada');
  assert.equal(sbx.esclarecimentos.length, 1);
  vencido.store.close();
  sbx.close();
});
