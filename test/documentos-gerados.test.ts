import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gerarDocumento, impedimento, GERAVEIS } from '../src/lib/documentos-gerados.ts';
import { montarPlano, deRegrasProposta } from '../src/lib/plano-documentos.ts';
import type { RegraProposta } from '../src/lib/regras-proposta.ts';
import type { ConferenciaRegistro } from '../src/lib/catalogo.ts';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { newState } from '../src/lib/tools.ts';
import { persistAnalysis } from '../src/lib/persist-analysis.ts';
import { gerarDocumentoProposta } from '../src/lib/documento-proposta.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { createIntegratedStore } from '../src/server/integrated.ts';
import { createServer } from '../src/server/api.ts';
import { prepararDocumentoGerado } from '../src/server/documentos.ts';
import { eventoTurno } from '../src/lib/turnos.ts';

const empresa = { nome: 'Distribuidora Modelo Ltda (fictícia)', porte: 'EPP', atuacao: 'distribuidora', municipio: 'Curitiba',
  representante: { nome: 'Ana Souza', cargo: 'Sócia-administradora', cpf: '000.000.000-00' } };
const pregao = { id: '00394452000103/2026/22617', orgao: 'Comando do Exército' };
const hoje = new Date('2026-11-08T12:00:00Z');
const linha = (tipo: string, citacao = 'declaração de que atende aos requisitos de habilitação') =>
  ({ tipo, citacao, fonte: { nome: 'Edital.pdf', url: 'https://pncp.gov.br/x' } });
const confere = (registro: string, marca: string): ConferenciaRegistro => ({ produto: 'P1', registro, status: 'confere', motivo: `registro ANVISA ${registro} vigente e da marca ${marca}`,
  anvisa: { registro, nomeTecnico: 'Cabo de bisturi', nomeComercial: `Cabo ${marca}`, fabricante: marca, detentor: `${marca} Ltda`, classe: 'I', validade: '01/01/2030' } });
const itens = [
  { item: 1, descricao: 'Cabo de bisturi nº 4', produto: { nome: 'Cabo nº 4', marca: 'Straumed', registroAnvisa: '82936150004' }, anvisa: { regularizacao: 'vigente', conferencia: confere('82936150004', 'Straumed') } },
  { item: 3, descricao: 'Lâmina nº 15', produto: { nome: 'Lâmina 15', marca: 'Jumper', registroAnvisa: '80000000001' }, anvisa: { regularizacao: 'vigente', conferencia: confere('80000000001', 'Jumper') } },
];

test('gera as 7 declarações e o comprovante ANVISA, e nada além disso', () => {
  assert.deepEqual([...GERAVEIS].sort(), ['declaracao_custos_trabalhistas', 'declaracao_habilitacao', 'declaracao_integridade', 'declaracao_me_epp',
    'declaracao_menor', 'declaracao_pcd', 'declaracao_pleno_acordo', 'registro_anvisa']);
  assert.throws(() => gerarDocumento({ tipo: 'carta_solidariedade', linha: linha('carta_solidariedade'), pregao, empresa, itens, hoje }), /não gera/);
  assert.throws(() => gerarDocumento({ tipo: 'declaracao_outra', linha: linha('declaracao_outra'), pregao, empresa, itens, hoje }), /não gera/);
});

