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

const mode = process.argv[2] ?? 'focado';
const model = process.argv[3] ?? 'moonshotai/Kimi-K2.6';
const company = JSON.parse(readFileSync('fixtures/company.json', 'utf8'));
const cov = JSON.parse(readFileSync('fixtures/coverage.json', 'utf8'));
const tag = `${mode}-${model.replace('/', '_')}-${Date.now()}`;
const traceFile = `out/turno-${tag}.jsonl`;
const sbx = await startSandbox(0);
const st = newState(company, sbx.url, new Date());
if (mode === 'focado') for (const c of cov) st.tenders[`${c.cnpj}/${c.ano}/${c.seq}`] = c;
const llm = featherless(model);
const onEvent = (e: any) => { appendFileSync(traceFile, JSON.stringify(e) + '\n'); if (e.type === 'tool') console.log(`  [${(e.t / 1000).toFixed(0)}s] ${e.error ? '✗' : '✓'} ${e.name} ${JSON.stringify(e.args).slice(0, 110)}`); };

const SYSTEM = `Você é o Lance, um digital worker: analista de licitações da ${company.empresa.nome}, ${company.empresa.porte}, que vende produtos para saúde a órgãos públicos.
Seu papel: todo dia, encontrar itens de pregões abertos que o catálogo da empresa pode atender e deixar o trabalho pronto para o humano só aprovar.
Regras:
- Use ferramentas para tudo; nunca invente dados, preços, registros ou citações. Citações são cópias literais.
- Para cada item promissor: confira o encaixe técnico atributo a atributo (record_fit), escolha o catalog_code certo (o do item; se faltar ou se o texto do órgão descrever outro produto, use find_catalog_codes e escolha o melhor) e chame decide_item. O preço e a decisão vêm do decide_item, não de você.
- Leia o edital (read_edital) e registre exigências relevantes com citação: registro_anvisa, afe, amostra, marca_referencia e prazo_esclarecimento.
- Se o texto do item ou do edital indicar marca de referência, ou o histórico mostrar uma marca dominante, use flag_restrictive e redija um esclarecimento (draft_esclarecimento) respeitando o prazo.
- Exceções: se uma ferramenta falhar, tente de novo uma vez e siga em frente registrando a pendência. Não analise itens sem produto compatível no catálogo.
- Ao terminar, chame request_approval com um resumo curto (itens, decisão, preço, pendências, esclarecimentos) e ENCERRE.`;

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
  const history = [...p1.messages, { role: 'user', content: `Aprovado (${approvalId}). Envie as propostas aprovadas (submit_proposal, um por pregão), envie os esclarecimentos redigidos (send_esclarecimento) e confira cada envio (verify_submission). Depois resuma o que foi feito.` }];
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
  restrictive: st.restrictive, drafts: st.drafts, submissions: st.submissions, sandbox: { propostas: [...sbx.propostas.keys()], esclarecimentos: sbx.esclarecimentos.length },
};
writeFileSync(`out/turno-${tag}.summary.json`, JSON.stringify(summary, null, 1));
console.log('\n# RESUMO', JSON.stringify(summary, null, 1).slice(0, 4000));
sbx.close();
