// Monta o documento da proposta de preços a partir das regras citadas do edital, das decisões e dos dados da empresa.
// Sem modelo: o que não tem dado vira [preencher] e entra nas pendências; o que o edital não diz entra nas lacunas.
import { lacunasDe, type Campo, type RegraProposta } from './regras-proposta.ts';

export type EmpresaProposta = {
  nome: string; cnpj?: string; endereco?: string; telefone?: string; email?: string; porte?: string; inscricaoEstadual?: string;
  representante?: { nome?: string; cargo?: string; cpf?: string; rg?: string };
  banco?: { banco?: string; agencia?: string; conta?: string };
};
export type ItemProposta = {
  numero: number; descricao: string; unidade?: string; quantidade: number;
  marca: string; modelo?: string; fabricante?: string; registroAnvisa: string; precoUnitario: number;
};
export type PregaoProposta = { id: string; orgao: string; municipio?: string; uf?: string; abertura?: string };
export type DocumentoProposta = {
  markdown: string; colunas: string[]; casasDecimais: number; total: number;
  pendencias: string[]; lacunas: Campo[]; anexos: string[]; declaracoesNoSistema: string[];
};

const PREENCHER = '[preencher]';
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const celula = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
const doCampo = (regras: RegraProposta[], campo: Campo) => regras.filter(r => r.campo === campo);
const noSistema = (r: RegraProposta) => /campo proprio do sistema|no sistema|sistema eletronico/.test(norm(`${r.valor} ${r.citacao}`));

type Chave = 'numero' | 'descricao' | 'unidade' | 'quantidade' | 'marca_modelo' | 'marca' | 'fabricante' | 'modelo' | 'registro' | 'unitario' | 'total';
/** A ordem importa: "valor total" é total antes de ser valor; "unitário" não é unidade. */
const COLUNAS: { chave: Chave; re: RegExp }[] = [
  { chave: 'total', re: /total/ },
  { chave: 'unitario', re: /unit|^(valor|preco)( r\$)?$|^r\$$/ },
  { chave: 'registro', re: /registro|anvisa/ },
  { chave: 'marca_modelo', re: /marca ?\/ ?modelo|marca e modelo/ },
  { chave: 'marca', re: /marca/ },
  { chave: 'fabricante', re: /fabrica/ },
  { chave: 'modelo', re: /modelo/ },
  { chave: 'quantidade', re: /^qt|quant/ },
  { chave: 'unidade', re: /^un(d|id|\.)?\b|unidade|^u\.? ?m\.?$|medida/ },
  { chave: 'descricao', re: /descri|especifica|objeto|produto|discrimina/ },
  { chave: 'numero', re: /^(item|itens|lote|n[ºo°.]?|numero|seq)\b/ },
];
const chaveDe = (titulo: string) => COLUNAS.find(c => c.re.test(norm(titulo)))?.chave ?? null;

const PADRAO = ['Item', 'Descrição', 'Unidade', 'Quantidade', 'Marca', 'Fabricante', 'Registro ANVISA', 'Valor unitário (R$)', 'Valor total (R$)'];

function separarColunas(valor: string) {
  const semPrefixo = valor.includes(':') ? valor.slice(valor.indexOf(':') + 1) : valor;
  return semPrefixo.split(/[,;]| e (?=[a-záéíóúâêôãõç])/i).map(s => s.replace(/\.$/, '').trim()).filter(s => s.length > 0 && s.length < 40);
}

/** Prefere a tabela do modelo de proposta à lista de campos do sistema; entre elas, a com mais colunas reconhecidas. */
export function escolherColunas(regras: RegraProposta[]) {
  const candidatas = doCampo(regras, 'colunas_itens').map(r => ({ regra: r, colunas: separarColunas(r.valor) }))
    .filter(c => c.colunas.length >= 2)
    .map(c => ({ ...c, reconhecidas: c.colunas.filter(t => chaveDe(t)).length, sistema: /^sistema/i.test(c.regra.valor.trim()) || noSistema(c.regra) }))
    .sort((a, b) => Number(a.sistema) - Number(b.sistema) || b.reconhecidas - a.reconhecidas);
  const escolhida = candidatas[0];
  const colunas = escolhida ? [...escolhida.colunas] : [...PADRAO];
  const tem = (k: Chave[]) => colunas.some(t => k.includes(chaveDe(t)!));
  if (!tem(['numero'])) colunas.unshift('Item');
  if (!tem(['descricao'])) colunas.splice(1, 0, 'Descrição');
  if (doCampo(regras, 'marca_fabricante').length && !tem(['marca', 'marca_modelo'])) colunas.push('Marca');
  if (doCampo(regras, 'registro_anvisa').length && !tem(['registro'])) colunas.push('Registro ANVISA');
  if (!tem(['unitario'])) colunas.push('Valor unitário (R$)');
  if (!tem(['total'])) colunas.push('Valor total (R$)');
  return { colunas, doEdital: !!escolhida };
}

