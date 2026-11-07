// Agendador: turnos nos horários da política, monitor periódico, trava sem sobreposição, modo demo.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { createScheduler } from '../src/lib/scheduler.ts';
import type { Politica } from '../src/lib/contracts.ts';

const politica: Politica = { ...JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8')).politica, turnos: ['07:00', '11:00', '15:00'], monitorMinutos: 30 };
const clock = (iso: string) => { let t = new Date(iso).getTime(); return { now: () => new Date(t), set: (s: string) => { t = new Date(s).getTime(); }, advance: (min: number) => { t += min * 60e3; } }; };
const deferred = () => { let resolve!: () => void, reject!: (e: Error) => void; const p = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };

function setup(start: string, o: { runTurn?: () => Promise<any>; politica?: any } = {}) {
  const c = clock(start);
  const store = openStore(':memory:', { now: c.now });
  const calls = { turnos: 0, monitores: 0 };
  const s = createScheduler({
    store, politica: o.politica ?? politica, now: c.now,
    runTurn: o.runTurn ?? (async () => { calls.turnos++; return { resumo: 'ok' }; }),
    runMonitor: async () => { calls.monitores++; return { verificados: 0, mudancas: 0, falhas: 0, ignorados: 0 }; },
  });
  return { c, store, s, calls };
}
const tipos = (store: any) => store.events().map((e: any) => e.tipo);

describe('turnos nos horários da política (America/Recife)', () => {
  test('antes do primeiro horário → nenhum turno; no horário → roda e registra início e fim', async () => {
    const { c, s, store, calls } = setup('2026-11-08T06:50:00-03:00');
    assert.equal((await s.tick()).turno, 'nenhum');
    c.set('2026-11-08T07:00:30-03:00');
    assert.equal((await s.tick()).turno, 'concluido');
    assert.equal(calls.turnos, 1);
    assert.deepEqual(tipos(store).filter((t: string) => t.startsWith('turno')), ['turno_inicio', 'turno_fim']);
    assert.match(store.events().find((e: any) => e.tipo === 'turno_inicio')?.detalhe ?? '', /2026-11-08 07:00/);
  });
  test('o mesmo horário não roda duas vezes', async () => {
    const { c, s, calls } = setup('2026-11-08T07:01:00-03:00');
    await s.tick(); c.advance(5); await s.tick();
    assert.equal(calls.turnos, 1);
  });
  test('reiniciar o processo não repete o turno já rodado (lê os eventos)', async () => {
    const { c, s, store, calls } = setup('2026-11-08T07:01:00-03:00');
    await s.tick();
    const s2 = createScheduler({ store, politica, now: c.now, runTurn: async () => { calls.turnos++; }, runMonitor: async () => ({ verificados: 0, mudancas: 0, falhas: 0, ignorados: 0 }) });
    c.advance(1); await s2.tick();
    assert.equal(calls.turnos, 1);
  });
  test('ligar às 16h roda só o turno mais recente que passou (15:00), uma vez', async () => {
    const { c, s, store, calls } = setup('2026-11-08T16:00:00-03:00');
    await s.tick(); c.advance(1); await s.tick();
    assert.equal(calls.turnos, 1);
    assert.match(store.events().find((e: any) => e.tipo === 'turno_inicio')?.detalhe ?? '', /15:00/);
  });
  test('fuso: 07:00 em Recife é 10:00 UTC', async () => {
    const { s, calls } = setup('2026-11-08T09:59:00Z');
    await s.tick(); assert.equal(calls.turnos, 0);
    const { s: s2, calls: c2 } = setup('2026-11-08T10:00:00Z');
    await s2.tick(); assert.equal(c2.turnos, 1);
  });
});

describe('trava: nunca dois turnos ao mesmo tempo', () => {
  test('turno em andamento → novo tick fica ocupado; depois libera', async () => {
    const d = deferred();
    let n = 0;
    const { c, s } = setup('2026-11-08T07:00:00-03:00', { runTurn: async () => { n++; await d.p; } });
    const first = s.tick();
    await new Promise(r => setImmediate(r));
    c.set('2026-11-08T11:00:00-03:00');
    assert.equal((await s.tick()).turno, 'ocupado');
    d.resolve(); await first;
    assert.equal((await s.tick()).turno, 'concluido');
    assert.equal(n, 2);
  });
  test('turno que falha registra a falha e libera a trava', async () => {
    const { c, s, store } = setup('2026-11-08T07:00:00-03:00', { runTurn: async () => { throw new Error('modelo fora do ar'); } });
    assert.equal((await s.tick()).turno, 'falhou');
    const fim = store.events().find((e: any) => e.tipo === 'turno_fim');
    assert.match(fim?.resumo ?? '', /falhou.*modelo fora do ar/);
    c.set('2026-11-08T11:00:00-03:00');
    assert.equal((await s.tick()).turno, 'falhou');
  });
});

describe('monitor periódico', () => {
  test('roda no primeiro tick e depois a cada monitorMinutos', async () => {
    const { c, s, calls } = setup('2026-11-08T08:00:00-03:00');
    await s.tick(); assert.equal(calls.monitores, 1);
    c.advance(10); await s.tick(); assert.equal(calls.monitores, 1);
    c.advance(25); await s.tick(); assert.equal(calls.monitores, 2);
  });
  test('não roda enquanto um turno está em andamento', async () => {
    const d = deferred();
    const { c, s, calls } = setup('2026-11-08T07:00:00-03:00', { runTurn: async () => { await d.p; } });
    const first = s.tick();
    await new Promise(r => setImmediate(r));
    const monitoresAntes = calls.monitores;
    c.advance(40);
    assert.equal((await s.tick()).monitor, 'pulado');
    assert.equal(calls.monitores, monitoresAntes);
    d.resolve(); await first;
  });
});

describe('trava única entre monitor e turno (regressão do PR #5, achada pelo Dev 2)', () => {
  function comMonitorPendente(start: string) {
    const c = clock(start);
    const store = openStore(':memory:', { now: c.now });
    const ordem: string[] = [];
    const m = deferred();
    const s = createScheduler({
      store, politica, now: c.now,
      runTurn: async () => { ordem.push('turno_inicio'); },
      runMonitor: async () => { ordem.push('monitor_inicio'); await m.p; ordem.push('monitor_fim'); return { verificados: 0, mudancas: 0, falhas: 0, ignorados: 0 }; },
    });
    return { s, ordem, m };
  }
  test('segundo tick com monitor ainda rodando não inicia turno', async () => {
    const { s, ordem, m } = comMonitorPendente('2026-11-08T07:00:00-03:00');
    const primeiro = s.tick();
    await new Promise(r => setImmediate(r));
    const segundo = await s.tick();
    assert.deepEqual(segundo, { turno: 'ocupado', monitor: 'pulado' });
    assert.deepEqual(ordem, ['monitor_inicio']);
    m.resolve(); await primeiro;
    assert.deepEqual(ordem, ['monitor_inicio', 'monitor_fim', 'turno_inicio']);
  });
  test('runNext com monitor rodando → ocupado, sem turno', async () => {
    const { s, ordem, m } = comMonitorPendente('2026-11-08T13:00:00-03:00');
    const primeiro = s.tick();
    await new Promise(r => setImmediate(r));
    assert.equal(await s.runNext(0), 'ocupado');
    assert.equal(ordem.includes('turno_inicio'), false);
    m.resolve(); await primeiro;
  });
  test('tick durante um turno de demonstração → ocupado', async () => {
    const d = deferred();
    const { s } = setup('2026-11-08T13:00:00-03:00', { runTurn: async () => { await d.p; } });
    const demo = s.runNext(0);
    await new Promise(r => setTimeout(r, 5));
    assert.equal((await s.tick()).turno, 'ocupado');
    d.resolve(); await demo;
  });
  test('o contexto avisa que os eventos de turno são do agendador', async () => {
    let ctx: any;
    const { s } = setup('2026-11-08T07:00:00-03:00', { runTurn: async (c?: any) => { ctx = c; } });
    await s.tick();
    assert.equal(ctx.origem, 'agendador');
  });
});

describe('falha segura e modo demo', () => {
  test('política inválida → nenhum turno nem monitor, um evento de erro', async () => {
    const { s, store, calls } = setup('2026-11-08T07:00:00-03:00', { politica: { ...politica, turnos: ['7h'] } });
    const r = await s.tick(); await s.tick();
    assert.equal(r.turno, 'bloqueado'); assert.equal(calls.turnos + calls.monitores, 0);
    assert.equal(store.events().filter((e: any) => e.tipo === 'bloqueio').length, 1);
  });
  test('runNext dispara um turno de demonstração depois do atraso, respeitando a trava', async () => {
    const { s, store, calls } = setup('2026-11-08T13:00:00-03:00');
    await s.runNext(15);
    assert.equal(calls.turnos, 1);
    assert.match(store.events().find((e: any) => e.tipo === 'turno_inicio')?.detalhe ?? '', /demo/);
  });
  test('status informa o próximo turno e se há um em andamento', async () => {
    const { s } = setup('2026-11-08T12:00:00-03:00');
    await s.tick();
    const st = s.status();
    assert.equal(st.rodando, false);
    assert.match(st.proximoTurno ?? '', /2026-11-08 15:00/);
  });
});
