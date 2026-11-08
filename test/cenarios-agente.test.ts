// Cenários ponta a ponta do agente com MODELO ROTEIRIZADO e FONTES SIMULADAS (sintéticos): ferramentas, decisão,
// persistência, leitura, veredito e documentos são os reais. Provam o encadeamento e os bloqueios do código,
// não a qualidade do modelo real (essa é medida em scripts/auditoria-agente.ts).
import { test, mock, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore, type LanceStore } from '../src/lib/store.ts';
import { tools } from '../src/lib/tools.ts';
import { anvisa, pncp, pdf } from '../src/lib/data.ts';
import { snapshotTender } from '../src/lib/recheck.ts';
import { createReadModel } from '../src/lib/read-model.ts';
import { concluirAnalise } from '../src/lib/experiencia-analise.ts';
import { runOnboardingAnalysis } from '../src/server/onboarding.ts';
import { prepararDocumento } from '../src/server/documentos.ts';
import { passosDoTurno, eficiencia, consistencia } from '../src/lib/auditoria.ts';
import type { LLM } from '../src/lib/agent.ts';

const T = '77816510000166/2026/348';
// Descrição real do item 4 (PNCP); ficha do P1 SINTÉTICA, escrita para cada cenário.
const DESC4 = 'Cabo Bisturi características adicionais: longo, material: aço inoxidável, tamanho: nº 4 CABO DE BISTURI Nº4 13 CM AÇO INOX AUTOCLAVÁVEL - CONFORME DESCRIÇÃO DO EDITAL ';
const LIVRE = 'CABO DE BISTURI Nº4 13 CM AÇO INOX AUTOCLAVÁVEL - CONFORME DESCRIÇÃO DO EDITAL';
const VALIDADE = 'A validade da proposta será de 90 (noventa) dias a contar da data de abertura.';
const EDITAL = `Edital sintético de teste. Os licitantes deverão apresentar Autorização de Funcionamento de Empresa (AFE) expedida pela ANVISA. ${VALIDADE}`;
const now = () => new Date('2026-11-08T12:00:00-03:00');
const baseCompany = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const demo = JSON.parse(readFileSync(new URL('../fixtures/demo.json', import.meta.url), 'utf8'));

function preparar(t: TestContext, o: { ficha?: string; itens?: () => Promise<unknown> } = {}) {
  const company = structuredClone(baseCompany);
  company.catalogo[0].ficha = o.ficha ?? 'Cabo de bisturi nº 4. Material: aço inoxidável AISI 420. Características adicionais: longo. Cabo de bisturi nº4 13 cm aço inox autoclavável.';
  const store = openStore(':memory:', { now });
  t.after(() => { store.close(); mock.restoreAll(); });
  mock.method(pncp, 'items', o.itens ?? (async () => [{ numero: 4, descricao: DESC4, quantidade: 20, valorEstimado: 126.97, unidade: 'Unidade', catalogCode: null, sigiloso: false }]));
  mock.method(pncp, 'files', async () => [{ seq: 1, tipo: 'Edital', titulo: 'Edital sintético', url: 'https://example.org/edital.pdf' }]);
  mock.method(pncp, 'compra', async () => ({ situacaoCompraNome: 'Divulgada no PNCP', dataEncerramentoProposta: '2026-11-23T09:00:00' }));
  mock.method(pdf, 'fromUrl', async () => ({ kind: 'pdf', text: EDITAL + ' '.repeat(600) }));
  const marca = company.catalogo[0].marca;
  mock.method(anvisa, 'byRegistro', () => ({ VALIDADE_REGISTRO_CADASTRO: 'VIGENTE', NOME_COMERCIAL: `Cabo de bisturi ${marca}`, NOME_FABRICANTE: marca, DETENTOR_REGISTRO_CADASTRO: marca, CLASSE_RISCO: 'I' }));
  return { company, store };
}

