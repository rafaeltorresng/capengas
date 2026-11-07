// Pauta da manhã: prazos legais + diferenças da errata + cofre + sanção/semáforo, cada linha com o que mudou,
// o que fazer, quem age, até quando, de onde vem (origem) e a fonte.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { montarPauta, type PregaoPauta } from '../src/lib/pauta.ts';
import { diffErrata } from '../src/lib/errata.ts';
import type { Politica, TenderRow } from '../src/lib/contracts.ts';

const politica: Politica = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8')).politica;
const T = '77816510000166/2026/348';
const DESC = 'Cabo Bisturi características adicionais: longo, material: aço inoxidável, tamanho: nº 4';
const tender: TenderRow = { id: T, orgao: 'Município de Francisco Beltrão', uf: 'PR', abertura: '2026-11-23T09:00', situacao: 'Divulgada no PNCP',
  plataforma: 'Compras.gov.br', arquivosHash: 'h', ultimoCheck: null };
const decisao = { tenderId: T, item: 4, produto: 'P1', estado: 'disputar' as const, motivos: ['ok'], precoProposto: 7.5 };
const hoje = '2026-11-07';

function diffQuantidade(quantidade = 150) {
  return diffErrata({ tenderId: T, hoje, politica, custos: { P1: 6 }, sintetico: true,
    antes: { abertura: tender.abertura, itens: [{ tenderId: T, numero: 4, descricao: DESC, catalogCode: null, quantidade: 100, estimativa: 12, sigiloso: false }],
      fits: [{ tenderId: T, item: 4, produto: 'P1', fit: 'atende', atributos: { attributes: [{ atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável' }] } }],
      decisoes: [decisao], requisitos: [] },
    depois: { abertura: tender.abertura, itens: [{ numero: 4, descricao: DESC, quantidade, valorEstimado: 12, sigiloso: false }], textos: [] } });
}
const pregao = (o: Partial<PregaoPauta> = {}): PregaoPauta => ({ tender, decisoes: [decisao], requisitos: [], ...o });

describe('caso da quantidade na pauta', () => {
  const pauta = montarPauta({ hoje, pregoes: [pregao({ diff: diffQuantidade() })], sancoes: [] });
  const art55 = pauta.linhas.find(l => l.tipo === 'errata' && l.prazo?.artigo === 'art. 164')!;

  test('uma linha jurídica: esclarecer ou impugnar até a data do art. 164, com a fonte', () => {
    assert.equal(art55.papel, 'juridico');
    assert.equal(art55.ate, '2026-11-17');
    assert.equal(art55.acionavel, true);
    assert.equal(art55.origem, 'calculado');
    assert.match(art55.oQueMudou, /art\. 55, §1º/);
    assert.match(art55.oQueMudou, /quantidade/);
    assert.equal(art55.fonte?.url, `https://pncp.gov.br/app/editais/${T}`);
    assert.equal(art55.sintetico, true);
  });
  test('preço recalculado é informativo, sem tarefa, e a evidência reaproveitada aparece no resumo', () => {
    const rec = pauta.linhas.find(l => l.estado === 'recalculada')!;
    assert.equal(rec.acionavel, false);
    assert.match(rec.oQueMudou, /100 → 150/);
    assert.match(rec.oQueMudou, /1\.125,00/);
    const resumo = pauta.linhas.find(l => l.tipo === 'errata' && /sem modelo/.test(l.oQueMudou))!;
    assert.match(resumo.oQueMudou, /1 reaproveitada/);
    assert.equal(resumo.acionavel, false);
  });
  test('a abertura estável não vira tarefa', () => {
    assert.equal(pauta.linhas.some(l => /abertura/i.test(l.acao)), false);
  });
  test('o lembrete de feriado local é outra linha, com dono, e não muda a data', () => {
    const cal = pauta.linhas.find(l => l.tipo === 'calendario')!;
    assert.equal(cal.papel, 'analista');
    assert.equal(cal.ate, '2026-11-17');
    assert.match(cal.acao, /feriado/);
    assert.equal(art55.prazo?.calendario, 'local_nao_conferido');
  });
  test('total acima do limite pede aprovação humana', () => {
    const p = montarPauta({ hoje, pregoes: [pregao({ diff: diffQuantidade(7000) })], sancoes: [] });
    const lim = p.linhas.find(l => /limite automático/.test(l.acao))!;
    assert.equal(lim.papel, 'analista');
    assert.equal(lim.acionavel, true);
  });
  test('prazo do art. 164 passado: linha informativa, sem ação', () => {
    const p = montarPauta({ hoje: '2026-11-19', pregoes: [pregao({ diff: diffErrata({ ...entradaPassada() }) })], sancoes: [] });
    const l = p.linhas.find(x => x.prazo?.artigo === 'art. 164' && x.tipo === 'errata')!;
    assert.equal(l.acionavel, false);
    assert.match(l.acao, /encerrado/);
  });
});

function entradaPassada() {
  const d = diffQuantidade();
  return { tenderId: T, hoje: '2026-11-19', politica, custos: { P1: 6 },
    antes: { abertura: tender.abertura, itens: [{ tenderId: T, numero: 4, descricao: DESC, catalogCode: null, quantidade: 100, estimativa: 12, sigiloso: false }], fits: [], decisoes: [decisao], requisitos: [] },
    depois: { abertura: tender.abertura, itens: [{ numero: 4, descricao: DESC, quantidade: d.itens[0].preco!.quantidade, valorEstimado: 12, sigiloso: false }], textos: [] } };
}

describe('outras linhas', () => {
  test('citação órfã: o Lance reavalia só aquele item', () => {
    const d = diffErrata({ tenderId: T, hoje, politica, custos: { P1: 6 },
      antes: { abertura: tender.abertura, itens: [{ tenderId: T, numero: 4, descricao: DESC, catalogCode: null, quantidade: 100, estimativa: 12, sigiloso: false }],
        fits: [{ tenderId: T, item: 4, produto: 'P1', fit: 'atende', atributos: { attributes: [{ atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável' }] } }],
        decisoes: [decisao], requisitos: [] },
      depois: { abertura: tender.abertura, itens: [{ numero: 4, descricao: DESC.replace('aço inoxidável', 'titânio'), quantidade: 100, valorEstimado: 12, sigiloso: false }], textos: [] } });
    const l = montarPauta({ hoje, pregoes: [pregao({ diff: d })], sancoes: [] }).linhas.find(x => x.estado === 'citacao_orfa')!;
    assert.equal(l.papel, 'lance');
    assert.equal(l.item, 4);
    assert.equal(l.acionavel, true);
  });
  test('item em esclarecimento: prazo do art. 164 na pauta', () => {
    const p = montarPauta({ hoje, pregoes: [pregao({ decisoes: [{ ...decisao, estado: 'esclarecer', motivos: ['comprimento não informado'] }] })], sancoes: [] });
    const l = p.linhas.find(x => x.tipo === 'prazo')!;
    assert.equal(l.ate, '2026-11-17');
    assert.equal(l.prazo?.acao, 'esclarecimento');
    assert.match(l.oQueMudou, /comprimento não informado/);
  });
  test('sessão hoje: intenção de recurso é imediata', () => {
    const p = montarPauta({ hoje: '2026-11-23', pregoes: [pregao()], sancoes: [] });
    const l = p.linhas.find(x => x.prazo?.acao === 'recurso_intencao')!;
    assert.equal(l.ate, '2026-11-23');
    assert.match(l.acao, /imediat/);
  });
  test('pregão com sessão passada sai da pauta da manhã', () => {
    assert.equal(montarPauta({ hoje: '2026-11-24', pregoes: [pregao({ decisoes: [{ ...decisao, estado: 'esclarecer' }] })], sancoes: [] }).linhas.length, 0);
  });
  test('CEIS não consultado: uma linha só, para o jurídico', () => {
    const p = montarPauta({ hoje, pregoes: [pregao(), pregao({ tender: { ...tender, id: '00394452000103/2026/22617' } })], sancoes: null });
    const l = p.linhas.filter(x => x.tipo === 'sancao');
    assert.equal(l.length, 1);
    assert.equal(l[0].tenderId, null);
    assert.equal(l[0].origem, 'aguardando');
  });
  test('sanção que tira o pregão da carteira', () => {
    const p = montarPauta({ hoje, pregoes: [pregao({ ente: { esfera: 'F' } })], sancoes: [{ categoria: 'Inidoneidade', tipo: 'inidoneidade', esfera: 'federal', uf: null, orgao: 'CGU', inicio: '2026-01-01', fim: null }] });
    const l = p.linhas.find(x => x.tipo === 'sancao')!;
    assert.equal(l.tenderId, T);
    assert.match(l.acao, /fora da carteira/);
  });
  test('semáforo fiscal vermelho: linha informativa do financeiro', () => {
    const p = montarPauta({ hoje, pregoes: [pregao({ semaforo: { status: 'vermelho', resumo: 'Despesa com pessoal acima do limite máximo' } })], sancoes: [] });
    const l = p.linhas.find(x => x.tipo === 'fiscal')!;
    assert.equal(l.papel, 'financeiro');
    assert.equal(l.acionavel, false);
  });
  test('cofre: documento que derruba pregão entra com a data de renovação', () => {
    const p = montarPauta({ hoje, pregoes: [], sancoes: [], cofre: [{ documento: 'CND Federal', exigencia: 'CND Federal (certidoes)', tipo: 'cnd_federal',
      status: 'vence_antes_sessao', renovarAte: '2026-11-15', pregoes: [{ tenderId: T, sessao: '2026-11-23' }], resumo: 'Renove CND Federal até 15/11/2026 ou perde 1 pregão.' }] });
    const l = p.linhas.find(x => x.tipo === 'cofre')!;
    assert.equal(l.ate, '2026-11-15');
    assert.equal(l.origem, 'informado_cliente');
    assert.deepEqual(l.pregoes, [T]);
  });
  test('ordem: o que pede ação primeiro, pela data; informativas depois', () => {
    const p = montarPauta({ hoje, pregoes: [pregao({ diff: diffQuantidade() })], sancoes: null });
    const idx = p.linhas.findIndex(l => !l.acionavel);
    assert.ok(idx > 0 && p.linhas.slice(idx).every(l => !l.acionavel));
    const datas = p.linhas.slice(0, idx).map(l => l.ate ?? '9999');
    assert.deepEqual(datas, [...datas].sort());
    assert.equal(p.contagem.acionaveis, idx);
  });
  test('ids estáveis e únicos', () => {
    const p = montarPauta({ hoje, pregoes: [pregao({ diff: diffQuantidade() })], sancoes: null });
    assert.equal(new Set(p.linhas.map(l => l.id)).size, p.linhas.length);
  });
});
