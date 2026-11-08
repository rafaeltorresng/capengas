// Diff da errata sem modelo: citação gravada × texto novo, itens campo a campo, preço recalculado pelo código
// e a linha do art. 55, §1º quando a errata mexe em quantidade ou especificação e a abertura não anda.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diffErrata, type EntradaDiff } from '../src/lib/errata.ts';
import type { Politica } from '../src/lib/contracts.ts';

const politica: Politica = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8')).politica;
const T = '77816510000166/2026/348';
const DESC = 'Cabo Bisturi características adicionais: longo, material: aço inoxidável, tamanho: nº 4';
const EDITAL = 'Os licitantes deverão apresentar Autorização de Funcionamento de Empresa (AFE) expedida pela ANVISA, ' +
  'e certidões de regularidade fiscal e trabalhista vigentes na data da sessão.';

function entrada(o: { depois?: Partial<EntradaDiff['depois']>; antes?: Partial<EntradaDiff['antes']>; hoje?: string } = {}): EntradaDiff {
  return {
    tenderId: T, hoje: o.hoje ?? '2026-11-07', politica, custos: { P1: 6 },
    antes: {
      abertura: '2026-11-23T09:00',
      itens: [{ tenderId: T, numero: 4, descricao: DESC, catalogCode: null, quantidade: 100, estimativa: 12, sigiloso: false }],
      fits: [{ tenderId: T, item: 4, produto: 'P1', fit: 'atende', atributos: { attributes: [
        { atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável' },
        { atributo: 'tamanho', veredito: 'atende', citacao_item: 'tamanho: nº 4' }] } }],
      decisoes: [{ tenderId: T, item: 4, produto: 'P1', estado: 'disputar', motivos: ['ok'], precoProposto: 7.5 }],
      requisitos: [{ tenderId: T, tipo: 'afe', citacao: 'Autorização de Funcionamento de Empresa (AFE) expedida pela ANVISA' }],
      ...o.antes,
    },
    depois: {
      abertura: '2026-11-23T09:00',
      itens: [{ numero: 4, descricao: DESC, quantidade: 100, valorEstimado: 12, sigiloso: false }],
      textos: [{ nome: 'Edital', url: 'https://pncp.gov.br/edital.pdf', texto: EDITAL }],
      ...o.depois,
    },
  };
}

describe('caso da quantidade (#25): evidência reaproveitada, preço recalculado, abertura estável, art. 55 §1º', () => {
  const d = diffErrata(entrada({ depois: { itens: [{ numero: 4, descricao: DESC, quantidade: 150, valorEstimado: 12, sigiloso: false }] } }));
  const item = d.itens.find(i => i.item === 4)!;

  test('a quantidade aparece campo a campo', () => {
    assert.deepEqual(item.mudancas, [{ campo: 'quantidade', antes: 100, depois: 150 }]);
  });
  test('descrição intacta: evidência técnica reaproveitada, sem modelo', () => {
    assert.equal(item.evidencia, 'reaproveitada');
  });
  test('preço, total e limite recalculados pelo código', () => {
    assert.equal(item.preco?.estado, 'recalculada');
    assert.equal(item.preco?.depois, 7.5);        // custo 6 × 1,25, dentro da estimativa de 12
    assert.equal(item.preco?.total, 1125);         // 7,5 × 150
    assert.equal(d.proposta.total, 1125);
    assert.equal(d.proposta.excedeLimite, false);
  });
  test('abertura estável e exigência reaproveitada', () => {
    assert.equal(d.abertura.estado, 'estavel');
    assert.equal(d.exigencias[0].estado, 'reaproveitada');
  });
  test('quantidade mudou sem a abertura andar: linha do art. 55, §1º com o prazo do art. 164', () => {
    assert.equal(d.prazoNaoReaberto?.artigo, 'art. 55, §1º');
    assert.deepEqual(d.prazoNaoReaberto?.itens, [4]);
    assert.equal(d.prazoNaoReaberto?.prazo.data, '2026-11-17');
    assert.equal(d.prazoNaoReaberto?.prazo.artigo, 'art. 164');
    assert.equal(d.prazoNaoReaberto?.acionavel, true);
  });
  test('contagem por estado', () => {
    assert.equal(d.contagem.reaproveitada, 2);   // evidência do item + exigência
    assert.equal(d.contagem.recalculada, 1);
    assert.equal(d.contagem.citacao_orfa, 0);
  });
});

describe('limite da política dos dois lados', () => {
  test('quantidade nova que estoura o valorMaxAutomatico vira excedeLimite', () => {
    const d = diffErrata(entrada({ depois: { itens: [{ numero: 4, descricao: DESC, quantidade: 7000, valorEstimado: 12, sigiloso: false }] } }));
    assert.equal(d.proposta.total, 52500);
    assert.equal(d.proposta.excedeLimite, true);
  });
  test('orçamento que vira sigiloso: preço desconhecido, total e limite desconhecidos', () => {
    const d = diffErrata(entrada({ depois: { itens: [{ numero: 4, descricao: DESC, quantidade: 100, valorEstimado: null, sigiloso: true }] } }));
    assert.equal(d.itens[0].preco?.viavel, null);
    assert.equal(d.proposta.total, null);
    assert.equal(d.proposta.excedeLimite, null);
  });
});

describe('citação órfã: só esse item volta ao agente', () => {
  test('descrição mudou e a citação antiga ainda aparece ao lado da nova', () => {
    const nova = DESC.replace('tamanho: nº 4', 'tamanho: nº 4 ou tamanho: nº 3');
    const d = diffErrata(entrada({ depois: { itens: [{ numero: 4, descricao: nova, quantidade: 100, valorEstimado: 12, sigiloso: false }] } }));
    assert.equal(d.itens[0].evidencia, 'citacao_orfa');
    assert.match(d.itens[0].motivo ?? '', /ainda aparece/);
    assert.ok(d.prazoNaoReaberto, 'especificação mudou sem a abertura andar');
  });
  test('citação do encaixe sumiu do texto: nem reaproveitada nem órfã, o agente relê o item (revisão do #27)', () => {
    const nova = 'Cabo Bisturi longo em titânio, tamanho grande';
    const d = diffErrata(entrada({ depois: { itens: [{ numero: 4, descricao: nova, quantidade: 100, valorEstimado: 12, sigiloso: false }] } }));
    assert.equal(d.itens[0].evidencia, 'pendente_agente');
    assert.match(d.itens[0].motivo ?? '', /não está no texto novo/);
    assert.equal(d.contagem.citacao_orfa, 0);
    assert.equal(d.contagem.reaproveitada, 1);   // só a exigência
  });
  test('descrição igual mas citação que não está no texto: não reaproveita', () => {
    const d = diffErrata(entrada({ antes: { fits: [{ tenderId: T, item: 4, produto: 'P1', fit: 'atende', atributos: { attributes: [
      { atributo: 'cor', veredito: 'atende', citacao_item: 'cor: azul royal' }] } }] } }));
    assert.equal(d.itens[0].evidencia, 'pendente_agente');
  });
  test('encaixe sem citação gravada: não reaproveita', () => {
    const d = diffErrata(entrada({ antes: { fits: [{ tenderId: T, item: 4, produto: 'P1', fit: 'atende', atributos: { attributes: [] } }] } }));
    assert.equal(d.itens[0].evidencia, 'pendente_agente');
    assert.match(d.itens[0].motivo ?? '', /não há citação/);
  });
  test('diferença só de espaço e caixa não muda a descrição', () => {
    const d = diffErrata(entrada({ depois: { itens: [{ numero: 4, descricao: DESC.toUpperCase().replace(', ', ',  '), quantidade: 100, valorEstimado: 12, sigiloso: false }] } }));
    assert.equal(d.itens[0].evidencia, 'reaproveitada');
  });
  test('exigência cuja citação não está no texto novo fica órfã; texto ilegível fica ilegível', () => {
    const sem = diffErrata(entrada({ depois: { textos: [{ nome: 'Edital', url: 'u', texto: 'outro texto qualquer do edital' }] } }));
    assert.equal(sem.exigencias[0].estado, 'citacao_orfa');
    const ileg = diffErrata(entrada({ depois: { textos: null } }));
    assert.equal(ileg.exigencias[0].estado, 'ilegivel');
    assert.equal(ileg.contagem.ilegivel, 1);
  });
});

describe('abertura, itens novos e removidos', () => {
  test('hora mudou no mesmo dia: abertura estável, art. 55 continua, hora informativa (revisão do #27)', () => {
    const d = diffErrata(entrada({ depois: { abertura: '2026-11-23T14:00', itens: [{ numero: 4, descricao: DESC, quantidade: 150, valorEstimado: 12, sigiloso: false }] } }));
    assert.equal(d.abertura.estado, 'estavel');
    assert.equal(d.abertura.horaMudou, true);
    assert.equal(d.prazoNaoReaberto?.prazo.data, '2026-11-17');
  });
  test('abertura ausente dos dois lados: desconhecida, sem art. 55 e sem data (revisão do #27)', () => {
    const d = diffErrata(entrada({ antes: { abertura: null }, depois: { abertura: null, itens: [{ numero: 4, descricao: DESC, quantidade: 150, valorEstimado: 12, sigiloso: false }] } }));
    assert.equal(d.abertura.estado, 'desconhecida');
    assert.equal(d.prazoNaoReaberto, null);
    assert.deepEqual(d.semAberturaConhecida, [4]);
  });
  test('abertura que andou: sem linha do art. 55, §1º', () => {
    const d = diffErrata(entrada({ depois: { abertura: '2026-12-07T09:00', itens: [{ numero: 4, descricao: DESC, quantidade: 150, valorEstimado: 12, sigiloso: false }] } }));
    assert.equal(d.abertura.estado, 'mudou');
    assert.equal(d.prazoNaoReaberto, null);
  });
  test('item removido: decisão anterior não vale e não entra no total', () => {
    const d = diffErrata(entrada({ depois: { itens: [] } }));
    const it = d.itens.find(i => i.item === 4)!;
    assert.equal(it.removido, true);
    assert.equal(it.evidencia, null);
    assert.equal(d.proposta.total, null);
    assert.ok(d.prazoNaoReaberto);
  });
  test('item novo aparece, sem evidência', () => {
    const d = diffErrata(entrada({ depois: { itens: [
      { numero: 4, descricao: DESC, quantidade: 100, valorEstimado: 12, sigiloso: false },
      { numero: 5, descricao: 'Lâmina de bisturi nº 24', quantidade: 50, valorEstimado: 1, sigiloso: false }] } }));
    const novo = d.itens.find(i => i.item === 5)!;
    assert.equal(novo.novo, true);
    assert.equal(novo.evidencia, null);
  });
  test('nada mudou nos itens nem na abertura: sem linha do art. 55, tudo reaproveitado', () => {
    const d = diffErrata(entrada());
    assert.equal(d.prazoNaoReaberto, null);
    assert.equal(d.itens[0].preco?.estado, 'reaproveitada');
    assert.deepEqual(d.itens[0].mudancas, []);
  });
  test('prazo do art. 164 já passou: a linha fica, só informativa', () => {
    const d = diffErrata(entrada({ hoje: '2026-11-19', depois: { itens: [{ numero: 4, descricao: DESC, quantidade: 150, valorEstimado: 12, sigiloso: false }] } }));
    assert.equal(d.prazoNaoReaberto?.acionavel, false);
  });
  test('o diff declara quando a errata é sintética', () => {
    assert.equal(diffErrata({ ...entrada(), sintetico: true }).sintetico, true);
    assert.equal(diffErrata(entrada()).sintetico, false);
  });
});

test('quantidade com custo ausente fica desconhecida, nunca vira custo zero', () => {
  const e = entrada({ depois: { itens: [{ numero: 4, descricao: DESC, quantidade: 150, valorEstimado: 12, sigiloso: false }] } });
  const d = diffErrata({ ...e, custos: {} });
  assert.equal(d.itens[0].preco?.depois, null);
  assert.equal(d.itens[0].preco?.viavel, null);
  assert.equal(d.proposta.total, null);
});

test('encaixe com um atributo sem citação não reaproveita os demais como se estivesse completo', () => {
  const e = entrada();
  (e.antes.fits[0].atributos as any).attributes.push({ atributo: 'embalagem', veredito: 'atende' });
  assert.equal(diffErrata(e).itens[0].evidencia, 'pendente_agente');
});

test('descrição ilegível não chama modelo nem entra em reaproveitamento', () => {
  const d = diffErrata(entrada({ depois: { itens: [{ numero: 4, descricao: '', quantidade: 150, valorEstimado: 12, sigiloso: false }] } }));
  assert.equal(d.itens[0].evidencia, 'ilegivel');
});
