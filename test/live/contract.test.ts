// Testes de contrato contra as APIs públicas reais (rede). Validam que a cadeia de dados existe hoje.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pncp, compras, anvisa, pdf } from '../../src/lib/data.ts';

describe('PNCP (ao vivo)', { timeout: 180_000 }, () => {
  let first: any;
  test('busca editais abertos de material hospitalar', async () => {
    const r = await pncp.searchOpen('material hospitalar', 1, 20);
    assert.ok(r.total > 100, `total=${r.total}`);
    first = r.items.find(i => i.modalidade.startsWith('Pregão'));
    assert.ok(first, 'nenhum pregão na página');
    assert.match(first.cnpj, /^\d{14}$/);
    assert.ok(first.abertura > new Date().toISOString().slice(0, 10), 'abertura deve ser futura');
  });
  test('itens de pregões do Compras.gov.br trazem código de catálogo (outras plataformas, não)', async () => {
    const r = await pncp.searchOpen('material hospitalar', 1, 30);
    let govbr: any = null, outro: any = null;
    for (const t of r.items.filter(i => i.modalidade.startsWith('Pregão'))) {
      const c = await pncp.compra(t.cnpj, t.ano, t.seq);
      if (!govbr && c.usuarioNome === 'Compras.gov.br') govbr = t;
      if (!outro && c.usuarioNome && c.usuarioNome !== 'Compras.gov.br') outro = t;
      if (govbr && outro) break;
    }
    assert.ok(govbr, 'nenhum pregão do Compras.gov.br na página');
    const a = await pncp.items(govbr.cnpj, govbr.ano, govbr.seq);
    assert.ok(a.filter(i => i.catalogCode).length / a.length >= 0.9, 'Compras.gov.br deveria ter código');
    if (outro) { const b = await pncp.items(outro.cnpj, outro.ano, outro.seq); assert.equal(b.filter(i => i.catalogCode).length, 0, 'achado de 07/11: outras plataformas sem código'); }
  });
  test('arquivos incluem um edital baixável', async () => {
    const files = await pncp.files(first.cnpj, first.ano, first.seq);
    assert.ok(files.length > 0);
    assert.ok(files.some(f => /edital/i.test(f.tipo + ' ' + f.titulo)), JSON.stringify(files.map(f => f.tipo)));
  });
});

describe('Compras.gov pesquisa de preço (ao vivo)', { timeout: 120_000 }, () => {
  test('histórico por código com marca e preço', async () => {
    const recs = await compras.priceHistory(632751);
    assert.ok(recs.length >= 3);
    assert.ok(recs.every(r => r.precoUnitario > 0));
    assert.ok(recs.some(r => r.marca));
  });
});

describe('ANVISA (base local importada do CSV oficial)', () => {
  test('importa ~116 mil produtos', () => assert.ok(anvisa.count() > 100_000, String(anvisa.count())));
  test('acha registro real por número', () => {
    const r = anvisa.byRegistro('10330710009');
    assert.equal(r?.NOME_TECNICO, 'Agulhas');
  });
  test('busca por nome técnico', () => assert.ok(anvisa.searchName('traqueostomia', 500).length > 100));
});

describe('pdftotext', () => {
  test('extrai texto de PDF real', async () => {
    const t = await pdf.toText(new URL('../../fixtures/afe.pdf', import.meta.url).pathname);
    assert.ok(t.length > 1000);
  });
});
