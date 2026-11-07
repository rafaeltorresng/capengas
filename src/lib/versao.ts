// Versão do dossiê depois de uma retificação. Não chama modelo, não envia e não inventa prazo.
// Reaproveitar exige citação ainda no texto e descrição intacta. Quantidade nova é recálculo do código.
import { instanteAbertura, prazoEsclarecimentoAberto } from './act.ts';
import { priceCheck, verifyQuote } from './rules.ts';

export type EstadoVersao = 'reaproveitada' | 'recalculada' | 'reavaliada' | 'citacao_orfa' | 'ilegivel';
export type OrigemLinha = 'publicado' | 'calculado' | 'aguardando' | 'informado_cliente';
export type AtributoGravado = { atributo?: string; citacao_item?: string };
export type ItemAntes = {
  numero: number; descricao: string; quantidade: number; estimativa: number | null; sigiloso?: boolean;
  custo: number; atributos: AtributoGravado[];
};
export type ItemDepois = {
  numero: number; descricao: string; quantidade: number; estimativa: number | null; sigiloso?: boolean; ilegivel?: boolean;
};
export type AjusteHumano = { item: number; versao: number; decisao: 'aprovar' | 'recusar' | 'ajustar'; motivo: string };
export type LinhaVersao = {
  item: number; estado: EstadoVersao | 'pendente_agente'; origem: OrigemLinha; motivo: string; chamarAgente: boolean;
  quantidadeAnterior?: number; quantidadeNova?: number; precoUnitario?: number | null; valorTotal?: number | null;
  escalarLimite?: boolean; discordancia?: string;
};
export type LinhaPauta = {
  item?: number; oQueMudou: string; oQueFazer: string; quem: 'analista' | 'juridico' | null;
  ateQuando: string | null; origem: OrigemLinha; artigo?: string; ofereceAcao: boolean;
};
export type VersaoRetificacao = {
  tender: string; versao: number; sintetica: boolean; aviso: string | null;
  abertura: 'estavel' | 'mudou' | 'desconhecida';
  linhas: LinhaVersao[];
  pauta: LinhaPauta[];
  contagem: Record<EstadoVersao, number>;
  chamadasEvitadas: number;
  custoEvitadoUsd: number | null;
};

