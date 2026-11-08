// Diff da errata, sem modelo: cada citação gravada na análise é conferida contra o texto novo, os itens do
// PNCP são comparados campo a campo, e preço/total/limite são recalculados pelo código. Só `citacao_orfa`
// volta ao agente. Estados combinados na #25: reaproveitada, recalculada, reavaliada (fase 2), citacao_orfa, ilegivel.
import { priceCheck, verifyQuote } from './rules.ts';
import { prazosDoPregao, type Prazo } from './prazos.ts';
import { instanteAbertura } from './act.ts';
import type { DecisionRow, FitRow, ItemRow, Politica, RequirementRow } from './contracts.ts';

export type EstadoDiff = 'reaproveitada' | 'recalculada' | 'reavaliada' | 'citacao_orfa' | 'ilegivel';
export type CampoItem = 'quantidade' | 'estimativa' | 'descricao' | 'sigiloso';
export type DiffItem = {
  item: number;
  mudancas: { campo: CampoItem; antes: unknown; depois: unknown }[];
  novo?: true; removido?: true;
  /** Estado da evidência técnica; null quando o item não tem encaixe gravado. `pendente_agente`: a citação
   *  não está no texto novo (ou não havia citação): não é reaproveitada nem órfã, o agente relê o item. */
  evidencia: EstadoDiff | 'pendente_agente' | null;
  motivo?: string;
  preco: null | { estado: 'reaproveitada' | 'recalculada'; produto: string; antes: number | null; depois: number | null;
    quantidade: number; total: number | null; viavel: boolean | null; motivo: string };
};
export type DiffExigencia = { tipo: string; citacao: string; estado: 'reaproveitada' | 'citacao_orfa' | 'ilegivel'; fonte?: { nome: string; url: string } };
export type DiffErrata = {
  tenderId: string; sintetico: boolean;
  /** Publicação observada, distinta da foto que autoriza o recheque. Ausente em diffs antigos/sintéticos. */
  publicacao?: { arquivosHash: string; abertura: string | null; observadoEm: string };
  /** Estável é o mesmo dia em Recife (o art. 164 conta dias). Hora diferente no mesmo dia é só informativa. */
  abertura: { antes: string | null; depois: string | null; estado: 'estavel' | 'mudou' | 'desconhecida'; horaMudou: boolean };
  itens: DiffItem[];
  exigencias: DiffExigencia[];
  /** Total dos itens em disputa com os preços recalculados; null se algum preço é desconhecido. */
  proposta: { total: number | null; limite: number; excedeLimite: boolean | null };
  contagem: Record<EstadoDiff, number>;
  /** Art. 55, §1º: errata que mexe em quantidade ou especificação sem a abertura andar. Decisão do humano. */
  prazoNaoReaberto: null | { artigo: 'art. 55, §1º'; itens: number[]; prazo: Prazo; acionavel: boolean };
  /** Itens afetados quando a abertura é desconhecida: não há prazo sustentado, a linha fica aguardando. */
  semAberturaConhecida: number[];
};
export type ItemPublicado = { numero: number; descricao: string; quantidade: number; valorEstimado: number | null; sigiloso: boolean };
export type TextoEdital = { nome: string; url: string; texto: string };
export type EntradaDiff = {
  tenderId: string; hoje: string; politica: Politica;
  /** Custo por produto do catálogo da empresa. */
  custos: Record<string, number>;
  sintetico?: boolean;
  antes: { abertura: string | null; itens: ItemRow[]; fits: FitRow[]; decisoes: DecisionRow[]; requisitos: RequirementRow[] };
  /** textos: null quando nenhum documento novo tem texto legível (ZIP, escaneado ou fonte fora do ar). */
  depois: { abertura: string | null; itens: ItemPublicado[]; textos: TextoEdital[] | null };
};

const EM_DISPUTA = new Set(['disputar', 'disputar_com_pendencia']);
const MUDA_PROPOSTA = new Set<CampoItem>(['quantidade', 'descricao']);
const centavos = (n: number) => Math.round(n * 100) / 100;

