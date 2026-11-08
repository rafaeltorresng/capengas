import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clausulasDoItem, inventarioCobertura } from '../src/lib/cobertura.ts';
import { tools, newState } from '../src/lib/tools.ts';

const item = 'Cabo bisturi características adicionais: longo, material: aço inoxidável, tamanho: nº 3';

test('só entra campo nomeado, separado por vírgula', () => {
  assert.deepEqual(clausulasDoItem('Comprimento de 4 a 6 mm.'), []);
  assert.deepEqual(clausulasDoItem(item), [
    'Cabo bisturi características adicionais: longo',
    'material: aço inoxidável',
    'tamanho: nº 3',
  ]);
});

// Descrições reais do PNCP (pregão 77816510000166/2026/348, itens 4 e 39). No rastro real de 07/11 o modelo citou
// "características adicionais: longo" e "tamanho: nº 4" e a cobertura ficou de fora três vezes: o nome do item e o
// texto livre do órgão estavam colados aos campos. Ele só passou citando o texto livre inteiro dentro de "tamanho".
const REAL4 = 'Cabo Bisturi características adicionais: longo, material: aço inoxidável, tamanho: nº 4 CABO DE BISTURI Nº4 13 CM AÇO INOX AUTOCLAVÁVEL - CONFORME DESCRIÇÃO DO EDITAL ';
const REAL39 = 'Tesoura Instrumental comprimento total: cerca de 20, esterilidade: esterilizável, haste: haste reta, material: aço inoxidável, modelo 1: metzenbaum - nelson, tipo ponta: ponta curva TESOURA METZENBAUM CURVA 20CM - AÇO INOX – AUTOCLAVÁVEL - CONFORME DESCRIÇÃO DO EDITAL ';

test('texto livre do órgão depois do último campo vira exigência própria', () => {
  assert.deepEqual(clausulasDoItem(REAL4), [
    'Cabo Bisturi características adicionais: longo', 'material: aço inoxidável', 'tamanho: nº 4',
    'CABO DE BISTURI Nº4 13 CM AÇO INOX AUTOCLAVÁVEL - CONFORME DESCRIÇÃO DO EDITAL',
  ]);
  assert.equal(clausulasDoItem(REAL39).at(-2), 'tipo ponta: ponta curva');
  assert.equal(clausulasDoItem(REAL39).at(-1), 'TESOURA METZENBAUM CURVA 20CM - AÇO INOX – AUTOCLAVÁVEL - CONFORME DESCRIÇÃO DO EDITAL');
  // Valor em maiúsculas iniciais ou unidade em maiúsculas não é texto livre.
  assert.deepEqual(clausulasDoItem('Tesoura Instrumental, Comprimento Total:Cerca De 12 CM, Material:Aço Inoxidável'),
    ['Comprimento Total:Cerca De 12 CM', 'Material:Aço Inoxidável']);
});

test('a citação do campo não precisa repetir o nome do item; o texto livre precisa da própria citação', () => {
  const campos = [{ citacao_item: 'características adicionais: longo' }, { citacao_item: 'material: aço inoxidável' }, { citacao_item: 'tamanho: nº 4' }];
  const sem = inventarioCobertura(REAL4, campos);
  assert.equal(sem.cobertura, 'nao_verificada');
  assert.deepEqual(sem.lacunas, ['CABO DE BISTURI Nº4 13 CM AÇO INOX AUTOCLAVÁVEL - CONFORME DESCRIÇÃO DO EDITAL']);
  const com = inventarioCobertura(REAL4, [...campos, { citacao_item: 'CABO DE BISTURI Nº4 13 CM AÇO INOX AUTOCLAVÁVEL - CONFORME DESCRIÇÃO DO EDITAL' }]);
  assert.equal(com.cobertura, 'conferida');
  // Só o valor, sem o nome do campo, não cobre: "longo" sozinho não diz qual exigência foi lida.
  assert.equal(inventarioCobertura(REAL4, [{ citacao_item: 'longo' }, ...campos.slice(1)]).lacunas.length, 2);
});

