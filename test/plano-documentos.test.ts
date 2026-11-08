import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deRegrasProposta, deRequisitos, montarPlano, registrarExigencia, condicoesDe, prazoDe, type ExigenciaDocumental, type ProdutoViavel } from '../src/lib/plano-documentos.ts';
import type { RegraProposta } from '../src/lib/regras-proposta.ts';
import { tools, newState } from '../src/lib/tools.ts';
import { buildDossie } from '../src/lib/dossie.ts';
import { pncp, pdf } from '../src/lib/data.ts';
afterEach(() => mock.restoreAll());

const regra = (campo: RegraProposta['campo'], valor: string, citacao: string): RegraProposta => ({ campo, valor, citacao, fonte: { nome: 'Edital', url: 'u' } });
const tipos = (xs: ExigenciaDocumental[]) => xs.map(x => x.tipo);

// Citações copiadas das regras extraídas dos editais reais (out/regras-proposta).
const AERONAUTICA_2941 = [
  regra('modelo_proposta', 'Anexo V', 'ANEXO V – Modelo de Proposta (Timbre ou dados da empresa) À Base Aérea de Anápolis'),
  regra('prazo_envio', '2 horas', '7.26.4 O Pregoeiro/Agente de Contratação/Comissão solicitará ao licitante mais bem classificado que, no prazo de 2 (duas) horas, envie a proposta adequada ao último lance'),
  regra('documentos_anexos', 'carta de solidariedade', '8.15. Caso o Termo de Referência exija a apresentação de carta de solidariedade emitida pelo fabricante, que assegure a execução do contrato, no caso de licitante revendedor ou distribuidor, o licitante classificado em primeiro lugar deverá apresentá-la'),
  regra('documentos_anexos', 'amostra', '8.16. Caso o Termo de Referência/Projeto Básico exija a apresentação de amostra, o licitante classificado em primeiro lugar deverá apresentá-la'),
  regra('declaracoes', 'ME/EPP', '5.8. O fornecedor enquadrado como microempresa, empresa de pequeno porte ou sociedade cooperativa deverá declarar, ainda, em campo próprio do sistema eletrônico, que cumpre os requisitos estabelecidos no artigo 3° da Lei Complementar nº 123, de 2006'),
  regra('declaracoes', 'pleno acordo', 'Por fim, declaramos que estamos de pleno acordo com todas as condições estabelecidas no Edital e seus anexos'),
];
const EXERCITO_22617 = [
  regra('documentos_anexos', 'catálogos', 'a exemplo de catálogos, folhetos ou propostas, em português;'),
  regra('documentos_anexos', 'amostra', 'As amostras dos itens solicitados deverão ser apresentadas no prazo máximo de 3 (três) dias úteis, a contar da solicitação'),
  regra('registro_anvisa', 'registro', 'o número do Registro do produto na ANVISA ou sua dispensa, que deverá estar em conformidade com a amostra;'),
  regra('declaracoes', 'habilitação', 'Será verificado se o licitante apresentou declaração de que atende aos requisitos de habilitação'),
  regra('declaracoes', 'PcD', 'Será verificado se o licitante apresentou no sistema, sob pena de inabilitação, a declaração de que cumpre as exigências de reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social'),
  regra('declaracoes', 'custos', 'declaração de que suas propostas econômicas compreendem a integralidade dos custos para atendimento dos direitos trabalhistas'),
  regra('declaracoes', 'integridade', 'declaração do licitante de que desenvolve programa de integridade, conforme Decreto n° 12.304, de 2024'),
];
const BELTRAO_348 = [
  regra('documentos_anexos', 'folders', 'O Pregoeiro poderá solicitar a apresentação de folders, prospectos, FICHA TÉCNICA e outros documentos ou materiais de divulgação'),
  regra('registro_anvisa', 'regularização', 'Comprovaçao da regularizaçao dos produtos ofertados perante a Agencia Nacional de Vigilancia Sanitaria – ANVISA, mediante Registro, Notificaçao ou Cadastro'),
  regra('documentos_anexos', 'distribuidora', 'Quando a contratada for distribuidora, deverá apresentar documento que comprove sua condição de distribuidora autorizada ou representante do fabricante, quando aplicável.'),
];

