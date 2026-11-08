import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { versaoDaRetificacao, type AjusteHumano } from '../src/lib/versao.ts';
import { diffErrata, type EntradaDiff } from '../src/lib/errata.ts';

const T = '77816510000166/2026/348';
const descricao = 'Cabo de bisturi tamanho: cerca de 13 cm, material: aço inoxidável.';
const politica = { ...JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8')).politica,
  margemMinima: 0.15, margemAlvo: 0.2, valorMaxAutomatico: 50_000 };
function entrada(): EntradaDiff {
  return { tenderId: T, hoje: '2026-11-07', politica, custos: { P1: 100 },
    antes: { abertura: '2026-11-23T09:00', requisitos: [],
      itens: [{ tenderId: T, numero: 40, descricao, quantidade: 10, estimativa: 200, sigiloso: false, catalogCode: null }],
      fits: [{ tenderId: T, item: 40, produto: 'P1', fit: 'atende', atributos: { attributes: [{ citacao_item: 'tamanho: cerca de 13 cm' }] } }],
      decisoes: [{ tenderId: T, item: 40, produto: 'P1', estado: 'disputar', motivos: ['Sintético'], precoProposto: 120 }] },
    depois: { abertura: '2026-11-23T09:00', textos: null,
      itens: [{ numero: 40, descricao, quantidade: 40, valorEstimado: 200, sigiloso: false }] } };
}
function versao(e = entrada(), o: { hoje?: string; versao?: number; ajustes?: AjusteHumano[] } = {}) {
  return versaoDaRetificacao({ diff: diffErrata(e), versao: o.versao ?? 2, hoje: o.hoje ?? e.hoje, ajustes: o.ajustes });
}
const art55 = (v: ReturnType<typeof versao>) => v.pauta.find(l => l.id.endsWith(':art55'));

test('quantidade reaproveita a evidência, recalcula pelo código e não chama modelo', () => {
  const e = entrada(); e.sintetico = true;
  const v = versao(e);
  assert.equal(v.sintetica, true); assert.match(v.aviso ?? '', /não é uma retificação publicada/);
  assert.equal(v.abertura, 'estavel'); assert.equal(v.linhas[0].estado, 'reaproveitada');
  assert.ok(v.linhas.every(l => !l.chamarAgente));
  const pc = v.linhas.find(l => l.estado === 'recalculada')!;
  assert.equal(pc.precoUnitario, 120); assert.equal(pc.valorTotal, 4800); assert.equal(pc.escalarLimite, false);
  assert.equal(v.itensSemReleitura, 1); assert.equal(v.custoEvitadoUsd, null);
  assert.equal(art55(v)?.ate, '2026-11-17'); assert.equal(art55(v)?.papel, 'juridico'); assert.equal(art55(v)?.acionavel, true);
});

test('limite agregado escala mesmo quando cada item isolado cabe no limite', () => {
  const e = entrada(); e.depois.itens[0].quantidade = 250;
  e.antes.itens.push({ ...e.antes.itens[0], numero: 41 });
  e.antes.fits.push({ ...e.antes.fits[0], item: 41 });
  e.antes.decisoes.push({ ...e.antes.decisoes[0], item: 41 });
  e.depois.itens.push({ ...e.depois.itens[0], numero: 41 });
  const v = versao(e);
  assert.ok(v.linhas.filter(l => l.estado === 'recalculada').every(l => l.valorTotal === 30000 && l.escalarLimite));
  assert.equal(v.pauta.find(l => l.id.endsWith(':limite'))?.ate, '2026-11-23');
});

test('prazo jurídico é conferido na data corrente, não na data do diff', () => {
  const v = versao(entrada(), { hoje: '2026-11-19' });
  assert.equal(art55(v)?.acionavel, false); assert.match(art55(v)?.acao ?? '', /informativo/);
});

test('descrição nova com citação antiga ainda presente é órfã', () => {
  const e = entrada(); e.depois.itens[0].descricao += ' Outro modelo.';
  const v = versao(e);
  assert.equal(v.linhas[0].estado, 'citacao_orfa'); assert.equal(v.linhas[0].chamarAgente, true); assert.equal(v.itensSemReleitura, 0);
});

test('citação que sumiu é pendente_agente', () => {
  const e = entrada(); e.depois.itens[0].descricao = 'Cabo de bisturi sem medida no texto novo.';
  const v = versao(e);
  assert.equal(v.linhas[0].estado, 'pendente_agente'); assert.equal(v.linhas[0].chamarAgente, true);
});

