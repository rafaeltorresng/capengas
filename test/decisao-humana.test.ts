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

test('aprovação vale para os motivos da hora: condição operacional nova reabre a revisão e não é enviada', () => {
  const store = openStore(':memory:');
  const motivos = ['confirmar que o registro ANVISA cobre o modelo ofertado', 'Operação: Prazo de entrega — Precisa confirmar.'];
  store.upsertDecision({ tenderId: T, item: 26, produto: 'P1', estado: 'disputar_com_pendencia', motivos, precoProposto: 10 });
  const resumo = 'confirmar que o registro ANVISA cobre o modelo ofertado; Operação: conferir condições para fornecer antes de participar.';
  const e = store.openEscalation({ tender: T, item: '26', motivo: resumo, recomendacao: 'r', prazo: '2099-01-01T00:00:00-03:00' });
  store.resolveEscalation(e.id, { decisao: 'aprovar' });
  assert.deepEqual(pendenciasAprovadas(store, T, 26, motivos), motivos);
  assert.equal(jaDecidida(store, T, '26', resumo, motivos), true);
  const novos = [...motivos, 'Operação: Amostra — apresentar em 24 horas.'];
  assert.deepEqual(pendenciasAprovadas(store, T, 26, novos), motivos);
  assert.equal(jaDecidida(store, T, '26', resumo, novos), false, 'condição nova reabre a revisão');
  assert.deepEqual(pendenciasAprovadas(store, T, 27, motivos), []);
  // Ajuste não aprova nada: o agente reanalisa antes.
  const ajuste = comDecisao('26', motivos[0], 'ajustar', 'rever');
  assert.deepEqual(pendenciasAprovadas(ajuste, T, 26, motivos), []);
  store.close(); ajuste.close();
});