type Chamada = [string, Record<string, unknown>];
let ultimaMensagemUsuario = '';
async function rodar(store: LanceStore, company: unknown, etapas: Chamada[][], o: { semContagemDeTokens?: boolean } = {}) {
  let i = 0;
  const llm: LLM = { model: 'roteiro-sintetico', chat: async (messages) => {
    ultimaMensagemUsuario = messages.find((m: any) => m.role === 'user')?.content ?? '';
    const chamadas = etapas[i++];
    return { message: chamadas ? { content: null, tool_calls: chamadas.map(([name, args], n) => ({ id: `${i}-${n}`, function: { name, arguments: JSON.stringify(args) } })) }
      : { content: 'Resumo do roteiro.' }, usage: o.semContagemDeTokens
        ? { prompt_tokens: 0, completion_tokens: 0, cost: 0 }
        : { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 }, ms: 1 };
  } };
  await runOnboardingAnalysis({ company: company as any, demo, store, tenderId: T, turno: 'cenario', now, llm: () => llm, ferramentas: tools,
    snapshot: (id, s) => snapshotTender(id, s, { now }) });
  return createReadModel(store, { now, actions: () => store.getActions() });
}

const fitCompleto = (veredito = 'atende') => ['record_fit', { tender_id: T, item: 4, product_id: 'P1', attributes: [
  { atributo: 'características adicionais', veredito, citacao_item: 'características adicionais: longo', ...(veredito === 'nao_informado' ? {} : { citacao_ficha: 'Características adicionais: longo' }) },
  { atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável', citacao_ficha: 'Material: aço inoxidável' },
  { atributo: 'tamanho', veredito: 'atende', citacao_item: 'tamanho: nº 4', citacao_ficha: 'Cabo de bisturi nº 4' },
  { atributo: 'descrição do órgão', veredito: 'atende', citacao_item: LIVRE, citacao_ficha: 'Cabo de bisturi nº4 13 cm aço inox autoclavável' },
] }] as Chamada;
const leituras: Chamada[] = [['list_catalog', {}], ['get_tender_items', { tender_id: T }], ['read_edital', { tender_id: T, topics: ['AFE', 'validade'] }]];

test('sucesso: encaixe completo vira disputa com pendência, proposta e PDFs coerentes, sem repetição evitável', async t => {
  const { company, store } = preparar(t);
  const model = await rodar(store, company, [leituras,
    [['record_requirement', { tender_id: T, requirement: 'afe', quote: 'Autorização de Funcionamento de Empresa (AFE) expedida pela ANVISA' }], fitCompleto()],
    [['decide_item', { tender_id: T, item: 4, product_id: 'P1' }]],
    [['read_proposal_docs', { tender_id: T }]],
    [['record_proposal_rule', { tender_id: T, campo: 'validade_proposta', valor: '90 dias', citacao: VALIDADE }]],
    [['draft_proposal_document', { tender_id: T }], ['draft_document_plan', { tender_id: T }]]]);
  const [d] = store.getDecisions(T);
  assert.equal(d.estado, 'disputar_com_pendencia', JSON.stringify(d.motivos) + ' ' + JSON.stringify(store.getFits(T)[0]?.atributos));   // cobertura do registro não comprovada pelo cliente
  assert.equal(d.precoProposto, 7.5);
  assert.deepEqual(consistencia(store, T), []);
  const ef = eficiencia(passosDoTurno(store, T));
  assert.equal(ef.evitaveis, 0); assert.equal(ef.rejeicoes.length, 0);
  assert.equal(model.dossie(T)!.proposta?.itens[0].precoUnitario, 7.5);
  assert.equal(model.turnos().turnos[0].status, 'concluido');
  assert.deepEqual(store.getActions(), []);
});

test('incompatibilidade: não atende vira nao_disputar e as ferramentas de proposta recusam', async t => {
  const { company, store } = preparar(t, { ficha: 'Cabo de bisturi nº 3. Material: aço carbono. Características adicionais: curto.' });
  await rodar(store, company, [leituras, [['record_fit', { tender_id: T, item: 4, product_id: 'P1', attributes: [
    { atributo: 'características adicionais', veredito: 'nao_atende', citacao_item: 'características adicionais: longo', citacao_ficha: 'Características adicionais: curto' },
    { atributo: 'material', veredito: 'nao_atende', citacao_item: 'material: aço inoxidável', citacao_ficha: 'Material: aço carbono' },
    { atributo: 'tamanho', veredito: 'nao_atende', citacao_item: 'tamanho: nº 4', citacao_ficha: 'Cabo de bisturi nº 3' },
    { atributo: 'descrição do órgão', veredito: 'nao_atende', citacao_item: LIVRE, citacao_ficha: 'Cabo de bisturi nº 3' }] }]],
    [['decide_item', { tender_id: T, item: 4, product_id: 'P1' }]], [['read_proposal_docs', { tender_id: T }]]]);
  assert.equal(store.getDecisions(T)[0].estado, 'nao_disputar');
  const passos = passosDoTurno(store, T);
  assert.match(passos.find(p => p.ferramenta === 'read_proposal_docs')!.saida!, /sem item viável/);
  assert.deepEqual(consistencia(store, T), []);
});

test('informação ausente na ficha: esclarecer (não incompatível), sem proposta', async t => {
  const { company, store } = preparar(t, { ficha: 'Cabo de bisturi nº 4. Material: aço inoxidável AISI 420. Cabo de bisturi nº4 13 cm aço inox autoclavável.' });
  await rodar(store, company, [leituras, [fitCompleto('nao_informado')], [['decide_item', { tender_id: T, item: 4, product_id: 'P1' }]]]);
  const [d] = store.getDecisions(T);
  assert.equal(d.estado, 'esclarecer');
  assert.deepEqual(consistencia(store, T), []);
});

test('citação inventada é recusada; a correção conta como repetição necessária, não desperdício', async t => {
  const { company, store } = preparar(t);
  const inventado = structuredClone(fitCompleto()); (inventado[1] as any).attributes[1].citacao_item = 'material: titânio grau 5';
  await rodar(store, company, [leituras, [inventado], [fitCompleto()], [['decide_item', { tender_id: T, item: 4, product_id: 'P1' }]]]);
  const ef = eficiencia(passosDoTurno(store, T));
  assert.equal(ef.rejeicoes.length, 1);
  assert.deepEqual(ef.repeticoes.map(r => r.classe), ['correcao_apos_rejeicao']);
  assert.equal(ef.evitaveis, 0);
  assert.deepEqual(consistencia(store, T), []);
});

test('fonte de itens fora do ar: nada é decidido e o turno não aparece como concluído', async t => {
  const { company, store } = preparar(t, { itens: async () => { throw new Error('PNCP 503'); } });
  const model = await rodar(store, company, [leituras, [['get_tender_item', { tender_id: T, item: 4 }]]]);
  assert.deepEqual(store.getDecisions(T), []);
  assert.equal(model.turnos().turnos[0].status, 'incompleto');
  assert.match(model.turnos().turnos[0].motivo ?? '', /fonte indisponível.*PNCP 503/);
  assert.deepEqual(consistencia(store, T), ['nenhuma decisão nem dossiê persistidos']);
});

test('edital alterado depois da análise: veredito pede revisão e a proposta não sai', async t => {
  const { company, store } = preparar(t);
  const model = await rodar(store, company, [leituras, [fitCompleto()], [['decide_item', { tender_id: T, item: 4, product_id: 'P1' }]],
    [['read_proposal_docs', { tender_id: T }]], [['record_proposal_rule', { tender_id: T, campo: 'validade_proposta', valor: '90 dias', citacao: VALIDADE }]],
    [['draft_proposal_document', { tender_id: T }]]]);
  store.setReavaliar(T, true);
  const dossie = model.dossie(T)!;
  assert.equal(dossie.reavaliar, true);
  assert.throws(() => prepararDocumento(dossie, 'proposta'), /edital mudou/i);
  assert.equal(concluirAnalise(model.fila() as any, true).estado, 'revisao_necessaria');
  assert.deepEqual(consistencia(store, T), []);
});

test('o auditor acusa incoerência plantada no store (decisão viável sem cobertura e preço adulterado)', async t => {
  const { company, store } = preparar(t);
  await rodar(store, company, [leituras, [fitCompleto()], [['decide_item', { tender_id: T, item: 4, product_id: 'P1' }]],
    [['read_proposal_docs', { tender_id: T }]], [['draft_proposal_document', { tender_id: T }]]]);
  assert.deepEqual(consistencia(store, T), []);
  const [f] = store.getFits(T);
  store.upsertFit({ ...f, atributos: { ...(f.atributos as object), validacao: { cobertura: 'nao_verificada' } } });
  store.upsertDecision({ ...store.getDecisions(T)[0], precoProposto: 9 });
  const erros = consistencia(store, T);
  assert.ok(erros.some(e => /sem cobertura conferida/.test(e)), erros.join(' | '));
  assert.ok(erros.some(e => /difere do calculado/.test(e)), erros.join(' | '));
});

test('escopo: candidatos do catálogo que ficaram sem análise aparecem no dossiê, no veredito e no relatório', async t => {
  const { company, store } = preparar(t);
  const model = await rodar(store, company, [leituras, [fitCompleto()], [['decide_item', { tender_id: T, item: 4, product_id: 'P1' }]]]);
  const candidatos: number[] = [...new Set<number>(demo.pregoes.find((p: any) => p.id === T).matches.map((m: any) => m.item))].sort((a, b) => a - b);
  assert.ok(candidatos.length > 1, 'a fixture real marca mais de um candidato');
  const dossie = model.dossie(T)! as any;
  assert.deepEqual(dossie.escopo, { candidatos, analisados: [4], naoAnalisados: candidatos.filter(n => n !== 4) });
  assert.ok(dossie.pendencias.some((p: string) => /não analisados nesta execução/.test(p)));
  const veredito = concluirAnalise(model.fila() as any, false, false, false, dossie.escopo.naoAnalisados.length);
  assert.match(veredito.detalhe, new RegExp(`${candidatos.length - 1} itens? candidatos? do catálogo não (foi|foram) analisados?`));
  assert.match(prepararDocumento(dossie, 'relatorio').markdown, /não analisados nesta execução/);
});

test('aviso de escopo continua quando a publicação não foi conferida ou o edital mudou', () => {
  for (const [reavaliar, desatualizado, naoConferida] of [[true, false, false], [false, true, false], [false, false, true]]) {
    assert.match(concluirAnalise([{ estadoCodigo: 'disputar' }], reavaliar, desatualizado, naoConferida, 3).detalhe, /3 itens candidatos do catálogo não foram analisados/);
  }
});

test('onboarding interrompe chamadas repetidas sem contagem de tokens no limite padrão', async t => {
  const { company, store } = preparar(t);
  const muitas = Array.from({ length: 40 }, () => [['list_catalog', {}]] as Chamada[]);
  const model = await rodar(store, company, muitas, { semContagemDeTokens: true });
  const turno = model.turnos().turnos[0];
  assert.equal(turno.status, 'incompleto');
  assert.match(turno.motivo ?? '', /limite de passos/);
  assert.equal(passosDoTurno(store, T).filter(passo => passo.ferramenta === 'list_catalog').length, 30);
  assert.ok(eficiencia(passosDoTurno(store, T)).evitaveis > 0, 'leituras idênticas repetidas são desperdício');
});

test('agente para depois do encaixe e antes da decisão: o item escala para o humano (caso da linha de base real)', async t => {
  // Reproduz o padrão da execução real base-348 (08/11): encaixes gravados, limite atingido, nenhuma decisão.
  const { company, store } = preparar(t);
  const incompleto = structuredClone(fitCompleto()); (incompleto[1] as any).attributes.pop();
  await rodar(store, company, [leituras, [incompleto]]);
  assert.deepEqual(store.getDecisions(T), []);
  const esc = store.openEscalations().filter(e => e.tender === T && e.item === '4');
  assert.equal(esc.length, 1);
  assert.match(esc[0].motivo, /sem decisão/);
  assert.deepEqual(consistencia(store, T), []);
});

test('o auditor acusa encaixe sem decisão e sem escalada', async t => {
  const { company, store } = preparar(t);
  await rodar(store, company, [leituras, [fitCompleto()]]);
  for (const e of store.openEscalations()) store.resolveEscalation(e.id, { decisao: 'recusar' });
  store.upsertFit({ tenderId: T, item: 9, produto: 'P1', fit: 'desconhecido', atributos: { attributes: [] } });
  assert.ok(consistencia(store, T).some(e => /item 9: encaixe sem decisão/.test(e)), consistencia(store, T).join(' | '));
});

test('marca de referência exige trecho que fale de marca; a citação real sem marca da execução depois-348 é recusada', async t => {
  const { company, store } = preparar(t);
  mock.method(pncp, 'items', async () => [{ numero: 4, descricao: DESC4 + 'Referência: marca Medicon ou similar.', quantidade: 20, valorEstimado: 126.97, unidade: 'Unidade', catalogCode: null, sigiloso: false }]);
  await rodar(store, company, [leituras, [fitCompleto()], [['decide_item', { tender_id: T, item: 4, product_id: 'P1' }]],
    [['flag_restrictive', { tender_id: T, item: 4, evidence: 'marca_referencia', quote: LIVRE }]],
    [['flag_restrictive', { tender_id: T, item: 4, evidence: 'marca_referencia', quote: 'Referência: marca Medicon ou similar' }]]]);
  const flags = passosDoTurno(store, T).filter(p => p.ferramenta === 'flag_restrictive').map(p => JSON.parse(p.saida!));
  assert.equal(flags[0].aceito, false);
  assert.match(flags[0].motivo, /não fala de marca/);
  assert.equal(flags[1].aceito, true);
  // Sinalização aceita depois da decisão invalida a decisão anterior: o item volta a decide_item ou ao humano.
  assert.match(flags[1].instrucao ?? '', /decide_item/);
  assert.deepEqual(store.getDecisions(T), []);
  assert.equal(store.openEscalations().filter(e => e.item === '4').length, 1);
  assert.deepEqual(consistencia(store, T), []);
});

test('o agente recebe os candidatos do pré-filtro (na execução real depois-2941 buscou às cegas em 235 itens)', async t => {
  const { company, store } = preparar(t);
  await rodar(store, company, [leituras]);
  const matches = demo.pregoes.find((p: any) => p.id === T).matches;
  for (const m of matches) assert.match(ultimaMensagemUsuario, new RegExp(`\\b${m.item} \\(${m.produto}\\)`));
  assert.match(ultimaMensagemUsuario, /não comprova/);
  // Na execução real depois2-2941 o modelo descartou os 5 candidatos só no texto final: nenhuma decisão persistida.
  assert.match(ultimaMensagemUsuario, /record_fit \(também quando não atende/);
  assert.doesNotMatch(ultimaMensagemUsuario, /diga isso no resumo/);
});

test('erro de uso de ferramenta não é chamado de fonte indisponível', async t => {
  const { company, store } = preparar(t);
  const model = await rodar(store, company, [leituras, [['get_product_sheet', { product_id: 'P3' }]]]);
  const motivo = model.turnos().turnos[0].motivo ?? '';
  assert.doesNotMatch(motivo, /fonte indisponível/);
  assert.match(motivo, /erro de uso de ferramenta.*P3/);
});

test('número de item no erro não vira "fonte indisponível"; HTTP e tempo esgotado viram', async () => {
  const { motivoIncompleto } = await import('../src/lib/turn.ts');
  const erro = (m: string) => ({ type: 'tool', name: 'get_tender_item', error: true, result: { error: `falha na ferramenta: ${m}` } });
  assert.match(motivoIncompleto({ stopped: 'final', trace: [erro('item 512 não existe no pregão X')] }, 0), /^erro de uso de ferramenta/);
  assert.match(motivoIncompleto({ stopped: 'final', trace: [erro('HTTP 503: Service Unavailable')] }, 0), /^fonte indisponível/);
  assert.match(motivoIncompleto({ stopped: 'final', trace: [erro('timeout após 4 tentativas: https://pncp.gov.br/x')] }, 0), /^fonte indisponível/);
});
