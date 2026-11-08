import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LLM } from '../src/lib/agent.ts';
import { extrairRegrasProposta, ferramentasRegras, preLeitura, CAMPOS_ESSENCIAIS, type Documento } from '../src/lib/regras-proposta.ts';

// Trechos reais do Pregão Eletrônico 90114/2026 de Francisco Beltrão (PNCP 77816510000166/2026/348).
const EDITAL: Documento = { nome: 'EDITAL PE SRP 90114.2026.pdf', url: 'https://pncp.gov.br/edital.pdf', texto:
  '10.1 O Pregoeiro solicitara a licitante provisoriamente vencedora o envio da proposta de preços formatada de acordo com o Anexo II do edital e devidamente adequada ao ultimo lance, por meio de campo proprio do sistema. ' +
  '10.1.3 O prazo para envio da proposta e de, no maximo, 02 (duas) horas a contar da convocaçao pelo sistema. ' +
  'ANEXO – II MODELO DE PROPOSTA A empresa ..............................., estabelecida na (endereço completo, telefone, fax e endereço eletronico, se houver), inscrita no CNPJ sob nº ....... ' +
  'A validade desta proposta e de 120 (cento e vinte) dias corridos, contados da data da abertura da sessao publica de PREGAO ELETRONICO.' };
const TR: Documento = { nome: 'TERMO DE REFERENCIA.pdf', url: 'https://pncp.gov.br/tr.pdf', texto: 'Objeto: instrumentais cirúrgicos. Garantia mínima de 12 meses.' };
const ANEXO: Documento = { nome: 'ANEXO CATALOGOS.pdf', url: 'https://pncp.gov.br/anexo.pdf', texto:
  '11.2. As licitantes provisoriamente vencedoras serao convocadas para, no prazo de 02 (duas) horas uteis, anexar, juntamente com a proposta ajustada, catalogos, prospectos, folders, etc. dos produtos, sob pena de desclassificaçao.' };

const call = (name: string, args: unknown, id = name) => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
const scripted = (turns: any[]): LLM & { chamadas: number } => {
  const llm = { model: 'scripted', chamadas: 0, async chat() { const m = turns[llm.chamadas++]; if (!m) throw new Error('roteiro acabou'); return { message: m, usage: { prompt_tokens: 10, completion_tokens: 5 }, ms: 1 }; } };
  return llm;
};
const run = (nome: string, args: unknown, c: any): Promise<any> => ferramentasRegras().find(t => t.name === nome)!.run(args, c);
const ctx = (docs: Documento[]) => ({ approvals: new Set<string>(), state: { documentos: docs, regras: [] as any[] } });

test('registrar_regra aceita citação literal e guarda a fonte', async () => {
  const c = ctx([EDITAL, TR]);
  const r: any = await run('registrar_regra', { campo: 'validade_proposta', valor: '120 dias corridos, contados da abertura da sessão',
    citacao: 'A validade desta proposta e de 120 (cento e vinte) dias corridos, contados da data da abertura' }, c);
  assert.equal(r.aceito, true);
  assert.equal(c.state.regras[0].fonte.nome, 'EDITAL PE SRP 90114.2026.pdf');
});

test('registrar_regra recusa citação que não está nos documentos', async () => {
  const c = ctx([EDITAL]);
  const r: any = await run('registrar_regra', { campo: 'validade_proposta', valor: '60 dias', citacao: 'O prazo de validade da proposta será de 60 (sessenta) dias' }, c);
  assert.equal(r.aceito, false);
  assert.equal(c.state.regras.length, 0);
});

test('ler_documentos procura em todos os arquivos, não só nos dois primeiros', async () => {
  const c = ctx([EDITAL, TR, ANEXO]);
  const r: any = await run('ler_documentos', { topicos: ['catalogos'] }, c);
  assert.ok(r.trechos.some((t: any) => t.arquivo === 'ANEXO CATALOGOS.pdf'));
  assert.deepEqual(r.arquivos.map((a: any) => a.nome), ['EDITAL PE SRP 90114.2026.pdf', 'TERMO DE REFERENCIA.pdf', 'ANEXO CATALOGOS.pdf']);
});

