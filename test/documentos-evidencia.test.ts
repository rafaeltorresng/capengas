import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarRegra, type RegraProposta } from '../src/lib/regras-proposta.ts';
import { registrarExigencia, type ExigenciaDocumental } from '../src/lib/plano-documentos.ts';
import { casasDecimaisDe } from '../src/lib/documento-proposta.ts';

test('resumo do modelo não acrescenta um número ausente da citação da regra', () => {
  const quote = 'A validade da proposta será de 90 dias corridos.';
  const docs = [{ nome: 'edital', url: 'https://example.org/edital', texto: quote }];
  const regras: RegraProposta[] = [];
  assert.equal(registrarRegra(docs, regras, { campo: 'validade_proposta', valor: '120 dias', citacao: quote }).aceito, false);
  assert.equal(regras.length, 0);
  assert.equal(registrarRegra(docs, regras, { campo: 'validade_proposta', valor: '90 dias', citacao: quote }).aceito, true);
  assert.equal(registrarRegra([{ ...docs[0], texto: 'Envie a proposta em campo próprio do sistema eletrônico.' }], [], {
    campo: 'forma_envio', valor: 'Envie para nao-citado@example.org', citacao: 'Envie a proposta em campo próprio do sistema eletrônico.',
  }).aceito, false);
});
test('prazo do documento sai do trecho e o modelo não remove condição escrita', () => {
  const quote = 'Se solicitada pelo pregoeiro, entregar amostra no prazo de 3 dias úteis.';
  const lista: ExigenciaDocumental[] = [];
  registrarExigencia([{ nome: 'edital', url: 'https://example.org/edital', texto: quote }], lista,
    { tipo: 'amostra', citacao: quote, prazo: '10 dias úteis', condicoes: ['sempre'] });
  assert.equal(lista[0].prazo, '3 dias úteis');
  assert.ok(lista[0].condicoes.includes('se_solicitado'));
  assert.ok(!lista[0].condicoes.includes('sempre'));
});
test('casas decimais vêm da citação antes de qualquer resumo', () => {
  assert.equal(casasDecimaisDe([{ campo: 'casas_decimais', valor: '4 casas decimais', citacao: 'Utilizar no máximo 2 casas decimais.' }]), 2);
});