test('Aeronáutica 2941: carta e amostra condicionais ao TR, ME/EPP marcada no sistema, pleno acordo na proposta', () => {
  const ex = deRegrasProposta(AERONAUTICA_2941);
  assert.deepEqual(tipos(ex), ['proposta_precos', 'carta_solidariedade', 'amostra', 'declaracao_me_epp', 'declaracao_pleno_acordo']);
  const [, carta, amostra, meEpp, acordo] = ex;
  assert.deepEqual(carta.condicoes, ['se_distribuidor', 'se_exigido']);
  assert.deepEqual(amostra.condicoes, ['se_exigido']);
  assert.equal(meEpp.noSistema, true); assert.equal(meEpp.fase, 'proposta_inicial');
  assert.equal(acordo.noSistema, undefined); assert.equal(acordo.fase, 'proposta_ajustada');
});

test('Exército 22617: amostra com prazo de 3 dias úteis se solicitada, catálogo, registro e 4 declarações', () => {
  const ex = deRegrasProposta(EXERCITO_22617);
  assert.deepEqual(tipos(ex), ['catalogo_ficha_tecnica', 'amostra', 'registro_anvisa', 'declaracao_habilitacao', 'declaracao_pcd',
    'declaracao_custos_trabalhistas', 'declaracao_integridade']);
  assert.equal(ex[1].prazo, '3 dias úteis'); assert.deepEqual(ex[1].condicoes, ['se_solicitado']);
  assert.equal(ex[4].noSistema, true);
});

test('Francisco Beltrão 348: folders se solicitados e comprovante de distribuidor só para revendedor', () => {
  const ex = deRegrasProposta(BELTRAO_348);
  assert.deepEqual(tipos(ex), ['catalogo_ficha_tecnica', 'registro_anvisa', 'comprovante_distribuidor']);
  assert.deepEqual(ex[0].condicoes, ['se_solicitado']);
  assert.deepEqual(ex[2].condicoes, ['se_distribuidor', 'se_exigido']);
  const efeito = regra('declaracoes', 'aceitação plena', 'A apresentação da proposta implicará na plena aceitação das condições estabelecidas neste edital e seus anexos.');
  assert.deepEqual(deRegrasProposta([efeito]), []);
});

test('condições e prazos saem do texto; sem condição escrita é sempre', () => {
  assert.deepEqual(condicoesDe('Apresentar certidão negativa de débitos trabalhistas'), ['sempre']);
  assert.equal(prazoDe('no prazo de 2 (duas) horas, envie a proposta'), '2 horas');
  assert.equal(prazoDe('sem prazo'), undefined);
});

test('exigências do record_requirement viram documentos: certidões abrem em três', () => {
  const ex = deRequisitos([{ requirement: 'certidoes', quote: 'prova de regularidade fiscal' }, { requirement: 'afe', quote: 'AFE emitida pela ANVISA' },
    { requirement: 'marca_referencia', quote: 'marca X ou similar' }, { requirement: 'outro', quote: 'Licença Sanitária expedida pela vigilância local' }]);
  assert.deepEqual(tipos(ex), ['cnd_federal', 'crf_fgts', 'cndt', 'afe', 'licenca_sanitaria']);
  assert.ok(ex.every(e => e.fase === 'habilitacao' && e.origem === 'exigencia_edital'));
});

const company = () => JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8'));
const P1 = { id: 'P1', nome: 'Cabo de bisturi nº 4', marca: 'Straumed', registroAnvisa: '82936150004' };
const produtos: ProdutoViavel[] = [{ item: 1, produto: P1, regularizacao: 'vigente' }, { item: 2, produto: { ...P1, id: 'P2', marca: 'Golgran' }, regularizacao: 'vigente' }];

