// Declarações em arquivo. Quando o edital traz o modelo (anexo "MODELO DE DECLARAÇÃO..."), a minuta é esse modelo
// preenchido com o cadastro: só lacunas com rótulo reconhecido e caixas que o cadastro sustenta são tocadas, a
// redação do órgão não muda. Sem modelo, usa a redação legal conferida (Lei 14.133, CF, LC 123). O que o cadastro
// não sustenta (ME/EPP sem porte, integridade sem programa) não é declarado.
import { TIPOS_DOCUMENTO, type TipoDocumento } from './plano-documentos.ts';
import type { Documento } from './regras-proposta.ts';
import type { EmpresaProposta } from './documento-proposta.ts';

export type EmpresaDeclarante = EmpresaProposta & { programaIntegridade?: boolean };
export type ModeloDeclaracao = { tipo: TipoDocumento; titulo: string; texto: string; fonte: { nome: string; url: string } };
export type DeclaracaoGerada = { tipo: TipoDocumento; titulo: string; markdown: string; pendencias: string[] };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
const DECLARACOES: TipoDocumento[] = ['declaracao_me_epp', 'declaracao_menor', 'declaracao_pcd', 'declaracao_custos_trabalhistas',
  'declaracao_integridade', 'declaracao_habilitacao', 'declaracao_pleno_acordo'];
const tiposDe = (texto: string) => DECLARACOES.filter(t => TIPOS_DOCUMENTO[t].assunto.test(norm(texto)));

const LACUNA_LINHA = /_{3,}|\.{4,}|…{2,}|\bx{2,}\b/i;
const ANEXO = /\n\s*(ANEXO\s+[IVXLC]+\b|MODELO DE (DECLARA|PROPOSTA)|MINUTA D|ATA DE REGISTRO DE PRE[ÇC]OS|TERMO DE REFER[ÊE]NCIA\s*\n)/i;
/** Onde começa o título de cada modelo: "MODELO DE DECLARAÇÃO..." ou, logo abaixo de um "ANEXO IV", a linha "DECLARAÇÃO...". */
function cabecalhos(texto: string) {
  const out: { p: number; anexo?: string }[] = [...texto.matchAll(/MODELO DE DECLARA[ÇC][ÃA]O/gi)].map(m => ({ p: m.index! }));
  for (const a of texto.matchAll(/(^|\n)[ \t]*(ANEXO\s+[IVXLC]+)\b[^\n]*/gi)) {
    if (/MODELO DE DECLARA/i.test(a[0])) continue;
    const depois = texto.slice(a.index! + a[0].length, a.index! + a[0].length + 400).split('\n').slice(1, 7);
    let pos = a.index! + a[0].length + 1;
    for (const l of depois) {
      if (/^\s*DECLARA[ÇC][ÃA]O\b/.test(l)) { out.push({ p: pos + l.search(/\S/), anexo: a[2].toUpperCase().replace(/\s+/g, ' ') }); break; }
      pos += l.length + 1;
    }
  }
  return out.sort((x, y) => x.p - y.p);
}

