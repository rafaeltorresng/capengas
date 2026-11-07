import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relatorioProva } from '../src/lib/cenarios.ts';
import { buildProof } from '../src/server/proof.ts';
import type { Event } from '../src/server/contract.ts';

const report = await relatorioProva();

const event = (id: string, tipo: string, horario: string, rastro?: Event['rastro']): Event =>
  ({ id, tipo, horario: '2026-11-07T' + horario + '-03:00', resumo: tipo, rastro });

test('separa avaliações históricas das métricas do último turno encerrado', () => {
  const proof = buildProof(report, [
    event('1', 'turno_inicio', '15:00:00'),
    event('2', 'analise_item', '15:00:20', [{ ferramenta: 'llm:teste', custoUsd: 0.02 }]),
    event('3', 'turno_fim', '15:02:00', [{ ferramenta: 'turno', ms: 119_000 }]),
    event('4', 'turno_inicio', '16:00:00'),
    event('5', 'analise_item', '16:00:20', [{ ferramenta: 'llm:teste', custoUsd: 0.05 }]),
  ]);
  assert.equal(proof.avaliacoes[0].valor, '18/18');
  assert.equal(proof.custoUsd, 0.02);
  assert.equal(proof.duracaoMs, 119_000);
  assert.equal(proof.concordancia, null);
  assert.equal(proof.cenarios.length, 10);
});

test('mantém custo ausente quando uma chamada não tem valor medido', () => {
  const proof = buildProof(report, [
    event('1', 'turno_inicio', '15:00:00'),
    event('2', 'analise_item', '15:00:20', [{ ferramenta: 'llm:teste' }]),
    event('3', 'turno_fim', '15:01:00'),
  ]);
  assert.equal(proof.custoUsd, null);
  assert.equal(proof.duracaoMs, 60_000);
  assert.equal(buildProof(report, []).duracaoMs, null);
});