test('plano cruza com o cofre, o catálogo e a ANVISA, e diz quem providencia cada documento', () => {
  const exigencias = [...deRegrasProposta([...AERONAUTICA_2941, ...EXERCITO_22617]),
    ...deRequisitos([{ requirement: 'certidoes', quote: 'regularidade fiscal' }, { requirement: 'afe', quote: 'AFE' }, { requirement: 'outro', quote: 'licença sanitária' }])];
  const plano = montarPlano({ tenderId: 't', exigencias, cofre: company().cofre, sessao: '2026-11-20', hoje: '2026-11-07', empresa: { atuacao: 'distribuidora' }, produtos, prazoPropostaAjustada: '2 horas' });
  const l = Object.fromEntries(plano.linhas.map(x => [x.tipo, x]));
  assert.equal(l.cnd_federal.status, 'vence_antes'); assert.equal(l.cnd_federal.ate, '2026-11-20');
  assert.equal(l.crf_fgts.status, 'pronto'); assert.equal(l.afe.status, 'pronto');
  assert.equal(l.licenca_sanitaria.status, 'ausente');
  assert.equal(l.proposta_precos.status, 'lance_gera'); assert.equal(l.proposta_precos.prazo, '2 horas');
  assert.equal(l.declaracao_me_epp.status, 'marcar_no_sistema'); assert.equal(l.declaracao_pleno_acordo.status, 'na_proposta');
  assert.equal(l.registro_anvisa.status, 'na_proposta');
  assert.equal(l.catalogo_ficha_tecnica.status, 'ausente'); assert.match(l.catalogo_ficha_tecnica.acao, /Straumed.*Golgran/);
  assert.equal(l.carta_solidariedade.status, 'pedir_terceiro'); assert.equal(l.carta_solidariedade.condicional, true);
  assert.deepEqual(l.carta_solidariedade.condicoes, ['se_exigido']);
  assert.match(l.carta_solidariedade.acao, /^Só se o termo de referência exigir.*Straumed, Golgran/);
  assert.equal(l.amostra.status, 'preparar'); assert.equal(l.amostra.prazo, '3 dias úteis');
  assert.deepEqual([...new Set(plano.linhas.map(x => x.fase))], ['proposta_inicial', 'proposta_ajustada', 'habilitacao']);
  assert.ok(plano.pendencias.some(p => p.startsWith('CND Federal: Vence antes da sessão')));
  assert.ok(plano.pendencias.some(p => p.startsWith('(condicional) Carta de solidariedade')));
  assert.equal(plano.resumo.total, plano.linhas.length);
});

test('fabricante dispensa carta; sem atuação declarada, pergunta; registro vencido é irregular; arquivo do produto deixa pronto', () => {
  const ex = deRegrasProposta([...AERONAUTICA_2941.slice(2, 3), ...BELTRAO_348]);
  const comArquivo = [{ item: 1, produto: { ...P1, arquivos: { catalogo_ficha_tecnica: 'p1.pdf' } }, regularizacao: 'vencido' }];
  const fabrica = montarPlano({ tenderId: 't', exigencias: ex, cofre: [], sessao: null, hoje: '2026-11-07', empresa: { atuacao: 'fabricante' }, produtos: comArquivo });
  const f = Object.fromEntries(fabrica.linhas.map(x => [x.tipo, x]));
  assert.equal(f.carta_solidariedade.status, 'nao_se_aplica'); assert.equal(f.comprovante_distribuidor.status, 'nao_se_aplica');
  assert.equal(f.registro_anvisa.status, 'irregular'); assert.equal(f.catalogo_ficha_tecnica.status, 'pronto');
  const semAtuacao = montarPlano({ tenderId: 't', exigencias: ex, cofre: [], sessao: null, hoje: '2026-11-07', empresa: {}, produtos: comArquivo });
  assert.equal(semAtuacao.linhas.find(x => x.tipo === 'comprovante_distribuidor')!.status, 'conferir');
});

test('sem data da sessão, o cofre é conferido contra hoje e o prazo fica em aberto', () => {
  const exigencias = deRequisitos([{ requirement: 'certidoes', quote: 'regularidade fiscal' }]);
  const plano = montarPlano({ tenderId: 't', exigencias, sessao: null, hoje: '2026-11-07', empresa: {}, produtos,
    cofre: [{ doc: 'CND', tipo: 'cnd_federal', validade: '2026-11-15' }, { doc: 'CRF', tipo: 'crf_fgts', validade: '2026-11-01' }] });
  const l = Object.fromEntries(plano.linhas.map(x => [x.tipo, x]));
  assert.equal(l.cnd_federal.status, 'pronto'); assert.equal(l.cnd_federal.ate, null);
  assert.equal(l.crf_fgts.status, 'vence_antes');
});

