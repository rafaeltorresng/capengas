// Monta o documento da proposta dos pregões da demonstração com as regras já extraídas em out/regras-proposta/.
// Itens: os casados com o catálogo em fixtures/demo.json; quantidade, unidade e descrição vêm do PNCP; preço pela política (como o decide_item).
// Não roda o Lance: o encaixe técnico é tomado como atendido. Serve para avaliar o documento, não a decisão.
// Uso: npm run documento:proposta [-- id ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { pncp, anvisa } from '../src/lib/data.ts';
import { priceCheck } from '../src/lib/rules.ts';
import { gerarDocumentoProposta, type ItemProposta } from '../src/lib/documento-proposta.ts';
import type { ResultadoRegras } from '../src/lib/regras-proposta.ts';

const company = JSON.parse(readFileSync('fixtures/company.json', 'utf8'));
const demo = JSON.parse(readFileSync('fixtures/demo.json', 'utf8'));
const pedidos = process.argv.slice(2).filter(a => !a.startsWith('--'));
const pregoes = demo.pregoes.filter((p: { id: string }) => !pedidos.length || pedidos.includes(p.id));
mkdirSync('out/documento-proposta', { recursive: true });

for (const p of pregoes) {
  const arquivoRegras = `out/regras-proposta/${p.id.replaceAll('/', '-')}.json`;
  if (!existsSync(arquivoRegras)) { console.log(`${p.id}: sem regras extraídas; rode npm run regras:proposta -- ${p.id}`); continue; }
  const r: ResultadoRegras = JSON.parse(readFileSync(arquivoRegras, 'utf8'));
  const [cnpj, ano, seq] = p.id.split('/');
  const doPncp = await pncp.items(cnpj, Number(ano), Number(seq));
  const itens: ItemProposta[] = []; const fora: string[] = [];
  for (const m of p.matches) {
    const it = doPncp.find(i => i.numero === m.item); const prod = company.catalogo.find((c: { id: string }) => c.id === m.produto);
    if (!it || !prod) { fora.push(`${m.item}: item ou produto ausente`); continue; }
    const preco = priceCheck({ custo: prod.custo, margemMinima: company.politica.margemMinima, margemAlvo: company.politica.margemAlvo, estimativa: it.valorEstimado, sigiloso: it.sigiloso });
    if (!preco.viavel || !preco.precoProposto) { fora.push(`${m.item}: ${preco.motivo}`); continue; }
    itens.push({ numero: it.numero, descricao: it.descricao, unidade: it.unidade, quantidade: it.quantidade, marca: prod.marca, modelo: prod.nome,
      fabricante: anvisa.byRegistro(prod.registroAnvisa)?.NOME_FABRICANTE, registroAnvisa: prod.registroAnvisa, precoUnitario: preco.precoProposto });
  }
  const doc = gerarDocumentoProposta({ pregao: { id: p.id, orgao: p.orgao, municipio: p.municipio, uf: p.uf, abertura: p.abertura },
    empresa: company.empresa, itens: itens.sort((a, b) => a.numero - b.numero), regras: r.regras, hoje: new Date() });
  const destino = `out/documento-proposta/${p.id.replaceAll('/', '-')}.md`;
  writeFileSync(destino, doc.markdown);
  console.log(`\n${p.id} (${p.orgao}): ${itens.length} itens, R$ ${doc.total.toFixed(2)}, ${r.regras.length} regras → ${destino}`);
  console.log(`  colunas: ${doc.colunas.join(' | ')}`);
  if (fora.length) console.log(`  itens fora: ${fora.join('; ')}`);
  console.log(`  pendências (${doc.pendencias.length}): ${doc.pendencias.join('; ') || 'nenhuma'}`);
  console.log(`  lacunas do edital: ${doc.lacunas.join(', ') || 'nenhuma'}`);
}
