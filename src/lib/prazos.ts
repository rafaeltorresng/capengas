// Calendário legal do pregão (Lei 14.133, texto consolidado do Planalto). Só calcula a partir de fato
// publicado (abertura, ata); o que depende de fato ainda não visto fica `aguardando`, sem data inventada.
// Feriados: só os nacionais (rules.ts). Feriado local nunca é conferido aqui: a pauta lembra o humano.
import { ANOS_COM_FERIADOS, isBusinessDay } from './rules.ts';

/** De onde vem cada linha da pauta (combinado na #25). */
export type Origem = 'publicado' | 'calculado' | 'aguardando' | 'informado_cliente';
export type AcaoPrazo = 'esclarecimento' | 'impugnacao' | 'recurso_intencao' | 'recurso_razoes' | 'contrarrazoes'
  | 'assinatura' | 'publicacao_contrato' | 'vigencia_ata' | 'pagamento';
export type Prazo = {
  acao: AcaoPrazo;
  /** A data que o produto sustenta (AAAA-MM-DD); null quando aguarda um fato publicado. */
  data: string | null;
  origem: Origem;
  base: 'lei' | 'edital';
  artigo?: string;
  /** Trecho do edital sobre o prazo, quando a análise gravou um. */
  citacao?: string;
  calendario: 'nacional' | 'local_conferido' | 'local_nao_conferido';
  /** As duas datas lado a lado quando lei e edital divergem. */
  divergencia?: { lei: string; edital: string };
  fonte?: { nome: string; url: string };
  descricao: string;
};

const DIA = 86400_000;
const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Soma (n > 0) ou subtrai (n < 0) dias úteis, pulando fim de semana e feriado nacional. */
export function diasUteis(data: string, n: number): string {
  let cur = new Date(data.slice(0, 10) + 'T12:00:00Z');
  const passo = n < 0 ? -DIA : DIA;
  for (let count = 0; count < Math.abs(n);) {
    cur = new Date(cur.getTime() + passo);
    if (isBusinessDay(ymd(cur))) count++;
  }
  return ymd(cur);
}

/** Primeira data dd/mm/aaaa citada no trecho do edital; null se o trecho não traz data. */
export function dataDaCitacao(citacao: string | null | undefined): string | null {
  const m = /\b(\d{2})\/(\d{2})\/(\d{4})\b/.exec(citacao ?? '');
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return Number.isFinite(Date.parse(iso + 'T12:00:00Z')) && ymd(new Date(iso + 'T12:00:00Z')) === iso ? iso : null;
}

const anosCobertos = (...datas: string[]) => datas.every(d => ANOS_COM_FERIADOS.has(Number(d.slice(0, 4))));

export type EntradaPrazos = {
  /** Abertura publicada (AAAA-MM-DD ou AAAA-MM-DDTHH:MM). */
  abertura: string | null;
  hoje: string;
  /** Citação gravada pela análise para o prazo de esclarecimento (exigência `prazo_esclarecimento`). */
  prazoEditalCitacao?: string | null;
  /** Ata da sessão vista no PNCP: começa a contar o prazo das razões de recurso. */
  ataSessao?: { data: string; url: string } | null;
};

/** Prazos da preparação à sessão. Os do pós-vitória (assinatura, contrato, ata, pagamento) são da fase 3. */
export function prazosDoPregao(e: EntradaPrazos): Prazo[] {
  const cal = 'local_nao_conferido' as const;
  const abertura = e.abertura && /^\d{4}-\d\d-\d\d/.test(e.abertura) ? e.abertura.slice(0, 10) : null;
  const aguardando = (acao: AcaoPrazo, artigo: string, descricao: string): Prazo =>
    ({ acao, data: null, origem: 'aguardando', base: 'lei', artigo, calendario: cal, descricao });
  const semCalendario = (acao: AcaoPrazo, artigo: string, ano: string) =>
    aguardando(acao, artigo, `feriados nacionais de ${ano} não carregados: prazo não calculado`);

  const out: Prazo[] = [];
  // Art. 164: esclarecimento e impugnação até 3 dias úteis antes da abertura.
  for (const acao of ['esclarecimento', 'impugnacao'] as const) {
    const nome = acao === 'esclarecimento' ? 'pedido de esclarecimento' : 'impugnação do edital';
    if (!abertura) { out.push(aguardando(acao, 'art. 164', `${nome}: abertura não publicada`)); continue; }
    if (!anosCobertos(abertura)) { out.push(semCalendario(acao, 'art. 164', abertura.slice(0, 4))); continue; }
    const lei = diasUteis(abertura, -3);
    const p: Prazo = { acao, data: lei, origem: 'calculado', base: 'lei', artigo: 'art. 164', calendario: cal,
      descricao: `${nome} até 3 dias úteis antes da abertura` };
    if (acao === 'esclarecimento' && e.prazoEditalCitacao) {
      p.citacao = e.prazoEditalCitacao;
      const edital = dataDaCitacao(e.prazoEditalCitacao);
      if (edital && edital !== lei) {
        p.divergencia = { lei, edital };
        // Agir pela mais cedo nunca perde o prazo; a outra fica visível na divergência.
        if (edital < lei) { p.data = edital; p.base = 'edital'; }
      }
    }
    out.push(p);
  }
  // Art. 165, §1º, I: intenção de recorrer manifestada imediatamente, na sessão.
  out.push(abertura
    ? { acao: 'recurso_intencao', data: abertura, origem: 'calculado', base: 'lei', artigo: 'art. 165, §1º, I', calendario: cal,
      descricao: 'intenção de recorrer: imediata, na sessão, sob pena de preclusão' }
    : aguardando('recurso_intencao', 'art. 165, §1º, I', 'intenção de recorrer: abertura não publicada'));
  // Art. 165, I: razões em 3 dias úteis da intimação ou da lavratura da ata.
  const ata = e.ataSessao?.data && /^\d{4}-\d\d-\d\d/.test(e.ataSessao.data) ? e.ataSessao : null;
  if (!ata) out.push(aguardando('recurso_razoes', 'art. 165, I', 'razões de recurso: aguardando a ata da sessão'));
  else if (!anosCobertos(ata.data)) out.push(semCalendario('recurso_razoes', 'art. 165, I', ata.data.slice(0, 4)));
  else out.push({ acao: 'recurso_razoes', data: diasUteis(ata.data, 3), origem: 'calculado', base: 'lei', artigo: 'art. 165, I',
    calendario: cal, fonte: { nome: 'Ata da sessão no PNCP', url: ata.url }, descricao: 'razões de recurso: 3 dias úteis da ata' });
  // Art. 165, §4º: contrarrazões no mesmo prazo, a contar da divulgação da interposição.
  out.push(aguardando('contrarrazoes', 'art. 165, §4º', 'contrarrazões: aguardando recurso interposto'));
  return out;
}
