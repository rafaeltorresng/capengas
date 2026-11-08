// O modelo localiza cláusulas. O código confere a fonte, extrai durações e compara bases explícitas.
import { verifyQuote } from './rules.ts';
import type { Documento } from './regras-proposta.ts';
import type { LanceState } from './tools.ts';

export const CAMPOS_OPERACIONAIS = ['entrega', 'fornecimento', 'amostra', 'validade_produto', 'pagamento'] as const;
export type CampoOperacional = typeof CAMPOS_OPERACIONAIS[number];
export const TITULOS_OPERACIONAIS: Record<CampoOperacional, string> = {
  entrega: 'Prazo de entrega', fornecimento: 'Forma e local de fornecimento', amostra: 'Amostra',
  validade_produto: 'Validade dos produtos', pagamento: 'Condições de pagamento',
};
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
const ASSUNTO: Record<CampoOperacional, RegExp> = {
  entrega: /entrega|fornecimento/, fornecimento: /entrega|fornecimento|almoxarifado|parcelad/,
  amostra: /amostra/, validade_produto: /validade|vencimento/, pagamento: /pagamento|liquidacao|atesto/,
};
export type PerfilEntrega = {
  prazoEntregaDias?: number;
  prazoEntregaUnidade?: 'corridos' | 'uteis';
  prazoEntregaMarco?: 'ordem_fornecimento' | 'nota_empenho' | 'pedido';
};
export type CondicaoOperacional = {
  campo: CampoOperacional; item?: number; citacao: string; fonte: { nome: string; url: string };
};
export type LinhaOperacional = {
  campo: CampoOperacional; titulo: string; item?: number;
  estado: 'compativel' | 'conflito' | 'confirmar' | 'informada' | 'nao_identificada';
  detalhe: string; responsavel: 'analista'; citacoes: CondicaoOperacional[];
};
export type Operacao = { linhas: LinhaOperacional[]; requerRevisao: boolean; pendencias: string[]; perfilEntrega: PerfilEntrega; fontes: Documento[] };
export const ESTADOS_OPERACIONAIS: Record<LinhaOperacional['estado'], string> = {
  compativel: 'Compatível com o cadastro', conflito: 'Conflito com o cadastro', confirmar: 'Precisa confirmar',
  informada: 'Condição registrada', nao_identificada: 'Não identificada na análise',
};

/** Localiza candidatos, sem converter texto em obrigação. Evita ruído de rodapés e validade da proposta/ata. */
export function buscarCondicoesOperacionais(documentos: Documento[]) {
  const pistas: Record<CampoOperacional, RegExp> = {
    entrega: /prazo de entrega|condicoes de entrega|entrega[^.;]{0,35}(?:em|prazo)[^.;]{0,20}\d+/gi,
    fornecimento: /parcelad[ao]|entrega unica|local[^.;]{0,30}entrega|entrega[^.;]{0,30}(?:efetuada|realizada)[^.;]{0,40}(?:no|na)\b/gi,
    amostra: /\bamostras?\b/gi,
    validade_produto: /(?:produtos?|materiais?|lotes?)[^.;]{0,80}validade|validade[^.;]{0,80}(?:produtos?|materiais?|lotes?)/gi,
    pagamento: /prazo de pagamento|pagamento[^.;]{0,50}(?:sera|devera|efetuado|realizado)|liquidacao[^.;]{0,50}(?:prazo|dias)/gi,
  };
  const trechos: { campo: CampoOperacional; arquivo: string; posicao: number; trecho: string }[] = [];
  for (const campo of CAMPOS_OPERACIONAIS) {
    // TR antes do edital como prioridade de leitura, sem descartar os demais arquivos.
    const ordenados = [...documentos].sort((a, b) => Number(/termo de refer/i.test(b.nome)) - Number(/termo de refer/i.test(a.nome)));
    for (const d of ordenados) {
      const plano = d.texto.replace(/\s+/g, ' ');
      const normalizado = norm(plano);
      const candidatos = [...normalizado.matchAll(new RegExp(pistas[campo].source, 'gi'))]
        .filter(m => campo !== 'validade_produto' || !/validade (?:d[ae]s? )?(?:assinaturas|ata|proposta)/.test(normalizado.slice(m.index!, m.index! + m[0].length + 40))).slice(0, 2);
      for (const m of candidatos) {
        const inicio = Math.max(0, m.index! - 100);
        trechos.push({ campo, arquivo: d.nome, posicao: inicio, trecho: plano.slice(inicio, m.index! + 1000) });
      }
    }
  }
  const principais = CAMPOS_OPERACIONAIS.map(c => trechos.find(t => t.campo === c)).filter((t): t is typeof trechos[number] => !!t);
  const selecionados: typeof trechos = [];
  for (const t of [...principais, ...trechos.filter(t => !principais.includes(t))]) {
    if (JSON.stringify([...selecionados, t]).length <= 6500) selecionados.push(t);
  }
  return { arquivos: documentos.map(d => ({ nome: d.nome, caracteres: d.texto.length })), trechos: selecionados };
}

