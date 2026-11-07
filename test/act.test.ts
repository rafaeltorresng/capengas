// Porta de envio: política e recheque antes do POST; timeout não gera segundo envio.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { executarAcao, type ActDeps, type PedidoAcao } from '../src/lib/act.ts';
import type { ItemDecision, Politica, Recheque } from '../src/lib/contracts.ts';

const politica: Politica = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8')).politica;
const TENDER = '77816510000166/2026/348';
const ok: Recheque = { status: 'ok', situacao: 'Divulgada no PNCP', arquivosHash: 'abc', em: '2026-11-07T18:00:00.000Z' };
const disputar: ItemDecision = { estado: 'disputar', motivos: ['atributos conferidos'] };
const item = { numero: 40, produto: 'TES-01', marca: 'Norte', registroAnvisa: '80123456789', precoUnitario: 100, quantidade: 2 };

function proposta(extra: Record<string, unknown> = {}): PedidoAcao {
  return { tipo: 'enviar_proposta', tenderId: TENDER, empresa: 'Norte Medical', itens: [item], decisoes: [disputar], ...extra } as PedidoAcao;
}

function harness(o: { recheque?: Recheque; enviar?: ActDeps['enviar']; consultar?: ActDeps['consultar']; politica?: Politica | undefined } = {}) {
  const store = openStore(':memory:');
  const posts: unknown[] = [];
  const deps: ActDeps = {
    store, politica: o.politica === undefined && !('politica' in o) ? politica : o.politica, sandboxUrl: 'http://sandbox.test',
    now: () => new Date('2026-11-07T18:00:00-03:00'),
    recheck: async () => o.recheque ?? ok,
    enviar: o.enviar ?? (async (_url, body) => { posts.push(body); return { status: 201, body: { protocolo: 'SBX-1' } }; }),
    consultar: o.consultar ?? (async () => ({ encontrado: true, registro: { protocolo: 'SBX-1' } })),
  };
  return { store, posts, deps };
}

describe('envio permitido', () => {
  test('proposta dentro da política confirma uma vez e a repetição não faz outro POST', async () => {
    const { store, posts, deps } = harness();
    const first = await executarAcao(proposta(), deps);
    const second = await executarAcao(proposta(), deps);
    assert.equal(first.resultado, 'confirmada');
    assert.equal(second.resultado, 'confirmada');
    if (second.resultado === 'confirmada') assert.equal(second.jaExistia, true);
    assert.equal(posts.length, 1);
    const action = store.getActions({ tenderId: TENDER })[0];
    assert.equal(action.status, 'confirmada');
    assert.equal(action.verificado, true);
    assert.equal(action.protocolo, 'SBX-1');
    assert.equal(store.events().filter(event => event.tipo === 'proposta_enviada').length, 1);
    store.close();
  });

  test('esclarecimento automático permitido consulta o protocolo e confirma', async () => {
    const { store, posts, deps } = harness();
    const texto = 'Solicitamos informar a embalagem individual exigida no item, que não consta da ficha.';
    const result = await executarAcao({ tipo: 'enviar_esclarecimento', tenderId: TENDER, item: 40, texto, motivo: 'nao_informado', prazoAberto: true }, deps);
    assert.equal(result.resultado, 'confirmada');
    assert.equal(posts.length, 1);
    assert.equal(store.events().some(event => event.tipo === 'esclarecimento_enviado'), true);
    store.close();
  });
});

describe('falha segura antes do portal', () => {
  test('pregão suspenso não envia e não abre escalada', async () => {
    const { store, posts, deps } = harness({ recheque: { status: 'bloquear', motivo: 'suspenso', em: ok.em } });
    const result = await executarAcao(proposta(), deps);
    assert.equal(result.resultado, 'bloqueada');
    assert.equal(posts.length, 0);
    assert.equal(store.openEscalations().length, 0);
    assert.equal(store.getActions().length, 0);
    store.close();
  });

  test('pendência de cobertura escala e não envia', async () => {
    const { store, posts, deps } = harness();
    const result = await executarAcao(proposta({ decisoes: [{ estado: 'disputar_com_pendencia', motivos: ['cobertura não verificada'] }] }), deps);
    assert.equal(result.resultado, 'escalada');
    assert.equal(posts.length, 0);
    assert.equal(store.openEscalations().length, 1);
    await executarAcao(proposta({ decisoes: [{ estado: 'disputar_com_pendencia', motivos: ['cobertura não verificada'] }] }), deps);
    assert.equal(store.openEscalations().length, 1);
    store.close();
  });

  test('valor acima do limite escala sem POST', async () => {
    const { store, posts, deps } = harness();
    const result = await executarAcao(proposta({ itens: [{ ...item, precoUnitario: 60_000 }] }), deps);
    assert.equal(result.resultado, 'escalada');
    assert.match(result.motivo, /acima do limite/);
    assert.equal(posts.length, 0);
    store.close();
  });

  test('política ausente escala sem POST', async () => {
    const { posts, deps, store } = harness({ politica: undefined });
    const result = await executarAcao(proposta(), deps);
    assert.equal(result.resultado, 'escalada');
    assert.equal(posts.length, 0);
    store.close();
  });

  test('preço inválido para antes de gravar intenção', async () => {
    const { store, posts, deps } = harness();
    const result = await executarAcao(proposta({ itens: [{ ...item, precoUnitario: 0 }] }), deps);
    assert.equal(result.resultado, 'bloqueada');
    assert.equal(posts.length, 0);
    assert.equal(store.getActions().length, 0);
    store.close();
  });
});

describe('idempotência depois do POST', () => {
  test('timeout no POST reconcilia e a tentativa seguinte não reenvia', async () => {
    const { store, posts, deps } = harness({ enviar: async () => { posts.push('post'); return { erro: 'timeout' }; } });
    const first = await executarAcao(proposta(), deps);
    const second = await executarAcao(proposta(), deps);
    assert.equal(first.resultado, 'reconciliar');
    assert.equal(second.resultado, 'reconciliar');
    assert.equal(posts.length, 1);
    assert.equal(store.getActions()[0].status, 'reconciliar');
    store.close();
  });

  test('consulta indisponível depois do protocolo não gera outro POST; nova consulta pode confirmar', async () => {
    const { store, posts, deps } = harness();
    let consultas = 0;
    deps.consultar = async () => {
      consultas++;
      return consultas === 1 ? { encontrado: false, erro: 'timeout' } : { encontrado: true, registro: { protocolo: 'SBX-1' } };
    };
    const first = await executarAcao(proposta(), deps);
    const second = await executarAcao(proposta(), deps);
    assert.equal(first.resultado, 'reconciliar');
    assert.equal(second.resultado, 'confirmada');
    assert.equal(posts.length, 1);
    assert.equal(store.getActions()[0].verificado, true);
    store.close();
  });

  test('portal recusa e a repetição não tenta de novo', async () => {
    const { store, posts, deps } = harness({ enviar: async () => { posts.push('post'); return { status: 422, body: { erros: ['preço'] } }; } });
    assert.equal((await executarAcao(proposta(), deps)).resultado, 'falhou');
    assert.equal((await executarAcao(proposta(), deps)).resultado, 'falhou');
    assert.equal(posts.length, 1);
    assert.equal(store.getActions()[0].status, 'falhou');
    store.close();
  });
});
