// Contratos do Dev 1 (dados, regras, política e estado). Só tipos: as implementações vêm em
// rules.ts, policy.ts e store.ts, com testes. Datas em AAAA-MM-DD; horários em ISO 8601.
// Event, Trace, Decision e DecisionResult seguem src/server/contract.ts (branch feat/dev3-mvp).

// ── Regras ──────────────────────────────────────────────────────────────────

export type PriceInput = {
  custo: number; margemMinima: number; margemAlvo: number;
  estimativa: number | null; sigiloso: boolean;
};
/** viavel = null quando o orçamento é sigiloso ou não há estimativa; precoProposto nunca passa da estimativa. */
export type PriceCheck = { viavel: boolean | null; precoProposto: number | null; motivo: string };

export type CofreDoc = {
  doc: string;
  tipo: 'afe' | 'cnd_federal' | 'crf_fgts' | 'cndt' | 'balanco' | 'atestado' | string;
  /** null = documento sem vencimento (ex.: AFE). */
  validade: string | null;
  irregular?: boolean;
};
export type Exigencia = { tipo: string; citacao: string };
export type DocStatus = 'vigente' | 'sem_vencimento' | 'vence_antes_sessao' | 'ausente' | 'irregular';
export type DocCheck = {
  exigencia: string; citacao: string; documento: string | null; validade: string | null; status: DocStatus;
};

export type Regularizacao = 'vigente' | 'vencido' | 'nao_encontrado' | 'nao_verificado';
/** Registro ANVISA pode cobrir uma família; a cobertura do modelo ofertado é declarada pelo cliente. */
export type Cobertura = 'declarada_pelo_cliente' | 'nao_comprovada';
export type AnvisaCheck = {
  regularizacao: Regularizacao; cobertura: Cobertura;
  validUntil: string | null; classe: string | null; detentor: string | null;
  /** true quando o registro vale hoje, mas vence antes do prazo de entrega. */
  venceAntesEntrega?: boolean;
};

export type Fit = 'atende' | 'nao_atende' | 'nao_informado' | 'desconhecido';
export type Estado = 'disputar' | 'disputar_com_pendencia' | 'esclarecer' | 'escalar' | 'nao_disputar';
export type ItemChecks = {
  fit: Fit;
  regularizacao: Regularizacao; cobertura: Cobertura;
  preco: PriceCheck;
  docs: DocCheck[];
  restritivo: boolean; varianteNaoCoberta: boolean;
  venceAntesEntrega?: boolean;
  /** null = prazo desconhecido (tratado como desconhecido → escalar). */
  prazoEsclarecimentoAberto: boolean | null;
};
/**
 * Ordem de decideItem (a primeira regra que casar vence):
 * 1. qualquer desconhecido (fit, preco.viavel null, regularizacao nao_verificado, prazo null quando relevante) → escalar
 * 2. restritivo ou variante não coberta, com prazo aberto → esclarecer
 * 3. não atende, regularização vencida ou não encontrada, registro vence antes da entrega, ou preço inviável → nao_disputar
 * 4. não informado → esclarecer (prazo aberto) ou escalar (prazo vencido)
 * 5. documento vence_antes_sessao, ausente ou irregular, ou cobertura nao_comprovada → disputar_com_pendencia
 * 6. senão → disputar
 */
export type ItemDecision = { estado: Estado; motivos: string[] };

export interface Rules {
  priceCheck(i: PriceInput): PriceCheck;
  checkDocs(cofre: CofreDoc[], exigencias: Exigencia[], dataSessao: string): DocCheck[];
  checkAnvisa(row: Record<string, string> | undefined, o: { today: Date; deliveryBy: Date; coberturaDeclarada: boolean }): AnvisaCheck;
  decideItem(c: ItemChecks): ItemDecision;
}

// ── Política ────────────────────────────────────────────────────────────────

export type Politica = {
  margemMinima: number; margemAlvo: number;
  valorMaxAutomatico: number;
  exigirTodosAtributosAtende: boolean;
  esclarecimentosAutomaticos: ('nao_informado' | 'variante_nao_coberta' | 'marca_referencia')[];
  sempreEscalar: ('impugnacao' | 'valor_acima_limite' | 'prazo_vencido_com_duvida' | 'pregao_alterado')[];
  turnos: string[];          // ex.: ["07:00", "11:00", "15:00"]
  monitorMinutos: number;
};
export type AcaoTipo = 'enviar_proposta' | 'enviar_esclarecimento' | 'impugnar';
export type AcaoContexto = {
  tenderId: string; valor: number | null;
  decisoes: ItemDecision[];
  recheque: Recheque;
  esclarecimento?: { motivo: 'nao_informado' | 'variante_nao_coberta' | 'marca_referencia'; prazoAberto: boolean };
};
/** Falha segura: política ausente/inválida, recheque não ok ou qualquer desconhecido → permitido = false. */
export type AvaliacaoPolitica = { permitido: boolean; escalar: boolean; motivo: string };