export function registrarCondicao(documentos: Documento[], lista: CondicaoOperacional[],
  a: { campo: string; arquivo: string; citacao: string; item?: number }, itens: number[]) {
  const campo = a.campo as CampoOperacional;
  if (!CAMPOS_OPERACIONAIS.includes(campo)) return { aceito: false, motivo: 'campo operacional desconhecido' };
  if (a.item !== undefined && (!Number.isInteger(a.item) || !itens.includes(a.item))) return { aceito: false, motivo: 'item não consultado neste pregão' };
  const referencias = [...norm(a.citacao).matchAll(/\b(?:item|itens)\s+(\d+)\b/g)].map(m => Number(m[1]));
  if (/\blotes?\s+\d+/.test(norm(a.citacao))) return { aceito: false, motivo: 'a cláusula tem escopo de lote; confirme a correspondência antes de aplicar a um item' };
  if (referencias.length && (a.item === undefined || referencias.some(i => i !== a.item))) return { aceito: false, motivo: 'a cláusula cita item específico; registre separadamente com o item correspondente' };
  const fonte = documentos.find(d => d.nome === a.arquivo && verifyQuote(a.citacao, d.texto).found);
  if (!fonte) return { aceito: false, motivo: 'citação não localizada no arquivo indicado; copie o trecho literal' };
  if (!ASSUNTO[campo].test(norm(a.citacao))) return { aceito: false, motivo: 'a citação não trata desta condição operacional' };
  if (campo === 'validade_produto' && /validade[^.;]{0,30}(?:proposta|assinatura|ata\b)/.test(norm(a.citacao))) return { aceito: false, motivo: 'validade de proposta, ata ou assinatura não é validade do produto' };
  if (!lista.some(c => c.campo === campo && c.item === a.item && c.citacao === a.citacao && c.fonte.url === fonte.url)) {
    lista.push({ campo, ...(a.item !== undefined ? { item: a.item } : {}), citacao: a.citacao, fonte: { nome: fonte.nome, url: fonte.url } });
  }
  return { aceito: true, campo, arquivo: fonte.nome };
}

function entregaDaCitacao(citacao: string) {
  const texto = norm(citacao);
  if (/(?:\d[.,]\d+|\d+\s*[-–/]\s*\d+|-\d+)\s*(?:\([^)]*\)\s*)?dias?/.test(texto)) return null;
  const duracoes = [...texto.matchAll(/\b(\d{1,4})(?:\s*\([^)]{1,35}\))?\s*dias?\s*(uteis|corridos)?\b/g)];
  // Faixas, vários prazos, unidades ausentes e condições continuam para o analista.
  if (duracoes.length !== 1 || !duracoes[0][2] || /se |caso |prorrog|excepc|entre \d|de \d+ a \d/.test(texto)) return null;
  const marcos = [
    /(?:apos|partir|contad|contar)[\s\S]{0,50}recebimento d[ao] ordem de fornecimento/.test(texto) ? 'ordem_fornecimento' : null,
    /(?:apos|partir|contad|contar)[\s\S]{0,50}recebimento d[ao] nota de empenho/.test(texto) ? 'nota_empenho' : null,
    /(?:apos|partir|contad|contar)[\s\S]{0,90}recebimento do pedido/.test(texto) ? 'pedido' : null,
  ].filter(Boolean);
  if (marcos.length !== 1 || /assinatura|publicacao|contrato/.test(texto)) return null;
  const dias = Number(duracoes[0][1]);
  return dias > 0 ? { dias, unidade: duracoes[0][2], marco: marcos[0] } : null;
}

