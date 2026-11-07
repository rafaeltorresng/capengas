import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  checkAnvisa, priceStats, suggestPrice, brandConcentration,
  verifyQuote, esclarecimentoDeadline, decideItem, normalizeBrand,
} from '../src/lib/rules.ts';
import type { LegacyItemChecks } from '../src/lib/rules.ts';

const d = (s: string) => new Date(s + 'T12:00:00-03:00');

describe('checkAnvisa', () => {
  const row = (validade: string) => ({
    NUMERO_REGISTRO_CADASTRO: '10330710009', CLASSE_RISCO: 'II',
    NOME_TECNICO: 'Agulhas', VALIDADE_REGISTRO_CADASTRO: validade,
    DETENTOR_REGISTRO_CADASTRO: 'X',
  });
  test('registro ausente na base → nao_encontrado', () => {
    assert.equal(checkAnvisa(undefined, { today: d('2026-11-07'), deliveryBy: d('2026-12-31') }).status, 'nao_encontrado');
  });
  test('VIGENTE sem data (notificação) → ok', () => {
    assert.equal(checkAnvisa(row('VIGENTE'), { today: d('2026-11-07'), deliveryBy: d('2027-06-30') }).status, 'ok');
  });
  test('data no passado → vencido', () => {
    assert.equal(checkAnvisa(row('01/10/2026'), { today: d('2026-11-07'), deliveryBy: d('2026-12-31') }).status, 'vencido');
  });
  test('vence entre hoje e a entrega → vence_antes_entrega', () => {
    const r = checkAnvisa(row('15/12/2026'), { today: d('2026-11-07'), deliveryBy: d('2027-03-01') });
    assert.equal(r.status, 'vence_antes_entrega');
    assert.equal(r.validUntil, '2026-12-15');
  });
  test('vence depois da entrega → ok', () => {
    assert.equal(checkAnvisa(row('15/12/2027'), { today: d('2026-11-07'), deliveryBy: d('2027-03-01') }).status, 'ok');
  });
});

describe('priceStats / brandConcentration (fixture real 631440)', () => {
  const recs = JSON.parse(readFileSync(new URL('../fixtures/preco_631440.json', import.meta.url), 'utf8')).resultado;
  test('estatísticas de preço', () => {
    const s = priceStats(recs);
    assert.equal(s.n, recs.length);
    assert.ok(s.min <= s.median && s.median <= s.max);
    assert.ok(s.byBrand.length >= 1);
  });
  test('cama hospitalar: uma marca domina → flag', () => {
    const c = brandConcentration(recs);
    assert.equal(c.flag, true, JSON.stringify(c));
    assert.ok(c.share >= 0.8);
  });
  test('mercado diverso não dispara flag', () => {
    const fake = ['A', 'B', 'C', 'D', 'E', 'A'].map((m, i) => ({ marca: m, precoUnitario: 10 + i }));
    assert.equal(brandConcentration(fake).flag, false);
  });
  test('amostra pequena não dispara flag (n<5)', () => {
    const fake = ['A', 'A', 'A'].map(m => ({ marca: m, precoUnitario: 10 }));
    assert.equal(brandConcentration(fake).flag, false);
  });
  test('normalizeBrand junta variações de texto livre', () => {
    assert.equal(normalizeBrand(' Renovar '), normalizeBrand('RENOVAR.'));
    assert.equal(normalizeBrand('PROPRIO'), null);
    assert.equal(normalizeBrand(''), null);
  });
});

describe('suggestPrice', () => {
  const stats = { n: 6, min: 4.1, p25: 8, median: 13.25, p75: 14, max: 15, byBrand: [] };
  test('custo abaixo do mercado → sugere preço competitivo com margem', () => {
    const r = suggestPrice(stats, 6, 0.15);
    assert.equal(r.ok, true);
    assert.ok(r.price! >= 6 * 1.15 - 1e-9);
    assert.ok(r.price! <= stats.median);
  });
  test('custo com margem acima da mediana → não ofertar', () => {
    const r = suggestPrice(stats, 12.5, 0.15);
    assert.equal(r.ok, false);
    assert.match(r.reason, /mediana/i);
  });
  test('sem histórico → não sugere', () => {
    assert.equal(suggestPrice({ ...stats, n: 0 }, 6, 0.15).ok, false);
  });
});

describe('verifyQuote', () => {
  const doc = 'Os produtos deverão possuir   Registro na\nANVISA vigente, sob pena de desclassificação.';
  test('aceita citação com espaços/quebras/acentos diferentes', () => {
    assert.equal(verifyQuote('possuir registro na Anvisa vigente', doc).found, true);
  });
  test('rejeita citação inventada', () => {
    assert.equal(verifyQuote('dispensada a apresentação de registro', doc).found, false);
  });
  test('rejeita citação curta demais', () => {
    assert.equal(verifyQuote('anvisa', doc).found, false);
  });
});

describe('esclarecimentoDeadline (art. 164, 3 dias úteis antes)', () => {
  test('abertura sexta 13/11 → terça 10/11', () => {
    assert.equal(esclarecimentoDeadline(d('2026-11-13')), '2026-11-10');
  });
  test('pula fim de semana e feriado: abertura terça 24/11 → quarta 18/11', () => {
    // 23 seg (1), 20 sex é feriado (Consciência Negra), 19 qui (2), 18 qua (3)
    assert.equal(esclarecimentoDeadline(d('2026-11-24')), '2026-11-18');
  });
  test('abertura segunda 09/11 → quarta 04/11', () => {
    assert.equal(esclarecimentoDeadline(d('2026-11-09')), '2026-11-04');
  });
});

describe('decideItem', () => {
  const base: LegacyItemChecks = { fit: 'atende', anvisa: 'ok', price: { ok: true }, docsOk: true, restrictive: false };
  test('tudo ok → ofertar', () => assert.equal(decideItem(base as LegacyItemChecks).decision, 'ofertar'));
  test('não atende → nao_ofertar', () => assert.equal(decideItem({ ...base, fit: 'nao_atende' } as LegacyItemChecks).decision, 'nao_ofertar'));
  test('registro vence antes → nao_ofertar', () => assert.equal(decideItem({ ...base, anvisa: 'vence_antes_entrega' } as LegacyItemChecks).decision, 'nao_ofertar'));
  test('preço inviável → nao_ofertar', () => assert.equal(decideItem({ ...base, price: { ok: false, reason: 'x' } } as LegacyItemChecks).decision, 'nao_ofertar'));
  test('atributo não informado → escalar', () => assert.equal(decideItem({ ...base, fit: 'nao_informado' } as LegacyItemChecks).decision, 'escalar'));
  test('documento vencido → ofertar_com_pendencia', () => assert.equal(decideItem({ ...base, docsOk: false } as LegacyItemChecks).decision, 'ofertar_com_pendencia'));
  test('especificação restritiva → escalar com esclarecimento', () => {
    const r = decideItem({ ...base, restrictive: true } as LegacyItemChecks);
    assert.equal(r.decision, 'escalar');
    assert.ok(r.reasons.some(x => /esclarecimento/i.test(x)));
  });
});