// ── Recheque e ações (idempotência) ────────────────────────────────────────

export type Recheque =
  | { status: 'ok'; situacao: string; arquivosHash: string; em: string }
  | { status: 'bloquear'; motivo: 'suspenso' | 'revogado' | 'anulado' | 'cancelado' | 'prazo_encerrado' | 'arquivos_mudaram' | 'fonte_indisponivel'; em: string };

export type ActionStatus = 'intencao' | 'enviada' | 'confirmada' | 'falhou' | 'reconciliar';
export type Action = {
  key: string;                        // chave idempotente, ex.: "proposta:<tenderId>:<hash do payload>"
  tipo: 'proposta' | 'esclarecimento';
  tenderId: string; item?: number;
  payload: unknown;
  status: ActionStatus;
  protocolo?: string; verificado?: boolean;
  criadaEm: string; atualizadaEm: string;
};

// ── Linha do tempo (mesmo formato de Event/Trace do Dev 3) ─────────────────

export type Trace = { ferramenta: string; entrada?: string; saida?: string; ms?: number; custoUsd?: number };
export type EventTipo =
  | 'turno_inicio' | 'turno_fim' | 'analise_item' | 'decisao'
  | 'esclarecimento_enviado' | 'proposta_enviada' | 'verificacao' | 'bloqueio'
  | 'escalada_aberta' | 'escalada_decidida' | 'monitor_mudanca' | 'erro_fonte';
export type Event = {
  id: string; horario: string; tipo: EventTipo; resumo: string; detalhe?: string;
  tender?: string; item?: string; dossie?: boolean; rastro?: Trace[];
};

// ── Escaladas (mesmo formato de Decision/DecisionResult do Dev 3) ──────────

export type EscalationStatus = 'aberta' | 'decidida' | 'expirada';
export type Escalation = {
  id: string; tender: string; item?: string; motivo: string; recomendacao: string;
  prazo: string; status: EscalationStatus;
};
export type Decision = { decisao: 'aprovar' | 'recusar' | 'ajustar'; ajuste?: string };
export type SavedDecision = Decision & { id: string; horario: string };
export type DecisionResult =
  | { status: 'salva'; registro: SavedDecision }
  | { status: 'ausente' | 'resolvida' | 'expirada' };

// ── Estado persistente (SQLite) ─────────────────────────────────────────────

export type TenderRow = {
  id: string; orgao: string; uf: string; abertura: string | null; situacao: string;
  plataforma: string; arquivosHash: string | null; ultimoCheck: string | null;
};
export type ItemRow = {
  tenderId: string; numero: number; descricao: string; catalogCode: number | null;
  quantidade: number; estimativa: number | null; sigiloso: boolean;
};
/** atributos: o Dev 2 grava { attributes, validacao } (validacao.cobertura 'nao_verificada' impede envio automático). */
export type FitRow = { tenderId: string; item: number; produto: string; fit: Fit; atributos: unknown };
export type RequirementRow = { tenderId: string; tipo: string; citacao: string };
export type DecisionRow = { tenderId: string; item: number; produto: string } & ItemDecision & { precoProposto: number | null };

export interface Store {
  upsertTender(t: TenderRow): void;
  upsertItems(tenderId: string, items: ItemRow[]): void;
  upsertFit(f: FitRow): void;
  upsertRequirement(r: RequirementRow): void;
  upsertDecision(d: DecisionRow): void;
  upsertDossie(tenderId: string, dossie: unknown): void;   // formato do dossiê: Dev 2 / contract.ts
  /** Idempotência: a mesma key devolve a ação existente em vez de criar outra. */
  recordIntent(a: Pick<Action, 'key' | 'tipo' | 'tenderId' | 'item' | 'payload'>): { status: 'nova' | 'existente'; action: Action };
  updateAction(key: string, patch: Partial<Pick<Action, 'status' | 'protocolo' | 'verificado'>>): Action;
  openEscalation(e: Omit<Escalation, 'id' | 'status'>): Escalation;
  /** Grava a decisão humana e o evento escalada_decidida na mesma transação. */
  resolveEscalation(id: string, d: Decision): DecisionResult;
  logEvent(e: Omit<Event, 'id' | 'horario'>): Event;
  events(o?: { desde?: string; limite?: number }): Event[];
  openEscalations(): Escalation[];
  getTender(id: string): TenderRow | undefined;
  getItems(tenderId: string): ItemRow[];
  getDecisions(tenderId?: string): DecisionRow[];
  /** Ações para contar envios confirmados e deduplicar por key (pedido do Dev 2, #2). */
  getActions(o?: { tenderId?: string; desde?: string; status?: ActionStatus }): Action[];
  getDossie(tenderId: string): unknown | undefined;
}
