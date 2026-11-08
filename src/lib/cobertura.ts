// Inventário das exigências nomeadas do item ("campo: valor", separadas por vírgula) e do texto livre do órgão.
// Cada exigência precisa da própria citação literal. Sem campos nomeados, ou com algum de fora, a cobertura segue não verificada.
// A descrição do Compras.gov.br vem como "<nome do item> campo: valor, campo: valor <TEXTO LIVRE DO ÓRGÃO>": o nome do
// item não é exigência, e o texto livre (em maiúsculas, colado ao último valor) é uma exigência à parte.
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s*:\s*/g, ': ').replace(/\s+/g, ' ').trim();
const maiuscula = (t: string) => { const l = t.replace(/[^A-Za-zÀ-ÿ]/g, ''); return l.length >= 2 && l === l.toUpperCase() && l !== l.toLowerCase(); };

type Clausula = { exibir: string; alvo: string };

/** Início do texto livre: duas palavras seguidas em maiúsculas depois de pelo menos uma palavra do valor. */
function inicioTextoLivre(valor: string): number | null {
  const tokens = [...valor.matchAll(/\S+/g)];
  for (let j = 1; j + 1 < tokens.length; j++) {
    if (maiuscula(tokens[j][0]) && maiuscula(tokens[j + 1][0])) return tokens[j].index!;
  }
  return null;
}

/** Valor com outro "campo:" dentro (descrição repetida pelo órgão): corta na primeira palavra com inicial maiúscula
 *  depois de uma minúscula. O resto volta para a fila como outra parte. */
function corteDeOutroCampo(valor: string): number | null {
  if (!valor.includes(':')) return null;
  const tokens = [...valor.matchAll(/\S+/g)];
  for (let j = 1; j < tokens.length; j++) {
    if (/^\p{Lu}/u.test(tokens[j][0]) && /^\p{Ll}/u.test(tokens[j - 1][0])) return tokens[j].index!;
  }
  return null;
}

function clausulas(descricao: string): Clausula[] {
  const out: Clausula[] = [];
  // comNomeDoItem: primeira parte de cada bloco, onde o nome do item vem colado ao nome do campo.
  const fila = descricao.replace(/\s+/g, ' ').trim().split(',').map((p, k) => ({ texto: p.trim(), comNomeDoItem: k === 0 }));
  while (fila.length) {
    const atual = fila.shift()!;
    let parte = atual.texto;
    const i = parte.indexOf(':');
    if (i < 2 || i > 48 || !parte.slice(i + 1).trim()) continue;
    const outro = corteDeOutroCampo(parte.slice(i + 1));
    if (outro !== null) { fila.unshift({ texto: parte.slice(i + 1 + outro).trim(), comNomeDoItem: true }); parte = parte.slice(0, i + 1 + outro).trim(); }
    const nome = parte.slice(0, i).trim();
    const valorBruto = parte.slice(i + 1);
    const corte = inicioTextoLivre(valorBruto);
    const valor = (corte === null ? valorBruto : valorBruto.slice(0, corte)).trim();
    // Onde o nome do item vem colado, a citação precisa trazer o fim do nome do campo e o valor; nos demais, o nome inteiro.
    const palavras = nome.split(/\s+/);
    const fimDoNome = !atual.comNomeDoItem ? nome : palavras.slice(palavras.at(-1)!.length <= 2 && palavras.length > 1 ? -2 : -1).join(' ');
    out.push({ exibir: (parte.slice(0, i + 1) + valorBruto.slice(0, corte ?? valorBruto.length)).trim(), alvo: norm(`${fimDoNome}: ${valor}`) });
    if (corte !== null) { const livre = valorBruto.slice(corte).trim(); out.push({ exibir: livre, alvo: norm(livre) }); }
  }
  // A mesma exigência repetida conta uma vez; se uma versão contém a outra (ex.: "20" e "20 CM"), vale a mais específica.
  return out.filter((c, k) => !out.some((o, m) => m !== k && (o.alvo === c.alvo ? m < k : o.alvo.includes(c.alvo))));
}

export function clausulasDoItem(descricao: string): string[] {
  return clausulas(descricao).map(c => c.exibir);
}

export function inventarioCobertura(descricao: string, attributes: { citacao_item?: string }[]) {
  const lista = clausulas(descricao);
  if (!lista.length) return { cobertura: 'nao_verificada' as const, clausulas: [] as string[], lacunas: [] as string[] };
  const usadas = new Set<number>();
  const lacunas: string[] = [];
  for (const clausula of lista) {
    const i = attributes.findIndex((at, idx) => !usadas.has(idx) && norm(at.citacao_item ?? '').includes(clausula.alvo));
    if (i < 0) lacunas.push(clausula.exibir);
    else usadas.add(i);
  }
  return { cobertura: lacunas.length ? 'nao_verificada' as const : 'conferida' as const, clausulas: lista.map(c => c.exibir), lacunas };
}
