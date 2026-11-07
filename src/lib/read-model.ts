// Adapta leituras persistidas à API do Dev 3. Não executa regras, modelo ou envios.
import type { Action, CofreDoc, Decision, DecisionRow, Store } from './contracts.ts';
import { calendarioCofre } from './cofre.ts';
import type { buildDossie, DossierSource } from './dossie.ts';

export type ReadStore = Pick<Store, 'events' | 'openEscalations' | 'getTender' | 'getItems' | 'getDecisions' | 'getDossie' | 'resolveEscalation'>
  & Partial<Pick<Store, 'getTenders' | 'getRequirements'>>;
export type Proof = {
  fonte: string; avaliacoes: { nome: string; valor: string }[]; cenarios: { nome: string; resultado: string }[];
  concordancia: number | null; custoUsd: number | null; duracaoMs: number | null;
};
type Dossie = ReturnType<typeof buildDossie>;
const labels: Record<string, string> = { disputar: 'Disputar', disputar_com_pendencia: 'Com pendência', esclarecer: 'Em esclarecimento', escalar: 'Escalar', nao_disputar: 'Não disputar' };
const fitLabels: Record<string, string> = { atende: 'Atende', nao_atende: 'Não atende', nao_informado: 'Não informado' };
const localDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
function timestamp(raw: string | null | undefined) {
  if (!raw) return null;
  const withZone = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(raw) ? raw + (raw.length === 16 ? ':00' : '') + '-03:00' : raw;
  return Number.isFinite(Date.parse(withZone)) ? withZone : null;
}

