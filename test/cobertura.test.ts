import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clausulasDoItem, inventarioCobertura } from '../src/lib/cobertura.ts';
import { tools, newState } from '../src/lib/tools.ts';

const item = 'Cabo bisturi características adicionais: longo, material: aço inoxidável, tamanho: nº 3';

test('só entra campo nomeado, separado por vírgula', () => {
  assert.deepEqual(clausulasDoItem('Comprimento de 4 a 6 mm.'), []);
  assert.deepEqual(clausulasDoItem(item), [
    'Cabo bisturi características adicionais: longo',
    'material: aço inoxidável',
    'tamanho: nº 3',
  ]);
});

test('campo sem citação própria continua de fora, mesmo se outra citação trouxer o texto inteiro', () => {
  const parcial = inventarioCobertura(item, [{ citacao_item: 'material: aço inoxidável' }]);
  assert.equal(parcial.cobertura, 'nao_verificada');
  assert.deepEqual(parcial.lacunas, ['Cabo bisturi características adicionais: longo', 'tamanho: nº 3']);
  const umaSo = inventarioCobertura(item, [{ citacao_item: item }]);
  assert.equal(umaSo.cobertura, 'nao_verificada');
  assert.equal(umaSo.lacunas.length, 2);
});

test('um atributo por campo, com a citação literal, confere a cobertura', () => {
  const r = inventarioCobertura(item, [
    { citacao_item: 'características adicionais: longo' },
    { citacao_item: 'material: aço inoxidável' },
    { citacao_item: 'tamanho: nº 3' },
  ]);
  assert.equal(r.cobertura, 'nao_verificada');
  const completo = inventarioCobertura(item, [
    { citacao_item: 'Cabo bisturi características adicionais: longo' },
    { citacao_item: 'material: aço inoxidável' },
    { citacao_item: 'tamanho: nº 3' },
  ]);
  assert.equal(completo.cobertura, 'conferida');
  assert.deepEqual(completo.lacunas, []);
});

test('record_fit grava a lacuna e só confere quando cada campo tem citação', async () => {
  const tool = tools.find(t => t.name === 'record_fit')!;
  const TID = '11111111000111/2026/1';
  const state = newState({ catalogo: [{ id: 'P1', ficha: 'Material: aço inoxidável. Tamanho: nº 3. Características adicionais: longo.' }] }, 'http://127.0.0.1:9');
  state.items[TID] = [{ numero: 1, descricao: item }];
  const ctx = { state, approvals: new Set<string>() };
  const falta: any = await tool.run({ tender_id: TID, item: 1, product_id: 'P1', attributes: [
    { atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável', citacao_ficha: 'Material: aço inoxidável' },
  ] }, ctx);
  assert.equal(falta.validacao.cobertura, 'nao_verificada');
  assert.ok(falta.lacunas.some((l: string) => l.includes('tamanho')));
  const ok: any = await tool.run({ tender_id: TID, item: 1, product_id: 'P1', attributes: [
    { atributo: 'adicional', veredito: 'atende', citacao_item: 'Cabo bisturi características adicionais: longo', citacao_ficha: 'Características adicionais: longo' },
    { atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável', citacao_ficha: 'Material: aço inoxidável' },
    { atributo: 'tamanho', veredito: 'atende', citacao_item: 'tamanho: nº 3', citacao_ficha: 'Tamanho: nº 3' },
  ] }, ctx);
  assert.equal(ok.validacao.cobertura, 'conferida');
  assert.deepEqual(ok.lacunas, []);
});
