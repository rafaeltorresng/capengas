// Catálogo da empresa × base oficial da ANVISA (TA_PRODUTO_SAUDE_SITE, dados.anvisa.gov.br).
// A empresa declara produto, marca e número do registro; nome, fabricante, detentor, classe e validade
// vêm sempre da base, na hora. A marca declarada tem de aparecer, como palavra inteira, no nome comercial,
// no fabricante ou no detentor do registro; senão o registro não é do produto ofertado.
import { checkAnvisa } from './rules.ts';

type Linha = Record<string, string | undefined>;
export type ProdutoRegistro = { id: string; marca: string; registroAnvisa: string };
export type DadosAnvisa = { registro: string; nomeTecnico: string; nomeComercial: string; fabricante: string; detentor: string; classe: string; validade: string };
export type ConferenciaRegistro = {
  produto: string; registro: string;
  status: 'confere' | 'marca_divergente' | 'nao_encontrado' | 'vencido' | 'validade_ilegivel';
  motivo: string; anvisa?: DadosAnvisa;
};

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const palavras = (s: string) => norm(s).split(/[^a-z0-9]+/).filter(Boolean);

function dados(row: Linha, registro: string): DadosAnvisa {
  return { registro: row.NUMERO_REGISTRO_CADASTRO ?? registro, nomeTecnico: row.NOME_TECNICO ?? '', nomeComercial: row.NOME_COMERCIAL ?? '',
    fabricante: row.NOME_FABRICANTE ?? '', detentor: row.DETENTOR_REGISTRO_CADASTRO ?? '', classe: row.CLASSE_RISCO ?? '', validade: row.VALIDADE_REGISTRO_CADASTRO ?? '' };
}

/** A marca confere quando a sequência de palavras dela aparece no nome comercial, no fabricante ou no detentor. */
function marcaNoRegistro(marca: string, a: DadosAnvisa) {
  const m = palavras(marca);
  if (!m.length) return false;
  return [a.nomeComercial, a.fabricante, a.detentor].some(campo => {
    const p = palavras(campo);
    return p.some((_, i) => m.every((w, j) => p[i + j] === w));
  });
}

export function conferirRegistro(p: ProdutoRegistro, row: Linha | undefined, hoje: Date): ConferenciaRegistro {
  const registro = String(p.registroAnvisa ?? '').replace(/\D/g, '');
  const base = { produto: p.id, registro };
  if (!row) return { ...base, status: 'nao_encontrado', motivo: `registro ANVISA ${registro} não encontrado na base oficial` };
  const anvisa = dados(row, registro);
  const validade = checkAnvisa(row as Record<string, string>, { today: hoje, deliveryBy: hoje });
  if (validade.regularizacao === 'vencido') return { ...base, anvisa, status: 'vencido', motivo: `registro ANVISA ${registro} vencido em ${anvisa.validade}` };
  if (validade.regularizacao !== 'vigente') return { ...base, anvisa, status: 'validade_ilegivel', motivo: `validade do registro ANVISA ${registro} ilegível ("${anvisa.validade}")` };
  if (!marcaNoRegistro(p.marca ?? '', anvisa)) {
    return { ...base, anvisa, status: 'marca_divergente',
      motivo: `marca "${p.marca}" não aparece no registro ANVISA ${registro} (${anvisa.nomeComercial || 'sem nome comercial'}, ${anvisa.fabricante || 'sem fabricante'})` };
  }
  return { ...base, anvisa, status: 'confere', motivo: `registro ANVISA ${registro} vigente e da marca ${p.marca}` };
}

export function conferirCatalogo(catalogo: ProdutoRegistro[], consulta: (registro: string) => Linha | undefined, hoje: Date): ConferenciaRegistro[] {
  return catalogo.map(p => conferirRegistro(p, consulta(String(p.registroAnvisa ?? '').replace(/\D/g, '')), hoje));
}

/** Registros vigentes cujo nome (técnico ou comercial) ou fabricante contém todos os termos. Para escolher o registro do catálogo. */
export function buscarRegistros(linhas: Iterable<Linha>, termos: string, hoje: Date, limite = 30): DadosAnvisa[] {
  const t = palavras(termos);
  const r: DadosAnvisa[] = [];
  for (const row of linhas) {
    const texto = palavras(`${row.NOME_TECNICO ?? ''} ${row.NOME_COMERCIAL ?? ''} ${row.NOME_FABRICANTE ?? ''}`);
    if (!t.every(w => texto.includes(w))) continue;
    if (checkAnvisa(row as Record<string, string>, { today: hoje, deliveryBy: hoje }).regularizacao !== 'vigente') continue;
    r.push(dados(row, row.NUMERO_REGISTRO_CADASTRO ?? ''));
    if (r.length >= limite) break;
  }
  return r;
}
