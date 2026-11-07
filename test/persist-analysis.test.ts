import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { newState } from '../src/lib/tools.ts';
import { persistAnalysis } from '../src/lib/persist-analysis.ts';
import { createReadModel } from '../src/lib/read-model.ts';
test('análise persiste decisão, dossiê, evento e uma escalada sem duplicá-la', () => {
  const now = new Date('2026-11-07T12:00:00-03:00');
  const store = openStore(':memory:', { now: () => now });
  try {
    const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
    const state = newState(company, 'http://127.0.0.1:9', now);
    const id = '11111111000111/2026/1';
    state.tenders[id] = { abertura: '2026-11-23T09:00', orgao: 'Teste' };
    state.items[id] = [{ numero: 1, descricao: 'Produto de teste', quantidade: 2, valorEstimado: 10 }];
    state.decisions[id + '#1'] = { estado: 'escalar', motivos: ['Cobertura desconhecida'], produto: 'P1', precoProposto: 7.5 };
    persistAnalysis(state, store); persistAnalysis(state, store);
    const model = createReadModel(store, { actions: () => store.getActions(), now: () => now });
    assert.equal(model.fila().length, 1);
    assert.equal(model.dossie(id)!.itens[0].precoUnitario, 7.5);
    assert.equal(model.hoje().itens, 1);
    assert.equal(model.escaladas().length, 1);
    assert.equal(store.getActions().length, 0);
  } finally { store.close(); }
});
