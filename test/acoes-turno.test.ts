// Fase de ações do turno agendado: o código (não o modelo) envia pela porta o que a evidência e a política permitem.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { newState } from '../src/lib/tools.ts';
import { executarAcoesDoTurno, createAnalysisTurn, type DemoSelecao } from '../src/lib/agendamento.ts';
import type { Recheque } from '../src/lib/contracts.ts';

const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const T = '77816510000166/2026/348';
const agora = new Date('2026-11-07T18:00:00-03:00');
const ok: Recheque = { status: 'ok', situacao: 'Divulgada no PNCP', arquivosHash: 'h', em: agora.toISOString() };
const TEXTO = 'Solicitamos esclarecer se a embalagem individual estéril é obrigatória para o item 40.';

function setup(o: { reavaliar?: boolean; estado?: string; preco?: number | null; quantidade?: number; atributos?: unknown } = {}) {
  const store = openStore(':memory:', { now: () => agora });
  store.upsertTender({ id: T, orgao: 'FRANCISCO BELTRAO', uf: 'PR', abertura: '2026-11-23T09:00', situacao: 'Divulgada no PNCP',
    plataforma: 'Compras.gov.br', arquivosHash: 'h', ultimoCheck: null, reavaliar: o.reavaliar });
  store.upsertItems(T, [{ tenderId: T, numero: 40, descricao: 'tesoura', catalogCode: null, quantidade: o.quantidade ?? 10, estimativa: 100, sigiloso: false }]);
  store.upsertFit({ tenderId: T, item: 40, produto: 'P1', fit: 'desconhecido',
    atributos: o.atributos ?? { attributes: [{ atributo: 'embalagem', veredito: 'nao_informado' }], restritivo: null, varianteNaoCoberta: false } });
  store.upsertDecision({ tenderId: T, item: 40, produto: 'P1', estado: (o.estado ?? 'escalar') as any, motivos: ['m'], precoProposto: o.preco === undefined ? 50 : o.preco });
  const state = newState(company, 'http://sandbox', agora);
  const posts: { url: string; body: any }[] = [];
  const deps = {
    store, company, sandboxUrl: 'http://sandbox', now: () => agora, recheck: async () => ok,
    enviar: async (url: string, body: unknown) => { posts.push({ url, body }); return { status: 201, body: { protocolo: `P-${posts.length}` } }; },
    consultar: async () => ({ encontrado: true as const, registro: {} }),
  };
  return { store, state, posts, deps };
}

describe('executarAcoesDoTurno', () => {
  test('rascunho com evidência de "não informado" e prazo aberto: envia sozinho e confirma o protocolo', async () => {
    const { store, state, posts, deps } = setup();
    state.drafts[`${T}#40`] = { texto: TEXTO, prazo: '2026-11-18' };
    const r = await executarAcoesDoTurno({ ...deps, state, ids: [T] });
    assert.equal(posts.length, 1);
    assert.match(posts[0].url, /\/api\/esclarecimentos$/);
    assert.equal(r.esclarecimentos.confirmada, 1);
    assert.equal(store.getActions({ status: 'confirmada' }).length, 1);
    assert.ok(store.events().some(e => e.tipo === 'esclarecimento_enviado' && e.tender === T));
  });
  test('rascunho sem evidência gravada: abre escalada e não envia', async () => {
    const { store, state, posts, deps } = setup({ atributos: { attributes: [{ atributo: 'material', veredito: 'atende' }] } });
    state.drafts[`${T}#40`] = { texto: TEXTO, prazo: '2026-11-18' };
    const r = await executarAcoesDoTurno({ ...deps, state, ids: [T] });
    assert.equal(posts.length, 0);
    assert.equal(r.esclarecimentos.escalada, 1);
    assert.ok(store.openEscalations().some(e => e.tender === T && e.item === '40' && /evidência/.test(e.motivo)));
  });
  test('itens em escalar: nenhuma proposta', async () => {
    const { state, posts, deps } = setup();
    await executarAcoesDoTurno({ ...deps, state, ids: [T] });
    assert.equal(posts.length, 0);
  });
  test('item em disputar, dentro do limite: envia a proposta com o preço e a quantidade do store', async () => {
    const { state, posts, deps } = setup({ estado: 'disputar', preco: 50, quantidade: 10 });
    const r = await executarAcoesDoTurno({ ...deps, state, ids: [T] });
    assert.equal(posts.length, 1);
    assert.match(posts[0].url, /\/api\/propostas$/);
    assert.deepEqual(posts[0].body.itens.map((i: any) => [i.numero, i.precoUnitario, i.quantidade]), [[40, 50, 10]]);
    assert.equal(r.propostas.confirmada, 1);
  });
  test('item em disputar acima do limite: escala, zero POST', async () => {
    const { store, state, posts, deps } = setup({ estado: 'disputar', preco: 90, quantidade: 1000 });
    const r = await executarAcoesDoTurno({ ...deps, state, ids: [T] });
    assert.equal(posts.length, 0);
    assert.equal(r.propostas.escalada, 1);
    assert.ok(store.openEscalations().some(e => /limite/.test(e.motivo)));
  });
  test('pregão marcado pelo monitor: nada sai, mesmo com rascunho e evidência', async () => {
    const { state, posts, deps } = setup({ reavaliar: true, estado: 'disputar' });
    state.drafts[`${T}#40`] = { texto: TEXTO, prazo: '2026-11-18' };
    const r = await executarAcoesDoTurno({ ...deps, state, ids: [T] });
    assert.equal(posts.length, 0);
    assert.equal(r.bloqueados, 1);
  });
  test('repetir a fase no mesmo estado não faz outro POST (chave idempotente)', async () => {
    const { state, posts, deps } = setup();
    state.drafts[`${T}#40`] = { texto: TEXTO, prazo: '2026-11-18' };
    await executarAcoesDoTurno({ ...deps, state, ids: [T] });
    await executarAcoesDoTurno({ ...deps, state, ids: [T] });
    assert.equal(posts.length, 1);
  });
});

describe('turno agendado com fase de ações', () => {
  test('a fase de ações roda depois da análise e o resumo conta os envios', async () => {
    const { store, deps } = setup();
    const demo: DemoSelecao = { pregoes: [{ id: '00394429000100/2026/2941', orgao: 'AERONÁUTICA', uf: 'GO', abertura: '2026-11-30T09:30', plataforma: 'Compras.gov.br' }] };
    const ordem: string[] = [];
    const run = createAnalysisTurn({ store, company, demo,
      analisar: async (state, ids) => { ordem.push('analisar'); state.items[ids[0]] = [{ numero: 1, descricao: 'x', quantidade: 1 }]; return { stopped: 'final' }; },
      snapshot: async (id, s) => { ordem.push('foto'); s.upsertTender({ ...s.getTender(id)!, arquivosHash: 'h' }); },
      recheck: deps.recheck,
      agir: async (_state, ids) => { ordem.push(`agir:${ids.join(',')}`); return { esclarecimentos: { confirmada: 1 }, propostas: {}, bloqueados: 0 }; },
    });
    const r = await run({ motivo: 'demo', origem: 'agendador' });
    assert.deepEqual(ordem, ['analisar', 'foto', 'agir:00394429000100/2026/2941']);
    assert.match(r.resumo, /1 esclarecimento confirmado/);
  });
});