test('exigência "outro" só vira documento com termo inequívoco', () => {
  const ex = deRequisitos([
    { requirement: 'outro', quote: 'conforme a legislação estadual vigente' },
    { requirement: 'outro', quote: 'entrega em até 30 dias após o registro do pedido' },
    { requirement: 'outro', quote: 'acompanha manual de instruções em português' },
    { requirement: 'outro', quote: 'Certidão negativa de falência expedida pelo distribuidor da sede' },
  ]);
  assert.deepEqual(tipos(ex), ['certidao_falencia']);
});

test('a exigência registrada pelo agente prevalece sobre a classificação automática do mesmo tipo', () => {
  const agente: ExigenciaDocumental = { tipo: 'amostra', fase: 'habilitacao', condicoes: ['sempre'], citacao: 'amostra obrigatória', origem: 'agente' };
  const plano = montarPlano({ tenderId: 't', exigencias: [...deRegrasProposta(EXERCITO_22617), agente], cofre: [], sessao: null, hoje: '2026-11-07', empresa: {}, produtos });
  const amostras = plano.linhas.filter(x => x.tipo === 'amostra');
  assert.equal(amostras.length, 1); assert.equal(amostras[0].origem, 'agente');
  assert.equal(amostras[0].condicional, false); assert.equal(amostras[0].prazo, '3 dias úteis');
});

const TEXTO = 'Para habilitação, a licitante apresentará Licença Sanitária expedida pelo órgão de vigilância local. Caso o Termo de Referência exija, a licitante apresentará amostra em 5 (cinco) dias úteis.';
const docs = [{ nome: 'Edital', url: 'https://x/edital.pdf', texto: TEXTO }];

test('registrarExigencia confere citação literal e assunto do tipo', () => {
  const lista: ExigenciaDocumental[] = [];
  assert.equal(registrarExigencia(docs, lista, { tipo: 'licenca_sanitaria', citacao: 'apresentará alvará de funcionamento' }).aceito, false);
  assert.match(registrarExigencia(docs, lista, { tipo: 'balanco', citacao: 'a licitante apresentará Licença Sanitária expedida' }).motivo!, /não fala de Balanço/);
  assert.match(registrarExigencia(docs, lista, { tipo: 'inventado', citacao: 'x' }).motivo!, /tipo desconhecido/);
  const ok = registrarExigencia(docs, lista, { tipo: 'licenca_sanitaria', citacao: 'a licitante apresentará Licença Sanitária expedida pelo órgão de vigilância local' });
  assert.equal(ok.aceito, true); assert.equal(ok.fase, 'habilitacao');
  const amostra = registrarExigencia(docs, lista, { tipo: 'amostra', citacao: 'Caso o Termo de Referência exija, a licitante apresentará amostra em 5 (cinco) dias úteis' });
  assert.deepEqual(amostra.condicoes, ['se_exigido']);
  assert.equal(lista[1].prazo, '5 dias úteis');
});

const tid = '11111111000111/2026/1';
function lance(estado: string | null) {
  const state = newState(company(), 'http://127.0.0.1:9', new Date('2026-11-07T12:00:00-03:00'));
  state.tenders[tid] = { orgao: 'Prefeitura X', abertura: '2026-11-20T09:00' };
  state.items[tid] = [{ numero: 1, descricao: 'Cabo de bisturi nº 4', quantidade: 10 }];
  state.requirements.push({ tender_id: tid, requirement: 'certidoes', quote: 'prova de regularidade fiscal' });
  if (estado) state.decisions[tid + '#1'] = { estado, produto: 'P1', precoProposto: 7.5, anvisa: { regularizacao: 'vigente' } };
  mock.method(pncp, 'files', async () => [{ tipo: 'Edital', titulo: 'Edital', url: 'https://x/edital.pdf' }]);
  mock.method(pdf, 'fromUrl', async () => ({ kind: 'pdf', text: TEXTO }));
  return { state, approvals: new Set<string>() };
}
const run = (nome: string, args: unknown, ctx: any): Promise<any> => tools.find(t => t.name === nome)!.run(args, ctx);

test('sem item viável não há registro de documento, plano nem plano no dossiê', async () => {
  for (const estado of [null, 'nao_disputar', 'escalar']) {
    const ctx = lance(estado);
    assert.match((await run('record_document_requirement', { tender_id: tid, tipo: 'amostra', citacao: 'x' }, ctx)).erro, /sem item viável/);
    assert.match((await run('draft_document_plan', { tender_id: tid }, ctx)).erro, /sem item viável/);
    assert.equal(buildDossie(ctx.state, tid).planoDocumentos, undefined);
  }
});

