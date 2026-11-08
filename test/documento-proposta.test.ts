import { test, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gerarDocumentoProposta, escolherColunas, casasDecimaisDe, type ItemProposta } from '../src/lib/documento-proposta.ts';
import type { RegraProposta } from '../src/lib/regras-proposta.ts';
import { tools, newState } from '../src/lib/tools.ts';
import { anvisa, pncp, pdf } from '../src/lib/data.ts';
afterEach(() => mock.restoreAll());

const regra = (campo: RegraProposta['campo'], valor: string, citacao = valor): RegraProposta => ({ campo, valor, citacao, fonte: { nome: 'edital.pdf', url: 'u' } });
const item: ItemProposta = { numero: 225, descricao: 'Tesoura Instrumental, Ponta Curva | 12 cm', unidade: 'Unidade', quantidade: 5,
  marca: 'Professional', modelo: 'Tesoura Metzenbaum', fabricante: 'Fab SA', registroAnvisa: '10150470165', precoUnitario: 27.5 };
const pregao = { id: '00394429000100/2026/2941', orgao: 'COMANDO DA AERONAUTICA', municipio: 'Anápolis', uf: 'GO' };
const empresa = { nome: 'Distribuidora Modelo Ltda', porte: 'EPP' };
const hoje = new Date('2026-11-07T12:00:00-03:00');

test('usa a tabela do modelo de proposta, não a lista de campos do sistema', () => {
  const { colunas, doEdital } = escolherColunas([
    regra('colunas_itens', 'Sistema: valor unitário, valor total, marca, fabricante, quantidade cotada'),
    regra('colunas_itens', 'ITEM, DESCRIÇÃO, UN, QTD, MARCA/MODELO, PREÇO UNITÁRIO, PREÇO TOTAL'),
  ]);
  assert.equal(doEdital, true);
  assert.deepEqual(colunas, ['ITEM', 'DESCRIÇÃO', 'UN', 'QTD', 'MARCA/MODELO', 'PREÇO UNITÁRIO', 'PREÇO TOTAL']);
});

test('preenche cada coluna com o dado certo e calcula o total', () => {
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item, { ...item, numero: 226, quantidade: 3, precoUnitario: 10.005 }],
    regras: [regra('colunas_itens', 'ITEM, DESCRIÇÃO, UN, QTD, MARCA/MODELO, PREÇO UNITÁRIO, PREÇO TOTAL')] });
  assert.match(doc.markdown, /\| 225 \| Tesoura Instrumental, Ponta Curva \\\| 12 cm \| Unidade \| 5 \| Professional \/ Tesoura Metzenbaum \| 27,50 \| 137,50 \|/);
  assert.match(doc.markdown, /\| 226 \|.*\| 10,01 \| 30,03 \|/);
  assert.equal(doc.total, 167.53);
  assert.match(doc.markdown, /Valor global da proposta: R\$ 167,53/);
});

test('colunas citadas pelo edital ficam exatamente como no edital; marca e registro exigidos vão na especificação', () => {
  // Colunas citadas no edital real 77816510000166/2026/348. Antes, a minuta acrescentava "Marca" e "Registro ANVISA"
  // ao fim da tabela, fugindo do layout que o órgão pediu.
  const regras = [regra('colunas_itens', 'Item, Especificação, Unidade, Quantidade, Valor Unitário R$, Valor Total R$'),
    regra('marca_fabricante', 'informar marca'), regra('registro_anvisa', 'número do registro')];
  const { colunas, naDescricao } = escolherColunas(regras);
  assert.deepEqual(colunas, ['Item', 'Especificação', 'Unidade', 'Quantidade', 'Valor Unitário R$', 'Valor Total R$']);
  assert.deepEqual(naDescricao, ['marca', 'registro']);
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras });
  assert.match(doc.markdown, /\| 225 \| Tesoura Instrumental, Ponta Curva \\\| 12 cm — Marca: Professional — Registro ANVISA: 10150470165 \| Unidade \| 5 \| 27,50 \| 137,50 \|/);
  assert.ok(!/\| Marca \||\| Registro ANVISA \|/.test(doc.markdown));
});

