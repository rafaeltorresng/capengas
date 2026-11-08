import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrarCondicao, avaliarOperacao as avaliarOperacaoReal, aplicarOperacao, buscarCondicoesOperacionais, operacaoDoEstado, type CondicaoOperacional } from '../src/lib/operacao.ts';
import { newState } from '../src/lib/tools.ts';

// Cláusulas e perfis construídos para testar regras; não são edital ou empresa reais.
const entrega = 'A entrega será realizada em 15 (quinze) dias corridos após o recebimento da ordem de fornecimento.';
const docs = [{ nome: 'TR de teste', url: 'https://example.org/tr', texto: entrega }];
const empresa = { prazoEntregaDias: 60, prazoEntregaUnidade: 'corridos' as const, prazoEntregaMarco: 'ordem_fornecimento' as const };
const concluida = { estado: 'concluida' as const, motivo: 'Revisão controlada concluída.' };
const avaliarOperacao = (c: Parameters<typeof avaliarOperacaoReal>[0], e: Parameters<typeof avaliarOperacaoReal>[1], i: number[], r = concluida as Parameters<typeof avaliarOperacaoReal>[3]) => avaliarOperacaoReal(c, e, i, r);
function condicao(campo: string, citacao: string, item?: number) {
  const lista: CondicaoOperacional[] = [];
  const result = registrarCondicao([{ ...docs[0], texto: citacao }], lista, { campo, arquivo: docs[0].nome, citacao, item }, [4, 39]);
  assert.equal(result.aceito, true);
  return lista[0];
}
test('condição exige citação literal, assunto, arquivo e escopo válido; não aceita prazo do modelo', () => {
  const lista: CondicaoOperacional[] = [];
  assert.equal(registrarCondicao(docs, lista, { campo: 'entrega', arquivo: docs[0].nome, citacao: entrega.replace('15', '10') }, [4]).aceito, false);
  assert.equal(registrarCondicao(docs, lista, { campo: 'pagamento', arquivo: docs[0].nome, citacao: entrega }, [4]).aceito, false);
  assert.equal(registrarCondicao(docs, lista, { campo: 'entrega', arquivo: 'outro', citacao: entrega }, [4]).aceito, false);
  assert.equal(registrarCondicao(docs, lista, { campo: 'entrega', arquivo: docs[0].nome, citacao: entrega, item: 99 }, [4]).aceito, false);
  assert.equal(lista.length, 0);
  for (let i = 0; i < 2; i++) assert.equal(registrarCondicao(docs, lista, { campo: 'entrega', arquivo: docs[0].nome, citacao: entrega }, [4]).aceito, true);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].fonte.url, docs[0].url);
  for (const q of ['Verifique a validade das assinaturas dos documentos.', 'A validade da Ata de Registro de Preços será de um ano.', 'A validade da proposta será de 90 dias corridos.']) {
    assert.equal(registrarCondicao([{ ...docs[0], texto: q }], [], { campo: 'validade_produto', arquivo: docs[0].nome, citacao: q }, [4]).aceito, false);
  }
});
test('entrega compara apenas duração, unidade e marco compatíveis; cadastro atual não presume bases', () => {
  const c = condicao('entrega', entrega);
  const avaliar = (e: Parameters<typeof avaliarOperacao>[1]) => avaliarOperacao([c], e, [4]).linhas.find(l => l.campo === 'entrega')!;
  assert.equal(avaliar(empresa).estado, 'conflito');
  assert.equal(avaliar({ ...empresa, prazoEntregaDias: 10 }).estado, 'compativel');
  assert.equal(avaliar({ prazoEntregaDias: 60 }).estado, 'confirmar');
  assert.equal(avaliar({ ...empresa, prazoEntregaUnidade: 'uteis' }).estado, 'confirmar');
  assert.equal(avaliar({ ...empresa, prazoEntregaMarco: 'nota_empenho' }).estado, 'confirmar');
});
test('dias sem unidade, contagens ambíguas e cláusulas divergentes não produzem compatibilidade', () => {
  for (const quote of [
    'A entrega será em 15 dias após o recebimento da ordem de fornecimento.',
    'A entrega ocorrerá em 15 dias corridos após a assinatura do contrato.',
    'A entrega será em 15 dias corridos e o pagamento em 30 dias corridos após o recebimento da ordem de fornecimento.',
    'A entrega será em até 2 meses após a ordem de fornecimento.',
    'A entrega será em 15 dias corridos após a emissão da ordem de fornecimento.',
  ]) assert.equal(avaliarOperacao([condicao('entrega', quote)], empresa, [4]).linhas[0].estado, 'confirmar');
  const c = condicao('entrega', entrega);
  const outro = condicao('entrega', entrega.replace('15 (quinze)', '90 (noventa)'));
  assert.equal(avaliarOperacao([c, outro], empresa, [4]).linhas[0].estado, 'confirmar');
});
test('completar a evidência recalcula só a ressalva operacional e preserva preço e pendência técnica', () => {
  const st = newState({ empresa: { ...empresa, prazoEntregaDias: 10 } }, '', new Date());
  st.tenders.t = {}; st.operationalConditions = {};
  st.decisions['t#4'] = { estado: 'disputar', motivos: ['Encaixe atende'], precoProposto: 7.5 };
  aplicarOperacao(st, 't'); assert.equal(st.decisions['t#4'].estado, 'disputar_com_pendencia');
  const completas = [condicao('entrega', entrega),
    condicao('fornecimento', 'O fornecimento será em entrega única no almoxarifado municipal.'),
    condicao('amostra', 'A apresentação de amostra não será exigida nesta contratação.'),
    condicao('validade_produto', 'Não será exigida validade mínima dos produtos nesta contratação.'),
    condicao('pagamento', 'O pagamento será realizado após o recebimento e atesto da nota fiscal.')];
  st.operationalConditions.t = completas; st.operationalReviews = { t: concluida };
  aplicarOperacao(st, 't');
  assert.equal(st.decisions['t#4'].estado, 'disputar');
  assert.equal(st.decisions['t#4'].precoProposto, 7.5);
  assert.deepEqual(st.decisions['t#4'].motivos, ['Encaixe atende']);
  st.decisions['t#39'] = { estado: 'disputar_com_pendencia', motivos: ['Cobertura ANVISA não comprovada'], precoProposto: 8 };
  aplicarOperacao(st, 't'); assert.equal(st.decisions['t#39'].estado, 'disputar_com_pendencia');
  assert.deepEqual(st.decisions['t#39'].motivos, ['Cobertura ANVISA não comprovada']);
});
test('condição de um item não é aplicada aos demais; referência explícita exige escopo', () => {
  const c = condicao('entrega', entrega, 4);
  const r = avaliarOperacao([c], empresa, [4, 39]);
  assert.equal(r.linhas.find(l => l.campo === 'entrega' && l.item === 4)?.estado, 'conflito');
  assert.equal(r.linhas.find(l => l.campo === 'entrega' && l.item === 39)?.estado, 'nao_identificada');
  const q = 'Para o item 4, a entrega será em 15 dias corridos após a ordem de fornecimento.';
  assert.equal(registrarCondicao([{ ...docs[0], texto: q }], [], { campo: 'entrega', arquivo: docs[0].nome, citacao: q }, [4, 39]).aceito, false);
  const plural = q.replace('o item 4', 'os itens 4 e 39');
  assert.equal(registrarCondicao([{ ...docs[0], texto: plural }], [], { campo: 'entrega', arquivo: docs[0].nome, citacao: plural }, [4, 39]).aceito, false);
});
test('amostra, fornecimento, validade e pagamento preservam condições; ausência não significa dispensa', () => {
  const quotes = [
    ['fornecimento', 'O fornecimento será parcelado, com entrega no almoxarifado municipal.'],
    ['amostra', 'Somente se solicitada, a amostra deverá ser entregue em 3 dias úteis.'],
    ['validade_produto', 'Os produtos devem ter validade mínima de 12 meses no momento da entrega.'],
    ['pagamento', 'O pagamento ocorrerá em 30 dias corridos após o atesto da nota fiscal.'],
  ];
  const r = avaliarOperacao(quotes.map(([campo, q]) => condicao(campo, q)), empresa, [4]);
  assert.equal(r.requerRevisao, true);
  assert.equal(r.linhas.find(l => l.campo === 'pagamento')?.estado, 'informada');
  assert.match(r.linhas.find(l => l.campo === 'pagamento')!.citacoes[0].citacao, /após o atesto/);
  assert.equal(r.linhas.find(l => l.campo === 'validade_produto')?.estado, 'confirmar');
  assert.equal(avaliarOperacao([], empresa, [4]).linhas.length, 5);
  assert.ok(avaliarOperacao([], empresa, [4]).linhas.every(l => l.estado === 'nao_identificada'));
});
test('pré-leitura operacional não manda rodapés de assinatura e validade da ata como validade do produto', () => {
  const texto = ('Para verificar a validade das assinaturas acesse o portal. Validade da Ata: um ano. '.repeat(20))
    + ' Os produtos devem ter validade mínima de 12 meses. O prazo de entrega é de 30 dias após a nota de empenho.';
  const r = buscarCondicoesOperacionais([{ ...docs[0], texto }]);
  const validade = r.trechos.filter(t => t.campo === 'validade_produto');
  assert.equal(validade.length, 1);
  assert.match(validade[0].trecho, /produtos devem ter validade mínima/);
  assert.ok(r.trechos.some(t => t.campo === 'entrega'));
  assert.equal(buscarCondicoesOperacionais([{ ...docs[0], texto: 'A validade da proposta é de 90 dias. Confira a validade das assinaturas.' }]).trechos.filter(t => t.campo === 'validade_produto').length, 0);
  assert.equal(buscarCondicoesOperacionais([{ ...docs[0], texto: 'A empresa fornecerá materiais, Para verificar a validade das assinaturas acesse o portal.' }]).trechos.filter(t => t.campo === 'validade_produto').length, 0);
});
test('prazo fracionário ou faixa não vira inteiro e emissão do pedido não é recebimento', () => {
  for (const q of [
    'A entrega será em 0,5 dias corridos após o recebimento da ordem de fornecimento.',
    'A entrega será em 10-15 dias corridos após o recebimento da ordem de fornecimento.',
    'A entrega será em 5 dias corridos após a solicitação do pedido.',
  ]) {
    const perfil = { prazoEntregaDias: 3, prazoEntregaUnidade: 'corridos' as const, prazoEntregaMarco: q.includes('pedido') ? 'pedido' as const : 'ordem_fornecimento' as const };
    assert.equal(avaliarOperacao([condicao('entrega', q)], perfil, [4]).linhas[0].estado, 'confirmar');
  }
});
test('dispensa condicionada por momento ou contraposta a outra obrigação exige confirmação', () => {
  for (const [campo, q] of [
    ['amostra', 'A amostra não será exigida antes da sessão; será solicitada depois.'],
    ['validade_produto', 'Não será exigida validade mínima de 12 meses, mas os produtos deverão ter validade de 6 meses.'],
  ]) assert.equal(avaliarOperacao([condicao(campo, q)], empresa, [4]).linhas.find(l => l.campo === campo)!.estado, 'confirmar');
});

