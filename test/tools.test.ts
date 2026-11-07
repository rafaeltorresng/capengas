// Regressões locais: nenhum teste depende do PNCP, ANVISA ou de uma chamada ao modelo.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { tools, newState } from '../src/lib/tools.ts';

const TID = '11111111000111/2026/1';
const tool = (name: string) => tools.find(t => t.name === name)!;
function context() {
  const state = newState({ catalogo: [{ id: 'P1', ficha: 'Comprimento 5 mm. Material: aço inoxidável.' }] }, 'http://127.0.0.1:9');
  state.items[TID] = [{ numero: 1, descricao: 'Comprimento 10 mm. Material: aço inoxidável.' }];
  return { state, approvals: new Set<string>() };
}
const fitArgs = (attributes: any[]) => ({ tender_id: TID, item: 1, product_id: 'P1', attributes });

describe('record_fit: evidências', () => {
  test('recusa uma lista vazia sem registrar atende', async () => {
    const ctx = context();
    const r: any = await tool('record_fit').run(fitArgs([]), ctx);
    assert.equal(r.aceito, false);
    assert.match(JSON.stringify(r), /atributo/i);
    assert.equal(ctx.state.fits[`${TID}#1`], undefined);
  });
  test('recusa atende para medidas simples incompatíveis, mesmo com citações existentes', async () => {
    const ctx = context();
    const r: any = await tool('record_fit').run(fitArgs([{ atributo: 'comprimento', veredito: 'atende', citacao_item: 'Comprimento 10 mm', citacao_ficha: 'Comprimento 5 mm' }]), ctx);
    assert.equal(r.aceito, false);
    assert.match(JSON.stringify(r), /medida|incompat/i);
  });
  test('aceita medidas equivalentes em cm e mm', async () => {
    const ctx = context();
    ctx.state.items[TID][0].descricao = 'Comprimento 0,5 cm. Material: aço inoxidável.';
    const r: any = await tool('record_fit').run(fitArgs([{ atributo: 'comprimento', veredito: 'atende', citacao_item: 'Comprimento 0,5 cm', citacao_ficha: 'Comprimento 5 mm' }]), ctx);
    assert.equal(r.aceito, true);
  });
  test('não transforma uma faixa ou tolerância em contradição numérica exata', async () => {
    const ctx = context();
    ctx.state.items[TID][0].descricao = 'Comprimento de 4 a 6 mm.';
    const r: any = await tool('record_fit').run(fitArgs([{ atributo: 'comprimento', veredito: 'atende', citacao_item: 'Comprimento de 4 a 6 mm', citacao_ficha: 'Comprimento 5 mm' }]), ctx);
    assert.equal(r.aceito, true);
    assert.equal(ctx.state.fits[`${TID}#1`].validacao.cobertura, 'nao_verificada');
  });
  test('citação inventada não altera o estado para atende', async () => {
    const ctx = context();
    const r: any = await tool('record_fit').run(fitArgs([{ atributo: 'material', veredito: 'atende', citacao_item: 'titânio especial', citacao_ficha: 'Material: aço inoxidável' }]), ctx);
    assert.equal(r.aceito, false);
    assert.equal(ctx.state.fits[`${TID}#1`], undefined);
  });
  test('nova análise invalida o encaixe e a decisão antigos, inclusive se for rejeitada', async () => {
    const ctx = context();
    ctx.state.fits[`${TID}#1`] = { product_id: 'P1', overall: 'atende' };
    ctx.state.decisions[`${TID}#1`] = { decision: 'ofertar' };
    await tool('record_fit').run(fitArgs([]), ctx);
    assert.equal(ctx.state.fits[`${TID}#1`], undefined);
    assert.equal(ctx.state.decisions[`${TID}#1`], undefined);
  });
});

