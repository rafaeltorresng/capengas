// Entrada da demonstração: somente fixtures preparadas. A análise usa o mesmo agente e store do produto.
import { randomUUID } from 'node:crypto';
import { type LLM, type Tool } from '../lib/agent.ts';
import { runAgentWithOperationalReview as runAgent } from '../lib/agente-operacional.ts';
import { tools, newState } from '../lib/tools.ts';
import { acompanhamentoDe, runAnalysisTurn } from '../lib/turn.ts';
import { atividadeDaFerramenta } from '../lib/turnos.ts';
import { resolverPregoesSolicitados, type DemoSelecao } from '../lib/agendamento.ts';
import { snapshotTender } from '../lib/recheck.ts';
import { featherless } from '../lib/llm.ts';
import { createReadModel } from '../lib/read-model.ts';
import { INSTRUCAO_OPERACIONAL } from '../lib/operacao.ts';
import type { LanceStore } from '../lib/store.ts';
import type { CofreDoc, Politica } from '../lib/contracts.ts';

export type DemoCompany = {
  empresa: { nome: string; porte: string; atuacao?: string; uf: string; margemMinima: number; prazoEntregaDias: number };
  catalogo: { id: string; nome: string; marca: string; registroAnvisa: string; custo: number; ficha: string; termos: string[] }[];
  cofre: CofreDoc[]; politica: Politica;
};
export type PreparedDemo = Omit<DemoSelecao, 'pregoes'> & { geradoEm: string; pregoes: {
  id: string; orgao: string; uf: string; municipio?: string; abertura: string | null; situacao: string; url: string;
  matches: { item: number; produto: string; descricao: string }[];
}[] };
export type OnboardingData = {
  empresa: DemoCompany['empresa']; arquivo: string;
  produtos: Pick<DemoCompany['catalogo'][number], 'id' | 'nome' | 'marca' | 'registroAnvisa'>[];
  geradoEm: string; pregoes: PreparedDemo['pregoes'];
  analise: { disponivel: boolean; motivo: string | null };
};
export type AnalysisStarted = { tenderId: string; turno: string };
export class OnboardingError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const permitidas = new Set(['list_catalog', 'get_product_sheet', 'get_tender_items', 'get_tender_item', 'read_edital',
  'record_requirement', 'record_fit', 'check_anvisa', 'decide_item', 'flag_restrictive', 'draft_esclarecimento',
  'read_proposal_docs', 'read_proposal_excerpt', 'record_proposal_rule', 'draft_proposal_document', 'record_document_requirement', 'draft_document_plan', 'record_operational_condition', 'read_operational_excerpt']);

export async function runOnboardingAnalysis(o: AnalysisStarted & {
  company: DemoCompany; demo: PreparedDemo; store: LanceStore;
  llm?: () => LLM; ferramentas?: Tool[]; snapshot?: (id: string, store: LanceStore) => Promise<unknown>; now?: () => Date;
}) {
  if (!o.demo.pregoes.some(p => p.id === o.tenderId)) throw new OnboardingError(400, 'Escolha um edital da lista preparada.');
  const state = newState(o.company, 'http://127.0.0.1:9', (o.now ?? (() => new Date()))());
  // Sem a lista, o modelo procura às cegas: na execução real depois-2941 foram 26 chamadas em 235 itens sem nenhum encaixe.
  const matches = o.demo.pregoes.find(p => p.id === o.tenderId)?.matches ?? [];
  const candidatos = matches.length
    ? ` Candidatos do pré-filtro por termos do catálogo, que não comprova encaixe: itens ${matches.map(m => `${m.item} (${m.produto})`).join(', ')}. Comece por eles. Para cada candidato que analisar, registre o encaixe com record_fit (também quando não atende, com as citações da divergência) e calcule decide_item: descarte só no resumo não vale como decisão. Não procure indefinidamente outros itens.`
    : '';
  state.tenders = resolverPregoesSolicitados([o.tenderId], [], o.demo);
  return runAnalysisTurn({ store: o.store, state, origem: 'direto', acompanhar: true, turnoId: o.turno,
    snapshot: o.snapshot ?? snapshotTender,
    run: () => {
      const llm = (o.llm ?? featherless)();
      return runAgent({ llm, operationalLLM: o.llm ? llm : featherless(undefined, { maxTokens: 8192 }), tools: (o.ferramentas ?? tools).filter(t => permitidas.has(t.name)), state, maxSteps: 30, maxTokens: 250_000,
        system: 'Você é o Lance. Analise somente o pregão solicitado. Use citações literais, nunca invente dados. Liste o catálogo, filtre itens relevantes, siga proxima_pagina e proximo_offset. Leia o edital, registre exigências e compare atributos com as fichas. Use nao_informado para lacunas. Calcule decisões com decide_item. Se houver marca de referência, use flag_restrictive; para dúvida técnica sustentada, prepare draft_esclarecimento. Somente depois de decide_item resultar em disputar ou disputar_com_pendencia: use read_proposal_docs para ler os documentos; registre as regras com record_proposal_rule, cada documento exigido com record_document_requirement (fase, condição e prazo citados), prepare draft_proposal_document e draft_document_plan. Campos ausentes continuam pendências; não invente dados cadastrais ou declarações de conformidade. Não gere proposta para item escalado ou incompatível. Não envie nada. Empresa, catálogo, fichas, custos, cofre e política são sintéticos de demonstração; dados dos pregões são reais. Limite a análise a 3 itens relevantes no total. O pré-filtro aponta candidatos, não comprova encaixe. Resultados antigos de ferramenta são resumidos no histórico; se faltar uma citação, chame a ferramenta de novo.' + ' ' + INSTRUCAO_OPERACIONAL,
        user: `Analise o pregão ${o.tenderId} e termine com um resumo do que ficou pronto e das pendências.${candidatos}`,
        onToolStart: name => acompanhamentoDe(state)?.atividade(atividadeDaFerramenta(name), name),
        onEvent: e => {
          if (e.type === 'tool') {
            const r = e.result as { aceito?: boolean; error?: unknown; erro?: unknown } | undefined;
            acompanhamentoDe(state)?.resultado(!e.error && r?.aceito !== false && !r?.error && !r?.erro);
          }
          o.store.logEvent({ tipo: 'analise_item', tender: o.tenderId,
            resumo: e.type === 'llm' ? 'Chamada ao modelo' : `${e.type}: ${e.name ?? e.text ?? ''}`,
            rastro: [{ ferramenta: e.type === 'llm' ? `llm:${llm.model}` : e.name ?? e.type,
              entrada: e.args === undefined ? undefined : JSON.stringify(e.args), saida: e.result === undefined ? e.text : JSON.stringify(e.result),
              ms: e.ms, custoUsd: e.usage?.cost }] });
        },
      });
    },
  });
}

