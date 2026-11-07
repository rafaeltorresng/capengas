// Recheque antes de agir: situação do pregão e lista de arquivos, lidos na hora, contra a foto da análise.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../src/lib/store.ts';
import { recheckTender, snapshotTender, filesHash } from '../src/lib/recheck.ts';

const T = '80257355000108/2026/493';
const files = [
  { seq: 1, titulo: 'EDITAL - PE 076-2026.pdf', tipo: 'Edital', url: 'https://pncp.gov.br/a/1' },
  { seq: 2, titulo: 'TERMO DE REFERENCIA.pdf', tipo: 'Termo de Referência', url: 'https://pncp.gov.br/a/2' },
];
const NOW = new Date('2026-11-07T15:00:00-03:00');
const compra = (situacaoCompraNome: string, dataEncerramentoProposta = '2026-11-23T09:00:00') => ({ situacaoCompraNome, dataEncerramentoProposta });
const fetchers = (c: any, f = files) => ({ fetchCompra: async () => c, fetchFiles: async () => f, now: () => NOW });

async function prepared(c: any = compra('Divulgada no PNCP')) {
  const store = openStore(':memory:', { now: () => NOW });
  await snapshotTender(T, store, { ...fetchers(c), base: { orgao: 'UEPG', uf: 'PR', abertura: '2026-11-23', plataforma: 'Compras.gov.br' } });
  return store;
}

describe('filesHash', () => {
  test('não depende da ordem dos arquivos', () => assert.equal(filesHash(files), filesHash([...files].reverse())));
  test('muda quando entra um arquivo novo', () => assert.notEqual(filesHash(files), filesHash([...files, { seq: 3, titulo: 'ERRATA.pdf', tipo: 'Outros Documentos', url: 'u' }])));
});

describe('snapshotTender', () => {
  test('grava situação e hash dos arquivos no store', async () => {
    const s = await prepared();
    const t = s.getTender(T)!;
    assert.equal(t.situacao, 'Divulgada no PNCP');
    assert.equal(t.arquivosHash, filesHash(files));
    assert.equal(t.orgao, 'UEPG');
  });
});

describe('recheckTender', () => {
  test('pregão divulgado e arquivos iguais → ok; atualiza o último check', async () => {
    const s = await prepared();
    const r = await recheckTender(T, s, fetchers(compra('Divulgada no PNCP')));
    assert.equal(r.status, 'ok');
    if (r.status === 'ok') assert.equal(r.arquivosHash, filesHash(files));
    assert.equal(s.getTender(T)?.ultimoCheck, NOW.toISOString());
  });
  for (const [nome, motivo] of [['Suspensa', 'suspenso'], ['Revogada', 'revogado'], ['Anulada', 'anulado'], ['Cancelada', 'cancelado']] as const) {
    test(`situação "${nome}" → bloquear ${motivo} + evento de bloqueio`, async () => {
      const s = await prepared();
      const r = await recheckTender(T, s, fetchers(compra(nome)));
      assert.deepEqual(r.status === 'bloquear' && r.motivo, motivo);
      assert.equal(s.events().at(-1)?.tipo, 'bloqueio');
      assert.equal(s.getTender(T)?.situacao, nome);
    });
  }
  test('arquivo novo desde a análise → bloquear arquivos_mudaram', async () => {
    const s = await prepared();
    const r = await recheckTender(T, s, fetchers(compra('Divulgada no PNCP'), [...files, { seq: 3, titulo: 'ERRATA 01.pdf', tipo: 'Outros Documentos', url: 'u' }]));
    assert.equal(r.status === 'bloquear' && r.motivo, 'arquivos_mudaram');
  });
  test('sem foto da análise → bloquear arquivos_mudaram (precisa reavaliar)', async () => {
    const s = openStore(':memory:', { now: () => NOW });
    const r = await recheckTender(T, s, fetchers(compra('Divulgada no PNCP')));
    assert.equal(r.status === 'bloquear' && r.motivo, 'arquivos_mudaram');
  });
  test('recebimento de propostas encerrado → bloquear prazo_encerrado', async () => {
    const s = await prepared();
    const r = await recheckTender(T, s, fetchers(compra('Divulgada no PNCP', '2026-11-07T09:00:00')));
    assert.equal(r.status === 'bloquear' && r.motivo, 'prazo_encerrado');
  });
  test('PNCP fora do ar → bloquear fonte_indisponivel + evento erro_fonte (nunca libera)', async () => {
    const s = await prepared();
    const r = await recheckTender(T, s, { fetchCompra: async () => { throw new Error('ECONNRESET'); }, fetchFiles: async () => files, now: () => NOW });
    assert.equal(r.status === 'bloquear' && r.motivo, 'fonte_indisponivel');
    assert.equal(s.events().at(-1)?.tipo, 'erro_fonte');
  });
  test('situação desconhecida → bloquear fonte_indisponivel (não dá para afirmar que está aberto)', async () => {
    const s = await prepared();
    const r = await recheckTender(T, s, fetchers(compra('Situação inventada')));
    assert.equal(r.status === 'bloquear' && r.motivo, 'fonte_indisponivel');
  });
  test('id malformado → bloquear fonte_indisponivel', async () => {
    const s = openStore(':memory:');
    const r = await recheckTender('nao-e-um-id', s, fetchers(compra('Divulgada no PNCP')));
    assert.equal(r.status, 'bloquear');
  });
});
