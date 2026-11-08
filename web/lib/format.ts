import type { DeadlineKind, Origem, Papel, TurnoStatus, Urgencia } from '../../src/server/contract.ts';

export const fortaleza = 'America/Recife';
export const time = new Intl.DateTimeFormat('pt-BR', { timeZone: fortaleza, timeStyle: 'medium' });
export const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: fortaleza, dateStyle: 'short', timeStyle: 'short' });
export const dateTimeWithSeconds = new Intl.DateTimeFormat('pt-BR', { timeZone: fortaleza, dateStyle: 'short', timeStyle: 'medium' });
export const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: fortaleza, year: 'numeric', month: '2-digit', day: '2-digit' });
export const day = new Intl.DateTimeFormat('pt-BR', { timeZone: fortaleza, dateStyle: 'long' });

export const money = (amount: number | null, currency: string) => amount === null ? 'Sem medição' :
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);

export const duration = (ms: number) => ms < 1000 ? ms + ' ms' :
  ms < 60_000 ? Math.round(ms / 1000) + ' s' : Math.floor(ms / 60_000) + ' min ' + Math.floor(ms / 1000 % 60) + ' s';

const deadlineLabels: Record<DeadlineKind, string> = {
  sessao: 'Sessão', esclarecimento: 'Prazo de esclarecimento',
  decisao_humana: 'Prazo de decisão', desconhecido: 'Prazo',
};

export const deadlineTime = (value: string | null) => value ? Date.parse(value) : NaN;

export function deadlineLabel(value: string | null, kind: DeadlineKind = 'desconhecido') {
  const timestamp = deadlineTime(value);
  return Number.isFinite(timestamp)
    ? deadlineLabels[kind] + ' · ' + dateTime.format(timestamp)
    : 'Prazo não informado';
}

export const itemPath = (tender: string, item: string) => 'itens/' + encodeURIComponent(tender) + '/' + encodeURIComponent(item);
export const dossierPath = (tender: string) => 'dossies/' + encodeURIComponent(tender);

export const statusTurno: Record<TurnoStatus, string> = {
  ativo: 'Em andamento', sem_atualizacao: 'Sem atualização recente',
  concluido: 'Concluído', incompleto: 'Incompleto', falhou: 'Falhou',
};

export const papelLabels: Record<Papel, string> = { analista: 'Analista', juridico: 'Jurídico', financeiro: 'Financeiro', lance: 'Lance' };
export const origemLabels: Record<Origem, string> = {
  publicado: 'Publicado no PNCP', calculado: 'Calculado pela regra', aguardando: 'Aguardando a fonte', informado_cliente: 'Informado pela empresa',
};
export const urgenciaLabels: Record<Urgencia, string> = { vencido: 'Vencido', hoje: 'Vence hoje', proximos_3_dias: 'Próximos 3 dias', depois: 'Mais adiante' };

export const dayOf = (value: string) => day.format(new Date(value + 'T12:00:00-03:00'));

export const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

export const regularizacaoAnvisa = {
  vigente: 'Vigente', vencido: 'Vencida', nao_encontrado: 'Registro não encontrado',
  nao_verificado: 'Não verificada',
};
export const coberturaAnvisa = {
  declarada_pelo_cliente: 'Declarada pelo cliente', nao_comprovada: 'Não comprovada',
};
