// Inventário das exigências nomeadas do item ("campo: valor", separadas por vírgula).
// Cada campo precisa da própria citação literal. Sem campos nomeados, ou com algum de fora, a cobertura segue não verificada.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

export function clausulasDoItem(descricao: string): string[] {
  return descricao.replace(/\s+/g, ' ').trim().split(',').map(p => p.trim()).filter(p => {
    const i = p.indexOf(':');
    return i >= 2 && i <= 48 && p.slice(i + 1).trim().length > 0;
  });
}

export function inventarioCobertura(descricao: string, attributes: { citacao_item?: string }[]) {
  const clausulas = clausulasDoItem(descricao);
  if (!clausulas.length) return { cobertura: 'nao_verificada' as const, clausulas, lacunas: [] as string[] };
  const usadas = new Set<number>();
  const lacunas: string[] = [];
  for (const clausula of clausulas) {
    const alvo = norm(clausula);
    const i = attributes.findIndex((at, idx) => !usadas.has(idx) && norm(at.citacao_item ?? '').includes(alvo));
    if (i < 0) lacunas.push(clausula);
    else usadas.add(i);
  }
  return { cobertura: lacunas.length ? 'nao_verificada' as const : 'conferida' as const, clausulas, lacunas };
}
