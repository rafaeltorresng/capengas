// Regras determinísticas: tudo que pode ser verificado fica no código, não no modelo.
import type { AnvisaCheck, Cobertura, PriceInput, PriceCheck, CofreDoc, Exigencia, DocCheck, DocStatus, ItemDecision, ItemChecks as ContractItemChecks } from './contracts.ts';

export type AnvisaRow = Record<string, string>;
export type AnvisaStatus = 'ok' | 'nao_encontrado' | 'vencido' | 'vence_antes_entrega';

const ymd = (dt: Date) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(dt);
  return p; // YYYY-MM-DD
};

export function parseBrDate(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * Regularização (o número existe e vale) separada da cobertura (o registro cobre o modelo ofertado,
 * declarado pelo cliente: o registro pode ser de família). O detentor não precisa ser a distribuidora.
 * Também devolve `status` no formato antigo, usado pelo tools.ts até a migração.
 */
export function checkAnvisa(row: AnvisaRow | undefined, o: { today: Date; deliveryBy: Date; coberturaDeclarada?: boolean }): AnvisaCheck & { status: AnvisaStatus } {
  const cobertura: Cobertura = o.coberturaDeclarada ? 'declarada_pelo_cliente' : 'nao_comprovada';
  const base = { cobertura, classe: row?.CLASSE_RISCO ?? null, detentor: row?.DETENTOR_REGISTRO_CADASTRO ?? null };
  if (!row) return { ...base, regularizacao: 'nao_encontrado', status: 'nao_encontrado', validUntil: null };
  const raw = row.VALIDADE_REGISTRO_CADASTRO;
  if (raw === 'VIGENTE') return { ...base, regularizacao: 'vigente', status: 'ok', validUntil: null };
  const validUntil = parseBrDate(raw);
  if (!validUntil) return { ...base, regularizacao: 'nao_verificado', status: 'nao_encontrado', validUntil: null };
  if (validUntil < ymd(o.today)) return { ...base, regularizacao: 'vencido', status: 'vencido', validUntil };
  if (validUntil < ymd(o.deliveryBy)) return { ...base, regularizacao: 'vigente', venceAntesEntrega: true, status: 'vence_antes_entrega', validUntil };
  return { ...base, regularizacao: 'vigente', status: 'ok', validUntil };
}

/** Preço pela estimativa do órgão (o histórico não previu o vencedor no backtest). */
export function priceCheck(i: PriceInput): PriceCheck {
  if (!(i.custo > 0)) return { viavel: null, precoProposto: null, motivo: 'custo inválido ou ausente: escalar' };
  if (i.sigiloso || !(Number(i.estimativa) > 0)) return { viavel: null, precoProposto: null, motivo: 'sem estimativa (orçamento sigiloso ou ausente): escalar' };
  const est = Number(i.estimativa);
  const piso = i.custo * (1 + i.margemMinima);
  if (piso > est) return { viavel: false, precoProposto: null, motivo: `custo + margem mínima (R$ ${piso.toFixed(2)}) acima da estimativa (R$ ${est.toFixed(2)})` };
  const preco = Math.round(Math.min(est, Math.max(piso, i.custo * (1 + i.margemAlvo))) * 100) / 100;
  return { viavel: true, precoProposto: preco, motivo: `preço com margem dentro da estimativa (R$ ${est.toFixed(2)})` };
}

// Exigências do edital que são atendidas por documentos do cofre (as demais, como registro ANVISA, não viram linha).
const DOC_REQS: Record<string, { tipo: string; nome: string }[]> = {
  afe: [{ tipo: 'afe', nome: 'AFE ANVISA' }],
  certidoes: [{ tipo: 'cnd_federal', nome: 'CND Federal' }, { tipo: 'crf_fgts', nome: 'CRF FGTS' }, { tipo: 'cndt', nome: 'CNDT' }],
  balanco: [{ tipo: 'balanco', nome: 'Balanço patrimonial' }],
  atestado: [{ tipo: 'atestado', nome: 'Atestado de capacidade técnica' }],
};

/** Cofre × data da sessão. `validade: null` significa documento sem vencimento (ex.: AFE). */
export function checkDocs(cofre: CofreDoc[], exigencias: Exigencia[], dataSessao: string): DocCheck[] {
  const out: DocCheck[] = [];
  for (const e of exigencias) {
    for (const req of DOC_REQS[e.tipo] ?? []) {
      const doc = cofre.find(c => c.tipo === req.tipo);
      const exigencia = `${req.nome} (${e.tipo})`;
      if (!doc) { out.push({ exigencia, citacao: e.citacao, documento: null, validade: null, status: 'ausente' }); continue; }
      const status: DocStatus = doc.irregular ? 'irregular' : doc.validade === null ? 'sem_vencimento' : doc.validade < dataSessao ? 'vence_antes_sessao' : 'vigente';
      out.push({ exigencia, citacao: e.citacao, documento: doc.doc, validade: doc.validade, status });
    }
  }
  return out;
}

const IGNORED_BRANDS = new Set(['PROPRIO', 'PROPRIA', 'GENERICO', 'DIVERSOS', 'DIVERSAS', 'SEM MARCA', 'NAO INFORMADO', 'NI', 'NA']);
export function normalizeBrand(s: string | null | undefined): string | null {
  const n = (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n || IGNORED_BRANDS.has(n)) return null;
  return n;
}

type PriceRec = { marca?: string | null; precoUnitario: number };
const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

export function priceStats(recs: PriceRec[]) {
  const v = recs.map(r => r.precoUnitario).filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  const groups = new Map<string, number[]>();
  for (const r of recs) {
    const b = normalizeBrand(r.marca) ?? '(sem marca)';
    groups.set(b, [...(groups.get(b) ?? []), r.precoUnitario]);
  }
  const byBrand = [...groups].map(([brand, ps]) => {
    const s = [...ps].sort((a, b) => a - b);
    return { brand, n: s.length, median: quantile(s, 0.5), min: s[0] };
  }).sort((a, b) => b.n - a.n);
  return { n: v.length, min: v[0] ?? NaN, p25: quantile(v, 0.25), median: quantile(v, 0.5), p75: quantile(v, 0.75), max: v.at(-1) ?? NaN, byBrand };
}

export function brandConcentration(recs: PriceRec[], o = { minN: 5, minShare: 0.8 }) {
  const brands = recs.map(r => normalizeBrand(r.marca)).filter((b): b is string => !!b);
  const counts = new Map<string, number>();
  for (const b of brands) counts.set(b, (counts.get(b) ?? 0) + 1);
  const [topBrand, top] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const n = brands.length, share = n ? top / n : 0;
  return { n, topBrand, share, distinct: counts.size, flag: n >= o.minN && share >= o.minShare };
}

export function suggestPrice(stats: ReturnType<typeof priceStats>, cost: number, minMargin: number) {
  if (!stats.n) return { ok: false, price: null, reason: 'sem histórico de preço para o código' };
  const floor = cost * (1 + minMargin);
  if (floor > stats.median) return { ok: false, price: null, reason: `custo+margem R$ ${floor.toFixed(2)} acima da mediana histórica R$ ${stats.median.toFixed(2)}` };
  const price = Math.max(floor, stats.p25);
  return { ok: true, price: Math.round(price * 100) / 100, reason: `entre custo+margem (R$ ${floor.toFixed(2)}) e mediana (R$ ${stats.median.toFixed(2)})` };
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

export function verifyQuote(quote: string, doc: string, minLen = 20) {
  const q = norm(quote ?? '');
  if (q.length < minLen) return { found: false, reason: 'citação curta demais' };
  const idx = norm(doc).indexOf(q);
  return idx >= 0 ? { found: true, index: idx } : { found: false, reason: 'texto não existe no documento' };
}

// Feriados nacionais de 2026 (local/estadual não incluídos: limitação conhecida).
const HOLIDAYS = new Set(['2026-01-01', '2026-04-03', '2026-04-21', '2026-05-01', '2026-09-07', '2026-10-12', '2026-11-02', '2026-11-15', '2026-11-20', '2026-12-25', '2027-01-01']);
const isBusinessDay = (s: string) => {
  const wd = new Date(s + 'T12:00:00Z').getUTCDay();
  return wd !== 0 && wd !== 6 && !HOLIDAYS.has(s);
};

/** Art. 164 da Lei 14.133: pedido até 3 dias úteis antes da abertura. */
export function esclarecimentoDeadline(opening: Date, businessDays = 3) {
  let cur = new Date(ymd(opening) + 'T12:00:00Z');
  let count = 0;
  while (count < businessDays) {
    cur = new Date(cur.getTime() - 86400000);
    if (isBusinessDay(cur.toISOString().slice(0, 10))) count++;
  }
  return cur.toISOString().slice(0, 10);
}

// ── Decisão por item ────────────────────────────────────────────────────────

/** Formato antigo, ainda usado pelo tools.ts. Removido quando o Dev 2 migrar para o contrato novo. */
export type LegacyItemChecks = {
  fit: 'atende' | 'nao_atende' | 'nao_informado';
  anvisa: AnvisaStatus;
  price: { ok: boolean; reason?: string };
  docsOk: boolean;
  restrictive: boolean;
};
export type ItemChecks = LegacyItemChecks;
export type Decision = 'ofertar' | 'ofertar_com_pendencia' | 'nao_ofertar' | 'escalar';

function decideLegacy(c: LegacyItemChecks): { decision: Decision; reasons: string[] } {
  if (c.restrictive) return { decision: 'escalar', reasons: ['especificação possivelmente restritiva: sugerir pedido de esclarecimento'] };
  const no: string[] = [];
  if (c.fit === 'nao_atende') no.push('produto não atende à especificação');
  if (c.anvisa !== 'ok') no.push(`registro ANVISA: ${c.anvisa}`);
  if (!c.price.ok) no.push(`preço: ${c.price.reason}`);
  if (no.length) return { decision: 'nao_ofertar', reasons: no };
  if (c.fit === 'nao_informado') return { decision: 'escalar', reasons: ['atributo não informado na ficha técnica'] };
  if (!c.docsOk) return { decision: 'ofertar_com_pendencia', reasons: ['documento da empresa vencido ou ausente'] };
  return { decision: 'ofertar', reasons: ['atende, registro válido, preço viável'] };
}

const PENDENTES: DocStatus[] = ['vence_antes_sessao', 'ausente', 'irregular'];

/** Decisão do contrato (contracts.ts). A primeira regra que casar vence; qualquer desconhecido escala. */
function decideContract(c: NewItemChecks): ItemDecision {
  const desconhecido: string[] = [];
  if (c.fit === 'desconhecido') desconhecido.push('encaixe técnico desconhecido');
  if (c.preco.viavel === null) desconhecido.push(`preço: ${c.preco.motivo}`);
  if (c.regularizacao === 'nao_verificado') desconhecido.push('registro ANVISA não verificado');
  if (desconhecido.length) return { estado: 'escalar', motivos: desconhecido };

  if (c.restritivo || c.varianteNaoCoberta) {
    const motivo = c.restritivo ? 'especificação possivelmente restritiva (marca de referência ou compatibilidade)' : 'variante pedida não coberta pelo produto';
    if (c.prazoEsclarecimentoAberto === true) return { estado: 'esclarecer', motivos: [motivo, 'prazo de esclarecimento aberto'] };
    if (c.prazoEsclarecimentoAberto === null) return { estado: 'escalar', motivos: [motivo, 'prazo de esclarecimento desconhecido'] };
  }

  const nao: string[] = [];
  if (c.fit === 'nao_atende') nao.push('produto não atende à especificação');
  if (c.regularizacao === 'vencido' || c.regularizacao === 'nao_encontrado') nao.push(`registro ANVISA ${c.regularizacao.replace('_', ' ')}`);
  if (c.venceAntesEntrega) nao.push('registro ANVISA vence antes da entrega');
  if (c.preco.viavel === false) nao.push(`preço: ${c.preco.motivo}`);
  if (nao.length) return { estado: 'nao_disputar', motivos: nao };

  if (c.fit === 'nao_informado') {
    if (c.prazoEsclarecimentoAberto === true) return { estado: 'esclarecer', motivos: ['atributo exigido não informado na ficha', 'prazo de esclarecimento aberto'] };
    return { estado: 'escalar', motivos: ['atributo exigido não informado na ficha', c.prazoEsclarecimentoAberto === false ? 'prazo de esclarecimento vencido' : 'prazo de esclarecimento desconhecido'] };
  }

  const pend = c.docs.filter(x => PENDENTES.includes(x.status)).map(x => `${x.exigencia}: ${x.status.replaceAll('_', ' ')}`);
  if (c.cobertura === 'nao_comprovada') pend.push('confirmar que o registro ANVISA cobre o modelo ofertado');
  if (pend.length) return { estado: 'disputar_com_pendencia', motivos: pend };
  return { estado: 'disputar', motivos: ['atende, registro vigente, documentos em dia e preço dentro da estimativa'] };
}

type NewItemChecks = ContractItemChecks & { venceAntesEntrega?: boolean };

/** Aceita o contrato novo ({ estado, motivos }) e, até a migração do tools.ts, o formato antigo ({ decision, reasons }). */
export function decideItem(c: NewItemChecks): ItemDecision;
export function decideItem(c: LegacyItemChecks): { decision: Decision; reasons: string[] };
export function decideItem(c: any): any {
  return 'preco' in c ? decideContract(c) : decideLegacy(c);
}