describe('get_tender_items: paginação da ferramenta', () => {
  function paged() {
    const ctx = context();
    ctx.state.items[TID] = Array.from({ length: 60 }, (_, i) => ({ numero: i + 1, descricao: `Material hospitalar ${i + 1}`, quantidade: 2, valorEstimado: 10 }));
    return ctx;
  }
  test('permite alcançar itens 40 e 54, sem nova consulta ao PNCP', async () => {
    const ctx = paged();
    const a: any = await tool('get_tender_items').run({ tender_id: TID }, ctx);
    const b: any = await tool('get_tender_items').run({ tender_id: TID, page: a.proxima_pagina }, ctx);
    const c: any = await tool('get_tender_items').run({ tender_id: TID, page: b.proxima_pagina }, ctx);
    assert.equal(a.total_itens, 60);
    assert.ok(b.itens.some((x: any) => x.numero === 40));
    assert.ok(c.itens.some((x: any) => x.numero === 54));
    assert.equal(c.proxima_pagina, null);
  });
  test('filtra antes de paginar e normaliza espaços e acentos', async () => {
    const ctx = paged();
    ctx.state.items[TID][53].descricao = 'Tesoura cirúrgica curva';
    const r: any = await tool('get_tender_items').run({ tender_id: TID, keywords: ['  CIRURGICA  ', ''] }, ctx);
    assert.equal(r.filtrados, 1);
    assert.equal(r.itens[0].numero, 54);
  });
  test('recusa páginas e tamanhos inválidos', async () => {
    for (const args of [{ page: 0 }, { page: -1 }, { page: 1.5 }, { page_size: 0 }, { page_size: 26 }]) {
      const r: any = await tool('get_tender_items').run({ tender_id: TID, ...args }, paged());
      assert.match(r.erro, /p.gina|page/);
    }
  });
  test('oferece descrição integral por item para não perder exigências após o resumo', async () => {
    const ctx = paged();
    const full = 'Descrição do item. '.repeat(100) + 'Exige embalagem individual estéril.';
    ctx.state.items[TID][0].descricao = full;
    const list: any = await tool('get_tender_items').run({ tender_id: TID }, ctx);
    assert.equal(list.itens[0].descricao_truncada, true);
    const single: any = await tool('get_tender_item').run({ tender_id: TID, item: 1 }, ctx);
    assert.equal(single.descricao, full);
  });
  test('a página padrão cabe no limite padrão do histórico do agente', async () => {
    const ctx = paged();
    for (const item of ctx.state.items[TID]) item.descricao = 'Descrição extensa de material médico. '.repeat(100);
    const r = await tool('get_tender_items').run({ tender_id: TID }, ctx);
    assert.ok(JSON.stringify(r).length < 12_000);
  });
  test('permite ler descrições maiores que o limite de uma chamada sem perder o final', async () => {
    const ctx = paged();
    const full = 'Material hospitalar. '.repeat(1000) + 'Exigência final importante.';
    ctx.state.items[TID][0].descricao = full;
    let offset = 0; let read = '';
    do {
      const part: any = await tool('get_tender_item').run({ tender_id: TID, item: 1, offset }, ctx);
      assert.ok(JSON.stringify(part).length < 12_000);
      read += part.descricao;
      offset = part.proximo_offset;
    } while (offset !== null);
    assert.equal(read, full);
  });
});

describe('record_requirement: origem da evidência', () => {
  test('preserva o arquivo que contém a citação, sem duplicar uma repetição', async () => {
    const ctx = context();
    ctx.state.editais[TID] = 'Documento principal. Certidão de regularidade fiscal obrigatória.';
    ctx.state.editalSources![TID] = [
      { nome: 'Edital', url: 'https://example.org/edital.pdf', texto: 'Documento principal.' },
      { nome: 'Anexo', url: 'https://example.org/anexo.pdf', texto: 'Certidão de regularidade fiscal obrigatória.' },
    ];
    const a = { tender_id: TID, requirement: 'certidoes', quote: 'Certidão de regularidade fiscal obrigatória' };
    await tool('record_requirement').run(a, ctx);
    await tool('record_requirement').run(a, ctx);
    assert.equal(ctx.state.requirements.length, 1);
    assert.equal(ctx.state.requirements[0].fonte.url, 'https://example.org/anexo.pdf');
  });
});
