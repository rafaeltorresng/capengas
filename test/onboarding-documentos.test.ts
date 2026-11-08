import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { tools, type LanceState } from '../src/lib/tools.ts';
import { anvisa, pncp, pdf } from '../src/lib/data.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { runOnboardingAnalysis } from '../src/server/onboarding.ts';
import { prepararDocumento } from '../src/server/documentos.ts';
import type { Tool, LLM } from '../src/lib/agent.ts';

test('onboarding liga ferramentas documentais e persiste proposta/plano no resultado da própria execução', async t => {
  // Teste de integração com modelo controlado e fontes sintéticas, sem produzir resultado de demonstração.
  const company = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));
  const demo = JSON.parse(readFileSync(new URL('../fixtures/demo.json', import.meta.url), 'utf8'));
  const tender = demo.pregoes[0].id;
  const now = () => new Date('2026-11-08T12:00:00Z');
  const store = openStore(':memory:', { now }); t.after(() => { store.close(); mock.restoreAll(); });
  const quote = 'A validade da proposta será de 90 dias.';
  mock.method(pncp, 'files', async () => [{ tipo: 'Edital', titulo: 'Edital de teste', url: 'https://example.org/edital.pdf' }]);
  mock.method(pdf, 'fromUrl', async () => ({ kind: 'pdf', text: quote }));
  mock.method(anvisa, 'byRegistro', () => ({ NOME_FABRICANTE: 'Fabricante de teste' }));
  const decide: Tool = { name: 'decide_item', description: 'Preparação sintética do caso unitário', parameters: { type: 'object', properties: {} }, run: async (_, ctx) => {
    const state = ctx.state as LanceState;
    state.items[tender] = [{ numero: 1, descricao: 'Cabo de bisturi de teste', unidade: 'Unidade', quantidade: 10, valorEstimado: 12 }];
    state.decisions[tender + '#1'] = { produto: 'P1', estado: 'disputar', motivos: ['Caso unitário'], precoProposto: 7.5 };
    return state.decisions[tender + '#1'];
  } };
  const etapas = [
    [['decide_item', {}]], [['read_proposal_docs', { tender_id: tender }]],
    [['record_proposal_rule', { tender_id: tender, campo: 'validade_proposta', valor: '90 dias', citacao: quote }]],
    [['draft_proposal_document', { tender_id: tender }], ['draft_document_plan', { tender_id: tender }]],
  ] as const;
  let i = 0;
  const llm: LLM = { model: 'teste-controlado', chat: async (_, schemas) => {
    assert.ok(schemas.every(s => !['submit_proposal', 'submit_esclarecimento', 'request_approval'].includes(s.function.name)));
    const chamadas = etapas[i++];
    return { message: chamadas ? { tool_calls: chamadas.map(([name, args], n) => ({ id: `${i}-${n}`, function: { name, arguments: JSON.stringify(args) } })) } : { content: 'Fim do teste.' }, usage: { prompt_tokens: 1, completion_tokens: 1 }, ms: 1 };
  } };
  await runOnboardingAnalysis({ company, demo, store, tenderId: tender, turno: 'documentos-onboarding', now, llm: () => llm,
    ferramentas: [decide, ...tools.filter(t => ['read_proposal_docs', 'record_proposal_rule', 'draft_proposal_document', 'draft_document_plan'].includes(t.name))], snapshot: async () => {} });
  const model = createReadModel(store, { now, actions: () => [] });
  const d = model.dossie(tender)!;
  assert.equal(d.analiseId, 'documentos-onboarding');
  assert.equal(d.proposta?.total, 75); assert.equal(d.proposta?.origemDados, 'sinteticos');
  assert.match(d.proposta!.markdown, /90 dias/);
  assert.ok(d.planoDocumentos?.linhas.some(l => l.tipo === 'proposta_precos' && l.status === 'gerado'));
  assert.equal(model.turnos().turnos[0].resultados?.[0].itens[0].estadoCodigo, 'disputar_com_pendencia');
  assert.ok(d.operacao?.requerRevisao, 'cláusulas operacionais não registradas exigem confirmação');
  assert.equal(model.turnos().turnos[0].status, 'concluido');
  assert.deepEqual(store.getActions(), []);
  assert.match(prepararDocumento(d, 'proposta').markdown, /MINUTA/);
  store.upsertDecision({ tenderId: tender, item: 1, produto: 'P1', estado: 'disputar', motivos: [], precoProposto: 8 });
  const stale = model.dossie(tender)!;
  assert.equal(stale.desatualizado, true);
  assert.equal(stale.reavaliar, false);
  assert.throws(() => prepararDocumento(stale, 'proposta'), /dados ou as decisões mudaram/i);
});