test('revisão concluída sem cláusula de validade informa cobertura, sem condicionar item compatível', () => {
  const st = newState({ empresa: { ...empresa, prazoEntregaDias: 10 } }, '');
  st.tenders.t = {}; st.decisions['t#4'] = { estado: 'disputar', motivos: ['Encaixe atende'], precoProposto: 7.5 };
  st.operationalConditions = { t: [condicao('entrega', entrega),
    condicao('fornecimento', 'O fornecimento será em entrega única no almoxarifado municipal.'),
    condicao('amostra', 'A apresentação de amostra não será exigida nesta contratação.'),
    condicao('pagamento', 'O pagamento será realizado após o recebimento e atesto da nota fiscal.')] };
  st.operationalReviews = { t: { estado: 'concluida', motivo: 'Revisão dos trechos consultados concluída.' } };
  aplicarOperacao(st, 't');
  assert.equal(st.decisions['t#4'].estado, 'disputar');
  assert.deepEqual(st.decisions['t#4'].motivos, ['Encaixe atende']);
  const op = avaliarOperacao(st.operationalConditions.t, st.company.empresa, [4], st.operationalReviews.t);
  assert.equal(op.requerRevisao, false);
  assert.equal(op.linhas.find(l => l.campo === 'validade_produto')?.estado, 'nao_identificada');
  assert.match(op.linhas.find(l => l.campo === 'validade_produto')!.detalhe, /não significa dispensa/);
});

test('revisão não executada nunca é apresentada como busca sem cláusulas, mesmo em dossiê legado', () => {
  const op = avaliarOperacao([], empresa, [4], { estado: 'nao_executada', motivo: 'Sem orçamento disponível.' });
  assert.ok(op.linhas.every(l => l.estado === 'nao_avaliada'));
  assert.equal(op.requerRevisao, true);
  assert.ok(op.pendencias.some(p => /Sem orçamento/.test(p)));
});


test('dossiê operacional legado não inventa execução nem ausência de execução', () => {
  const st = newState({ empresa }, ''); st.tenders.t = {}; st.operationalConditions = {};
  const op = operacaoDoEstado(st, 't')!;
  assert.equal(op.revisao?.estado, 'nao_registrada');
  assert.ok(op.linhas.every(l => l.estado === 'nao_avaliada'));
  assert.equal(op.requerRevisao, true);
});
