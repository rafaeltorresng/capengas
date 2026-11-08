import './_out.ts';
// Exemplo ponta a ponta com o modelo REAL sobre um edital REAL, no portal SANDBOX:
// 1. o agente lê o edital, extrai exigências, confere os itens com o catálogo e decide (decide_item);
// 2. para item viável, lê os documentos da proposta, registra regras e exigências e monta proposta e plano de documentos;
// 3. o script grava a análise e a foto do pregão (o recheque bloqueia envio sem foto);
// 4. gera os PDFs (proposta e declarações que o Lance preenche);
// 5. com a aprovação humana, envia ao portal sandbox pelo mesmo caminho do agendador (recheque, política, intenção),
//    com os PDFs anexos, e consulta o protocolo.
// Uso: node scripts/fluxo-completo.ts [tender_id] [--itens 26] [--aprovar] [--modelo X]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { featherless } from '../src/lib/llm.ts';
import { runAgentWithOperationalReview } from '../src/lib/agente-operacional.ts';
import { tools, newState } from '../src/lib/tools.ts';
import { INSTRUCAO_OPERACIONAL } from '../src/lib/operacao.ts';
import { startSandbox } from '../src/lib/sandbox.ts';
import { openStore } from '../src/lib/store.ts';
import { persistAnalysis } from '../src/lib/persist-analysis.ts';
import { snapshotTender, recheckTender } from '../src/lib/recheck.ts';
import { executarAcao } from '../src/lib/act.ts';
import { anvisa } from '../src/lib/data.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { prepararDocumento, prepararDocumentoGerado, renderizarPdf } from '../src/server/documentos.ts';
import type { Dossier } from '../src/server/contract.ts';

const args = process.argv.slice(2);
const opt = (nome: string) => { const i = args.indexOf(nome); return i < 0 ? undefined : args[i + 1]; };
const tenderId = args.find(a => /^\d{14}\/\d{4}\/\d+$/.test(a)) ?? '80257355000108/2026/493';
const candidatos = opt('--itens')?.split(',').map(Number).filter(Number.isInteger) ?? [];
const model = opt('--modelo') ?? 'moonshotai/Kimi-K2.6';
const tag = `${tenderId.replaceAll('/', '-')}-${Date.now()}`;
const dir = `out/fluxo-completo/${tag}`;
mkdirSync(dir, { recursive: true });
const company = JSON.parse(readFileSync('fixtures/company.json', 'utf8'));
const tender = JSON.parse(readFileSync('fixtures/coverage.json', 'utf8')).find((c: any) => `${c.cnpj}/${c.ano}/${c.seq}` === tenderId);
if (!tender) throw new Error(`pregão ${tenderId} não está em fixtures/coverage.json`);

const etapa = (n: number, s: string) => console.log(`\n=== ${n}. ${s}`);
const sbx = await startSandbox(0);
const dbPath = process.env.LANCE_DB ?? `${dir}/lance.db`;
const store = openStore(dbPath);
const st = newState(company, sbx.url, new Date());
st.operationalConditions = {};
st.store = store;
st.tenders[tenderId] = tender;

const SEM_ENVIO = new Set(['submit_proposal', 'send_esclarecimento', 'verify_submission', 'request_approval']);
const SYSTEM = `Você é o Lance, analista de licitações da ${company.empresa.nome}, que vende produtos para saúde a órgãos públicos.
- Use ferramentas para tudo; nunca invente dados, preços, registros ou citações. Citações são cópias literais.
- Liste o catálogo, leia os itens do pregão (siga proxima_pagina; se descricao_truncada, use get_tender_item até proximo_offset null).
- Para cada item promissor: registre o encaixe atributo a atributo com record_fit (cada exigência do item com citação própria; nao_informado para lacunas) e calcule decide_item. Preço e decisão vêm do decide_item.
- Leia o edital (read_edital) e registre exigências com citação: registro_anvisa, afe, amostra, marca_referencia, prazo_esclarecimento.
- Só depois de decide_item resultar em disputar ou disputar_com_pendencia: abra os documentos com read_proposal_docs, registre com record_proposal_rule as regras de apresentação da proposta (leia o modelo com read_proposal_excerpt; no máximo 8 leituras), monte draft_proposal_document, registre com record_document_requirement cada documento exigido (fase, condição e prazo citados) e monte draft_document_plan.
- Não envie nada. Ao terminar, resuma o que ficou pronto e as pendências, e ENCERRE.
${INSTRUCAO_OPERACIONAL}`;
const USER = `Analise o pregão ${tenderId}.${candidatos.length ? ` Candidatos do pré-filtro por termos do catálogo, que não comprova encaixe: itens ${candidatos.join(', ')}. Comece por eles.` : ''} Comece por list_catalog.`;

