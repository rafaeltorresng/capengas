// Sanção do próprio cliente no CEIS como filtro da carteira. Não entra no decideItem.
// Art. 156, §4º: impedimento vale no âmbito do ente federativo que aplicou; §5º: inidoneidade vale em todos.
// Falha segura: CEIS não consultado, ente desconhecido ou município não identificável nunca viram "livre".
import { existsSync, readFileSync } from 'node:fs';

export type Sancao = {
  categoria: string;
  tipo: 'impedimento' | 'inidoneidade' | 'proibicao' | 'outra';
  esfera: 'federal' | 'estadual' | 'municipal' | 'desconhecida';
  uf: string | null; orgao: string;
  inicio: string | null; fim: string | null;
};
/** esfera: código do PNCP (orgaoEntidade.esferaId): F federal, E estadual, M municipal, D distrital. */
export type EntePregao = { esfera?: 'F' | 'E' | 'M' | 'D' | null; uf?: string | null };
export type FiltroSancao = { status: 'livre' | 'fora' | 'nao_verificado'; motivo: string; sancao?: Sancao };

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const isoBr = (s: string) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

function tipo(categoria: string): Sancao['tipo'] {
  const c = sem(categoria);
  if (c.includes('inidon')) return 'inidoneidade';
  if (c.includes('impedi') || c.includes('suspens')) return 'impedimento';
  // Proibição de contratar com o poder público (improbidade, Lei Anticorrupção): sem âmbito de ente, vale para todos.
  if (c.includes('proibi')) return 'proibicao';
  return 'outra';
}
function esfera(valor: string): Sancao['esfera'] {
  const v = sem(valor);
  return v.includes('federal') ? 'federal' : v.includes('estadual') || v.includes('distrital') ? 'estadual' : v.includes('municipal') ? 'municipal' : 'desconhecida';
}

/** Linhas do CSV do CEIS (Portal da Transparência, já decodificado) que pertencem ao CNPJ do cliente. */
export function lerCeis(csv: string, cnpj: string): Sancao[] {
  const alvo = cnpj.replace(/\D/g, '');
  const linhas = csv.split(/\r?\n/).filter(Boolean);
  const cols = (l: string) => l.replace(/^"|"$/g, '').split('";"');
  const head = cols(linhas[0] ?? '');
  const i = (n: string) => head.indexOf(n);
  const iDoc = i('CPF OU CNPJ DO SANCIONADO'), iCat = i('CATEGORIA DA SANÇÃO'), iIni = i('DATA INÍCIO SANÇÃO'), iFim = i('DATA FINAL SANÇÃO'),
    iOrg = i('ÓRGÃO SANCIONADOR'), iUf = i('UF ÓRGÃO SANCIONADOR'), iEsf = i('ESFERA ÓRGÃO SANCIONADOR');
  if (iDoc < 0 || iCat < 0) throw new Error('CSV do CEIS sem as colunas esperadas');
  const out: Sancao[] = [];
  for (const l of linhas.slice(1)) {
    const v = cols(l);
    if ((v[iDoc] ?? '').replace(/\D/g, '') !== alvo) continue;
    out.push({ categoria: v[iCat] ?? '', tipo: tipo(v[iCat] ?? ''), esfera: esfera(v[iEsf] ?? ''),
      uf: (v[iUf] ?? '').trim() || null, orgao: v[iOrg] ?? '', inicio: isoBr(v[iIni] ?? ''), fim: isoBr(v[iFim] ?? '') });
  }
  return out;
}

const vigente = (s: Sancao, hoje: string) => (!s.inicio || s.inicio <= hoje) && (!s.fim || s.fim >= hoje);

export function filtroSancao(p: EntePregao, sancoes: Sancao[] | null | undefined, hoje: string): FiltroSancao {
  if (!sancoes) return { status: 'nao_verificado', motivo: 'CEIS do cliente não consultado: sanção não verificada' };
  let pendente: FiltroSancao | null = null;
  for (const s of sancoes.filter(x => vigente(x, hoje) && x.tipo !== 'outra')) {
    const fim = s.fim ? ` até ${s.fim.split('-').reverse().join('/')}` : '';
    if (s.tipo === 'inidoneidade') return { status: 'fora', sancao: s, motivo: `inidoneidade (${s.orgao})${fim}: vale em todos os entes (art. 156, §5º)` };
    if (s.tipo === 'proibicao') return { status: 'fora', sancao: s, motivo: `proibição de contratar com o poder público (${s.orgao})${fim}: vale em todos os entes` };
    const fora = { status: 'fora' as const, sancao: s, motivo: `impedimento ${s.esfera} (${s.orgao})${fim}: vale no ente que aplicou (art. 156, §4º)` };
    const duvida = (motivo: string) => { pendente ??= { status: 'nao_verificado', sancao: s, motivo }; };
    if (s.esfera === 'desconhecida') { duvida(`impedimento de esfera não informada no CEIS (${s.orgao}): conferir`); continue; }
    if (!p.esfera) { duvida(`impedimento ${s.esfera} vigente (${s.orgao}) e ente do pregão desconhecido: conferir`); continue; }
    if (s.esfera === 'federal' && p.esfera === 'F') return fora;
    if (s.esfera === 'estadual' && (p.esfera === 'E' || p.esfera === 'D')) {
      if (!p.uf || !s.uf) duvida(`impedimento estadual (${s.orgao}) e UF desconhecida: conferir`);
      else if (p.uf === s.uf) return fora;
    }
    if (s.esfera === 'municipal' && p.esfera === 'M') {
      if (!p.uf || !s.uf || p.uf === s.uf) duvida(`impedimento municipal (${s.orgao}): o CEIS não identifica o município; conferir antes de disputar`);
    }
  }
  return pendente ?? { status: 'livre', motivo: 'nenhuma sanção vigente do cliente alcança este ente' };
}

/** Sanções do cliente a partir do CSV do CEIS baixado do Portal da Transparência (latin1).
 *  null quando o arquivo não existe, o cliente não tem CNPJ cadastrado ou o arquivo não é lido: CEIS não consultado. */
export function sancoesDoArquivo(path: string, cnpj: string | null | undefined): Sancao[] | null {
  if (!cnpj || !existsSync(path)) return null;
  try { return lerCeis(new TextDecoder('latin1').decode(readFileSync(path)), cnpj); } catch { return null; }
}
