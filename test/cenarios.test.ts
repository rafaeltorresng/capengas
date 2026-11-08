import { test, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executarCenarios } from '../src/lib/cenarios.ts';
import { tools, newState } from '../src/lib/tools.ts';
import { anvisa, compras } from '../src/lib/data.ts';

afterEach(() => mock.restoreAll());

test('os 10 cenários de exceção passam sem modelo e sem rede', async () => {
  const cenarios = await executarCenarios();
  assert.deepEqual(cenarios.filter(c => !c.passou), []);
  assert.equal(cenarios.length, 10);
});

test('decide_item pede esclarecimento quando o atributo falta e o prazo legal está aberto', async () => {
  mock.method(anvisa, 'byRegistro', () => ({ VALIDADE_REGISTRO_CADASTRO: 'VIGENTE' }));
  mock.method(compras, 'priceHistory', () => { throw new Error('histórico não deve decidir'); });
  const company = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));
  const tid = '11111111000111/2026/1';
  const state = newState(company, 'http://127.0.0.1:9', new Date('2026-11-07T12:00:00-03:00'));
  state.tenders[tid] = { abertura: '2026-11-23T09:00' };
  state.items[tid] = [{ numero: 1, descricao: 'material: aço', quantidade: 2, valorEstimado: 10, sigiloso: false }];
  state.fits[tid + '#1'] = { product_id: 'P1', overall: 'nao_informado', varianteNaoCoberta: false, validacao: { cobertura: 'conferida' },
    attributes: [{ atributo: 'embalagem', veredito: 'nao_informado' }] };
  const d: any = await tools.find(t => t.name === 'decide_item')!.run({ tender_id: tid, item: 1, product_id: 'P1' }, { state, approvals: new Set() });
  assert.equal(d.estado, 'esclarecer');
});

test('decide_item não disputa variante fora da ficha enquanto o prazo está aberto', async () => {
  mock.method(anvisa, 'byRegistro', () => ({ VALIDADE_REGISTRO_CADASTRO: 'VIGENTE' }));
  mock.method(compras, 'priceHistory', () => { throw new Error('histórico não deve decidir'); });
  const company = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));
  const tid = '11111111000111/2026/1';
  const state = newState(company, 'http://127.0.0.1:9', new Date('2026-11-07T12:00:00-03:00'));
  state.tenders[tid] = { abertura: '2026-11-23T09:00' };
  state.items[tid] = [{ numero: 1, descricao: 'variante: tamanho 00', quantidade: 2, valorEstimado: 10, sigiloso: false }];
  state.fits[tid + '#1'] = { product_id: 'P1', overall: 'nao_atende', validacao: { cobertura: 'conferida' },
    attributes: [{ atributo: 'variante', veredito: 'nao_atende' }] };
  const d: any = await tools.find(t => t.name === 'decide_item')!.run({ tender_id: tid, item: 1, product_id: 'P1' }, { state, approvals: new Set() });
  assert.equal(d.estado, 'esclarecer');
  assert.notEqual(d.estado, 'disputar');
});
