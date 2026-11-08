// Plano de documentos por pregão: quais documentos o edital pede, em que fase, sob que condição, e quem providencia cada um.
// O modelo aponta a exigência com citação literal; o código classifica, cruza com o cofre, o catálogo e a ANVISA, e monta a lista.
import { checkDocs, verifyQuote } from './rules.ts';
import type { Schema } from './schema.ts';
import type { CofreDoc } from './contracts.ts';
import type { Documento, RegraProposta } from './regras-proposta.ts';
import type { LanceState } from './tools.ts';
import { impedimento } from './documentos-gerados.ts';

export type Classe = 'gerado' | 'cofre' | 'produto' | 'terceiro' | 'evento' | 'humano';
export type Fase = 'proposta_inicial' | 'proposta_ajustada' | 'habilitacao' | 'nao_informada';
export type Condicao = 'sempre' | 'se_exigido' | 'se_solicitado' | 'se_distribuidor';

type TipoDef = { nome: string; classe: Classe; fase: Fase; assunto: RegExp };
const T = (nome: string, classe: Classe, fase: Fase, assunto: RegExp): TipoDef => ({ nome, classe, fase, assunto });

/** Lista fechada. O que não couber vira documento_outro e vai para um humano. */
export const TIPOS_DOCUMENTO = {
  proposta_precos: T('Proposta de preços ajustada', 'gerado', 'proposta_ajustada', /proposta/),
  declaracao_me_epp: T('Declaração de ME/EPP', 'gerado', 'proposta_inicial', /microempresa|pequeno porte|\bme ?\/ ?epp\b|complementar n?.? ?123|lc 123/),
  declaracao_menor: T('Declaração de não emprego de menor', 'gerado', 'proposta_inicial', /menor(es)? de (16|18|dezesseis|dezoito)|trabalho noturno|xxxiii/),
  declaracao_pcd: T('Declaração de reserva de cargos (PcD e reabilitados)', 'gerado', 'proposta_inicial', /deficiencia|reabilitad/),
  declaracao_custos_trabalhistas: T('Declaração de integralidade dos custos trabalhistas', 'gerado', 'proposta_inicial', /custos[^.;]{0,60}trabalhist|direitos trabalhistas/),
  declaracao_integridade: T('Declaração de programa de integridade', 'gerado', 'proposta_inicial', /programa de integridade/),
  declaracao_habilitacao: T('Declaração de que atende aos requisitos de habilitação', 'gerado', 'proposta_inicial', /requisitos de habilitac/),
  declaracao_pleno_acordo: T('Declaração de pleno acordo com o edital', 'gerado', 'proposta_ajustada', /pleno acordo|plena aceitacao|aceitacao (plena|integral)|concord/),
  declaracao_outra: T('Outra declaração', 'gerado', 'nao_informada', /declar/),
  cnd_federal: T('CND Federal', 'cofre', 'habilitacao', /receita federal|divida ativa da uniao|tributos federais|regularidade fiscal|\bcnd\b/),
  crf_fgts: T('CRF FGTS', 'cofre', 'habilitacao', /fgts|fundo de garantia/),
  cndt: T('CNDT', 'cofre', 'habilitacao', /debitos trabalhistas|cndt|justica do trabalho/),
  certidao_estadual: T('Certidão de regularidade estadual', 'cofre', 'habilitacao', /estadua/),
  certidao_municipal: T('Certidão de regularidade municipal', 'cofre', 'habilitacao', /municipa/),
  certidao_falencia: T('Certidão negativa de falência', 'cofre', 'habilitacao', /falencia|recuperacao judicial/),
  afe: T('AFE ANVISA', 'cofre', 'habilitacao', /autorizacao de funcionamento|\bafe\b/),
  licenca_sanitaria: T('Licença sanitária', 'cofre', 'habilitacao', /licenca sanitaria|alvara sanitario|licenca de funcionamento/),
  contrato_social: T('Contrato social ou ato constitutivo', 'cofre', 'habilitacao', /contrato social|ato constitutivo|estatuto social/),
  balanco: T('Balanço patrimonial', 'cofre', 'habilitacao', /balanco patrimonial|demonstracoes contabeis/),
  atestado: T('Atestado de capacidade técnica', 'cofre', 'habilitacao', /atestado|capacidade tecnica/),
  catalogo_ficha_tecnica: T('Catálogo ou ficha técnica do produto', 'produto', 'proposta_ajustada', /catalog|prospect|folder|folheto|ficha tecnica|manual/),
  registro_anvisa: T('Comprovante de regularização na ANVISA', 'produto', 'proposta_ajustada', /anvisa|registro|notificacao|vigilancia sanitaria|ministerio da saude/),
  certificado_produto: T('Certificado ou laudo do produto', 'produto', 'proposta_ajustada', /certificad|inmetro|laudo/),
  carta_solidariedade: T('Carta de solidariedade do fabricante', 'terceiro', 'proposta_ajustada', /solidariedade/),
  comprovante_distribuidor: T('Comprovante de distribuidor autorizado', 'terceiro', 'habilitacao', /distribuidor|revendedor|representante do fabricante/),
  amostra: T('Amostra', 'evento', 'proposta_ajustada', /amostra/),
  documento_outro: T('Outro documento', 'humano', 'nao_informada', /./),
} satisfies Record<string, TipoDef>;
export type TipoDocumento = keyof typeof TIPOS_DOCUMENTO;
const TIPOS = Object.keys(TIPOS_DOCUMENTO) as TipoDocumento[];
const FASES: Fase[] = ['proposta_inicial', 'proposta_ajustada', 'habilitacao', 'nao_informada'];
const CONDICOES: Condicao[] = ['sempre', 'se_exigido', 'se_solicitado', 'se_distribuidor'];
/** Tipos que um mesmo pregão pode pedir mais de uma vez com conteúdos diferentes. */
const MULTIPLOS = new Set<TipoDocumento>(['declaracao_outra', 'documento_outro']);

