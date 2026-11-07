// Regras do contrato src/lib/contracts.ts: preço pela estimativa, cofre × sessão, ANVISA e decisão.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { priceCheck, checkDocs, checkAnvisa, decideItem } from '../src/lib/rules.ts';
import type { ItemChecks, DocCheck } from '../src/lib/contracts.ts';

const d = (s: string) => new Date(s + 'T12:00:00-03:00');

describe('priceCheck (custo + margem contra a estimativa do órgão)', () => {
  const base = { custo: 6, margemMinima: 0.15, margemAlvo: 0.25, estimativa: 10, sigiloso: false };
  test('custo baixo → viável, preço entre o piso e a estimativa', () => {
    const r = priceCheck(base);
    assert.equal(r.viavel, true);
    assert.ok(r.precoProposto! >= 6 * 1.15 - 1e-9 && r.precoProposto! <= 10, String(r.precoProposto));
    assert.equal(r.precoProposto, 7.5);
  });
  test('alvo acima da estimativa → preço limitado à estimativa', () => {
    const r = priceCheck({ ...base, custo: 8.5 });
    assert.equal(r.viavel, true);
    assert.equal(r.precoProposto, 10);
  });
  test('custo + margem mínima acima da estimativa → inviável', () => {
    const r = priceCheck({ ...base, custo: 9 });
    assert.equal(r.viavel, false);
    assert.equal(r.precoProposto, null);
    assert.match(r.motivo, /estimativa/);
  });
  test('orçamento sigiloso → desconhecido', () => {
    assert.equal(priceCheck({ ...base, sigiloso: true }).viavel, null);
  });
  test('sem estimativa → desconhecido', () => {
    assert.equal(priceCheck({ ...base, estimativa: null }).viavel, null);
    assert.equal(priceCheck({ ...base, estimativa: 0 }).viavel, null);
  });
  test('custo inválido → desconhecido', () => {
    assert.equal(priceCheck({ ...base, custo: 0 }).viavel, null);
    assert.equal(priceCheck({ ...base, custo: Number.NaN }).viavel, null);
  });
});

describe('checkDocs (cofre × data da sessão)', () => {
  const cofre = [
    { doc: 'AFE ANVISA', tipo: 'afe', validade: null },
    { doc: 'CND Federal', tipo: 'cnd_federal', validade: '2026-11-15' },
    { doc: 'CRF FGTS', tipo: 'crf_fgts', validade: '2026-12-20' },
  ];
  const exig = [
    { tipo: 'afe', citacao: 'Autorização de Funcionamento de Empresa – AFE' },
    { tipo: 'certidoes', citacao: 'certidões de regularidade fiscal e trabalhista' },
    { tipo: 'registro_anvisa', citacao: 'registro do produto na ANVISA' },
  ];
  const r = checkDocs(cofre, exig, '2026-11-23');
  const by = (doc: string) => r.find(x => x.documento === doc || (doc === 'CNDT' && x.documento === null && /CNDT/.test(x.exigencia)));
  test('AFE sem validade → sem_vencimento', () => assert.equal(by('AFE ANVISA')?.status, 'sem_vencimento'));
  test('CND vence antes da sessão → vence_antes_sessao', () => assert.equal(by('CND Federal')?.status, 'vence_antes_sessao'));
  test('CRF válido na sessão → vigente', () => assert.equal(by('CRF FGTS')?.status, 'vigente'));
  test('CNDT exigida e fora do cofre → ausente', () => {
    const c = r.find(x => /CNDT/.test(x.exigencia));
    assert.equal(c?.status, 'ausente'); assert.equal(c?.documento, null);
  });
  test('exigências que não são documentos do cofre (registro ANVISA) não viram linha', () => {
    assert.ok(!r.some(x => /registro do produto/.test(x.citacao)));
  });
  test('documento marcado irregular → irregular', () => {
    const x = checkDocs([{ doc: 'AFE', tipo: 'afe', validade: null, irregular: true }], [exig[0]], '2026-11-23');
    assert.equal(x[0].status, 'irregular');
  });
  test('cada linha carrega a citação da exigência', () => assert.ok(r.every(x => x.citacao.length > 0)));
});

