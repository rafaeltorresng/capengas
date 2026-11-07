// Calendário legal da Lei 14.133 por pregão: data sustentada, artigo, origem e calendário conferido.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { diasUteis, prazosDoPregao, dataDaCitacao } from '../src/lib/prazos.ts';

const porAcao = (ps: ReturnType<typeof prazosDoPregao>, acao: string) => ps.find(p => p.acao === acao)!;

describe('diasUteis', () => {
  test('conta para trás e para a frente pulando fim de semana e feriado nacional', () => {
    assert.equal(diasUteis('2026-11-23', -3), '2026-11-17');   // 20/11 é feriado (Consciência Negra)
    assert.equal(diasUteis('2026-11-13', 3), '2026-11-18');    // sex → seg, ter, qua (15/11 cai no domingo)
    assert.equal(diasUteis('2027-03-29', -1), '2027-03-25');   // 26/03/2027 é Sexta-feira Santa
  });
});

describe('dataDaCitacao', () => {
  test('lê dd/mm/aaaa da citação do edital; sem data, null', () => {
    assert.equal(dataDaCitacao('pedidos de esclarecimento até 17/11/2026, às 23h59'), '2026-11-17');
    assert.equal(dataDaCitacao('até 3 (três) dias úteis antes da data de abertura'), null);
  });
});

describe('prazosDoPregao', () => {
  const base = { abertura: '2026-11-23T09:00', hoje: '2026-11-07' };

  test('esclarecimento e impugnação: 3 dias úteis antes da abertura (art. 164), calculado pela lei', () => {
    const ps = prazosDoPregao(base);
    for (const acao of ['esclarecimento', 'impugnacao']) {
      const p = porAcao(ps, acao);
      assert.equal(p.data, '2026-11-17');
      assert.equal(p.origem, 'calculado');
      assert.equal(p.base, 'lei');
      assert.equal(p.artigo, 'art. 164');
      assert.equal(p.calendario, 'local_nao_conferido');
    }
  });

  test('edital com data citada: vale a mais cedo das duas, e a divergência aparece', () => {
    const tarde = prazosDoPregao({ ...base, prazoEditalCitacao: 'esclarecimentos até 20/11/2026' });
    const e1 = porAcao(tarde, 'esclarecimento');
    assert.equal(e1.data, '2026-11-17');
    assert.equal(e1.base, 'lei');
    assert.deepEqual(e1.divergencia, { lei: '2026-11-17', edital: '2026-11-20' });
    assert.equal(e1.citacao, 'esclarecimentos até 20/11/2026');

    const cedo = prazosDoPregao({ ...base, prazoEditalCitacao: 'esclarecimentos até 16/11/2026' });
    const e2 = porAcao(cedo, 'esclarecimento');
    assert.equal(e2.data, '2026-11-16');
    assert.equal(e2.base, 'edital');
    assert.deepEqual(e2.divergencia, { lei: '2026-11-17', edital: '2026-11-16' });
  });

  test('edital sem data na citação não muda a data, mas a citação segue junto', () => {
    const p = porAcao(prazosDoPregao({ ...base, prazoEditalCitacao: 'até 3 (três) dias úteis antes da abertura' }), 'esclarecimento');
    assert.equal(p.data, '2026-11-17');
    assert.equal(p.divergencia, undefined);
  });

  test('intenção de recurso: na sessão, imediata (art. 165, §1º, I)', () => {
    const p = porAcao(prazosDoPregao(base), 'recurso_intencao');
    assert.equal(p.data, '2026-11-23');
    assert.equal(p.artigo, 'art. 165, §1º, I');
    assert.match(p.descricao, /imediata/);
  });

  test('razões de recurso aguardam a ata; com a ata publicada, 3 dias úteis dela', () => {
    const sem = porAcao(prazosDoPregao(base), 'recurso_razoes');
    assert.equal(sem.origem, 'aguardando');
    assert.equal(sem.data, null);
    const com = porAcao(prazosDoPregao({ ...base, ataSessao: { data: '2026-11-23', url: 'https://pncp.gov.br/ata.pdf' } }), 'recurso_razoes');
    assert.equal(com.origem, 'calculado');
    assert.equal(com.data, '2026-11-26');
    assert.equal(com.artigo, 'art. 165, I');
    assert.equal(com.fonte?.url, 'https://pncp.gov.br/ata.pdf');
  });

  test('contrarrazões aguardam a interposição (art. 165, §4º)', () => {
    const p = porAcao(prazosDoPregao(base), 'contrarrazoes');
    assert.equal(p.origem, 'aguardando');
    assert.equal(p.data, null);
  });

  test('sem abertura legível: nenhum prazo calculado, tudo aguardando', () => {
    const ps = prazosDoPregao({ abertura: null, hoje: '2026-11-07' });
    assert.ok(ps.length > 0);
    assert.ok(ps.every(p => p.data === null && p.origem === 'aguardando'));
  });

  test('ano sem feriados nacionais carregados: não calcula data', () => {
    const p = porAcao(prazosDoPregao({ abertura: '2028-02-10', hoje: '2027-12-01' }), 'esclarecimento');
    assert.equal(p.data, null);
    assert.equal(p.origem, 'aguardando');
    assert.match(p.descricao, /feriados nacionais de 2028/);
  });
});