const diaRecife = (raw: string | null) => {
  const d = instanteAbertura(raw);
  return d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(d) : null;
};
const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Mesmo instante publicado (data e hora quando as duas têm hora). O monitor usa para notar a mudança. */
export function mesmaAbertura(a: string | null, b: string | null) {
  if (!a || !b) return a === b;
  const na = a.replace(' ', 'T'), nb = b.replace(' ', 'T');
  return na.length >= 16 && nb.length >= 16 ? na.slice(0, 16) === nb.slice(0, 16) : na.slice(0, 10) === nb.slice(0, 10);
}

function citacoesDoEncaixe(f: FitRow): string[] {
  const attrs = (f.atributos as { attributes?: { citacao_item?: unknown }[] } | null)?.attributes;
  // Uma citação faltando invalida o reaproveitamento do encaixe inteiro.
  return Array.isArray(attrs) ? attrs.map(a => typeof a?.citacao_item === 'string' ? a.citacao_item : '') : [];
}

export function diffErrata(e: EntradaDiff): DiffErrata {
  const antes = new Map(e.antes.itens.map(i => [i.numero, i]));
  const depois = new Map(e.depois.itens.map(i => [i.numero, i]));
  const numeros = [...new Set([...antes.keys(), ...depois.keys()])].sort((a, b) => a - b);
  const itens: DiffItem[] = [];

  for (const n of numeros) {
    const a = antes.get(n), d = depois.get(n);
    const fits = e.antes.fits.filter(f => f.item === n);
    const decisao = e.antes.decisoes.find(x => x.item === n);
    if (!a && d) { itens.push({ item: n, mudancas: [], novo: true, evidencia: d.descricao.trim() ? null : 'ilegivel', preco: null }); continue; }
    if (a && !d) { itens.push({ item: n, mudancas: [], removido: true, evidencia: null, motivo: 'item removido do pregão: a decisão anterior não vale', preco: null }); continue; }
    if (!a || !d) continue;

    const mudancas: DiffItem['mudancas'] = [];
    if (a.quantidade !== d.quantidade) mudancas.push({ campo: 'quantidade', antes: a.quantidade, depois: d.quantidade });
    if ((a.estimativa ?? null) !== (d.valorEstimado ?? null)) mudancas.push({ campo: 'estimativa', antes: a.estimativa, depois: d.valorEstimado });
    if (a.descricao !== d.descricao) mudancas.push({ campo: 'descricao', antes: a.descricao, depois: d.descricao });
    if (a.sigiloso !== d.sigiloso) mudancas.push({ campo: 'sigiloso', antes: a.sigiloso, depois: d.sigiloso });

    // Reaproveitar exige as duas coisas: descrição igual e cada citação ainda no texto (mínimo de 8 caracteres,
    // o mesmo do record_fit). Órfã é a citação que continua no texto com a descrição mudada.
    let evidencia: DiffItem['evidencia'] = null, motivo: string | undefined;
    if (!d.descricao.trim()) {
      evidencia = 'ilegivel';
      motivo = 'texto novo ilegível; não reaproveitar evidência nem liberar decisão';
    } else if (fits.length) {
      const igual = normal(a.descricao) === normal(d.descricao);
      const citacoes = fits.flatMap(citacoesDoEncaixe);
      const achadas = citacoes.filter(q => verifyQuote(q, d.descricao, 8).found);
      if (igual && citacoes.length && achadas.length === citacoes.length) evidencia = 'reaproveitada';
      else if (!igual && achadas.length) {
        evidencia = 'citacao_orfa';
        motivo = 'a descrição mudou e a citação antiga ainda aparece: reavaliar só este item com o trecho novo';
      } else {
        evidencia = 'pendente_agente';
        motivo = citacoes.length ? `citação do encaixe não está no texto novo ("${citacoes.find(q => !achadas.includes(q))}")`
          : 'não há citação gravada para reaproveitar';
      }
    }

    let preco: DiffItem['preco'] = null;
    const custo = decisao ? e.custos[decisao.produto] : undefined;
    if (decisao) {
      const mudouPreco = mudancas.some(m => m.campo !== 'descricao');
      if (!mudouPreco) {
        const total = decisao.precoProposto == null ? null : centavos(decisao.precoProposto * d.quantidade);
        preco = { estado: 'reaproveitada', produto: decisao.produto, antes: decisao.precoProposto, depois: decisao.precoProposto,
          quantidade: d.quantidade, total, viavel: decisao.precoProposto == null ? null : true, motivo: 'quantidade e estimativa sem mudança' };
      } else {
        const pc = custo == null || !Number.isFinite(custo) || custo < 0
          ? { viavel: null, precoProposto: null, motivo: 'custo do produto ausente ou inválido; escalar' }
          : priceCheck({ custo, margemMinima: e.politica.margemMinima, margemAlvo: e.politica.margemAlvo,
            estimativa: d.valorEstimado, sigiloso: d.sigiloso });
        preco = { estado: 'recalculada', produto: decisao.produto, antes: decisao.precoProposto, depois: pc.precoProposto,
          quantidade: d.quantidade, total: pc.precoProposto == null ? null : centavos(pc.precoProposto * d.quantidade),
          viavel: pc.viavel, motivo: pc.motivo };
      }
    }
    itens.push({ item: n, mudancas, evidencia, ...(motivo ? { motivo } : {}), preco });
  }

  const exigencias: DiffExigencia[] = e.antes.requisitos.map(r => {
    if (!e.depois.textos?.length) return { tipo: r.tipo, citacao: r.citacao, estado: 'ilegivel' };
    const fonte = e.depois.textos.find(t => verifyQuote(r.citacao, t.texto).found);
    return fonte ? { tipo: r.tipo, citacao: r.citacao, estado: 'reaproveitada', fonte: { nome: fonte.nome, url: fonte.url } }
      : { tipo: r.tipo, citacao: r.citacao, estado: 'citacao_orfa' };
  });

  // Total da proposta: itens em disputa que continuam no pregão. Qualquer preço desconhecido → total desconhecido.
  const emDisputa = e.antes.decisoes.filter(x => EM_DISPUTA.has(x.estado));
  const totais = emDisputa.map(x => itens.find(i => i.item === x.item)?.preco?.total ?? null);
  const total = emDisputa.length && totais.every(t => t !== null) ? centavos(totais.reduce((s, t) => s + t!, 0)) : null;
  const limite = e.politica.valorMaxAutomatico;

  const contagem: Record<EstadoDiff, number> = { reaproveitada: 0, recalculada: 0, reavaliada: 0, citacao_orfa: 0, ilegivel: 0 };
  for (const i of itens) {
    if (i.evidencia && i.evidencia !== 'pendente_agente') contagem[i.evidencia]++;
    if (i.preco?.estado === 'recalculada') contagem.recalculada++;
  }
  for (const x of exigencias) contagem[x.estado]++;

  const diaAntes = diaRecife(e.antes.abertura), diaDepois = diaRecife(e.depois.abertura);
  const estado = !diaAntes || !diaDepois ? 'desconhecida' as const : diaAntes === diaDepois ? 'estavel' as const : 'mudou' as const;
  const horaMudou = estado === 'estavel' && !mesmaAbertura(e.antes.abertura, e.depois.abertura);
  const afetados = itens.filter(i => i.novo || i.removido || i.mudancas.some(m => MUDA_PROPOSTA.has(m.campo))).map(i => i.item);
  let prazoNaoReaberto: DiffErrata['prazoNaoReaberto'] = null;
  if (estado === 'estavel' && afetados.length) {
    const prazo = prazosDoPregao({ abertura: e.depois.abertura, hoje: e.hoje }).find(p => p.acao === 'impugnacao')!;
    prazoNaoReaberto = { artigo: 'art. 55, §1º', itens: afetados, prazo, acionavel: prazo.data !== null && e.hoje <= prazo.data };
  }

  return {
    tenderId: e.tenderId, sintetico: e.sintetico === true,
    abertura: { antes: e.antes.abertura, depois: e.depois.abertura, estado, horaMudou },
    itens, exigencias, proposta: { total, limite, excedeLimite: total === null ? null : total > limite },
    contagem, prazoNaoReaberto, semAberturaConhecida: estado === 'desconhecida' ? afetados : [],
  };
}
