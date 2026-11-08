// Declarações em arquivo: o Lance preenche o MODELO do próprio edital com o cadastro e só usa redação legal quando o
// edital pede a declaração sem trazer modelo. Os modelos abaixo são trechos reais de editais públicos em cache (PNCP).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extrairModelosDeclaracao, preencherModelo, gerarDeclaracao, impedimentoDeclaracao } from '../src/lib/declaracoes.ts';

// Modelo real de ME/EPP, com o texto quebrado palavra por palavra como o pdftotext devolve.
const ME_EPP = `ANEXO VI
MODELO DE DECLARAÇÃO DE MICROEMPRESA (ME) / EMPRESA DE
PEQUENO PORTE (EPP)
PREGÃO ELETRÔNICO SRP Nº ___/2026
A
empresa
_______________________________________,
inscrita
no
CNPJ
nº
____________________________, com sede à _______________________________________________, neste ato
representada por _______________________________________, portador(a) do CPF nº
__________________________ e RG nº __________________________, DECLARA, para os devidos fins e
sob as penas da lei, que:
( ) ENQUADRA-SE COMO MICROEMPRESA – ME, nos termos da Lei Complementar nº
123, de 14 de dezembro de 2006;
( ) ENQUADRA-SE COMO EMPRESA DE PEQUENO PORTE – EPP, nos termos da Lei
Complementar nº 123, de 14 de dezembro de 2006;
Por ser expressão da verdade, firma a presente declaração para que produza seus efeitos
legais.
Local e data.
Nome do Representante Legal
CPF nº: ___________________________
Cargo/Função: ______________________
ANEXO VII
MINUTA DO CONTRATO`;
// Modelo real de declaração unificada (vários assuntos num documento só).
const UNIFICADA = `MODELO DE DECLARAÇÃO UNIFICADA
PREGÃO ELETRONICO nº xx/2026
Pelo presente instrumento, a empresa ........................., CNPJ nº ......................, com sede na
............................................, através de seu representante legal infra-assinado, que:
( ) Declara, sob as penas do artigo 299 do Código Penal, que se enquadra na situação de
microempreendedor individual, microempresa e empresa de pequeno porte, nos termos da Lei
Complementar nº 123/06.
- Declaramos, de que não emprega menor de 18 anos em trabalho noturno, perigoso ou insalubre e não
emprega menor de 16 anos, salvo menor, a partir de 14 anos, na condição de aprendiz.
- Declaramos, que cumprimos as exigências de reserva de cargos para pessoa com deficiência.`;
// Modelo real sem "MODELO DE" no título (Cordisburgo/MG, anexo IV): o cabeçalho é "ANEXO IV" e a linha "DECLARAÇÃO".
const ANEXO_SEM_MODELO = `ANEXO IV
AO PROCESSO LICITATÓRIO Nº 194/2026
MODALIDADE PREGÃO ELETRÔNICO Nº 023/2026
EMPREGADOR PESSOA JURÍDICA
DECLARAÇÃO
Ref.: (identificação da licitação)
................................., inscrito no CNPJ nº..................., por intermédio de seu
representante legal o(a) Sr(a)...................................., portador(a) da Carteira de
Identidade nº............................ e do CPF nº ........................., DECLARA, para fins do
disposto no inciso VI do art. 68 da Lei nº 14.133/21 acrescido pela Lei nº 9.854, de 27
de outubro de 1999, que não emprega menor de dezoito anos em trabalho noturno,
perigoso ou insalubre e não emprega menor de dezesseis anos.
Ressalva: emprega menor, a partir de quatorze anos, na condição de aprendiz ( ).
............................................
(data)
............................................................
(representante legal)
ANEXO V`;
// Modelo real em formulário (rótulo seguido de dois-pontos, sem lacuna desenhada).
const FORMULARIO = `ANEXO IV- MODELO DE DECLARAÇÃO CONSOLIDADA DE DADOS DA EMPRESA
1. DADOS BANCÁRIOS
NOME DO BANCO:
CIDADE:
2. DADOS DO REPRESENTANTE LEGAL RESPONSÁVEL PELA ASSINATURA DO CONTRATO
NOME COMPLETO:
CARGO OU FUNÇÃO:
CPF/MF Nº:
3. DECLARAÇÃO DE DOMICÍLIO ELETRÔNICO DA EMPRESA
Declaramos que o Domicílio Eletrônico da Empresa para o recebimento de autorizações de fornecimento é:
E-MAIL:
Local e Data
Nome e Assinatura do Representante da Empresa`;
const SUMARIO = `ANEXO V – Modelo de proposta; ANEXO VI – MODELO DE DECLARAÇÃO DE MICROEMPRESA; ANEXO VII – Minuta do contrato.`;

