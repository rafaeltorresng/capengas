import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { Lexer } from 'marked';
import type { Dossier } from './contract.ts';
import { concluirAnalise } from '../lib/experiencia-analise.ts';
import { numerosConferem } from '../lib/regras-proposta.ts';
import { ESTADOS_OPERACIONAIS } from '../lib/operacao.ts';

export class DocumentoError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type Exportacao = { titulo: string; markdown: string; nomeArquivo: string; paisagem: boolean };
const moeda = (v: number | null) => v === null ? 'Não informado' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const positivo = new Set(['disputar', 'disputar_com_pendencia']);
const decisaoLabel: Record<string, string> = { disputar: 'Disputar', disputar_com_pendencia: 'Viável com pendência', nao_disputar: 'Não disputar', escalar: 'Revisão necessária', esclarecer: 'Pedir esclarecimento' };
const faseLabel: Record<string, string> = { proposta_inicial: 'Proposta inicial', proposta_ajustada: 'Proposta ajustada', habilitacao: 'Habilitação', nao_informada: 'Fase não informada' };
const encaixeLabel: Record<string, string> = { atende: 'Atende', nao_atende: 'Não atende', nao_informado: 'Não informado' };
const dataHora = (valor?: string) => valor && Number.isFinite(Date.parse(valor))
  ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short' }).format(new Date(valor)) + ' (Recife)' : 'Não informada';

