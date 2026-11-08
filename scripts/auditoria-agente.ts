// Execução REAL do agente (modelo + PNCP) num banco novo, com auditoria do rastro e da coerência do resultado.
// Custa dinheiro: cada execução usa o modelo pago. Uso:
//   node --env-file=.env scripts/auditoria-agente.ts <rotulo> [tenderId] [--teto-usd 0.30]
// Grava out/auditoria/<rotulo>.db e out/auditoria/<rotulo>.json. Não envia nada.
import { readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openStore } from '../src/lib/store.ts';
import { featherless } from '../src/lib/llm.ts';
import { runOnboardingAnalysis, type DemoCompany, type PreparedDemo } from '../src/server/onboarding.ts';
import { passosDoTurno, eficiencia, consistencia } from '../src/lib/auditoria.ts';
import type { LLM } from '../src/lib/agent.ts';

const args = process.argv.slice(2);
const rotulo = args[0] ?? 'base';
const company: DemoCompany = JSON.parse(readFileSync('fixtures/company.json', 'utf8'));
const demo: PreparedDemo = JSON.parse(readFileSync('fixtures/demo.json', 'utf8'));
const tenderId = args[1] && !args[1].startsWith('--') ? args[1] : demo.pregoes[0].id;
const teto = Number(args[args.indexOf('--teto-usd') + 1] ?? 0.3) || 0.3;
mkdirSync('out/auditoria', { recursive: true });
const db = `out/auditoria/${rotulo}.db`;
for (const f of [db, db + '-wal', db + '-shm']) rmSync(f, { force: true });
const store = openStore(db);

// Envolve o cliente para medir cada chamada e parar se o custo passar do teto.
const chamadas: { ms: number; entrada: number; saida: number; custo: number | null; mensagens: number }[] = [];
const base = featherless();
const llm: LLM = { model: base.model, async chat(messages, tools) {
  const gasto = chamadas.reduce((s, c) => s + (c.custo ?? 0), 0);
  if (gasto >= teto) throw new Error(`teto de custo atingido (US$ ${gasto.toFixed(4)} ≥ ${teto})`);
  const r = await base.chat(messages, tools);
  chamadas.push({ ms: Math.round(r.ms), entrada: r.usage.prompt_tokens ?? 0, saida: r.usage.completion_tokens ?? 0, custo: r.usage.cost ?? null, mensagens: messages.length });
  return r;
} };

const t0 = Date.now();
let erro: string | null = null;
try { await runOnboardingAnalysis({ tenderId, turno: randomUUID(), company, demo, store, llm: () => llm }); }
catch (e) { erro = e instanceof Error ? e.message : String(e); }
const passos = passosDoTurno(store, tenderId);
const ef = eficiencia(passos);
const out = {
  rotulo, tenderId, modelo: base.model, inicio: new Date(t0).toISOString(), duracaoMs: Date.now() - t0, erro,
  tetoUsd: teto, custoUsd: chamadas.reduce((s, c) => s + (c.custo ?? 0), 0),
  tokens: { entrada: chamadas.reduce((s, c) => s + c.entrada, 0), saida: chamadas.reduce((s, c) => s + c.saida, 0) },
  chamadas, eficiencia: { ...ef, final: ef.final?.slice(0, 1500) },
  decisoes: store.getDecisions(tenderId).map(d => ({ item: d.item, produto: d.produto, estado: d.estado, motivos: d.motivos, preco: d.precoProposto })),
  fits: store.getFits(tenderId).map(f => ({ item: f.item, produto: f.produto, fit: f.fit, cobertura: (f.atributos as any)?.validacao?.cobertura, lacunas: (f.atributos as any)?.validacao?.lacunas })),
  escaladas: store.openEscalations().map(e => ({ item: e.item, motivo: e.motivo })),
  consistencia: consistencia(store, tenderId),
  aviso: 'Empresa, catálogo, custos e política sintéticos; pregão, itens, edital e ANVISA reais. Sem concordância humana medida.',
};
writeFileSync(`out/auditoria/${rotulo}.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ rotulo, duracaoMs: out.duracaoMs, custoUsd: out.custoUsd, erro, chamadasModelo: ef.chamadasModelo,
  ferramentas: ef.ferramentas, evitaveis: ef.evitaveis, repeticoes: ef.repeticoes, rejeicoes: ef.rejeicoes.length,
  decisoes: out.decisoes.map(d => `${d.item}:${d.estado}`), consistencia: out.consistencia }, null, 1));
store.close();
