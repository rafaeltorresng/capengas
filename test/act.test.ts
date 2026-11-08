// Porta de envio: fatos vêm do store; o pedido não define quantidade, decisão, preço nem prazo.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { openStore, type LanceStore } from '../src/lib/store.ts';
import { executarAcao, type ActDeps, type PedidoAcao } from '../src/lib/act.ts';
import type { Politica, Recheque } from '../src/lib/contracts.ts';

const politica: Politica = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8')).politica;
const TENDER = '77816510000166/2026/348';
const ok: Recheque = { status: 'ok', situacao: 'Divulgada no PNCP', arquivosHash: 'abc', em: '2026-11-07T18:00:00.000Z' };
const catalogo = [{ id: 'TES-01', marca: 'Norte', registroAnvisa: '80123456789' }];

function seed(store: LanceStore, o: { quantidade?: number; preco?: number | null; estado?: string; abertura?: string | null; decidir?: boolean } = {}) {
  store.upsertTender({
    id: TENDER, orgao: 'Hospital', uf: 'PR', abertura: o.abertura === undefined ? '2026-12-15T10:00' : o.abertura,
    situacao: 'Divulgada no PNCP', plataforma: 'Compras.gov.br', arquivosHash: 'abc', ultimoCheck: null,
  });
  store.upsertItems(TENDER, [{ tenderId: TENDER, numero: 40, descricao: 'Tesoura', catalogCode: null, quantidade: o.quantidade ?? 2, estimativa: 500, sigiloso: false }]);
  if (o.decidir !== false) {
    store.upsertDecision({ tenderId: TENDER, item: 40, produto: 'TES-01', estado: (o.estado ?? 'disputar') as 'disputar', motivos: ['atributos conferidos'], precoProposto: o.preco === undefined ? 100 : o.preco });
  }
}

function harness(o: { recheque?: Recheque; enviar?: ActDeps['enviar']; consultar?: ActDeps['consultar']; politica?: Politica | undefined; seed?: Parameters<typeof seed>[1] } = {}) {
  const store = openStore(':memory:');
  seed(store, o.seed);
  const posts: any[] = [];
  const deps: ActDeps = {
    store, politica: 'politica' in o ? o.politica : politica, sandboxUrl: 'http://sandbox.test', empresa: 'Norte Medical', catalogo,
    now: () => new Date('2026-11-07T18:00:00-03:00'),
    recheck: async () => o.recheque ?? ok,
    enviar: o.enviar ?? (async (_url, body) => { posts.push(body); return { status: 201, body: { protocolo: 'SBX-1' } }; }),
    consultar: o.consultar ?? (async () => ({ encontrado: true, registro: { protocolo: 'SBX-1' } })),
  };
  return { store, posts, deps };
}

const proposta = (): PedidoAcao => ({ tipo: 'enviar_proposta', tenderId: TENDER, itens: [40] });

describe('envio permitido', () => {
  test('proposta dentro da política confirma uma vez e a repetição não faz outro POST', async () => {
    const { store, posts, deps } = harness();
    const first = await executarAcao(proposta(), deps);
    const second = await executarAcao(proposta(), deps);
    assert.equal(first.resultado, 'confirmada');
    assert.equal(second.resultado, 'confirmada');
    if (second.resultado === 'confirmada') assert.equal(second.jaExistia, true);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].itens[0].precoUnitario, 100);
    assert.equal(posts[0].itens[0].quantidade, 2);
    const action = store.getActions({ tenderId: TENDER })[0];
    assert.equal(action.status, 'confirmada');
    assert.equal(action.verificado, true);
    assert.equal(store.events().filter(event => event.tipo === 'proposta_enviada').length, 1);
    store.close();
  });

  test('proposta leva os PDFs anexos com o hash do conteúdo', async () => {
    const { store, posts, deps } = harness();
    const pdf = new Uint8Array(Buffer.from('%PDF-1.7\nproposta'));
    const result = await executarAcao({ ...proposta(), anexos: [{ nome: 'proposta.pdf', pdf }] } as PedidoAcao, deps);
    assert.equal(result.resultado, 'confirmada');
    assert.deepEqual(posts[0].anexos, [{ nome: 'proposta.pdf', conteudo: Buffer.from(pdf).toString('base64'),
      sha256: createHash('sha256').update(pdf).digest('hex') }]);
    store.close();
  });

  test('item com pendência só sai com as pendências gravadas aprovadas pelo humano', async () => {
    const { store, posts, deps } = harness({ seed: { estado: 'disputar_com_pendencia' } });
    assert.equal((await executarAcao(proposta(), deps)).resultado, 'escalada');
    assert.equal((await executarAcao({ ...proposta(), pendenciasAprovadas: ['outra coisa'] } as PedidoAcao, deps)).resultado, 'escalada');
    assert.equal(posts.length, 0);
    const r = await executarAcao({ ...proposta(), pendenciasAprovadas: ['atributos conferidos'] } as PedidoAcao, deps);
    assert.equal(r.resultado, 'confirmada');
    assert.equal(posts.length, 1);
    assert.ok(store.events().some(e => e.tipo === 'escalada_decidida' && /atributos conferidos/.test(e.resumo)));
    store.close();
  });

  test('esclarecimento com prazo legal ainda aberto confirma', async () => {
    const { store, posts, deps } = harness();
    const texto = 'Solicitamos informar a embalagem individual exigida no item, que não consta da ficha.';
    const result = await executarAcao({ tipo: 'enviar_esclarecimento', tenderId: TENDER, item: 40, texto, motivo: 'nao_informado' }, deps);
    assert.equal(result.resultado, 'confirmada');
    assert.equal(posts.length, 1);
    assert.equal(store.events().some(event => event.tipo === 'esclarecimento_enviado'), true);
    store.close();
  });
});

