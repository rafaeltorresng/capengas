// Fase 1 da #25 de ponta a ponta: o monitor vê a errata, calcula o diff sem modelo, grava no SQLite, e a
// pauta chega pela API com a linha do art. 55, §1º e o link para a fonte. Rede e modelo simulados.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { openStore } from '../src/lib/store.ts';
import { snapshotTender, type PncpFile } from '../src/lib/recheck.ts';
import { runMonitor } from '../src/lib/monitor.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { createIntegratedStore } from '../src/server/integrated.ts';
import { createSampleStore } from '../src/server/sample.ts';
import { createServer } from '../src/server/api.ts';

const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const custos = Object.fromEntries(company.catalogo.map((p: any) => [p.id, p.custo]));
const T = '77816510000166/2026/348';
const DESC = 'Cabo Bisturi características adicionais: longo, material: aço inoxidável, tamanho: nº 4';
const AFE = 'Autorização de Funcionamento de Empresa (AFE) expedida pela ANVISA';
const now = () => new Date('2026-11-07T10:00:00-03:00');
const edital: PncpFile = { seq: 1, titulo: 'EDITAL PE 90114.2026.pdf', tipo: 'Edital', url: 'https://pncp.gov.br/edital.pdf' };
const errata: PncpFile = { seq: 9, titulo: 'ERRATA 01.pdf', tipo: 'Errata', url: 'https://pncp.gov.br/errata.pdf' };

async function cenario(o: { fetchItems?: () => Promise<any> } = {}) {
  const store = openStore(':memory:', { now });
  let files = [edital];
  const fetchCompra = async () => ({ situacaoCompraNome: 'Divulgada no PNCP', dataEncerramentoProposta: '2026-11-23T09:00:00' });
  const fetchFiles = async () => files;
  await snapshotTender(T, store, { fetchCompra, fetchFiles, now, base: { orgao: 'Município de Francisco Beltrão', uf: 'PR', abertura: '2026-11-23T09:00' } });
  store.upsertItems(T, [{ tenderId: T, numero: 4, descricao: DESC, catalogCode: null, quantidade: 100, estimativa: 12, sigiloso: false }]);
  store.upsertFit({ tenderId: T, item: 4, produto: 'P1', fit: 'atende', atributos: { attributes: [{ atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável' }] } });
  store.upsertDecision({ tenderId: T, item: 4, produto: 'P1', estado: 'disputar', motivos: ['atende'], precoProposto: 7.5 });
  store.upsertRequirement({ tenderId: T, tipo: 'afe', citacao: AFE });
  files = [edital, errata];   // a errata saiu no PNCP
  const r = await runMonitor(store, { fetchCompra, fetchFiles, now, errata: { politica: company.politica, custos,
    fetchItems: o.fetchItems ?? (async () => [{ numero: 4, descricao: DESC, quantidade: 150, valorEstimado: 12, sigiloso: false }]),
    fetchTextos: async () => [{ nome: 'ERRATA 01.pdf', url: errata.url, texto: `Os licitantes apresentarão ${AFE} e certidões.` }] } });
  return { store, r };
}

describe('monitor → diff → pauta → API', () => {
  test('o monitor grava o diff, marca reavaliar e explica no evento', async () => {
    const { store, r } = await cenario();
    assert.equal(r.mudancas, 1);
    assert.equal(store.getTender(T)?.reavaliar, true);
    const d = store.getErrataDiff(T)!;
    assert.equal(d.itens[0].evidencia, 'reaproveitada');
    assert.equal(d.itens[0].preco?.estado, 'recalculada');
    assert.equal(d.exigencias[0].estado, 'reaproveitada');
    assert.equal(d.prazoNaoReaberto?.prazo.data, '2026-11-17');
    const ev = store.events().find(e => e.tipo === 'monitor_mudanca')!;
    assert.match(ev.detalhe ?? '', /sem modelo/);
    assert.match(ev.detalhe ?? '', /art\. 55, §1º/);
  });

  test('fonte dos itens fora do ar: sem diff, erro registrado, pregão continua marcado', async () => {
    const { store } = await cenario({ fetchItems: async () => { throw new Error('PNCP 503'); } });
    assert.equal(store.getErrataDiff(T), undefined);
    assert.equal(store.getTender(T)?.reavaliar, true);
    assert.ok(store.events().some(e => e.tipo === 'erro_fonte' && /diff da errata/.test(e.resumo)));
  });

  test('a pauta chega pela API com a linha jurídica e a fonte', async t => {
    const { store } = await cenario();
    const model = createReadModel(store, { actions: () => store.getActions(), now, sancoes: [] });
    const server = createServer(createIntegratedStore(store, model));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise<void>(res => server.close(() => res())));
    const { port } = server.address() as { port: number };
    const body = await (await fetch(`http://127.0.0.1:${port}/api/pauta`)).json();
    assert.equal(body.origem, 'integrado');
    const art55 = body.dados.linhas.find((l: any) => l.papel === 'juridico' && l.tipo === 'errata');
    assert.equal(art55.ate, '2026-11-17');
    assert.equal(art55.fonte.url, `https://pncp.gov.br/app/editais/${T}`);
    assert.ok(body.dados.linhas.some((l: any) => l.tipo === 'calendario'));
    assert.equal(body.dados.linhas.some((l: any) => l.tipo === 'sancao'), false);
  });

  test('a amostra responde a pauta vazia, sem inventar linhas', async t => {
    const server = createServer(createSampleStore());
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => new Promise<void>(res => server.close(() => res())));
    const { port } = server.address() as { port: number };
    const body = await (await fetch(`http://127.0.0.1:${port}/api/pauta`)).json();
    assert.equal(body.origem, 'amostra');
    assert.deepEqual(body.dados.linhas, []);
  });
});