test('campo sem citação própria continua de fora, mesmo se outra citação trouxer o texto inteiro', () => {
  const parcial = inventarioCobertura(item, [{ citacao_item: 'material: aço inoxidável' }]);
  assert.equal(parcial.cobertura, 'nao_verificada');
  assert.deepEqual(parcial.lacunas, ['Cabo bisturi características adicionais: longo', 'tamanho: nº 3']);
  const umaSo = inventarioCobertura(item, [{ citacao_item: item }]);
  assert.equal(umaSo.cobertura, 'nao_verificada');
  assert.equal(umaSo.lacunas.length, 2);
});

test('um atributo por campo, com a citação literal, confere a cobertura', () => {
  const r = inventarioCobertura(item, [
    { citacao_item: 'características adicionais: longo' },
    { citacao_item: 'material: aço inoxidável' },
    { citacao_item: 'tamanho: nº 3' },
  ]);
  assert.equal(r.cobertura, 'conferida');
  const completo = inventarioCobertura(item, [
    { citacao_item: 'Cabo bisturi características adicionais: longo' },
    { citacao_item: 'material: aço inoxidável' },
    { citacao_item: 'tamanho: nº 3' },
  ]);
  assert.equal(completo.cobertura, 'conferida');
  assert.deepEqual(completo.lacunas, []);
});