/** Modelos de declaração dos anexos do edital. O sumário ("ANEXO VI – MODELO DE DECLARAÇÃO...") não conta. */
export function extrairModelosDeclaracao(docs: Documento[]): ModeloDeclaracao[] {
  const out: ModeloDeclaracao[] = [];
  for (const d of docs) {
    // Cabeçalho e rodapé de página do órgão se repetem no PDF; não são texto do modelo. Lacuna, data e assinatura ficam.
    const vezes = new Map<string, number>();
    for (const l of d.texto.split('\n')) { const k = l.trim(); if (k.length >= 8) vezes.set(k, (vezes.get(k) ?? 0) + 1); }
    const repetida = (l: string) => (vezes.get(l) ?? 0) >= 3 && !LACUNA_LINHA.test(l) && !/local e data|assinatura|representante|declar|^\(/i.test(l);
    for (const { p, anexo } of cabecalhos(d.texto)) {
      if (/ANEXO\s+[IVXLC]+\b|MODELO DE /i.test(d.texto.slice(p + 20, p + 250))) continue;
      const fim = d.texto.slice(p + 30).search(ANEXO);
      const corpo = d.texto.slice(p, fim < 0 ? Math.min(d.texto.length, p + 6000) : p + 30 + fim);
      // Número de página do PDF não é texto do modelo.
      const linhas = corpo.split('\n').map(l => l.trim()).filter(l => l && !repetida(l) && !/^(p[aá]gina\s*)?\d+(\s*(de|\/)\s*\d+)?$/i.test(l));
      // Título: a linha do cabeçalho e as linhas seguintes em maiúsculas que o continuam ("PEQUENO PORTE (EPP)").
      // Item numerado, rótulo de formulário e referência ao pregão já são corpo.
      let n = 1;
      while (n < linhas.length && linhas[n].length <= 90 && linhas[n] === linhas[n].toUpperCase() && /[A-Z]/.test(linhas[n])
        && !/_{3,}|\.{4,}|PREG[ÃA]O|PROCESSO|^\d|:$/i.test(linhas[n])) n++;
      let titulo = linhas.slice(0, n).join(' ').replace(/^ANEXO\s+[IVXLC]+\s*[-–:]\s*/i, '').replace(/\s+/g, ' ').trim();
      if (anexo && titulo.length <= 15) titulo = `${titulo} (${anexo})`;
      const texto = linhas.slice(n).join('\n');
      if (!/declar/i.test(texto + titulo) || !/cnpj|empresa/i.test(texto)) continue;
      if (out.some(o => norm(o.texto) === norm(texto))) continue;
      const peloTitulo = tiposDe(titulo); const peloTexto = tiposDe(texto);
      const tipo = peloTitulo[0] ?? (peloTexto.length === 1 ? peloTexto[0] : 'declaracao_outra');
      out.push({ tipo, titulo, texto, fonte: { nome: d.nome, url: d.url } });
    }
  }
  return out;
}

/** Junta as linhas quebradas pelo pdftotext; mantém parágrafo depois de ponto ou título, e antes de opção, item, lacuna ou local e data. */
function paragrafos(texto: string) {
  let out = '', ultima = '';
  for (const l of texto.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (!out) { out = ultima = l; continue; }
    const anterior = out.slice(out.lastIndexOf('\n') + 1);
    const titulo = anterior === ultima && ultima.length >= 8 && /[A-ZÀ-Ú]{2}/.test(ultima) && ultima === ultima.toUpperCase();
    // Lacuna pontilhada termina em ponto e não fecha frase; "(data)" e "Ref.:" são linhas próprias.
    const novo = (/[.;:]$/.test(out) && !/\.{4,}$|(^|\n)\d+(\.\d+)*\.$/.test(out)) || titulo || /^(local e data\.?|\([^()]+\)|ref\.?:.*)$/i.test(ultima)
      || /^(\(\s?X?\s?\)|- |\d+[.)] |local e data)/i.test(l) || /^[^\s,.;:]{1,20}( [^\s,.;:]{1,15}){0,3}:(\s|$)/.test(l);
    out += (novo ? '\n\n' : ' ') + l; ultima = l;
  }
  return out;
}

// "[XX.XXX.XXX/XXXX-XX]" é uma lacuna só, não cinco.
const LACUNA = /\[[^\]\n]{0,60}?(x{2,}|_{3,}|\.{4,})[^\]\n]{0,60}?\]|_{3,}|\.{4,}|…{2,}|\bx{2,}\b/gi;
const PREENCHER = '[preencher]';
// "nº", "n.º", "no", "sob o nº", "número", com ou sem dois-pontos.
const NUM = String.raw`( sob o)?( (n\.?[ºo°]?\.?|numero))?\s*:?`;
type Campo = { re: RegExp; rotulo: string; valor: (e: EmpresaDeclarante) => string | undefined };
// A ordem importa: o rótulo mais específico primeiro ("CPF" antes de "representante", "nome do banco" antes de "nome").
const CAMPOS: Campo[] = [
  { re: new RegExp(`\\bcpf(\\/mf)?${NUM}$`), rotulo: 'CPF', valor: e => e.representante?.cpf },
  { re: new RegExp(`\\b(rg|identidade)${NUM}$`), rotulo: 'RG', valor: e => e.representante?.rg },
  { re: new RegExp(`\\bcnpj${NUM}$`), rotulo: 'CNPJ', valor: e => e.cnpj },
  { re: /\b(nome do )?banco\s*:?$/, rotulo: 'banco', valor: e => e.banco?.banco },
  { re: /\bagencia\s*:?$/, rotulo: 'agência', valor: e => e.banco?.agencia },
  { re: /\bcont(r)?a( corrente)?( da empresa)?\s*:?$/, rotulo: 'conta', valor: e => e.banco?.conta },
  { re: /\b(cargo|funcao)((\/| ou )funcao)?\s*:?$/, rotulo: 'cargo', valor: e => e.representante?.cargo },
  { re: /\b(sede|sediada|estabelecida|endereco)( (a|à|na|no|em))?\s*:?$/, rotulo: 'endereço', valor: e => e.endereco },
  { re: /\be-?mail\s*:?$/, rotulo: 'e-mail', valor: e => e.email },
  { re: /\btelefone( para contato)?\s*:?$/, rotulo: 'telefone', valor: e => e.telefone },
  { re: /\binscricao estadual\s*:?$/, rotulo: 'inscrição estadual', valor: e => e.inscricaoEstadual },
  { re: /(representad[ao]( legalmente)? por|representante legal|\beu|\bsr\.? ?\(a\)|\bsra?\.?|nome completo)\s*[:,]?$/, rotulo: 'representante legal', valor: e => e.representante?.nome },
  { re: /(?<!\bd[aeo] )\b(empresa|razao social|proponente|licitante)\s*:?$/, rotulo: 'razão social', valor: e => e.nome },
];

