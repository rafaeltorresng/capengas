import './_out.ts';
// Exemplo ponta a ponta com o modelo REAL sobre um edital REAL, no portal SANDBOX:
// 1. o agente lê o edital, extrai exigências, confere os itens com o catálogo e decide (decide_item);
// 2. para item viável, lê os documentos da proposta, registra regras e exigências e monta proposta e plano de documentos;
// 3. o script grava a análise e a foto do pregão (o recheque bloqueia envio sem foto);
// 4. o humano decide as pendências e aprova os itens que irão na proposta;
// 5. gera os PDFs dos itens aprovados e envia ao portal sandbox pelo mesmo caminho do agendador (recheque, política, intenção),
//    com os PDFs anexos, e consulta o protocolo.
// Uso: node scripts/fluxo-completo.ts [tender_id] [--itens 26] [--decisao aprovar|recusar|"ajustar: texto"]... [--modelo X] [--recheque-demo]
// --aprovar confirma as pendências e a geração/envio sem perguntas; sem a flag, o envio exige confirmação no terminal.
// Sem --decisao, pergunta no terminal. Ajuste faz o agente rodar de novo com o texto do humano (até 3 rodadas).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
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
import { resolverPregoesSolicitados } from '../src/lib/agendamento.ts';
import { instrucaoHumana, itensRecusados, pendenciasAprovadas } from '../src/lib/decisao-humana.ts';
import { gerarDocumentoProposta } from '../src/lib/documento-proposta.ts';
import { planoDoEstado } from '../src/lib/plano-documentos.ts';
import { anvisa } from '../src/lib/data.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { prepararDocumento, prepararDocumentoGerado, renderizarPdf } from '../src/server/documentos.ts';

const args = process.argv.slice(2);
const opt = (nome: string) => { const i = args.indexOf(nome); return i < 0 ? undefined : args[i + 1]; };
const tenderId = args.find(a => /^\d{14}\/\d{4}\/\d+$/.test(a)) ?? '80257355000108/2026/493';
const candidatos = opt('--itens')?.split(',').map(Number).filter(Number.isInteger) ?? [];
const model = opt('--modelo') ?? 'deepseek-ai/DeepSeek-V4.1-Flash';
const tag = `${tenderId.replaceAll('/', '-')}-${Date.now()}`;
const dir = `out/fluxo-completo/${tag}`;
mkdirSync(dir, { recursive: true });
const company = JSON.parse(readFileSync('fixtures/company.json', 'utf8'));
const tender = resolverPregoesSolicitados([tenderId], JSON.parse(readFileSync('fixtures/coverage.json', 'utf8')),
  JSON.parse(readFileSync('fixtures/demo.json', 'utf8')))[tenderId];

const etapa = (n: number, s: string) => console.log(`\n=== ${n}. ${s}`);
const sbx = await startSandbox(0);
const dbPath = process.env.LANCE_DB ?? `${dir}/lance.db`;
const store = openStore(dbPath);

// Envio fica com o script, depois da decisão humana. A leitura operacional é a etapa própria depois da análise técnica.
const SEM_ENVIO = new Set(['submit_proposal', 'send_esclarecimento', 'verify_submission', 'request_approval', 'read_operational_excerpt']);
const SYSTEM = `Você é o Lance, analista de licitações da ${company.empresa.nome}, que vende produtos para saúde a órgãos públicos.
- Use ferramentas para tudo; nunca invente dados, preços, registros ou citações. Citações são cópias literais.
- Liste o catálogo, leia os itens do pregão (siga proxima_pagina; se descricao_truncada, use get_tender_item até proximo_offset null).
- Para cada item promissor: registre o encaixe atributo a atributo com record_fit (cada exigência do item com citação própria; nao_informado para lacunas) e calcule decide_item. Preço e decisão vêm do decide_item.
- Se o item remete ao Termo de Referência, leia no edital as especificações do item no TR e registre cada atributo dele; "conforme Termo de Referência" não é atributo.
- Assim que um record_fit for aceito, chame decide_item para o item antes de ler mais o edital.
- Leia o edital (read_edital, no máximo 6 leituras) e registre exigências com citação: registro_anvisa, afe, amostra, marca_referencia, prazo_esclarecimento.
- Só depois de decide_item resultar em disputar ou disputar_com_pendencia: abra os documentos com read_proposal_docs, registre com record_proposal_rule as regras de apresentação da proposta (leia o modelo com read_proposal_excerpt; no máximo 8 leituras), monte draft_proposal_document, registre com record_document_requirement cada documento exigido (fase, condição e prazo citados) e monte draft_document_plan.
- Se houver decisões do humano, siga-as: item recusado fica de fora; pedido de ajuste exige reanalisar o item com o texto do humano.
- Não envie nada. Ao terminar, resuma o que ficou pronto e as pendências, e ENCERRE.
${INSTRUCAO_OPERACIONAL}`;
// Decisões por argumento (uma por rodada). Uma decisão explícita prevalece sobre --aprovar.
const aprovarEnvio = args.includes('--aprovar');
const decisoesArg = args.flatMap((a, i) => a === '--decisao' ? [args[i + 1]] : []);
const lerDecisao = async (rodada: number, pergunta: string) => {
  if (decisoesArg[rodada]) { console.log(`  ${pergunta} ${decisoesArg[rodada]}  (argumento --decisao)`); return decisoesArg[rodada]; }
  if (aprovarEnvio) { console.log(`  ${pergunta} aprovar (argumento --aprovar)`); return 'aprovar'; }
  if (!process.stdin.isTTY) return '';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const r = await rl.question(`  ${pergunta} `); rl.close(); return r;
};
const onEvent = (e: any) => { if (e.type === 'tool') console.log(`  [${(e.t / 1000).toFixed(0)}s] ${e.error || e.result?.aceito === false ? '✗' : '✓'} ${e.name} ${JSON.stringify(e.args).slice(0, 100)}`); };
const recheckDemo = args.includes('--recheque-demo');
let resultado: unknown = 'sem item viável: nada a enviar';
const resumoRodadas: unknown[] = [];

