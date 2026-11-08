import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { criarBiblioteca } from '../src/lib/catalogos-demo.ts';
import { criarFeed, type RetratoFeed } from '../src/lib/oportunidades.ts';
import { createOnboarding, runOnboardingAnalysis } from '../src/server/onboarding.ts';
import { createServer } from '../src/server/api.ts';
import { createIntegratedStore } from '../src/server/integrated.ts';
import { openStore } from '../src/lib/store.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { prepararDocumento } from '../src/server/documentos.ts';
import type { LanceState } from '../src/lib/tools.ts';
import type { LLM, Tool } from '../src/lib/agent.ts';
const company = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));
const demo = JSON.parse(readFileSync(new URL('../fixtures/demo.json', import.meta.url), 'utf8'));
const now = () => new Date('2026-11-08T12:00:00Z');
const tid = '12345678000199/2026/1';
const inicial: RetratoFeed = {
  versao: 1,
  ultimaSincronizacao: now().toISOString(),
  ultimaTentativa: now().toISOString(),
  status: 'atualizado',
  avisos: [],
  pregoes: [
    {
      id: tid,
      orgao: 'Órgão sintético para teste',
      uf: 'PR',
      objeto: 'Materiais de teste',
      plataforma: 'Compras.gov.br',
      url: 'https://example.org/teste',
      abertura: '2026-11-23T09:00:00',
      situacao: 'Divulgada no PNCP',
      publicadoEm: '2026-11-06T09:00:00',
      atualizadoNaFonteEm: null,
      consultadoEm: now().toISOString(),
      fontes: [],
      itens: [
        { numero: 1, descricao: 'Cabo de bisturi', quantidade: 10 },
        { numero: 2, descricao: 'Tesoura cirúrgica', quantidade: 20 },
      ],
    },
  ],
};
const lib = () =>
  criarBiblioteca(company.catalogo, {
    produtos: [],
    arquivos: [
      { id: 'cabos', nome: 'cabos.xlsx', titulo: 'Cabos', produtos: ['P1'] },
      { id: 'tesouras', nome: 'tesouras.xlsx', titulo: 'Tesouras', produtos: ['P2'] },
    ],
  });
test('API filtra feed e passa somente produtos escolhidos ao agente, preservando seleção no dossiê', async (t) => {
  const store = openStore(':memory:', { now });
  t.after(() => store.close());
  const biblioteca = lib();
  const feed = criarFeed({ inicial, now, coletar: async () => inicial });
  let terminar!: (value?: unknown) => void;
  const fim = new Promise((r) => (terminar = r));
  const ferramenta: Tool = {
    name: 'decide_item',
    description: 'Caso sintético',
    parameters: { type: 'object', properties: {} },
    run: async (_, ctx) => {
      const st = ctx.state as LanceState;
      assert.deepEqual(
        st.company.catalogo.map((p: any) => p.id),
        ['P2'],
      );
      assert.equal(st.tenders[tid].candidatos.length, 1);
      assert.equal(st.tenders[tid].candidatos[0], 2);
      st.items[tid] = [{ numero: 2, descricao: 'Tesoura cirúrgica', quantidade: 20 }];
      st.decisions[tid + '#2'] = {
        produto: 'P2',
        estado: 'escalar',
        motivos: ['Teste controlado'],
        precoProposto: null,
      };
      return {};
    },
  };
  let n = 0;
  const llm: LLM = {
    model: 'controlado',
    chat: async () => ({
      message:
        n++ === 0
          ? { tool_calls: [{ id: '1', function: { name: 'decide_item', arguments: '{}' } }] }
          : { content: 'Fim controlado' },
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      ms: 1,
    }),
  };
  const onboarding = createOnboarding({
    company,
    demo,
    biblioteca,
    feed,
    store,
    disponivel: true,
    now,
    executar: async (job, ctx) => {
      try {
        await runOnboardingAnalysis({
          ...job,
          ...ctx,
          store,
          now,
          llm: () => llm,
          ferramentas: [ferramenta],
          snapshot: async () => {},
        });
      } finally {
        terminar();
      }
    },
  });
  const app = createServer(
    createIntegratedStore(store, createReadModel(store, { now, actions: () => store.getActions() })),
    undefined,
    onboarding,
  );
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise<void>((r) => app.close(() => r())));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}/api/onboarding`;
  const f = await (await fetch(base + '/editais?catalogo=tesouras')).json();
  assert.equal(f.dados.pregoes[0].matches.length, 1);
  assert.equal(f.dados.pregoes[0].matches[0].produto, 'P2');
  for (const catalogos of [[], ['inexistente']])
    assert.equal(
      (
        await fetch(base + '/analisar', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenderId: tid, catalogos }),
        })
      ).status,
      400,
    );
  const r = await fetch(base + '/analisar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenderId: tid, catalogos: ['tesouras'] }),
  });
  assert.equal(r.status, 202);
  await fim;
  const exportado = await fetch(base.replace('/onboarding', '/dossies/') + encodeURIComponent(tid) + '/relatorio.pdf');
  assert.equal(exportado.status, 200);
  assert.equal(
    Buffer.from(await exportado.arrayBuffer())
      .subarray(0, 5)
      .toString(),
    '%PDF-',
  );
  const d = store.getDossie(tid) as any;
  assert.deepEqual(
    d.catalogos.produtos.map((p: any) => p.id),
    ['P2'],
  );
  assert.equal(d.catalogos.arquivos[0].nome, 'tesouras.xlsx');
  assert.match(prepararDocumento(d, 'relatorio').markdown, /tesouras.xlsx/);
  const turno = createReadModel(store, { now, actions: () => [] })
    .turnos()
    .turnos.find((t) => t.id === d.analiseId)!;
  assert.deepEqual(turno.catalogos?.produtos, ['P2']);
  assert.equal(turno.catalogos?.hash, d.catalogos.hash);
  const inicio = store
    .events()
    .filter((e) => e.tipo === 'turno_progresso')
    .map((e) => JSON.parse(e.detalhe!))
    .find((e) => e.tipo === 'inicio');
  assert.deepEqual(inicio.catalogos.produtos, d.catalogos.produtos);
  assert.equal(company.catalogo.length, 6);
  assert.deepEqual(store.getActions(), []);
  const antes = structuredClone(d.catalogos);
  biblioteca.produtos[1].custo = 0;
  assert.deepEqual((store.getDossie(tid) as any).catalogos, antes);
});
test('mesmo pregão com seleção diferente não reaproveita execução em andamento', async (t) => {
  const store = openStore(':memory:', { now });
  t.after(() => store.close());
  let terminar!: () => void;
  const fim = new Promise<void>((r) => (terminar = r));
  t.after(() => terminar());
  const feed = criarFeed({ inicial, now, coletar: async () => inicial });
  const o = createOnboarding({
    company,
    demo,
    biblioteca: lib(),
    feed,
    store,
    disponivel: true,
    now,
    executar: async () => fim,
  });
  const a = o.iniciar(tid, ['cabos']);
  assert.equal(o.iniciar(tid, ['cabos']).turno, a.turno);
  assert.throws(() => o.iniciar(tid, ['tesouras']), /andamento/);
  const outra = structuredClone(inicial);
  outra.pregoes[0].situacao = 'Suspensa';
  const suspenso = criarFeed({ inicial: outra, now, coletar: async () => outra });
  const bloqueado = createOnboarding({
    company,
    demo,
    biblioteca: lib(),
    feed: suspenso,
    store,
    disponivel: true,
    now,
  });
  assert.throws(() => bloqueado.iniciar(tid, ['cabos']), /não permite/);
});
