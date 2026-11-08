import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { startSandbox } from '../src/lib/sandbox.ts';

let s: Awaited<ReturnType<typeof startSandbox>>;
before(async () => { s = await startSandbox(0); });
after(() => s.close());

const post = (p: string, b: unknown) => fetch(s.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });

describe('portal sandbox', () => {
  test('registra proposta válida e devolve protocolo consultável', async () => {
    const r = await post('/api/propostas', { tender: '77816510000166/2026/348', empresa: 'X', itens: [{ numero: 4, produto: 'P1', marca: 'Allplan', registroAnvisa: '80243520033', precoUnitario: 7.25 }] });
    assert.equal(r.status, 201);
    const { protocolo } = await r.json();
    assert.match(protocolo, /^SBX-/);
    const g = await (await fetch(`${s.url}/api/propostas/${protocolo}`)).json();
    assert.equal(g.itens[0].precoUnitario, 7.25);
  });
  test('rejeita proposta sem registro ANVISA ou com preço inválido', async () => {
    assert.equal((await post('/api/propostas', { tender: 'a/1/1', empresa: 'X', itens: [{ numero: 1, precoUnitario: 0 }] })).status, 422);
  });
  test('registra pedido de esclarecimento', async () => {
    const r = await post('/api/esclarecimentos', { tender: 'a/1/1', item: 3, texto: 'Solicitamos esclarecer se é aceito produto similar ao da marca de referência.' });
    assert.equal(r.status, 201);
  });
  test('proposta com PDFs anexos: confere o hash e devolve só nome, tamanho e hash na consulta', async () => {
    const pdf = Buffer.from('%PDF-1.7\nproposta');
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    const item = { numero: 4, produto: 'P1', marca: 'Allplan', registroAnvisa: '80243520033', precoUnitario: 7.25 };
    const r = await post('/api/propostas', { tender: 'a/1/1', empresa: 'X', itens: [item], anexos: [{ nome: 'proposta.pdf', conteudo: pdf.toString('base64'), sha256 }] });
    assert.equal(r.status, 201);
    const g = await (await fetch(`${s.url}/api/propostas/${(await r.json()).protocolo}`)).json();
    assert.deepEqual(g.anexos, [{ nome: 'proposta.pdf', bytes: pdf.length, sha256 }]);
    const errado = await post('/api/propostas', { tender: 'a/1/1', empresa: 'X', itens: [item], anexos: [{ nome: 'p.pdf', conteudo: pdf.toString('base64'), sha256: '0'.repeat(64) }] });
    assert.equal(errado.status, 422);
    const naoPdf = Buffer.from('texto');
    const texto = await post('/api/propostas', { tender: 'a/1/1', empresa: 'X', itens: [item], anexos: [{ nome: 'p.pdf', conteudo: naoPdf.toString('base64'), sha256: createHash('sha256').update(naoPdf).digest('hex') }] });
    assert.equal(texto.status, 422);
  });
  test('protocolo inexistente → 404', async () => {
    assert.equal((await fetch(`${s.url}/api/propostas/SBX-nao`)).status, 404);
  });
});