describe('fatos do store, não do pedido', () => {
  test('quantidade do store entra no valor e estoura o limite', async () => {
    const { store, posts, deps } = harness({ seed: { quantidade: 1000, preco: 90 } });
    const result = await executarAcao(proposta(), deps);
    assert.equal(result.resultado, 'escalada');
    assert.match(result.motivo, /acima do limite/);
    assert.equal(posts.length, 0);
    store.close();
  });

  test('sem decisão gravada não envia, mesmo que o chamador queira disputar', async () => {
    const { store, posts, deps } = harness({ seed: { decidir: false } });
    const result = await executarAcao({ ...proposta(), decisoes: [{ estado: 'disputar', motivos: ['ok'] }] } as unknown as PedidoAcao, deps);
    assert.equal(result.resultado, 'bloqueada');
    assert.match(result.motivo, /decisão ausente/);
    assert.equal(posts.length, 0);
    store.close();
  });

  test('o preço enviado é o precoProposto do store', async () => {
    const { store, posts, deps } = harness({ seed: { preco: 10, quantidade: 1 } });
    const result = await executarAcao({ ...proposta(), itens: [{ numero: 40, precoUnitario: 1, quantidade: 1 }] } as any, deps);
    assert.equal(result.resultado, 'confirmada');
    assert.equal(posts[0].itens[0].precoUnitario, 10);
    assert.equal(posts[0].itens[0].quantidade, 1);
    store.close();
  });

  test('preço calculado ausente bloqueia', async () => {
    const { store, posts, deps } = harness({ seed: { preco: null } });
    const result = await executarAcao(proposta(), deps);
    assert.equal(result.resultado, 'bloqueada');
    assert.match(result.motivo, /preço calculado ausente/);
    assert.equal(posts.length, 0);
    store.close();
  });

  test('prazoAberto informado pelo chamador não abre um prazo já vencido', async () => {
    const { store, posts, deps } = harness({ seed: { abertura: '2026-11-09T10:00' } });
    const texto = 'Solicitamos informar a embalagem individual exigida no item, que não consta da ficha.';
    const result = await executarAcao({ tipo: 'enviar_esclarecimento', tenderId: TENDER, item: 40, texto, motivo: 'nao_informado', prazoAberto: true } as any, deps);
    assert.equal(result.resultado, 'escalada');
    assert.match(result.motivo, /prazo de esclarecimento vencido/);
    assert.equal(posts.length, 0);
    store.close();
  });

  test('sem abertura persistida o esclarecimento não sai', async () => {
    const { store, posts, deps } = harness({ seed: { abertura: null } });
    const texto = 'Solicitamos informar a embalagem individual exigida no item, que não consta da ficha.';
    const result = await executarAcao({ tipo: 'enviar_esclarecimento', tenderId: TENDER, item: 40, texto, motivo: 'nao_informado' }, deps);
    assert.equal(result.resultado, 'bloqueada');
    assert.match(result.motivo, /abertura ausente/);
    assert.equal(posts.length, 0);
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
    const { store, posts, deps } = harness({ seed: { estado: 'disputar_com_pendencia' } });
    const result = await executarAcao(proposta(), deps);
    assert.equal(result.resultado, 'escalada');
    assert.equal(posts.length, 0);
    assert.equal(store.openEscalations().length, 1);
    await executarAcao(proposta(), deps);
    assert.equal(store.openEscalations().length, 1);
    store.close();
  });

  test('política ausente escala sem POST', async () => {
    const { posts, deps, store } = harness({ politica: undefined });
    const result = await executarAcao(proposta(), deps);
    assert.equal(result.resultado, 'escalada');
    assert.equal(posts.length, 0);
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