export function createOnboarding(o: {
  company: DemoCompany; demo: PreparedDemo; store?: LanceStore; disponivel: boolean;
  executar?: (job: AnalysisStarted) => Promise<unknown>;
}) {
  let active: AnalysisStarted | undefined;
  const disponivel = !!o.store && o.disponivel;
  const motivo = disponivel ? null : 'Análise ao vivo indisponível. É necessário o modo integrado com a chave do modelo configurada no servidor.';
  const data: OnboardingData = {
    empresa: { nome: o.company.empresa.nome, porte: o.company.empresa.porte, atuacao: o.company.empresa.atuacao, uf: o.company.empresa.uf,
      margemMinima: o.company.empresa.margemMinima, prazoEntregaDias: o.company.empresa.prazoEntregaDias },
    arquivo: 'catalogo-distribuidora.xlsx', geradoEm: o.demo.geradoEm,
    produtos: o.company.catalogo.map(({ id, nome, marca, registroAnvisa }) => ({ id, nome, marca, registroAnvisa })),
    pregoes: o.demo.pregoes.map(p => ({ id: p.id, orgao: p.orgao, uf: p.uf, municipio: p.municipio, abertura: p.abertura,
      situacao: p.situacao, url: p.url, matches: p.matches.map(({ item, produto, descricao }) => ({ item, produto, descricao })) })),
    analise: { disponivel, motivo },
  };
  return {
    dados: () => structuredClone(data),
    iniciar(tenderId: string): AnalysisStarted {
      if (!data.pregoes.some(p => p.id === tenderId)) throw new OnboardingError(400, 'Escolha um edital da lista preparada.');
      if (!disponivel) throw new OnboardingError(503, motivo!);
      if (active) {
        if (active.tenderId === tenderId) return { ...active };
        throw new OnboardingError(409, 'Uma análise está em andamento. Acompanhe a execução antes de iniciar outro edital.');
      }
      const running = createReadModel(o.store!, { actions: () => o.store!.getActions() }).turnos().turnos
        .some(t => t.status === 'ativo' || t.status === 'sem_atualizacao');
      if (running) throw new OnboardingError(409, 'Há um turno em andamento ou sem confirmação de término. Confira o Acompanhamento antes de iniciar outro edital.');
      const job = { tenderId, turno: randomUUID() };
      active = job;
      // A tarefa continua no servidor; o navegador passa a ler o progresso já persistido pelo turno.
      void Promise.resolve().then(() => o.executar ? o.executar(job) : runOnboardingAnalysis({ ...job, company: o.company, demo: o.demo, store: o.store! }))
        .catch(() => { o.store!.logEvent({ tipo: 'erro_fonte', tender: tenderId, resumo: 'A análise ao vivo falhou; confira o acompanhamento. Nenhum envio foi executado.' }); })
        .finally(() => { active = undefined; });
      return { ...job };
    },
  };
}
export type Onboarding = ReturnType<typeof createOnboarding>;
