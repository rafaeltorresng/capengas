// Decisão humana na pendência volta para o agente e para o envio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/lib/store.ts';
import { instrucaoHumana, pendenciasAprovadas, jaDecidida, itensRecusados } from '../src/lib/decisao-humana.ts';

const T = '05012896000142/2026/1298';
function comDecisao(item: string, motivo: string, decisao: 'aprovar' | 'recusar' | 'ajustar', ajuste?: string) {
  const store = openStore(':memory:');
  const e = store.openEscalation({ tender: T, item, motivo, recomendacao: 'r', prazo: '2099-01-01T00:00:00-03:00' });
  store.resolveEscalation(e.id, { decisao, ...(ajuste ? { ajuste } : {}) });
  return store;
}

test('ajuste escrito pelo humano entra no prompt do agente, com o item', () => {
  const store = comDecisao('106', 'cobertura técnica não verificada', 'ajustar', 'Considere o comprimento de 135 mm do Termo de Referência');
  const txt = instrucaoHumana(store, T);
  assert.match(txt, /item 106/);
  assert.match(txt, /Considere o comprimento de 135 mm/);
  assert.match(txt, /reanalise/i);
  assert.equal(instrucaoHumana(store, 'outro/2026/1'), '');
  store.close();
});

test('recusa: item sai da análise e do envio, e a mesma pendência não reabre', () => {
  const store = comDecisao('106', 'confirmar cobertura', 'recusar');
  assert.match(instrucaoHumana(store, T), /item 106.*recusou/);
  assert.deepEqual(itensRecusados(store, T), [106]);
  assert.equal(jaDecidida(store, T, '106', 'confirmar cobertura'), true);
  assert.equal(jaDecidida(store, T, '106', 'outro motivo'), false);
  store.close();
});

test('aprovação: as pendências da escalada viram pendências aprovadas para o envio', () => {
  const store = comDecisao('26', 'confirmar que o registro ANVISA cobre o modelo ofertado; Operação: conferir condições para fornecer antes de participar.', 'aprovar');
  const motivos = ['confirmar que o registro ANVISA cobre o modelo ofertado', 'Operação: Prazo de entrega — Precisa confirmar.'];
  assert.deepEqual(pendenciasAprovadas(store, T, 26, motivos), motivos);
  assert.deepEqual(pendenciasAprovadas(store, T, 26, [...motivos, 'CND Federal: vence antes sessao']), motivos);
  assert.deepEqual(pendenciasAprovadas(store, T, 27, motivos), []);
  // Ajuste não aprova nada: o agente reanalisa antes.
  const ajuste = comDecisao('26', 'confirmar que o registro ANVISA cobre o modelo ofertado', 'ajustar', 'rever');
  assert.deepEqual(pendenciasAprovadas(ajuste, T, 26, motivos), []);
  store.close(); ajuste.close();
});
