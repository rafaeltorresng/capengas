import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarBiblioteca, selecionarCatalogos } from '../src/lib/catalogos-demo.ts';
const p = (id: string) => ({
  id,
  nome: id,
  marca: 'Teste',
  registroAnvisa: '123',
  custo: 7,
  ficha: 'Ficha sintética',
  termos: ['tesoura'],
});
const company = { empresa: { nome: 'Fictícia' }, catalogo: [p('P1'), p('P2')] };
const manifest = {
  arquivos: [
    { id: 'a', nome: 'a.xlsx', titulo: 'Instrumental', produtos: ['P1'] },
    { id: 'b', nome: 'b.xlsx', titulo: 'Cirúrgico', produtos: ['P1', 'P2'] },
  ],
  produtos: [],
};
test('seleção combina produtos canônicos sem duplicar e sem alterar empresa global', () => {
  const lib = criarBiblioteca(company.catalogo, manifest);
  const s = selecionarCatalogos(lib, ['b', 'a', 'b']);
  assert.deepEqual(
    s.produtos.map((p) => p.id),
    ['P1', 'P2'],
  );
  assert.deepEqual(
    s.arquivos.map((a) => a.id),
    ['a', 'b'],
  );
  assert.equal(s.hash, selecionarCatalogos(lib, ['a', 'b']).hash);
  s.produtos[0].custo = 1;
  assert.equal(company.catalogo[0].custo, 7);
  assert.equal(selecionarCatalogos(lib, ['a']).produtos[0].custo, 7);
});
test('seleção rejeita arquivo desconhecido, seleção vazia e manifesto inconsistente', () => {
  const lib = criarBiblioteca(company.catalogo, manifest);
  assert.throws(() => selecionarCatalogos(lib, []));
  assert.throws(() => selecionarCatalogos(lib, ['x']));
  assert.throws(() => criarBiblioteca(company.catalogo, { ...manifest, produtos: [p('P1')] }));
  assert.throws(() =>
    criarBiblioteca(company.catalogo, { ...manifest, arquivos: [{ ...manifest.arquivos[0], produtos: ['x'] }] }),
  );
});
test('versão do catálogo muda quando ficha ou custo muda, sem modificar o retrato anterior', () => {
  const s = selecionarCatalogos(criarBiblioteca(company.catalogo, manifest), ['a']);
  const changed = structuredClone(company.catalogo);
  changed[0].ficha += ' Alterada';
  const next = selecionarCatalogos(criarBiblioteca(changed, manifest), ['a']);
  assert.notEqual(s.hash, next.hash);
  assert.notEqual(s.arquivos[0].versao, next.arquivos[0].versao);
  assert.equal(s.produtos[0].ficha, 'Ficha sintética');
});

test('biblioteca ampliada conserva os seis produtos e confere todos os registros na base oficial local', async (t) => {
  const { readFileSync, existsSync } = await import('node:fs');
  const empresa = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));
  const manifesto = JSON.parse(readFileSync(new URL('../fixtures/catalogos.json', import.meta.url), 'utf8'));
  const b = criarBiblioteca(empresa.catalogo, manifesto);
  for (const p of empresa.catalogo)
    assert.deepEqual(
      b.produtos.find((x) => x.id === p.id),
      p,
    );
  if (!existsSync(new URL('../data/anvisa.csv', import.meta.url))) {
    t.skip('Base ANVISA local não disponível.');
    return;
  }
  const { anvisa } = await import('../src/lib/data.ts');
  const { conferirCatalogo } = await import('../src/lib/catalogo.ts');
  assert.deepEqual(
    conferirCatalogo(b.produtos, (n) => anvisa.byRegistro(n), new Date()).filter((p) => p.status !== 'confere'),
    [],
  );
});
