// Documentos que o Lance redige além da proposta: as declarações da lista fechada e o comprovante de registro na ANVISA.
// O texto da declaração é a redação legal; o edital só diz que ela é exigida. Uma declaração só sai quando o cadastro
// sustenta o que ela afirma: o que depende de um fato que o cadastro não tem vai para um humano.
import { TIPOS_DOCUMENTO, type TipoDocumento } from './plano-documentos.ts';
import type { EmpresaProposta } from './documento-proposta.ts';
import type { ConferenciaRegistro } from './catalogo.ts';

export type EmpresaDeclarante = EmpresaProposta & { atuacao?: string; programaIntegridade?: boolean };
export type ItemComprovante = {
  item: number; descricao: string; produto: { nome?: string; marca: string; registroAnvisa?: string } | null;
  anvisa: { regularizacao?: string; conferencia?: ConferenciaRegistro | null } | null;
};
export type DocumentoGerado = { tipo: TipoDocumento; titulo: string; markdown: string; pendencias: string[] };

const LEI = 'Lei nº 14.133, de 1º de abril de 2021';
const DECLARACOES = {
  declaracao_me_epp: (e: EmpresaDeclarante) => `enquadra-se como ${e.porte === 'ME' ? 'microempresa' : 'empresa de pequeno porte'} e cumpre os requisitos estabelecidos no art. 3º da Lei Complementar nº 123, de 14 de dezembro de 2006, estando apta a usufruir do tratamento favorecido estabelecido em seus arts. 42 a 49, observado o disposto nos §§ 1º a 3º do art. 4º da ${LEI}.`,
  declaracao_menor: () => 'não emprega menor de 18 (dezoito) anos em trabalho noturno, perigoso ou insalubre e não emprega menor de 16 (dezesseis) anos, salvo menor, a partir de 14 (quatorze) anos, na condição de aprendiz, nos termos do art. 7º, XXXIII, da Constituição Federal.',
  declaracao_pcd: () => `cumpre as exigências de reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social, previstas em lei e em outras normas específicas, conforme o art. 63, IV, da ${LEI}.`,
  declaracao_custos_trabalhistas: () => `suas propostas econômicas compreendem a integralidade dos custos para atendimento dos direitos trabalhistas assegurados na Constituição Federal, nas leis trabalhistas, nas normas infralegais, nas convenções coletivas de trabalho e nos termos de ajustamento de conduta vigentes na data de entrega das propostas, conforme o art. 63, § 1º, da ${LEI}.`,
  declaracao_integridade: () => `desenvolve programa de integridade, nos termos da ${LEI}, e do Decreto nº 12.304, de 2024.`,
  declaracao_habilitacao: () => `atende aos requisitos de habilitação previstos no edital e responde pela veracidade das informações prestadas, na forma da lei, conforme o art. 63, I, da ${LEI}.`,
  declaracao_pleno_acordo: () => 'está ciente e de pleno acordo com todas as condições estabelecidas no edital e em seus anexos.',
} satisfies Partial<Record<TipoDocumento, (e: EmpresaDeclarante) => string>>;

export const GERAVEIS: TipoDocumento[] = [...Object.keys(DECLARACOES) as TipoDocumento[], 'registro_anvisa'];

/** Por que o Lance não pode redigir esta declaração com o cadastro atual; null quando pode. */
export function impedimento(tipo: TipoDocumento, empresa: Partial<EmpresaDeclarante> | undefined): { status: 'conferir' | 'nao_se_aplica'; motivo: string } | null {
  if (!GERAVEIS.includes(tipo)) return { status: 'conferir', motivo: 'O Lance não tem redação padrão para esta declaração; redigir conforme o edital.' };
  if (tipo === 'declaracao_me_epp') {
    if (!empresa?.porte) return { status: 'conferir', motivo: 'O cadastro não informa o porte da empresa; só ME ou EPP pode fazer esta declaração.' };
    if (!['ME', 'EPP'].includes(empresa.porte)) return { status: 'nao_se_aplica', motivo: `A empresa tem porte ${empresa.porte}; a declaração é só para ME ou EPP.` };
  }
  if (tipo === 'declaracao_integridade' && empresa?.programaIntegridade !== true) {
    return { status: 'conferir', motivo: 'O cadastro não informa que a empresa desenvolve programa de integridade; só declarar se for verdade.' };
  }
  return null;
}