for (let rodada = 0; rodada < 3; rodada++) {
  const st = newState(company, sbx.url, new Date());
  st.operationalConditions = {};
  st.store = store;
  st.tenders[tenderId] = tender;
  const humano = instrucaoHumana(store, tenderId);
  const USER = `Analise o pregão ${tenderId}.${candidatos.length ? ` Candidatos do pré-filtro por termos do catálogo, que não comprova encaixe: itens ${candidatos.join(', ')}. Comece por eles.` : ''} Comece por list_catalog.${humano}`;

  etapa(1, `${rodada ? `Rodada ${rodada + 1}: agente retoma com a decisão do humano` : 'Agente lê o edital'} ${tenderId}, extrai exigências, decide os itens e monta proposta e plano (modelo ${model})`);
  if (humano) console.log(`  instrução do humano enviada ao agente:${humano.replace(/\n/g, '\n    ')}`);
  const r = await runAgentWithOperationalReview({ llm: featherless(model), operationalLLM: featherless(model, { maxTokens: 8192 }),
    tools: tools.filter(t => !SEM_ENVIO.has(t.name)), system: SYSTEM, user: USER, maxSteps: 90, maxTokens: 1_200_000, state: st, onEvent });
  writeFileSync(`${dir}/rastro-${rodada + 1}.json`, JSON.stringify(r.trace, null, 1));
  console.log(`  ${r.stopped} em ${(r.ms / 1000).toFixed(0)}s; custo US$ ${(r.usage.cost ?? 0).toFixed(3)}`);
  for (const [k, d] of Object.entries(st.decisions) as [string, any][]) if (k.startsWith(tenderId + '#')) console.log(`  item ${k.split('#')[1]}: ${d.estado} — ${d.motivos?.join('; ').slice(0, 160)}`);

  etapa(2, 'Grava a análise, abre as pendências para o humano e tira a foto do pregão');
  const analiseId = randomUUID();
  persistAnalysis(st, store, { analiseId });
  try { await snapshotTender(tenderId, store); }
  catch (e: any) { console.log(`  foto do pregão não gravada (${String(e?.message ?? e).slice(0, 90)}); o recheque bloqueia o envio`); }
  console.log(`  banco: ${dbPath} · análise ${analiseId}`);

  const dossie = createReadModel(store, { actions: () => store.getActions(), cofre: company.cofre }).dossie(tenderId);
  if (dossie?.analiseId === analiseId) {
    const relatorio = `${dir}/relatorio.pdf`;
    writeFileSync(relatorio, await renderizarPdf(prepararDocumento(dossie, 'relatorio')));
    console.log(`  relatório para revisão: ${relatorio}`);
  }

  etapa(3, 'Decisão humana nas pendências da análise atual');
  const abertas = store.openEscalations().filter(e => e.tender === tenderId && e.analiseId === analiseId);
  resumoRodadas.push({ rodada: rodada + 1, analiseId, stopped: r.stopped, s: Math.round(r.ms / 1000), custo: r.usage.cost, humano,
    decisoes: Object.fromEntries(Object.entries(st.decisions).map(([k, d]: any) => [k, d.estado])) });
  let ajuste = false;
  for (const e of abertas) {
    console.log(`  PENDENTE ${e.id} · item ${e.item ?? '-'}: ${e.motivo}`);
    const resposta = (await lerDecisao(rodada, 'Decisão (aprovar / recusar / ajustar: <texto>):')).trim();
    const m = /^(aprovar|recusar|ajustar)\s*:?\s*(.*)$/i.exec(resposta);
    if (!m || (m[1].toLowerCase() === 'ajustar' && !m[2])) { console.log('  sem decisão válida: a pendência continua aberta'); continue; }
    const decisao = m[1].toLowerCase() as 'aprovar' | 'recusar' | 'ajustar';
    const registro = store.resolveEscalation(e.id, { decisao, ...(decisao === 'ajustar' ? { ajuste: m[2] } : {}) });
    if (registro.status !== 'salva') {
      console.log(`  decisão não registrada: ${registro.status}`);
      continue;
    }
    console.log(`  humano: ${decisao}${decisao === 'ajustar' ? ` "${m[2]}"` : ''} (gravado no store, como pela tela)`);
    ajuste ||= decisao === 'ajustar';
  }
  if (ajuste) { console.log('  ajuste pedido: o agente retoma a análise com o texto do humano'); continue; }

  if (!dossie?.proposta || dossie.analiseId !== analiseId) {
    resultado = 'análise atual sem proposta: nada enviado';
    break;
  }
  const recusados = itensRecusados(store, tenderId);
  const liberados = dossie.itens.filter(d => !recusados.includes(d.item) && (d.estado === 'disputar' ||
    (d.estado === 'disputar_com_pendencia' && pendenciasAprovadas(store, tenderId, analiseId, d.item, d.motivos))));
  if (!liberados.length) {
    resultado = 'nenhum item liberado: nada enviado';
    break;
  }
  console.log(`  itens da proposta: ${liberados.map(d => `${d.item} (${d.estado}, R$ ${d.precoUnitario})`).join(', ')}`);
  let confirmado = aprovarEnvio;
  if (!confirmado && process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    confirmado = /^(s|sim)$/i.test((await rl.question('  Aprovar estes itens, gerar os anexos e enviar ao portal sandbox? (s/N) ')).trim());
    rl.close();
  }
  if (!confirmado) {
    resultado = 'geração dos anexos e envio não aprovados';
    break;
  }

  etapa(4, 'Gera os anexos da proposta aprovada');
  const numeros = new Set(liberados.map(d => d.item));
  const itensProposta = dossie.proposta.itens.filter(i => numeros.has(i.numero));
  const proposta = gerarDocumentoProposta({
    pregao: { id: tenderId, orgao: tender.orgao ?? '', abertura: tender.abertura },
    empresa: dossie.proposta.empresa, itens: itensProposta, regras: dossie.proposta.regras,
    hoje: new Date(dossie.proposta.geradoEm), origemDados: dossie.proposta.origemDados,
  });
  const chaves = new Set(liberados.map(d => `${tenderId}#${d.item}`));
  const decisoes = Object.fromEntries(Object.entries(st.decisions).filter(([key]) => chaves.has(key)));
  const plano = planoDoEstado({ ...st, decisions: decisoes }, tenderId);
  const dossieEnvio = { ...dossie, itens: liberados, proposta, planoDocumentos: plano ?? undefined };
  const arquivos = [prepararDocumento(dossieEnvio, 'proposta'),
    ...(plano?.linhas ?? []).flatMap((l, i) => l.declaracao ? [prepararDocumentoGerado(dossieEnvio, i)] : [])];
  const anexos: { nome: string; pdf: Uint8Array }[] = [];
  for (const a of arquivos) {
    const pdf = new Uint8Array(await renderizarPdf(a));
    writeFileSync(`${dir}/${a.nomeArquivo}`, pdf);
    anexos.push({ nome: a.nomeArquivo, pdf });
    console.log(`  ${dir}/${a.nomeArquivo} (${pdf.length} bytes, sha256 ${createHash('sha256').update(pdf).digest('hex').slice(0, 12)}…)`);
  }
  if (plano) writeFileSync(`${dir}/plano-documentos.json`, JSON.stringify(plano, null, 1));

  etapa(5, 'Envia a proposta aprovada ao portal sandbox');
  // Só para gravar a demo no portal sandbox: o recheque real (situação e arquivos no PNCP) é trocado por "ok".
  if (recheckDemo) console.log('  ATENÇÃO: --recheque-demo — recheque do PNCP SIMULADO como ok; vale só para o portal sandbox');
  resultado = await executarAcao({ tipo: 'enviar_proposta', tenderId, itens: [...numeros], anexos, analiseId }, {
    store, politica: company.politica, sandboxUrl: sbx.url, empresa: company.empresa.nome, catalogo: company.catalogo,
    recheck: recheckDemo
      ? async id => ({ status: 'ok', situacao: 'simulada (--recheque-demo)', arquivosHash: store.getTender(id)?.arquivosHash ?? '', em: new Date().toISOString() })
      : id => recheckTender(id, store),
    anvisa: n => anvisa.byRegistro(n) });
  const res = resultado as any;
  if (res.resultado === 'confirmada') {
    const recebida = sbx.propostas.get(res.protocolo);
    console.log(`  protocolo ${res.protocolo} confirmado no portal; recebida em ${recebida?.recebidaEm}`);
    for (const a of recebida?.anexos ?? []) console.log(`  anexo recebido: ${a.nome} (${a.bytes} bytes, sha256 ${a.sha256.slice(0, 12)}…)`);
    writeFileSync(`${dir}/protocolo.json`, JSON.stringify({ ...recebida, recheque: recheckDemo ? 'simulado (--recheque-demo)' : 'PNCP' }, null, 1));
  }
  break;
}
console.log('  resultado:', JSON.stringify(resultado));
writeFileSync(`${dir}/resumo.json`, JSON.stringify({ tenderId, model, rodadas: resumoRodadas, resultado }, null, 1));
console.log(`\nArquivos em ${dir}`);
store.close();
sbx.close();
