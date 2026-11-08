// Monta o plano de documentos dos pregões da demonstração com as regras já extraídas em out/regras-proposta/.
// Itens viáveis: os casados com o catálogo em fixtures/demo.json; registro conferido na base local da ANVISA; cofre de fixtures/company.json.
// Não roda o Lance: as exigências do record_requirement e as registradas pelo agente não entram. Serve para avaliar o plano.
// Uso: npm run plano:documentos [-- id ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { anvisa } from '../src/lib/data.ts';
import { checkAnvisa } from '../src/lib/rules.ts';
import { deRegrasProposta, montarPlano, prazoDe, type ProdutoViavel } from '../src/lib/plano-documentos.ts';
import type { ResultadoRegras } from '../src/lib/regras-proposta.ts';

const company = JSON.parse(readFileSync('fixtures/company.json', 'utf8'));
const demo = JSON.parse(readFileSync('fixtures/demo.json', 'utf8'));
const pedidos = process.argv.slice(2).filter(a => !a.startsWith('--'));
const pregoes = demo.pregoes.filter((p: { id: string }) => !pedidos.length || pedidos.includes(p.id));
mkdirSync('out/plano-documentos', { recursive: true });

for (const p of pregoes) {
  const arquivoRegras = `out/regras-proposta/${p.id.replaceAll('/', '-')}.json`;
  if (!existsSync(arquivoRegras)) { console.log(`${p.id}: sem regras extraídas; rode npm run regras:proposta -- ${p.id}`); continue; }
  const r: ResultadoRegras = JSON.parse(readFileSync(arquivoRegras, 'utf8'));
  const hoje = new Date(); const entrega = new Date(hoje.getTime() + company.empresa.prazoEntregaDias * 864e5);
  const produtos: ProdutoViavel[] = p.matches.map((m: { item: number; produto: string }) => {
    const produto = company.catalogo.find((c: { id: string }) => c.id === m.produto) ?? null;
    return { item: m.item, produto, regularizacao: produto ? checkAnvisa(anvisa.byRegistro(produto.registroAnvisa), { today: hoje, deliveryBy: entrega }).regularizacao : undefined };
  });
  const plano = montarPlano({ tenderId: p.id, exigencias: deRegrasProposta(r.regras), cofre: company.cofre, sessao: p.abertura?.slice(0, 10) ?? null, hoje: hoje.toISOString().slice(0, 10),
    empresa: company.empresa, produtos, prazoPropostaAjustada: r.regras.filter(x => x.campo === 'prazo_envio').map(x => prazoDe(x.citacao)).find(Boolean) });
  const destino = `out/plano-documentos/${p.id.replaceAll('/', '-')}.json`;
  writeFileSync(destino, JSON.stringify(plano, null, 1));
  const { resumo } = plano;
  console.log(`\n${p.id} (${p.orgao}), sessão ${plano.sessao}: ${resumo.total} documentos; Lance ${resumo.lance}, humano ${resumo.humano}, fabricante ${resumo.terceiro}; ${resumo.problemas} pendentes, ${resumo.condicionais} condicionais → ${destino}`);
  for (const l of plano.linhas) console.log(`  [${l.fase}] ${l.documento}: ${l.rotulo} (${l.responsavel})${l.condicional ? ' condicional' : ''}${l.prazo ? `, prazo ${l.prazo}` : ''}. ${l.acao}`);
}