const PREENCHER = '[preencher]';
const celula = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();

export function gerarDocumento(o: {
  tipo: TipoDocumento; linha: { citacao?: string; fonte?: { nome: string; url: string } };
  pregao: { id: string; orgao: string }; empresa: EmpresaDeclarante; itens: ItemComprovante[]; hoje: Date;
}): DocumentoGerado {
  const { tipo, empresa, pregao } = o;
  if (!GERAVEIS.includes(tipo)) throw new Error(`O Lance não gera ${TIPOS_DOCUMENTO[tipo]?.nome ?? tipo}.`);
  const bloqueio = impedimento(tipo, empresa);
  if (bloqueio) throw new Error(bloqueio.motivo);
  const pendencias: string[] = [];
  const pendente = (p: string) => { if (!pendencias.includes(p)) pendencias.push(p); return PREENCHER; };
  const titulo = TIPOS_DOCUMENTO[tipo].nome;
  const linhas: string[] = [];
  const add = (...l: string[]) => linhas.push(...l);
  const qualificacao = `A ${empresa.nome}, inscrita no CNPJ sob o nº ${empresa.cnpj || pendente('dado da empresa: CNPJ')}, por intermédio de seu representante legal, ${empresa.representante?.nome || pendente('dado da empresa: Representante legal')}`;

  if (tipo === 'registro_anvisa') {
    const problemas = o.itens.flatMap(i => i.anvisa?.conferencia?.status === 'confere' && i.anvisa.conferencia.anvisa ? []
      : [`item ${i.item}: ${i.anvisa?.conferencia?.motivo ?? 'registro não conferido na base oficial'}`]);
    if (!o.itens.length) problemas.push('nenhum item viável');
    if (problemas.length) throw new Error(`Comprovante ANVISA não gerado: ${problemas.join('; ')}.`);
    add('# COMPROVANTE DE REGULARIZAÇÃO NA ANVISA', '');
  } else {
    add(`# ${titulo.toUpperCase()}`, '');
  }
  add(`**Ao(À) ${pregao.orgao}**  `, `**Pregão eletrônico** — PNCP ${pregao.id}`, '');

  if (tipo === 'registro_anvisa') {
    const consulta = o.hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Recife' });
    add(`${qualificacao}, apresenta a regularização na ANVISA dos produtos ofertados:`, '');
    add('| Item | Descrição | Marca | Registro ANVISA | Validade | Detentor | Fabricante | Classe |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const i of o.itens) {
      const a = i.anvisa!.conferencia!.anvisa!;
      add(`| ${[String(i.item), i.descricao, i.produto?.marca ?? '', a.registro, a.validade, a.detentor, a.fabricante, a.classe].map(celula).join(' | ')} |`);
    }
    add('', `Dados da base oficial de produtos para saúde da ANVISA (dados.anvisa.gov.br, arquivo TA_PRODUTO_SAUDE_SITE), na consulta feita na análise de ${consulta}. Este quadro não é emitido pela ANVISA: anexe a consulta do portal da ANVISA se o edital pedir o documento do órgão.`, '');
  } else {
    add(`${qualificacao}, DECLARA, para os fins do pregão acima, que ${DECLARACOES[tipo as keyof typeof DECLARACOES](empresa)}`, '');
  }

  const data = o.hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: 'long', year: 'numeric' });
  add(`${empresa.municipio || pendente('local da assinatura')}, ${data}.`, '', '', '______________________________________');
  add(empresa.representante?.nome || PREENCHER);
  add([empresa.representante?.cargo, empresa.representante?.cpf ? `CPF ${empresa.representante.cpf}` : null].filter(Boolean).join(' — ') || PREENCHER);
  add(empresa.nome, '');
  if (o.linha.citacao) add('## Exigência do edital', '', `> ${o.linha.citacao}`, '', ...(o.linha.fonte ? [`Fonte: ${o.linha.fonte.nome} - ${o.linha.fonte.url}`, ''] : []));
  return { tipo, titulo, markdown: linhas.join('\n') + '\n', pendencias };
}
