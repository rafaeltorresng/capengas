// Seleção dos pregões da demo: pré-filtro determinístico item × catálogo (por termos) e ranqueamento.
// O pré-filtro só escolhe candidatos; quem decide se o produto atende é o encaixe técnico do agente.
export type CatalogoProduto = { id: string; termos?: string[] };
export type Match = { item: number; produto: string };
export type Candidato = { id: string; plataforma: string; situacao: string; abertura: string; matches: Match[] };

const norm = (s: string) => ` ${s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;

/** Todas as palavras exigidas aparecem (palavra inteira); cada palavra aceita alternativas separadas por "|". */
export function matchProduct(descricao: string, termos: string[]): boolean {
  if (!termos.length) return false;
  const d = norm(descricao);
  return termos.every(t => t.split('|').some(alt => d.includes(norm(alt))));
}

export function matchCatalog(itens: { numero: number; descricao: string }[], catalogo: CatalogoProduto[]): Match[] {
  const out: Match[] = [];
  for (const i of itens) for (const p of catalogo) if (p.termos && matchProduct(i.descricao, p.termos)) out.push({ item: i.numero, produto: p.id });
  return out;
}

/** Só Compras.gov.br, divulgados, com sessão a pelo menos `diasMinimos` dias; ordena por produtos distintos e depois por itens. */
export function rankCandidates(cs: Candidato[], o: { hoje: string; diasMinimos: number }) {
  const limite = new Date(Date.parse(`${o.hoje}T12:00:00Z`) + o.diasMinimos * 86400e3).toISOString().slice(0, 10);
  return cs
    .filter(c => c.plataforma === 'Compras.gov.br' && /divulgada/i.test(c.situacao) && c.abertura.slice(0, 10) >= limite && c.matches.length > 0)
    .map(c => ({ ...c, produtos: new Set(c.matches.map(m => m.produto)).size }))
    .sort((a, b) => b.produtos - a.produtos || b.matches.length - a.matches.length || a.id.localeCompare(b.id));
}