describe('checkAnvisa (regularização separada da cobertura)', () => {
  const row = (validade: string) => ({ NUMERO_REGISTRO_CADASTRO: '1', CLASSE_RISCO: 'II', VALIDADE_REGISTRO_CADASTRO: validade, DETENTOR_REGISTRO_CADASTRO: 'FABRICANTE X' });
  const o = { today: d('2026-11-07'), deliveryBy: d('2027-01-30'), coberturaDeclarada: true };
  test('sem linha → nao_encontrado', () => assert.equal(checkAnvisa(undefined, o).regularizacao, 'nao_encontrado'));
  test('VIGENTE sem data → vigente; detentor não precisa ser a distribuidora', () => {
    const r = checkAnvisa(row('VIGENTE'), o);
    assert.equal(r.regularizacao, 'vigente'); assert.equal(r.detentor, 'FABRICANTE X');
  });
  test('data passada → vencido', () => assert.equal(checkAnvisa(row('01/10/2026'), o).regularizacao, 'vencido'));
  test('vence antes da entrega → vigente, mas sinalizado', () => {
    const r = checkAnvisa(row('15/12/2026'), o);
    assert.equal(r.regularizacao, 'vigente'); assert.equal(r.venceAntesEntrega, true);
  });
  test('data ilegível → nao_verificado', () => assert.equal(checkAnvisa(row('???'), o).regularizacao, 'nao_verificado'));
  test('cobertura vem da declaração do cliente', () => {
    assert.equal(checkAnvisa(row('VIGENTE'), o).cobertura, 'declarada_pelo_cliente');
    assert.equal(checkAnvisa(row('VIGENTE'), { ...o, coberturaDeclarada: false }).cobertura, 'nao_comprovada');
  });
  test('compatível com o formato antigo (status) usado pelo tools.ts', () => {
    assert.equal(checkAnvisa(row('15/12/2026'), { today: o.today, deliveryBy: o.deliveryBy }).status, 'vence_antes_entrega');
  });
});

describe('decideItem (5 estados, ordem do contrato)', () => {
  const ok: DocCheck = { exigencia: 'AFE', citacao: 'AFE', documento: 'AFE', validade: null, status: 'sem_vencimento' };
  const base: ItemChecks = {
    fit: 'atende', regularizacao: 'vigente', cobertura: 'declarada_pelo_cliente',
    preco: { viavel: true, precoProposto: 7.5, motivo: '' }, docs: [ok],
    restritivo: false, varianteNaoCoberta: false, prazoEsclarecimentoAberto: true,
  };
  const est = (c: Partial<ItemChecks>) => decideItem({ ...base, ...c }).estado;
  test('tudo ok → disputar', () => assert.equal(est({}), 'disputar'));
  test('fit desconhecido → escalar', () => assert.equal(est({ fit: 'desconhecido' }), 'escalar'));
  test('preço desconhecido (sigiloso) → escalar', () => assert.equal(est({ preco: { viavel: null, precoProposto: null, motivo: 'sigiloso' } }), 'escalar'));
  test('regularização não verificada → escalar', () => assert.equal(est({ regularizacao: 'nao_verificado' }), 'escalar'));
  test('restritivo com prazo aberto → esclarecer', () => assert.equal(est({ restritivo: true }), 'esclarecer'));
  test('variante não coberta com prazo aberto → esclarecer', () => assert.equal(est({ varianteNaoCoberta: true, fit: 'nao_atende' }), 'esclarecer'));
  test('restritivo com prazo desconhecido → escalar', () => assert.equal(est({ restritivo: true, prazoEsclarecimentoAberto: null }), 'escalar'));
  test('não atende (sem esclarecimento cabível) → nao_disputar', () => assert.equal(est({ fit: 'nao_atende' }), 'nao_disputar'));
  test('registro vencido → nao_disputar', () => assert.equal(est({ regularizacao: 'vencido' }), 'nao_disputar'));
  test('registro não encontrado → nao_disputar', () => assert.equal(est({ regularizacao: 'nao_encontrado' }), 'nao_disputar'));
  test('registro vence antes da entrega → nao_disputar', () => assert.equal(est({ venceAntesEntrega: true } as any), 'nao_disputar'));
  test('preço inviável → nao_disputar', () => assert.equal(est({ preco: { viavel: false, precoProposto: null, motivo: 'acima' } }), 'nao_disputar'));
  test('não informado com prazo aberto → esclarecer', () => assert.equal(est({ fit: 'nao_informado' }), 'esclarecer'));
  test('não informado com prazo vencido → escalar', () => assert.equal(est({ fit: 'nao_informado', prazoEsclarecimentoAberto: false }), 'escalar'));
  test('documento vence antes da sessão → disputar_com_pendencia', () => assert.equal(est({ docs: [{ ...ok, status: 'vence_antes_sessao' }] }), 'disputar_com_pendencia'));
  test('documento ausente → disputar_com_pendencia', () => assert.equal(est({ docs: [{ ...ok, status: 'ausente', documento: null }] }), 'disputar_com_pendencia'));
  test('cobertura não comprovada → disputar_com_pendencia', () => assert.equal(est({ cobertura: 'nao_comprovada' }), 'disputar_com_pendencia'));
  test('motivos sempre preenchidos', () => {
    for (const c of [{}, { fit: 'nao_atende' as const }, { restritivo: true }, { cobertura: 'nao_comprovada' as const }]) assert.ok(decideItem({ ...base, ...c }).motivos.length > 0);
  });
  test('compatível com o formato antigo usado pelo tools.ts', () => {
    const r: any = decideItem({ fit: 'atende', anvisa: 'ok', price: { ok: true }, docsOk: false, restrictive: false } as any);
    assert.equal(r.decision, 'ofertar_com_pendencia');
  });
});
