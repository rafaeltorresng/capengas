import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tools, newState } from '../src/lib/tools.ts';
import { anvisa, compras } from '../src/lib/data.ts';
afterEach(() => mock.restoreAll());
const tid = '11111111000111/2026/1';
function setup() {
  mock.method(anvisa, 'byRegistro', () => ({ VALIDADE_REGISTRO_CADASTRO: 'VIGENTE' }));
  mock.method(compras, 'priceHistory', () => { throw new Error('histórico não deve decidir'); });
  const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
  const state = newState(company, 'http://127.0.0.1:9', new Date('2026-11-07T12:00:00-03:00'));
  state.tenders[tid] = { abertura: '2026-11-23T09:00' };
  state.items[tid] = [{ numero: 1, descricao: 'Produto', quantidade: 2, valorEstimado: 10, sigiloso: false }];
  state.fits[tid + '#1'] = { product_id: 'P1', overall: 'atende', validacao: { cobertura: 'nao_verificada' }, attributes: [] };
  return { state, approvals: new Set<string>() };
}
test('decide_item usa estimativa sem exigir código e escala cobertura técnica desconhecida', async () => {
  const ctx = setup();
  const tool = tools.find(t => t.name === 'decide_item')!;
  assert.ok(!tool.parameters.required!.includes('catalog_code'));
  const d: any = await tool.run({ tender_id: tid, item: 1, product_id: 'P1' }, ctx);
  assert.equal(d.estado, 'escalar');
  assert.equal(d.precoProposto, 7.5);
  assert.equal(d.anvisa.cobertura, 'nao_comprovada');
});
test('orçamento sigiloso não produz preço', async () => {
  const ctx = setup(); ctx.state.items[tid][0].sigiloso = true;
  const d: any = await tools.find(t => t.name === 'decide_item')!.run({ tender_id: tid, item: 1, product_id: 'P1' }, ctx);
  assert.equal(d.precoProposto, null);
  assert.equal(d.estado, 'escalar');
});
