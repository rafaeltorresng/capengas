// Casos sintéticos: rede simulada, sem modelo e sem envio real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../src/lib/store.ts';
import { runMonitor } from '../src/lib/monitor.ts';
import { snapshotTender, filesHash } from '../src/lib/recheck.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { createServer } from '../src/server/api.ts';
import { createIntegratedStore } from '../src/server/integrated.ts';
import { executarAcao } from '../src/lib/act.ts';

const T = '77816510000166/2026/348';
const desc = 'Cabo material: aço inoxidável, tamanho: nº 4';
const company = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));
const now = () => new Date('2026-11-07T10:00:00-03:00');
async function setup(path = ':memory:') {
  const store = openStore(path, { now });
  let files = [{ seq: 1, titulo: 'Edital', tipo: 'Edital', url: 'https://pncp.gov.br/1' }];
  let abertura: string | null = '2026-11-23T09:00';
  let quantidade = 10, falhar = false;
  const fetchCompra = async () => ({ situacaoCompraNome: 'Divulgada no PNCP', dataEncerramentoProposta: abertura });
  const fetchFiles = async () => files;
  await snapshotTender(T, store, { now, fetchCompra, fetchFiles, base: { abertura, orgao: 'Órgão de teste' } });
  store.upsertItems(T, [{ tenderId: T, numero: 4, descricao: desc, catalogCode: null, quantidade, estimativa: 200, sigiloso: false }]);
  store.upsertFit({ tenderId: T, item: 4, produto: 'P1', fit: 'atende', atributos: { attributes: [{ citacao_item: 'tamanho: nº 4' }] } });
  store.upsertDecision({ tenderId: T, item: 4, produto: 'P1', estado: 'disputar', motivos: ['Teste sintético'], precoProposto: 120 });
  store.upsertDossie(T, { tender: T, pregao: T, versao: '1', checklist: [], documentos: [], pendencias: [], itens: [], envioAutomaticoLiberado: false });
  const deps = { now, fetchCompra, fetchFiles, errata: { politica: company.politica, custos: { P1: 100 },
    fetchItems: async () => { if (falhar) throw Error('PNCP 503'); return [{ numero: 4, descricao: desc, quantidade, valorEstimado: 200, sigiloso: false }]; },
    fetchTextos: async () => [{ nome: 'Errata sintética', url: files.at(-1)!.url, texto: 'Texto de teste.' }] } };
  return { store, deps, mudar: (q: number, opening = abertura) => { quantidade = q; abertura = opening; files = [...files, { seq: files.length + 1, titulo: 'Errata sintética', tipo: 'Errata', url: `https://pncp.gov.br/${files.length + 1}` }]; },
    falhar: (v: boolean) => { falhar = v; } };
}

test('monitor persiste versão e diff; reabrir mantém dossiê/API, pauta única e hash antigo', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lance-retificacao-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'lance.db');
  const h = await setup(path); h.mudar(500);
  await runMonitor(h.store, h.deps);
  const hash = filesHash([{ seq: 1, titulo: 'Edital', tipo: 'Edital', url: 'https://pncp.gov.br/1' }]);
  assert.equal(h.store.getTender(T)?.arquivosHash, hash);
  h.store.close();
  const store = openStore(path, { now }); t.after(() => store.close());
  const dossier = store.getDossie(T) as any;
  assert.equal(dossier.retificacao.versao, 1);
  assert.equal(dossier.retificacao.linhas.find((l: any) => l.estado === 'reaproveitada').chamarAgente, false);
  assert.equal(dossier.retificacao.linhas.find((l: any) => l.estado === 'recalculada').valorTotal, 62500);
  assert.equal(store.getRetificacoes(T).length, 1);
  assert.equal(store.getItems(T)[0].quantidade, 10, 'foto analisada continua intacta');
  const model = createReadModel(store, { actions: () => [], now, sancoes: [] });
  const server = createServer(createIntegratedStore(store, model)); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(r => server.close(() => r())));
  const { port } = server.address() as { port: number };
  const body = await (await fetch(`http://127.0.0.1:${port}/api/dossies/${encodeURIComponent(T)}`)).json();
  const version = body.dados.retificacao;
  const agenda = model.pauta().linhas.filter(l => l.tipo === 'errata');
  assert.deepEqual(version.pauta, agenda);
  assert.ok(version.pauta.some((l: any) => l.papel === 'analista' && l.ate === '2026-11-23' && l.id.endsWith(':limite')));
  assert.equal(version.pauta.find((l: any) => l.id.endsWith(':art55')).ate, '2026-11-17');
  assert.ok(version.pauta.every((l: any) => l.fonte?.url));
  assert.equal(version.custoEvitadoUsd, null);
  assert.equal(version.chamadasEvitadas, undefined, 'itens reaproveitados não medem chamadas evitadas');
  assert.equal(store.getTender(T)?.reavaliar, true);
});

