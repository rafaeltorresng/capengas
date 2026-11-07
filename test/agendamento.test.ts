// Turno do agendador: escolhe os pregões, monta o estado, roda a análise e grava a foto. Sem modelo nem rede.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { createScheduler } from '../src/lib/scheduler.ts';
import { selecionarPregoes, createAnalysisTurn, resolverPregoesSolicitados, type DemoSelecao } from '../src/lib/agendamento.ts';
import type { LanceState } from '../src/lib/tools.ts';
import type { Recheque } from '../src/lib/contracts.ts';

const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const A = '77816510000166/2026/348', B = '00394452000103/2026/22617', C = '00394429000100/2026/2941';
const SUSPENSO = '60448040000122/2026/701', ZIP = '95422986000102/2026/309';
const pregao = (id: string, abertura: string) => ({ id, orgao: `ÓRGÃO ${id.slice(0, 4)}`, uf: 'PR', abertura, plataforma: 'Compras.gov.br', url: `https://pncp.gov.br/app/editais/${id}` });
const demo: DemoSelecao = {
  pregoes: [pregao(A, '2026-11-23T09:00'), pregao(B, '2026-11-16T09:00'), pregao(C, '2026-11-30T09:30')],
  evento: { id: SUSPENSO, orgao: 'HC-FMUSP' },
  editalIlegivel: { id: ZIP, orgao: 'FAZENDA RIO GRANDE' },
};
const tenderRow = (id: string, o: { hash?: string | null; reavaliar?: boolean } = {}) => ({
  id, orgao: 'X', uf: 'PR', abertura: '2026-11-20T09:00', situacao: 'Divulgada no PNCP', plataforma: 'Compras.gov.br',
  arquivosHash: o.hash ?? null, ultimoCheck: null, reavaliar: o.reavaliar,
});

function setup(o: { limite?: number; recheck?: (id: string) => Promise<Recheque> } = {}) {
  const store = openStore(':memory:');
  const calls = { analisar: [] as string[][], snapshot: [] as string[], recheck: [] as string[], estados: [] as LanceState[] };
  const run = createAnalysisTurn({
    store, company, demo, limite: o.limite ?? 1,
    analisar: async (state, ids) => {
      calls.analisar.push(ids); calls.estados.push(state);
      for (const id of ids) {
        state.items[id] = [{ numero: 1, descricao: 'cabo de bisturi', quantidade: 10 }];
        state.decisions[id + '#1'] = { estado: 'escalar', motivos: ['Revisar evidências'], produto: 'P1', precoProposto: null };
      }
      return { stopped: 'final' };
    },
    snapshot: async (id, s) => { calls.snapshot.push(id); s.upsertTender({ ...s.getTender(id)!, arquivosHash: `h-${id}`, reavaliar: false }); },
    recheck: async (id, s) => {
      calls.recheck.push(id);
      const r = o.recheck ? await o.recheck(id) : { status: 'bloquear' as const, motivo: 'suspenso' as const, em: new Date().toISOString() };
      if (r.status === 'bloquear') s.logEvent({ tipo: 'bloqueio', resumo: `pregão ${r.motivo} no PNCP: ação bloqueada`, tender: id });
      return r;
    },
  });
  return { store, run, calls };
}

describe('selecionarPregoes', () => {
  test('primeiro os marcados para reavaliar, depois os da demo sem foto, até o limite', () => {
    const store = openStore(':memory:');
    store.upsertTender(tenderRow(A, { hash: 'h1' }));
    store.upsertTender(tenderRow(C, { hash: 'h3', reavaliar: true }));
    assert.deepEqual(selecionarPregoes(store, demo, 3), [C, B, ZIP]);
    assert.deepEqual(selecionarPregoes(store, demo, 1), [C]);
  });
  test('pregão já analisado (com foto) e sem marca não volta', () => {
    const store = openStore(':memory:');
    for (const id of [A, B, C, ZIP]) store.upsertTender(tenderRow(id, { hash: 'h' }));
    assert.deepEqual(selecionarPregoes(store, demo, 5), []);
  });
  test('o pregão suspenso da demo não entra na análise', () => {
    const store = openStore(':memory:');
    assert.ok(!selecionarPregoes(store, demo, 10).includes(SUSPENSO));
  });
});