test('com item viável: o agente registra, o plano junta as fontes e vai para o dossiê', async () => {
  const ctx = lance('disputar');
  assert.match((await run('record_document_requirement', { tender_id: tid, tipo: 'licenca_sanitaria', citacao: 'Licença Sanitária expedida' }, ctx)).erro, /read_proposal_docs/);
  await run('read_proposal_docs', { tender_id: tid }, ctx);
  const r = await run('record_document_requirement', { tender_id: tid, tipo: 'licenca_sanitaria', fase: 'habilitacao', citacao: 'Licença Sanitária expedida pelo órgão de vigilância local' }, ctx);
  assert.equal(r.aceito, true);
  const plano = await run('draft_document_plan', { tender_id: tid }, ctx);
  assert.deepEqual(plano.documentos.map((d: any) => d.tipo), ['proposta_precos', 'cnd_federal', 'crf_fgts', 'cndt', 'licenca_sanitaria']);
  assert.equal(plano.documentos.find((d: any) => d.tipo === 'licenca_sanitaria').status, 'ausente');
  const dossie = buildDossie(ctx.state, tid);
  assert.deepEqual(dossie.planoDocumentos?.itens, [1]);
  assert.equal(dossie.planoDocumentos?.linhas.find(l => l.tipo === 'licenca_sanitaria')?.fonte?.url, 'https://x/edital.pdf');
});

// Trechos reais: cláusula 5.4 do modelo AGU (2941 e 22617; 3.6 no 348) e 5.10 (integridade).
const CLAUSULA_SISTEMA = `5.4. No cadastramento da proposta inicial, o licitante declarará, em campo próprio do sistema,
que: 5.4.1 está ciente e concorda com as condições contidas no edital e seus anexos, bem como de que a proposta apresentada
compreende a integralidade dos custos para atendimento dos direitos trabalhistas assegurados na Constituição Federal, nas leis
trabalhistas, nas normas infralegais, nas convenções coletivas de trabalho e nos termos de ajustamento de conduta vigentes na
data de sua entrega em definitivo e que cumpre plenamente os requisitos de habilitação definidos no instrumento convocatório;
5.4.2 não emprega menor de 18 anos em trabalho noturno, perigoso ou insalubre e não emprega menor de 16 anos, salvo menor, a
partir de 14 anos, na condição de aprendiz, nos termos do artigo 7°, XXXIII, da Constituição; 5.4.4 cumpre as exigências de
reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social, previstas em lei e em outras normas específicas.
5.10. O licitante deverá declarar em campo próprio do sistema que desenvolve programa de integridade, conforme Decreto n° 12.304, de 2024.`;
const MODELO_348 = 'ANEXO – II MODELO DE PROPOSTA A empresa ...';
const empresaEpp = { atuacao: 'distribuidora', porte: 'EPP' };

test('declaração prevista na cláusula de campo próprio do sistema é marcada no portal, não vira arquivo', () => {
  const plano = montarPlano({ tenderId: 't', exigencias: deRegrasProposta(EXERCITO_22617), cofre: [], sessao: null, hoje: '2026-11-08',
    empresa: empresaEpp, produtos, textos: [CLAUSULA_SISTEMA] });
  const l = Object.fromEntries(plano.linhas.map(x => [x.tipo, x]));
  for (const tipo of ['declaracao_habilitacao', 'declaracao_custos_trabalhistas', 'declaracao_pcd']) assert.equal(l[tipo].status, 'marcar_no_sistema', tipo);
  assert.equal(l.declaracao_integridade.status, 'marcar_no_sistema');
  assert.equal(l.declaracao_integridade.responsavel, 'humano');
  assert.match(l.declaracao_integridade.acao, /só marcar se.*programa de integridade/i);
  assert.ok(plano.linhas.every(x => x.status !== 'lance_gera' || x.tipo === 'proposta_precos'));
});