test('outra publicação pendente gera nova versão; rodada igual não duplica', async t => {
  const h = await setup(); t.after(() => h.store.close());
  h.mudar(20); await runMonitor(h.store, h.deps); await runMonitor(h.store, h.deps);
  assert.equal(h.store.getRetificacoes(T).length, 1);
  h.mudar(30, '2026-11-23T14:00'); await runMonitor(h.store, h.deps);
  assert.equal(h.store.getRetificacoes(T).length, 2);
  assert.equal(h.store.getErrataDiff(T)?.abertura.antes, '2026-11-23T09:00');
  assert.equal(h.store.getErrataDiff(T)?.itens[0].mudancas[0].antes, 10);
});

test('falha no primeiro diff tenta novamente sem renovar foto', async t => {
  const h = await setup(); t.after(() => h.store.close());
  h.mudar(20); h.falhar(true); await runMonitor(h.store, h.deps);
  assert.equal(h.store.getErrataDiff(T), undefined);
  assert.equal(h.store.getTender(T)?.reavaliar, true);
  h.falhar(false); await runMonitor(h.store, h.deps);
  assert.equal(h.store.getRetificacoes(T).length, 1);
});

test('abertura removida é desconhecida; não mantém a data anterior como publicada', async t => {
  const h = await setup(); t.after(() => h.store.close());
  h.mudar(20, null); await runMonitor(h.store, h.deps);
  assert.equal(h.store.getTender(T)?.abertura, null);
  assert.equal(h.store.getErrataDiff(T)?.abertura.estado, 'desconhecida');
  const m = createReadModel(h.store, { actions: () => [], now, sancoes: [] });
  assert.ok(m.pauta().linhas.filter(l => l.tipo === 'errata').every(l => !l.acionavel && l.ate === null));
});

test('ajuste humano pertence à versão aberta, reaparece na seguinte e sobrevive à reanálise', async t => {
  const h = await setup(); t.after(() => h.store.close());
  h.mudar(20); await runMonitor(h.store, h.deps);
  const esc = h.store.openEscalation({ tender: T, item: '4', motivo: 'Conferir medida', recomendacao: 'Revisar', prazo: '2026-11-23T09:00:00-03:00' });
  assert.equal(h.store.resolveEscalation(esc.id, { decisao: 'ajustar', ajuste: 'Conferir medida com o fabricante' }).status, 'salva');
  h.mudar(30); await runMonitor(h.store, h.deps);
  const versions = h.store.getRetificacoes(T);
  assert.match(versions[1].linhas[0].discordancia ?? '', /versão 1.*Conferir medida com o fabricante/);
  assert.equal(versions[0].linhas[0].discordancia, undefined, 'histórico imutável');
  h.store.upsertDossie(T, { tender: T, pregao: T, versao: 'nova análise', checklist: [], documentos: [], pendencias: [], itens: [] });
  assert.equal((h.store.getDossie(T) as any).retificacao.versao, 2);
});

test('diff e versão têm transação: falha ao escrever dossiê desfaz tudo e mantém bloqueio', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lance-rollback-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'lance.db'); const h = await setup(path); t.after(() => h.store.close());
  const db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER falhar_dossie BEFORE UPDATE ON dossies BEGIN SELECT RAISE(ABORT, 'falha de teste'); END;"); db.close();
  h.mudar(20); await runMonitor(h.store, h.deps);
  assert.equal(h.store.getErrataDiff(T), undefined);
  assert.equal(h.store.getRetificacoes(T).length, 0);
  assert.equal(h.store.getTender(T)?.reavaliar, true);
});

