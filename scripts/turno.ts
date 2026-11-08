import './_out.ts';
// E2E: turno do digital worker com o modelo REAL sobre dados REAIS.
// Uso: node scripts/turno.ts [focado|autonomo] [modelo]
// Fase 1: o agente trabalha sozinho até request_approval. Aprovação: feita por este script no papel do humano (registrado no rastro).
// Fase 2: o agente envia ao portal sandbox e verifica.
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { featherless } from '../src/lib/llm.ts';
import { runAgent } from '../src/lib/agent.ts';
import { tools, newState } from '../src/lib/tools.ts';
import { startSandbox } from '../src/lib/sandbox.ts';
import { openStore } from '../src/lib/store.ts';

const mode = process.argv[2] ?? 'focado';
const model = process.argv[3] ?? 'moonshotai/Kimi-K2.6';
const company = JSON.parse(readFileSync('fixtures/company.json', 'utf8'));
const cov = JSON.parse(readFileSync('fixtures/coverage.json', 'utf8'));
const tag = `${mode}-${model.replace('/', '_')}-${Date.now()}`;
const traceFile = `out/turno-${tag}.jsonl`;
const sbx = await startSandbox(0);
const store = openStore();
const st = newState(company, sbx.url, new Date());
st.store = store;
if (mode === 'focado') for (const c of cov) st.tenders[`${c.cnpj}/${c.ano}/${c.seq}`] = c;
const llm = featherless(model);
const onEvent = (e: any) => { appendFileSync(traceFile, JSON.stringify(e) + '\n'); if (e.type === 'tool') console.log(`  [${(e.t / 1000).toFixed(0)}s] ${e.error ? '✗' : '✓'} ${e.name} ${JSON.stringify(e.args).slice(0, 110)}`); };

const SYSTEM = `Você é o Lance, um digital worker: analista de licitações da ${company.empresa.nome}, ${company.empresa.porte}, que vende produtos para saúde a órgãos públicos.
Seu papel: todo dia, encontrar itens de pregões abertos que o catálogo da empresa pode atender e deixar o trabalho pronto para o humano só aprovar.
Regras:
- Use ferramentas para tudo; nunca invente dados, preços, registros ou citações. Citações são cópias literais.
- get_tender_items é paginado: siga proxima_pagina para não perder candidatos. Se descricao_truncada, use get_tender_item e siga proximo_offset até null para ler o item inteiro antes de comparar.
- record_fit não aceita lista vazia. Citação existente não prova conclusão correta nem cobertura completa: registre todos os atributos exigidos, use nao_informado para lacunas e não apresente cobertura não verificada como certificação.
- Para cada item promissor: confira o encaixe técnico atributo a atributo (record_fit), escolha o catalog_code certo (o do item; se faltar ou se o texto do órgão descrever outro produto, use find_catalog_codes e escolha o melhor) e chame decide_item. O preço e a decisão vêm do decide_item, não de você.
- Leia o edital (read_edital) e registre exigências relevantes com citação: registro_anvisa, afe, amostra, marca_referencia e prazo_esclarecimento.
- Se o texto do item ou do edital indicar marca de referência, ou o histórico mostrar uma marca dominante, use flag_restrictive e redija um esclarecimento (draft_esclarecimento) respeitando o prazo.
- Só para pregão em que decide_item deu disputar ou disputar_com_pendencia: abra os documentos com read_proposal_docs, registre com record_proposal_rule as regras de apresentação da proposta (comece pelos trechos pré-selecionados; leia o modelo de proposta com read_proposal_excerpt; no máximo 8 leituras) e monte o documento com draft_proposal_document. Registre com record_document_requirement cada documento exigido que as regras da proposta não cobrem (certidões, AFE, licença sanitária, contrato social, balanço, atestado, comprovante de distribuidor), com fase, condição e prazo do trecho, e monte o plano com draft_document_plan. Pregão sem item viável não tem proposta nem plano.
- Exceções: se uma ferramenta falhar, tente de novo uma vez e siga em frente registrando a pendência. Não analise itens sem produto compatível no catálogo.
- Resultados antigos de ferramenta são resumidos no histórico. Se faltar uma citação, chame a ferramenta de novo.
- Ao terminar, chame request_approval com um resumo curto (itens, decisão, preço, pendências, esclarecimentos, pendências do documento da proposta e do plano de documentos) e ENCERRE.`;

