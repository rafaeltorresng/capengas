import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createReadModel } from '../src/lib/read-model.ts';
import type { Action, CofreDoc, Event, Decision, DecisionRow, Escalation } from '../src/lib/contracts.ts';

const TID = '77816510000166/2026/348';
const NOW = new Date('2026-11-07T16:00:00-03:00');
function setup() {
  const sample = JSON.parse(readFileSync(new URL('../fixtures/estado-exemplo.json', import.meta.url), 'utf8'));
  let opening: string | null = '2026-11-23T09:00';
  let dossie: unknown = sample.dossies[0];
  const events: Event[] = [];
  const actions: Action[] = [];
  const decisions: DecisionRow[] = [
    { tenderId: TID, item: 4, produto: 'P1', estado: 'escalar', motivos: ['Ficha incompleta'], precoProposto: null },
    { tenderId: TID, item: 40, produto: 'P2', estado: 'nao_disputar', motivos: ['Haste incompatível'], precoProposto: null },
  ];
  const escalations: Escalation[] = [{ id: 'E1', tender: TID, item: '4', motivo: 'Ficha incompleta', recomendacao: 'Conferir ficha', prazo: '2026-11-23T09:00:00-03:00', status: 'aberta' }];
  const resolutions: { id: string; decision: Decision }[] = [];
  const store = {
    events: () => events,
    openEscalations: () => escalations.filter(e => e.status === 'aberta'),
    getTender: (id: string) => id === TID ? { id, orgao: 'Município de Francisco Beltrão', uf: 'PR', abertura: opening, situacao: 'Divulgada', plataforma: 'Compras.gov.br', arquivosHash: null, ultimoCheck: null } : undefined,
    getItems: () => sample.dossies[0].itens.map((i: any) => ({ tenderId: TID, numero: i.item, descricao: i.descricao, quantidade: i.quantidade, estimativa: i.estimativa, catalogCode: null, sigiloso: false })),
    getDecisions: (id?: string) => decisions.filter(d => !id || d.tenderId === id),
    getDossie: (id: string) => id === TID ? dossie : undefined,
    resolveEscalation: (id: string, decision: Decision) => {
      resolutions.push({ id, decision });
      const row = escalations.find(e => e.id === id);
      if (!row) return { status: 'ausente' as const };
      row.status = 'decidida';
      events.push({ id: 'resolved', horario: NOW.toISOString(), tipo: 'escalada_decidida', resumo: 'Decisão humana', tender: TID, item: row.item });
      return { status: 'salva' as const, registro: { id, horario: NOW.toISOString(), ...decision } };
    },
  };
  const model = createReadModel(store, { actions: () => actions, now: () => NOW, origem: 'amostra' });
  return { model, events, actions, decisions, resolutions, opening: (v: string | null) => { opening = v; }, dossie: (v: unknown) => { dossie = v; } };
}
const event = (horario: string, item: string): Event => ({ id: horario + item, horario, tipo: 'decisao', resumo: 'Decisão calculada', tender: TID, item });

