// Monitor dos pregões acompanhados: detecta mudança, marca para reavaliar, sem mexer na foto da análise.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/lib/store.ts';
import { snapshotTender, recheckTender, filesHash } from '../src/lib/recheck.ts';
import { runMonitor } from '../src/lib/monitor.ts';

const A = '80257355000108/2026/493', B = '77816510000166/2026/348';
const NOW = new Date('2026-11-07T16:00:00-03:00');
const files = [{ seq: 1, titulo: 'EDITAL.pdf', tipo: 'Edital', url: 'u1' }];
const errata = [...files, { seq: 2, titulo: 'ERRATA 01.pdf', tipo: 'Outros Documentos', url: 'u2' }];
type World = Record<string, { situacao: string; files: typeof files; fim?: string; falha?: boolean }>;
const deps = (w: World) => ({
  now: () => NOW,
  fetchCompra: async (cnpj: string, ano: number, seq: number) => {
    const x = w[`${cnpj}/${ano}/${seq}`]; if (x.falha) throw new Error('ECONNRESET');
    return { situacaoCompraNome: x.situacao, dataEncerramentoProposta: x.fim ?? '2026-11-23T09:00:00' };
  },
  fetchFiles: async (cnpj: string, ano: number, seq: number) => w[`${cnpj}/${ano}/${seq}`].files,
});
async function setup(w: World) {
  const store = openStore(':memory:', { now: () => NOW });
  for (const id of Object.keys(w)) await snapshotTender(id, store, { ...deps(w), base: { abertura: '2026-11-23' } });
  return store;
}

describe('store: lista de pregões e reavaliação', () => {
  test('getTenders lista e filtra os marcados para reavaliar; snapshot limpa a marca', async () => {
    const w: World = { [A]: { situacao: 'Divulgada no PNCP', files }, [B]: { situacao: 'Divulgada no PNCP', files } };
    const s = await setup(w);
    assert.equal(s.getTenders().length, 2);
    s.setReavaliar(A, true);
    assert.deepEqual(s.getTenders({ reavaliar: true }).map(t => t.id), [A]);
    await snapshotTender(A, s, deps(w));
    assert.equal(s.getTenders({ reavaliar: true }).length, 0);
  });
  test('banco antigo sem a coluna reavaliar é migrado ao abrir', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'lance-')), 'antigo.db');
    const old = new DatabaseSync(file);
    old.exec(`CREATE TABLE tenders (id TEXT PRIMARY KEY, orgao TEXT, uf TEXT, abertura TEXT, situacao TEXT, plataforma TEXT, arquivos_hash TEXT, ultimo_check TEXT, atualizado_em TEXT NOT NULL);
      INSERT INTO tenders VALUES ('${A}', 'UEPG', 'PR', '2026-11-23', 'Divulgada no PNCP', 'Compras.gov.br', 'h', NULL, '2026-11-07');`);
    old.close();
    const s = openStore(file);
    assert.equal(s.getTenders()[0].reavaliar, false);
    s.close();
  });
});

describe('runMonitor', () => {
  test('nada mudou → nenhum evento de mudança', async () => {
    const w: World = { [A]: { situacao: 'Divulgada no PNCP', files } };
    const s = await setup(w);
    const r = await runMonitor(s, deps(w));
    assert.deepEqual({ v: r.verificados, m: r.mudancas }, { v: 1, m: 0 });
    assert.equal(s.events().filter(e => e.tipo === 'monitor_mudanca').length, 0);
  });
  test('pregão suspenso → evento de mudança + marcado para reavaliar', async () => {
    const w: World = { [A]: { situacao: 'Divulgada no PNCP', files } };
    const s = await setup(w);
    w[A].situacao = 'Suspensa';
    const r = await runMonitor(s, deps(w));
    assert.equal(r.mudancas, 1);
    const ev = s.events().find(e => e.tipo === 'monitor_mudanca')!;
    assert.equal(ev.tender, A); assert.match(ev.resumo, /Suspensa/);
    assert.equal(s.getTender(A)?.reavaliar, true);
  });
  test('errata nova → evento + reavaliar, e a foto da análise NÃO muda (recheque continua bloqueando)', async () => {
    const w: World = { [A]: { situacao: 'Divulgada no PNCP', files } };
    const s = await setup(w);
    w[A].files = errata;
    await runMonitor(s, deps(w));
    assert.equal(s.getTender(A)?.arquivosHash, filesHash(files));
    assert.equal(s.getTender(A)?.reavaliar, true);
    const rc = await recheckTender(A, s, deps(w));
    assert.equal(rc.status === 'bloquear' && rc.motivo, 'arquivos_mudaram');
  });
  test('segunda rodada sem nova mudança → não duplica o evento', async () => {
    const w: World = { [A]: { situacao: 'Divulgada no PNCP', files } };
    const s = await setup(w);
    w[A].files = errata;
    await runMonitor(s, deps(w)); await runMonitor(s, deps(w));
    assert.equal(s.events().filter(e => e.tipo === 'monitor_mudanca').length, 1);
  });
  test('PNCP fora do ar → um único evento erro_fonte por rodada, sem marcar reavaliação', async () => {
    const w: World = { [A]: { situacao: 'Divulgada no PNCP', files }, [B]: { situacao: 'Divulgada no PNCP', files } };
    const s = await setup(w);
    w[A].falha = true; w[B].falha = true;
    const r = await runMonitor(s, deps(w));
    assert.equal(r.falhas, 2);
    assert.equal(s.events().filter(e => e.tipo === 'erro_fonte').length, 1);
    assert.equal(s.getTenders({ reavaliar: true }).length, 0);
  });
  test('pregões encerrados ou revogados saem do acompanhamento', async () => {
    const w: World = { [A]: { situacao: 'Divulgada no PNCP', files }, [B]: { situacao: 'Divulgada no PNCP', files } };
    const s = await setup(w);
    s.upsertTender({ ...s.getTender(A)!, abertura: '2026-11-01' });     // sessão já passou
    s.upsertTender({ ...s.getTender(B)!, situacao: 'Revogada' });
    const r = await runMonitor(s, deps(w));
    assert.equal(r.verificados, 0); assert.equal(r.ignorados, 2);
  });
});
