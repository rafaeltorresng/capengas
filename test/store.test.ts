// Estado persistente (contrato Store em src/lib/contracts.ts).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/lib/store.ts';

const T = '77816510000166/2026/348';
const tender = { id: T, orgao: 'Município de Francisco Beltrão', uf: 'PR', abertura: '2026-11-23', situacao: 'Divulgada no PNCP', plataforma: 'Compras.gov.br', arquivosHash: 'h1', ultimoCheck: '2026-11-07T10:00:00-03:00' };
const clock = (iso: string) => { let t = new Date(iso).getTime(); return { now: () => new Date(t), advance: (ms: number) => { t += ms; } }; };

describe('store: persistência e upserts', () => {
  test('banco novo cria as tabelas e os dados sobrevivem a reabrir', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'lance-')), 'lance.db');
    const a = openStore(file); a.upsertTender(tender); a.close();
    const b = openStore(file);
    assert.equal(b.getTender(T)?.orgao, tender.orgao);
    b.close();
  });
  test('upsertTender duas vezes atualiza, sem duplicar', () => {
    const s = openStore(':memory:');
    s.upsertTender(tender); s.upsertTender({ ...tender, situacao: 'Suspensa' });
    assert.equal(s.getTender(T)?.situacao, 'Suspensa');
    assert.equal(s._count('tenders'), 1);
  });
  test('upsertItems grava e devolve em ordem de número; sigiloso vira boolean', () => {
    const s = openStore(':memory:');
    s.upsertItems(T, [
      { tenderId: T, numero: 40, descricao: 'Tesoura', catalogCode: 471547, quantidade: 25, estimativa: 424.47, sigiloso: false },
      { tenderId: T, numero: 4, descricao: 'Cabo de bisturi', catalogCode: 299116, quantidade: 20, estimativa: null, sigiloso: true },
    ]);
    s.upsertItems(T, [{ tenderId: T, numero: 4, descricao: 'Cabo de bisturi nº 4', catalogCode: 299116, quantidade: 20, estimativa: null, sigiloso: true }]);
    const it = s.getItems(T);
    assert.deepEqual(it.map(i => i.numero), [4, 40]);
    assert.equal(it[0].descricao, 'Cabo de bisturi nº 4');
    assert.equal(it[0].sigiloso, true);
    assert.equal(it[0].estimativa, null);
  });
  test('upsertFit e upsertRequirement são idempotentes; atributos ficam como vieram', () => {
    const s = openStore(':memory:');
    const fit = { tenderId: T, item: 4, produto: 'P1', fit: 'atende' as const, atributos: { attributes: [{ atributo: 'tamanho' }], validacao: { cobertura: 'nao_verificada' } } };
    s.upsertFit(fit); s.upsertFit(fit);
    s.upsertRequirement({ tenderId: T, tipo: 'afe', citacao: 'AFE' }); s.upsertRequirement({ tenderId: T, tipo: 'afe', citacao: 'AFE' });
    assert.equal(s._count('fits'), 1); assert.equal(s._count('requirements'), 1);
  });
  test('upsertDecision por item e produto; getDecisions filtra por pregão', () => {
    const s = openStore(':memory:');
    s.upsertDecision({ tenderId: T, item: 4, produto: 'P1', estado: 'disputar_com_pendencia', motivos: ['CND vence antes da sessão'], precoProposto: 7.5 });
    s.upsertDecision({ tenderId: T, item: 4, produto: 'P1', estado: 'disputar', motivos: ['ok'], precoProposto: 7.5 });
    s.upsertDecision({ tenderId: 'outro/2026/1', item: 1, produto: 'P2', estado: 'nao_disputar', motivos: ['x'], precoProposto: null });
    const d = s.getDecisions(T);
    assert.equal(d.length, 1); assert.equal(d[0].estado, 'disputar'); assert.deepEqual(d[0].motivos, ['ok']);
    assert.equal(s.getDecisions().length, 2);
  });
  test('upsertDossie incrementa a versão; getDossie devolve o último', () => {
    const s = openStore(':memory:');
    s.upsertDossie(T, { checklist: [1] }); s.upsertDossie(T, { checklist: [1, 2] });
    assert.deepEqual(s.getDossie(T), { checklist: [1, 2] });
    assert.equal(s._dossieVersion(T), 2);
    assert.equal(s.getDossie('inexistente'), undefined);
  });
});

describe('store: ações idempotentes', () => {
  test('recordIntent cria uma vez; a mesma key devolve a existente', () => {
    const s = openStore(':memory:');
    const a = s.recordIntent({ key: 'proposta:T:abc', tipo: 'proposta', tenderId: T, payload: { itens: [4] } });
    const b = s.recordIntent({ key: 'proposta:T:abc', tipo: 'proposta', tenderId: T, payload: { itens: [999] } });
    assert.equal(a.status, 'nova'); assert.equal(b.status, 'existente');
    assert.deepEqual(b.action.payload, { itens: [4] });
    assert.equal(b.action.status, 'intencao');
  });
  test('updateAction muda status e protocolo; key inexistente lança erro', () => {
    const s = openStore(':memory:');
    s.recordIntent({ key: 'k1', tipo: 'proposta', tenderId: T, payload: {} });
    const u = s.updateAction('k1', { status: 'confirmada', protocolo: 'SBX-1', verificado: true });
    assert.equal(u.status, 'confirmada'); assert.equal(u.protocolo, 'SBX-1'); assert.equal(u.verificado, true);
    assert.throws(() => s.updateAction('nao-existe', { status: 'falhou' }), /não existe/);
  });
  test('getActions filtra por status, pregão e data', () => {
    const c = clock('2026-11-07T10:00:00-03:00');
    const s = openStore(':memory:', { now: c.now });
    s.recordIntent({ key: 'a', tipo: 'proposta', tenderId: T, payload: {} });
    c.advance(3600e3);
    s.recordIntent({ key: 'b', tipo: 'esclarecimento', tenderId: 'outro/2026/1', item: 3, payload: {} });
    s.updateAction('b', { status: 'confirmada' });
    assert.deepEqual(s.getActions({ status: 'confirmada' }).map(a => a.key), ['b']);
    assert.deepEqual(s.getActions({ tenderId: T }).map(a => a.key), ['a']);
    assert.deepEqual(s.getActions({ desde: '2026-11-07T13:30:00.000Z' }).map(a => a.key), ['b']);
    assert.equal(s.getActions().length, 2);
  });
});

