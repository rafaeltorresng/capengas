import type { Turno } from '../server/contract.ts';

const fases = [
  { id: 'fontes', titulo: 'Conhecer o edital', descricao: 'Catálogo, itens e documentos publicados.' },
  { id: 'analise', titulo: 'Conferir os produtos', descricao: 'Exigências, evidências técnicas e registro na ANVISA.' },
  { id: 'decisao', titulo: 'Avaliar a participação', descricao: 'Preço calculado, viabilidade e pendências de cada item.' },
  { id: 'documentos', titulo: 'Preparar os documentos', descricao: 'Regras do edital, proposta e o que cada responsável precisa providenciar.' },
] as const;
type Fase = typeof fases[number]['id'];
const ferramentas: Record<string, Fase> = {
  list_catalog: 'fontes', get_product_sheet: 'fontes', get_tender_items: 'fontes', get_tender_item: 'fontes', read_edital: 'fontes',
  record_requirement: 'analise', record_fit: 'analise', check_anvisa: 'analise', flag_restrictive: 'analise',
  decide_item: 'decisao', draft_esclarecimento: 'decisao',
  read_proposal_docs: 'documentos', read_proposal_excerpt: 'documentos', record_proposal_rule: 'documentos',
  record_document_requirement: 'documentos', draft_document_plan: 'documentos', draft_proposal_document: 'documentos',
  salvar_analise: 'documentos', conferir_publicacao: 'documentos',
};
function faseDaEtapa(etapa: Turno['etapas'][number]): Fase | undefined {
  if (etapa.ferramenta) return ferramentas[etapa.ferramenta];
  // Compatibilidade com os eventos já gravados, que contêm somente o rótulo.
  const nome = etapa.atividade.toLowerCase();
  if (/proposta|plano de documentos|documento exigido/.test(nome)) return 'documentos';
  if (/recomendação|esclarecimento/.test(nome)) return 'decisao';
  if (/requisitos|exigências|anvisa|restritiva/.test(nome)) return 'analise';
  if (/catálogo|fichas|itens do pregão|lendo o edital|preparando a análise/.test(nome)) return 'fontes';
}
export function resumirProgresso(turno: Turno) {
  const atual = turno.etapas.at(-1);
  const ultimaFase = [...turno.etapas].reverse().map(faseDaEtapa).find(Boolean) ?? 'fontes';
  const ativo = turno.status === 'ativo';
  return {
    atividade: atual?.atividade ?? 'Preparando a análise do edital',
    fases: fases.map(fase => {
      const etapas = turno.etapas.filter(e => faseDaEtapa(e) === fase.id);
      const pendente = etapas.at(-1)?.estado === 'pendente';
      const estado = ativo && fase.id === ultimaFase ? 'em_andamento'
        : pendente ? 'atencao'
        : etapas.length && turno.status === 'concluido' && etapas.every(e => e.estado === 'concluida') ? 'concluida'
        : etapas.length ? 'consultada' : 'aguardando';
      return { ...fase, estado, consultas: etapas.length };
    }),
  };
}

/** Não interpreta rótulos da tela nem aceita o resumo livre do modelo como decisão. */
export function concluirAnalise(itens: { estadoCodigo?: string; estado?: string }[], reavaliar = false, desatualizado = false, publicacaoNaoConferida = false) {
  const liberados = itens.filter(i => i.estadoCodigo === 'disputar').length;
  const condicionados = itens.filter(i => i.estadoCodigo === 'disputar_com_pendencia').length;
  const recusados = itens.filter(i => i.estadoCodigo === 'nao_disputar').length;
  const revisar = itens.length - liberados - condicionados - recusados;
  if (reavaliar) return { estado: 'revisao_necessaria' as const, titulo: 'O edital mudou. É preciso reavaliar.', detalhe: 'A análise anterior permanece para consulta. A proposta está bloqueada até a revisão.', liberados, condicionados, recusados, revisar };
  if (desatualizado) return { estado: 'revisao_necessaria' as const, titulo: 'A análise precisa ser atualizada.', detalhe: 'Os dados ou as decisões mudaram desde esta execução. A proposta anterior está bloqueada.', liberados, condicionados, recusados, revisar };
  if (publicacaoNaoConferida) return { estado: 'revisao_necessaria' as const, titulo: 'Confira a publicação antes de avançar.', detalhe: 'A análise dos itens está registrada, mas a atualidade da publicação não foi confirmada. Os documentos são minutas para revisão.', liberados, condicionados, recusados, revisar };
  const estado = !itens.length || (!liberados && !condicionados && revisar) ? 'revisao_necessaria'
    : liberados && !condicionados && !revisar ? 'recomendada'
    : liberados || condicionados ? 'com_pendencias' : 'nao_recomendada';
  const titulo = { recomendada: 'Há itens para disputar.', com_pendencias: 'Há oportunidade, com pendências.',
    revisao_necessaria: 'A participação precisa de revisão.', nao_recomendada: 'Não recomendamos os itens analisados.' }[estado];
  const detalhe = !itens.length ? 'Não há decisão suficiente para concluir a análise.'
    : `${itens.length} ${itens.length === 1 ? 'item analisado' : 'itens analisados'}. ${liberados} para disputar, ${condicionados} com pendências, ${revisar} para revisão e ${recusados} fora da proposta.`;
  return { estado, titulo, detalhe, liberados, condicionados, recusados, revisar };
}