/** Campo pelo rótulo escrito dentro da lacuna ("[NOME COMPLETO DO REPRESENTANTE LEGAL]"). Ordem: o mais específico primeiro. */
const PELO_ROTULO: [RegExp, string][] = [[/\bcpf\b/, 'CPF'], [/\b(rg|identidade)\b/, 'RG'], [/\bcnpj\b/, 'CNPJ'], [/\b(cargo|funcao)\b/, 'cargo'],
  [/\bendereco\b/, 'endereço'], [/\be-?mail\b/, 'e-mail'], [/\btelefone\b/, 'telefone'], [/\binscricao estadual\b/, 'inscrição estadual'],
  [/\b(representante|nome completo)\b/, 'representante legal'], [/\b(razao social|nome da empresa|empresa|licitante)\b/, 'razão social']];

/** Preenche o modelo do edital com o cadastro. Nada é inventado: lacuna sem rótulo ou sem dado vira [preencher]. */
export function preencherModelo(texto: string, empresa: EmpresaDeclarante, hoje: Date) {
  const pendencias: string[] = [];
  const pendente = (p: string) => { if (!pendencias.includes(p)) pendencias.push(p); return PREENCHER; };
  const valorDe = (campo: Campo) => campo.valor(empresa) || pendente(`dado da empresa: ${campo.rotulo}`);
  let t = paragrafos(texto);
  const data = hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Recife', day: 'numeric', month: 'long', year: 'numeric' });
  const local = () => `${empresa.municipio || pendente('local da assinatura')}, ${data}`;
  t = t.replace(/\blocal e data\.?/i, () => `${local()}.`);
  // Lacuna descrita entre colchetes ("[CNPJ DA EMPRESA]", "[A PREENCHER: endereço]", "[Empresa]____"). A de "X"
  // ("[XX.XXX.XXX/XXXX-XX]") e o "[A PREENCHER]" sem rótulo seguem pelo rótulo à esquerda.
  t = t.replace(/\[([^\]\n]{3,150}?)\](_{3,}|\.{4,})?/g, (m, bruto: string) => {
    const dentro = bruto.replace(/^a preencher\s*:?\s*/i, '');
    if (!dentro) return '____';
    const rotulo = PELO_ROTULO.find(([re]) => re.test(norm(dentro)))?.[1];
    if (LACUNA_LINHA.test(dentro) || (!rotulo && (dentro !== dentro.toUpperCase() || !/[A-ZÀ-Ú]{3}/.test(dentro)) && dentro === bruto)) return m;
    const campo = CAMPOS.find(c => c.rotulo === rotulo);
    return campo ? valorDe(campo) : pendente(`preencher ${dentro.replace(/\s+/g, ' ')} conforme o edital`);
  });
  // "____, em __ de ______ de 2026": a linha de local e data inteira.
  const L = `(?:${LACUNA.source})`;
  t = t.replace(new RegExp(`${L}\\s*,\\s*(em\\s+)?${L}\\s*de\\s*${L}\\s*(de\\s*)?(\\d{4}|${L})`, 'gi'), () => local());
  t = t.replace(LACUNA, (m, ...args) => {
    const pos = args.at(-2) as number;
    const depois = norm(t.slice(pos + m.length, pos + m.length + 40)).trimStart();
    if (/^\(data\)/.test(depois)) return local();
    if (/^\(?(representante legal|assinatura|nome e assinatura)/.test(depois)) return '______________________________';
    const antes = norm(t.slice(Math.max(0, pos - 45), pos)).replace(/[\s,]+$/, '');
    const campo = CAMPOS.find(c => c.re.test(antes)) ?? (/^,? ?inscrit[ao]/.test(depois) && !/\w$/.test(antes) ? CAMPOS.find(c => c.rotulo === 'razão social') : undefined);
    if (!campo) return pendente('lacuna sem rótulo reconhecido no modelo; preencher conforme o edital');
    return valorDe(campo);
  });
  // Formulário: parágrafo curto que é só um rótulo terminado em dois-pontos ("NOME COMPLETO:").
  t = t.split('\n\n').map(par => {
    if (par.length > 45 || !par.endsWith(':') || /\d+\.\s|\bque\b/i.test(par)) return par;
    const campo = CAMPOS.find(c => c.re.test(norm(par)));
    return `${par} ${campo ? valorDe(campo) : pendente('lacuna sem rótulo reconhecido no modelo; preencher conforme o edital')}`;
  }).join('\n\n');
  // Caixas de opção: só a de ME/EPP é marcada, e só quando o porte do cadastro sustenta. As demais ficam para o humano.
  t = t.replace(/\(\s?\)/g, (m, pos: number) => {
    const resto = t.slice(pos + m.length);
    const proxima = resto.search(/\(\s?X?\s?\)/i);
    const opcao = norm(proxima < 0 ? resto.slice(0, 200) : resto.slice(0, proxima));
    const micro = /microempre|\bme\b/.test(opcao), pequeno = /pequeno porte|\bepp\b/.test(opcao);
    if (!micro && !pequeno) { pendente('marcar as opções do modelo que se aplicam à empresa'); return '( )'; }
    const marca = micro && pequeno ? ['ME', 'EPP', 'MEI'].includes(empresa.porte ?? '') : micro ? empresa.porte === 'ME' : empresa.porte === 'EPP';
    if (!empresa.porte) pendente('porte da empresa: marcar a opção de ME/EPP só se for verdade');
    return marca ? '(X)' : '( )';
  });
  return { texto: t, pendencias };
}

