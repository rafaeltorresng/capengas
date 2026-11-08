// Biblioteca comercial sintética. Seleção é um retrato por execução, nunca uma alteração global.
import { createHash } from 'node:crypto';
export type ProdutoCatalogo = {
  id: string;
  nome: string;
  marca: string;
  registroAnvisa: string;
  custo: number;
  ficha: string;
  termos: string[];
};
export type ArquivoCatalogo = { id: string; nome: string; titulo: string; produtos: string[] };
export type ManifestoCatalogos = { arquivos: ArquivoCatalogo[]; produtos: ProdutoCatalogo[] };
export type BibliotecaCatalogos = { arquivos: (ArquivoCatalogo & { versao: string })[]; produtos: ProdutoCatalogo[] };
export type SelecaoCatalogos = {
  origem: 'sinteticos';
  hash: string;
  arquivos: { id: string; nome: string; titulo: string; versao: string }[];
  produtos: ProdutoCatalogo[];
};
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function criarBiblioteca(base: ProdutoCatalogo[], manifesto?: ManifestoCatalogos): BibliotecaCatalogos {
  const produtos = structuredClone([...base, ...(manifesto?.produtos ?? [])]);
  if (new Set(produtos.map((p) => p.id)).size !== produtos.length) throw new Error('Produto duplicado na biblioteca.');
  const arquivos = manifesto?.arquivos ?? [
    {
      id: 'completo',
      nome: 'catalogo-distribuidora.xlsx',
      titulo: 'Catálogo da distribuidora',
      produtos: produtos.map((p) => p.id),
    },
  ];
  if (!arquivos.length || new Set(arquivos.map((a) => a.id)).size !== arquivos.length)
    throw new Error('Arquivos de catálogo inválidos.');
  return {
    produtos,
    arquivos: arquivos.map((a) => {
      if (!a.produtos.length || a.produtos.some((id) => !produtos.some((p) => p.id === id)))
        throw new Error('Arquivo referencia produto inexistente.');
      return { ...structuredClone(a), versao: hash(a.produtos.map((id) => produtos.find((p) => p.id === id))) };
    }),
  };
}
export function selecionarCatalogos(b: BibliotecaCatalogos, ids: string[]): SelecaoCatalogos {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => typeof id !== 'string' || !b.arquivos.some((a) => a.id === id))
  )
    throw new Error('Escolha pelo menos um catálogo válido.');
  const arquivos = b.arquivos
    .filter((a) => ids.includes(a.id))
    .map(({ id, nome, titulo, versao }) => ({ id, nome, titulo, versao }));
  const produtosIds = new Set(b.arquivos.filter((a) => ids.includes(a.id)).flatMap((a) => a.produtos));
  const produtos = b.produtos.filter((p) => produtosIds.has(p.id));
  return structuredClone({ origem: 'sinteticos', hash: hash({ arquivos, produtos }), arquivos, produtos });
}
