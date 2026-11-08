import type { AnvisaCheck } from '../lib/contracts.ts';
export type { Decision, DecisionResult, SavedDecision, Trace } from '../lib/contracts.ts';
import type { Decision, DecisionResult, Trace } from '../lib/contracts.ts';

export type Source = { nome: string; url: string; citacao?: string };
export type Event = {
  id: string; horario: string; tipo: string; resumo: string; detalhe?: string;
  tender?: string; item?: string; dossie?: boolean; rastro?: Trace[];
};
export type DeadlineKind = 'sessao' | 'esclarecimento' | 'decisao_humana' | 'desconhecido';
export type QueueItem = {
  tender: string; pregao: string; item: string; descricao: string; orgao: string;
  prazo: string | null; prazoTipo?: DeadlineKind; estado: string; motivo: string;
};
export type Item = QueueItem & {
  encaixe: { atributo: string; exigido: string; ofertado: string; resultado: string; fonte?: Source }[];
  fontes: Source[]; anvisa: string;
  regularizacao?: AnvisaCheck['regularizacao'];
  cobertura?: AnvisaCheck['cobertura'];
  preco: number | null; estimativa: number | null;
  rastro: Trace[]; dossie?: boolean;
};
export type Dossier = {
  tender: string; pregao: string; versao: string;
  checklist: { exigencia: string; documento: string | null; status: string; detalhe?: string; fonte?: Source }[];
  pendencias: string[]; documentos: Source[];
};
export type Escalation = {
  id: string; tender: string; item?: string; pregao: string; motivo: string;
  recomendacao: string; prazo: string | null; prazoTipo?: DeadlineKind; dossie?: boolean;
};
export type Today = {
  data: string; pregoes: number; itens: number; disputar: number; pendencias: number;
  envios: number; escaladasAbertas: number; custoUsd: number | null;
  porDecisao: { estado: string; quantidade: number }[]; eventos: Event[];
};
export type Proof = {
  fonte: string; avaliacoes: { nome: string; valor: string }[];
  cenarios: { nome: string; resultado: string }[];
  concordancia: number | null; custoUsd: number | null; duracaoMs: number | null;
};
export type Origin = 'amostra' | 'integrado';
export type TurnoStatus = 'ativo' | 'sem_atualizacao' | 'concluido' | 'incompleto' | 'falhou';
export type Turno = {
  nomesEditais?: Record<string, string>;
  id: string; inicio: string; atualizadoEm: string; status: TurnoStatus;
  pregoes: string[]; etapas: { horario: string; atividade: string; estado?: 'em_andamento' | 'concluida' | 'pendente' }[]; legado?: boolean;
};
export type Turnos = { turnos: Turno[]; aprovacoes: number };
export type HistoricoItem = Pick<QueueItem, 'item' | 'descricao' | 'estado' | 'motivo'>;
export type ResultadoPregao = Pick<QueueItem, 'tender' | 'pregao' | 'orgao'> & {
  itens: HistoricoItem[]; dossie: boolean;
};
export type HistoricoPregao = ResultadoPregao & { turno: string; concluidoEm: string; pncp: string | null };
export type ApiResponse<T> = { origem: Origin; dados: T };
// The integrated implementation must persist the resolution and audit event atomically.
export interface DemoStore {
  origem: Origin;
  hoje(): Today;
  fila(): QueueItem[];
  item(tender: string, item: string): Item | undefined;
  dossie(tender: string): Dossier | undefined;
  escaladas(): Escalation[];
  prova(): Proof;
  turnos(): Turnos;
  historico(): HistoricoPregao[];
  decidir(id: string, decision: Decision): DecisionResult;
}