export type Origem = 'agente' | 'regra_proposta' | 'exigencia_edital' | 'implicito';
export type ExigenciaDocumental = {
  tipo: TipoDocumento; fase: Fase; condicoes: Condicao[]; prazo?: string; resumo?: string;
  citacao?: string; fonte?: { nome: string; url: string }; origem: Origem; noSistema?: boolean;
};

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
const primeiro = (texto: string, ordem: TipoDocumento[]) => ordem.find(t => TIPOS_DOCUMENTO[t].assunto.test(texto));

export function condicoesDe(texto: string): Condicao[] {
  const t = norm(texto); const c: Condicao[] = [];
  if (/distribuidor|revendedor/.test(t)) c.push('se_distribuidor');
  if (/caso o termo|caso [^.;]{0,60}exij|se exigid|quando exigive|quando aplicavel|se for o caso/.test(t)) c.push('se_exigido');
  if (/podera solicitar|solicitad|a contar da solicitacao|quando solicit/.test(t)) c.push('se_solicitado');
  return c.length ? c : ['sempre'];
}

export function prazoDe(texto: string) {
  const m = norm(texto).match(/(\d+) ?(\([^)]{1,20}\) ?)?(horas?|dias? (uteis|corridos)|dias?)\b/);
  return m ? `${m[1]} ${m[3].replace('uteis', 'úteis')}` : undefined;
}

const noSistema = (texto: string) => /campo proprio do sistema|apresentou no sistema|no sistema eletronico|em campo proprio/.test(norm(texto));
const faseDe = (tipo: TipoDocumento, texto: string, sistema: boolean): Fase => {
  if (sistema) return 'proposta_inicial';
  if (!tipo.startsWith('declaracao') && /habilitac/.test(norm(texto))) return 'habilitacao';
  return TIPOS_DOCUMENTO[tipo].fase;
};

const ORDEM_DECLARACOES: TipoDocumento[] = ['declaracao_me_epp', 'declaracao_menor', 'declaracao_pcd', 'declaracao_custos_trabalhistas',
  'declaracao_integridade', 'declaracao_habilitacao', 'declaracao_pleno_acordo'];
const ORDEM_ANEXOS: TipoDocumento[] = ['carta_solidariedade', 'amostra', 'comprovante_distribuidor', 'catalogo_ficha_tecnica', 'certificado_produto'];
/** Para exigência "outro", só tipos com termo inequívoco; "estadual", "registro" ou "manual" sozinhos não bastam. */
const ORDEM_OUTRO: TipoDocumento[] = ['afe', 'licenca_sanitaria', 'contrato_social', 'balanco', 'certidao_falencia', 'crf_fgts', 'cndt', 'carta_solidariedade'];

