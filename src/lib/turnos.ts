import type { HistoricoPregao, QueueItem, ResultadoPregao, Turno } from '../server/contract.ts';
import type { Event } from './contracts.ts';

export const pncpUrl = (tender: string) =>
  /^\d{14}\/\d{4}\/\d+$/.test(tender) ? `https://pncp.gov.br/app/editais/${tender}` : null;

export function agruparResultados(rows: QueueItem[], dossie: (tender: string) => { pregao: string } | undefined) {
  const resultados = new Map<string, ResultadoPregao>();
  for (const { tender, pregao, orgao, item, descricao, estado, estadoCodigo, motivo } of rows) {
    let resultado = resultados.get(tender);
    if (!resultado) {
      const documento = dossie(tender);
      resultado = { tender, pregao: documento?.pregao ?? pregao, orgao, dossie: !!documento, itens: [] };
      resultados.set(tender, resultado);
    }
    resultado.itens.push({ item, descricao, estado, ...(estadoCodigo ? { estadoCodigo } : {}), motivo });
  }
  return [...resultados.values()];
}

export type TurnoEvento =
  | { tipo: 'inicio'; pregoes: string[]; nomesEditais?: Record<string, string> }
  | { tipo: 'atividade'; atividade: string; ferramenta?: string }
  | { tipo: 'resultado'; concluida: boolean }
  | { tipo: 'sinal' }
  | { tipo: 'fim'; status: 'concluido' | 'incompleto' | 'falhou'; resultados: ResultadoPregao[]; motivo?: string };

export type TurnoEvent = { turno: string } & TurnoEvento;

const ATIVIDADES: Record<string, string> = {
  list_catalog: 'Consultando o catálogo da empresa',
  get_product_sheet: 'Consultando as fichas dos produtos',
  get_tender_items: 'Consultando os itens do pregão',
  get_tender_item: 'Consultando os itens do pregão',
  read_edital: 'Lendo o edital',
  record_requirement: 'Registrando as exigências do edital',
  record_fit: 'Conferindo os requisitos dos itens',
  check_anvisa: 'Consultando o registro na Anvisa',
  decide_item: 'Preparando a recomendação por item',
  flag_restrictive: 'Registrando exigência restritiva',
  draft_esclarecimento: 'Rascunhando o pedido de esclarecimento',
  read_proposal_docs: 'Lendo as regras da proposta no edital',
  read_proposal_excerpt: 'Lendo o modelo de proposta',
  record_proposal_rule: 'Registrando as regras da proposta',
  draft_proposal_document: 'Montando o documento da proposta',
  record_document_requirement: 'Registrando documento exigido',
  draft_document_plan: 'Montando o plano de documentos',
};

export function atividadeDaFerramenta(nome: string) {
  return ATIVIDADES[nome] ?? 'Analisando o pregão';
}

export function eventoTurno(evento: TurnoEvent): Omit<Event, 'id' | 'horario'> {
  // O par turno_inicio/turno_fim é do agendador e da prova. O progresso vive à parte,
  // senão um segundo início desfaz a duração medida e o controle de horário.
  const resumo = evento.tipo === 'atividade' ? evento.atividade : 'Atualização de turno';
  return { tipo: 'turno_progresso', resumo, detalhe: JSON.stringify(evento) };
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
        turno.etapas.push({ horario: event.horario, atividade: data.atividade, ...(data.ferramenta ? { ferramenta: data.ferramenta } : {}), estado: 'em_andamento' });
      }
      if (data.tipo === 'resultado' && etapa?.estado === 'em_andamento') {
        etapa.estado = data.concluida ? 'concluida' : 'pendente';
      }
      if (data.tipo === 'fim') {
        turno.status = data.status;
        turno.resultados = data.resultados;
        if (data.motivo) turno.motivo = data.motivo;
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
      if (ambiguo) { turnos.delete(turno.id); continue; }
      turno.atualizadoEm = event.horario;
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