test('citação curta válida no record_fit continua reaproveitada', () => {
  const e = entrada(); (e.antes.fits[0].atributos as any).attributes = [{ citacao_item: '13 cm, material' }];
  assert.equal(versao(e).linhas[0].estado, 'reaproveitada');
});

test('encaixe sem citação fica pendente', () => {
  const e = entrada(); e.antes.fits[0].atributos = { attributes: [] };
  assert.equal(versao(e).linhas[0].estado, 'pendente_agente');
});

test('ilegível não conta como economia, não chama modelo e recálculo não libera decisão', () => {
  const e = entrada(); e.depois.itens[0].descricao = '';
  const v = versao(e);
  assert.equal(v.linhas[0].estado, 'ilegivel'); assert.equal(v.linhas[0].chamarAgente, false);
  assert.equal(v.itensSemReleitura, 0); assert.equal(v.linhas[1].escalarLimite, true);
  assert.match(v.linhas[1].motivo, /não libera decisão/);
});

test('ajuste humano anterior reaparece; o da versão atual não reaparece nela', () => {
  const v = versao(entrada(), { versao: 3, ajustes: [
    { item: 40, versao: 2, decisao: 'recusar', motivo: 'Medida insuficiente' },
    { item: 40, versao: 3, decisao: 'aprovar', motivo: 'Desta versão' }] });
  assert.match(v.linhas[0].discordancia ?? '', /versão 2: humano recusar/);
  assert.doesNotMatch(v.linhas[0].discordancia ?? '', /Desta versão/);
  assert.equal(v.pauta.filter(l => l.origem === 'informado_cliente').length, 1);
});

test('item removido não chama modelo nem reaproveita evidência', () => {
  const e = entrada(); e.depois.itens = [];
  const v = versao(e); assert.deepEqual(v.linhas, []); assert.equal(v.itensSemReleitura, 0);
  assert.ok(v.pauta.some(l => /removido/.test(l.oQueMudou))); assert.ok(art55(v));
});

test('item novo chama agente; sem descrição legível fica aguardando humano', () => {
  const e = entrada(); e.antes.itens = []; e.antes.fits = []; e.antes.decisoes = [];
  const v = versao(e); assert.equal(v.linhas[0].estado, 'pendente_agente'); assert.equal(v.linhas[0].chamarAgente, true);
  assert.ok(art55(v));
});

test('sintético não afirma mudança de quantidade quando ela não ocorreu', () => {
  const e = entrada(); e.sintetico = true; e.depois.itens[0].quantidade = 10;
  assert.doesNotMatch(versao(e).aviso ?? '', /quantidade alterada/);
});

test('abertura em outro dia não cria art. 55', () => {
  const e = entrada(); e.depois.abertura = '2026-11-30T09:00';
  const v = versao(e); assert.equal(v.abertura, 'mudou'); assert.equal(art55(v), undefined);
  assert.ok(v.pauta.some(l => l.origem === 'publicado' && !l.acionavel));
});

test('hora no mesmo dia mantém art. 55 e aparece como fato informativo', () => {
  const e = entrada(); e.depois.abertura = '2026-11-23T15:00';
  const v = versao(e); assert.equal(v.abertura, 'estavel'); assert.equal(art55(v)?.ate, '2026-11-17');
  assert.ok(v.pauta.some(l => l.id.endsWith(':hora') && !l.acionavel && l.ate === null));
});

test('abertura ausente: sem prazo e sem ação', () => {
  const e = entrada(); e.antes.abertura = null; e.depois.abertura = null; e.depois.itens[0].quantidade = 500;
  const v = versao(e); assert.equal(v.abertura, 'desconhecida'); assert.equal(art55(v), undefined);
  assert.ok(v.pauta.every(l => !l.acionavel && l.ate === null));
});

test('item novo ilegível não chama modelo nem entra na conta de reaproveitamento', () => {
  const e = entrada(); e.antes.itens = []; e.antes.fits = []; e.antes.decisoes = []; e.depois.itens[0].descricao = '';
  const v = versao(e); assert.equal(v.linhas[0].estado, 'ilegivel'); assert.equal(v.linhas[0].chamarAgente, false);
  assert.equal(v.itensSemReleitura, 0);
});