function exigencia(tipo: TipoDocumento, texto: string, base: Pick<ExigenciaDocumental, 'citacao' | 'fonte' | 'origem' | 'resumo'>): ExigenciaDocumental {
  const sistema = tipo.startsWith('declaracao') && noSistema(texto);
  return { tipo, fase: faseDe(tipo, texto, sistema), condicoes: condicoesDe(texto), prazo: prazoDe(base.citacao ?? texto), ...base, ...(sistema ? { noSistema: true } : {}) };
}

/** Converte as regras da proposta já extraídas (com citação conferida) em exigências de documento. */
export function deRegrasProposta(regras: RegraProposta[]): ExigenciaDocumental[] {
  const out: ExigenciaDocumental[] = [];
  for (const r of regras) {
    const base = { citacao: r.citacao, fonte: r.fonte, origem: 'regra_proposta' as const, resumo: r.valor };
    const citado = norm(r.citacao); const ambos = norm(`${r.valor} ${r.citacao}`);
    if (r.campo === 'modelo_proposta') out.push(exigencia('proposta_precos', r.citacao, base));
    // "A apresentação da proposta implicará a aceitação..." é efeito do envio, não documento a produzir.
    else if (r.campo === 'declaracoes' && /implicar[aá]|\bimplica\b/.test(citado)) continue;
    else if (r.campo === 'declaracoes') out.push(exigencia(primeiro(citado, ORDEM_DECLARACOES) ?? primeiro(ambos, ORDEM_DECLARACOES) ?? 'declaracao_outra', r.citacao, base));
    else if (r.campo === 'documentos_anexos') out.push(exigencia(primeiro(citado, ORDEM_ANEXOS) ?? primeiro(ambos, ORDEM_ANEXOS) ?? 'documento_outro', r.citacao, base));
    else if (r.campo === 'registro_anvisa') {
      out.push(exigencia('registro_anvisa', r.citacao, base));
      for (const extra of ['afe', 'licenca_sanitaria'] as const) if (TIPOS_DOCUMENTO[extra].assunto.test(citado)) out.push(exigencia(extra, r.citacao, base));
    }
  }
  return out;
}

const DE_REQUISITO: Record<string, TipoDocumento[]> = {
  afe: ['afe'], certidoes: ['cnd_federal', 'crf_fgts', 'cndt'], amostra: ['amostra'], registro_anvisa: ['registro_anvisa'],
  balanco: ['balanco'], atestado: ['atestado'],
};
/** Converte as exigências do record_requirement (fluxo principal) em exigências de documento. */
export function deRequisitos(requirements: { requirement?: string; tipo?: string; quote?: string; citacao?: string; fonte?: { nome: string; url: string } }[]): ExigenciaDocumental[] {
  const out: ExigenciaDocumental[] = [];
  for (const r of requirements) {
    const req = r.requirement ?? r.tipo ?? ''; const citacao = r.quote ?? r.citacao ?? '';
    const tipos = DE_REQUISITO[req] ?? (req === 'outro' ? [primeiro(norm(citacao), ORDEM_OUTRO)].filter(Boolean) as TipoDocumento[] : []);
    for (const tipo of tipos) out.push(exigencia(tipo, citacao, { citacao, fonte: r.fonte, origem: 'exigencia_edital' }));
  }
  return out;
}

export const PARAMETROS_EXIGENCIA: Record<string, Schema> = {
  tipo: { type: 'string', enum: [...TIPOS], description: 'documento_outro quando nenhum tipo da lista servir' },
  fase: { type: 'string', enum: [...FASES], description: 'proposta_inicial (cadastrada antes da sessão), proposta_ajustada (enviada após o último lance), habilitacao' },
  condicoes: { type: 'array', items: { type: 'string', enum: [...CONDICOES] }, description: 'sempre; se_exigido (ex.: "caso o TR exija"); se_solicitado (pelo pregoeiro); se_distribuidor (só para revendedor)' },
  prazo: { type: 'string', description: 'prazo escrito no trecho, ex.: "3 dias úteis a contar da solicitação"' },
  resumo: { type: 'string' },
  citacao: { type: 'string' },
};