describe('projeção do Store para a tela', () => {
  test('Hoje considera o dia em Recife e não atribui decisões antigas à execução atual', () => {
    const s = setup();
    s.events.push(event('2026-11-07T02:59:59Z', '40'), event('2026-11-07T03:00:00Z', '4'));
    const today = s.model.hoje();
    assert.equal(today.data, '2026-11-07');
    assert.equal(today.itens, 1);
    assert.equal(today.pregoes, 1);
    assert.deepEqual(today.porDecisao, [{ estado: 'Escalar', quantidade: 1 }]);
    assert.equal(today.custoUsd, null);
    assert.deepEqual(today.cofre, []);
  });
  test('Hoje lista o documento do cofre que derruba pregão com sessão futura', () => {
    const s = setup();
    const cofre: CofreDoc[] = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8')).cofre;
    const store = {
      events: () => [], openEscalations: () => [], getTender: () => undefined, getItems: () => [], getDecisions: () => [],
      getDossie: () => undefined, resolveEscalation: () => ({ status: 'ausente' as const }),
      getTenders: () => [{ id: TID, orgao: 'X', uf: 'PR', abertura: '2026-11-23T09:00', situacao: 'Divulgada', plataforma: 'Compras.gov.br', arquivosHash: null, ultimoCheck: null }],
      getRequirements: () => [{ tenderId: TID, tipo: 'certidoes', citacao: 'certidões' }],
    };
    const today = createReadModel(store, { actions: () => [], now: () => NOW, cofre }).hoje();
    assert.equal(today.cofre.length, 1);
    assert.equal(today.cofre[0].tipo, 'cnd_federal');
    assert.equal(today.cofre[0].renovarAte, '2026-11-15');
    assert.deepEqual(today.cofre[0].pregoes, [{ tenderId: TID, sessao: '2026-11-23' }]);
  });
  test('conta envios somente por ações confirmadas, verificadas e únicas', () => {
    const s = setup();
    const base: Action = { key: 'K1', tipo: 'proposta', tenderId: TID, payload: {}, status: 'confirmada', verificado: true, protocolo: 'SBX-1', criadaEm: NOW.toISOString(), atualizadaEm: NOW.toISOString() };
    s.actions.push(base, { ...base }, { ...base, key: 'K2', status: 'enviada' }, { ...base, key: 'K3', verificado: false });
    assert.equal(s.model.hoje().envios, 1);
  });
  test('Item usa o estado/preço persistido e as citações do dossiê', () => {
    const s = setup();
    const item = s.model.item(TID, '40')!;
    assert.equal(item.estado, 'Não disputar');
    assert.equal(item.preco, null);
    assert.equal(item.encaixe[0].resultado, 'Não atende');
    assert.equal(item.encaixe[0].fonte!.citacao, 'haste: haste reta');
    assert.match(item.anvisa, /não verificad/i);
    assert.equal(s.model.item(TID, '999'), undefined);
  });
  test('quando há produtos alternativos usa a seleção explícita do dossiê', () => {
    const s = setup();
    s.decisions.unshift({ tenderId: TID, item: 40, produto: 'OUTRO', estado: 'disputar', motivos: ['Outra alternativa'], precoProposto: 99 });
    assert.equal(s.model.fila().length, 2);
    assert.equal(s.model.item(TID, '40')!.estado, 'Não disputar');
    assert.equal(s.model.item(TID, '40')!.preco, null);
  });
  test('não escolhe arbitrariamente uma proposta entre produtos sem seleção', () => {
    const s = setup(); s.dossie(undefined);
    s.decisions.unshift({ tenderId: TID, item: 40, produto: 'OUTRO', estado: 'disputar', motivos: ['Outra alternativa'], precoProposto: 99 });
    const item = s.model.item(TID, '40')!;
    assert.equal(item.estado, 'Escalar');
    assert.equal(item.preco, null);
    assert.match(item.motivo, /seleção/i);
  });
  test('expõe prazo desconhecido como nulo, sem data fictícia', () => {
    const s = setup(); s.opening(null);
    assert.equal(s.model.fila()[0].prazo, null);
    assert.equal(s.model.fila()[0].prazoTipo, 'desconhecido');
  });
  test('delega a decisão humana ao Store e não duplica o evento de auditoria', () => {
    const s = setup();
    const result = s.model.decidir('E1', { decisao: 'ajustar', ajuste: 'Solicitar ficha' });
    assert.equal(result.status, 'salva');
    assert.equal(s.resolutions.length, 1);
    assert.equal(s.events.filter(e => e.tipo === 'escalada_decidida').length, 1);
    assert.equal(s.model.escaladas().length, 0);
  });
  test('ausência de relatório de prova mantém custo, tempo e concordância desconhecidos', () => {
    const s = setup();
    const proof = s.model.prova();
    assert.equal(proof.custoUsd, null);
    assert.equal(proof.duracaoMs, null);
    assert.equal(proof.concordancia, null);
    assert.deepEqual(proof.cenarios, []);
  });
  test('dossiê ausente/inválido não se transforma em evidência favorável', () => {
    const s = setup(); s.dossie({ tender: TID });
    assert.equal(s.model.dossie(TID), undefined);
    assert.deepEqual(s.model.item(TID, '4')!.encaixe, []);
    assert.match(s.model.item(TID, '4')!.anvisa, /não verificad/i);
  });
});