test('declaração tem destinatário, pregão, empresa, texto com base legal, assinatura e a exigência citada', () => {
  const d = gerarDocumento({ tipo: 'declaracao_menor', linha: linha('declaracao_menor', 'não emprega menor de 18 anos'), pregao, empresa, itens, hoje });
  assert.match(d.markdown, /^# DECLARAÇÃO DE NÃO EMPREGO DE MENOR/);
  assert.match(d.markdown, /Comando do Exército/);
  assert.match(d.markdown, /00394452000103\/2026\/22617/);
  assert.match(d.markdown, /Distribuidora Modelo Ltda \(fictícia\)/);
  assert.match(d.markdown, /menor de 18 \(dezoito\) anos/);
  assert.match(d.markdown, /art\. 7º, XXXIII, da Constituição Federal/);
  assert.match(d.markdown, /Curitiba, 08 de novembro de 2026/);
  assert.match(d.markdown, /Ana Souza/);
  assert.match(d.markdown, /> não emprega menor de 18 anos/);
  assert.match(d.markdown, /Edital\.pdf/);
  assert.equal(d.titulo, 'Declaração de não emprego de menor');
});

test('dado que falta vira [preencher] e pendência; nunca inventa CNPJ', () => {
  const d = gerarDocumento({ tipo: 'declaracao_habilitacao', linha: linha('declaracao_habilitacao'), pregao, empresa, itens, hoje });
  assert.match(d.markdown, /CNPJ sob o nº \[preencher\]/);
  assert.ok(d.pendencias.includes('dado da empresa: CNPJ'));
  const completa = gerarDocumento({ tipo: 'declaracao_habilitacao', linha: linha('declaracao_habilitacao'), pregao, empresa: { ...empresa, cnpj: '11.222.333/0001-81' }, itens, hoje });
  assert.deepEqual(completa.pendencias, []);
});

test('o que a declaração afirma tem de estar no cadastro: ME/EPP pelo porte, integridade pelo programa declarado', () => {
  assert.equal(impedimento('declaracao_me_epp', empresa), null);
  assert.equal(impedimento('declaracao_me_epp', { ...empresa, porte: 'Demais' })?.status, 'nao_se_aplica');
  assert.equal(impedimento('declaracao_me_epp', { nome: 'X' })?.status, 'conferir');
  assert.equal(impedimento('declaracao_integridade', empresa)?.status, 'conferir');
  assert.match(impedimento('declaracao_integridade', empresa)!.motivo, /programa de integridade/);
  assert.equal(impedimento('declaracao_integridade', { ...empresa, programaIntegridade: true }), null);
  assert.throws(() => gerarDocumento({ tipo: 'declaracao_integridade', linha: linha('declaracao_integridade'), pregao, empresa, itens, hoje }), /programa de integridade/);
  const me = gerarDocumento({ tipo: 'declaracao_me_epp', linha: linha('declaracao_me_epp'), pregao, empresa, itens, hoje });
  assert.match(me.markdown, /empresa de pequeno porte/);
  assert.match(me.markdown, /art\. 3º da Lei Complementar nº 123/);
});

test('comprovante ANVISA lista cada item com os dados da base oficial e diz que não é documento da ANVISA', () => {
  const d = gerarDocumento({ tipo: 'registro_anvisa', linha: linha('registro_anvisa', 'número do Registro do produto na ANVISA'), pregao, empresa, itens, hoje });
  assert.match(d.markdown, /^# COMPROVANTE DE REGULARIZAÇÃO NA ANVISA/);
  assert.match(d.markdown, /\| 1 \| Cabo de bisturi nº 4 \| Straumed \| 82936150004 \| 01\/01\/2030 \| Straumed Ltda \| Straumed \| I \|/);
  assert.match(d.markdown, /\| 3 \| Lâmina nº 15 \| Jumper \| 80000000001 \|/);
  assert.match(d.markdown, /TA_PRODUTO_SAUDE_SITE/);
  assert.match(d.markdown, /não é emitido pela ANVISA/i);
  assert.match(d.markdown, /consulta.*08\/11\/2026/i);
});

test('comprovante ANVISA não sai se algum item não confere com a base', () => {
  const ruim = [itens[0], { ...itens[1], anvisa: { regularizacao: 'vencido', conferencia: { ...confere('80000000001', 'Jumper'), status: 'vencido' as const, motivo: 'registro ANVISA 80000000001 vencido' } } }];
  assert.throws(() => gerarDocumento({ tipo: 'registro_anvisa', linha: linha('registro_anvisa'), pregao, empresa, itens: ruim, hoje }), /item 3.*vencido/);
  assert.throws(() => gerarDocumento({ tipo: 'registro_anvisa', linha: linha('registro_anvisa'), pregao, empresa, itens: [{ ...itens[0], anvisa: null }], hoje }), /item 1/);
});

const regra = (campo: RegraProposta['campo'], valor: string, citacao: string): RegraProposta => ({ campo, valor, citacao, fonte: { nome: 'Edital', url: 'u' } });
test('plano só promete "O Lance gera" para o que o Lance consegue gerar com o cadastro', () => {
  const exigencias = deRegrasProposta([
    regra('declaracoes', 'integridade', 'declaração do licitante de que desenvolve programa de integridade, conforme Decreto n° 12.304, de 2024'),
    regra('declaracoes', 'custos', 'declaração de que suas propostas econômicas compreendem a integralidade dos custos para atendimento dos direitos trabalhistas'),
    regra('declaracoes', 'ME/EPP', 'declaração de que é microempresa ou empresa de pequeno porte'),
    regra('declaracoes', 'outra', 'declaração de que não possui sócio servidor do órgão'),
  ]);
  const base = { tenderId: 't', exigencias, cofre: [], sessao: null, hoje: '2026-11-08', produtos: [] };
  const l = Object.fromEntries(montarPlano({ ...base, empresa }).linhas.map(x => [x.tipo, x]));
  assert.equal(l.declaracao_custos_trabalhistas.status, 'lance_gera');
  assert.equal(l.declaracao_me_epp.status, 'lance_gera');
  assert.equal(l.declaracao_integridade.status, 'conferir'); assert.equal(l.declaracao_integridade.responsavel, 'humano');
  assert.match(l.declaracao_integridade.acao, /programa de integridade/);
  assert.equal(l.declaracao_outra.status, 'conferir'); assert.equal(l.declaracao_outra.responsavel, 'humano');
  const grande = Object.fromEntries(montarPlano({ ...base, empresa: { ...empresa, porte: 'Demais', programaIntegridade: true } }).linhas.map(x => [x.tipo, x]));
  assert.equal(grande.declaracao_me_epp.status, 'nao_se_aplica');
  assert.equal(grande.declaracao_integridade.status, 'lance_gera');
});

const tid = '77816510000166/2026/348';
const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const agora = () => new Date('2026-11-08T12:00:00Z');
function caso() {
  // Caso unitário sintético: não é decisão produzida por uma análise real.
  const st = newState(company, 'http://127.0.0.1:9', agora());
  const p1 = company.catalogo[0];
  st.tenders[tid] = { orgao: 'Órgão de teste', abertura: '2026-11-23T09:00' };
  st.items[tid] = [{ numero: 1, descricao: 'Cabo cirúrgico de teste', unidade: 'Unidade', quantidade: 10, valorEstimado: 12 }];
  st.decisions[tid + '#1'] = { produto: p1.id, estado: 'disputar', motivos: ['Caso de teste'], precoProposto: 7.5,
    anvisa: { regularizacao: 'vigente', conferencia: confere(p1.registroAnvisa, p1.marca) } };
  st.proposalRules = { [tid]: [
    regra('declaracoes', 'pleno acordo', 'declaramos que estamos de pleno acordo com todas as condições estabelecidas no Edital e seus anexos'),
    regra('declaracoes', 'integridade', 'declaração do licitante de que desenvolve programa de integridade'),
    regra('registro_anvisa', 'registro', 'Comprovação da regularização dos produtos ofertados perante a ANVISA'),
  ] };
  st.proposals![tid] = gerarDocumentoProposta({ pregao: { id: tid, orgao: 'Órgão de teste' }, empresa: company.empresa,
    itens: [{ numero: 1, descricao: 'Cabo cirúrgico de teste', unidade: 'Unidade', quantidade: 10, marca: p1.marca, registroAnvisa: p1.registroAnvisa, precoUnitario: 7.5 }],
    regras: st.proposalRules[tid], hoje: agora(), origemDados: 'sinteticos' });
  return st;
}

test('exporta cada documento que o plano marca como "O Lance gera"; recusa o que o plano não promete ou o cadastro não sustenta', () => {
  const store = openStore(':memory:', { now: agora });
  try {
    persistAnalysis(caso(), store, { analiseId: 'execucao-teste' });
    const d = createReadModel(store, { now: agora, actions: () => [] }).dossie(tid)!;
    const acordo = prepararDocumentoGerado(d, 'declaracao_pleno_acordo');
    assert.match(acordo.markdown, /^# MINUTA PARA REVISÃO E ASSINATURA/);
    assert.match(acordo.markdown, /sintéticos/);
    assert.match(acordo.markdown, /# DECLARAÇÃO DE PLENO ACORDO COM O EDITAL/);
    assert.equal(acordo.nomeArquivo, 'lance-declaracao_pleno_acordo-77816510000166-2026-348.pdf');
    assert.match(prepararDocumentoGerado(d, 'registro_anvisa').markdown, new RegExp(`\\| 1 \\| Cabo cirúrgico de teste \\| ${company.catalogo[0].marca} \\| ${company.catalogo[0].registroAnvisa} \\|`));
    assert.throws(() => prepararDocumentoGerado(d, 'declaracao_integridade'), (e: any) => e.status === 409 && /programa de integridade/.test(e.message));
    assert.throws(() => prepararDocumentoGerado(d, 'declaracao_menor'), (e: any) => e.status === 409 && /plano/.test(e.message));
    assert.throws(() => prepararDocumentoGerado(d, 'carta_solidariedade'), (e: any) => e.status === 404);
    assert.throws(() => prepararDocumentoGerado({ ...d, desatualizado: true }, 'declaracao_pleno_acordo'), (e: any) => e.status === 409);
  } finally { store.close(); }
});

test('rota /api/dossies/<id>/<tipo>.pdf devolve PDF e exige análise concluída', async t => {
  const store = openStore(':memory:', { now: agora }); t.after(() => store.close());
  persistAnalysis(caso(), store, { analiseId: 'execucao-teste' });
  const model = createReadModel(store, { now: agora, actions: () => [] });
  const app = createServer(createIntegratedStore(store, model));
  app.listen(0, '127.0.0.1'); await once(app, 'listening'); t.after(() => new Promise<void>(r => app.close(() => r())));
  const base = `http://127.0.0.1:${(app.address() as { port: number }).port}/api/dossies/${encodeURIComponent(tid)}`;
  assert.equal((await fetch(base + '/declaracao_pleno_acordo.pdf?analise=execucao-teste')).status, 409);
  store.logEvent(eventoTurno({ turno: 'execucao-teste', tipo: 'inicio', pregoes: [tid] }));
  store.logEvent(eventoTurno({ turno: 'execucao-teste', tipo: 'fim', status: 'concluido', resultados: [] }));
  const r = await fetch(base + '/declaracao_pleno_acordo.pdf?analise=execucao-teste');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition')!, /lance-declaracao_pleno_acordo-/);
  assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await fetch(base + '/registro_anvisa.pdf?analise=execucao-teste')).status, 200);
  assert.equal((await fetch(base + '/declaracao_integridade.pdf?analise=execucao-teste')).status, 409);
  assert.equal((await fetch(base + '/carta_solidariedade.pdf?analise=execucao-teste')).status, 404);
  assert.deepEqual(store.getActions(), []);
});
