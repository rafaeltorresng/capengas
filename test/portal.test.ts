// Consulta de protocolo no portal sandbox: proposta e esclarecimento.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startSandbox } from '../src/lib/sandbox.ts';
import { consultarProtocolo } from '../src/lib/portal.ts';

let s: Awaited<ReturnType<typeof startSandbox>>;
before(async () => { s = await startSandbox(0); });
after(() => s.close());
const post = (p: string, b: unknown) => fetch(s.url + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());

describe('sandbox: esclarecimento consultável', () => {
  test('GET /api/esclarecimentos/:protocolo devolve o registro', async () => {
    const { protocolo } = await post('/api/esclarecimentos', { tender: 'a/1/1', item: 13, texto: 'Solicitamos esclarecer se o tamanho 00 é obrigatório no item 13.' });
    const r = await fetch(`${s.url}/api/esclarecimentos/${protocolo}`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).item, 13);
  });
  test('protocolo inexistente → 404', async () => {
    assert.equal((await fetch(`${s.url}/api/esclarecimentos/SBX-E-NAO`)).status, 404);
  });
});

describe('consultarProtocolo', () => {
  test('proposta enviada → encontrada', async () => {
    const { protocolo } = await post('/api/propostas', { tender: 'a/1/1', empresa: 'X', itens: [{ numero: 4, marca: 'M', registroAnvisa: '80243520033', precoUnitario: 7.5 }] });
    const r = await consultarProtocolo(s.url, 'proposta', protocolo);
    assert.equal(r.encontrado, true);
    if (r.encontrado) assert.equal((r.registro as any).itens[0].precoUnitario, 7.5);
  });
  test('esclarecimento enviado → encontrado', async () => {
    const { protocolo } = await post('/api/esclarecimentos', { tender: 'a/1/1', item: 18, texto: 'A embalagem individual é exigida para a escova do item 18?' });
    assert.equal((await consultarProtocolo(s.url, 'esclarecimento', protocolo)).encontrado, true);
  });
  test('protocolo inexistente → não encontrado, sem erro de rede', async () => {
    const r = await consultarProtocolo(s.url, 'proposta', 'SBX-NAO');
    assert.equal(r.encontrado, false);
    if (!r.encontrado) assert.equal(r.erro, undefined);
  });
  test('portal fora do ar → não encontrado, com erro (reconciliar depois)', async () => {
    const r = await consultarProtocolo('http://127.0.0.1:9', 'proposta', 'SBX-1');
    assert.equal(r.encontrado, false);
    if (!r.encontrado) assert.match(String(r.erro), /\S/);
  });
});
