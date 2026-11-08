// Agente extrator: lê todos os documentos do pregão e registra, com citação literal conferida, as regras de apresentação da proposta.
import { runAgent, type LLM, type Tool, type Ctx, type TraceEvent, type Usage } from './agent.ts';
import { verifyQuote } from './rules.ts';
import type { Schema } from './schema.ts';
import { pncp, pdf } from './data.ts';

export type Documento = { nome: string; url: string; texto: string };

export const CAMPOS = ['modelo_proposta', 'validade_proposta', 'prazo_envio', 'forma_envio', 'colunas_itens', 'casas_decimais', 'dados_empresa',
  'declaracoes', 'documentos_anexos', 'marca_fabricante', 'registro_anvisa', 'dados_bancarios', 'assinatura', 'quantidade', 'outro'] as const;
export type Campo = typeof CAMPOS[number];
/** Sem regra citada para um destes, o documento da proposta precisa marcar o campo como não especificado no edital. */
export const CAMPOS_ESSENCIAIS: Campo[] = ['modelo_proposta', 'validade_proposta', 'prazo_envio', 'forma_envio', 'marca_fabricante', 'registro_anvisa', 'documentos_anexos', 'declaracoes'];

/** A citação precisa falar do campo; sem isso, uma frase real do edital vira regra deduzida. */
const ASSUNTO: Partial<Record<Campo, { re: RegExp; nome: string }>> = {
  modelo_proposta: { re: /modelo|anexo|formul/, nome: 'modelo ou anexo' },
  validade_proposta: { re: /validade/, nome: 'validade' },
  prazo_envio: { re: /prazo|hora|minuto|dia/, nome: 'prazo' },
  casas_decimais: { re: /decima/, nome: 'casas decimais' },
  marca_fabricante: { re: /marca|fabricante|modelo/, nome: 'marca ou fabricante' },
  registro_anvisa: { re: /anvisa|registro|ministerio da saude|vigilancia sanitaria/, nome: 'registro sanitário' },
  documentos_anexos: { re: /catalog|prospect|folder|ficha|carta|amostra|document|anex/, nome: 'documentos anexos' },
  declaracoes: { re: /declar|aceita|atest|compromet/, nome: 'declaração' },
  dados_bancarios: { re: /banco|agencia|conta/, nome: 'dados bancários' },
  assinatura: { re: /assin|responsavel|representante/, nome: 'assinatura' },
  quantidade: { re: /quantidade|quantitativo/, nome: 'quantidade' },
};

export type RegraProposta = { campo: Campo; valor: string; citacao: string; fonte?: { nome: string; url: string } };
export type ResultadoRegras = {
  tenderId: string; legivel: boolean; motivo?: string; arquivos: string[];
  regras: RegraProposta[]; lacunas: Campo[];
  usage: Usage; ms: number; stopped?: string; trace: TraceEvent[];
};

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
type Estado = { documentos: Documento[]; regras: RegraProposta[] };
const E = (ctx: Ctx) => ctx.state as Estado;
function acharTodas(texto: string, termo: string) {
  const r: number[] = []; if (!termo) return r;
  for (let i = texto.indexOf(termo); i >= 0; i = texto.indexOf(termo, i + termo.length)) r.push(i);
  return r;
}

