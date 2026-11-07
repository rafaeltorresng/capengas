// Integração das ferramentas sobre dados REAIS (PNCP, Compras.gov, ANVISA) com um roteiro fixo de chamadas.
// Valida a cadeia de ponta a ponta e as travas, independentemente do modelo.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tools, newState, type LanceState } from '../../src/lib/tools.ts';
import { startSandbox } from '../../src/lib/sandbox.ts';
import { runAgent, type LLM } from '../../src/lib/agent.ts';

const company = JSON.parse(readFileSync(new URL('../../fixtures/company.json', import.meta.url), 'utf8'));
const TID = '77816510000166/2026/348';
const cov = JSON.parse(readFileSync(new URL('../../fixtures/coverage.json', import.meta.url), 'utf8'));
let sbx: Awaited<ReturnType<typeof startSandbox>>; let st: LanceState;
const T = (n: string) => tools.find(t => t.name === n)!;
const ctx = () => ({ approvals: new Set<string>(), state: st as any });

before(async () => {
  sbx = await startSandbox(0);
  st = newState(company, sbx.url, new Date('2026-11-07T10:00:00-03:00'));
  st.tenders[TID] = cov.find((c: any) => `${c.cnpj}/${c.ano}/${c.seq}` === TID);
});
after(() => sbx.close());

describe('ferramentas sobre dados reais', { timeout: 240_000 }, () => {
  test('record_fit rejeita citação inventada', async () => {
    const r: any = await T('record_fit').run({ tender_id: TID, item: 4, product_id: 'P1', attributes: [{ atributo: 'material', veredito: 'atende', citacao_item: 'titânio grau médico', citacao_ficha: 'aço inoxidável AISI 420' }] }, ctx());
    assert.equal(r.aceito, false);
  });
  test('decide_item exige encaixe registrado', async () => {
    const r: any = await T('decide_item').run({ tender_id: TID, item: 40, product_id: 'P2', catalog_code: 471547 }, ctx());
    assert.match(r.erro, /record_fit/);
  });
  test('cabo de bisturi: atende → ofertar com pendência (CND vence antes da sessão), preço do código', async () => {
    const f: any = await T('record_fit').run({ tender_id: TID, item: 4, product_id: 'P1', attributes: [
      { atributo: 'tamanho', veredito: 'atende', citacao_item: 'CABO DE BISTURI Nº4 13 CM', citacao_ficha: 'Comprimento total 13 cm' },
      { atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável', citacao_ficha: 'aço inoxidável AISI 420' },
      { atributo: 'autoclavável', veredito: 'atende', citacao_item: 'AÇO INOX AUTOCLAVÁVEL', citacao_ficha: 'Reutilizável e autoclavável' }] }, ctx());
    assert.equal(f.aceito, true, JSON.stringify(f));
    const d: any = await T('decide_item').run({ tender_id: TID, item: 4, product_id: 'P1', catalog_code: 299116 }, ctx());
    assert.equal(d.decision, 'ofertar_com_pendencia', JSON.stringify(d));
    assert.ok(d.preco_sugerido >= 6.9);
    assert.equal(d.anvisa.status, 'ok');
    assert.equal(d.prazo_esclarecimento, '2026-11-17'); // abertura seg 23/11; 20/11 feriado
  });
  test('tesoura curva para item que pede reta → não ofertar', async () => {
    await T('record_fit').run({ tender_id: TID, item: 40, product_id: 'P2', attributes: [
      { atributo: 'haste', exigido: 'reta', ofertado: 'curva', veredito: 'nao_atende', citacao_item: 'haste: haste reta', citacao_ficha: 'Haste curva, ponta romba' }] }, ctx());
    const d: any = await T('decide_item').run({ tender_id: TID, item: 40, product_id: 'P2', catalog_code: 471547 }, ctx());
    assert.equal(d.decision, 'nao_ofertar');
  });
  test('envio bloqueado sem aprovação; liberado com aprovação; verificação confere', async () => {
    const ap: any = await T('request_approval').run({ resumo: 'teste' }, ctx());
    assert.equal(ap.ofertas, 1);
    // Bloqueio é aplicado pelo loop do agente: roteiro tenta enviar sem aprovação.
    const call = (name: string, args: object) => ({ role: 'assistant', content: null, tool_calls: [{ id: name, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
    const script = (turns: any[]): LLM => { let i = 0; return { model: 'roteiro', async chat() { return { message: turns[i++], usage: { prompt_tokens: 0, completion_tokens: 0 }, ms: 0 }; } }; };
    const blocked = await runAgent({ llm: script([call('submit_proposal', { approval_id: ap.approval_id, tender_id: TID }), { role: 'assistant', content: 'aguardo' }]), tools, system: '', user: '', state: st as any, approvals: new Set() });
    assert.match(JSON.stringify(blocked.trace[1].result), /aprovação/);
    assert.equal(sbx.propostas.size, 0);
    const ok = await runAgent({ llm: script([call('submit_proposal', { approval_id: ap.approval_id, tender_id: TID }), { role: 'assistant', content: 'enviado' }]), tools, system: '', user: '', state: st as any, approvals: new Set([ap.approval_id]) });
    const sub: any = ok.trace[1].result;
    assert.match(sub.protocolo, /^SBX-/);
    const v: any = await T('verify_submission').run({ protocolo: sub.protocolo, tender_id: TID }, ctx());
    assert.equal(v.portal_confere, true);
    assert.equal(v.pncp_aberto, true, JSON.stringify(v));
  });
});