/** Registra uma exigência apontada pelo modelo. A citação precisa ser literal e falar do tipo de documento. */
export function registrarExigencia(docs: Documento[], lista: ExigenciaDocumental[],
  a: { tipo: string; fase?: string; condicoes?: string[]; prazo?: string; resumo?: string; citacao: string }) {
  const tipo = a.tipo as TipoDocumento;
  if (!TIPOS.includes(tipo)) return { aceito: false, motivo: `tipo desconhecido; use um destes: ${TIPOS.join(', ')}` };
  const doc = docs.find(d => verifyQuote(a.citacao, d.texto).found);
  if (!doc) return { aceito: false, motivo: `citação rejeitada: ${verifyQuote(a.citacao, docs.map(d => d.texto).join(' ')).reason}. Copie o trecho literal.` };
  if (!TIPOS_DOCUMENTO[tipo].assunto.test(norm(a.citacao))) return { aceito: false, motivo: `a citação não fala de ${TIPOS_DOCUMENTO[tipo].nome}; registre só o que o trecho diz.` };
  const condicoes = condicoesDe(a.citacao);
  const e: ExigenciaDocumental = {
    tipo, fase: FASES.includes(a.fase as Fase) ? a.fase as Fase : faseDe(tipo, a.citacao, false),
    condicoes, prazo: prazoDe(a.citacao), resumo: a.resumo,
    citacao: a.citacao, fonte: { nome: doc.nome, url: doc.url }, origem: 'agente',
    ...(tipo.startsWith('declaracao') && noSistema(a.citacao) ? { noSistema: true } : {}),
  };
  if (!lista.some(x => x.tipo === e.tipo && x.citacao === e.citacao)) lista.push(e);
  return { aceito: true, arquivo: doc.nome, tipo, fase: e.fase, condicoes: e.condicoes };
}

export type Status = 'pronto' | 'gerado' | 'lance_gera' | 'marcar_no_sistema' | 'vence_antes' | 'ausente' | 'irregular'
  | 'pedir_terceiro' | 'preparar' | 'conferir' | 'nao_se_aplica';
export const ROTULOS: Record<Status, string> = {
  pronto: 'Pronto', gerado: 'Gerado', lance_gera: 'O Lance gera', marcar_no_sistema: 'Marcar no sistema', vence_antes: 'Vence antes da sessão',
  ausente: 'Ausente', irregular: 'Irregular', pedir_terceiro: 'Pedir ao fabricante', preparar: 'Preparar', conferir: 'Conferir', nao_se_aplica: 'Não se aplica',
};
const PROBLEMA = new Set<Status>(['vence_antes', 'ausente', 'irregular', 'pedir_terceiro', 'conferir']);

export type LinhaPlano = {
  tipo: TipoDocumento; documento: string; classe: Classe; fase: Fase; condicoes: Condicao[]; condicional: boolean;
  status: Status; rotulo: string; responsavel: 'lance' | 'humano' | 'terceiro'; acao: string;
  ate: string | null; prazo?: string; itens?: number[]; citacao?: string; fonte?: { nome: string; url: string }; origem: Origem;
};
export type PlanoDocumentos = {
  tender: string; sessao: string | null; itens: number[]; linhas: LinhaPlano[]; pendencias: string[];
  resumo: { total: number; prontos: number; lance: number; humano: number; terceiro: number; problemas: number; condicionais: number };
};
export type ProdutoViavel = {
  item: number; produto: { id: string; nome: string; marca: string; registroAnvisa?: string; arquivos?: Record<string, string> } | null;
  regularizacao?: string;
};

const PRIORIDADE: Record<Origem, number> = { agente: 0, regra_proposta: 1, exigencia_edital: 2, implicito: 3 };
function consolidar(exigencias: ExigenciaDocumental[]) {
  const porTipo = new Map<string, ExigenciaDocumental>();
  for (const e of [...exigencias].sort((a, b) => PRIORIDADE[a.origem] - PRIORIDADE[b.origem])) {
    const chave = MULTIPLOS.has(e.tipo) ? `${e.tipo}:${e.citacao}` : e.tipo;
    const atual = porTipo.get(chave);
    if (!atual) porTipo.set(chave, { ...e });
    else if (!atual.prazo && e.prazo) atual.prazo = e.prazo;
  }
  return [...porTipo.values()];
}

const ORDEM_FASE: Record<Fase, number> = { proposta_inicial: 0, proposta_ajustada: 1, habilitacao: 2, nao_informada: 3 };
const fmt = (xs: string[]) => [...new Set(xs)].join(', ');

