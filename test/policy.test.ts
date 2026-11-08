// Política da empresa: o que o agente pode fazer sozinho e o que vira escalada. Falha segura.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, validatePolitica } from '../src/lib/policy.ts';
import type { AcaoContexto, ItemDecision, Politica, Recheque } from '../src/lib/contracts.ts';

const politica: Politica = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8')).politica;
const ok: Recheque = { status: 'ok', situacao: 'Divulgada no PNCP', arquivosHash: 'h1', em: '2026-11-07T10:00:00-03:00' };
const disputar: ItemDecision = { estado: 'disputar', motivos: ['ok'] };
const ctx = (c: Partial<AcaoContexto> = {}): AcaoContexto => ({ tenderId: 'T', valor: 1200, decisoes: [disputar], recheque: ok, ...c });

describe('validatePolitica', () => {
  test('a política da fixture é válida', () => assert.deepEqual(validatePolitica(politica), []));
  test('ausente ou incompleta é inválida', () => {
    assert.ok(validatePolitica(undefined).length > 0);
    assert.ok(validatePolitica({ ...politica, valorMaxAutomatico: -1 }).length > 0);
    assert.ok(validatePolitica({ ...politica, margemMinima: Number.NaN }).length > 0);
    assert.ok(validatePolitica({ ...politica, esclarecimentosAutomaticos: 'tudo' as any }).length > 0);
  });
});

describe('falha segura', () => {
  test('política ausente → nada permitido', () => {
    const r = evaluate('enviar_proposta', ctx(), undefined);
    assert.equal(r.permitido, false); assert.equal(r.escalar, true); assert.match(r.motivo, /política/);
  });
  test('política inválida → nada permitido', () => {
    assert.equal(evaluate('enviar_proposta', ctx(), { ...politica, valorMaxAutomatico: -1 }).permitido, false);
  });
  test('ação desconhecida → nada permitido', () => {
    assert.equal(evaluate('dar_lance' as any, ctx(), politica).permitido, false);
  });
});

describe('recheque antes de agir', () => {
  for (const motivo of ['suspenso', 'revogado', 'anulado', 'cancelado'] as const) {
    test(`pregão ${motivo} → bloqueia, sem escalar`, () => {
      const r = evaluate('enviar_proposta', ctx({ recheque: { status: 'bloquear', motivo, em: ok.em } }), politica);
      assert.equal(r.permitido, false); assert.equal(r.escalar, false); assert.match(r.motivo, new RegExp(motivo));
    });
  }
  test('propostas encerradas → bloqueia, sem escalar', () => {
    const r = evaluate('enviar_proposta', ctx({ recheque: { status: 'bloquear', motivo: 'prazo_encerrado', em: ok.em } }), politica);
    assert.equal(r.permitido, false); assert.equal(r.escalar, false); assert.match(r.motivo, /encerrado/);
  });
  test('arquivos mudaram → bloqueia e escala (pregao_alterado)', () => {
    const r = evaluate('enviar_proposta', ctx({ recheque: { status: 'bloquear', motivo: 'arquivos_mudaram', em: ok.em } }), politica);
    assert.equal(r.permitido, false); assert.equal(r.escalar, true);
  });
  test('fonte indisponível → bloqueia e tenta no próximo ciclo', () => {
    const r = evaluate('enviar_esclarecimento', ctx({ recheque: { status: 'bloquear', motivo: 'fonte_indisponivel', em: ok.em }, esclarecimento: { motivo: 'nao_informado', prazoAberto: true } }), politica);
    assert.equal(r.permitido, false); assert.equal(r.escalar, false); assert.match(r.motivo, /próximo ciclo/);
  });
});

