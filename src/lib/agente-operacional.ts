import { runAgent, type RunOpts, type TraceEvent, type LLM } from './agent.ts';
import type { LanceState } from './tools.ts';
import { aplicarOperacao, buscarCondicoesOperacionais, fontesOperacionais } from './operacao.ts';

export const SYSTEM_OPERACIONAL = 'Você registra condições operacionais de um edital já consultado. Você só tem uma ferramenta de registro e no máximo duas rodadas. Registre agora as cláusulas sustentadas pelos trechos, em chamadas independentes na mesma rodada. Copie literalmente, sem juntar trechos separados ou remover rodapés no meio da citação. Não procure outros arquivos. Inclua o marco de contagem e as condições. Não confunda validade de produto com assinatura, ata, proposta ou registro ANVISA. Informe item somente quando o texto delimitar aquele item; cláusula geral fica sem item. Se não houver evidência suficiente, não registre. Ao terminar, encerre sem sugerir preço, decisão ou data.';

/** Completa a análise com uma revisão curta, sem busca externa e sem ferramentas de preço ou envio. */
export async function runAgentWithOperationalReview(o: Omit<RunOpts, 'state'> & { state: LanceState; operationalLLM?: LLM }) {
  const inicio = performance.now();
  o.state.operationalConditions ??= {};
  const result = await runAgent(o);
  if (!result.trace.filter(e => e.type === 'llm').every(e => typeof e.usage?.cost === 'number')) result.usage.cost = undefined;
  const registrar = o.tools.find(t => t.name === 'record_operational_condition');
  let restante = (o.maxTokens ?? 400_000) - result.usage.prompt_tokens - result.usage.completion_tokens;
  if (result.stopped === 'final' && registrar) {
    for (const tender of Object.keys(o.state.tenders)) {
      const docs = fontesOperacionais(o.state, tender);
      const candidatos = buscarCondicoesOperacionais(docs);
      if (!candidatos.trechos.length || restante < 100) continue;
      const revisaoInicio = performance.now();
      o.onToolStart?.('review_operational_conditions');
      try {
        const revisao = await runAgent({
          llm: o.operationalLLM ?? o.llm, state: o.state, tools: [registrar], maxSteps: 2, maxTokens: Math.min(25_000, restante),
          system: SYSTEM_OPERACIONAL,
          user: `Pregão ${tender}. Trechos candidatos, ainda não confirmados:\n${JSON.stringify(candidatos)}\nRegistre o que encontrar com campo entrega, fornecimento, amostra, validade_produto ou pagamento. A ferramenta confere a citação e o código compara capacidade.`,
          onToolStart: o.onToolStart, onEvent: o.onEvent,
        });
        restante -= revisao.usage.prompt_tokens + revisao.usage.completion_tokens;
        result.usage.prompt_tokens += revisao.usage.prompt_tokens;
        result.usage.completion_tokens += revisao.usage.completion_tokens;
        const custoRevisaoConhecido = revisao.trace.filter(e => e.type === 'llm').every(e => typeof e.usage?.cost === 'number');
        result.usage.cost = result.usage.cost !== undefined && custoRevisaoConhecido ? result.usage.cost + (revisao.usage.cost ?? 0) : undefined;
        result.trace.push(...revisao.trace);
      } catch {
        // A evidência faltante continua pendente; falha do provedor não apaga o encaixe técnico já obtido.
        const evento: TraceEvent = { type: 'tool', name: 'review_operational_conditions', error: true,
          result: { erro: 'Não foi possível concluir a extração operacional. Condições sem evidência exigem confirmação.' },
          ms: performance.now() - revisaoInicio, t: performance.now() - inicio };
        result.trace.push(evento); o.onEvent?.(evento); result.usage.cost = undefined;
      }
    }
  }
  for (const tender of Object.keys(o.state.tenders)) aplicarOperacao(o.state, tender);
  return { ...result, ms: performance.now() - inicio };
}
