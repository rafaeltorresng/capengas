export type Source = { nome: string; url: string; citacao?: string };
export type Trace = { ferramenta: string; entrada?: string; saida?: string; ms?: number; custoUsd?: number };
export type Event = {
  id: string; horario: string; tipo: string; resumo: string; detalhe?: string;
  tender?: string; item?: string; dossie?: boolean; rastro?: Trace[];
};
export type QueueItem = {
  tender: string; pregao: string; item: string; descricao: string; orgao: string;
  prazo: string; estado: string; motivo: string;
};
export type Item = QueueItem & {
  encaixe: { atributo: string; exigido: string; ofertado: string; resultado: string; fonte?: Source }[];
  fontes: Source[]; anvisa: string;
  regularizacao?: 'vigente' | 'vencido' | 'nao_encontrado' | 'nao_verificado';
  cobertura?: 'declarada_pelo_cliente' | 'nao_comprovada'; preco: number | null; estimativa: number | null;
  rastro: Trace[]; dossie?: boolean;
};
export type Dossier = {
  tender: string; pregao: string; versao: string;
  checklist: { exigencia: string; documento: string; status: string; detalhe?: string; fonte?: Source }[];
  pendencias: string[]; documentos: Source[];
};
export type Escalation = {
  id: string; tender: string; item?: string; pregao: string; motivo: string;
  recomendacao: string; prazo: string; dossie?: boolean;
};
export type Decision = { decisao: 'aprovar' | 'recusar' | 'ajustar'; ajuste?: string };
export type SavedDecision = Decision & { id: string; horario: string };
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
export type ApiResponse<T> = { origem: Origin; dados: T };
export type DecisionResult =
  | { status: 'salva'; registro: SavedDecision }
  | { status: 'ausente' | 'resolvida' | 'expirada' };

// The integrated implementation must persist the resolution and audit event atomically.
export interface DemoStore {
  origem: Origin;
  hoje(): Today;
  fila(): QueueItem[];
  item(tender: string, item: string): Item | undefined;
  dossie(tender: string): Dossier | undefined;
  escaladas(): Escalation[];
  prova(): Proof;
  decidir(id: string, decision: Decision): DecisionResult;
}