export function createReadModel(store: ReadStore, options: {
  // Leitura explícita: não supor zero envios quando não há acesso a ações.
  actions: () => Action[]; now?: () => Date; proof?: () => Proof; origem?: 'amostra' | 'integrado';
  /** Cofre da empresa. Sem ele, ou sem getTenders/getRequirements, Hoje devolve cofre vazio. */
  cofre?: CofreDoc[];
}) {
  if (typeof options.actions !== 'function') throw new Error('forneça a leitura das ações confirmadas');
  const now = options.now ?? (() => new Date());
  function dossie(tender: string): Dossie | undefined {
    const value = store.getDossie(tender) as Dossie | undefined;
    if (!value || value.tender !== tender || !Array.isArray(value.checklist) || !Array.isArray(value.pendencias)
      || !Array.isArray(value.documentos) || !Array.isArray(value.itens)) return undefined;
    return structuredClone(value);
  }
  function queue(decision: DecisionRow) {
    const tender = store.getTender(decision.tenderId);
    const item = store.getItems(decision.tenderId).find(i => i.numero === decision.item);
    const prazo = timestamp(tender?.abertura);
    return { tender: decision.tenderId, pregao: decision.tenderId, item: String(decision.item),
      descricao: item?.descricao ?? '', orgao: tender?.orgao ?? 'Órgão não informado', prazo,
      prazoTipo: prazo ? 'sessao' as const : 'desconhecido' as const,
      estado: labels[decision.estado] ?? decision.estado, estadoCodigo: decision.estado, motivo: decision.motivos.join('; ') };
  }
  function selectedDecisions(tenderId?: string) {
    const groups = new Map<string, DecisionRow[]>();
    for (const decision of store.getDecisions(tenderId)) {
      const key = `${decision.tenderId}#${decision.item}`;
      groups.set(key, [...(groups.get(key) ?? []), decision]);
    }
    return [...groups.values()].map(rows => {
      if (rows.length === 1) return rows[0];
      const first = rows[0];
      const chosen = dossie(first.tenderId)?.itens.find(i => i.item === first.item)?.produto?.id;
      return rows.find(d => d.produto === chosen) ?? { ...first, produto: '', estado: 'escalar' as const, precoProposto: null,
        motivos: ['Há decisões para mais de um produto e nenhuma seleção explícita no dossiê.'] };
    });
  }
  function fila() { return selectedDecisions().map(queue); }
  function item(tender: string, number: string) {
    const decision = selectedDecisions(tender).find(d => String(d.item) === number);
    if (!decision) return undefined;
    const dossier = dossie(tender);
    const evidence = dossier?.itens.find(i => String(i.item) === number && i.produto?.id === decision.produto);
    const row = store.getItems(tender).find(i => String(i.numero) === number);
    const pncp = /^\d{14}\/\d{4}\/\d+$/.test(tender) ? `https://pncp.gov.br/app/editais/${tender}` : null;
    const fontes: DossierSource[] = [...(dossier?.documentos ?? [])];
    if (pncp) fontes.push({ nome: 'Publicação do pregão no PNCP', url: pncp });
    const anvisa = evidence?.anvisa;
    return { ...queue(decision),
      encaixe: (evidence?.atributos ?? []).map((a: any) => ({ atributo: a.atributo,
        exigido: a.exigido ?? a.citacao_item, ofertado: a.ofertado ?? a.citacao_ficha ?? 'Não informado',
        resultado: fitLabels[a.veredito] ?? 'Não verificado',
        ...(pncp && a.citacao_item ? { fonte: { nome: 'Descrição do item no PNCP', url: pncp, citacao: a.citacao_item } } : {}) })),
      fontes, anvisa: anvisa?.regularizacao
        ? `Regularização: ${anvisa.regularizacao}; cobertura do modelo: ${anvisa.cobertura ?? 'nao_comprovada'}.`
        : 'Regularização e cobertura do modelo não verificadas.',
      preco: decision.precoProposto, estimativa: row?.estimativa ?? null,
      rastro: store.events().filter(e => e.tender === tender && (!e.item || e.item === number)).flatMap(e => e.rastro ?? []),
      dossie: !!dossier,
    };
  }
  function escaladas() {
    return store.openEscalations().map(e => ({ ...e, pregao: e.tender, prazo: timestamp(e.prazo), prazoTipo: 'decisao_humana' as const, dossie: !!dossie(e.tender) }));
  }
  function hoje() {
    const day = localDay(now());
    const start = Date.parse(`${day}T00:00:00-03:00`); const end = start + 86400_000;
    const inDay = (iso: string) => Date.parse(iso) >= start && Date.parse(iso) < end;
    const events = store.events({ desde: new Date(start).toISOString() }).filter(e => inDay(e.horario));
    const decided = new Set(events.filter(e => e.tipo === 'decisao' && e.tender && e.item).map(e => `${e.tender}#${e.item}`));
    const decisions = selectedDecisions().filter(d => decided.has(`${d.tenderId}#${d.item}`));
    const actions = new Map(options.actions().map(a => [a.key, a]));
    const confirmed = [...actions.values()].filter(a => a.status === 'confirmada' && a.verificado === true && !!a.protocolo && inDay(a.atualizadaEm));
    const counts = new Map<string, number>();
    for (const decision of decisions) counts.set(decision.estado, (counts.get(decision.estado) ?? 0) + 1);
    const calls = events.flatMap(e => e.rastro ?? []).filter(t => t.ferramenta === 'llm' || t.ferramenta.startsWith('llm:'));
    const custoUsd = calls.length && calls.every(c => typeof c.custoUsd === 'number' && Number.isFinite(c.custoUsd))
      ? calls.reduce((sum, c) => sum + c.custoUsd!, 0) : null;
    const cofre = !options.cofre?.length || !store.getTenders || !store.getRequirements ? [] : calendarioCofre(options.cofre,
      store.getTenders().filter(t => t.abertura).map(t => ({ tenderId: t.id, sessao: t.abertura!.slice(0, 10),
        exigencias: store.getRequirements!(t.id).map(r => ({ tipo: r.tipo, citacao: r.citacao })) })), day).map(alerta => ({
      ...alerta,
      pregoes: alerta.pregoes.map(pregao => dossie(pregao.tenderId) ? { ...pregao, dossie: true } : pregao),
    }));
    return { data: day, pregoes: new Set(decisions.map(d => d.tenderId)).size, itens: decisions.length,
      disputar: counts.get('disputar') ?? 0, pendencias: counts.get('disputar_com_pendencia') ?? 0,
      envios: confirmed.length, escaladasAbertas: store.openEscalations().length, custoUsd,
      porDecisao: [...counts].map(([estado, quantidade]) => ({ estado: labels[estado] ?? estado, quantidade })),
      eventos: [...events].sort((a, b) => Date.parse(a.horario) - Date.parse(b.horario)), cofre,
    };
  }
  return {
    origem: options.origem ?? 'integrado', hoje, fila, item, dossie, escaladas,
    prova: (): Proof => options.proof ? structuredClone(options.proof()) : {
      fonte: 'Nenhum relatório de avaliação foi integrado a esta execução.', avaliacoes: [], cenarios: [],
      concordancia: null, custoUsd: null, duracaoMs: null,
    },
    decidir: (id: string, decision: Decision) => store.resolveEscalation(id, decision),
  };
}