/** Cláusulas onde as regras da proposta costumam estar; o código as localiza antes de o modelo começar. */
const PISTAS: { rotulo: string; re: RegExp; ultima?: boolean }[] = [
  { rotulo: 'modelo de proposta (anexo)', re: /modelo[^.;]{0,40}proposta|proposta[^.;]{0,25}\(modelo/i, ultima: true },
  { rotulo: 'validade da proposta', re: /validade (da |de |desta |da sua |de sua )?propost/i },
  { rotulo: 'prazo de envio da proposta', re: /prazo (para|de) (o )?(envio|encaminhamento|apresenta[cç][aã]o) da proposta/i },
  { rotulo: 'proposta adequada ao último lance', re: /(adequad|ajustad|readequad|atualizad)[ao]s? ao [uú]ltimo lance/i },
  { rotulo: 'campos da proposta no sistema', re: /preenchimento[^.;]{0,40}(sistema|campos)|seguintes campos/i },
  { rotulo: 'casas decimais', re: /casas decimais/i },
  { rotulo: 'catálogo / prospecto / ficha técnica', re: /cat[aá]logos?|prospectos?|folders?|ficha t[eé]cnica/i },
  { rotulo: 'registro ANVISA', re: /registro[^.;]{0,40}(anvisa|minist[eé]rio da sa[uú]de)/i },
  { rotulo: 'carta de solidariedade', re: /carta de solidariedade/i },
];

export function preLeitura(docs: Documento[], limite = 9000) {
  const blocos: string[] = [];
  for (const p of PISTAS) {
    for (const d of docs) {
      const plano = d.texto.replace(/\s+/g, ' ');
      const g = new RegExp(p.re.source, 'gi'); let m: RegExpExecArray | null; let alvo: number | null = null;
      while ((m = g.exec(plano))) { alvo = m.index; if (!p.ultima) break; }
      if (alvo == null) continue;
      blocos.push(`[${p.rotulo}] ${d.nome}, posição ${alvo}: ${plano.slice(Math.max(0, alvo - 150), alvo + (p.ultima ? 1500 : 550))}`);
      break;
    }
  }
  let out = ''; for (const b of blocos) { if (out.length + b.length > limite) break; out += b + '\n\n'; }
  return out;
}

export function buscarNosDocumentos(docs: Documento[], topicosPedidos: string[]) {
  const topicos = topicosPedidos.slice(0, 6);
  const trechos: { arquivo: string; topico: string; posicao: number; trecho: string }[] = [];
  const ocorrencias: { topico: string; arquivo: string; posicoes: number[] }[] = [];
  for (const t of topicos) {
    for (const d of docs) {
      const plano = d.texto.replace(/\s+/g, ' '); const posicoes = acharTodas(norm(plano), norm(t));
      if (!posicoes.length) continue;
      ocorrencias.push({ topico: t, arquivo: d.nome, posicoes: posicoes.slice(0, 30) });
      for (const i of posicoes.slice(0, 2)) trechos.push({ arquivo: d.nome, topico: t, posicao: i, trecho: plano.slice(Math.max(0, i - 200), i + 600) });
    }
  }
  return { arquivos: docs.map(d => ({ nome: d.nome, caracteres: d.texto.length })), ocorrencias, trechos: trechos.slice(0, 12) };
}

export function lerTrecho(docs: Documento[], arquivo: string, posicao: number, tamanho?: number) {
  const d = docs.find(x => x.nome === arquivo);
  if (!d) return { erro: `arquivo desconhecido; use um destes: ${docs.map(x => x.nome).join(', ')}` };
  const plano = d.texto.replace(/\s+/g, ' ');
  const de = Math.max(0, Math.floor(posicao)); const ate = de + Math.min(Math.max(Number(tamanho) || 2000, 200), 4000);
  return { arquivo: d.nome, posicao: de, trecho: plano.slice(de, ate), ...(ate < plano.length ? { proxima_posicao: ate } : {}) };
}

export function registrarRegra(docs: Documento[], regras: RegraProposta[], a: { campo: Campo; valor: string; citacao: string }) {
  const doc = docs.find(d => verifyQuote(a.citacao, d.texto).found);
  if (!doc) return { aceito: false, motivo: `citação rejeitada: ${verifyQuote(a.citacao, docs.map(d => d.texto).join(' ')).reason}. Copie o trecho literal.` };
  const assunto = ASSUNTO[a.campo];
  if (assunto && !assunto.re.test(norm(a.citacao))) return { aceito: false, motivo: `a citação não fala de ${assunto.nome}; registre só o que o trecho diz.` };
  if (!regras.some(r => r.campo === a.campo && r.citacao === a.citacao)) {
    regras.push({ campo: a.campo, valor: a.valor, citacao: a.citacao, fonte: { nome: doc.nome, url: doc.url } });
  }
  return { aceito: true, arquivo: doc.nome };
}

export const lacunasDe = (regras: RegraProposta[]) => {
  const citados = new Set(regras.map(x => x.campo));
  return CAMPOS_ESSENCIAIS.filter(c => !citados.has(c));
};

export const PARAMETROS_REGRA: Record<string, Schema> = {
  campo: { type: 'string', enum: [...CAMPOS] },
  valor: { type: 'string', description: 'a regra em poucas palavras, ex.: "120 dias corridos, contados da abertura"' },
  citacao: { type: 'string' },
};

export function ferramentasRegras(): Tool[] {
  return [
    {
      name: 'ler_documentos',
      description: 'Procura até 6 tópicos em todos os documentos do pregão (edital, termo de referência, anexos). Devolve os primeiros trechos e as posições de todas as ocorrências; abra outras com ler_trecho.',
      parameters: { type: 'object', required: ['topicos'], properties: { topicos: { type: 'array', items: { type: 'string' } } } },
      async run(a, ctx) { return buscarNosDocumentos(E(ctx).documentos, a.topicos); },
    },
    {
      name: 'ler_trecho',
      description: 'Lê o texto de um documento a partir de uma posição (as posições vêm de ler_documentos). Use para ler um modelo de proposta inteiro.',
      parameters: { type: 'object', required: ['arquivo', 'posicao'], properties: {
        arquivo: { type: 'string' }, posicao: { type: 'number' }, tamanho: { type: 'number', description: 'padrão 2000, máximo 4000' } } },
      async run(a, ctx) { return lerTrecho(E(ctx).documentos, a.arquivo, a.posicao, a.tamanho); },
    },
    {
      name: 'registrar_regra',
      description: 'Registra uma regra de apresentação da proposta. A citação precisa ser um trecho literal de um dos documentos; ela é conferida.',
      parameters: { type: 'object', required: ['campo', 'valor', 'citacao'], properties: { ...PARAMETROS_REGRA } },
      async run(a, ctx) { const st = E(ctx); return registrarRegra(st.documentos, st.regras, a); },
    },
  ];
}

const SYSTEM = `Você extrai, dos documentos de um pregão eletrônico, as regras de como a proposta de preços deve ser apresentada.
A mensagem do usuário já traz trechos pré-selecionados das cláusulas mais prováveis. Comece registrando o que eles mostram.
Para completar, use ler_documentos com no máximo 6 tópicos por vez e ler_trecho para abrir uma posição (por exemplo, o modelo de proposta inteiro).
Registre cada regra assim que encontrá-la, chamando registrar_regra com:
- campo: modelo_proposta (há anexo de modelo? qual), validade_proposta (dias e de quando conta), prazo_envio (prazo da proposta ajustada ao último lance), forma_envio (sistema, e-mail, formato), colunas_itens (colunas da tabela de itens), casas_decimais, dados_empresa (dados exigidos do licitante e do representante), declaracoes (uma por declaração exigida no documento), documentos_anexos (catálogo, ficha técnica, carta de solidariedade, amostra), marca_fabricante, registro_anvisa, dados_bancarios, assinatura, quantidade (regras de quantidade cotada), outro.
- valor: a regra em poucas palavras, com números exatos.
- citacao: trecho literal, copiado do documento, com pelo menos 20 caracteres.
Só registre o que está escrito: o valor diz apenas o que a citação diz. Não deduza regra de lei, de outro edital ou de outra cláusula. Se a citação for recusada, copie o trecho de novo a partir do texto devolvido.
Não faça mais de 8 leituras. Ao terminar, responda em uma frase quantas regras registrou.`;

const RELEVANTE = /edital|termo de refer|anexo|proposta|modelo|planilha|lista de itens/i;
const IRRELEVANTE = /estudo t[eé]cnico|\betp\b|parecer|aviso|minuta d[ae] (ata|contrato)|^ata\b/i;

export async function carregarDocumentos(tenderId: string): Promise<Documento[]> {
  const [cnpj, ano, seq] = tenderId.split('/');
  const files = (await pncp.files(cnpj, Number(ano), Number(seq)))
    .filter((f: any) => RELEVANTE.test(`${f.tipo} ${f.titulo}`) && !IRRELEVANTE.test(f.titulo ?? ''));
  const docs: Documento[] = [];
  for (const f of files.slice(0, 6)) {
    const r = await pdf.fromUrl(f.url);
    docs.push({ nome: f.titulo || f.tipo, url: f.url, texto: r.text ?? '' });
  }
  return docs;
}

export async function extrairRegrasProposta(o: {
  tenderId: string; llm: LLM; carregar?: (id: string) => Promise<Documento[]>; maxSteps?: number; onEvent?: (e: TraceEvent) => void;
}): Promise<ResultadoRegras> {
  const todos = await (o.carregar ?? carregarDocumentos)(o.tenderId);
  const documentos = todos.filter(d => d.texto.trim().length > 0);
  const arquivos = todos.map(d => d.nome);
  if (!documentos.length) {
    return { tenderId: o.tenderId, legivel: false, motivo: 'nenhum documento do pregão com texto (ZIP, escaneado ou ausente)', arquivos,
      regras: [], lacunas: [...CAMPOS_ESSENCIAIS], usage: { prompt_tokens: 0, completion_tokens: 0, cost: 0 }, ms: 0, trace: [] };
  }
  const state: Estado = { documentos, regras: [] };
  const r = await runAgent({
    llm: o.llm, tools: ferramentasRegras(), system: SYSTEM, state, maxSteps: o.maxSteps ?? 25, onEvent: o.onEvent,
    user: `Pregão ${o.tenderId}. Documentos disponíveis: ${documentos.map(d => `${d.nome} (${d.texto.length} caracteres)`).join('; ')}.\n\nTrechos pré-selecionados:\n${preLeitura(documentos)}\nExtraia as regras da proposta.`,
  });
  return { tenderId: o.tenderId, legivel: true, arquivos, regras: state.regras, lacunas: lacunasDe(state.regras),
    usage: r.usage, ms: r.ms, stopped: r.stopped, trace: r.trace };
}