export function avaliarOperacao(condicoes: CondicaoOperacional[], empresa: PerfilEntrega, itens: number[]): Operacao {
  const perfilEntrega: PerfilEntrega = {
    prazoEntregaDias: empresa.prazoEntregaDias, prazoEntregaUnidade: empresa.prazoEntregaUnidade, prazoEntregaMarco: empresa.prazoEntregaMarco,
  };
  const linhas: LinhaOperacional[] = [];
  for (const campo of CAMPOS_OPERACIONAIS) {
    // Com condições específicas, cada item mantém seu próprio resultado. A cláusula geral também continua válida.
    const escopos: (number | undefined)[] = condicoes.some(c => c.campo === campo && c.item !== undefined) && itens.length ? [...new Set(itens)] : [undefined];
    for (const item of escopos) {
      const citacoes = condicoes.filter(c => c.campo === campo && (c.item === undefined || c.item === item));
      let estado: LinhaOperacional['estado'] = 'nao_identificada';
      let detalhe = 'Nenhum trecho registrado. Isso não significa dispensa da obrigação. Confira os documentos do edital.';
      if (citacoes.length) {
        estado = 'informada'; detalhe = 'Confira a condição e seu evento de referência no trecho. Não há confirmação automática da capacidade da empresa.';
        if (campo === 'entrega') {
          const prazos = citacoes.map(c => entregaDaCitacao(c.citacao));
          const prazo = prazos[0];
          const iguais = prazo && prazos.every(p => p && p.dias === prazo.dias && p.unidade === prazo.unidade && p.marco === prazo.marco);
          const comparavel = iguais && Number.isFinite(empresa.prazoEntregaDias) && empresa.prazoEntregaDias! > 0
            && prazo.unidade === empresa.prazoEntregaUnidade && prazo.marco === empresa.prazoEntregaMarco;
          estado = 'confirmar'; detalhe = 'Confirme duração, dias úteis/corridos e marco de contagem da entrega. Cláusulas ambíguas ou bases diferentes não permitem comparação automática.';
          if (comparavel) {
            estado = empresa.prazoEntregaDias! > prazo.dias ? 'conflito' : 'compativel';
            detalhe = `Edital: ${prazo.dias} dias ${prazo.unidade === 'uteis' ? 'úteis' : 'corridos'}. Cadastro: ${empresa.prazoEntregaDias} dias na mesma unidade e marco. ${estado === 'conflito' ? 'O prazo cadastrado excede o exigido; confirme a capacidade antes de participar.' : 'Comparação de prazo compatível; não confirma estoque, transporte ou outras obrigações.'}`;
          }
        } else if (campo === 'amostra' || campo === 'validade_produto') {
          estado = 'confirmar'; detalhe = campo === 'amostra'
            ? 'Confirme se a condição de solicitação se aplica e a capacidade de preparar a amostra. O trecho preserva o prazo e o início da contagem.'
            : 'Confira a validade do lote a fornecer. O cadastro não informa lote nem validade disponível; não confundir com validade do registro ANVISA.';
          const dispensada = citacoes.every(c => {
            const t = norm(c.citacao);
            return !/salvo|exceto|caso|\b(?:se|antes|apos|depois|posteriormente|mas|porem|contudo|entretanto)\b|condicion/.test(t) && (campo === 'amostra'
              ? /amostra[^.;]{0,40}nao (?:sera|serao) exigid[ao]|nao (?:sera|serao) exigida[^.;]{0,20}amostra|dispensada[^.;]{0,20}amostra/.test(t)
              : /nao sera exigida validade minima/.test(t));
          });
          if (dispensada) { estado = 'informada'; detalhe = 'O trecho registra dispensa explícita desta exigência. Confira o escopo na fonte; ausência de citação nunca é tratada como dispensa.'; }
        } else if (campo === 'pagamento') {
          detalhe = 'Condição contratual registrada, sem previsão de recebimento nem confirmação de capital de giro. Prazo, atesto e demais condições permanecem no trecho.';
        }
      }
      linhas.push({ campo, titulo: TITULOS_OPERACIONAIS[campo], ...(item !== undefined ? { item } : {}), estado, detalhe, responsavel: 'analista', citacoes });
    }
  }
  const pendencias = linhas.filter(l => !['compativel', 'informada'].includes(l.estado))
    .map(l => `${l.titulo}${l.item !== undefined ? ` (item ${l.item})` : ''}: ${ESTADOS_OPERACIONAIS[l.estado]}. ${l.detalhe}`);
  return { linhas, pendencias, requerRevisao: pendencias.length > 0, perfilEntrega, fontes: [] };
}