test('sem colunas no edital usa o padrão, com marca e registro, e marca a pendência', () => {
  assert.deepEqual(escolherColunas([]).naDescricao, []);
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras: [] });
  assert.ok(doc.pendencias.some(p => p.startsWith('colunas da tabela não identificadas na análise')));
  assert.ok(doc.colunas.includes('Registro ANVISA'));
});

test('casas decimais saem da regra; sem regra são 2', () => {
  assert.equal(casasDecimaisDe([regra('casas_decimais', 'até 4 casas decimais', 'valores com até 4 (quatro) casas decimais')]), 4);
  assert.equal(casasDecimaisDe([regra('casas_decimais', 'duas casas decimais', 'com no máximo duas casas decimais')]), 2);
  assert.equal(casasDecimaisDe([]), 2);
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [{ ...item, precoUnitario: 27.12345 }], regras: [regra('casas_decimais', '4 casas decimais')] });
  assert.match(doc.markdown, /27,1235/);
});

test('dado que o edital pede e a empresa não tem vira [preencher] e pendência', () => {
  const doc = gerarDocumentoProposta({ pregao, hoje, itens: [item], empresa: { ...empresa, cnpj: '12.345.678/0001-90' },
    regras: [regra('dados_empresa', 'Razão social, CNPJ, endereço, CPF do representante'), regra('dados_bancarios', 'Banco, Agência, Conta')] });
  assert.match(doc.markdown, /\*\*CNPJ:\*\* 12\.345\.678\/0001-90/);
  assert.match(doc.markdown, /\*\*Endereço:\*\* \[preencher\]/);
  assert.ok(!/Telefone/.test(doc.markdown.split('## 2.')[0]));
  for (const p of ['dado da empresa: Endereço', 'dado da empresa: CPF', 'dado bancário: banco']) assert.ok(doc.pendencias.includes(p), p);
  assert.ok(!doc.pendencias.includes('dado da empresa: CNPJ'));
});

test('declaração feita no sistema vai para a conferência, não para o corpo da proposta', () => {
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras: [
    regra('declaracoes', 'ME/EPP declara que cumpre o art. 3º da LC 123', 'deverá declarar, ainda, em campo próprio do sistema eletrônico, que cumpre'),
    regra('declaracoes', 'Declara estar de pleno acordo com todas as condições do Edital'),
  ] });
  const [corpo, conferencia] = doc.markdown.split('## Conferência');
  assert.match(corpo, /- estar de pleno acordo com todas as condições do Edital\./);
  assert.ok(!corpo.includes('LC 123'));
  assert.match(conferencia, /Declarações a marcar no sistema\*\*\n\n- ME\/EPP/);
  assert.deepEqual(doc.declaracoesNoSistema, ['ME/EPP declara que cumpre o art. 3º da LC 123']);
});

test('lacunas: campo essencial sem regra citada aparece como não especificado', () => {
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras: [regra('validade_proposta', '90 dias')] });
  assert.ok(!doc.lacunas.includes('validade_proposta'));
  assert.ok(doc.lacunas.includes('prazo_envio'));
  assert.match(doc.markdown, /Validade da proposta:\*\* 90 dias\./);
});

// Ferramentas no Lance: só para pregão com item viável.
const tid = '11111111000111/2026/1';
const EDITAL = 'ANEXO II MODELO DE PROPOSTA. A validade desta proposta e de 120 (cento e vinte) dias corridos, contados da data da abertura. ' +
  'O prazo para envio da proposta e de, no maximo, 02 (duas) horas a contar da convocaçao pelo sistema.';
function lance(estado: string | null) {
  const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
  const state = newState(company, 'http://127.0.0.1:9', hoje);
  state.tenders[tid] = { orgao: 'Prefeitura X', municipio: 'Recife', uf: 'PE', abertura: '2026-11-23T09:00' };
  state.items[tid] = [{ numero: 1, descricao: 'Cabo de bisturi nº 4', quantidade: 10, unidade: 'Unidade', valorEstimado: 12, sigiloso: false }];
  if (estado) state.decisions[tid + '#1'] = { estado, produto: 'P1', precoProposto: 7.5 };
  mock.method(pncp, 'files', async () => [{ tipo: 'Edital', titulo: 'Edital', url: 'https://x/edital.pdf' }]);
  mock.method(pdf, 'fromUrl', async () => ({ kind: 'pdf', text: EDITAL }));
  mock.method(anvisa, 'byRegistro', () => ({ NOME_FABRICANTE: 'STRAUMED IND' }));
  return { state, approvals: new Set<string>() };
}
const run = (nome: string, args: unknown, ctx: any): Promise<any> => tools.find(t => t.name === nome)!.run(args, ctx);