describe('store: linha do tempo', () => {
  test('logEvent gera id e horário; events em ordem cronológica', () => {
    const c = clock('2026-11-07T10:00:00-03:00');
    const s = openStore(':memory:', { now: c.now });
    const e1 = s.logEvent({ tipo: 'turno_inicio', resumo: 'turno das 10h' });
    c.advance(1000);
    s.logEvent({ tipo: 'decisao', resumo: 'item 4: disputar', tender: T, item: '4', rastro: [{ ferramenta: 'decide_item', ms: 12, custoUsd: 0.001 }] });
    c.advance(1000);
    s.logEvent({ tipo: 'turno_fim', resumo: 'fim' });
    assert.match(e1.id, /\S/); assert.equal(e1.horario, '2026-11-07T13:00:00.000Z');
    assert.deepEqual(s.events().map(e => e.tipo), ['turno_inicio', 'decisao', 'turno_fim']);
    assert.equal(s.events()[1].rastro?.[0].custoUsd, 0.001);
  });
  test('events com limite devolve os N mais recentes, ainda em ordem; desde filtra', () => {
    const c = clock('2026-11-07T10:00:00-03:00');
    const s = openStore(':memory:', { now: c.now });
    for (const t of ['turno_inicio', 'analise_item', 'decisao', 'turno_fim'] as const) { s.logEvent({ tipo: t, resumo: t }); c.advance(1000); }
    assert.deepEqual(s.events({ limite: 2 }).map(e => e.tipo), ['decisao', 'turno_fim']);
    assert.deepEqual(s.events({ desde: '2026-11-07T13:00:02.000Z' }).map(e => e.tipo), ['decisao', 'turno_fim']);
  });
});

describe('store: escaladas', () => {
  const esc = { tender: T, item: '4', motivo: 'valor acima do limite', recomendacao: 'aprovar envio', prazo: '2026-11-17T17:00:00-03:00' };
  test('openEscalation abre, registra evento e aparece em openEscalations', () => {
    const s = openStore(':memory:');
    const e = s.openEscalation(esc);
    assert.equal(e.status, 'aberta'); assert.match(e.id, /\S/);
    assert.deepEqual(s.openEscalations().map(x => x.id), [e.id]);
    assert.equal(s.events().at(-1)?.tipo, 'escalada_aberta');
  });
  test('resolveEscalation salva decisão e evento juntos; repetir → resolvida', () => {
    const s = openStore(':memory:', { now: () => new Date('2026-11-08T10:00:00-03:00') });
    const e = s.openEscalation(esc);
    const r = s.resolveEscalation(e.id, { decisao: 'ajustar', ajuste: 'preço R$ 7,90' });
    assert.equal(r.status, 'salva');
    if (r.status === 'salva') { assert.equal(r.registro.id, e.id); assert.equal(r.registro.ajuste, 'preço R$ 7,90'); assert.match(r.registro.horario, /^2026-11-08/); }
    assert.equal(s.openEscalations().length, 0);
    const ev = s.events().at(-1)!;
    assert.equal(ev.tipo, 'escalada_decidida'); assert.equal(ev.tender, T);
    assert.equal(s.resolveEscalation(e.id, { decisao: 'aprovar' }).status, 'resolvida');
  });
  test('id inexistente → ausente', () => {
    assert.equal(openStore(':memory:').resolveEscalation('nao-existe', { decisao: 'aprovar' }).status, 'ausente');
  });
  test('prazo vencido → expirada, sem gravar decisão', () => {
    const s = openStore(':memory:', { now: () => new Date('2026-11-18T09:00:00-03:00') });
    const e = s.openEscalation(esc);
    assert.equal(s.resolveEscalation(e.id, { decisao: 'aprovar' }).status, 'expirada');
    assert.equal(s.events().some(x => x.tipo === 'escalada_decidida'), false);
    assert.equal(s.openEscalations().length, 0);
  });
  test('falha no meio da transação não deixa decisão sem evento', () => {
    const s = openStore(':memory:', { now: () => new Date('2026-11-08T10:00:00-03:00'), _failAfterDecision: true });
    const e = s.openEscalation(esc);
    assert.throws(() => s.resolveEscalation(e.id, { decisao: 'aprovar' }), /falha simulada/);
    assert.deepEqual(s.openEscalations().map(x => x.id), [e.id]);
    assert.equal(s.events().some(x => x.tipo === 'escalada_decidida'), false);
  });
});