describe('enviar_proposta', () => {
  test('todos os itens disputar, valor dentro do limite → permitido', () => {
    const r = evaluate('enviar_proposta', ctx(), politica);
    assert.equal(r.permitido, true); assert.equal(r.escalar, false);
  });
  test('valor acima do limite → escala', () => {
    const r = evaluate('enviar_proposta', ctx({ valor: politica.valorMaxAutomatico + 1 }), politica);
    assert.equal(r.permitido, false); assert.equal(r.escalar, true); assert.match(r.motivo, /limite/);
  });
  test('valor desconhecido → escala', () => {
    assert.equal(evaluate('enviar_proposta', ctx({ valor: null }), politica).escalar, true);
  });
  test('item com pendência → escala', () => {
    const r = evaluate('enviar_proposta', ctx({ decisoes: [disputar, { estado: 'disputar_com_pendencia', motivos: ['CND vence antes da sessão'] }] }), politica);
    assert.equal(r.permitido, false); assert.equal(r.escalar, true); assert.match(r.motivo, /pendência/);
  });
  test('pendência aprovada pelo humano, texto a texto, libera; aprovação parcial ou antiga não libera', () => {
    const pend: ItemDecision = { estado: 'disputar_com_pendencia', motivos: ['CND vence antes da sessão', 'confirmar cobertura ANVISA'] };
    const todas = evaluate('enviar_proposta', ctx({ decisoes: [disputar, pend], pendenciasAprovadas: [...pend.motivos] }), politica);
    assert.equal(todas.permitido, true); assert.match(todas.motivo, /aprovadas pelo humano/);
    const parcial = evaluate('enviar_proposta', ctx({ decisoes: [pend], pendenciasAprovadas: ['CND vence antes da sessão'] }), politica);
    assert.equal(parcial.permitido, false); assert.equal(parcial.escalar, true);
    // Aprovação não passa por cima do limite de valor.
    assert.equal(evaluate('enviar_proposta', ctx({ decisoes: [pend], valor: 1e9, pendenciasAprovadas: [...pend.motivos] }), politica).permitido, false);
  });
  test('item a escalar ou esclarecer → escala', () => {
    assert.equal(evaluate('enviar_proposta', ctx({ decisoes: [{ estado: 'escalar', motivos: ['encaixe desconhecido'] }] }), politica).permitido, false);
    assert.equal(evaluate('enviar_proposta', ctx({ decisoes: [{ estado: 'esclarecer', motivos: ['variante'] }] }), politica).permitido, false);
  });
  test('item não disputar dentro da proposta → bloqueia e escala (inconsistência)', () => {
    const r = evaluate('enviar_proposta', ctx({ decisoes: [disputar, { estado: 'nao_disputar', motivos: ['não atende'] }] }), politica);
    assert.equal(r.permitido, false); assert.equal(r.escalar, true);
  });
  test('proposta sem itens → nada a enviar', () => {
    assert.equal(evaluate('enviar_proposta', ctx({ decisoes: [] }), politica).permitido, false);
  });
});

describe('enviar_esclarecimento', () => {
  test('tipo permitido com prazo aberto → permitido', () => {
    for (const motivo of ['nao_informado', 'variante_nao_coberta', 'marca_referencia'] as const) {
      const r = evaluate('enviar_esclarecimento', ctx({ esclarecimento: { motivo, prazoAberto: true } }), politica);
      assert.equal(r.permitido, true, motivo);
    }
  });
  test('prazo vencido → escala (prazo_vencido_com_duvida)', () => {
    const r = evaluate('enviar_esclarecimento', ctx({ esclarecimento: { motivo: 'nao_informado', prazoAberto: false } }), politica);
    assert.equal(r.permitido, false); assert.equal(r.escalar, true); assert.match(r.motivo, /prazo/);
  });
  test('tipo fora da lista automática → escala', () => {
    const p = { ...politica, esclarecimentosAutomaticos: ['nao_informado' as const] };
    assert.equal(evaluate('enviar_esclarecimento', ctx({ esclarecimento: { motivo: 'marca_referencia', prazoAberto: true } }), p).escalar, true);
  });
  test('sem dados do esclarecimento → escala', () => {
    assert.equal(evaluate('enviar_esclarecimento', ctx(), politica).permitido, false);
  });
});

describe('impugnar', () => {
  test('impugnação sempre escala', () => {
    const r = evaluate('impugnar', ctx(), politica);
    assert.equal(r.permitido, false); assert.equal(r.escalar, true);
  });
});