describe('createAnalysisTurn', () => {
  test('monta o estado com cnpj/ano/seq e abertura, analisa e grava a foto', async () => {
    const { run, calls, store } = setup();
    const r = await run({ motivo: 'agendado', horario: '2026-11-08 07:00', origem: 'agendador' });
    assert.deepEqual(calls.analisar, [[A]]);
    const t = calls.estados[0].tenders[A];
    assert.equal(t.cnpj, '77816510000166'); assert.equal(t.ano, 2026); assert.equal(t.seq, 348);
    assert.equal(t.abertura, '2026-11-23T09:00'); assert.equal(t.sistema, 'Compras.gov.br');
    assert.deepEqual(calls.snapshot, [A]);
    assert.equal(store.getTender(A)?.arquivosHash, `h-${A}`);
    assert.match(r.resumo, new RegExp(A));
  });
  test('origem agendador: não grava turno_inicio nem turno_fim', async () => {
    const { run, store } = setup();
    await run({ motivo: 'agendado', horario: '2026-11-08 07:00', origem: 'agendador' });
    assert.deepEqual(store.events().filter(e => e.tipo.startsWith('turno')), []);
  });
  test('turnos seguidos avançam pela seleção sem repetir pregão analisado', async () => {
    const { run, calls } = setup();
    for (let i = 0; i < 5; i++) await run({ motivo: 'agendado', horario: `2026-11-08 0${i}:00`, origem: 'agendador' });
    assert.deepEqual(calls.analisar, [[A], [B], [C], [ZIP]]);
  });
  test('sem pregão a analisar: não chama o modelo e diz isso no resumo', async () => {
    const { run, calls, store } = setup();
    for (const id of [A, B, C, ZIP]) store.upsertTender(tenderRow(id, { hash: 'h' }));
    const r = await run({ motivo: 'demo', origem: 'agendador' });
    assert.deepEqual(calls.analisar, []);
    assert.match(r.resumo, /nenhum pregão/);
  });
  test('pregão suspenso da demo: recheque real registra o bloqueio uma vez só', async () => {
    const { run, calls, store } = setup();
    await run({ motivo: 'demo', origem: 'agendador' });
    await run({ motivo: 'demo', origem: 'agendador' });
    assert.deepEqual(calls.recheck, [SUSPENSO]);
    assert.equal(store.events().filter(e => e.tipo === 'bloqueio' && e.tender === SUSPENSO).length, 1);
  });
  test('recheque do suspenso falha: a análise segue e tenta de novo no próximo turno', async () => {
    const { run, calls } = setup({ recheck: async () => { throw new Error('PNCP fora'); } });
    await run({ motivo: 'demo', origem: 'agendador' });
    await run({ motivo: 'demo', origem: 'agendador' });
    assert.deepEqual(calls.recheck, [SUSPENSO, SUSPENSO]);
    assert.deepEqual(calls.analisar, [[A], [B]]);
  });
  test('falha do modelo propaga para o agendador registrar o turno_fim', async () => {
    const store = openStore(':memory:');
    const run = createAnalysisTurn({ store, company, demo, limite: 1, analisar: async () => { throw new Error('modelo fora'); }, snapshot: async () => {}, recheck: async () => ({ status: 'ok', situacao: 'x', arquivosHash: 'h', em: '' }) });
    await assert.rejects(run({ motivo: 'demo', origem: 'agendador' }), /modelo fora/);
  });
});

describe('agendador + turno de análise', () => {
  test('um tick no horário: um único par turno_inicio/turno_fim, com o pregão no resumo', async () => {
    const t = new Date('2026-11-08T07:05:00-03:00');
    const { store, run } = setup();
    const s = createScheduler({ store, politica: company.politica, now: () => t, runTurn: run,
      runMonitor: async () => ({ verificados: 0, mudancas: 0, falhas: 0, ignorados: 0 }) });
    assert.equal((await s.tick()).turno, 'concluido');
    const turnos = store.events().filter(e => e.tipo.startsWith('turno'));
    assert.deepEqual(turnos.map(e => e.tipo), ['turno_inicio', 'turno_fim']);
    assert.match(turnos[1].resumo, new RegExp(A));
  });
});

describe('resolverPregoesSolicitados', () => {
  test('aceita os pregões e as exceções da demo que não estão em coverage', () => {
    const ids = [A, B, C, SUSPENSO, ZIP];
    const resolvidos = resolverPregoesSolicitados(ids, [], demo);
    assert.deepEqual(Object.keys(resolvidos), ids);
    assert.deepEqual(resolvidos[B], {
      cnpj: '00394452000103', ano: 2026, seq: 22617,
      orgao: demo.pregoes[1].orgao, uf: 'PR', municipio: undefined,
      abertura: '2026-11-16T09:00', sistema: 'Compras.gov.br', url: demo.pregoes[1].url,
    });
    assert.equal(resolvidos[ZIP].orgao, 'FAZENDA RIO GRANDE');
    assert.equal(resolvidos[ZIP].abertura, null);
  });

  test('preserva a referência de coverage e rejeita um pregão fora da seleção', () => {
    const conhecido = { cnpj: '77816510000166', ano: 2026, seq: 348, objeto: 'Descrição de coverage' };
    assert.equal(resolverPregoesSolicitados([A], [conhecido], demo)[A], conhecido);
    assert.throws(() => resolverPregoesSolicitados(['11111111000111/2026/999'], [conhecido], demo), /coverage e demo/);
  });
});