const vazio = (): Record<EstadoVersao, number> => ({ reaproveitada: 0, recalculada: 0, reavaliada: 0, citacao_orfa: 0, ilegivel: 0 });
const texto = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const dia = (raw: string | null) => { const d = instanteAbertura(raw); return d ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Recife', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d) : null; };

export function versaoDaRetificacao(o: {
  tenderId: string; versao: number; sintetica?: boolean; aberturaAntes: string | null; aberturaDepois: string | null;
  agora: Date; politica?: { valorMaxAutomatico: number; margemMinima: number; margemAlvo: number };
  antes: ItemAntes[]; depois: ItemDepois[]; ajustes?: AjusteHumano[]; custoPorChamadaUsd?: number;
}): VersaoRetificacao {
  const contagem = vazio();
  const linhas: LinhaVersao[] = [];
  const pauta: LinhaPauta[] = [];
  const diaAntes = dia(o.aberturaAntes);
  const diaDepois = dia(o.aberturaDepois);
  const abertura = !diaAntes || !diaDepois ? 'desconhecida' : diaAntes === diaDepois ? 'estavel' : 'mudou';
  const prazo = prazoEsclarecimentoAberto(o.aberturaDepois, o.agora);
  let especificacaoMudou = false;
  let quantidadeMudou = false;

  for (const antes of o.antes) {
    const depois = o.depois.find(i => i.numero === antes.numero);
    if (!depois) continue;
    const ajuste = o.ajustes?.find(a => a.item === antes.numero);
    const discordancia = ajuste ? `versão ${ajuste.versao}: humano ${ajuste.decisao}. ${ajuste.motivo}` : undefined;
    if (depois.ilegivel || !depois.descricao.trim()) {
      linhas.push({ item: antes.numero, estado: 'ilegivel', origem: 'publicado', chamarAgente: false, discordancia,
        motivo: 'texto novo ilegível; a evidência anterior não é reaproveitada nem contada como retrabalho' });
      contagem.ilegivel++;
    } else {
      const igual = texto(antes.descricao) === texto(depois.descricao);
      const citacoes = antes.atributos.map(a => a.citacao_item ?? '').filter(Boolean);
      const achadas = citacoes.filter(c => verifyQuote(c, depois.descricao).found);
      if (!igual) especificacaoMudou = true;
      if (igual && citacoes.length && achadas.length === citacoes.length) {
        linhas.push({ item: antes.numero, estado: 'reaproveitada', origem: 'publicado', chamarAgente: false, discordancia,
          motivo: 'citação continua no texto e a descrição não mudou' });
        contagem.reaproveitada++;
      } else if (!igual && achadas.length) {
        linhas.push({ item: antes.numero, estado: 'citacao_orfa', origem: 'publicado', chamarAgente: true, discordancia,
          motivo: 'a descrição mudou e a citação antiga ainda aparece; o agente relê só este item' });
        contagem.citacao_orfa++;
      } else {
        linhas.push({ item: antes.numero, estado: 'pendente_agente', origem: 'aguardando', chamarAgente: true, discordancia,
          motivo: citacoes.length ? 'citação não está no texto novo; o agente relê só este item' : 'não há citação gravada para reaproveitar' });
      }
    }
    if (antes.quantidade !== depois.quantidade) {
      quantidadeMudou = true;
      const preco = o.politica ? priceCheck({ custo: antes.custo, margemMinima: o.politica.margemMinima, margemAlvo: o.politica.margemAlvo, estimativa: depois.estimativa, sigiloso: depois.sigiloso === true }) : { viavel: null as boolean | null, precoProposto: null as number | null, motivo: 'política ausente' };
      const total = preco.precoProposto != null ? Math.round(preco.precoProposto * depois.quantidade * 100) / 100 : null;
      const estoura = total != null && !!o.politica && total > o.politica.valorMaxAutomatico;
      linhas.push({ item: antes.numero, estado: 'recalculada', origem: 'calculado', chamarAgente: false, discordancia,
        quantidadeAnterior: antes.quantidade, quantidadeNova: depois.quantidade, precoUnitario: preco.precoProposto, valorTotal: total, escalarLimite: estoura || preco.viavel !== true,
        motivo: estoura ? `total R$ ${total} acima do limite automático` : preco.motivo });
      contagem.recalculada++;
      if (estoura || preco.viavel !== true) pauta.push({ item: antes.numero, origem: 'calculado', quem: 'analista', ofereceAcao: true, ateQuando: prazo.prazo,
        oQueMudou: `quantidade de ${antes.quantidade} para ${depois.quantidade}`, oQueFazer: estoura ? 'quantidade nova estoura o limite da política' : preco.motivo, artigo: 'política' });
    }
  }

  if ((quantidadeMudou || especificacaoMudou) && abertura === 'estavel') {
    const oQueMudou = quantidadeMudou ? 'quantidade mudou e a abertura não andou' : 'especificação mudou e a abertura não andou';
    pauta.push({ origem: 'calculado', artigo: 'art. 55, §1º', quem: prazo.aberto ? 'juridico' : null, ateQuando: prazo.prazo, ofereceAcao: prazo.aberto,
      oQueMudou, oQueFazer: prazo.aberto ? 'esclarecer ou impugnar? prazo do art. 164 ainda aberto' : 'prazo do art. 164 já passou; linha informativa, sem ação' });
  } else if ((quantidadeMudou || especificacaoMudou) && abertura === 'desconhecida') {
    pauta.push({ origem: 'aguardando', quem: null, ofereceAcao: false, ateQuando: null, oQueMudou: 'abertura ilegível', oQueFazer: 'não há prazo sustentado para impugnar' });
  }

  for (const ajuste of o.ajustes ?? []) {
    if (!linhas.some(l => l.item === ajuste.item)) continue;
    pauta.push({ item: ajuste.item, origem: 'informado_cliente', quem: 'analista', ofereceAcao: false, ateQuando: null,
      oQueMudou: `humano ${ajuste.decisao} na versão ${ajuste.versao}`, oQueFazer: ajuste.motivo });
  }

  const chamadasEvitadas = contagem.reaproveitada;
  return {
    tender: o.tenderId, versao: o.versao, sintetica: o.sintetica === true,
    aviso: o.sintetica ? 'quantidade alterada à mão sobre um pregão real; não é uma retificação publicada' : null,
    abertura, linhas, pauta, contagem, chamadasEvitadas,
    custoEvitadoUsd: o.custoPorChamadaUsd == null ? null : Math.round(chamadasEvitadas * o.custoPorChamadaUsd * 1e6) / 1e6,
  };
}