export function montarPlano(o: {
  tenderId: string; exigencias: ExigenciaDocumental[]; cofre: CofreDoc[]; sessao: string | null; hoje: string;
  empresa: { atuacao?: string; porte?: string; programaIntegridade?: boolean } | undefined; produtos: ProdutoViavel[]; propostaGerada?: boolean; prazoPropostaAjustada?: string;
}): PlanoDocumentos {
  const exigencias = consolidar([...o.exigencias, { tipo: 'proposta_precos', fase: 'proposta_ajustada', condicoes: ['sempre'], origem: 'implicito' }]);
  const atuacao = o.empresa?.atuacao;
  const linhas: LinhaPlano[] = exigencias.map(e => {
    const def = TIPOS_DOCUMENTO[e.tipo];
    const revende = atuacao === 'distribuidora' || atuacao === 'revendedora';
    const condicoes = e.condicoes.filter(c => !(c === 'se_distribuidor' && revende));
    const condicional = condicoes.some(c => c === 'se_exigido' || c === 'se_solicitado');
    let status: Status = 'conferir'; let responsavel: LinhaPlano['responsavel'] = 'humano'; let acao = 'Conferir a exigência no edital e decidir quem providencia.';
    let ate: string | null = null; let itens: number[] | undefined; let prazo = e.prazo;
    if (e.tipo === 'proposta_precos') {
      status = o.propostaGerada ? 'gerado' : 'lance_gera'; responsavel = 'lance'; prazo ??= o.prazoPropostaAjustada;
      acao = 'Atualizar com o preço do último lance e enviar dentro do prazo da convocação.';
    } else if (def.classe === 'gerado') {
      const bloqueio = impedimento(e.tipo, o.empresa);
      if (bloqueio?.status === 'nao_se_aplica') { status = 'nao_se_aplica'; acao = bloqueio.motivo; }
      else if (e.noSistema) { status = 'marcar_no_sistema'; acao = 'Marcar a declaração no portal ao cadastrar a proposta.'; }
      else if (bloqueio) acao = bloqueio.motivo;
      else { status = 'lance_gera'; responsavel = 'lance'; acao = 'O Lance redige a declaração; o representante assina.'; }
    } else if (def.classe === 'cofre') {
      const [r] = checkDocs(o.cofre, [{ tipo: e.tipo, citacao: e.citacao ?? '' }], o.sessao ?? o.hoje);
      ate = o.sessao;
      if (!r || r.status === 'ausente') { status = 'ausente'; acao = 'Obter o documento e guardar no cofre antes da sessão.'; }
      else if (r.status === 'irregular') { status = 'irregular'; acao = `Regularizar: ${r.documento}.`; }
      else if (r.status === 'vence_antes_sessao') { status = 'vence_antes'; acao = `Renovar ${r.documento} (validade ${r.validade}).`; }
      else { status = 'pronto'; responsavel = 'lance'; acao = `Anexar ${r.documento} do cofre.`; }
    } else if (def.classe === 'produto') {
      const comProduto = o.produtos.filter(p => p.produto); itens = o.produtos.map(p => p.item);
      if (!comProduto.length) { status = 'conferir'; acao = 'Nenhum produto ofertado identificado para este documento.'; }
      else if (e.tipo === 'registro_anvisa') {
        const ruins = comProduto.filter(p => p.regularizacao !== 'vigente');
        if (ruins.some(p => p.regularizacao === 'vencido' || p.regularizacao === 'nao_encontrado')) {
          status = 'irregular'; acao = `Registro sem vigência na base da ANVISA: ${fmt(ruins.map(p => `item ${p.item} (${p.produto!.registroAnvisa ?? 'sem registro'})`))}.`;
        } else if (ruins.length) { status = 'conferir'; acao = `Conferir o registro na ANVISA: ${fmt(ruins.map(p => `item ${p.item}`))}.`; }
        else { status = 'lance_gera'; responsavel = 'lance'; acao = 'O Lance monta o comprovante a partir da consulta à base oficial da ANVISA.'; }
      } else {
        const faltam = comProduto.filter(p => !p.produto!.arquivos?.[e.tipo]);
        if (faltam.length) { status = 'ausente'; acao = `Subir o arquivo de: ${fmt(faltam.map(p => `${p.produto!.nome} (${p.produto!.marca})`))}.`; }
        else { status = 'pronto'; responsavel = 'lance'; acao = 'Anexar os arquivos do catálogo.'; }
      }
    } else if (def.classe === 'terceiro') {
      if (atuacao === 'fabricante') { status = 'nao_se_aplica'; acao = 'A empresa fabrica os produtos ofertados.'; }
      else if (!revende && e.condicoes.includes('se_distribuidor')) { status = 'conferir'; acao = 'Confirmar se a empresa revende os produtos ofertados.'; }
      else {
        status = 'pedir_terceiro'; responsavel = 'terceiro'; itens = o.produtos.map(p => p.item);
        acao = `Pedir ao fabricante das marcas: ${fmt(o.produtos.filter(p => p.produto).map(p => p.produto!.marca)) || 'a identificar'}.`;
      }
    } else if (def.classe === 'evento') {
      status = 'preparar'; itens = o.produtos.map(p => p.item);
      acao = `Separar amostra dos itens ${itens.join(', ') || 'ofertados'} para entregar no prazo.`;
    }
    if (condicional && status !== 'nao_se_aplica') acao = `${condicoes.includes('se_solicitado') ? 'Só se o pregoeiro solicitar' : 'Só se o termo de referência exigir'}; deixar encaminhado. ${acao}`;
    return { tipo: e.tipo, documento: def.nome, classe: def.classe, fase: e.fase, condicoes, condicional, status, rotulo: ROTULOS[status], responsavel, acao,
      ate, ...(prazo ? { prazo } : {}), ...(itens ? { itens } : {}), ...(e.citacao ? { citacao: e.citacao } : {}), ...(e.fonte ? { fonte: e.fonte } : {}), origem: e.origem };
  }).sort((a, b) => ORDEM_FASE[a.fase] - ORDEM_FASE[b.fase] || TIPOS.indexOf(a.tipo) - TIPOS.indexOf(b.tipo));
  const pendencias = linhas.filter(l => PROBLEMA.has(l.status)).map(l => `${l.condicional ? '(condicional) ' : ''}${l.documento}: ${l.rotulo}. ${l.acao}`);
  const resumo = {
    total: linhas.length, prontos: linhas.filter(l => l.status === 'pronto' || l.status === 'gerado').length,
    lance: linhas.filter(l => l.responsavel === 'lance').length, humano: linhas.filter(l => l.responsavel === 'humano').length,
    terceiro: linhas.filter(l => l.responsavel === 'terceiro').length, problemas: linhas.filter(l => PROBLEMA.has(l.status)).length,
    condicionais: linhas.filter(l => l.condicional).length,
  };
  return { tender: o.tenderId, sessao: o.sessao, itens: [...new Set(o.produtos.map(p => p.item))].sort((a, b) => a - b), linhas, pendencias, resumo };
}