test('sem item viável as ferramentas da proposta recusam e nem abrem o edital', async () => {
  for (const estado of [null, 'nao_disputar', 'escalar', 'esclarecer']) {
    const ctx = lance(estado);
    for (const [nome, args] of [['read_proposal_docs', { tender_id: tid }], ['record_proposal_rule', { tender_id: tid, campo: 'validade_proposta', valor: 'x', citacao: 'y' }],
      ['read_proposal_excerpt', { tender_id: tid, arquivo: 'Edital', posicao: 0 }], ['draft_proposal_document', { tender_id: tid }]] as const) {
      const r = await run(nome, args, ctx);
      assert.match(r.erro, /sem item viável/, `${estado} ${nome}`);
    }
    assert.equal((pncp.files as any).mock.callCount(), 0);
  }
});

test('com item viável: lê o edital, registra regras e monta o documento com o preço do decide_item', async () => {
  const ctx = lance('disputar_com_pendencia');
  const aberto = await run('read_proposal_docs', { tender_id: tid, topics: ['validade'] }, ctx);
  assert.match(aberto.pre_selecionados, /\[prazo de envio da proposta\]/);
  assert.equal(aberto.trechos[0].arquivo, 'Edital');
  const segunda = await run('read_proposal_docs', { tender_id: tid, topics: ['modelo'] }, ctx);
  assert.equal(segunda.pre_selecionados, undefined);
  assert.equal((pncp.files as any).mock.callCount(), 1);
  assert.equal((await run('record_proposal_rule', { tender_id: tid, campo: 'validade_proposta', valor: '120 dias corridos', citacao: 'A validade desta proposta e de 120 (cento e vinte) dias corridos' }, ctx)).aceito, true);
  assert.equal((await run('record_proposal_rule', { tender_id: tid, campo: 'validade_proposta', valor: '60 dias', citacao: 'A validade desta proposta e de 60 dias' }, ctx)).aceito, false);
  const r = await run('draft_proposal_document', { tender_id: tid }, ctx);
  assert.equal(r.gerado, true);
  assert.deepEqual(r.itens, [1]);
  assert.equal(r.total, 75);
  assert.ok(r.lacunas.includes('prazo_envio'));
  const md = ctx.state.proposals![tid].markdown;
  assert.match(md, /\| 1 \| Cabo de bisturi nº 4 \| Unidade \| 10 \| Straumed \| STRAUMED IND \| 82936150004 \| 7,50 \| 75,00 \|/);
  assert.match(md, /Validade da proposta:\*\* A validade desta proposta e de 120 \(cento e vinte\) dias corridos\./);
});

test('item disputável sem preço calculado fica fora do documento e é informado', async () => {
  const ctx = lance('disputar');
  ctx.state.decisions[tid + '#1'].precoProposto = null;
  const r = await run('draft_proposal_document', { tender_id: tid }, ctx);
  assert.deepEqual(r.itens, []);
  assert.deepEqual(r.itens_sem_preco, [1]);
  assert.ok(r.pendencias.includes('nenhum item viável para cotar'));
});

test('documentos sem texto escalam a montagem da proposta', async () => {
  const ctx = lance('disputar');
  mock.method(pdf, 'fromUrl', async () => ({ kind: 'zip', text: null }));
  const aberturas: unknown[] = [];
  ctx.state.analysisStore = { openEscalation: (req: unknown) => { aberturas.push(req); return {} as any; } };
  const r = await run('read_proposal_docs', { tender_id: tid }, ctx);
  assert.equal(r.escalar, true);
  assert.equal(aberturas.length, 1);
});

