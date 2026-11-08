// Memória da retificação: projeção do DiffErrata canônico, sem recomparar texto ou chamar modelo.
import type { DiffErrata, EstadoDiff } from './errata.ts';
import { montarPauta, type LinhaPauta } from './pauta.ts';

export type AjusteHumano = { item: number; versao: number; decisao: 'aprovar' | 'recusar' | 'ajustar'; motivo: string };
export type LinhaVersao = {
  item: number; estado: EstadoDiff | 'pendente_agente'; origem: 'publicado' | 'calculado' | 'aguardando'; motivo: string; chamarAgente: boolean;
  quantidadeAnterior?: number; quantidadeNova?: number; precoUnitario?: number | null; valorTotal?: number | null;
  escalarLimite?: boolean; discordancia?: string;
};
export type VersaoRetificacao = {
  tender: string; versao: number; sintetica: boolean; aviso: string | null;
  abertura: DiffErrata['abertura']['estado']; aberturaPublicadaAntes: string | null; aberturaPublicadaDepois: string | null;
  publicacao?: DiffErrata['publicacao'];
  linhas: LinhaVersao[]; pauta: LinhaPauta[]; ajustes: AjusteHumano[];
  contagem: Record<EstadoDiff, number>;
  /** Contagem de itens, não de chamadas ou economia de uma execução que não foi medida. */
  itensSemReleitura: number; custoEvitadoUsd: null;
};

export function versaoDaRetificacao(o: { diff: DiffErrata; versao: number; hoje: string; ajustes?: AjusteHumano[] }): VersaoRetificacao {
  const d = o.diff;
  const ajustes = (o.ajustes ?? []).filter(a => a.versao < o.versao && d.itens.some(i => i.item === a.item));
  const linhas: LinhaVersao[] = [];
  for (const i of d.itens) {
    if (i.removido) continue;
    const discordancia = ajustes.filter(a => a.item === i.item).map(a => `versão ${a.versao}: humano ${a.decisao}. ${a.motivo}`).join(' ') || undefined;
    const estado = i.evidencia === 'ilegivel' ? 'ilegivel' : i.novo ? 'pendente_agente' : i.evidencia ?? (i.mudancas.length ? 'pendente_agente' : null);
    if (estado) linhas.push({ item: i.item, estado, discordancia,
      origem: estado === 'pendente_agente' ? 'aguardando' : 'publicado',
      chamarAgente: estado === 'citacao_orfa' || estado === 'pendente_agente',
      motivo: estado === 'ilegivel' ? 'texto novo ilegível; obter texto antes de reavaliar' : i.novo ? 'item novo, sem citação da versão anterior' : i.motivo ?? 'citações conferidas pelo diff; descrição intacta' });
    if (i.preco?.estado === 'recalculada') {
      const quantidade = i.mudancas.find(m => m.campo === 'quantidade');
      linhas.push({ item: i.item, estado: 'recalculada', origem: 'calculado', chamarAgente: false, discordancia,
        ...(quantidade ? { quantidadeAnterior: Number(quantidade.antes), quantidadeNova: Number(quantidade.depois) } : {}),
        precoUnitario: i.preco.depois, valorTotal: i.preco.total,
        escalarLimite: i.evidencia !== 'reaproveitada' || d.proposta.excedeLimite === true || i.preco.viavel !== true,
        motivo: i.evidencia === 'ilegivel' ? 'texto ilegível; o recálculo não libera decisão' : i.preco.motivo });
    }
  }
  // Uma só implementação de ações, datas, responsáveis e fontes para Pauta e Dossiê.
  const pauta = montarPauta({ hoje: o.hoje, sancoes: undefined, pregoes: [{
    tender: { id: d.tenderId, abertura: d.abertura.depois, orgao: '', uf: '', situacao: '', plataforma: '', arquivosHash: null, ultimoCheck: null },
    decisoes: [], requisitos: [], diff: d, ajustes,
  }] }).linhas.filter(l => l.tipo === 'errata');
  return { tender: d.tenderId, versao: o.versao, sintetica: d.sintetico,
    aviso: d.sintetico ? 'Caso sintético montado à mão; não é uma retificação publicada.' : null,
    abertura: d.abertura.estado, aberturaPublicadaAntes: d.abertura.antes, aberturaPublicadaDepois: d.abertura.depois,
    publicacao: d.publicacao, linhas, pauta, ajustes, contagem: { ...d.contagem },
    itensSemReleitura: linhas.filter(l => l.estado === 'reaproveitada').length, custoEvitadoUsd: null };
}
