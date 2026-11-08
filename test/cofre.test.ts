// Calendário do cofre: quais documentos precisam ser renovados, até quando, e quantos pregões se perdem sem isso.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { calendarioCofre, calendarioDoStore } from '../src/lib/cofre.ts';
import type { CofreDoc } from '../src/lib/contracts.ts';

const cofre: CofreDoc[] = JSON.parse(readFileSync(new URL('../fixtures/company-testes.json', import.meta.url), 'utf8')).cofre;
const cert = { tipo: 'certidoes', citacao: 'Certidão de regularidade fiscal' };
const afe = { tipo: 'afe', citacao: 'Autorização de Funcionamento de Empresa' };
const p = (tenderId: string, sessao: string, exigencias = [cert]) => ({ tenderId, sessao, exigencias });

describe('calendarioCofre', () => {
  test('CND vence em 15/11: perde os pregões com sessão depois disso e exigência de certidões', () => {
    const r = calendarioCofre(cofre, [p('A', '2026-11-23'), p('B', '2026-11-16'), p('C', '2026-11-14'), p('D', '2026-11-30', [afe])], '2026-11-07');
    assert.equal(r.length, 1);
    assert.equal(r[0].tipo, 'cnd_federal');
    assert.equal(r[0].renovarAte, '2026-11-15');
    assert.deepEqual(r[0].pregoes.map(x => x.tenderId), ['B', 'A']);
    assert.match(r[0].resumo, /Renove .*CND Federal.* até 15\/11\/2026 ou perde 2 pregões/);
  });
  test('vários documentos: ordenados pela data-limite; CRF de 20/12 entra só com sessão depois dela', () => {
    const r = calendarioCofre(cofre, [p('A', '2026-11-23'), p('E', '2027-01-05')], '2026-11-07');
    assert.deepEqual(r.map(x => [x.tipo, x.pregoes.length]), [['cnd_federal', 2], ['crf_fgts', 1]]);
  });
  test('documento ausente no cofre: sem data-limite, todos os pregões que exigem', () => {
    const r = calendarioCofre(cofre.filter(d => d.tipo !== 'cndt'), [p('A', '2026-11-23')], '2026-11-07');
    const cndt = r.find(x => x.exigencia.startsWith('CNDT'))!;
    assert.equal(cndt.status, 'ausente'); assert.equal(cndt.renovarAte, null);
    assert.match(cndt.resumo, /Inclua .*CNDT.* no cofre ou perde 1 pregão/);
  });
  test('documento já vencido hoje: status vencido', () => {
    const r = calendarioCofre(cofre, [p('A', '2026-11-23')], '2026-11-16');
    assert.equal(r[0].status, 'vencido');
    assert.match(r[0].resumo, /vencido desde 15\/11\/2026/);
  });
  test('sessão que já passou não conta; AFE sem vencimento nunca entra', () => {
    assert.deepEqual(calendarioCofre(cofre, [p('A', '2026-11-01'), p('D', '2026-11-30', [afe])], '2026-11-07'), []);
  });
  test('documento irregular: entra mesmo dentro da validade', () => {
    const c = cofre.map(d => d.tipo === 'cndt' ? { ...d, irregular: true } : d);
    const r = calendarioCofre(c, [p('A', '2026-11-12')], '2026-11-07');
    assert.deepEqual(r.map(x => [x.tipo, x.status]), [['cndt', 'irregular']]);
  });
});

describe('calendarioDoStore', () => {
  test('lê pregões e exigências do SQLite; abertura ausente fica de fora', () => {
    const store = openStore(':memory:');
    const row = (id: string, abertura: string | null) => ({ id, orgao: 'X', uf: 'PR', abertura, situacao: 'Divulgada no PNCP', plataforma: 'Compras.gov.br', arquivosHash: 'h', ultimoCheck: null });
    store.upsertTender(row('A', '2026-11-23T09:00')); store.upsertTender(row('B', null));
    store.upsertRequirement({ tenderId: 'A', tipo: 'certidoes', citacao: 'certidões' });
    store.upsertRequirement({ tenderId: 'B', tipo: 'certidoes', citacao: 'certidões' });
    assert.deepEqual(store.getRequirements('A'), [{ tenderId: 'A', tipo: 'certidoes', citacao: 'certidões' }]);
    const r = calendarioDoStore(store, cofre, '2026-11-07');
    assert.deepEqual(r.map(x => [x.tipo, x.pregoes.map(y => y.tenderId)]), [['cnd_federal', ['A']]]);
  });
});
