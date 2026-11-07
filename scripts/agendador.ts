// Liga o agendador ao turno de análise: turnos nos horários da política e monitor periódico, sem clique.
// Uso: npm run agendador                 (fica rodando; Ctrl+C para parar)
//      npm run agendador -- --uma-vez    (um tick e sai)
//      npm run agendador -- --demo 30    (um turno de demonstração daqui a 30 s, depois segue agendado)
//      npm run agendador -- --demo 0 --uma-vez   (só o turno de demonstração e sai)
// Pregões por turno: LANCE_PREGOES_POR_TURNO (padrão 1). Banco: LANCE_DB. Portal: LANCE_SANDBOX_URL (padrão: sandbox local).
// O modelo só analisa e rascunha; quem envia é o código, na fase de ações, pela porta executarAcao.
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { featherless } from '../src/lib/llm.ts';
import { runAgent } from '../src/lib/agent.ts';
import { tools } from '../src/lib/tools.ts';
import { snapshotTender, recheckTender } from '../src/lib/recheck.ts';
import { createScheduler } from '../src/lib/scheduler.ts';
import { createAnalysisTurn, executarAcoesDoTurno } from '../src/lib/agendamento.ts';
import { startSandbox } from '../src/lib/sandbox.ts';

const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const demo = JSON.parse(readFileSync(new URL('../fixtures/demo.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
const demoSeg = args.includes('--demo') ? Number(args[args.indexOf('--demo') + 1] ?? 30) : null;
const allowed = new Set(['list_catalog', 'get_product_sheet', 'get_tender_items', 'get_tender_item', 'read_edital', 'record_requirement', 'record_fit', 'check_anvisa', 'decide_item', 'flag_restrictive', 'draft_esclarecimento']);

const store = openStore();
const sbx = process.env.LANCE_SANDBOX_URL ? null : await startSandbox(0);
const sandboxUrl = process.env.LANCE_SANDBOX_URL ?? sbx!.url;
const llm = featherless();
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

const runTurn = createAnalysisTurn({
  store, company, demo, limite: Number(process.env.LANCE_PREGOES_POR_TURNO ?? 1),
  snapshot: (id, s) => snapshotTender(id, s),
  recheck: (id, s) => recheckTender(id, s),
  agir: (state, ids) => executarAcoesDoTurno({ store, company, state, ids, sandboxUrl, recheck: id => recheckTender(id, store) }),
  analisar: (state, ids) => runAgent({ llm, tools: tools.filter(t => allowed.has(t.name)), state,
    maxSteps: 30, maxTokens: 250_000,
    system: 'Você é o Lance. Analise somente os pregões solicitados. Use citações literais, nunca invente dados. Liste o catálogo, filtre itens relevantes, siga proxima_pagina e proximo_offset. Leia o edital, registre exigências e compare atributos com as fichas. Use nao_informado para lacunas. Calcule decisões com decide_item. Se o edital exige marca de referência, use flag_restrictive. Para atributo nao_informado, variante não coberta ou marca de referência, rascunhe o pedido de esclarecimento com draft_esclarecimento (texto objetivo citando o item). Não envie nada: o envio é feito pelo código, conforme a política. Catálogo e cofre são sintéticos de demonstração; dados dos pregões são reais. Limite a análise a 3 itens relevantes no total. Resultados antigos de ferramenta são resumidos no histórico; se faltar uma citação, chame a ferramenta de novo.',
    user: `Analise os pregões ${ids.join(', ')} e termine com um resumo do que ficou pronto e das pendências.`,
    onEvent: e => store.logEvent({ tipo: 'analise_item', resumo: e.type === 'llm' ? 'Chamada ao modelo' : `${e.type}: ${e.name ?? e.text ?? ''}`,
      rastro: [{ ferramenta: e.type === 'llm' ? `llm:${llm.model}` : e.name ?? e.type,
        entrada: e.args === undefined ? undefined : JSON.stringify(e.args), saida: e.result === undefined ? e.text : JSON.stringify(e.result), ms: e.ms, custoUsd: e.usage?.cost }] }),
  }),
});

const s = createScheduler({ store, politica: company.politica, runTurn });
const fechar = () => { s.stop(); sbx?.close(); store.close(); log('agendador parado'); process.exit(0); };
process.on('SIGINT', fechar); process.on('SIGTERM', fechar);

log(`agendador ligado; banco ${process.env.LANCE_DB ?? 'data/lance.db'}; portal ${sandboxUrl}; ${JSON.stringify(s.status())}`);
if (args.includes('--uma-vez')) {
  if (demoSeg != null) log(`turno de demonstração: ${await s.runNext(demoSeg * 1000)}`);
  else log(`tick: ${JSON.stringify(await s.tick())}`);
  sbx?.close(); store.close();
} else {
  if (demoSeg != null) log(`turno de demonstração: ${await s.runNext(demoSeg * 1000)}`);
  log(`primeiro tick: ${JSON.stringify(await s.tick())}`);
  s.start();
}