const LEI = 'Lei nº 14.133, de 1º de abril de 2021';
/** Redação legal para quando o edital pede a declaração e não traz modelo. Referências conferidas no texto da lei. */
const LEGAL: Partial<Record<TipoDocumento, (e: EmpresaDeclarante) => string>> = {
  declaracao_me_epp: e => `enquadra-se como ${e.porte === 'ME' ? 'microempresa' : 'empresa de pequeno porte'} e cumpre os requisitos estabelecidos no art. 3º da Lei Complementar nº 123, de 14 de dezembro de 2006, estando apta a usufruir do tratamento favorecido estabelecido em seus arts. 42 a 49, observado o disposto nos §§ 1º a 3º do art. 4º da ${LEI}.`,
  declaracao_menor: () => 'não emprega menor de 18 (dezoito) anos em trabalho noturno, perigoso ou insalubre e não emprega menor de 16 (dezesseis) anos, salvo menor, a partir de 14 (quatorze) anos, na condição de aprendiz, nos termos do art. 7º, XXXIII, da Constituição Federal.',
  declaracao_pcd: () => `cumpre as exigências de reserva de cargos para pessoa com deficiência e para reabilitado da Previdência Social, previstas em lei e em outras normas específicas, conforme o art. 63, IV, da ${LEI}.`,
  declaracao_custos_trabalhistas: () => `suas propostas econômicas compreendem a integralidade dos custos para atendimento dos direitos trabalhistas assegurados na Constituição Federal, nas leis trabalhistas, nas normas infralegais, nas convenções coletivas de trabalho e nos termos de ajustamento de conduta vigentes na data de entrega das propostas, conforme o art. 63, § 1º, da ${LEI}.`,
  declaracao_integridade: () => `desenvolve programa de integridade, nos termos da ${LEI}, e do Decreto nº 12.304, de 2024.`,
  declaracao_habilitacao: () => `atende aos requisitos de habilitação previstos no edital e responde pela veracidade das informações prestadas, na forma da lei, conforme o art. 63, I, da ${LEI}.`,
  declaracao_pleno_acordo: () => 'está ciente e de pleno acordo com todas as condições estabelecidas no edital e em seus anexos.',
};

