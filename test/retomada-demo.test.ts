import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { executarAcao } from '../src/lib/act.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { openStore } from '../src/lib/store.ts';
import { newState } from '../src/lib/tools.ts';
import { runAnalysisTurn } from '../src/lib/turn.ts';
import { prepararDocumento, renderizarPdf } from '../src/server/documentos.ts';
import { criarDecisaoDemo } from '../src/server/retomada-demo.ts';

test('decisões retomam o mesmo turno e liberam apenas a minuta de demonstração', async t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const tender = '77816510000166/2026/348';
  const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
  const state = newState(company, '');
  state.tenders[tender] = { abertura: '2099-11-23T09:00', orgao: 'Hospital' };
  state.items[tender] = [1, 2, 3].map(numero => ({ numero, descricao: `Produto ${numero}`, quantidade: 2 }));
  for (const { numero } of state.items[tender]) {
    state.decisions[tender + '#' + numero] = { estado: 'disputar_com_pendencia', produto: company.catalogo[0].id, motivos: ['Conferir entrega'], precoProposto: 100 };
  }
  await runAnalysisTurn({ state, store, origem: 'direto', turnoId: 'demo', acompanhar: true, run: async () => ({ stopped: 'final' }) });
  const model = createReadModel(store, { actions: () => store.getActions() });
  const decidir = criarDecisaoDemo(store, model, company, async () => {});
  const [primeira, segunda, terceira] = store.openEscalations();

  const aprovacao = decidir(primeira.id, { decisao: 'aprovar' });
  assert.equal(aprovacao.status === 'salva' && aprovacao.registro.turno, 'demo');
  assert.equal(model.turnos().turnos[0].status, 'ativo');
  await setImmediate();
  assert.equal(model.turnos().turnos[0].status, 'incompleto');
  assert.equal(model.dossie(tender)?.proposta, undefined);

  decidir(segunda.id, { decisao: 'recusar' });
  decidir(terceira.id, { decisao: 'ajustar', ajuste: 'Entregar em duas remessas.' });
  await setImmediate();
  const dossie = model.dossie(tender)!;
  assert.equal(model.turnos().turnos[0].status, 'concluido');
  assert.deepEqual(dossie.proposta?.itens.map(i => i.numero), [1, 3]);
  assert.equal(dossie.itens[1].estado, 'nao_disputar');
  assert.match(dossie.itens[2].motivos.join(' '), /duas remessas/);
  assert.equal(store.openEscalations().length, 0);
  assert.ok('continuacaoSimulada' in dossie && dossie.continuacaoSimulada);
  const pdf = prepararDocumento(dossie, 'proposta');
  assert.match(pdf.markdown, /confirmação do encaixe foram simuladas/);
  assert.equal((await renderizarPdf(pdf)).subarray(0, 5).toString(), '%PDF-');
  const envio = await executarAcao({ tipo: 'enviar_proposta', tenderId: tender, itens: [1, 3] },
    { store, politica: company.politica, empresa: company.empresa.nome, catalogo: company.catalogo, sandboxUrl: '' });
  assert.equal(envio.resultado, 'bloqueada');
  assert.deepEqual(store.getActions(), []);
});
