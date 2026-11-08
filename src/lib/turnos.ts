import type { HistoricoPregao, QueueItem, ResultadoPregao, Turno } from '../server/contract.ts';
import type { Event } from './contracts.ts';

export const pncpUrl = (tender: string) =>
  /^\d{14}\/\d{4}\/\d+$/.test(tender) ? `https://pncp.gov.br/app/editais/${tender}` : null;

export function agruparResultados(rows: QueueItem[], dossie: (tender: string) => { pregao: string } | undefined) {
  const resultados = new Map<string, ResultadoPregao>();
  for (const { tender, pregao, orgao, item, descricao, estado, motivo } of rows) {
    let resultado = resultados.get(tender);
    if (!resultado) {
      const documento = dossie(tender);
      resultado = { tender, pregao: documento?.pregao ?? pregao, orgao, dossie: !!documento, itens: [] };
      resultados.set(tender, resultado);
    }
    resultado.itens.push({ item, descricao, estado, motivo });
  }
  return [...resultados.values()];
}

export type TurnoEvent = { turno: string } & (
  | { tipo: 'inicio'; pregoes: string[]; nomesEditais?: Record<string, string> }
  | { tipo: 'atividade'; atividade: string }
  | { tipo: 'resultado'; concluida: boolean }
  | { tipo: 'sinal' }
  | { tipo: 'fim'; status: 'concluido' | 'incompleto' | 'falhou'; resultados: ResultadoPregao[] }
);

export function eventoTurno(evento: TurnoEvent): Omit<Event, 'id' | 'horario'> {
  const tipo = evento.tipo === 'inicio' ? 'turno_inicio' : evento.tipo === 'fim' ? 'turno_fim' : 'turno_progresso';
  const resumo = evento.tipo === 'atividade' ? evento.atividade : 'Atualização de turno';
  return { tipo, resumo, detalhe: JSON.stringify(evento) };
}

function payload(event: Event): TurnoEvent | undefined {
  if (!event.detalhe || !['turno_inicio', 'turno_progresso', 'turno_fim'].includes(event.tipo)) return;
  try {
    const value = JSON.parse(event.detalhe);
    if (typeof value?.turno === 'string') return value;
  } catch { /* Eventos antigos podem conter texto livre. */ }
}

export function projetarTurnos(events: Event[], agora: Date, resultadoLegado: (events: Event[]) => ResultadoPregao[]) {
  const turnos = new Map<string, Turno>();
  const historico = new Map<string, HistoricoPregao>();
  let legado: { turno: Turno; decisoes: Event[]; ambiguo: boolean } | undefined;

  function publicar(turno: Turno, resultados: ResultadoPregao[]) {
    for (const resultado of resultados) {
      historico.set(resultado.tender, { ...resultado, turno: turno.id, concluidoEm: turno.atualizadoEm, pncp: pncpUrl(resultado.tender) });
    }
  }

  for (const event of events) {
    const data = payload(event);
    if (data?.tipo === 'inicio') {
      turnos.set(data.turno, { id: data.turno, inicio: event.horario, atualizadoEm: event.horario,
        status: 'ativo', pregoes: data.pregoes, etapas: [], nomesEditais: data.nomesEditais });
    } else if (data) {
      const turno = turnos.get(data.turno);
      if (!turno || turno.status !== 'ativo') continue;
      turno.atualizadoEm = event.horario;
      const etapa = turno.etapas.at(-1);
      if (data.tipo === 'atividade' && (etapa?.atividade !== data.atividade || etapa.estado !== 'em_andamento')) {
        if (etapa?.estado === 'em_andamento') delete etapa.estado;
        turno.etapas.push({ horario: event.horario, atividade: data.atividade, estado: 'em_andamento' });
      }
      if (data.tipo === 'resultado' && etapa?.estado === 'em_andamento') {
        etapa.estado = data.concluida ? 'concluida' : 'pendente';
      }
      if (data.tipo === 'fim') {
        turno.status = data.status;
        if (etapa?.estado === 'em_andamento') etapa.estado = data.status === 'concluido' ? 'concluida' : 'pendente';
        if (data.status === 'concluido') publicar(turno, data.resultados);
      }
    } else if (event.tipo === 'turno_inicio') {
      const turno: Turno = { id: event.id, inicio: event.horario, atualizadoEm: event.horario,
        status: 'incompleto', pregoes: [], etapas: [], legado: true };
      turnos.set(turno.id, turno);
      legado = { turno, decisoes: [], ambiguo: !!legado || [...turnos.values()].some(row => row.status === 'ativo') };
    } else if (legado && event.tipo === 'decisao') {
      legado.decisoes.push(event);
    } else if (legado && event.tipo === 'turno_fim') {
      const { turno, decisoes, ambiguo } = legado;
      legado = undefined;
      turno.atualizadoEm = event.horario;
      if (ambiguo) continue;
      turno.pregoes = [...new Set(decisoes.flatMap(row => row.tender ? [row.tender] : []))];
      const total = /^Análise encerrada: final; ([1-9]\d*) decisões persistidas\.$/.exec(event.resumo)?.[1];
      const concluido = total !== undefined && Number(total) === decisoes.length;
      if (concluido) {
        turno.status = 'concluido';
        publicar(turno, resultadoLegado(decisoes));
      }
    }
    if (data?.tipo === 'inicio' && legado) legado.ambiguo = true;
  }

  for (const turno of turnos.values()) {
    if (turno.status === 'ativo' && agora.getTime() - Date.parse(turno.atualizadoEm) >= 60_000) {
      turno.status = 'sem_atualizacao';
    }
  }
  const prioridade = (turno: Turno) => turno.status === 'ativo' ? 0 : turno.status === 'sem_atualizacao' ? 1 : 2;
  return {
    turnos: [...turnos.values()].reverse().sort((a, b) => prioridade(a) - prioridade(b) || b.inicio.localeCompare(a.inicio)),
    historico: [...historico.values()].sort((a, b) => b.concluidoEm.localeCompare(a.concluidoEm)),
  };
}