const doc = (texto: string) => ({ nome: 'EDITAL.pdf', url: 'https://pncp.gov.br/edital.pdf', texto });
const empresa = { nome: 'Distribuidora Modelo Ltda (fictícia)', cnpj: '12.345.678/0001-90', porte: 'EPP', municipio: 'Curitiba/PR',
  representante: { nome: 'Ana Souza', cpf: '123.456.789-00', cargo: 'Sócia-administradora' } };
const hoje = new Date('2026-11-08T12:00:00-03:00');

test('extrai o modelo do anexo, ignora o sumário e para no anexo seguinte', () => {
  const modelos = extrairModelosDeclaracao([doc(`${SUMARIO}\n...corpo do edital...\n${ME_EPP}`)]);
  assert.equal(modelos.length, 1);
  assert.equal(modelos[0].tipo, 'declaracao_me_epp');
  assert.match(modelos[0].titulo, /MICROEMPRESA/);
  assert.match(modelos[0].texto, /firma a presente declaração/);
  assert.doesNotMatch(modelos[0].texto, /MINUTA DO CONTRATO/);
  assert.equal(modelos[0].fonte.nome, 'EDITAL.pdf');
});

test('declaração unificada vira um documento só, do tipo "outra"', () => {
  const [m] = extrairModelosDeclaracao([doc(UNIFICADA)]);
  assert.equal(m.tipo, 'declaracao_outra');
  assert.match(m.titulo, /UNIFICADA/);
});

test('preenche só lacunas com rótulo reconhecido; marca a caixa que o cadastro sustenta; o resto vira [preencher]', () => {
  const [m] = extrairModelosDeclaracao([doc(ME_EPP)]);
  const r = preencherModelo(m.texto, { ...empresa }, hoje);
  assert.match(r.texto, /empresa Distribuidora Modelo Ltda \(fictícia\)/);
  assert.match(r.texto, /CNPJ nº 12\.345\.678\/0001-90/);
  assert.match(r.texto, /representada por Ana Souza/);
  assert.match(r.texto, /CPF nº 123\.456\.789-00/);
  assert.match(r.texto, /Cargo\/Função: Sócia-administradora/);
  assert.match(r.texto, /\(X\) ENQUADRA-SE COMO EMPRESA DE PEQUENO PORTE/);
  assert.match(r.texto, /\( \) ENQUADRA-SE COMO MICROEMPRESA/);
  assert.match(r.texto, /Curitiba\/PR, 8 de novembro de 2026/);
  // Sem endereço e RG no cadastro, e sem o número do pregão: lacunas ficam marcadas, nunca inventadas.
  assert.match(r.texto, /sede à \[preencher\]/);
  assert.match(r.texto, /RG nº \[preencher\]/);
  for (const p of ['dado da empresa: endereço', 'dado da empresa: RG']) assert.ok(r.pendencias.includes(p), r.pendencias.join(' | '));
  assert.ok(r.pendencias.some(p => /lacuna sem rótulo/.test(p)), 'o número do pregão fica para conferir');
  // A redação do órgão não muda: só lacunas e caixas são tocadas.
  assert.match(r.texto, /Por ser expressão da verdade, firma a presente declaração/);
});

test('caixa de ME/EPP não é marcada quando o cadastro não sustenta', () => {
  const [m] = extrairModelosDeclaracao([doc(UNIFICADA)]);
  assert.match(preencherModelo(m.texto, { ...empresa, porte: 'Demais' }, hoje).texto, /\( \) Declara, sob as penas do artigo 299/);
  assert.match(preencherModelo(m.texto, empresa, hoje).texto, /\(X\) Declara, sob as penas do artigo 299/);
});

test('opção negativa ("Não se enquadra") só é marcada quando o porte do cadastro não é ME/EPP', () => {
  const modelo = `( ) Não se enquadra como ME/EPP.\n( ) Enquadra-se como ME/EPP, nos termos da Lei Complementar nº 123/06.`;
  const epp = preencherModelo(modelo, empresa, hoje).texto;
  assert.match(epp, /\( \) Não se enquadra/);
  assert.match(epp, /\(X\) Enquadra-se/);
  const demais = preencherModelo(modelo, { ...empresa, porte: 'Demais' }, hoje).texto;
  assert.match(demais, /\(X\) Não se enquadra/);
  assert.match(demais, /\( \) Enquadra-se/);
  const semPorte = preencherModelo(modelo, { ...empresa, porte: undefined }, hoje);
  assert.doesNotMatch(semPorte.texto, /\(X\)/);
  assert.ok(semPorte.pendencias.some(p => /porte da empresa/.test(p)));
});