test('valor global por extenso, como pedem os modelos de proposta', async () => {
  const { porExtenso } = await import('../src/lib/documento-proposta.ts');
  assert.equal(porExtenso(40037.5), 'quarenta mil e trinta e sete reais e cinquenta centavos');
  assert.equal(porExtenso(1), 'um real');
  assert.equal(porExtenso(0.01), 'um centavo');
  assert.equal(porExtenso(100), 'cem reais');
  assert.equal(porExtenso(101), 'cento e um reais');
  assert.equal(porExtenso(1250), 'mil duzentos e cinquenta reais');
  assert.equal(porExtenso(5500), 'cinco mil e quinhentos reais');
  assert.equal(porExtenso(21000), 'vinte e um mil reais');
  assert.equal(porExtenso(1000000), 'um milhão de reais');
  assert.equal(porExtenso(2500000), 'dois milhões e quinhentos mil reais');
  assert.equal(porExtenso(1001250.99), 'um milhão, mil duzentos e cinquenta reais e noventa e nove centavos');
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras: [] });
  assert.match(doc.markdown, /Valor global da proposta: R\$ 137,50 \(cento e trinta e sete reais e cinquenta centavos\)/);
});

test('modelo que pede o responsável pela assinatura do contrato ou da ata ganha o bloco com os dados', () => {
  const assinatura = regra('assinatura', 'responsável pelo contrato ou Ata de Registro de Preços: nome, CPF, endereço',
    'Responsável pela assinatura do contrato ou da Ata de Registro de Preços: - Nome: .... - CPF: .... - Endereço: .... - Telefone: .... - e-mail: ....');
  const doc = gerarDocumentoProposta({ pregao, hoje, itens: [item], regras: [assinatura],
    empresa: { ...empresa, representante: { nome: 'Ana Souza', cpf: '000.000.000-00', email: 'ana@exemplo.com' } } });
  assert.match(doc.markdown, /## \d\. Responsável pela assinatura do contrato ou da ata/);
  assert.match(doc.markdown, /\*\*Nome:\*\* Ana Souza/);
  assert.match(doc.markdown, /\*\*E-mail:\*\* ana@exemplo\.com/);
  assert.ok(doc.pendencias.includes('responsável pelo contrato: Endereço'));
  assert.ok(doc.pendencias.includes('responsável pelo contrato: Telefone'));
  assert.doesNotMatch(doc.markdown.split('## Conferência')[0], /_Assinatura: responsável pelo contrato/);
  const sem = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras: [regra('assinatura', 'Assinatura e carimbo do responsável da empresa')] });
  assert.doesNotMatch(sem.markdown, /Responsável pela assinatura do contrato/);
});

test('texto copiado do edital não sai com pontuação dobrada', () => {
  // Citações reais do edital 348: terminam em ponto e eram unidas com "; " e um ponto final a mais ("pedido..").
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras: [
    regra('validade_proposta', '120 dias', 'A validade desta proposta e de 120 (cento e vinte) dias corridos, contados da data da abertura da sessao publica de PREGAO ELETRONICO.'),
    regra('validade_proposta', 'prorrogação', 'Podera ser solicitado ao licitante a prorrogaçao do prazo de validade da PROPOSTA por ate 30 (trinta) dias.'),
    regra('quantidade', 'mínimo de 10% da quantidade total do item.')] });
  const condicoes = doc.markdown.split('## 3. Condições')[1].split('##')[0];
  assert.ok(!/\.\.|\.;/.test(condicoes), condicoes);
  assert.match(condicoes, /PREGAO ELETRONICO; Podera ser solicitado .* 30 \(trinta\) dias\./);
  assert.match(condicoes, /\*\*Quantidade:\*\* mínimo de 10% da quantidade total do item\./);
});

test('cláusula de efeito do envio não vira declaração da empresa na minuta, como já não vira no plano', () => {
  // Citações reais do edital 77816510000166/2026/348. A primeira é efeito ("implicará"), não pedido de declaração.
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras: [
    regra('declaracoes', 'aceitação plena e total das condições do edital e anexos', 'A apresentação da proposta implicará na plena aceitação das condições estabelecidas neste edital e seus anexos.'),
    regra('declaracoes', 'atende aos requisitos de habilitação', 'Declaro que a proponente atende aos requisitos de habilitaçao e o declarante atesta a veracidade das informaçoes prestadas (art. 63, I, da Lei nº 14.133/2021).')] });
  const declaracoes = doc.markdown.split('A proponente declara:')[1]?.split('##')[0] ?? '';
  assert.ok(!/aceitação plena/.test(declaracoes), declaracoes);
  assert.match(declaracoes, /atende aos requisitos de habilitação/);
});

