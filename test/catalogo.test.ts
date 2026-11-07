// Catálogo × base oficial da ANVISA: o registro do produto tem de existir, estar vigente e ser da marca declarada.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { conferirRegistro, conferirCatalogo, buscarRegistros } from '../src/lib/catalogo.ts';

const hoje = new Date('2026-11-07T12:00:00-03:00');
// Linhas reais da base TA_PRODUTO_SAUDE_SITE (dados.anvisa.gov.br), baixada em 07/11/2026.
const prisma = { NUMERO_REGISTRO_CADASTRO: '80243520033', NOME_TECNICO: 'Cabos', NOME_COMERCIAL: 'Cabo de bisturi', CLASSE_RISCO: 'I',
  NOME_FABRICANTE: 'PRISMA INSTRUMENTOS ODONTOLÓGICOS LTDA - ME', DETENTOR_REGISTRO_CADASTRO: 'PRISMA INSTRUMENTOS ODONTOLÓGICOS LTDA - ME', VALIDADE_REGISTRO_CADASTRO: 'VIGENTE' };
const allplan = { NUMERO_REGISTRO_CADASTRO: '80954610037', NOME_TECNICO: 'Instrumentos de Uso Odontologico', NOME_COMERCIAL: 'Cabo de Bisturi Allplan', CLASSE_RISCO: 'I',
  NOME_FABRICANTE: 'Allplan Produtos Odontológicos Ltda', DETENTOR_REGISTRO_CADASTRO: 'Allplan Produtos Odontológicos Ltda', VALIDADE_REGISTRO_CADASTRO: 'VIGENTE' };
const professional = { NUMERO_REGISTRO_CADASTRO: '10150470165', NOME_TECNICO: 'Tesouras', NOME_COMERCIAL: 'TESOURA ESPECIAL PROFESSIONAL', CLASSE_RISCO: 'II',
  NOME_FABRICANTE: 'PROFESSIONAL HOSPITAL FURNISHERS', DETENTOR_REGISTRO_CADASTRO: 'CIRURGICA FERNANDES - COMERCIO DE MATERIAIS CIRURGICOS E HOSPITALARES - SOCIEDADE LIMITADA', VALIDADE_REGISTRO_CADASTRO: 'VIGENTE' };
const taimin = { NUMERO_REGISTRO_CADASTRO: '80082910158', NOME_TECNICO: 'Pinca Bipolar', NOME_COMERCIAL: 'PINÇA TRIPOLAR TAIMIN', CLASSE_RISCO: 'III',
  NOME_FABRICANTE: 'CIENLABOR INDUSTRIA E COMERCIO LTDA', DETENTOR_REGISTRO_CADASTRO: 'CIENLABOR INDUSTRIA E COMERCIO LTDA', VALIDADE_REGISTRO_CADASTRO: '30/01/2027' };

describe('conferirRegistro', () => {
  test('marca no nome comercial e registro vigente: confere, com os dados da ANVISA', () => {
    const c = conferirRegistro({ id: 'P1', marca: 'Allplan', registroAnvisa: '80954610037' }, allplan, hoje);
    assert.equal(c.status, 'confere');
    assert.deepEqual(c.anvisa, { registro: '80954610037', nomeTecnico: 'Instrumentos de Uso Odontologico', nomeComercial: 'Cabo de Bisturi Allplan',
      fabricante: 'Allplan Produtos Odontológicos Ltda', detentor: 'Allplan Produtos Odontológicos Ltda', classe: 'I', validade: 'VIGENTE' });
  });
  test('registro de outro fabricante: marca_divergente, com o fabricante que a ANVISA registra', () => {
    const c = conferirRegistro({ id: 'P1', marca: 'Allplan', registroAnvisa: '80243520033' }, prisma, hoje);
    assert.equal(c.status, 'marca_divergente');
    assert.equal(c.motivo, 'marca "Allplan" não aparece no registro ANVISA 80243520033 (Cabo de bisturi, PRISMA INSTRUMENTOS ODONTOLÓGICOS LTDA - ME)');
  });
  test('marca só no fabricante, com caixa e acento diferentes: confere', () => {
    assert.equal(conferirRegistro({ id: 'P2', marca: 'professional', registroAnvisa: '10150470165' }, professional, hoje).status, 'confere');
    assert.equal(conferirRegistro({ id: 'P7', marca: 'TAIMIN', registroAnvisa: '80082910158' }, taimin, hoje).status, 'confere');
  });
  test('marca precisa ser palavra inteira: "Pro" não confere com "PROFESSIONAL"', () => {
    assert.equal(conferirRegistro({ id: 'X', marca: 'Pro', registroAnvisa: '10150470165' }, professional, hoje).status, 'marca_divergente');
  });
  test('registro que a base não tem: nao_encontrado', () => {
    const c = conferirRegistro({ id: 'X', marca: 'Allplan', registroAnvisa: '99999999999' }, undefined, hoje);
    assert.equal(c.status, 'nao_encontrado');
    assert.equal(c.anvisa, undefined);
  });
  test('validade vencida na data de hoje: vencido; data futura: confere', () => {
    assert.equal(conferirRegistro({ id: 'P7', marca: 'Taimin', registroAnvisa: '80082910158' }, { ...taimin, VALIDADE_REGISTRO_CADASTRO: '01/11/2026' }, hoje).status, 'vencido');
    assert.equal(conferirRegistro({ id: 'P7', marca: 'Taimin', registroAnvisa: '80082910158' }, taimin, hoje).status, 'confere');
  });
  test('linha sem nome nem fabricante não permite conferir a marca: marca_divergente', () => {
    assert.equal(conferirRegistro({ id: 'P1', marca: 'Allplan', registroAnvisa: '80954610037' }, { VALIDADE_REGISTRO_CADASTRO: 'VIGENTE' }, hoje).status, 'marca_divergente');
  });
});

