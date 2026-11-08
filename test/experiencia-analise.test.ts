import { test } from 'node:test';
import assert from 'node:assert/strict';
import { concluirAnalise, resumirProgresso } from '../src/lib/experiencia-analise.ts';
import type { Turno } from '../src/server/contract.ts';

const base: Turno = { id: 'teste', inicio: '2026-11-08T12:00:00Z', atualizadoEm: '2026-11-08T12:00:01Z', status: 'ativo', pregoes: ['t'], etapas: [] };
test('repetições e retorno a uma fase mantêm quatro grupos e só uma atividade em curso', () => {
  const turno = { ...base, etapas: [
    { horario: base.inicio, atividade: 'Lendo o edital', estado: 'concluida' as const },
    { horario: base.inicio, atividade: 'Lendo o edital', estado: 'concluida' as const },
    { horario: base.inicio, atividade: 'Conferindo os requisitos dos itens', estado: 'concluida' as const },
    { horario: base.inicio, atividade: 'Lendo o edital', estado: 'em_andamento' as const },
  ] };
  const resumo = resumirProgresso(turno);
  assert.equal(resumo.fases.length, 4);
  assert.equal(resumo.fases.filter(f => f.estado === 'em_andamento').length, 1);
  assert.equal(resumo.fases.find(f => f.estado === 'em_andamento')?.id, 'fontes');
  assert.equal(resumo.fases[0].consultas, 3);
  assert.equal(resumo.retomando, true);
});
test('sem atualização, falha e fim nunca mantêm spinner ou inventam conclusão de documentos', () => {
  for (const status of ['sem_atualizacao', 'falhou', 'incompleto', 'concluido'] as const) {
    const resumo = resumirProgresso({ ...base, status, etapas: [{ horario: base.inicio, atividade: 'Lendo o edital', estado: 'em_andamento' }] });
    assert.ok(resumo.fases.every(f => f.estado !== 'em_andamento'));
    assert.notEqual(resumo.fases.at(-1)?.estado, 'concluida');
  }
});
test('veredito é parcial por itens, desconhecido exige revisão e retificação bloqueia o positivo', () => {
  const item = (estadoCodigo: string) => ({ estadoCodigo });
  assert.equal(concluirAnalise([item('disputar')]).estado, 'recomendada');
  assert.equal(concluirAnalise([item('nao_disputar')]).estado, 'nao_recomendada');
  assert.equal(concluirAnalise([item('disputar'), item('escalar')]).estado, 'com_pendencias');
  assert.equal(concluirAnalise([item('disputar_com_pendencia')]).estado, 'com_pendencias');
  assert.equal(concluirAnalise([item('escalar')]).estado, 'revisao_necessaria');
  assert.equal(concluirAnalise([{ estado: 'Disputar' }]).estado, 'revisao_necessaria');
  assert.equal(concluirAnalise([]).estado, 'revisao_necessaria');
  assert.equal(concluirAnalise([item('disputar')], true).estado, 'revisao_necessaria');
  assert.equal(concluirAnalise([item('disputar')], false, false, true).estado, 'revisao_necessaria');
  assert.equal(concluirAnalise([item('disputar')], false, false, false, 0, true).estado, 'com_pendencias');
  assert.equal(concluirAnalise([item('nao_disputar')], false, false, false, 0, true).estado, 'nao_recomendada');
});
