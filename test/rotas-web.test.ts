import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dossierRoute, itemRoute, turnoRoute } from '../web/lib/routes.ts';

const tender = '77816510000166/2026/348';

test('item e dossiê aceitam o identificador do PNCP depois que o navegador decodifica a barra', () => {
  const item = itemRoute('itens/77816510000166/2026/348/40');
  assert.equal(item?.tender, tender);
  assert.equal(item?.item, '40');
  assert.equal(item?.api, 'itens/' + encodeURIComponent(tender) + '/40');
  const dossier = dossierRoute('dossies/77816510000166/2026/348');
  assert.equal(dossier?.tender, tender);
  assert.equal(dossier?.api, 'dossies/' + encodeURIComponent(tender));
});

test('item e dossiê também aceitam o identificador ainda codificado', () => {
  const encoded = encodeURIComponent(tender);
  assert.equal(itemRoute('itens/' + encoded + '/40')?.tender, tender);
  assert.equal(dossierRoute('dossies/' + encoded)?.tender, tender);
  assert.equal(itemRoute('itens/demo-17/40')?.api, 'itens/demo-17/40');
});

test('rotas incompletas não viram item nem dossiê', () => {
  assert.equal(itemRoute('itens/demo-17'), null);
  assert.equal(itemRoute('itens//40'), null);
  assert.equal(dossierRoute('dossies/'), null);
  assert.equal(turnoRoute('turnos')?.id, null);
  assert.equal(turnoRoute('turnos/amostra-concluida')?.id, 'amostra-concluida');
  assert.equal(turnoRoute('hoje'), null);
});