test('porta direta barra reavaliar mesmo com recheque ok e não faz POST', async t => {
  const h = await setup(); t.after(() => h.store.close()); h.store.setReavaliar(T, true);
  let posts = 0;
  const result = await executarAcao({ tipo: 'enviar_proposta', tenderId: T, itens: [4] }, {
    store: h.store, politica: company.politica, empresa: 'Sintética', catalogo: [{ id: 'P1', marca: 'Teste', registroAnvisa: '12345678901' }], sandboxUrl: 'http://sandbox.test', now,
    recheck: async () => ({ status: 'ok', situacao: 'Divulgada no PNCP', arquivosHash: 'teste', em: now().toISOString() }),
    enviar: async () => { posts++; return { status: 201, body: { protocolo: 'SBX' } }; }, consultar: async () => ({ encontrado: true, registro: {} }),
  });
  assert.equal(result.resultado, 'bloqueada'); assert.equal(posts, 0); assert.equal(h.store.getActions().length, 0);
});

test('data corrente fecha ação jurídica na pauta e no dossiê sem alterar histórico', async t => {
  const h = await setup(); t.after(() => h.store.close()); h.mudar(20); await runMonitor(h.store, h.deps);
  const model = createReadModel(h.store, { actions: () => [], sancoes: [], now: () => new Date('2026-11-19T10:00:00-03:00') });
  assert.equal(model.pauta().linhas.find(l => l.id.endsWith(':art55'))?.acionavel, false);
  assert.equal((model.dossie(T) as any).retificacao.pauta.find((l: any) => l.id.endsWith(':art55')).acionavel, false);
  assert.equal(h.store.getRetificacoes(T)[0].pauta.find(l => l.id.endsWith(':art55'))?.acionavel, true);
});

test('abertura muda sem arquivo novo; falha do diff é retomada no próximo monitor', async t => {
  const h = await setup(); t.after(() => h.store.close());
  const deps = { ...h.deps, fetchCompra: async () => ({ situacaoCompraNome: 'Divulgada no PNCP', dataEncerramentoProposta: '2026-11-24T09:00' }) };
  h.falhar(true); await runMonitor(h.store, deps); h.falhar(false);
  await runMonitor(h.store, deps);
  assert.equal(h.store.getRetificacoes(T).length, 1);
  assert.equal(h.store.getErrataDiff(T)?.abertura.antes, '2026-11-23T09:00');
  assert.equal(h.store.getErrataDiff(T)?.abertura.estado, 'mudou');
  await runMonitor(h.store, deps);
  assert.equal(h.store.getRetificacoes(T).length, 1);
});

test('reimportar a mesma publicação é idempotente, mesmo com outro horário de observação', async t => {
  const h = await setup(); t.after(() => h.store.close()); h.mudar(20); await runMonitor(h.store, h.deps);
  const diff = h.store.getErrataDiff(T)!;
  h.store.saveErrataDiff({ ...diff, publicacao: { ...diff.publicacao!, observadoEm: '2026-11-08T10:00:00-03:00' } });
  assert.equal(h.store.getRetificacoes(T).length, 1);
});

test('mudança marcada durante recheque também impede intenção e POST', async t => {
  const h = await setup(); t.after(() => h.store.close()); let posts = 0;
  const result = await executarAcao({ tipo: 'enviar_proposta', tenderId: T, itens: [4] }, {
    store: h.store, politica: company.politica, empresa: 'Sintética', catalogo: [{ id: 'P1', marca: 'Teste', registroAnvisa: '12345678901' }], sandboxUrl: 'http://sandbox.test', now,
    recheck: async () => { h.store.setReavaliar(T, true); return { status: 'ok', situacao: 'Divulgada no PNCP', arquivosHash: 'teste', em: now().toISOString() }; },
    enviar: async () => { posts++; return { status: 201, body: { protocolo: 'SBX' } }; }, consultar: async () => ({ encontrado: true, registro: {} }),
  });
  assert.equal(result.resultado, 'bloqueada'); assert.equal(posts, 0); assert.equal(h.store.getActions().length, 0);
});

test('migração mantém diff legado sem inventar versão retroativa', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'lance-migracao-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'lance.db'); const h = await setup(path); h.mudar(20); await runMonitor(h.store, h.deps);
  const diff = h.store.getErrataDiff(T); h.store.close();
  const db = new DatabaseSync(path);
  db.exec('ALTER TABLE errata_diffs DROP COLUMN versao_json; ALTER TABLE escalations DROP COLUMN versao_retificacao; ALTER TABLE tenders DROP COLUMN abertura_analise;'); db.close();
  const store = openStore(path, { now }); t.after(() => store.close());
  assert.deepEqual(store.getErrataDiff(T), diff);
  assert.deepEqual(store.getRetificacoes(T), []);
});
