// Caso da #25 (fase 1) num pregão real já analisado: aplica uma errata SINTÉTICA que só muda a quantidade
// de um item, roda o mesmo diff do monitor (sem modelo) e grava no banco. O diff e cada linha da pauta
// saem marcados como sintéticos: não é retificação acontecida no PNCP.
// Uso: node scripts/banco-demo.ts importar out/fase1.db fixtures/execucoes/analise-2026-11-07.json
//      LANCE_OFFLINE=1 LANCE_DB=out/fase1.db node scripts/errata-sintetica.ts [tenderId] [item] [fator]
//      LANCE_DB=out/fase1.db npm run integrado   → http://127.0.0.1:8080/#/pauta
import { readFileSync } from 'node:fs';
import { openStore } from '../src/lib/store.ts';
import { diffErrata, type TextoEdital } from '../src/lib/errata.ts';
import { montarPauta } from '../src/lib/pauta.ts';
import { parseId } from '../src/lib/recheck.ts';
import { pdf, pncp } from '../src/lib/data.ts';

const company = JSON.parse(readFileSync(new URL('../fixtures/company.json', import.meta.url), 'utf8'));
const custos = Object.fromEntries(company.catalogo.map((p: { id: string; custo: number }) => [p.id, p.custo]));
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date());
const store = openStore();
try {
  const [argTender, argItem, argFator] = process.argv.slice(2);
  const tender = argTender ? store.getTender(argTender) : store.getTenders().find(t => store.getDecisions(t.id).length);
  if (!tender) throw new Error('nenhum pregão analisado no banco (importe um snapshot com scripts/banco-demo.ts)');
  const decisoes = store.getDecisions(tender.id);
  const itens = store.getItems(tender.id);
  const alvo = argItem ? Number(argItem) : decisoes[0]?.item;
  const fator = Number(argFator ?? 1.5);
  const item = itens.find(i => i.numero === alvo);
  if (!item) throw new Error(`item ${alvo} não está no banco`);

  // O edital não mudou nesta errata sintética: as exigências são conferidas contra o texto já baixado (cache).
  let textos: TextoEdital[] | null = null;
  const id = parseId(tender.id);
  try {
    const files = id ? await pncp.files(id.cnpj, id.ano, id.seq) : [];
    const lidos: TextoEdital[] = [];
    for (const f of files.filter(f => /edital|termo de refer/i.test(`${f.tipo} ${f.titulo}`)).slice(0, 3)) {
      try { const p = await pdf.fromUrl(f.url); if (p.text) lidos.push({ nome: f.titulo || f.tipo, url: f.url, texto: p.text }); } catch {}
    }
    textos = lidos.length ? lidos : null;
  } catch { textos = null; }

  const nova = Math.ceil(item.quantidade * fator);
  const diff = diffErrata({ tenderId: tender.id, hoje, politica: company.politica, custos, sintetico: true,
    antes: { abertura: tender.abertura, itens, fits: store.getFits(tender.id), decisoes, requisitos: store.getRequirements(tender.id) },
    depois: { abertura: tender.abertura, textos,
      itens: itens.map(i => ({ numero: i.numero, descricao: i.descricao, quantidade: i.numero === alvo ? nova : i.quantidade, valorEstimado: i.estimativa, sigiloso: i.sigiloso })) } });
  store.saveErrataDiff(diff);
  store.setReavaliar(tender.id, true);
  store.logEvent({ tipo: 'monitor_mudanca', tender: tender.id, item: String(alvo),
    resumo: `errata sintética de teste: quantidade do item ${alvo} ${item.quantidade} → ${nova}`,
    detalhe: `conferida sem modelo: ${diff.contagem.reaproveitada} reaproveitada(s), ${diff.contagem.recalculada} recalculada(s), ${diff.contagem.citacao_orfa} órfã(s), ${diff.contagem.ilegivel} ilegível(is); pregão marcado para reavaliar` });

  const pauta = montarPauta({ hoje, sancoes: undefined, pregoes: [{ tender: store.getTender(tender.id)!, decisoes, requisitos: store.getRequirements(tender.id), diff }] });
  console.log(JSON.stringify({ pregao: tender.id, item: alvo, quantidade: [item.quantidade, nova], contagem: diff.contagem,
    art55: diff.prazoNaoReaberto && { prazo: diff.prazoNaoReaberto.prazo.data, acionavel: diff.prazoNaoReaberto.acionavel },
    textosDoEdital: textos?.map(t => t.nome) ?? 'indisponível (exigências ficam ilegíveis)',
    pauta: pauta.linhas.map(l => `${l.acionavel ? 'AGIR' : 'info'} · ${l.papel} · ${l.ate ?? '—'} · ${l.acao}`) }, null, 1));
} finally { store.close(); }
