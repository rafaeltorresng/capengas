import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { newState } from '../src/lib/tools.ts';
import { persistAnalysis } from '../src/lib/persist-analysis.ts';
import { gerarDocumentoProposta } from '../src/lib/documento-proposta.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { createIntegratedStore } from '../src/server/integrated.ts';
import { createServer } from '../src/server/api.ts';
import { prepararDocumento, prepararDocumentoGerado, renderizarPdf } from '../src/server/documentos.ts';
import type { Dossier } from '../src/server/contract.ts';
import { eventoTurno } from '../src/lib/turnos.ts';

const tid = '77816510000166/2026/348';
const company = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));
const now = () => new Date('2026-11-08T12:00:00Z');
function caso() {
  // Caso unitário sintético: não é decisão produzida por uma análise real.
  const state = newState(company, 'http://127.0.0.1:9', now());
  state.tenders[tid] = { orgao: 'Órgão de teste', abertura: '2026-11-23T09:00' };
  state.items[tid] = [{ numero: 1, descricao: 'Cabo cirúrgico de teste', unidade: 'Unidade', quantidade: 10, valorEstimado: 12 }];
  state.decisions[tid + '#1'] = { produto: 'P1', estado: 'disputar', motivos: ['Caso de teste'], precoProposto: 7.5 };
  state.proposals![tid] = gerarDocumentoProposta({ pregao: { id: tid, orgao: 'Órgão de teste' }, empresa: company.empresa,
    itens: [{ numero: 1, descricao: state.items[tid][0].descricao, unidade: 'Unidade', quantidade: 10, marca: company.catalogo[0].marca,
      registroAnvisa: company.catalogo[0].registroAnvisa, precoUnitario: 7.5 }], regras: [], hoje: now(), origemDados: 'sinteticos' });
  return state;
}
test('documento é persistido com a análise; exportação não usa preço ou empresa do pedido', async t => {
  const store = openStore(':memory:', { now }); t.after(() => store.close());
  persistAnalysis(caso(), store, { analiseId: 'execucao-teste' });
  const model = createReadModel(store, { now, actions: () => [] });
  const dossier = model.dossie(tid)!;
  assert.equal(dossier.analiseId, 'execucao-teste');
  assert.equal(dossier.proposta?.total, 75);
  const app = createServer(createIntegratedStore(store, model));
  app.listen(0, '127.0.0.1'); await once(app, 'listening'); t.after(() => new Promise<void>(r => app.close(() => r())));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}/api/dossies/${encodeURIComponent(tid)}`;
  assert.equal((await fetch(base + '/proposta.pdf?analise=execucao-teste')).status, 409);
  store.logEvent(eventoTurno({ turno: 'execucao-teste', tipo: 'inicio', pregoes: [tid] }));
  store.logEvent(eventoTurno({ turno: 'execucao-teste', tipo: 'fim', status: 'concluido', resultados: [] }));
  const proposta = await fetch(base + '/proposta.pdf?analise=execucao-teste&preco=1');
  assert.equal(proposta.status, 200);
  assert.equal(Buffer.from(await proposta.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  const response = await fetch(base + '/relatorio.pdf?analise=execucao-teste&preco=1');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /application\/pdf/);
  assert.match(response.headers.get('content-disposition')!, /attachment/);
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await fetch(base + '/relatorio.pdf?analise=anterior')).status, 409);
  assert.equal((await fetch(base.replace(encodeURIComponent(tid), 'ausente') + '/relatorio.pdf')).status, 404);
  assert.ok(prepararDocumento(dossier, 'proposta').markdown.includes('75,00'));
  assert.deepEqual(store.getActions(), []);
});
test('mudança de edital, preço, quantidade ou decisão bloqueia proposta antiga; relatório mantém o aviso', () => {
  const store = openStore(':memory:', { now });
  try {
    persistAnalysis(caso(), store, { analiseId: 'execucao-teste' });
    const d = createReadModel(store, { now, actions: () => [] }).dossie(tid)!;
    for (const mudar of [
      (v: Dossier) => { v.reavaliar = true; },
      (v: Dossier) => { v.itens![0].precoUnitario = 99; },
      (v: Dossier) => { v.itens![0].quantidade = 99; },
      (v: Dossier) => { v.itens![0].estado = 'escalar'; },
      (v: Dossier) => { v.proposta = undefined; },
    ]) {
      const changed = structuredClone(d); mudar(changed);
      assert.throws(() => prepararDocumento(changed, 'proposta'));
    }
    const stale = { ...d, reavaliar: true };
    assert.match(prepararDocumento(stale, 'relatorio').markdown, /reavaliação pendente/i);
  } finally { store.close(); }
});
test('PDF suporta acentos, tabela extensa e fonte longa, sem consulta externa', async () => {
  const markdown = '# Análise e proposta\n\n' + Array.from({ length: 30 }, (_, i) => `## Item ${i + 1}\n\nDescrição cirúrgica com evidência.\n\n| Campo | Valor |\n| --- | --- |\n| Citação | ${'Aço inoxidável com comprovação. '.repeat(i === 0 ? 400 : 25)} |\n\n`).join('');
  const pdf = await renderizarPdf({ titulo: 'Caso sintético de paginação', markdown, nomeArquivo: 'teste.pdf', paisagem: false });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 10_000);
});
test('declaração em arquivo: PDF da minuta persistida no plano, com aviso de dado sintético e as mesmas travas da proposta', async t => {
  // Caso sintético: o edital de teste pede a declaração de menor fora do sistema e não traz modelo.
  const state = caso();
  state.documentRequirements![tid] = [{ tipo: 'declaracao_menor', fase: 'proposta_inicial', condicoes: ['sempre'], origem: 'agente',
    citacao: 'declaração de que não emprega menor de 18 anos', fonte: { nome: 'Edital', url: 'https://x/edital.pdf' } }];
  const store = openStore(':memory:', { now }); t.after(() => store.close());
  persistAnalysis(state, store, { analiseId: 'execucao-teste' });
  const model = createReadModel(store, { now, actions: () => [] });
  const dossier = model.dossie(tid)!;
  const indice = dossier.planoDocumentos!.linhas.findIndex(l => l.tipo === 'declaracao_menor');
  assert.equal(dossier.planoDocumentos!.linhas[indice].status, 'lance_gera');
  const arquivo = prepararDocumentoGerado(dossier, indice);
  assert.match(arquivo.markdown, /MINUTA PARA REVISÃO E ASSINATURA/);
  assert.match(arquivo.markdown, /sintétic/);
  assert.match(arquivo.markdown, /não emprega menor de 18 \(dezoito\) anos/);
  assert.match(arquivo.nomeArquivo, /^lance-declaracao-menor-/);
  assert.throws(() => prepararDocumentoGerado({ ...dossier, desatualizado: true }, indice), /nova análise/);
  assert.throws(() => prepararDocumentoGerado(dossier, dossier.planoDocumentos!.linhas.findIndex(l => l.tipo === 'proposta_precos')), /não tem arquivo/);
  const app = createServer(createIntegratedStore(store, model));
  app.listen(0, '127.0.0.1'); await once(app, 'listening'); t.after(() => new Promise<void>(r => app.close(() => r())));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}/api/dossies/${encodeURIComponent(tid)}`;
  assert.equal((await fetch(`${base}/documento-${indice}.pdf?analise=execucao-teste`)).status, 409, 'análise não concluída');
  store.logEvent(eventoTurno({ turno: 'execucao-teste', tipo: 'inicio', pregoes: [tid] }));
  store.logEvent(eventoTurno({ turno: 'execucao-teste', tipo: 'fim', status: 'concluido', resultados: [] }));
  const r = await fetch(`${base}/documento-${indice}.pdf?analise=execucao-teste`);
  assert.equal(r.status, 200);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await fetch(`${base}/documento-999.pdf`)).status, 404);
  assert.deepEqual(store.getActions(), []);
});
