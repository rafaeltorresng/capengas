// Recheque contra o PNCP real: foto do pregão e recheque fresco logo em seguida.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../../src/lib/store.ts';
import { snapshotTender, recheckTender } from '../../src/lib/recheck.ts';

test('foto + recheque de um pregão real aberto (Compras.gov.br)', { timeout: 180_000 }, async () => {
  const store = openStore(':memory:');
  const T = '77816510000166/2026/348';
  const row = await snapshotTender(T, store);
  assert.match(row.arquivosHash ?? '', /^[0-9a-f]{16}$/);
  const r = await recheckTender(T, store);
  // Com o PNCP instável, "fonte_indisponivel" é a resposta segura; qualquer outro bloqueio seria um achado real.
  assert.ok(r.status === 'ok' || (r.status === 'bloquear' && ['fonte_indisponivel', 'prazo_encerrado', 'suspenso'].includes(r.motivo)), JSON.stringify(r));
});
