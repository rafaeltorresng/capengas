// Sanção do próprio cliente (CEIS) como filtro da carteira, fora da decisão do item.
// Art. 156: impedimento vale no ente que aplicou (§4º); inidoneidade vale em todos os entes (§5º).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lerCeis, filtroSancao, type Sancao } from '../src/lib/carteira.ts';

const CNPJ = '12345678000199';
const head = ['CADASTRO', 'CPF OU CNPJ DO SANCIONADO', 'CATEGORIA DA SANÇÃO', 'DATA INÍCIO SANÇÃO', 'DATA FINAL SANÇÃO', 'ÓRGÃO SANCIONADOR', 'UF ÓRGÃO SANCIONADOR', 'ESFERA ÓRGÃO SANCIONADOR'];
const linha = (v: string[]) => '"' + v.join('";"') + '"';
const csv = [linha(head),
  linha(['CEIS', '12.345.678/0001-99', 'Impedimento/proibição de contratar com prazo determinado', '01/03/2026', '01/03/2027', 'Prefeitura Municipal de Curitiba', 'PR', 'MUNICIPAL']),
  linha(['CEIS', '99.999.999/0001-99', 'Inidoneidade', '01/01/2026', '', 'Outro órgão', 'SP', 'FEDERAL']),
  linha(['CEIS', '12.345.678/0001-99', 'Suspensão', '01/01/2020', '01/01/2021', 'Órgão antigo', 'PR', 'ESTADUAL'])].join('\r\n');

const s = (o: Partial<Sancao>): Sancao => ({ categoria: 'Impedimento', tipo: 'impedimento', esfera: 'federal', uf: null, orgao: 'Órgão', inicio: '2026-01-01', fim: null, ...o });
const hoje = '2026-11-07';

describe('lerCeis', () => {
  test('só as linhas do CNPJ do cliente, com tipo, esfera e datas', () => {
    const r = lerCeis(csv, CNPJ);
    assert.equal(r.length, 2);
    assert.deepEqual(r[0], { categoria: 'Impedimento/proibição de contratar com prazo determinado', tipo: 'impedimento', esfera: 'municipal',
      uf: 'PR', orgao: 'Prefeitura Municipal de Curitiba', inicio: '2026-03-01', fim: '2027-03-01' });
    assert.equal(r[1].fim, '2021-01-01');
  });
});

describe('filtroSancao', () => {
  test('CEIS não consultado: não verificado, nunca livre', () => {
    assert.equal(filtroSancao({ esfera: 'F' }, null, hoje).status, 'nao_verificado');
  });
  test('sem sanção vigente: livre (a vencida não conta)', () => {
    assert.equal(filtroSancao({ esfera: 'E', uf: 'PR' }, lerCeis(csv, CNPJ).slice(1), hoje).status, 'livre');
    assert.equal(filtroSancao({ esfera: 'F' }, [], hoje).status, 'livre');
  });
  test('inidoneidade tira todos os entes', () => {
    const r = filtroSancao({ esfera: 'M', uf: 'BA' }, [s({ tipo: 'inidoneidade', esfera: 'federal' })], hoje);
    assert.equal(r.status, 'fora');
    assert.match(r.motivo, /art\. 156, §5º/);
  });
  test('proibição de contratar sem âmbito de ente tira todos', () => {
    assert.equal(lerCeis(linha(head) + '\n' + linha(['CNEP', CNPJ, 'Proibição de contratar com o Poder Público', '01/01/2026', '', 'Justiça', 'PR', 'ESTADUAL']), CNPJ)[0].tipo, 'proibicao');
    assert.equal(filtroSancao({ esfera: 'F' }, [s({ tipo: 'proibicao', esfera: 'estadual', uf: 'PR' })], hoje).status, 'fora');
  });
  test('impedimento federal tira os pregões federais e deixa os outros', () => {
    const imp = [s({ esfera: 'federal' })];
    assert.equal(filtroSancao({ esfera: 'F' }, imp, hoje).status, 'fora');
    assert.equal(filtroSancao({ esfera: 'E', uf: 'PR' }, imp, hoje).status, 'livre');
  });
  test('impedimento estadual: só o estado da mesma UF', () => {
    const imp = [s({ esfera: 'estadual', uf: 'PR' })];
    assert.equal(filtroSancao({ esfera: 'E', uf: 'PR' }, imp, hoje).status, 'fora');
    assert.equal(filtroSancao({ esfera: 'E', uf: 'SC' }, imp, hoje).status, 'livre');
    assert.equal(filtroSancao({ esfera: 'M', uf: 'PR' }, imp, hoje).status, 'livre');
  });
  test('impedimento municipal: o CEIS não diz o município, então municipal da mesma UF fica não verificado', () => {
    const imp = lerCeis(csv, CNPJ);
    assert.equal(filtroSancao({ esfera: 'M', uf: 'PR' }, imp, hoje).status, 'nao_verificado');
    assert.equal(filtroSancao({ esfera: 'M', uf: 'SP' }, imp, hoje).status, 'livre');
    assert.equal(filtroSancao({ esfera: 'F' }, imp, hoje).status, 'livre');
  });
  test('ente do pregão desconhecido com impedimento vigente: não verificado', () => {
    assert.equal(filtroSancao({}, [s({ esfera: 'estadual', uf: 'PR' })], hoje).status, 'nao_verificado');
  });
});