test('modelo que afirma ME/EPP fora de caixa de opção vira pendência quando o cadastro não sustenta', () => {
  const modelo = `A empresa ________, CNPJ nº ________, DECLARA:\n- que se enquadra como microempresa ou empresa de pequeno porte, nos termos da Lei Complementar nº 123/06;\n- que não emprega menor de 18 anos em trabalho noturno, perigoso ou insalubre.`;
  const afirma = (p: string) => /afirma que a empresa é ME\/EPP/.test(p);
  assert.ok(preencherModelo(modelo, { ...empresa, porte: 'Demais' }, hoje).pendencias.some(afirma));
  assert.ok(preencherModelo(modelo, { ...empresa, porte: undefined }, hoje).pendencias.some(afirma));
  assert.ok(!preencherModelo(modelo, empresa, hoje).pendencias.some(afirma));
  // Em caixa de opção a caixa fica em branco; negação não afirma nada.
  assert.ok(!preencherModelo(UNIFICADA, { ...empresa, porte: 'Demais' }, hoje).pendencias.some(afirma));
  assert.ok(!preencherModelo('- que não se enquadra como microempresa ou empresa de pequeno porte.', { ...empresa, porte: 'Demais' }, hoje).pendencias.some(afirma));
  // A negação de outro assunto não inverte a declaração de porte.
  const impedimento = preencherModelo('( ) Enquadra-se como ME/EPP.\nNão possui impedimento para licitar.', { ...empresa, porte: 'Demais' }, hoje);
  assert.match(impedimento.texto, /\( \) Enquadra-se/);
  assert.ok(preencherModelo('A empresa declara que não possui impedimento e se enquadra como microempresa.', { ...empresa, porte: 'Demais' }, hoje).pendencias.some(afirma));
  // Porte afirmado tem de ser o do cadastro; cláusula que aceita mais de um enquadramento vale para qualquer um deles.
  assert.ok(preencherModelo('A empresa declara que se enquadra como microempresa.', empresa, hoje).pendencias.some(afirma));
  assert.ok(!preencherModelo('A empresa declara que se enquadra como microempresa ou empresa de pequeno porte.', empresa, hoje).pendencias.some(afirma));
  assert.ok(preencherModelo('A licitante é microempresa, nos termos da LC 123.', empresa, hoje).pendencias.some(afirma));
  const d = gerarDeclaracao({ tipo: 'declaracao_outra', modelo: { tipo: 'declaracao_outra', titulo: 'DECLARAÇÃO UNIFICADA', texto: modelo, fonte: { nome: 'EDITAL.pdf', url: 'https://pncp.gov.br/edital.pdf' } },
    pregao: { id: 'x/2026/1', orgao: 'Órgão' }, empresa: { ...empresa, porte: 'Demais' }, hoje });
  assert.ok(d.pendencias.some(afirma));
});

test('declaração ME/EPP só sai para ME ou EPP; integridade só com o programa declarado no cadastro', () => {
  assert.equal(impedimentoDeclaracao('declaracao_me_epp', { ...empresa, porte: undefined })?.status, 'conferir');
  assert.equal(impedimentoDeclaracao('declaracao_me_epp', { ...empresa, porte: 'Demais' })?.status, 'nao_se_aplica');
  assert.equal(impedimentoDeclaracao('declaracao_me_epp', empresa), null);
  assert.equal(impedimentoDeclaracao('declaracao_integridade', empresa)?.status, 'conferir');
  assert.equal(impedimentoDeclaracao('declaracao_integridade', { ...empresa, programaIntegridade: true }), null);
});