const EXTENSO: Record<string, number> = { uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4 };
export function casasDecimaisDe(regras: RegraProposta[]) {
  for (const r of doCampo(regras, 'casas_decimais')) {
    const t = norm(`${r.valor} ${r.citacao}`);
    const m = /(\d)\s*(\(\w+\)\s*)?casas/.exec(t) ?? /(\d)/.exec(norm(r.valor));
    if (m) return Number(m[1]);
    const palavra = Object.keys(EXTENSO).find(p => new RegExp(`\\b${p}\\b[^.]{0,15}casas`).test(t));
    if (palavra) return EXTENSO[palavra];
  }
  return 2;
}

const arred = (n: number, casas: number) => Math.round(n * 10 ** casas) / 10 ** casas;
const dinheiro = (n: number, casas: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Dados que o edital pede do licitante; razão social e CNPJ sempre entram. */
const DADOS: { rotulo: string; re: RegExp; valor: (e: EmpresaProposta) => string | undefined }[] = [
  { rotulo: 'Razão social', re: /./, valor: e => e.nome },
  { rotulo: 'CNPJ', re: /./, valor: e => e.cnpj },
  { rotulo: 'Inscrição estadual', re: /inscricao estadual|\bie\b/, valor: e => e.inscricaoEstadual },
  { rotulo: 'Endereço', re: /endere[cç]o(?! eletr)|sede|estabelecid/, valor: e => e.endereco },
  { rotulo: 'Telefone', re: /telefone|fone/, valor: e => e.telefone },
  { rotulo: 'E-mail', re: /e-?mail|eletronico/, valor: e => e.email },
  { rotulo: 'Representante legal', re: /representante|responsavel|socio|procurador/, valor: e => e.representante?.nome },
  { rotulo: 'Cargo', re: /cargo|funcao|qualifica/, valor: e => e.representante?.cargo },
  { rotulo: 'RG', re: /\brg\b|identidade|\bci\b/, valor: e => e.representante?.rg },
  { rotulo: 'CPF', re: /cpf/, valor: e => e.representante?.cpf },
];

export function gerarDocumentoProposta(o: {
  pregao: PregaoProposta; empresa: EmpresaProposta; itens: ItemProposta[]; regras: RegraProposta[]; hoje: Date;
}): DocumentoProposta {
  const { pregao, empresa, itens, regras } = o;
  const pendencias: string[] = [];
  const pendente = (p: string) => { if (!pendencias.includes(p)) pendencias.push(p); return PREENCHER; };
  const casas = casasDecimaisDe(regras);
  const { colunas, doEdital } = escolherColunas(regras);
  const linhas: string[] = [];
  const add = (...l: string[]) => linhas.push(...l);

  add('# PROPOSTA DE PREÇOS', '');
  add(`**Ao(À) ${pregao.orgao}**${pregao.municipio ? ` — ${pregao.municipio}${pregao.uf ? `/${pregao.uf}` : ''}` : ''}  `);
  add(`**Pregão eletrônico** — PNCP ${pregao.id}${pregao.abertura ? `, sessão em ${pregao.abertura.replace('T', ' às ')}` : ''}`, '');
  const modelo = doCampo(regras, 'modelo_proposta')[0];
  if (modelo) add(`_Elaborada conforme ${modelo.valor}._`, '');

  add('## 1. Dados da proponente', '');
  const pedidos = norm(doCampo(regras, 'dados_empresa').map(r => `${r.valor} ${r.citacao}`).join(' '));
  for (const d of DADOS) {
    const exigido = d.rotulo === 'Razão social' || d.rotulo === 'CNPJ' || (pedidos ? d.re.test(pedidos) : d.rotulo === 'Endereço');
    if (!exigido) continue;
    add(`- **${d.rotulo}:** ${d.valor(empresa) || pendente(`dado da empresa: ${d.rotulo}`)}`);
  }
  if (empresa.porte) add(`- **Porte:** ${empresa.porte}`);
  add('');

  add('## 2. Itens cotados', '');
  if (!doEdital) pendente('colunas da tabela não especificadas no edital; conferir com o modelo do órgão');
  add(`| ${colunas.map(celula).join(' | ')} |`, `| ${colunas.map(() => '---').join(' | ')} |`);
  let total = 0;
  for (const it of itens) {
    const unit = arred(it.precoUnitario, casas);
    const subtotal = arred(unit * it.quantidade, casas);
    total += subtotal;
    const valor = (titulo: string): string => {
      switch (chaveDe(titulo)) {
        case 'numero': return String(it.numero);
        case 'descricao': return it.descricao;
        case 'unidade': return it.unidade || pendente(`item ${it.numero}: unidade de fornecimento`);
        case 'quantidade': return String(it.quantidade);
        case 'marca_modelo': return `${it.marca} / ${it.modelo || pendente(`item ${it.numero}: modelo`)}`;
        case 'marca': return it.marca;
        case 'fabricante': return it.fabricante || pendente(`item ${it.numero}: fabricante`);
        case 'modelo': return it.modelo || pendente(`item ${it.numero}: modelo`);
        case 'registro': return it.registroAnvisa;
        case 'unitario': return dinheiro(unit, casas);
        case 'total': return dinheiro(subtotal, casas);
        default: return pendente(`coluna "${titulo}" sem dado correspondente`);
      }
    };
    add(`| ${colunas.map(t => celula(valor(t))).join(' | ')} |`);
  }
  if (!itens.length) pendente('nenhum item viável para cotar');
  add('', `**Valor global da proposta: R$ ${dinheiro(arred(total, casas), casas)}**`, '');

  add('## 3. Condições', '');
  const validade = doCampo(regras, 'validade_proposta');
  add(`- **Validade da proposta:** ${validade.length ? validade.map(r => r.valor).join('; ') : 'não especificada no edital (conferir)'}.`);
  for (const r of doCampo(regras, 'quantidade')) add(`- **Quantidade:** ${r.valor}.`);
  for (const r of doCampo(regras, 'marca_fabricante')) add(`- **Marca e fabricante:** ${r.valor}.`);
  if (doCampo(regras, 'registro_anvisa').length) add(`- **Registro na ANVISA:** informado por item na tabela acima.`);
  add('- Nos preços estão incluídos todos os custos e despesas diretos e indiretos, tributos, encargos, frete e demais ônus para o fornecimento.', '');

  const declaracoes = doCampo(regras, 'declaracoes');
  const noDocumento = declaracoes.filter(r => !noSistema(r));
  if (noDocumento.length) {
    add('## 4. Declarações', '', 'A proponente declara:', '');
    for (const r of noDocumento) add(`- ${r.valor.replace(/^declara(ção)?( de)?( que)?\s*/i, '')}.`);
    add('');
  }

  if (doCampo(regras, 'dados_bancarios').length) {
    add('## 5. Dados bancários', '');
    add(`- **Banco:** ${empresa.banco?.banco || pendente('dado bancário: banco')}`);
    add(`- **Agência:** ${empresa.banco?.agencia || pendente('dado bancário: agência')}`);
    add(`- **Conta corrente:** ${empresa.banco?.conta || pendente('dado bancário: conta')}`, '');
  }

  const data = o.hoje.toLocaleDateString('pt-BR', { timeZone: 'America/Recife', day: '2-digit', month: 'long', year: 'numeric' });
  add('---', '', `${pregao.municipio ?? PREENCHER}, ${data}.`, '', '', '______________________________________');
  add(empresa.representante?.nome || pendente('dado da empresa: Representante legal'));
  add([empresa.representante?.cargo, empresa.representante?.cpf ? `CPF ${empresa.representante.cpf}` : null].filter(Boolean).join(' — ') || PREENCHER);
  add(empresa.nome);
  for (const r of doCampo(regras, 'assinatura')) add('', `_Assinatura: ${r.valor}._`);
  add('');

  const lacunas = lacunasDe(regras);
  const anexos = doCampo(regras, 'documentos_anexos').map(r => r.valor);
  const declaracoesNoSistema = declaracoes.filter(noSistema).map(r => r.valor);
  add('---', '', '## Conferência antes do envio (não faz parte da proposta)', '');
  const lista = (titulo: string, itensLista: string[], vazio: string) => {
    add(`**${titulo}**`, '');
    if (itensLista.length) for (const i of itensLista) add(`- ${i}`); else add(`- ${vazio}`);
    add('');
  };
  lista('Prazo e forma de envio', [...doCampo(regras, 'prazo_envio'), ...doCampo(regras, 'forma_envio')].map(r => r.valor), 'não especificados no edital');
  lista('Documentos a anexar com a proposta', anexos, 'nenhum exigido no edital');
  lista('Declarações a marcar no sistema', declaracoesNoSistema, 'nenhuma identificada');
  lista('Outras regras', doCampo(regras, 'outro').map(r => r.valor), 'nenhuma');
  lista('Campos essenciais que o edital não especifica', lacunas, 'nenhum');
  lista('Pendências para completar o documento', pendencias, 'nenhuma');
  add('**Fontes das regras**', '', '| Campo | Regra | Arquivo | Citação |', '| --- | --- | --- | --- |');
  for (const r of regras) add(`| ${r.campo} | ${celula(r.valor)} | ${celula(r.fonte?.nome ?? '')} | ${celula(r.citacao.length > 180 ? r.citacao.slice(0, 180) + '…' : r.citacao)} |`);

  return { markdown: linhas.join('\n') + '\n', colunas, casasDecimais: casas, total: arred(total, casas), pendencias, lacunas, anexos, declaracoesNoSistema };
}
