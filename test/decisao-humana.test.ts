// Decisão humana na pendência volta para o agente e para o envio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/lib/store.ts';
import { instrucaoHumana, pendenciasAprovadas, jaDecidida, itensRecusados } from '../src/lib/decisao-humana.ts';

const T = '05012896000142/2026/1298';
function comDecisao(item: string, motivo: string, decisao: 'aprovar' | 'recusar' | 'ajustar', ajuste?: string, analiseId?: string) {
  const store = openStore(':memory:');
  const e = store.openEscalation({ tender: T, item, motivo, analiseId, recomendacao: 'r', prazo: '2099-01-01T00:00:00-03:00' });
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

test('aprovação vale para o mesmo item, análise e conjunto exato de motivos', () => {
  const motivos = ['confirmar cobertura ANVISA', 'Operação: confirmar prazo de entrega'];
  const store = comDecisao('26', motivos.join('; '), 'aprovar', undefined, 'atual');
  assert.equal(pendenciasAprovadas(store, T, 'atual', 26, motivos), true);
  assert.equal(pendenciasAprovadas(store, T, 'nova', 26, motivos), false);
  assert.equal(pendenciasAprovadas(store, T, 'atual', 27, motivos), false);
  assert.equal(pendenciasAprovadas(store, T, 'atual', 26, [motivos[0], 'Operação: amostra em 24 horas']), false);
  assert.equal(instrucaoHumana(store, T), '');
  store.close();
  const legado = comDecisao('26', motivos.join('; '), 'aprovar');
  assert.equal(pendenciasAprovadas(legado, T, 'atual', 26, motivos), false);
  assert.equal(pendenciasAprovadas(legado, T, undefined, 26, motivos), false);
  legado.close();
});
