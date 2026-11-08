import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fatosDoPainel, presencaDoMascote, type FatosMascote, type RelatoTurnos } from '../web/lib/mascote.ts';

function ver(fatos: FatosMascote, state: string, placement: string) {
  assert.deepEqual(presencaDoMascote(fatos), { state, placement });
}

test('no onboarding o ghost só trabalha enquanto a análise está sendo iniciada', () => {
  ver({ tela: 'onboarding', passo: 1 }, 'default', 'float');
  ver({ tela: 'onboarding', passo: 2 }, 'default', 'float');
  ver({ tela: 'onboarding', passo: 2, iniciando: true }, 'default', 'float');
  ver({ tela: 'onboarding', passo: 3 }, 'default', 'float');
  ver({ tela: 'onboarding', passo: 3, iniciando: true }, 'working', 'float');
});

test('a lista de editais distingue carregamento, vazio, análise ativa e repouso', () => {
  ver({ tela: 'editais' }, 'default', 'float');
  ver({ tela: 'editais', turnosConhecidos: false, listaVazia: true }, 'default', 'float');
  ver({ tela: 'editais', turnosConhecidos: true, listaVazia: true, algumAtivo: true }, 'sleeping', 'float');
  ver({ tela: 'editais', turnosConhecidos: true, listaVazia: false, algumAtivo: true }, 'working', 'float');
  ver({ tela: 'editais', turnosConhecidos: true, listaVazia: false, algumAtivo: false }, 'default', 'float');
});

test('a análise aberta usa o lugar do orb e o resultado devolve o acompanhante', () => {
  for (const status of ['falhou', 'sem_atualizacao', 'incompleto', 'concluido'] as const) {
    ver({ tela: 'analise', analise: { status, mostraResultado: false } }, 'default', 'inline');
  }
  ver({ tela: 'analise', analise: { status: 'ativo', mostraResultado: false } }, 'working', 'inline');
  ver({ tela: 'analise', analise: { status: 'concluido', mostraResultado: true } }, 'default', 'float');
  ver({ tela: 'analise', analise: { status: 'ativo', mostraResultado: true } }, 'default', 'float');
  ver({ tela: 'analise', analise: null }, 'default', 'float');
});

test('pendência humana não parece trabalho do Lance, e o vazio descansa', () => {
  ver({ tela: 'pendencias', pendenciasConhecidas: false, pendenciasVazias: true }, 'default', 'float');
  ver({ tela: 'pendencias', pendenciasConhecidas: true, pendenciasVazias: false }, 'default', 'float');
  ver({ tela: 'pendencias', pendenciasConhecidas: true, pendenciasVazias: true }, 'sleeping', 'float');
});

test('consulta e caminhos do painel não inventam outro gesto', () => {
  ver({ tela: 'consulta', algumAtivo: true, iniciando: true, pendenciasVazias: true }, 'default', 'float');
  const vazio: RelatoTurnos = { conhecidos: true, turnos: [], analise: null };
  const ativo: RelatoTurnos = {
    conhecidos: true,
    turnos: [{ status: 'ativo', temResultado: false }],
    analise: { status: 'ativo', mostraResultado: false },
  };
  const resultado: RelatoTurnos = {
    conhecidos: true,
    turnos: [{ status: 'concluido', temResultado: true }],
    analise: { status: 'concluido', mostraResultado: true },
  };
  assert.deepEqual(presencaDoMascote(fatosDoPainel('turnos', null, false, 0)), { state: 'default', placement: 'float' });
  assert.deepEqual(presencaDoMascote(fatosDoPainel('turnos', vazio, false, 0)), { state: 'sleeping', placement: 'float' });
  assert.deepEqual(presencaDoMascote(fatosDoPainel('turnos', ativo, false, 0)), { state: 'working', placement: 'float' });
  assert.deepEqual(presencaDoMascote(fatosDoPainel('turnos/amostra', ativo, false, 0)), { state: 'working', placement: 'inline' });
  assert.deepEqual(presencaDoMascote(fatosDoPainel('turnos/amostra', resultado, false, 0)), { state: 'default', placement: 'float' });
  assert.deepEqual(presencaDoMascote(fatosDoPainel('turnos/sumiu', { conhecidos: true, turnos: [], analise: null }, false, 0)), { state: 'default', placement: 'float' });
  assert.deepEqual(presencaDoMascote(fatosDoPainel('escaladas', null, false, 0)), { state: 'default', placement: 'float' });
  assert.deepEqual(presencaDoMascote(fatosDoPainel('escaladas', null, true, 0)), { state: 'sleeping', placement: 'float' });
  assert.deepEqual(presencaDoMascote(fatosDoPainel('escaladas', null, true, 2)), { state: 'default', placement: 'float' });
  for (const path of ['hoje', 'pauta', 'fila', 'historico', 'prova', 'itens/demo/1', 'dossies/demo']) {
    assert.deepEqual(presencaDoMascote(fatosDoPainel(path, ativo, true, 0)), { state: 'default', placement: 'float' });
  }
});