test('extrairRegrasProposta: regras citadas, lacunas dos campos essenciais e custo do agente', async () => {
  const llm = scripted([
    call('ler_documentos', { topicos: ['validade', 'modelo de proposta'] }, 'a'),
    call('registrar_regra', { campo: 'validade_proposta', valor: '120 dias corridos, contados da abertura da sessão',
      citacao: 'A validade desta proposta e de 120 (cento e vinte) dias corridos' }, 'b'),
    call('registrar_regra', { campo: 'prazo_envio', valor: '2 horas a contar da convocação',
      citacao: 'O prazo para envio da proposta e de, no maximo, 02 (duas) horas a contar da convocaçao pelo sistema' }, 'c'),
    call('registrar_regra', { campo: 'modelo_proposta', valor: 'Anexo II — Modelo de Proposta',
      citacao: 'formatada de acordo com o Anexo II do edital e devidamente adequada ao ultimo lance' }, 'd'),
    { role: 'assistant', content: 'concluído' },
  ]);
  const r = await extrairRegrasProposta({ tenderId: '77816510000166/2026/348', llm, carregar: async () => [EDITAL, TR, ANEXO] });
  assert.equal(r.legivel, true);
  assert.deepEqual(r.regras.map(x => x.campo), ['validade_proposta', 'prazo_envio', 'modelo_proposta']);
  assert.ok(r.regras.every(x => x.fonte?.url));
  assert.ok(r.lacunas.includes('documentos_anexos'));
  assert.ok(!r.lacunas.includes('validade_proposta'));
  assert.ok(r.lacunas.every(l => CAMPOS_ESSENCIAIS.includes(l)));
  assert.equal(r.usage.prompt_tokens, 50);
  assert.deepEqual(r.arquivos, ['EDITAL PE SRP 90114.2026.pdf', 'TERMO DE REFERENCIA.pdf', 'ANEXO CATALOGOS.pdf']);
});

test('sem documento legível o agente nem é chamado', async () => {
  const llm = scripted([]);
  const r = await extrairRegrasProposta({ tenderId: 'x/2026/1', llm, carregar: async () => [{ nome: 'edital.zip', url: 'u', texto: '' }] });
  assert.equal(r.legivel, false);
  assert.equal(llm.chamadas, 0);
  assert.deepEqual(r.lacunas, CAMPOS_ESSENCIAIS);
});

test('regra repetida não duplica', async () => {
  const c = ctx([EDITAL]);
  const a = { campo: 'prazo_envio', valor: '2 horas', citacao: 'O prazo para envio da proposta e de, no maximo, 02 (duas) horas' };
  await run('registrar_regra', a, c);
  await run('registrar_regra', a, c);
  assert.equal(c.state.regras.length, 1);
});

test('pré-leitura entrega o anexo do modelo (última menção), não a menção do índice', () => {
  const doc = { nome: 'edital.pdf', url: 'u', texto: 'Anexo II – Modelo de Proposta; Anexo III – Minuta. ' + 'x '.repeat(3000) + EDITAL.texto };
  const p = preLeitura([doc]);
  assert.match(p, /\[modelo de proposta \(anexo\)\][^\n]*MODELO DE PROPOSTA A empresa/);
  assert.match(p, /\[validade da proposta\][^\n]*120 \(cento e vinte\) dias/);
});

test('ler_trecho abre o texto na posição pedida e indica a continuação', async () => {
  const c = ctx([EDITAL]);
  const busca: any = await run('ler_documentos', { topicos: ['modelo de proposta'] }, c);
  const pos = busca.ocorrencias[0].posicoes[0];
  const r: any = await run('ler_trecho', { arquivo: EDITAL.nome, posicao: pos, tamanho: 200 }, c);
  assert.match(r.trecho, /^MODELO DE PROPOSTA/);
  assert.equal(r.proxima_posicao, pos + 200);
});

test('registrar_regra recusa citação real que não fala do campo (intervalo de lance não é casas decimais)', async () => {
  const doc = { nome: 'edital.pdf', url: 'u', texto: 'Para a formulaçao dos lances, a licitante devera observar o intervalo mínimo de R$ 0,01 (um centavo de real).' };
  const c = ctx([doc]);
  const r: any = await run('registrar_regra', { campo: 'casas_decimais', valor: '2 casas decimais', citacao: 'a licitante devera observar o intervalo mínimo de R$ 0,01 (um centavo de real)' }, c);
  assert.equal(r.aceito, false);
  assert.match(r.motivo, /não fala de casas decimais/);
  assert.equal(c.state.regras.length, 0);
});