describe('conferirCatalogo e buscarRegistros', () => {
  test('confere cada produto pela consulta injetada', () => {
    const base: Record<string, any> = { '80954610037': allplan, '80243520033': prisma };
    const r = conferirCatalogo([{ id: 'P1', marca: 'Allplan', registroAnvisa: '80954610037' }, { id: 'P9', marca: 'Allplan', registroAnvisa: '80243520033' }], n => base[n], hoje);
    assert.deepEqual(r.map(x => [x.produto, x.status]), [['P1', 'confere'], ['P9', 'marca_divergente']]);
  });
  test('busca na base só registros vigentes com todos os termos no nome ou no fabricante', () => {
    const linhas = [allplan, prisma, professional, { ...allplan, NUMERO_REGISTRO_CADASTRO: '1', VALIDADE_REGISTRO_CADASTRO: '01/01/2020' }];
    const r = buscarRegistros(linhas, 'cabo bisturi', hoje);
    assert.deepEqual(r.map(x => x.registro), ['80954610037', '80243520033']);
  });
});

describe('catálogo da demo contra a base oficial baixada', { skip: !existsSync(new URL('../data/anvisa.csv', import.meta.url)) && 'base ANVISA ausente (npm run setup)' }, () => {
  test('todos os produtos de fixtures/company.json conferem marca, registro e vigência', async () => {
    const { anvisa } = await import('../src/lib/data.ts');
    const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
    const r = conferirCatalogo(company.catalogo, n => anvisa.byRegistro(n), hoje);
    assert.deepEqual(r.filter(x => x.status !== 'confere').map(x => `${x.produto}: ${x.motivo}`), []);
  });
});

describe('base ANVISA local', () => {
  test('CSV baixado de novo reimporta a base: a consulta não fica presa na cópia antiga', async () => {
    const { mkdtempSync, writeFileSync, utimesSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { spawnSync } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'lance-anvisa-'));
    const cab = 'NUMERO_REGISTRO_CADASTRO;NUMERO_PROCESSO;NOME_TECNICO;CLASSE_RISCO;NOME_COMERCIAL;CNPJ_DETENTOR_REGISTRO_CADASTRO;DETENTOR_REGISTRO_CADASTRO;NOME_FABRICANTE;NOME_PAIS_FABRIC;DT_PUB_REGISTRO_CADASTRO;VALIDADE_REGISTRO_CADASTRO;DT_ATUALIZACAO_DADO';
    const csv = (nome: string) => `${cab}\n80954610037;1;Cabos;I;${nome};1;Allplan;Allplan;BRASIL;01/01/2020;VIGENTE;07/11/2026\n`;
    const consulta = () => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e',
      `const { anvisa } = await import(${JSON.stringify(new URL('../src/lib/data.ts', import.meta.url).href)}); console.log(anvisa.byRegistro('80954610037')?.NOME_COMERCIAL);`],
      { env: { ...process.env, LANCE_DATA_DIR: dir, LANCE_CACHE_DIR: join(dir, 'cache') }, encoding: 'utf8' }).stdout.trim();
    writeFileSync(join(dir, 'anvisa.csv'), csv('Nome antigo'));
    utimesSync(join(dir, 'anvisa.csv'), new Date('2026-11-01'), new Date('2026-11-01'));
    assert.equal(consulta(), 'Nome antigo');
    writeFileSync(join(dir, 'anvisa.csv'), csv('Nome novo'));
    assert.equal(consulta(), 'Nome novo');
  });
});