/** Documento é uma leitura do dossiê persistido, nunca uma nova decisão ou autorização de envio. */
export function prepararDocumento(dossie: Dossier, tipo: 'proposta' | 'relatorio'): Exportacao {
  const nomeArquivo = `lance-${tipo}-${dossie.tender.replace(/[^\w-]/g, '-')}.pdf`;
  if (tipo === 'proposta') {
    const proposta = dossie.proposta;
    if (dossie.reavaliar) throw new DocumentoError(409, 'O edital mudou. Reavalie antes de preparar a proposta.');
    if (dossie.desatualizado) throw new DocumentoError(409, 'Os dados ou as decisões mudaram. Gere uma nova análise antes de preparar a proposta.');
    if (!Array.isArray(proposta?.itens) || !Array.isArray(proposta?.regras)) throw new DocumentoError(409, 'A proposta não possui os dados persistidos necessários para exportação.');
    if (proposta.regras.some(r => !numerosConferem(r.valor, r.citacao))) throw new DocumentoError(409, 'Há um número nas regras que não confere com a citação. Revise o documento.');
    const viaveis = dossie.itens?.filter(i => positivo.has(i.estado)) ?? [];
    if (!proposta?.itens.length || proposta.tender !== dossie.tender || !viaveis.length || viaveis.length !== proposta.itens.length
      || proposta.itens.some(i => !viaveis.some(v => v.item === i.numero && v.descricao === i.descricao && v.quantidade === i.quantidade
        && v.precoUnitario === i.precoUnitario && v.produto?.marca === i.marca && v.produto?.registroAnvisa === i.registroAnvisa
        && Number.isFinite(i.precoUnitario) && i.precoUnitario > 0 && Number.isFinite(i.quantidade) && i.quantidade > 0))) {
      throw new DocumentoError(409, 'Não há proposta atual compatível com as decisões desta análise.');
    }
    const origem = proposta.origemDados === 'sinteticos'
      ? 'Cadastro, catálogo, custos e condições comerciais sintéticos de demonstração. Este arquivo não representa uma empresa real.'
      : 'Dados da proponente conforme cadastro, sem verificação independente de sua autenticidade.';
    const corpo = proposta.markdown.split('## Conferência antes do envio')[0];
    const pendencias = proposta.pendencias.length ? `## Complete antes de utilizar\n\n${proposta.pendencias.map(p => '- ' + p).join('\n')}\n\n` : '';
    return { titulo: 'Proposta de preços - minuta', nomeArquivo, paisagem: true,
      markdown: `# MINUTA PARA REVISÃO E ASSINATURA\n\n${origem}\n\nDocumento não assinado e não enviado. Confira o modelo do órgão, os dados cadastrais e as pendências antes de utilizá-lo. As fontes e o checklist estão no relatório da análise.\n\n${dossie.publicacao && !dossie.publicacao.conferida ? dossie.publicacao.motivo : ''}\n\n${dossie.operacao?.requerRevisao ? 'Condições operacionais com pendências. Confira entrega, fornecimento, amostra, validade dos produtos e pagamento no relatório antes de utilizar esta minuta.' : ''}\n\nAnálise: ${dossie.analiseId ?? 'legada'} · Dados de ${dataHora(proposta.geradoEm)}.\n\n${pendencias}${corpo}` };
  }
  const itens = dossie.itens ?? [];
  const veredito = concluirAnalise(itens.map(i => ({ estadoCodigo: i.estado })), dossie.reavaliar, dossie.desatualizado, dossie.publicacao?.conferida === false, dossie.escopo?.naoAnalisados.length, dossie.operacao?.requerRevisao);
  const linhas = ['# RELATÓRIO DA ANÁLISE', '', `## ${veredito.titulo}`, '', veredito.detalhe, '',
    `Pregão: ${dossie.tender}`, `Órgão: ${dossie.orgao ?? dossie.pregao}`, `Empresa: ${dossie.empresa ?? 'Não informada'}`,
    `Análise: ${dossie.analiseId ?? 'legada, sem identificador'}`, `Data da análise: ${dataHora(dossie.geradoEm)}`, '',
    'A conclusão se limita aos itens analisados. Não é resultado publicado, homologação nem autorização de envio.', '',
    ...(dossie.reavaliar ? ['**Reavaliação pendente: o edital mudou. Dados anteriores preservados para auditoria.**', ''] : [])];
  if (dossie.desatualizado) linhas.push('**Dados ou decisões alterados após esta análise. Documento anterior bloqueado.**', '');
  for (const item of itens) {
    linhas.push(`## Item ${item.item}`, '', item.descricao, '', `Decisão calculada: ${decisaoLabel[item.estado] ?? 'Não verificada'}`, `Motivos: ${item.motivos.join('; ')}`,
      `Produto: ${item.produto?.nome ?? 'Não identificado'} · Marca: ${item.produto?.marca ?? 'Não informada'}`,
      `Quantidade: ${item.quantidade ?? 'Não informada'} · Preço calculado: ${moeda(item.precoUnitario)} · Total: ${moeda(item.valorTotal)}`,
      `Citações: ${item.validacao.citacoes === 'conferidas' ? 'conferidas no texto' : 'não verificadas'}. Cobertura dos campos: ${item.validacao.cobertura === 'conferida' ? 'conferida' : 'não verificada'}. Conclusão técnica: ${item.validacao.semantica === 'julgamento_modelo' ? 'julgamento do modelo, sujeito à revisão' : 'não verificada'}.`, '');
    for (const a of item.atributos) linhas.push(`- ${a.atributo}: ${encaixeLabel[a.veredito] ?? 'Não verificado'}`, ...(a.citacao_item ? [`> ${a.citacao_item}`] : []), '');
  }
  if (dossie.operacao) {
    linhas.push('## Condições para fornecer', '', 'Comparações usam o cadastro da análise. Condição registrada não confirma capacidade operacional nem prevê pagamento. Responsável pelas confirmações: analista.', '');
    for (const l of dossie.operacao.linhas) {
      linhas.push(`### ${l.titulo}${l.item !== undefined ? ` — item ${l.item}` : ''}`, '', ESTADOS_OPERACIONAIS[l.estado], l.detalhe, '');
      for (const c of l.citacoes) linhas.push(`> ${c.citacao}`, `Fonte: ${c.fonte.nome} - ${c.fonte.url}`, '');
    }
  } else linhas.push('## Condições para fornecer', '', 'Esta análise não registrou conferência operacional. Não presumir compatibilidade.', '');
  linhas.push('## Pendências', '', ...(dossie.pendencias.length ? dossie.pendencias.map(p => '- ' + p) : ['Nenhuma pendência documental registrada. Isso não substitui a conferência das evidências.']), '');
  if (dossie.planoDocumentos) {
    linhas.push('## Documentos e responsáveis', '');
    for (const l of dossie.planoDocumentos.linhas) linhas.push(`### ${l.documento}`, '', `${l.rotulo} · Responsável: ${{ lance: 'Lance', humano: 'Sua equipe', terceiro: 'Fabricante' }[l.responsavel]} · Fase: ${faseLabel[l.fase]}`,
      l.acao, ...(l.prazo ? [`Prazo citado: ${l.prazo}`] : []), ...(l.citacao ? [`> ${l.citacao}`] : []), ...(l.fonte ? [`Fonte: ${l.fonte.nome} - ${l.fonte.url}`] : []), '');
  }
  linhas.push('## Fontes', '', `Publicação no PNCP: https://pncp.gov.br/app/editais/${dossie.tender}`, '');
  for (const r of dossie.proposta?.regras ?? []) linhas.push(`### ${r.campo}`, `> ${r.citacao}`, `Fonte: ${r.fonte?.nome ?? 'Não informada'} - ${r.fonte?.url ?? 'Não informada'}`, '');
  for (const f of dossie.documentos) linhas.push(`${f.nome}: ${f.url}`, ...(f.citacao ? [`> ${f.citacao}`] : []), '');
  linhas.push('## Origem e limites', '', 'A análise usa os dados e evidências registrados no Lance. No cadastro atual, empresa, catálogo, fichas, custos e política são sintéticos, conforme a identificação da demonstração. Registros ANVISA e publicações PNCP têm fontes próprias. Cobertura não conferida exige revisão. Nenhum documento assina ou envia uma proposta.');
  return { titulo: 'Relatório da análise', markdown: linhas.join('\n\n'), nomeArquivo, paisagem: false };
}