const VIAVEL = new Set(['disputar', 'disputar_com_pendencia']);
/** Plano a partir do estado do Lance. Só existe quando algum item do pregão é viável. */
export function planoDoEstado(st: LanceState, tenderId: string): PlanoDocumentos | null {
  const viaveis = Object.entries(st.decisions).filter(([k, d]) => k.startsWith(tenderId + '#') && VIAVEL.has(d?.estado));
  if (!viaveis.length) return null;
  const produtos: ProdutoViavel[] = viaveis.map(([k, d]) => ({
    item: Number(k.split('#')[1]),
    produto: st.company.catalogo.find((p: any) => p.id === (d.produto ?? d.product_id)) ?? null,
    regularizacao: d.anvisa?.regularizacao,
  }));
  const requirements = st.requirements.filter(r => (r.tender_id ?? r.tenderId) === tenderId);
  const regras = st.proposalRules?.[tenderId] ?? [];
  const prazoAjustada = regras.filter(r => r.campo === 'prazo_envio').map(r => prazoDe(r.citacao)).find(Boolean);
  const tender = st.tenders[tenderId] ?? {};
  return montarPlano({
    tenderId, sessao: typeof tender.abertura === 'string' ? tender.abertura.slice(0, 10) : null, hoje: st.now.toISOString().slice(0, 10),
    exigencias: [...(st.documentRequirements?.[tenderId] ?? []), ...deRegrasProposta(regras), ...deRequisitos(requirements)],
    cofre: st.company.cofre ?? [], empresa: st.company.empresa, produtos, propostaGerada: !!st.proposals?.[tenderId], prazoPropostaAjustada: prazoAjustada,
  });
}