/** Por que a declaração não pode sair com o cadastro atual; null quando pode. */
export function impedimentoDeclaracao(tipo: TipoDocumento, empresa: Partial<EmpresaDeclarante> | undefined): { status: 'conferir' | 'nao_se_aplica'; motivo: string } | null {
  if (tipo === 'declaracao_me_epp') {
    if (!empresa?.porte) return { status: 'conferir', motivo: 'O cadastro não informa o porte da empresa; só ME ou EPP pode fazer esta declaração.' };
    if (!['ME', 'EPP'].includes(empresa.porte)) return { status: 'nao_se_aplica', motivo: `A empresa tem porte ${empresa.porte}; a declaração é só para ME ou EPP.` };
  }
  if (tipo === 'declaracao_integridade' && empresa?.programaIntegridade !== true) {
    return { status: 'conferir', motivo: 'O cadastro não informa que a empresa desenvolve programa de integridade; só declarar se for verdade.' };
  }
  return null;
}

/** Assuntos que o texto do modelo declara (uma declaração unificada cobre vários). */
export const assuntosDoModelo = (m: ModeloDeclaracao) => tiposDe(m.texto);

/** Há como redigir: modelo do edital ou redação legal conhecida. */
export const temRedacao = (tipo: TipoDocumento, modelo?: ModeloDeclaracao) => !!modelo || !!LEGAL[tipo];

export function gerarDeclaracao(o: {
  tipo: TipoDocumento; modelo?: ModeloDeclaracao; citacao?: string; fonte?: { nome: string; url: string };
  pregao: { id: string; orgao: string }; empresa: EmpresaDeclarante; hoje: Date;
}): DeclaracaoGerada {
  const { tipo, empresa, pregao, modelo } = o;
  const bloqueio = impedimentoDeclaracao(tipo, empresa);
  if (bloqueio) throw new Error(bloqueio.motivo);
  const legal = LEGAL[tipo];
  if (!modelo && !legal) throw new Error('O edital não traz modelo para esta declaração e o Lance não tem redação padrão; redigir conforme o edital.');
  const pendencias: string[] = [];
  const pendente = (p: string) => { if (!pendencias.includes(p)) pendencias.push(p); return PREENCHER; };
  const titulo = modelo?.titulo ?? TIPOS_DOCUMENTO[tipo].nome;
  const linhas: string[] = [`# ${modelo ? titulo : titulo.toUpperCase()}`, ''];
  if (modelo) {
    const r = preencherModelo(modelo.texto, empresa, o.hoje);
    for (const p of r.pendencias) pendente(p);
    linhas.push(r.texto, '');
  } else {
    linhas.push(`**Ao(À) ${pregao.orgao}**  `, `**Pregão eletrônico** — PNCP ${pregao.id}`, '');
    linhas.push(`A ${empresa.nome}, inscrita no CNPJ sob o nº ${empresa.cnpj || pendente('dado da empresa: CNPJ')}, por intermédio de seu representante legal, ${empresa.representante?.nome || pendente('dado da empresa: representante legal')}, DECLARA, para os fins do pregão acima, que ${legal!(empresa)}`, '');
    const data = o.hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Recife', day: 'numeric', month: 'long', year: 'numeric' });
    linhas.push(`${empresa.municipio || pendente('local da assinatura')}, ${data}.`, '', '', '______________________________________',
      empresa.representante?.nome || PREENCHER, [empresa.representante?.cargo, empresa.representante?.cpf ? `CPF ${empresa.representante.cpf}` : null].filter(Boolean).join(' — ') || PREENCHER, empresa.nome, '');
  }
  linhas.push('## Exigência do edital', '');
  if (o.citacao) linhas.push(`> ${o.citacao.replace(/\s+/g, ' ')}`, '');
  if (o.fonte) linhas.push(`Fonte: ${o.fonte.nome} - ${o.fonte.url}`, '');
  if (modelo) linhas.push(`Modelo do edital: ${modelo.fonte.nome} - ${modelo.fonte.url}`, '');
  return { tipo, titulo, markdown: linhas.join('\n') + '\n', pendencias };
}