const USER = mode === 'focado'
  ? `Turno de ${new Date().toLocaleDateString('pt-BR')}. Analise estes pregões abertos: 77816510000166/2026/348, 03648344000108/2026/14 e 80257355000108/2026/493. Comece por list_catalog.`
  : `Turno de ${new Date().toLocaleDateString('pt-BR')}. Encontre pregões abertos relevantes para o catálogo (no máximo 3 pregões, priorize os com mais itens compatíveis) e faça o trabalho completo. Comece por list_catalog.`;

console.log(`# Turno ${mode} com ${model}`);
const p1 = await runAgent({ llm, tools, system: SYSTEM, user: USER, maxSteps: 45, maxTokens: 900_000, state: st as any, onEvent });
const approvalId = Object.keys(st.approvals)[0];
console.log('\n# Fase 1:', p1.stopped, `${(p1.ms / 1000).toFixed(0)}s`, p1.usage, 'aprovação:', approvalId ?? 'NÃO PEDIU');
console.log(p1.final?.slice(0, 1500));

let p2: any = null;
if (approvalId) {
  appendFileSync(traceFile, JSON.stringify({ type: 'human', text: `aprovação ${approvalId} concedida pelo script de teste (papel do humano)` }) + '\n');
  const history = [...p1.messages, { role: 'user', content: `A política decide o envio; approval_id não autoriza. Para cada pregão, chame submit_proposal com tender_id e os números dos itens já decididos. Para cada rascunho, chame send_esclarecimento com tender_id, item e motivo (nao_informado, variante_nao_coberta ou marca_referencia). Depois confira com verify_submission e resuma.` }];
  p2 = await runAgent({ llm, tools, system: SYSTEM, user: '', history, maxSteps: 15, state: st as any, approvals: new Set([approvalId]), onEvent });
  console.log('\n# Fase 2:', p2.stopped, `${(p2.ms / 1000).toFixed(0)}s`, p2.usage);
  console.log(p2.final?.slice(0, 1200));
}
const PRICE: Record<string, [number, number]> = { 'moonshotai/Kimi-K2.6': [0.80, 3.40], 'deepseek-ai/DeepSeek-V4-Flash': [0.14, 0.28] }; // US$/M tokens (pesquisa anterior; conferir)
const u = { in: p1.usage.prompt_tokens + (p2?.usage.prompt_tokens ?? 0), out: p1.usage.completion_tokens + (p2?.usage.completion_tokens ?? 0) };
const pr = PRICE[model]; const usd = pr ? (u.in * pr[0] + u.out * pr[1]) / 1e6 : null;
const summary = {
  mode, model, approvalId, phase1: { stopped: p1.stopped, s: Math.round(p1.ms / 1000), usage: p1.usage }, phase2: p2 && { stopped: p2.stopped, s: Math.round(p2.ms / 1000), usage: p2.usage },
  tokens: u, usd_estimado: usd, usd_real: (p1.usage.cost ?? 0) + (p2?.usage.cost ?? 0), tools_ok: [...p1.trace, ...(p2?.trace ?? [])].filter((e: any) => e.type === 'tool' && !e.error && e.result?.aceito !== false).length,
  tools_erro: [...p1.trace, ...(p2?.trace ?? [])].filter((e: any) => e.type === 'tool' && (e.error || e.result?.aceito === false)).length,
  requirements: st.requirements, fits: Object.fromEntries(Object.entries(st.fits).map(([k, v]: any) => [k, `${v.product_id}: ${v.overall}`])),
  decisions: Object.fromEntries(Object.entries(st.decisions).map(([k, v]: any) => [k, { decision: v.decision, product: v.product_id, code: v.catalog_code, preco: v.preco_sugerido, reasons: v.reasons, pendencias: v.docs_vencidos }])),
  restrictive: st.restrictive, drafts: st.drafts, submissions: st.submissions,
  propostas: Object.fromEntries(Object.entries(st.proposals ?? {}).map(([k, v]) => [k, { regras: st.proposalRules?.[k]?.length ?? 0, total: v.total, pendencias: v.pendencias, lacunas: v.lacunas }])),
  planos: Object.fromEntries(Object.entries(st.documentPlans ?? {}).map(([k, v]) => [k, { resumo: v.resumo, pendencias: v.pendencias }])), sandbox: { propostas: [...sbx.propostas.keys()], esclarecimentos: sbx.esclarecimentos.length },
};
writeFileSync(`out/turno-${tag}.summary.json`, JSON.stringify(summary, null, 1));
for (const [id, doc] of Object.entries(st.proposals ?? {})) writeFileSync(`out/turno-${tag}.proposta-${id.replaceAll('/', '-')}.md`, doc.markdown);
console.log('\n# RESUMO', JSON.stringify(summary, null, 1).slice(0, 4000));
store.close();
sbx.close();
