// Seleção dos pregões da demo: filtro de plataforma, casamento item × catálogo e ranqueamento.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapSearchItem } from '../src/lib/data.ts';
import { matchProduct, matchCatalog, rankCandidates } from '../src/lib/demo.ts';

const search = JSON.parse(readFileSync(new URL('../fixtures/search_mh.json', import.meta.url), 'utf8'));
const company = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));

describe('mapSearchItem', () => {
  test('traz plataforma e situação de cada pregão da busca', () => {
    const t = search.items.map(mapSearchItem);
    assert.ok(t.every((x: any) => typeof x.plataforma === 'string' && typeof x.situacao === 'string'));
    assert.equal(t.filter((x: any) => x.plataforma === 'Compras.gov.br').length, 14);
  });
});

describe('matchProduct', () => {
  test('todas as palavras exigidas; alternativas com |; ignora acentos e caixa', () => {
    assert.equal(matchProduct('CABO DE BISTURI Nº4 13 CM AÇO INOX', ['cabo', 'bisturi']), true);
    assert.equal(matchProduct('Lâmina de bisturi nº 24', ['cabo', 'bisturi']), false);
    assert.equal(matchProduct('Escova Degermação antisséptico degermante: clorexidina 2%', ['escova', 'degermacao|clorexidina']), true);
    assert.equal(matchProduct('Material P/ Vni - Cpap / Bipap tipo 1: pronga nasal', ['cpap|pronga']), true);
  });
  test('expressão com várias palavras exige as palavras juntas', () => {
    assert.equal(matchProduct('CABO DE BISTURI Nº4 13 CM', ['cabo de bisturi|cabo bisturi']), true);
    assert.equal(matchProduct('Caneta uso médico, monopolar, com cabo de 3 m, para bisturi elétrico', ['cabo de bisturi|cabo bisturi']), false);
  });
  test('palavra inteira, não pedaço de outra', () => {
    assert.equal(matchProduct('Cabeceira de cama', ['cabo']), false);
  });
});

describe('matchCatalog', () => {
  test('liga itens reais aos produtos do catálogo pelos termos', () => {
    const itens = [
      { numero: 4, descricao: 'Cabo Bisturi características adicionais: longo, material: aço inoxidável, tamanho: nº 4' },
      { numero: 40, descricao: 'Tesoura Instrumental comprimento total: cerca de 20, haste reta' },
      { numero: 99, descricao: 'Papel A4 75g' },
    ];
    const m = matchCatalog(itens, company.catalogo);
    assert.deepEqual(m.map(x => [x.item, x.produto]), [[4, 'P1'], [40, 'P2']]);
  });
});

describe('rankCandidates', () => {
  const base = { plataforma: 'Compras.gov.br', situacao: 'Divulgada no PNCP', abertura: '2026-11-23T09:00', matches: [{ item: 1, produto: 'P1' }] };
  test('prefere mais produtos distintos, depois mais itens; exclui outras plataformas e sessão próxima', () => {
    const r = rankCandidates([
      { ...base, id: 'a', matches: [{ item: 1, produto: 'P1' }, { item: 2, produto: 'P1' }] },
      { ...base, id: 'b', matches: [{ item: 1, produto: 'P1' }, { item: 9, produto: 'P2' }] },
      { ...base, id: 'c', plataforma: 'BLL Compras' },
      { ...base, id: 'd', abertura: '2026-11-08T09:00' },
      { ...base, id: 'e', matches: [] },
    ], { hoje: '2026-11-07', diasMinimos: 2 });
    assert.deepEqual(r.map(x => x.id), ['b', 'a']);
  });
});
