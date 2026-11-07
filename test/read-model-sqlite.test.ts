import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/lib/store.ts';
import { createReadModel } from '../src/lib/read-model.ts';

const NOW = new Date('2026-11-07T16:00:00-03:00');
const TID = '77816510000166/2026/348';

describe('projeção com SQLite do Dev 1', () => {
  test('lê dossiê, decisão e ação verificada depois de reabrir o arquivo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lance-read-model-'));
    const path = join(dir, 'lance.db');
    let store = openStore(path, { now: () => NOW });
    try {
      const sample = JSON.parse(readFileSync(new URL('../fixtures/estado-exemplo.json', import.meta.url), 'utf8'));
      store.upsertTender({ id: TID, orgao: 'Município de Francisco Beltrão', uf: 'PR', abertura: '2026-11-23T09:00', situacao: 'Divulgada', plataforma: 'Compras.gov.br', arquivosHash: null, ultimoCheck: null });
      store.upsertItems(TID, sample.dossies[0].itens.map((i: any) => ({ tenderId: TID, numero: i.item, descricao: i.descricao, quantidade: i.quantidade, estimativa: i.estimativa, catalogCode: null, sigiloso: false })));
      store.upsertDecision({ tenderId: TID, item: 40, produto: 'P2', estado: 'nao_disputar', motivos: ['Haste incompatível'], precoProposto: null });
      store.upsertDossie(TID, sample.dossies[0]);
      store.logEvent({ tipo: 'decisao', resumo: 'Decisão de teste', tender: TID, item: '40' });
      store.recordIntent({ key: 'action-test', tipo: 'esclarecimento', tenderId: TID, payload: { teste: true } });
      store.updateAction('action-test', { status: 'confirmada', verificado: true, protocolo: 'SBX-TESTE' });
      store.close(); store = openStore(path, { now: () => NOW });
      const model = createReadModel(store, { actions: () => store.getActions(), now: () => NOW });
      assert.equal(model.hoje().itens, 1);
      assert.equal(model.hoje().envios, 1);
      assert.equal(model.item(TID, '40')!.encaixe[0].fonte!.citacao, 'haste: haste reta');
      assert.equal(model.dossie(TID)!.tender, TID);
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
  test('resolução e auditoria persistem uma só vez quando feitas pela projeção', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lance-read-model-'));
    const path = join(dir, 'lance.db');
    let store = openStore(path, { now: () => NOW });
    try {
      const escalation = store.openEscalation({ tender: TID, item: '4', motivo: 'Ficha incompleta', recomendacao: 'Conferir ficha', prazo: '2026-11-23T09:00:00-03:00' });
      const model = createReadModel(store, { actions: () => store.getActions(), now: () => NOW });
      assert.equal(model.decidir(escalation.id, { decisao: 'ajustar', ajuste: 'Solicitar ficha' }).status, 'salva');
      store.close(); store = openStore(path, { now: () => NOW });
      assert.equal(store.openEscalations().length, 0);
      assert.equal(store.events().filter(e => e.tipo === 'escalada_decidida').length, 1);
      assert.equal(store.resolveEscalation(escalation.id, { decisao: 'aprovar' }).status, 'resolvida');
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
