// Turno de análise real, persistido. Não expõe ferramentas de envio ao modelo.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/lib/store.ts';
import { featherless } from '../src/lib/llm.ts';
import { runAgent } from '../src/lib/agent.ts';
import { tools, newState } from '../src/lib/tools.ts';
import { persistAnalysis } from '../src/lib/persist-analysis.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { agruparResultados, eventoTurno, type TurnoEvent } from '../src/lib/turnos.ts';

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
const atividades: Record<string, string> = {
  list_catalog: 'Consultando o catálogo da empresa',
  get_product_sheet: 'Consultando as fichas dos produtos',
  get_tender_items: 'Consultando os itens do pregão',
  get_tender_item: 'Consultando os itens do pregão',
  read_edital: 'Lendo o edital',
  record_requirement: 'Registrando as exigências do edital',
  record_fit: 'Conferindo os requisitos dos itens',
  check_anvisa: 'Consultando o registro na Anvisa',
  decide_item: 'Preparando a recomendação por item',
};
const store = openStore();
const turno = randomUUID();
const registrar = (event: TurnoEvent) => store.logEvent(eventoTurno(event));
let sinal: ReturnType<typeof setInterval> | undefined;
try {
  const pregoes = [...new Set(ids)];
  const nomesEditais = Object.fromEntries(pregoes.map(id => [id, state.tenders[id].objeto?.trim() || state.tenders[id].orgao || '']));
  registrar({ turno, tipo: 'inicio', pregoes, nomesEditais });
  registrar({ turno, tipo: 'atividade', atividade: 'Preparando a análise dos pregões' });
  sinal = setInterval(() => {
    try { registrar({ turno, tipo: 'sinal' }); }
    catch (error) { console.error('Não foi possível registrar a atualização do turno.', error); }
  }, 15_000);
  const llm = featherless();
  registrar({ turno, tipo: 'resultado', concluida: true });
  let ferramentaEmExecucao: string | undefined;
  const result = await runAgent({ llm, tools: tools.filter(t => allowed.has(t.name)), state,
    maxSteps: 30, maxTokens: 250_000,
    system: 'Você é o Lance. Analise somente os pregões solicitados. Use citações literais, nunca invente dados. Liste o catálogo, filtre itens relevantes, siga proxima_pagina e proximo_offset. Leia o edital, registre exigências e compare atributos com as fichas. Use nao_informado para lacunas. Calcule decisões com decide_item. Não envie nada. Catálogo e cofre são sintéticos de demonstração; dados dos pregões são reais. Limite a análise a 3 itens relevantes no total.',
    user: `Analise os pregões ${ids.join(', ')} e termine com um resumo do que ficou pronto e das pendências.`,
    onToolStart: name => {
      ferramentaEmExecucao = name;
      registrar({ turno, tipo: 'atividade', atividade: atividades[name] ?? 'Analisando o pregão' });
    },
    onEvent: e => {
      if (e.type === 'tool' && ferramentaEmExecucao && e.name === ferramentaEmExecucao) {
        const resultado = e.result as { aceito?: boolean; error?: unknown; erro?: unknown } | undefined;
        registrar({ turno, tipo: 'resultado', concluida: !e.error && resultado?.aceito !== false && !resultado?.error && !resultado?.erro });
        ferramentaEmExecucao = undefined;
      }
      store.logEvent({ tipo: 'analise_item', resumo: e.type === 'llm' ? 'Chamada ao modelo' : `${e.type}: ${e.name ?? e.text ?? ''}`,
      rastro: [{ ferramenta: e.type === 'llm' ? `llm:${llm.model}` : e.name ?? e.type,
        entrada: e.args === undefined ? undefined : JSON.stringify(e.args), saida: e.result === undefined ? e.text : JSON.stringify(e.result), ms: e.ms, custoUsd: e.usage?.cost }] });
    },
  });
  if (result.stopped === 'final') registrar({ turno, tipo: 'atividade', atividade: 'Registrando a análise' });
  const decisoes = store.transaction(() => {
    const saved = result.stopped === 'final' ? persistAnalysis(state, store) : { decisoes: 0, items: [] };
    const keys = new Set(saved.items.map(item => `${item.tender}#${item.item}`));
    const model = createReadModel(store, { actions: () => store.getActions() });
    const resultados = keys.size ? agruparResultados(model.fila().filter(row => keys.has(`${row.tender}#${row.item}`)), model.dossie) : [];
    registrar({ turno, tipo: 'fim', status: resultados.length ? 'concluido' : 'incompleto', resultados });
    return saved.decisoes;
  });
  console.log(JSON.stringify({ banco: process.env.LANCE_DB ?? 'data/lance.db', decisoes, parada: result.stopped, duracaoMs: result.ms, uso: result.usage }));
  if (!decisoes) process.exitCode = 1;
} catch (error) {
  registrar({ turno, tipo: 'fim', status: 'falhou', resultados: [] });
  throw error;
} finally {
  clearInterval(sinal);
  store.close();
}
