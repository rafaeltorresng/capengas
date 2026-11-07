import { test } from 'node:test';
import assert from 'node:assert/strict';
import { versaoDaRetificacao, type ItemAntes } from '../src/lib/versao.ts';

const TID = '77816510000166/2026/348';
const descricao = 'Cabo de bisturi tamanho: cerca de 13 cm, material: aço inoxidável.';
const antes = (q: number): ItemAntes => ({
  numero: 40, descricao, quantidade: q, estimativa: 200, custo: 100,
  atributos: [{ atributo: 'tamanho', citacao_item: 'tamanho: cerca de 13 cm' }],
});
const politica = { valorMaxAutomatico: 50_000, margemMinima: 0.15, margemAlvo: 0.2 };
const base = { tenderId: TID, versao: 2, aberturaAntes: '2026-11-23T09:00', aberturaDepois: '2026-11-23T09:00', agora: new Date('2026-11-07T12:00:00-03:00'), politica, custoPorChamadaUsd: 0.01 };

test('quantidade nova reaproveita a evidência, recalcula pelo código e não chama o modelo', () => {
  const v = versaoDaRetificacao({ ...base, sintetica: true, antes: [antes(10)], depois: [{ numero: 40, descricao, quantidade: 40, estimativa: 200 }] });
  assert.equal(v.sintetica, true);
  assert.match(v.aviso ?? '', /não é uma retificação publicada/);
  assert.equal(v.abertura, 'estavel');
  assert.equal(v.linhas.find(l => l.estado === 'reaproveitada')?.chamarAgente, false);
  const recalculo = v.linhas.find(l => l.estado === 'recalculada');
  assert.equal(recalculo?.precoUnitario, 120);
  assert.equal(recalculo?.valorTotal, 4800);
  assert.equal(recalculo?.escalarLimite, false);
  assert.equal(v.contagem.reavaliada, 0);
  assert.equal(v.chamadasEvitadas, 1);
  assert.equal(v.custoEvitadoUsd, 0.01);
  const juridica = v.pauta.find(p => p.artigo === 'art. 55, §1º');
  assert.equal(juridica?.ofereceAcao, true);
  assert.equal(juridica?.quem, 'juridico');
  assert.equal(juridica?.ateQuando, '2026-11-17');
  assert.equal(juridica?.origem, 'calculado');
});

test('quantidade que estoura o limite escala, ainda sem modelo', () => {
  const v = versaoDaRetificacao({ ...base, antes: [antes(10)], depois: [{ numero: 40, descricao, quantidade: 500, estimativa: 200 }] });
  const recalculo = v.linhas.find(l => l.estado === 'recalculada');
  assert.equal(recalculo?.escalarLimite, true);
  assert.equal(recalculo?.valorTotal, 60_000);
  assert.equal(v.pauta.some(p => p.quem === 'analista' && p.ofereceAcao), true);
  assert.equal(v.linhas.some(l => l.chamarAgente), false);
});

test('prazo do art. 164 vencido deixa a linha do art. 55 informativa', () => {
  const v = versaoDaRetificacao({ ...base, agora: new Date('2026-11-20T12:00:00-03:00'), antes: [antes(10)], depois: [{ numero: 40, descricao, quantidade: 40, estimativa: 200 }] });
  const juridica = v.pauta.find(p => p.artigo === 'art. 55, §1º');
  assert.equal(juridica?.ofereceAcao, false);
  assert.equal(juridica?.quem, null);
  assert.match(juridica?.oQueFazer ?? '', /informativa/);
});

test('descrição nova com a citação antiga ainda no texto é órfã e volta ao agente', () => {
  const v = versaoDaRetificacao({ ...base, antes: [antes(10)], depois: [{ numero: 40, descricao: descricao + ' tamanho: cerca de 15 cm.', quantidade: 10, estimativa: 200 }] });
  assert.equal(v.linhas.find(l => l.item === 40)?.estado, 'citacao_orfa');
  assert.equal(v.linhas.find(l => l.item === 40)?.chamarAgente, true);
  assert.equal(v.contagem.reaproveitada, 0);
  assert.equal(v.chamadasEvitadas, 0);
  assert.equal(v.custoEvitadoUsd, 0);
});

test('citação que sumiu não é reaproveitada', () => {
  const v = versaoDaRetificacao({ ...base, antes: [antes(10)], depois: [{ numero: 40, descricao: 'Cabo de bisturi sem a medida exigida no texto anterior.', quantidade: 10, estimativa: 200 }] });
  assert.equal(v.linhas[0].estado, 'pendente_agente');
  assert.equal(v.linhas[0].chamarAgente, true);
  assert.equal(v.contagem.reaproveitada, 0);
});

test('texto ilegível não entra na conta de economia nem de retrabalho do modelo', () => {
  const v = versaoDaRetificacao({ ...base, antes: [antes(10)], depois: [{ numero: 40, descricao: '', quantidade: 10, estimativa: 200, ilegivel: true }] });
  assert.equal(v.contagem.ilegivel, 1);
  assert.equal(v.chamadasEvitadas, 0);
  assert.equal(v.linhas[0].chamarAgente, false);
});

test('ajuste humano da versão anterior reaparece na seguinte', () => {
  const v = versaoDaRetificacao({ ...base, versao: 3, antes: [antes(10)], depois: [{ numero: 40, descricao, quantidade: 40, estimativa: 200 }],
    ajustes: [{ item: 40, versao: 2, decisao: 'recusar', motivo: 'a medida de 13 cm não cobre o pedido' }] });
  assert.match(v.linhas[0].discordancia ?? '', /versão 2: humano recusar/);
  assert.equal(v.pauta.some(p => p.origem === 'informado_cliente' && p.item === 40), true);
});