etapa(1, `Agente lê o edital ${tenderId}, extrai exigências, decide os itens e monta proposta e plano (modelo ${model})`);
const onEvent = (e: any) => { if (e.type === 'tool') console.log(`  [${(e.t / 1000).toFixed(0)}s] ${e.error || e.result?.aceito === false ? '✗' : '✓'} ${e.name} ${JSON.stringify(e.args).slice(0, 100)}`); };
const r = await runAgentWithOperationalReview({ llm: featherless(model), operationalLLM: featherless(model, { maxTokens: 8192 }),
  tools: tools.filter(t => !SEM_ENVIO.has(t.name)), system: SYSTEM, user: USER, maxSteps: 30, maxTokens: 500_000, state: st, onEvent });
writeFileSync(`${dir}/rastro.json`, JSON.stringify(r.trace, null, 1));
console.log(`  ${r.stopped} em ${(r.ms / 1000).toFixed(0)}s; custo US$ ${(r.usage.cost ?? 0).toFixed(3)}`);

const viaveis = Object.entries(st.decisions).filter(([k, d]: any) => k.startsWith(tenderId + '#') && d.estado === 'disputar').map(([k]) => Number(k.split('#')[1]));
for (const [k, d] of Object.entries(st.decisions) as [string, any][]) if (k.startsWith(tenderId + '#')) console.log(`  item ${k.split('#')[1]}: ${d.estado} — ${d.motivos?.join('; ').slice(0, 160)}`);

etapa(2, 'Grava a análise e a foto do pregão');
const analiseId = `fluxo-${Date.now()}`;
persistAnalysis(st, store, { analiseId });
await snapshotTender(tenderId, store);
console.log(`  banco: ${dbPath} · análise ${analiseId}`);

etapa(3, 'Gera os documentos de saída (PDF)');
const dossie = createReadModel(store, { actions: () => store.getActions(), cofre: company.cofre }).dossie(tenderId) as Dossier | undefined;
const anexos: { nome: string; pdf: Uint8Array }[] = [];
if (!dossie?.proposta) console.log('  sem proposta: nenhum item viável recebeu documento da proposta');
else {
  const arquivos = [prepararDocumento(dossie, 'proposta'), ...(dossie.planoDocumentos?.linhas ?? []).flatMap((l, i) => l.declaracao ? [prepararDocumentoGerado(dossie, i)] : [])];
  for (const a of arquivos) {
    const pdf = new Uint8Array(await renderizarPdf(a));
    writeFileSync(`${dir}/${a.nomeArquivo}`, pdf);
    anexos.push({ nome: a.nomeArquivo, pdf });
    console.log(`  ${dir}/${a.nomeArquivo} (${pdf.length} bytes, sha256 ${createHash('sha256').update(pdf).digest('hex').slice(0, 12)}…)`);
  }
  const plano = dossie.planoDocumentos;
  if (plano) {
    writeFileSync(`${dir}/plano-documentos.json`, JSON.stringify(plano, null, 1));
    for (const l of plano.linhas) console.log(`  plano: ${l.documento} — ${l.status}: ${l.acao.slice(0, 110)}`);
  }
}
if (dossie) writeFileSync(`${dir}/relatorio.pdf`, await renderizarPdf(prepararDocumento(dossie, 'relatorio')));

etapa(4, 'Aprovação humana e envio ao portal sandbox');
let resultado: unknown = 'sem item com decisão disputar: nada a enviar';
if (viaveis.length && anexos.length) {
  let aprovado = args.includes('--aprovar');
  if (!aprovado && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    aprovado = /^s/i.test(await rl.question(`  Enviar a proposta dos itens ${viaveis.join(', ')} com ${anexos.length} PDF(s) ao portal sandbox? (s/N) `));
    rl.close();
  }
  if (!aprovado) resultado = 'envio não aprovado';
  else {
    resultado = await executarAcao({ tipo: 'enviar_proposta', tenderId, itens: viaveis, anexos }, {
      store, politica: company.politica, sandboxUrl: sbx.url, empresa: company.empresa.nome, catalogo: company.catalogo,
      recheck: id => recheckTender(id, store), anvisa: n => anvisa.byRegistro(n) });
    const res = resultado as any;
    if (res.resultado === 'confirmada') {
      const recebida = sbx.propostas.get(res.protocolo);
      console.log(`  protocolo ${res.protocolo} confirmado no portal; recebida em ${recebida?.recebidaEm}`);
      for (const a of recebida?.anexos ?? []) console.log(`  anexo recebido: ${a.nome} (${a.bytes} bytes, sha256 ${a.sha256.slice(0, 12)}…)`);
      writeFileSync(`${dir}/protocolo.json`, JSON.stringify({ ...recebida, anexos: recebida?.anexos }, null, 1));
    }
  }
}
console.log('  resultado:', JSON.stringify(resultado));
writeFileSync(`${dir}/resumo.json`, JSON.stringify({ tenderId, model, analiseId, stopped: r.stopped, s: Math.round(r.ms / 1000), custo: r.usage.cost,
  decisoes: Object.fromEntries(Object.entries(st.decisions).map(([k, d]: any) => [k, d.estado])), anexos: anexos.map(a => a.nome), resultado }, null, 1));
console.log(`\nArquivos em ${dir}`);
store.close();
sbx.close();