const texto = (raw: string) => raw.replace(/\*\*|__/g, '').replace(/\\\|/g, '|').replace(/(^|\s)_([^_]+)_($|\s)/g, '$1$2$3');
/** PDF real, paginado no servidor. Não executa HTML nem interpreta conteúdo do edital como código. */
export async function renderizarPdf(arquivo: Exportacao): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: arquivo.paisagem ? 'landscape' : 'portrait', margin: 48,
    bufferPages: true, info: { Title: arquivo.titulo, Author: 'Lance', Subject: 'Documento de trabalho baseado em análise persistida' } });
  const chunks: Buffer[] = [];
  const pronto = new Promise<Buffer>((resolve, reject) => { doc.on('data', chunk => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  doc.registerFont('Corpo', fileURLToPath(new URL('./fonts/DejaVuSans.ttf', import.meta.url)));
  doc.registerFont('Titulo', fileURLToPath(new URL('./fonts/DejaVuSans-Bold.ttf', import.meta.url)));
  doc.font('Corpo').fontSize(10).fillColor('#252525');
  for (const token of Lexer.lex(arquivo.markdown)) {
    if (token.type === 'space') continue;
    if (token.type === 'heading') {
      // Reserva também o começo do conteúdo: título isolado no rodapé prejudica a conferência.
      const altura = token.depth === 1 ? 90 : token.depth === 2 ? 80 : 65;
      if (doc.y + altura > doc.page.height - 64) doc.addPage();
      doc.moveDown(0.5).font('Titulo').fontSize(token.depth === 1 ? 21 : token.depth === 2 ? 14 : 11).text(texto(token.text)).moveDown(0.5);
      doc.font('Corpo').fontSize(10);
    } else if (token.type === 'table') {
      doc.fontSize(8);
      const cabecalho: string[] = token.header.map((c: { text: string }) => texto(c.text));
      const largura = doc.page.width - 96;
      const pesos = cabecalho.map(c => /descri|especific|cita|regra/i.test(c) ? 4.5 : /^item$/i.test(c) ? 0.7 : /qtd|quantidade/i.test(c) ? 1.1 : /^un/i.test(c) ? 0.9 : 1.3);
      const soma = pesos.reduce((a, b) => a + b, 0);
      const colunas = pesos.map(p => largura * p / soma);
      const altura = (linha: string[]) => Math.max(...linha.map((c, i) => doc.heightOfString(c, { width: Math.max(20, colunas[i] - 10) }))) + 12;
      const maximo = doc.page.height - 96;
      const alturaCabecalho = altura(cabecalho);
      let bloco: string[][] = [];
      let usado = alturaCabecalho;
      const gravar = () => {
        if (!bloco.length) return;
        doc.x = 48;
        doc.table({ data: [cabecalho, ...bloco], columnStyles: colunas,
          rowStyles: index => index === 0 ? { backgroundColor: '#eeeeee', border: [0, 0, 1, 0] } : { border: [0, 0, 0.3, 0], borderColor: '#dddddd' }, defaultStyle: { padding: 5 } });
        bloco = []; usado = alturaCabecalho;
      };
      for (const row of token.rows as { text: string }[][]) {
        const linha = row.map(c => texto(c.text));
        const h = altura(linha);
        if (h + alturaCabecalho > maximo) {
          // Uma célula maior que a página não pode ser elidida pela biblioteca de tabelas.
          // Preserva todo o conteúdo em blocos rotulados, que fluem entre as páginas.
          gravar(); doc.moveDown();
          for (const [i, valor] of linha.entries()) {
            doc.font('Titulo').fontSize(9).text(cabecalho[i] + ':');
            doc.font('Corpo').fontSize(9).text(valor, { paragraphGap: 6, lineGap: 2 });
          }
          doc.fontSize(8); usado = alturaCabecalho;
        } else {
          if (doc.y + usado + h > doc.page.height - 48) { gravar(); doc.addPage(); }
          bloco.push(linha); usado += h;
        }
      }
      gravar();
      doc.fontSize(10).moveDown();
    } else if (token.type === 'list') {
      for (const item of token.items) doc.text('- ' + texto(item.text), { paragraphGap: 5 });
      doc.moveDown(0.3);
    } else if (token.type === 'hr') {
      const largura = token.raw.trim().startsWith('_') ? 200 : doc.page.width - 96;
      doc.moveTo(48, doc.y).lineTo(48 + largura, doc.y).lineWidth(0.5).strokeColor('#bbbbbb').stroke();
      doc.moveDown(0.5);
    } else {
      const value = 'text' in token && typeof token.text === 'string' ? token.text : token.raw;
      const link = /^(Fonte:|Publicação no PNCP:)/.test(value) ? value.match(/https?:\/\/\S+/)?.[0] : undefined;
      doc.font('Corpo').fontSize(10).text(texto(value), { paragraphGap: 6, lineGap: 2, ...(link ? { link } : {}) });
      doc.moveDown(0.4);
    }
  }
  const pages = doc.bufferedPageRange();
  for (let i = pages.start; i < pages.start + pages.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Corpo').fontSize(8).fillColor('#666666').text(`Lance | Documento de trabalho | ${i + 1} / ${pages.count}`, 48, doc.page.height - 30, { width: doc.page.width - 96, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return pronto;
}