export function fontesOperacionais(st: LanceState, tender: string): Documento[] {
  const docs = [...(st.editalSources?.[tender] ?? []), ...(st.proposalDocs?.[tender] ?? [])];
  return docs.filter((d, i) => d.texto.trim().length > 0 && docs.findIndex(f => f.url === d.url && f.texto === d.texto) === i);
}

export function operacaoDoEstado(st: LanceState, tender: string): Operacao | undefined {
  if (!st.operationalConditions) return undefined; // Dossiês antigos não ganham uma conferência que nunca ocorreu.
  const itens = Object.keys(st.decisions).filter(k => k.startsWith(tender + '#')).map(k => Number(k.split('#')[1]));
  return { ...avaliarOperacao(st.operationalConditions[tender] ?? [], st.company.empresa ?? {}, itens), fontes: fontesOperacionais(st, tender) };
}

/** Mantém a conclusão técnica e o preço; nenhuma pendência operacional vira autorização de envio. */
const basesTecnicas = new WeakMap<object, { estado: string; motivos: string[] }>();
export function aplicarOperacao(st: LanceState, tender: string) {
  const operacao = operacaoDoEstado(st, tender);
  if (!operacao) return;
  for (const [key, d] of Object.entries(st.decisions)) {
    if (!key.startsWith(tender + '#') || !['disputar', 'disputar_com_pendencia'].includes(d.estado)) continue;
    let base = basesTecnicas.get(d);
    if (!base) { base = { estado: d.estado, motivos: [...d.motivos] }; basesTecnicas.set(d, base); }
    d.estado = base.estado; d.motivos = [...base.motivos];
    const item = Number(key.split('#')[1]);
    const pendencias = operacao.linhas.filter(l => (l.item === undefined || l.item === item) && !['compativel', 'informada'].includes(l.estado));
    if (pendencias.length) {
      d.estado = 'disputar_com_pendencia';
      d.motivos = [...d.motivos.filter((m: string) => !m.startsWith('Operação: ')), ...pendencias.map(l => `Operação: ${l.titulo} — ${ESTADOS_OPERACIONAIS[l.estado]}.`)];
    }
    if (d.decision) d.decision = d.estado === 'disputar' ? 'ofertar' : 'ofertar_com_pendencia';
    if (d.reasons) d.reasons = d.motivos;
  }
}

export const INSTRUCAO_OPERACIONAL = 'Após sua conclusão técnica, uma etapa específica revisará entrega, fornecimento, amostra, validade dos produtos e pagamento nos arquivos que você já abriu. Não prolongue a análise com buscas para completar esses campos. Não presuma capacidade operacional nem defina prazos; condição sem evidência continuará pendente.';
