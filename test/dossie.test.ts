import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDossie } from '../src/lib/dossie.ts';
import { newState } from '../src/lib/tools.ts';
import { checkDocs } from '../src/lib/rules.ts';

const TID = '11111111000111/2026/1';
function state() {
  const st = newState({ empresa: { nome: 'Empresa fictícia' }, catalogo: [{ id: 'P1', nome: 'Material de exemplo', marca: 'Exemplo', registroAnvisa: '123' }] }, 'http://127.0.0.1:9', new Date('2026-11-07T12:00:00-03:00'));
  st.tenders[TID] = { orgao: 'Órgão de exemplo', abertura: '2026-11-23T09:00', url: 'https://pncp.gov.br/app/editais/11111111000111/2026/1' };
  st.items[TID] = [{ numero: 1, descricao: 'Material de exemplo', quantidade: 3, valorEstimado: 20 }];
  st.requirements = [{ tender_id: TID, requirement: 'certidoes', quote: 'Certidão de regularidade fiscal' }];
  st.fits[`${TID}#1`] = { product_id: 'P1', overall: 'atende', attributes: [{ atributo: 'material', veredito: 'atende', citacao_item: 'Material de exemplo', citacao_ficha: 'Material de exemplo' }], validacao: { cobertura: 'nao_verificada' } };
  st.decisions[`${TID}#1`] = { decision: 'ofertar_com_pendencia', product_id: 'P1', preco_sugerido: 12.34, reasons: ['CND vence antes da sessão'] };
  return st;
}

describe('dossiê a partir do estado e dos resultados de regras', () => {
  test('preserva decisão, citações e preço calculado, sem inferir novos valores', () => {
    const d = buildDossie(state(), TID);
    assert.equal(d.tender, TID);
    assert.equal(d.itens[0].precoUnitario, 12.34);
    assert.equal(d.itens[0].valorTotal, 37.02);
    assert.equal(d.itens[0].atributos[0].citacao_item, 'Material de exemplo');
    assert.equal(d.exigencias[0].quote, 'Certidão de regularidade fiscal');
    assert.equal(d.envioAutomaticoLiberado, false);
  });
  test('expõe a CND ligada à exigência e a pendência recebida de checkDocs', () => {
    const d = buildDossie(state(), TID, { documentos: [{ exigencia: 'certidoes', documento: 'CND Federal', validade: '2026-11-15', status: 'vence_antes_sessao' }] });
    assert.equal(d.checklist[0].documento, 'CND Federal');
    assert.equal(d.checklist[0].estado, 'vence_antes_sessao');
    assert.equal(d.checklist[0].citacao, 'Certidão de regularidade fiscal');
    assert.match(d.checklist[0].detalhe!, /2026-11-15/);
    assert.ok(d.pendencias.some(p => /CND Federal/.test(p)));
  });
  test('aceita DocCheck com documento nulo sem transformar ausência em sem vencimento', () => {
    const d = buildDossie(state(), TID, { documentos: [{ exigencia: 'certidoes', citacao: 'Certidão de regularidade fiscal', documento: null, validade: null, status: 'ausente' }] });
    assert.equal(d.checklist[0].estado, 'ausente');
    assert.equal(d.checklist[0].documento, 'Documento não localizado');
    assert.ok(d.pendencias.some(p => /Ausente/.test(p)));
  });
  test('liga as três linhas reais de checkDocs à citação de certidões', () => {
    const st = state();
    const docs = checkDocs([{ doc: 'CND Federal', tipo: 'cnd_federal', validade: '2026-11-15' }], [{ tipo: 'certidoes', citacao: st.requirements[0].quote }], '2026-11-23');
    const d = buildDossie(st, TID, { documentos: docs });
    assert.equal(d.checklist.length, 3);
    assert.equal(d.checklist[0].estado, 'vence_antes_sessao');
    assert.equal(d.checklist[1].estado, 'ausente');
    assert.equal(d.checklist[2].estado, 'ausente');
  });
  test('preço nulo no contrato novo não reaproveita um preço legado antigo', () => {
    const st = state();
    st.decisions[`${TID}#1`].precoProposto = null;
    const d = buildDossie(st, TID);
    assert.equal(d.itens[0].precoUnitario, null);
  });
  test('consome os nomes publicados pelo Dev 1 para decisão e preço', () => {
    const st = state();
    st.decisions[`${TID}#1`] = { tenderId: TID, item: 1, produto: 'P1', estado: 'disputar_com_pendencia', motivos: ['CND pendente'], precoProposto: 12.34 };
    const d = buildDossie(st, TID);
    assert.equal(d.itens[0].estado, 'disputar_com_pendencia');
    assert.deepEqual(d.itens[0].motivos, ['CND pendente']);
    assert.equal(d.itens[0].precoUnitario, 12.34);
    assert.equal(d.itens[0].produto!.id, 'P1');
  });
  test('não trata documento sem vencimento como ausente ou vencido', () => {
    const st = state();
    st.requirements = [{ tender_id: TID, requirement: 'afe', quote: 'Autorização de Funcionamento da Empresa' }];
    const d = buildDossie(st, TID, { documentos: [{ exigencia: 'afe', documento: 'AFE ANVISA', validade: null, status: 'sem_vencimento' }] });
    assert.equal(d.checklist[0].estado, 'sem_vencimento');
    assert.ok(!d.pendencias.some(p => /AFE ANVISA/.test(p)));
  });
  test('não considera documentação conferida sem receber resultado das regras', () => {
    const d = buildDossie(state(), TID);
    assert.equal(d.checklist[0].estado, 'nao_verificado');
    assert.ok(d.pendencias.some(p => /document/i.test(p)));
    assert.ok(d.pendencias.some(p => /cobertura/i.test(p)));
  });
  test('uma exigência sem linha correspondente permanece não verificada', () => {
    const st = state();
    st.requirements.push({ tender_id: TID, requirement: 'amostra', quote: 'Apresentar amostra do produto' });
    const d = buildDossie(st, TID, { documentos: [{ exigencia: 'certidoes', documento: 'CND Federal', validade: '2026-12-31', status: 'vigente' }] });
    assert.equal(d.checklist.find(x => x.exigencia === 'amostra')!.estado, 'nao_verificado');
  });
  test('separa itens não decididos e não transforma ausência de preço em zero', () => {
    const st = state(); delete st.decisions[`${TID}#1`];
    const d = buildDossie(st, TID);
    assert.equal(d.itens[0].estado, 'nao_decidido');
    assert.equal(d.itens[0].precoUnitario, null);
    assert.equal(d.itens[0].valorTotal, null);
    assert.ok(d.pendencias.some(p => /decis.o/i.test(p)));
  });
  test('não mistura exigências, decisões ou itens de outro pregão', () => {
    const st = state();
    st.requirements.push({ tender_id: 'outro', requirement: 'afe', quote: 'Exigência de outro pregão' });
    st.decisions['outro#2'] = { product_id: 'P1', decision: 'ofertar' };
    const d = buildDossie(st, TID);
    assert.equal(d.exigencias.length, 1);
    assert.equal(d.itens.length, 1);
  });
  test('preserva referência exata de fonte quando registrada e não fabrica PDF/página', () => {
    const st = state();
    st.requirements[0].fonte = { nome: 'Edital', url: 'https://example.org/edital.pdf', citacao: 'Certidão de regularidade fiscal' };
    const d = buildDossie(st, TID);
    assert.equal(d.checklist[0].fonte!.url, 'https://example.org/edital.pdf');
    assert.equal(d.documentos.length, 1);
    assert.ok(!d.documentos[0].url.includes('#page='));
  });
});
