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

test('sem colunas no edital usa o padrão e marca a pendência; marca e registro entram quando o edital exige', () => {
  const { colunas } = escolherColunas([regra('colunas_itens', 'Item, Especificação, Valor Unitário R$, Valor Total R$'), regra('marca_fabricante', 'informar marca'), regra('registro_anvisa', 'número do registro')]);
  assert.deepEqual(colunas.slice(-2), ['Marca', 'Registro ANVISA']);
  const doc = gerarDocumentoProposta({ pregao, empresa, hoje, itens: [item], regras: [] });
  assert.ok(doc.pendencias.some(p => p.startsWith('colunas da tabela não especificadas')));
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
  assert.match(md, /Validade da proposta:\*\* 120 dias corridos\./);
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