test('record_fit grava a lacuna e só confere quando cada campo tem citação', async () => {
  const tool = tools.find(t => t.name === 'record_fit')!;
  const TID = '11111111000111/2026/1';
  const state = newState({ catalogo: [{ id: 'P1', ficha: 'Material: aço inoxidável. Tamanho: nº 3. Características adicionais: longo.' }] }, 'http://127.0.0.1:9');
  state.items[TID] = [{ numero: 1, descricao: item }];
  const ctx = { state, approvals: new Set<string>() };
  const falta: any = await tool.run({ tender_id: TID, item: 1, product_id: 'P1', attributes: [
    { atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável', citacao_ficha: 'Material: aço inoxidável' },
  ] }, ctx);
  assert.equal(falta.validacao.cobertura, 'nao_verificada');
  assert.ok(falta.lacunas.some((l: string) => l.includes('tamanho')));
  const ok: any = await tool.run({ tender_id: TID, item: 1, product_id: 'P1', attributes: [
    { atributo: 'adicional', veredito: 'atende', citacao_item: 'Cabo bisturi características adicionais: longo', citacao_ficha: 'Características adicionais: longo' },
    { atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável', citacao_ficha: 'Material: aço inoxidável' },
    { atributo: 'tamanho', veredito: 'atende', citacao_item: 'tamanho: nº 3', citacao_ficha: 'Tamanho: nº 3' },
  ] }, ctx);
  assert.equal(ok.validacao.cobertura, 'conferida');
  assert.deepEqual(ok.lacunas, []);
});

test('decisão escalada por cobertura diz ao humano qual exigência ficou sem citação', async () => {
  const TID = '77816510000166/2026/348';
  const company = { empresa: { prazoEntregaDias: 60 }, cofre: [], politica: { margemMinima: 0.15, margemAlvo: 0.25 },
    catalogo: [{ id: 'P1', custo: 6, registroAnvisa: '00000000000', ficha: 'Cabo de bisturi nº 4. Material: aço inoxidável AISI 420. Características adicionais: longo.' }] };
  const state = newState(company, 'http://127.0.0.1:9', new Date('2026-11-08T12:00:00-03:00'));
  state.tenders[TID] = { abertura: '2026-11-23T09:00' };
  state.items[TID] = [{ numero: 4, descricao: REAL4, quantidade: 20, valorEstimado: 126.97 }];
  const ctx = { state, approvals: new Set<string>() };
  const fit: any = await tools.find(t => t.name === 'record_fit')!.run({ tender_id: TID, item: 4, product_id: 'P1', attributes: [
    { atributo: 'adicionais', veredito: 'atende', citacao_item: 'características adicionais: longo', citacao_ficha: 'Características adicionais: longo' },
    { atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável', citacao_ficha: 'Material: aço inoxidável' },
    { atributo: 'tamanho', veredito: 'atende', citacao_item: 'tamanho: nº 4', citacao_ficha: 'Cabo de bisturi nº 4' },
  ] }, ctx);
  assert.deepEqual(fit.lacunas, ['CABO DE BISTURI Nº4 13 CM AÇO INOX AUTOCLAVÁVEL - CONFORME DESCRIÇÃO DO EDITAL']);
  const d: any = await tools.find(t => t.name === 'decide_item')!.run({ tender_id: TID, item: 4, product_id: 'P1' }, ctx);
  assert.equal(d.estado, 'escalar');
  assert.ok(d.motivos.some((m: string) => m.includes('sem citação própria') && m.includes('CABO DE BISTURI Nº4')), d.motivos.join(' | '));
});

// Descrição real (PNCP 00394452000103/2026/22617, item 87): o órgão repete a descrição CATMAT em maiúsculas iniciais.
const REAL87 = 'Pinça Para Bisturi Elétrico material: aço inoxidável, modelo: bipolar, modelo haste: haste baioneta, comprimento total: 20, tipo ponta: ponta reta, diâmetro ponta: 1,0, tipo uso: esterilizável Pinça Para Bisturi Elétrico Material: Aço\nInoxidável , Modelo: Bipolar , Modelo Haste:\nHaste Baioneta , Comprimento Total: 20 CM,\nTipo Ponta: Ponta Reta , Diâmetro Ponta: 1,0 MM,\nTipo Uso: Esterilizável';

test('descrição repetida pelo órgão: cada exigência conta uma vez, e a versão com unidade prevalece', () => {
  const c = clausulasDoItem(REAL87);
  assert.ok(c.includes('tipo uso: esterilizável'), JSON.stringify(c));
  assert.ok(!c.some(x => (x.match(/:/g) ?? []).length > 1), 'nenhuma cláusula carrega dois campos');
  assert.ok(c.includes('Comprimento Total: 20 CM') && !c.includes('comprimento total: 20'), JSON.stringify(c));
  assert.equal(c.filter(x => /modelo: bipolar/i.test(x)).length, 1);
  const citacoes = ['material: aço inoxidável', 'modelo: bipolar', 'modelo haste: haste baioneta', 'Comprimento Total: 20 CM',
    'tipo ponta: ponta reta', 'diâmetro ponta: 1,0', 'tipo uso: esterilizável'].map(citacao_item => ({ citacao_item }));
  assert.deepEqual(inventarioCobertura(REAL87, citacoes).lacunas, []);
});

test('campos diferentes com o mesmo fim de nome e o mesmo valor continuam separados', () => {
  const c = inventarioCobertura('Tesoura Instrumental tipo ponta: reta, haste ponta: reta', [{ citacao_item: 'tipo ponta: reta' }]);
  assert.deepEqual(c.lacunas, ['haste ponta: reta']);
});

test('propriedade sobre descrições reais (fixtures do PNCP): toda exigência listada é citável', () => {
  // Se o inventário pedir algo que nenhuma citação literal cobre, o agente persegue a cobertura até o limite
  // (foi o que travou a execução real base-348). Citar cada cláusula listada tem de bastar.
  const descricoes = new Set<string>();
  const coletar = (v: any): void => {
    if (!v || typeof v !== 'object') return;
    if (typeof v.descricao === 'string' && v.descricao.length > 20) descricoes.add(v.descricao);
    for (const k in v) coletar(v[k]);
  };
  for (const f of ['coverage.json', 'coded-items.json']) coletar(JSON.parse(readFileSync(new URL(`../fixtures/${f}`, import.meta.url), 'utf8')));
  assert.ok(descricoes.size > 300, `poucas descrições reais: ${descricoes.size}`);
  for (const d of descricoes) {
    const c = clausulasDoItem(d);
    assert.ok(c.every(x => x.trim().length > 0), d);
    if (c.length) assert.equal(inventarioCobertura(d, c.map(citacao_item => ({ citacao_item }))).cobertura, 'conferida', d);
  }
});
