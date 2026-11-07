// Monta artefatos a partir de decisões e resultados de regras. Não autoriza envio,
// não consulta fontes e não inventa verificação documental quando ela não ocorreu.
import type { LanceState } from './tools.ts';
import type { DocCheck, DocStatus as RuleDocStatus } from './contracts.ts';

export type DossierSource = { nome: string; url: string; citacao?: string };
export type DocStatus = RuleDocStatus | 'nao_verificado';
export type DossierDocCheck = Omit<DocCheck, 'citacao' | 'status'> & {
  citacao?: string; status: DocStatus; detalhe?: string; fonte?: DossierSource;
};
export type DossierChecklist = {
  exigencia: string; documento: string; status: string; estado: DocStatus;
  detalhe: string; citacao?: string; fonte?: DossierSource;
};

const labels: Record<DocStatus, string> = {
  sem_vencimento: 'Sem vencimento', vigente: 'Vigente', vence_antes_sessao: 'Vence antes da sessão',
  ausente: 'Ausente', irregular: 'Irregular', nao_verificado: 'Não verificado',
};
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function buildDossie(st: LanceState, tenderId: string, options: { documentos?: DossierDocCheck[]; versao?: string } = {}) {
  const tender = st.tenders[tenderId];
  if (!tender) throw new Error(`pregão ${tenderId} não está no estado`);
  const requirements = st.requirements.filter(r => (r.tender_id ?? r.tenderId) === tenderId)
    .map(r => ({ ...r, requirement: r.requirement ?? r.tipo, quote: r.quote ?? r.citacao }));
  const prefix = `${tenderId}#`;
  const keys = [...new Set([...Object.keys(st.fits), ...Object.keys(st.decisions)])].filter(k => k.startsWith(prefix));
  const pendencias = new Set<string>();
  const checks = options.documentos ?? [];
  const checklist: DossierChecklist[] = [];
  for (const requirement of requirements) {
    const found = checks.filter(d => d.exigencia === requirement.requirement || (d.citacao && d.citacao === requirement.quote));
    const rows: DossierDocCheck[] = found.length ? found : [{ exigencia: requirement.requirement, documento: 'A conferir', validade: null, status: 'nao_verificado' }];
    for (const row of rows) {
      const detalhe = row.detalhe ?? (row.status === 'nao_verificado' ? 'A verificação desta exigência ainda não foi recebida.'
        : row.status === 'sem_vencimento' ? 'Documento sem prazo de vencimento; situação depende da verificação da fonte.'
        : `${labels[row.status]}. Validade: ${row.validade ?? 'não informada'}. Sessão: ${tender.abertura ?? 'não informada'}.`);
      const document = row.documento ?? 'Documento não localizado';
      checklist.push({ exigencia: requirement.requirement, documento: document, estado: row.status, status: labels[row.status], detalhe,
        citacao: requirement.quote, fonte: requirement.fonte ?? row.fonte });
      if (!['vigente', 'sem_vencimento'].includes(row.status)) pendencias.add(`${document}: ${labels[row.status]} (${requirement.requirement}).`);
    }
  }
  if (!requirements.length) pendencias.add('Exigências do edital ainda não registradas; documentação não verificada.');
  if (checklist.some(r => r.estado === 'nao_verificado')) pendencias.add('Verificação documental incompleta; receber resultados das regras antes de agir.');
  const itens = keys.map(k => {
    const n = Number(k.slice(prefix.length));
    const item = st.items[tenderId]?.find(i => i.numero === n);
    const fit = st.fits[k]; const decision = st.decisions[k];
    const product = st.company.catalogo.find((p: any) => p.id === (decision?.produto ?? decision?.product_id ?? fit?.product_id));
    const proposed = decision && Object.hasOwn(decision, 'precoProposto') ? decision.precoProposto : decision?.preco_sugerido;
    const preco = finite(proposed) ? proposed : null;
    const quantidade = finite(item?.quantidade) ? item.quantidade : null;
    if (!decision) pendencias.add(`Item ${n}: decisão ainda não calculada.`);
    if (!fit?.attributes?.length) pendencias.add(`Item ${n}: encaixe técnico ainda não comprovado.`);
    if (fit?.validacao?.cobertura !== 'conferida') pendencias.add(`Item ${n}: cobertura das exigências técnicas não verificada.`);
    for (const lacuna of fit?.validacao?.lacunas ?? []) pendencias.add(`Item ${n}: campo sem citação própria (${lacuna}).`);
    if (!product) pendencias.add(`Item ${n}: produto do catálogo não localizado.`);
    for (const p of decision?.docs_vencidos ?? []) pendencias.add(p);
    return {
      item: n, descricao: item?.descricao ?? '', estado: decision?.estado ?? decision?.decision ?? 'nao_decidido', motivos: decision?.motivos ?? decision?.reasons ?? [],
      produto: product ? { id: product.id, nome: product.nome, marca: product.marca, registroAnvisa: product.registroAnvisa } : null,
      quantidade, precoUnitario: preco, estimativa: finite(item?.estimativa ?? item?.valorEstimado) ? (item.estimativa ?? item.valorEstimado) : null,
      valorTotal: preco !== null && quantidade !== null ? Math.round(preco * quantidade * 100) / 100 : null,
      resultadoEncaixe: fit?.overall ?? 'nao_verificado', atributos: fit?.attributes ?? [],
      validacao: fit?.validacao ?? { citacoes: 'nao_verificadas', cobertura: 'nao_verificada', semantica: 'nao_verificada' },
      anvisa: decision?.anvisa ?? null,
    };
  }).sort((a, b) => a.item - b.item);
  if (!itens.length) pendencias.add('Nenhum item analisado neste pregão.');
  const documents: DossierSource[] = [];
  for (const source of [...requirements.map(r => r.fonte), ...checks.map(d => d.fonte)].filter(Boolean) as DossierSource[]) {
    if (!documents.some(d => d.url === source.url && d.citacao === source.citacao)) documents.push({ ...source });
  }
  return {
    tender: tenderId, pregao: tender.numeroCompra ?? tenderId, versao: options.versao ?? '1',
    geradoEm: st.now.toISOString(), orgao: tender.orgao ?? '', sessao: tender.abertura ?? null,
    empresa: st.company.empresa?.nome ?? '', checklist, pendencias: [...pendencias], documentos: documents,
    exigencias: requirements.map(r => ({ ...r })), itens,
    // Uma apresentação de dossiê nunca substitui evaluate/recheck no caminho de envio.
    envioAutomaticoLiberado: false,
  };
}
