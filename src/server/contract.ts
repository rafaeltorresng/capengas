import type { AnvisaCheck } from '../lib/contracts.ts';
import type { AlertaCofre } from '../lib/cofre.ts';
import type { Pauta } from '../lib/pauta.ts';
export type { AlertaCofre, Pauta };
export type { LinhaPauta, Papel, TipoLinha, Urgencia } from '../lib/pauta.ts';
export type { Prazo, Origem } from '../lib/prazos.ts';
export type { Decision, DecisionResult, SavedDecision, Trace } from '../lib/contracts.ts';
import type { Decision, DecisionResult, Trace } from '../lib/contracts.ts';

export type Source = { nome: string; url: string; citacao?: string };
export type Event = {
  id: string; horario: string; tipo: string; resumo: string; detalhe?: string;
  tender?: string; item?: string; itemDisponivel?: boolean; dossie?: boolean; rastro?: Trace[];
};
export type DeadlineKind = 'sessao' | 'esclarecimento' | 'decisao_humana' | 'desconhecido';
export type QueueItem = {
  tender: string; pregao: string; item: string; descricao: string; orgao: string;
  prazo: string | null; prazoTipo?: DeadlineKind; estado: string; motivo: string;
};
export type EvidenceValidation = {
  citacoes: 'conferidas' | 'nao_verificadas';
  cobertura: 'conferida' | 'nao_verificada';
  semantica: 'julgamento_modelo' | 'nao_verificada';
  lacunas: string[];
};
export type Item = QueueItem & {
  validacao?: EvidenceValidation;
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
  reavaliar?: boolean;
  retificacao?: import('../lib/versao.ts').VersaoRetificacao;
  retificacoes?: import('../lib/versao.ts').VersaoRetificacao[];
};
export type Escalation = {
  id: string; tender: string; item?: string; itemDisponivel?: boolean; pregao: string; motivo: string;
  recomendacao: string; prazo: string | null; prazoTipo?: DeadlineKind; dossie?: boolean;
};
export type CofreAlert = Omit<AlertaCofre, 'pregoes'> & {
  pregoes: (AlertaCofre['pregoes'][number] & { dossie?: boolean })[];
};
export type Today = {
  data: string; pregoes: number; itens: number; disputar: number; pendencias: number;
  envios: number; escaladasAbertas: number; custoUsd: number | null;
  porDecisao: { estado: string; quantidade: number }[]; eventos: Event[];
  /** Documentos do cofre que derrubam algum pregão com sessão futura. Lista vazia quando não há calendário. */
  cofre: CofreAlert[];
};
export type Proof = {
  fonte: string; avaliacoes: { nome: string; valor: string }[];
  cenarios: { nome: string; resultado: string }[];
  concordancia: number | null; custoUsd: number | null; duracaoMs: number | null;
};
export type Origin = 'amostra' | 'integrado';
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
  /** Pauta da manhã (#25, fase 1): prazos legais, diferenças da errata, cofre e sanção. */
  pauta(): Pauta;
  decidir(id: string, decision: Decision): DecisionResult;
}
