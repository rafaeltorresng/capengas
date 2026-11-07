// Escolhe os pregões reais da demo e pré-carrega o cache (itens, arquivos, editais, histórico de preço),
// para a demo funcionar mesmo com o PNCP instável. Grava fixtures/demo.json. Uso: npm run demo:preparar
import './_out.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { pncp, pdf, compras, anvisa, type Tender } from '../src/lib/data.ts';
import { matchCatalog, rankCandidates, type Candidato } from '../src/lib/demo.ts';

const company = JSON.parse(readFileSync('fixtures/company.json', 'utf8'));
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife' }).format(new Date());
const QUERIES = ['material hospitalar', 'material medico hospitalar', 'instrumental cirurgico', 'cabo de bisturi', 'tesoura cirurgica', 'cadeira de rodas', 'cpap neonatal', 'escova degermacao'];
const MAX_CANDIDATOS = 40, PRINCIPAIS = 3;
const avisos: string[] = [];
const idOf = (t: Tender) => `${t.cnpj}/${t.ano}/${t.seq}`;

// 1. Busca: pregões abertos, só Compras.gov.br (o único que traz código de catálogo).
const vistos = new Map<string, Tender>();
const suspensos: Tender[] = [];
for (const q of QUERIES) {
  try {
    const r = await pncp.searchOpen(q, 1, 30);
    for (const t of r.items) {
      if (!t.modalidade.startsWith('Pregão') || t.plataforma !== 'Compras.gov.br') continue;
      if (/suspens/i.test(t.situacao)) suspensos.push(t);
      if (!vistos.has(idOf(t))) vistos.set(idOf(t), t);
    }
  } catch (e: any) { avisos.push(`busca "${q}" falhou: ${String(e.message).slice(0, 80)}`); }
}
console.log(`pregões do Compras.gov.br encontrados: ${vistos.size} (suspensos: ${suspensos.length})`);

// 2. Itens de cada candidato e casamento com o catálogo.
const candidatos: (Candidato & { tender: Tender; itens: any[] })[] = [];
for (const t of [...vistos.values()].slice(0, MAX_CANDIDATOS)) {
  try {
    const itens = await pncp.items(t.cnpj, t.ano, t.seq);
    candidatos.push({ id: idOf(t), plataforma: t.plataforma, situacao: t.situacao, abertura: t.abertura, matches: matchCatalog(itens, company.catalogo), tender: t, itens });
  } catch (e: any) { avisos.push(`itens de ${idOf(t)} falharam: ${String(e.message).slice(0, 80)}`); }
}
const ranking = rankCandidates(candidatos, { hoje, diasMinimos: 2 });
console.log(`com itens do catálogo: ${ranking.length}`);
// 3. Pregão com evento para a demo de reação: suspenso, ou com errata/aviso entre os arquivos.
let evento: any = null;
if (suspensos[0]) evento = { id: idOf(suspensos[0]), orgao: suspensos[0].orgao, situacao: suspensos[0].situacao, motivo: 'suspenso no PNCP' };
for (const c of candidatos) {
  if (evento) break;
  try {
    const files = await pncp.files(c.tender.cnpj, c.tender.ano, c.tender.seq);
    const extra = files.find(f => /errata|retifica|aviso|adendo/i.test(`${f.tipo} ${f.titulo}`));
    if (extra) evento = { id: c.id, orgao: c.tender.orgao, situacao: c.situacao, motivo: `arquivo posterior ao edital: ${extra.titulo}` };
  } catch {}
}
if (!evento) avisos.push('nenhum pregão suspenso ou com errata encontrado nesta busca');

// 4. Pré-carga dos melhores do ranking até ter PRINCIPAIS com edital legível; o primeiro com edital ilegível
//    (ZIP ou escaneado) fica como exemplo de exceção ("edital ilegível → escala").
const pregoes: any[] = [];
let editalIlegivel: any = null;
for (const rk of ranking) {
  if (pregoes.length >= PRINCIPAIS) break;
  const c = candidatos.find(x => x.id === rk.id)!;
  const t = c.tender; const r: any = { id: c.id, orgao: t.orgao, uf: t.uf, municipio: t.municipio, abertura: t.abertura, plataforma: t.plataforma, situacao: t.situacao, url: t.url, cache: {} };
  try { await pncp.compra(t.cnpj, t.ano, t.seq); r.cache.compra = true; } catch { r.cache.compra = false; }
  try {
    const files = await pncp.files(t.cnpj, t.ano, t.seq);
    r.arquivos = files.map(f => ({ tipo: f.tipo, titulo: f.titulo }));
    r.cache.editais = [];
    for (const f of files.filter(f => /edital|termo de refer/i.test(`${f.tipo} ${f.titulo}`)).slice(0, 2)) {
      try { const p = await pdf.fromUrl(f.url); r.cache.editais.push({ titulo: f.titulo, tipo: p.kind, caracteres: p.text?.length ?? 0 }); }
      catch (e: any) { r.cache.editais.push({ titulo: f.titulo, erro: String(e.message).slice(0, 60) }); }
    }
  } catch { r.cache.arquivos = false; }
  r.editalLegivel = (r.cache.editais ?? []).some((e: any) => e.caracteres > 0);
  if (!r.editalLegivel) {
    if (!editalIlegivel) editalIlegivel = { id: c.id, orgao: t.orgao, editais: r.cache.editais, motivo: 'edital sem texto legível (ZIP ou escaneado)' };
    continue;
  }
  r.matches = [];
  for (const m of c.matches) {
    const it = c.itens.find((i: any) => i.numero === m.item);
    let historico = null;
    if (it?.catalogCode) { try { historico = (await compras.priceHistory(it.catalogCode)).length; } catch { historico = 'falhou'; } }
    const prod = company.catalogo.find((p: any) => p.id === m.produto);
    r.matches.push({ item: m.item, produto: m.produto, descricao: (it?.descricao ?? '').slice(0, 160), estimativa: it?.valorEstimado ?? null, sigiloso: it?.sigiloso ?? null, catalogCode: it?.catalogCode ?? null, historicoPrecos: historico, anvisa: anvisa.byRegistro(prod.registroAnvisa)?.VALIDADE_REGISTRO_CADASTRO ?? 'não encontrado' });
  }
  pregoes.push(r);
}
if (pregoes.length < PRINCIPAIS) avisos.push(`só ${pregoes.length} pregões com edital legível e itens do catálogo`);
console.log(`escolhidos: ${pregoes.map(p => p.id).join(', ') || 'nenhum'}`);

const out = {
  _nota: 'Pregões reais escolhidos para a demo (dados públicos do PNCP), retrato do momento em geradoEm: rode de novo antes da apresentação. O cache fica em cache/ (fora do Git); com LANCE_OFFLINE=1 a demo roda só do cache. O casamento item × produto é um pré-filtro por termos: o encaixe técnico é do agente.',
  geradoEm: new Date().toISOString(), hoje, criterio: 'Compras.gov.br, divulgado, sessão em ≥ 2 dias, mais produtos distintos do catálogo e depois mais itens',
  buscas: QUERIES, encontrados: vistos.size, comItensDoCatalogo: ranking.length,
  pregoes, evento, editalIlegivel, avisos,
};
writeFileSync('fixtures/demo.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ pregoes: pregoes.map(p => ({ id: p.id, orgao: p.orgao, abertura: p.abertura, itens: p.matches.length, produtos: [...new Set(p.matches.map((m: any) => m.produto))] })), evento, editalIlegivel, avisos }, null, 1));
