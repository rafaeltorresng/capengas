// Turno de análise real, persistido. Não expõe ferramentas de envio ao modelo.
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { featherless } from '../src/lib/llm.ts';
import { runAgent } from '../src/lib/agent.ts';
import { tools, newState } from '../src/lib/tools.ts';
import { runAnalysisTurn } from '../src/lib/turn.ts';
import { snapshotTender } from '../src/lib/recheck.ts';

const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const coverage = JSON.parse(readFileSync(new URL('../fixtures/coverage.json', import.meta.url), 'utf8'));
const ids = process.argv.slice(2);
if (!ids.length) throw new Error('Informe pelo menos um id CNPJ/ano/sequencial; use LANCE_DB para escolher o banco.');
const state = newState(company, 'http://127.0.0.1:9');
for (const id of ids) {
  const tender = coverage.find((t: any) => `${t.cnpj}/${t.ano}/${t.seq}` === id);
  if (!tender) throw new Error(`pregão ${id} não está na fixture coverage; atualize a seleção antes de executar`);
  state.tenders[id] = tender;
}
const allowed = new Set(['list_catalog', 'get_product_sheet', 'get_tender_items', 'get_tender_item', 'read_edital', 'record_requirement', 'record_fit', 'check_anvisa', 'decide_item']);
const store = openStore();
const llm = featherless();
try {
  const saved = await runAnalysisTurn({
    store, state, origem: 'direto', snapshot: (id, banco) => snapshotTender(id, banco),
    run: () => runAgent({ llm, tools: tools.filter(t => allowed.has(t.name)), state,
      maxSteps: 30, maxTokens: 250_000,
      system: 'Você é o Lance. Analise somente os pregões solicitados. Use citações literais, nunca invente dados. Liste o catálogo, filtre itens relevantes, siga proxima_pagina e proximo_offset. Leia o edital, registre exigências e compare atributos com as fichas. Use nao_informado para lacunas. Calcule decisões com decide_item. Não envie nada. Catálogo e cofre são sintéticos de demonstração; dados dos pregões são reais. Limite a análise a 3 itens relevantes no total.',
      user: `Analise os pregões ${ids.join(', ')} e termine com um resumo do que ficou pronto e das pendências.`,
      onEvent: e => store.logEvent({ tipo: 'analise_item', resumo: e.type === 'llm' ? 'Chamada ao modelo' : `${e.type}: ${e.name ?? e.text ?? ''}`,
        rastro: [{ ferramenta: e.type === 'llm' ? `llm:${llm.model}` : e.name ?? e.type,
          entrada: e.args === undefined ? undefined : JSON.stringify(e.args), saida: e.result === undefined ? e.text : JSON.stringify(e.result), ms: e.ms, custoUsd: e.usage?.cost }] }),
    }),
  });
  console.log(JSON.stringify({ banco: process.env.LANCE_DB ?? 'data/lance.db', decisoes: saved.decisoes, parada: saved.stopped, duracaoMs: saved.ms, uso: saved.usage }));
  if (saved.stopped !== 'final' || !saved.decisoes) process.exitCode = 1;
} finally { store.close(); }
