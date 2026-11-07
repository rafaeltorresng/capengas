// Gera a amostra de integração da tela. Sem rede, modelo, protocolo ou métricas inventadas.
// Uso: node scripts/estado-exemplo.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { newState, tools } from '../src/lib/tools.ts';
import { buildDossie } from '../src/lib/dossie.ts';

const load = (file: string) => JSON.parse(readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8'));
const tenderId = '77816510000166/2026/348';
const company = load('company.json');
const tender = load('coverage.json').find((t: any) => `${t.cnpj}/${t.ano}/${t.seq}` === tenderId);
const st = newState(company, 'http://127.0.0.1:9', new Date('2026-11-07T15:00:00-03:00'));
st.tenders[tenderId] = tender;
st.items[tenderId] = load('coded-items.json').filter((i: any) => i.tender === tenderId && [4, 40].includes(i.numero));
const ctx = { state: st, approvals: new Set<string>() };
const record = tools.find(t => t.name === 'record_fit')!;
for (const args of [
  { item: 4, product_id: 'P1', attributes: [
    { atributo: 'material', veredito: 'atende', citacao_item: 'material: aço inoxidável', citacao_ficha: 'Material: aço inoxidável AISI 420' },
    { atributo: 'característica adicional longo', veredito: 'nao_informado', citacao_item: 'características adicionais: longo' },
  ] },
  { item: 40, product_id: 'P2', attributes: [
    { atributo: 'haste', veredito: 'nao_atende', citacao_item: 'haste: haste reta', citacao_ficha: 'Haste curva, ponta romba' },
  ] },
]) {
  const r: any = await record.run({ ...args, tender_id: tenderId }, ctx);
  if (!r.aceito) throw new Error(`amostra inválida: ${JSON.stringify(r)}`);
}
// Exigência e decisões abaixo são ilustrativas, não uma extração do edital pelo modelo.
st.requirements = [{ tender_id: tenderId, requirement: 'certidoes', quote: 'Exemplo sintético: apresentar certidão de regularidade fiscal.' }];
st.decisions[`${tenderId}#4`] = { product_id: 'P1', decision: 'escalar', preco_sugerido: null,
  reasons: ['Ficha sintética não comprova a característica longo; documentação e regularização precisam de conferência.'] };
st.decisions[`${tenderId}#40`] = { product_id: 'P2', decision: 'nao_ofertar', preco_sugerido: null,
  reasons: ['O item exige haste reta; o produto fictício tem haste curva.'] };
const dossie = buildDossie(st, tenderId, { documentos: [{ exigencia: 'certidoes', documento: 'CND Federal — exemplo sintético', validade: '2026-11-15', status: 'vence_antes_sessao' }] });
const labels: Record<string, string> = { escalar: 'Escalar', nao_ofertar: 'Não disputar' };
const fitLabels: Record<string, string> = { atende: 'Atende', nao_atende: 'Não atende', nao_informado: 'Não informado' };
const itens = dossie.itens.map(i => ({
  tender: tenderId, pregao: tenderId, item: String(i.item), descricao: i.descricao, orgao: tender.orgao,
  prazo: `${tender.abertura}:00-03:00`, estado: labels[i.estado] ?? i.estado, motivo: i.motivos.join('; '),
  encaixe: i.atributos.map((a: any) => ({ atributo: a.atributo, exigido: a.exigido ?? a.citacao_item,
    ofertado: a.ofertado ?? a.citacao_ficha ?? 'Não informado na ficha sintética', resultado: fitLabels[a.veredito],
    fonte: { nome: 'Item no PNCP — snapshot da fixture', url: tender.url, citacao: a.citacao_item },
    citacaoFicha: a.citacao_ficha ?? null })),
  fontes: [{ nome: 'Publicação do pregão no PNCP', url: tender.url }],
  anvisa: 'Não verificada nesta amostra; números do catálogo não comprovam cobertura do modelo.',
  preco: i.precoUnitario, estimativa: i.estimativa, rastro: [], dossie: true,
}));
const fila = itens.map(({ encaixe, fontes, anvisa, preco, estimativa, rastro, dossie, ...row }) => row);
const sample = {
  _meta: { versao: 1, origem: 'amostra',
    aviso: 'Amostra sintética de integração, não é resultado de um turno do agente. Nenhum envio foi realizado.',
    reais: ['Identificação do pregão e descrições/estimativas dos itens copiadas das fixtures públicas existentes.'],
    sinteticos: ['Empresa, fichas, documentos, decisões e exigência de certidão ilustrativa.'],
    naoExecutados: ['Extração do edital', 'Consulta Anvisa', 'Política e recheque', 'Modelo Featherless', 'Envio', 'Agendador', 'Monitor'],
  },
  hoje: { data: '2026-11-07', pregoes: 1, itens: itens.length, disputar: 0, pendencias: 1, envios: 0,
    escaladasAbertas: 1, custoUsd: null, cofre: [],
    porDecisao: [{ estado: 'Escalar', quantidade: 1 }, { estado: 'Não disputar', quantidade: 1 }],
    eventos: [{ id: 'amostra-gerada', horario: st.now.toISOString(), tipo: 'Amostra',
      resumo: 'Amostra de integração preparada; nenhum turno ou envio executado.',
      detalhe: 'Horário ilustrativo. Consultas, decisões e métricas de produção não foram executadas pelo gerador.', rastro: [] }] },
  fila, itens, dossies: [dossie],
  escaladas: [{ id: 'amostra-cnd', tender: tenderId, item: '4', pregao: tenderId,
    motivo: 'Pendência sintética de ficha e documento.', recomendacao: 'Conferir ficha do fabricante e CND antes de recalcular a decisão.',
    prazo: `${tender.abertura}:00-03:00`, dossie: true }],
  prova: { fonte: 'Esta amostra não executa avaliações do modelo nem representa um turno real. Regressões locais em test/tools.test.ts e test/dossie.test.ts.',
    avaliacoes: [], cenarios: [], concordancia: null, custoUsd: null, duracaoMs: null },
};
const target = new URL('../fixtures/estado-exemplo.json', import.meta.url);
writeFileSync(target, JSON.stringify(sample, null, 2) + '\n');
console.log('Gerado fixtures/estado-exemplo.json — amostra identificada, sem consumo de API.');