test('sem modelo no edital usa a redação legal conferida; "outra" sem modelo não é gerada', () => {
  const d = gerarDeclaracao({ tipo: 'declaracao_menor', citacao: 'declaração de que não emprega menor', pregao: { id: 'X/2026/1', orgao: 'ÓRGÃO' }, empresa, hoje });
  assert.match(d.markdown, /DECLARA, para os fins do pregão acima, que não emprega menor de 18 \(dezoito\) anos/);
  assert.match(d.markdown, /art\. 7º, XXXIII, da Constituição Federal/);
  assert.match(d.markdown, /## Exigência do edital/);
  assert.throws(() => gerarDeclaracao({ tipo: 'declaracao_outra', pregao: { id: 'X', orgao: 'O' }, empresa, hoje }), /modelo/);
});

test('com modelo, a minuta é o modelo preenchido, com a fonte', () => {
  const [m] = extrairModelosDeclaracao([doc(ME_EPP)]);
  const d = gerarDeclaracao({ tipo: m.tipo, modelo: m, pregao: { id: 'X/2026/1', orgao: 'ÓRGÃO' }, empresa, hoje });
  assert.match(d.markdown, /^# MODELO DE DECLARAÇÃO DE MICROEMPRESA/m);
  assert.match(d.markdown, /\(X\) ENQUADRA-SE COMO EMPRESA DE PEQUENO PORTE/);
  assert.match(d.markdown, /Modelo do edital: EDITAL\.pdf/);
});

// Integração com o plano: a declaração pedida fora do sistema e fora da proposta sai em arquivo, gerado pelo Lance.
import { montarPlano, type ExigenciaDocumental } from '../src/lib/plano-documentos.ts';
const exige = (tipo: ExigenciaDocumental['tipo'], citacao: string): ExigenciaDocumental =>
  ({ tipo, fase: 'proposta_inicial', condicoes: ['sempre'], citacao, fonte: { nome: 'EDITAL.pdf', url: 'https://pncp.gov.br/edital.pdf' }, origem: 'agente' });
const plano = (exigencias: ExigenciaDocumental[], modelos = extrairModelosDeclaracao([doc(ME_EPP)]), emp: any = empresa) =>
  montarPlano({ tenderId: 'X/2026/1', exigencias, cofre: [], sessao: null, hoje: '2026-11-08', empresa: emp, produtos: [],
    declaracoes: { modelos, pregao: { id: 'X/2026/1', orgao: 'ÓRGÃO' }, hoje } });

test('declaração pedida em arquivo vira "O Lance gera", com a minuta persistida na linha', () => {
  const p = plano([exige('declaracao_me_epp', 'apresentar declaração de enquadramento como ME/EPP, conforme Anexo VI'),
    exige('declaracao_menor', 'declaração de que não emprega menor de 18 anos')]);
  const me = p.linhas.find(l => l.tipo === 'declaracao_me_epp')!;
  assert.equal(me.status, 'lance_gera'); assert.equal(me.responsavel, 'lance');
  assert.match(me.declaracao!.markdown, /\(X\) ENQUADRA-SE COMO EMPRESA DE PEQUENO PORTE/);
  assert.equal(me.declaracao!.modelo, 'EDITAL.pdf');
  const menor = p.linhas.find(l => l.tipo === 'declaracao_menor')!;
  assert.equal(menor.status, 'lance_gera'); assert.equal(menor.declaracao!.modelo, null);
  assert.match(menor.declaracao!.markdown, /art\. 7º, XXXIII/);
});

test('o que o cadastro não sustenta não é declarado; declaração no sistema continua no sistema', () => {
  const p = plano([exige('declaracao_integridade', 'declaração de que desenvolve programa de integridade'),
    exige('declaracao_me_epp', 'declaração de ME/EPP')], [], { ...empresa, porte: 'Demais' });
  const integ = p.linhas.find(l => l.tipo === 'declaracao_integridade')!;
  assert.equal(integ.status, 'conferir'); assert.equal(integ.declaracao, undefined);
  assert.equal(p.linhas.find(l => l.tipo === 'declaracao_me_epp')!.status, 'nao_se_aplica');
  const sistema = plano([{ ...exige('declaracao_menor', 'declarará em campo próprio do sistema que não emprega menor'), noSistema: true }]);
  const l = sistema.linhas.find(x => x.tipo === 'declaracao_menor')!;
  assert.equal(l.status, 'marcar_no_sistema'); assert.equal(l.declaracao, undefined);
});

test('modelo do anexo sem exigência registrada ganha linha própria; assunto coberto pela unificada não duplica arquivo', () => {
  const modelos = extrairModelosDeclaracao([doc(UNIFICADA)]);
  const p = plano([exige('declaracao_menor', 'declaração de que não emprega menor de 18 anos')], modelos);
  const uni = p.linhas.find(l => l.tipo === 'declaracao_outra')!;
  assert.equal(uni.origem, 'modelo_edital'); assert.equal(uni.status, 'lance_gera');
  assert.match(uni.documento, /UNIFICADA/);
  assert.match(uni.declaracao!.markdown, /\(X\) Declara, sob as penas do artigo 299/);
  const menor = p.linhas.find(l => l.tipo === 'declaracao_menor')!;
  assert.equal(menor.status, 'lance_gera'); assert.equal(menor.declaracao, undefined);
  assert.match(menor.acao, /UNIFICADA/);
});

test('sem os dados para gerar (fluxo antigo), o plano não muda', () => {
  const p = montarPlano({ tenderId: 't', exigencias: [exige('declaracao_menor', 'declaração de que não emprega menor')], cofre: [], sessao: null, hoje: '2026-11-08', empresa: {}, produtos: [] });
  assert.equal(p.linhas.find(l => l.tipo === 'declaracao_menor')!.status, 'conferir');
});

test('anexo sem "MODELO DE" no título: acha o modelo, preenche lacunas sem rótulo à esquerda e mantém a assinatura', () => {
  const [m, ...resto] = extrairModelosDeclaracao([doc(`Anexo IV: Modelo de Declaração que não emprega menor;\nAnexo V: Minuta\n...\n${ANEXO_SEM_MODELO}`)]);
  assert.equal(resto.length, 0);
  assert.equal(m.tipo, 'declaracao_menor');
  assert.match(m.titulo, /DECLARAÇÃO/);
  const r = preencherModelo(m.texto, empresa, hoje);
  assert.match(r.texto, /^Distribuidora Modelo Ltda \(fictícia\), inscrito no CNPJ nº12\.345\.678\/0001-90/m);
  assert.match(r.texto, /Sr\(a\)Ana Souza/);
  assert.match(r.texto, /Curitiba\/PR, 8 de novembro de 2026 \(data\)/);
  assert.match(r.texto, /_{20,} \(representante legal\)/);
  assert.ok(r.pendencias.includes('marcar as opções do modelo que se aplicam à empresa'), 'a ressalva do aprendiz é do humano');
});

test('formulário: rótulo com dois-pontos recebe o dado do cadastro ou fica para preencher', () => {
  const [m] = extrairModelosDeclaracao([doc(FORMULARIO)]);
  assert.match(m.titulo, /CONSOLIDADA DE DADOS DA EMPRESA$/);
  const r = preencherModelo(m.texto, { ...empresa, email: 'contato@exemplo.test' }, hoje);
  assert.match(r.texto, /NOME COMPLETO: Ana Souza/);
  assert.match(r.texto, /CARGO OU FUNÇÃO: Sócia-administradora/);
  assert.match(r.texto, /CPF\/MF Nº: 123\.456\.789-00/);
  assert.match(r.texto, /E-MAIL: contato@exemplo\.test/);
  assert.match(r.texto, /NOME DO BANCO: \[preencher\]/);
  assert.ok(r.pendencias.includes('dado da empresa: banco'));
});

test('lacuna descrita entre colchetes ("[CNPJ DA EMPRESA]") é preenchida pelo rótulo; a desconhecida vira pendência', () => {
  // Trecho real (declaração unificada, Pérola/PR).
  const r = preencherModelo(`Pelo presente instrumento, a empresa [RAZÃO SOCIAL DA EMPRESA],
inscrita no CNPJ sob o nº [CNPJ DA EMPRESA], com sede em [ENDEREÇO COMPLETO DA EMPRESA,
INCLUINDO LOGRADOURO, NÚMERO, BAIRRO, CIDADE, ESTADO E CEP], neste ato representada
por seu(sua) representante legal infra-assinado(a), [NOME COMPLETO DO REPRESENTANTE
LEGAL], portador(a) do RG nº [NÚMERO DO RG] e CPF nº [NÚMERO DO CPF], no cargo de [CARGO/
FUNÇÃO DO REPRESENTANTE LEGAL], declara que cumpre os requisitos do Edital do [MODALIDADE DA LICITAÇÃO].`, empresa, hoje);
  assert.match(r.texto, /a empresa Distribuidora Modelo Ltda \(fictícia\), inscrita no CNPJ sob o nº 12\.345\.678\/0001-90, com sede em \[preencher\]/);
  assert.match(r.texto, /infra-assinado\(a\), Ana Souza, portador\(a\) do RG nº \[preencher\] e CPF nº 123\.456\.789-00, no cargo de Sócia-administradora/);
  assert.match(r.texto, /Edital do \[preencher\]/);
  assert.doesNotMatch(r.texto, /\[[A-Z]{3}/);
  for (const p of ['dado da empresa: endereço', 'dado da empresa: RG']) assert.ok(r.pendencias.includes(p));
  assert.ok(r.pendencias.some(p => /MODALIDADE DA LICITAÇÃO/.test(p)), r.pendencias.join(' | '));
});