// Casos reproduzidos pelo Dev 3 na revisão do #39: a tabela citada pelo edital não pode ganhar nem quebrar colunas.
test('tabela citada sem valor unitário não ganha a coluna; os cabeçalhos e a ordem ficam os do edital', () => {
  const regras = [regra('colunas_itens', 'Item, Especificação, Quantidade, Valor Total R$')];
  assert.deepEqual(escolherColunas(regras).colunas, ['Item', 'Especificação', 'Quantidade', 'Valor Total R$']);
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras });
  assert.match(doc.markdown, /\| Item \| Especificação \| Quantidade \| Valor Total R\$ \|\n\| --- \| --- \| --- \| --- \|\n\| 225 \| .* \| 5 \| 137,50 \|/);
});

test('rótulo composto "Marca e Modelo" fica uma coluna só; enumeração "a, b e c" continua separada', () => {
  const composto = escolherColunas([regra('colunas_itens', 'ITEM, DESCRIÇÃO, MARCA E MODELO, QTD, PREÇO UNITÁRIO, PREÇO TOTAL')]).colunas;
  assert.deepEqual(composto, ['ITEM', 'DESCRIÇÃO', 'MARCA E MODELO', 'QTD', 'PREÇO UNITÁRIO', 'PREÇO TOTAL']);
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras: [regra('colunas_itens', 'ITEM, DESCRIÇÃO, MARCA E MODELO, QTD, PREÇO UNITÁRIO, PREÇO TOTAL')] });
  assert.match(doc.markdown, /\| 225 \| .* \| Professional \/ Tesoura Metzenbaum \| 5 \| 27,50 \| 137,50 \|/);
  assert.deepEqual(escolherColunas([regra('colunas_itens', 'item, descrição, quantidade, valor unitário e valor total')]).colunas,
    ['item', 'descrição', 'quantidade', 'valor unitário', 'valor total']);
});

test('tabela citada sem coluna indispensável: não inventa a coluna e pede conferência do modelo', () => {
  const regras = [regra('colunas_itens', 'Quantidade, Valor Unitário, Valor Total'), regra('marca_fabricante', 'informar marca')];
  assert.deepEqual(escolherColunas(regras).colunas, ['Quantidade', 'Valor Unitário', 'Valor Total']);
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras });
  for (const falta of ['número do item', 'descrição do item']) {
    assert.ok(doc.pendencias.some(p => p.includes(falta) && /conferir com o modelo/.test(p)), `${falta}: ${doc.pendencias.join(' | ')}`);
  }
  assert.ok(doc.pendencias.some(p => /marca/.test(p) && /conferir com o modelo/.test(p)), doc.pendencias.join(' | '));
});

test('lista de campos do sistema não é modelo de proposta: a tabela ganha item, descrição e registro (edital real 22617)', () => {
  // As duas regras como foram extraídas do edital real: o "no sistema" está na forma de envio, não na lista.
  const envio = regra('forma_envio', 'preenchimento no sistema eletrônico', 'O licitante deverá enviar sua proposta mediante o preenchimento, no sistema eletrônico, dos seguintes campos:');
  const sistema = regra('colunas_itens', 'valor unitário, valor total, marca, fabricante, quantidade cotada',
    '6.1.1 valor unitário e total do item; 6.1.2 marca; 6.1.3 fabricante; 6.1.4 Quantidade cotada, devendo respeitar o Termo de Referência.');
  const { colunas, faltam } = escolherColunas([envio, sistema, regra('registro_anvisa', 'número do registro na ANVISA')]);
  assert.deepEqual(colunas.slice(0, 2), ['Item', 'Descrição']);
  assert.ok(colunas.includes('Registro ANVISA'));
  assert.deepEqual(faltam, []);
});
