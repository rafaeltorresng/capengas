import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tools, newState } from '../src/lib/tools.ts';
import { anvisa, compras } from '../src/lib/data.ts';
afterEach(() => mock.restoreAll());
const tid = '11111111000111/2026/1';
function setup() {
  mock.method(anvisa, 'byRegistro', () => ({ VALIDADE_REGISTRO_CADASTRO: 'VIGENTE' }));
  mock.method(compras, 'priceHistory', () => { throw new Error('histórico não deve decidir'); });
  const company = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));
  const state = newState(company, 'http://127.0.0.1:9', new Date('2026-11-07T12:00:00-03:00'));
  state.tenders[tid] = { abertura: '2026-11-23T09:00' };
  state.items[tid] = [{ numero: 1, descricao: 'Produto', quantidade: 2, valorEstimado: 10, sigiloso: false }];
  state.fits[tid + '#1'] = { product_id: 'P1', overall: 'atende', validacao: { cobertura: 'nao_verificada' }, attributes: [] };
  return { state, approvals: new Set<string>() };
}
test('decide_item usa estimativa sem exigir código e escala cobertura técnica desconhecida', async () => {
  const ctx = setup();
  const tool = tools.find(t => t.name === 'decide_item')!;
  assert.ok(!tool.parameters.required!.includes('catalog_code'));
  const d: any = await tool.run({ tender_id: tid, item: 1, product_id: 'P1' }, ctx);
  assert.equal(d.estado, 'escalar');
  assert.equal(d.precoProposto, 7.5);
  assert.equal(d.anvisa.cobertura, 'nao_comprovada');
});
test('rascunho usa o mesmo prazo com abertura só em data, com hora ou já com fuso', async () => {
  const tool = tools.find(t => t.name === 'draft_esclarecimento')!;
  const texto = 'Solicito esclarecer o diâmetro exigido no item, que não consta da descrição.';
  const prazos = [];
  for (const abertura of ['2026-11-18', '2026-11-18T09:00', '2026-11-18T09:00:00-03:00']) {
    const ctx = setup();
    ctx.state.tenders[tid].abertura = abertura;
    const r: any = await tool.run({ tender_id: tid, item: 1, texto }, ctx);
    assert.equal(r.salvo, true, abertura);
    prazos.push(r.prazo);
  }
  assert.deepEqual(prazos, ['2026-11-13', '2026-11-13', '2026-11-13']);
  const sem = setup();
  delete sem.state.tenders[tid].abertura;
  const recusado: any = await tool.run({ tender_id: tid, item: 1, texto }, sem);
  assert.equal(recusado.salvo, false);
  assert.equal(sem.state.drafts[tid + '#1'], undefined);
});
test('consulta ANVISA usa a abertura só com data e a cobertura declarada no catálogo', async () => {
  const ctx = setup();
  ctx.state.tenders[tid].abertura = '2026-11-18';
  ctx.state.company.catalogo.find((p: any) => p.id === 'P1').coberturaDeclarada = true;
  const r: any = await tools.find(t => t.name === 'check_anvisa')!.run({ tender_id: tid, product_id: 'P1' }, ctx);
  assert.equal(r.erro, undefined);
  assert.equal(r.cobertura, 'declarada_pelo_cliente');
  assert.match(r.entrega_ate, /^\d{4}-\d\d-\d\d$/);
});
test('orçamento sigiloso não produz preço', async () => {
  const ctx = setup(); ctx.state.items[tid][0].sigiloso = true;
  const d: any = await tools.find(t => t.name === 'decide_item')!.run({ tender_id: tid, item: 1, product_id: 'P1' }, ctx);
  assert.equal(d.precoProposto, null);
  assert.equal(d.estado, 'escalar');
});
const straumed = { NUMERO_REGISTRO_CADASTRO: '82936150004', NOME_TECNICO: 'Cabos', NOME_COMERCIAL: 'CABO DE BISTURI STRAUMED', CLASSE_RISCO: 'I',
  NOME_FABRICANTE: 'STRAUMED INSTRUMENTOS CIRURGICOS LTDA', DETENTOR_REGISTRO_CADASTRO: 'STRAUMED INSTRUMENTOS CIRURGICOS LTDA', VALIDADE_REGISTRO_CADASTRO: 'VIGENTE' };
function setupConferido(row: Record<string, string>) {
  const ctx = setup();
  mock.method(anvisa, 'byRegistro', () => row);
  ctx.state.company.catalogo.find((p: any) => p.id === 'P1').coberturaDeclarada = true;
  ctx.state.items[tid] = [{ numero: 1, descricao: 'material: aço', quantidade: 2, valorEstimado: 10, sigiloso: false }];
  ctx.state.fits[tid + '#1'] = { product_id: 'P1', overall: 'atende', validacao: { cobertura: 'conferida' }, attributes: [{ atributo: 'material', veredito: 'atende' }] };
  return ctx;
}
test('decide_item disputa quando o registro ANVISA é da marca do catálogo', async () => {
  const d: any = await tools.find(t => t.name === 'decide_item')!.run({ tender_id: tid, item: 1, product_id: 'P1' }, setupConferido(straumed));
  assert.equal(d.estado, 'disputar');
  assert.equal(d.anvisa.conferencia.status, 'confere');
});
test('decide_item escala quando o registro ANVISA é de outra marca', async () => {
  const prisma = { ...straumed, NOME_COMERCIAL: 'Cabo de bisturi', NOME_FABRICANTE: 'PRISMA INSTRUMENTOS ODONTOLÓGICOS LTDA - ME', DETENTOR_REGISTRO_CADASTRO: 'PRISMA INSTRUMENTOS ODONTOLÓGICOS LTDA - ME' };
  const d: any = await tools.find(t => t.name === 'decide_item')!.run({ tender_id: tid, item: 1, product_id: 'P1' }, setupConferido(prisma));
  assert.equal(d.estado, 'escalar');
  assert.ok(d.motivos.some((m: string) => /marca "Straumed" não aparece no registro ANVISA/.test(m)));
});
test('check_anvisa devolve fabricante e a conferência da marca, lidos da base na hora', async () => {
  const r: any = await tools.find(t => t.name === 'check_anvisa')!.run({ tender_id: tid, product_id: 'P1' }, setupConferido(straumed));
  assert.equal(r.fabricante, 'STRAUMED INSTRUMENTOS CIRURGICOS LTDA');
  assert.equal(r.conferencia.status, 'confere');
});
