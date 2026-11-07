// Regras determinísticas: tudo que pode ser verificado fica no código, não no modelo.

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

export function checkAnvisa(row: AnvisaRow | undefined, o: { today: Date; deliveryBy: Date }) {
  if (!row) return { status: 'nao_encontrado' as AnvisaStatus, validUntil: null, classe: null };
  const classe = row.CLASSE_RISCO ?? null;
  const raw = row.VALIDADE_REGISTRO_CADASTRO;
  if (raw === 'VIGENTE') return { status: 'ok' as AnvisaStatus, validUntil: null, classe };
  const validUntil = parseBrDate(raw);
  if (!validUntil) return { status: 'nao_encontrado' as AnvisaStatus, validUntil: null, classe };
  if (validUntil < ymd(o.today)) return { status: 'vencido' as AnvisaStatus, validUntil, classe };
  if (validUntil < ymd(o.deliveryBy)) return { status: 'vence_antes_entrega' as AnvisaStatus, validUntil, classe };
  return { status: 'ok' as AnvisaStatus, validUntil, classe };
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

export type ItemChecks = {
  fit: 'atende' | 'nao_atende' | 'nao_informado';
  anvisa: AnvisaStatus;
  price: { ok: boolean; reason?: string };
  docsOk: boolean;
  restrictive: boolean;
};
export type Decision = 'ofertar' | 'ofertar_com_pendencia' | 'nao_ofertar' | 'escalar';

export function decideItem(c: ItemChecks): { decision: Decision; reasons: string[] } {
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