test('declaração escrita no modelo de proposta vai no texto da proposta', () => {
  const regras = [regra('modelo_proposta', 'Anexo II', MODELO_348),
    regra('declaracoes', 'habilitação', 'Declaro que a proponente atende aos requisitos de habilitaçao e o declarante atesta a veracidade das informaçoes prestadas (art. 63, I, da Lei nº 14.133/2021).')];
  const semClausula = Object.fromEntries(montarPlano({ tenderId: 't', exigencias: deRegrasProposta(regras), cofre: [], sessao: null, hoje: '2026-11-08',
    empresa: empresaEpp, produtos, textos: [] }).linhas.map(x => [x.tipo, x]));
  assert.equal(semClausula.declaracao_habilitacao.status, 'na_proposta');
  assert.equal(semClausula.declaracao_habilitacao.rotulo, 'Na proposta');
  const comClausula = Object.fromEntries(montarPlano({ tenderId: 't', exigencias: deRegrasProposta(regras), cofre: [], sessao: null, hoje: '2026-11-08',
    empresa: empresaEpp, produtos, textos: [CLAUSULA_SISTEMA] }).linhas.map(x => [x.tipo, x]));
  assert.equal(comClausula.declaracao_habilitacao.status, 'marcar_no_sistema');
  assert.match(comClausula.declaracao_habilitacao.acao, /proposta também/);
});

test('declaração fora do sistema e da proposta vai para um humano; ME/EPP só se aplica a ME ou EPP', () => {
  const ex = deRegrasProposta([regra('declaracoes', 'custos', 'O licitante deverá apresentar, sob pena de desclassificação, declaração de que suas propostas econômicas compreendem a integralidade dos custos para atendimento dos direitos trabalhistas'),
    regra('declaracoes', 'ME/EPP', 'declaração de que é microempresa ou empresa de pequeno porte')]);
  const base = { tenderId: 't', exigencias: ex, cofre: [], sessao: null, hoje: '2026-11-08', produtos, textos: [] };
  const exigencias = ex.map(e => ({ ...e, origem: 'agente' as const }));
  const l = Object.fromEntries(montarPlano({ ...base, exigencias, empresa: empresaEpp }).linhas.map(x => [x.tipo, x]));
  assert.equal(l.declaracao_custos_trabalhistas.status, 'conferir'); assert.equal(l.declaracao_custos_trabalhistas.responsavel, 'humano');
  assert.match(l.declaracao_custos_trabalhistas.acao, /modelo do edital/);
  const grande = Object.fromEntries(montarPlano({ ...base, exigencias, empresa: { atuacao: 'distribuidora', porte: 'Demais' } }).linhas.map(x => [x.tipo, x]));
  assert.equal(grande.declaracao_me_epp.status, 'nao_se_aplica');
});

test('registro ANVISA: o número vai na proposta; a comprovação é a consulta oficial, anexada por um humano', () => {
  const numero = Object.fromEntries(montarPlano({ tenderId: 't', exigencias: deRegrasProposta(EXERCITO_22617), cofre: [], sessao: null, hoje: '2026-11-08',
    empresa: empresaEpp, produtos, textos: [] }).linhas.map(x => [x.tipo, x]));
  assert.equal(numero.registro_anvisa.status, 'na_proposta');
  const comprovar = Object.fromEntries(montarPlano({ tenderId: 't', exigencias: deRegrasProposta(BELTRAO_348), cofre: [], sessao: null, hoje: '2026-11-08',
    empresa: empresaEpp, produtos, textos: [] }).linhas.map(x => [x.tipo, x]));
  assert.equal(comprovar.registro_anvisa.status, 'preparar'); assert.equal(comprovar.registro_anvisa.responsavel, 'humano');
  assert.match(comprovar.registro_anvisa.acao, /consulta.*portal da ANVISA.*82936150004/);
});

test('declaração marcada no sistema é da proposta inicial; a do sistema não é dita "também na proposta"', () => {
  const l = Object.fromEntries(montarPlano({ tenderId: 't', exigencias: deRegrasProposta(AERONAUTICA_2941), cofre: [], sessao: null, hoje: '2026-11-08',
    empresa: empresaEpp, produtos, textos: [CLAUSULA_SISTEMA] }).linhas.map(x => [x.tipo, x]));
  assert.equal(l.declaracao_pleno_acordo.status, 'marcar_no_sistema'); assert.equal(l.declaracao_pleno_acordo.fase, 'proposta_inicial');
  assert.match(l.declaracao_pleno_acordo.acao, /proposta também/);
  assert.doesNotMatch(l.declaracao_me_epp.acao, /proposta também/);
});
