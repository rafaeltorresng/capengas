// Integração das ferramentas sobre dados REAIS (PNCP, Compras.gov, ANVISA) com um roteiro fixo de chamadas.
// Valida a cadeia de ponta a ponta e as travas, independentemente do modelo.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tools, newState, type LanceState } from '../../src/lib/tools.ts';
import { startSandbox } from '../../src/lib/sandbox.ts';
import { openStore } from '../../src/lib/store.ts';
import { persistAnalysis } from '../../src/lib/persist-analysis.ts';
import type { Recheque } from '../../src/lib/contracts.ts';

const company = JSON.parse(readFileSync(new URL('../../fixtures/company.json', import.meta.url), 'utf8'));
const TID = '77816510000166/2026/348';
const cov = JSON.parse(readFileSync(new URL('../../fixtures/coverage.json', import.meta.url), 'utf8'));
let sbx: Awaited<ReturnType<typeof startSandbox>>; let st: LanceState;
const T = (n: string) => tools.find(t => t.name === n)!;
const ctx = () => ({ approvals: new Set<string>(), state: st as any });

before(async () => {
  sbx = await startSandbox(0);
  st = newState(company, sbx.url, new Date('2026-11-07T10:00:00-03:00'));
  st.tenders[TID] = cov.find((c: any) => `${c.cnpj}/${c.ano}/${c.seq}` === TID);
});
after(() => sbx.close());

describe('ferramentas sobre dados reais', { timeout: 240_000 }, () => {
  test('record_fit rejeita citação inventada', async () => {
    const r: any = await T('record_fit').run({ tender_id: TID, item: 4, product_id: 'P1', attributes: [{ atributo: 'material', veredito: 'atende', citacao_item: 'titânio grau médico', citacao_ficha: 'aço inoxidável AISI 420' }] }, ctx());
    assert.equal(r.aceito, false);
  });
  test('decide_item exige encaixe registrado', async () => {
    const r: any = await T('decide_item').run({ tender_id: TID, item: 40, product_id: 'P2', catalog_code: 471547 }, ctx());
    assert.match(r.erro, /record_fit/);
  });
  test('cabo de bisturi: atende → ofertar com pendência (CND vence antes da sessão), preço do código', async () => {
    const f: any = await T('record_fit').run({ tender_id: TID, item: 4, product_id: 'P1', attributes: [
      { atributo: 'tamanho', veredito: 'atende', citacao_item: 'CABO DE BISTURI Nº4 13 CM', citacao_ficha: 'Comprimento total 13 cm' },
      { atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável', citacao_ficha: 'aço inoxidável AISI 420' },
      { atributo: 'autoclavável', veredito: 'atende', citacao_item: 'AÇO INOX AUTOCLAVÁVEL', citacao_ficha: 'Reutilizável e autoclavável' }] }, ctx());
    assert.equal(f.aceito, true, JSON.stringify(f));
    const d: any = await T('decide_item').run({ tender_id: TID, item: 4, product_id: 'P1', catalog_code: 299116 }, ctx());
    assert.equal(d.decision, 'ofertar_com_pendencia', JSON.stringify(d));
    assert.ok(d.preco_sugerido >= 6.9);
    assert.equal(d.anvisa.status, 'ok');
    assert.equal(d.prazo_esclarecimento, '2026-11-17'); // abertura seg 23/11; 20/11 feriado
  });
  test('tesoura curva para item que pede reta → não ofertar', async () => {
    await T('record_fit').run({ tender_id: TID, item: 40, product_id: 'P2', attributes: [
      { atributo: 'haste', exigido: 'reta', ofertado: 'curva', veredito: 'nao_atende', citacao_item: 'haste: haste reta', citacao_ficha: 'Haste curva, ponta romba' }] }, ctx());
    const d: any = await T('decide_item').run({ tender_id: TID, item: 40, product_id: 'P2', catalog_code: 471547 }, ctx());
    assert.equal(d.decision, 'nao_ofertar');
  });
  test('pendência de cobertura não envia, mesmo com approval_id', async () => {
    const store = openStore(':memory:');
    const recheck: Recheque = { status: 'ok', situacao: 'Divulgada no PNCP', arquivosHash: 'abc', em: '2026-11-07T10:00:00.000Z' };
    st.store = store;
    st.recheck = async () => recheck;
    persistAnalysis(st, store);
    const gravado = store.getTender(TID);
    if (gravado) store.upsertTender({ ...gravado, arquivosHash: 'foto-analise', reavaliar: false });
    const r: any = await T('submit_proposal').run({ tender_id: TID, itens: [4], approval_id: 'qualquer', precoUnitario: 1 }, ctx());
    assert.equal(r.resultado, 'escalada');
    assert.equal(sbx.propostas.size, 0);
    store.close();
  });
});
