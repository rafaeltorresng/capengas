import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicacaoRelativa, dataFonte } from '../src/lib/feed-datas.ts';
test('publicação relativa usa dias de Recife, sem tratar consulta ou abertura como publicação', () => {
  const now = new Date('2026-11-08T01:00:00Z');
  assert.equal(publicacaoRelativa('2026-11-07T04:00:00', now), 'Publicado hoje');
  assert.equal(publicacaoRelativa('2026-11-06T04:00:00', now), 'Publicado ontem');
  assert.equal(publicacaoRelativa('2026-11-04T04:00:00', now), 'Publicado há 3 dias');
  assert.equal(publicacaoRelativa(null, now), 'Publicação não informada');
  assert.equal(publicacaoRelativa('inválida', now), 'Publicação não informada');
  assert.match(publicacaoRelativa('2026-11-09T04:00:00', now), /^Publicação em/);
  assert.equal(publicacaoRelativa('2026-11-07', now), 'Publicado hoje');
  assert.equal(dataFonte('2026-11-07'), '07/11/2026');
  assert.match(dataFonte('2026-11-07T04:00:00'), /04:00/);
});
