import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { diffErrata } from '../src/lib/errata.ts';
import { openStore } from '../src/lib/store.ts';
test('snapshot preserva auditoria e recusa sobrescrever um banco existente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lance-snapshot-'));
  const source = join(dir, 'source.db'), target = join(dir, 'target.db'), json = join(dir, 'snapshot.json');
  const run = (mode: string, db: string) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('../scripts/banco-demo.ts', import.meta.url)), mode, db, json], { encoding: 'utf8' });
  try {
    const original = openStore(source, { now: () => new Date('2026-11-07T12:00:00-03:00') });
    const event = original.logEvent({ tipo: 'turno_inicio', resumo: 'Teste de snapshot' });
    original.saveErrataDiff(diffErrata({ tenderId: '77816510000166/2026/348', hoje: '2026-11-07', sintetico: true,
      politica: { margemMinima: 0.15, margemAlvo: 0.2, valorMaxAutomatico: 50000 } as any, custos: {},
      antes: { abertura: null, itens: [], fits: [], decisoes: [], requisitos: [] }, depois: { abertura: null, itens: [], textos: null } }));
    const versions = original.getRetificacoes('77816510000166/2026/348'); original.close();
    assert.equal(run('exportar', source).status, 0);
    const imported = run('importar', target); assert.equal(imported.status, 0, imported.stderr);
    assert.notEqual(run('importar', target).status, 0);
    const restored = openStore(target);
    assert.deepEqual(restored.events(), [event]);
    assert.deepEqual(restored.getRetificacoes('77816510000166/2026/348'), versions); restored.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
