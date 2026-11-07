// Semáforo fiscal do órgão (SICONFI, RGF Anexo 1): despesa com pessoal sobre a RCL contra os limites da LRF.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { semaforoDoRgf, semaforoFiscal } from '../src/lib/siconfi.ts';

const PCT = '% sobre a RCL Ajustada';
// Valores reais: Francisco Beltrão/PR, RGF 2026, 2º quadrimestre (apidatalake.tesouro.gov.br, consulta de 07/11/2026).
const rgf = (dtp: number, extra: object = {}) => [
  { exercicio: 2026, periodo: 2, periodicidade: 'Q', instituicao: 'Prefeitura Municipal de Francisco Beltrão - PR', cod_conta: 'DespesaComPessoalTotal', coluna: PCT, valor: dtp, ...extra },
  { exercicio: 2026, periodo: 2, periodicidade: 'Q', cod_conta: 'DespesaComPessoalTotal', coluna: 'Valor', valor: 268569780.58 },
  { exercicio: 2026, periodo: 2, periodicidade: 'Q', cod_conta: 'LimiteMaximoDespesaComPessoalTotal', coluna: PCT, valor: 54 },
  { exercicio: 2026, periodo: 2, periodicidade: 'Q', cod_conta: 'LimitePrudencialDespesaComPessoalTotal', coluna: PCT, valor: 51.3 },
  { exercicio: 2026, periodo: 2, periodicidade: 'Q', cod_conta: 'LimiteDeAlertaDespesaComPessoalTotal', coluna: PCT, valor: 48.6 },
];

describe('semaforoDoRgf', () => {
  test('abaixo do limite de alerta: verde, com período e limites citados', () => {
    const s = semaforoDoRgf(rgf(45.91), 'https://fonte');
    assert.equal(s.status, 'verde');
    assert.equal(s.dtpPct, 45.91);
    assert.deepEqual(s.limites, { alerta: 48.6, prudencial: 51.3, maximo: 54 });
    assert.deepEqual(s.periodo, { exercicio: 2026, periodicidade: 'Q', periodo: 2 });
    assert.equal(s.resumo, 'Despesa com pessoal em 45,91% da RCL (2º quadrimestre de 2026), abaixo do alerta de 48,6% da LRF.');
    assert.equal(s.fonte, 'https://fonte');
  });
  test('entre alerta e prudencial: amarelo', () => {
    assert.equal(semaforoDoRgf(rgf(49), 'f').status, 'amarelo');
  });
  test('no limite prudencial ou acima: vermelho (vedações do art. 22 da LRF)', () => {
    const s = semaforoDoRgf(rgf(51.3), 'f');
    assert.equal(s.status, 'vermelho');
    assert.match(s.resumo, /prudencial de 51,3%/);
  });
  test('semestral: o resumo diz semestre', () => {
    const s = semaforoDoRgf(rgf(40).map(x => ({ ...x, periodicidade: 'S', periodo: 1 })), 'f');
    assert.match(s.resumo, /1º semestre de 2026/);
  });
  test('sem a linha da despesa total ou sem limites: sem_dado, nunca inventa', () => {
    assert.equal(semaforoDoRgf(rgf(45).slice(1), 'f').status, 'sem_dado');
    assert.equal(semaforoDoRgf(rgf(45).slice(0, 2), 'f').status, 'sem_dado');
    assert.equal(semaforoDoRgf([], 'f').status, 'sem_dado');
  });
});

describe('semaforoFiscal (busca por CNPJ do órgão)', () => {
  const entes = { items: [{ cod_ibge: 4108403, ente: 'Francisco Beltrão', uf: 'PR', esfera: 'M', cnpj: '77816510000166' }, { cod_ibge: 1, ente: 'União', uf: 'BR', esfera: 'U', cnpj: '00394460000141' }] };
  function fakeFetch(publicados: Record<string, unknown[]>) {
    const urls: string[] = [];
    const f = async (url: string) => {
      urls.push(url);
      if (url.endsWith('/entes')) return entes;
      const q = new URL(url).searchParams;
      return { items: publicados[`${q.get('an_exercicio')}-${q.get('in_periodicidade')}${q.get('nr_periodo')}`] ?? [] };
    };
    return { f, urls };
  }
  test('recua até o último período publicado (3º quadrimestre ainda vazio)', async () => {
    const { f, urls } = fakeFetch({ '2026-Q2': rgf(45.91) });
    const s = await semaforoFiscal('77816510000166', { fetch: f, hoje: new Date('2026-11-07T12:00:00-03:00') });
    assert.equal(s.status, 'verde');
    assert.equal(s.ente, 'Francisco Beltrão/PR');
    assert.ok(urls.some(u => u.includes('id_ente=4108403') && u.includes('co_esfera=M') && u.includes('co_poder=E')));
    assert.match(s.fonte!, /nr_periodo=2/);
  });
  test('ente que só publica semestral', async () => {
    const { f } = fakeFetch({ '2026-S1': rgf(40).map(x => ({ ...x, periodicidade: 'S', periodo: 1 })) });
    const s = await semaforoFiscal('77816510000166', { fetch: f, hoje: new Date('2026-11-07T12:00:00-03:00') });
    assert.equal(s.status, 'verde');
    assert.match(s.resumo, /semestre/);
  });
  test('CNPJ que não é ente (órgão federal) ou ente da União: sem_dado', async () => {
    const { f } = fakeFetch({});
    assert.equal((await semaforoFiscal('00394429000100', { fetch: f })).status, 'sem_dado');
    assert.equal((await semaforoFiscal('00394460000141', { fetch: f })).status, 'sem_dado');
  });
  test('fonte fora do ar: sem_dado com o motivo, sem lançar', async () => {
    const s = await semaforoFiscal('77816510000166', { fetch: async () => { throw new Error('timeout'); } });
    assert.equal(s.status, 'sem_dado');
    assert.match(s.resumo, /SICONFI indisponível/);
  });
});
