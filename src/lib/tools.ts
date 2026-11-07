// Ferramentas do Lance. Princípio: o modelo julga e cita; o código verifica, calcula e monta o que é enviado.
import type { Tool, Ctx } from './agent.ts';
import { pncp, compras, anvisa, pdf, catmat } from './data.ts';
import { checkAnvisa, priceStats, brandConcentration, priceCheck, checkDocs, verifyQuote, esclarecimentoDeadline, decideItem } from './rules.ts';
import { executarAcao, prazoEsclarecimentoAberto, type ActDeps, type PedidoAcao } from './act.ts';
import { leituraDoEdital } from './edital.ts';
import { recheckTender, situacao } from './recheck.ts';
import { consultarProtocolo } from './portal.ts';
import { isDeepStrictEqual } from 'node:util';
import { inventarioCobertura } from './cobertura.ts';
import type { LanceStore } from './store.ts';
import { randomUUID } from 'node:crypto';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const parseId = (id: string) => { const [cnpj, ano, seq] = id.split('/'); return { cnpj, ano: +ano, seq: +seq }; };
const S = (ctx: Ctx) => ctx.state as LanceState;

export type LanceState = {
  company: any; now: Date; sandboxUrl: string;
  tenders: Record<string, any>; items: Record<string, any[]>; editais: Record<string, string>;
  requirements: any[]; fits: Record<string, any>; restrictive: Record<string, any>; decisions: Record<string, any>;
  drafts: Record<string, any>; approvals: Record<string, any>; submissions: any[];
  editalSources?: Record<string, { nome: string; url: string; texto: string }[]>;
  /** Sem store, as ferramentas de envio não chamam o portal. */
  store?: LanceStore;
  analysisStore?: Pick<LanceStore, 'openEscalation'>;
  recheck?: ActDeps['recheck'];
  snapshot?: (tenderId: string, store: LanceStore) => Promise<unknown>;
};
export const newState = (company: any, sandboxUrl: string, now = new Date()): LanceState =>
  ({ company, now, sandboxUrl, tenders: {}, items: {}, editais: {}, requirements: [], fits: {}, restrictive: {}, decisions: {}, drafts: {}, approvals: {}, submissions: [], editalSources: {} });

const product = (st: LanceState, id: string) => { const p = st.company.catalogo.find((p: any) => p.id === id); if (!p) throw new Error(`produto ${id} não existe no catálogo`); return p; };
const tenderItem = async (st: LanceState, tid: string, n: number) => {
  if (!st.items[tid]) { const { cnpj, ano, seq } = parseId(tid); st.items[tid] = await pncp.items(cnpj, ano, seq); }
  const it = st.items[tid].find(i => i.numero === n); if (!it) throw new Error(`item ${n} não existe no pregão ${tid}`); return it;
};
const key = (tid: string, n: number) => `${tid}#${n}`;

export function motivosDaEvidencia(store: LanceStore, tenderId: string, item: number, produto?: string) {
  const motivos = new Set<'nao_informado' | 'variante_nao_coberta' | 'marca_referencia'>();
  for (const fit of store.getFits(tenderId)) {
    if (fit.item !== item || (produto !== undefined && fit.produto !== produto)) continue;
    const atributos = fit.atributos as { attributes?: { atributo?: string; veredito?: string }[]; restritivo?: unknown; varianteNaoCoberta?: boolean } | null;
    for (const atributo of atributos?.attributes ?? []) {
      if (atributo.veredito === 'nao_informado') motivos.add('nao_informado');
      if (atributo.veredito === 'nao_atende' && norm(atributo.atributo ?? '').includes('variante')) motivos.add('variante_nao_coberta');
    }
    if (atributos?.varianteNaoCoberta === true) motivos.add('variante_nao_coberta');
    if (atributos?.restritivo) motivos.add('marca_referencia');
  }
  return motivos;
}

async function enviarPelaPorta(st: LanceState, pedido: PedidoAcao) {
  if (!st.store) return { resultado: 'bloqueada' as const, motivo: 'envio indisponível sem estado persistente; nada foi enviado' };
  const tender = st.store.getTender(pedido.tenderId);
  if (!tender?.arquivosHash || tender.reavaliar === true) {
    return { resultado: 'bloqueada' as const, motivo: 'reavaliar antes de agir: a foto da análise está ausente ou o monitor marcou o pregão' };
  }
  const resultado = await executarAcao(pedido, {
    store: st.store, politica: st.company.politica, sandboxUrl: st.sandboxUrl,
    empresa: st.company.empresa?.nome ?? '', catalogo: st.company.catalogo ?? [], now: () => st.now,
    recheck: st.recheck ?? ((id, store) => recheckTender(id, store)),
  });
  if (resultado.resultado === 'confirmada') st.submissions.push({ tender_id: pedido.tenderId, protocolo: resultado.protocolo });
  return resultado;
}

// Somente medidas exatas e isoladas. Faixas, tolerâncias e descrições compostas
// continuam como julgamento do modelo; este bloqueio não é um validador semântico geral.
const exactLength = (text: string) => {
  const m = /^(?:(?:comprimento|largura|altura|diametro|espessura|tamanho)\s*:?\s*)?(\d+(?:[.,]\d+)?)\s*(mm|cm|m)\.?$/.exec(norm(text).trim());
  return m ? Number(m[1].replace(',', '.')) * ({ mm: 1, cm: 10, m: 1000 }[m[2]]!) : null;
};

export const tools: Tool[] = [
  {
    name: 'search_tenders', description: 'Busca pregões eletrônicos ABERTOS no PNCP por termo. Retorna até 10.',
    parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, page: { type: 'integer' } } },
    async run(a, ctx) {
      const st = S(ctx); const r = await pncp.searchOpen(a.query, a.page ?? 1, 30);
      const today = st.now.toISOString().slice(0, 10);
      const list = r.items.filter(t => t.modalidade.startsWith('Pregão') && t.abertura.slice(0, 10) > today).slice(0, 10);
      for (const t of list) st.tenders[`${t.cnpj}/${t.ano}/${t.seq}`] = t;
      return { total: r.total, pregoes: list.map(t => ({ tender_id: `${t.cnpj}/${t.ano}/${t.seq}`, objeto: t.objeto.slice(0, 220), orgao: t.orgao, uf: t.uf, abertura: t.abertura })) };
    },
  },
  {
    name: 'get_tender_items', description: 'Lista resumos de itens por página (até 25). Filtra keywords antes de paginar. Continue em proxima_pagina; se descricao_truncada, leia get_tender_item antes de comparar.',
    parameters: { type: 'object', required: ['tender_id'], properties: { tender_id: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } }, page: { type: 'integer' }, page_size: { type: 'integer' } } },
    async run(a, ctx) {
      const page = a.page ?? 1; const size = a.page_size ?? 25;
      if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(size) || size < 1 || size > 25) return { erro: 'página deve ser um inteiro positivo; page_size deve estar entre 1 e 25' };
      const st = S(ctx); const { cnpj, ano, seq } = parseId(a.tender_id);
      st.items[a.tender_id] ??= await pncp.items(cnpj, ano, seq);
      const kws = (a.keywords ?? []).map((k: string) => norm(k).trim()).filter(Boolean);
      const all = st.items[a.tender_id];
      const hit = kws.length ? all.filter(i => kws.some((k: string) => norm(i.descricao).includes(k))) : all;
      const start = (page - 1) * size;
      return { total_itens: all.length, filtrados: hit.length, pagina: page, tamanho_pagina: size, proxima_pagina: start + size < hit.length ? page + 1 : null,
        itens: hit.slice(start, start + size).map(i => ({ numero: i.numero, descricao: i.descricao.slice(0, 240), descricao_truncada: i.descricao.length > 240, quantidade: i.quantidade, valor_estimado: i.valorEstimado, catalog_code: i.catalogCode, beneficio: i.beneficio })) };
    },
  },
  {
    name: 'get_tender_item', description: 'Lê a descrição de um item em partes de até 6000 caracteres. Continue com offset=proximo_offset até null, antes de concluir o encaixe.',
    parameters: { type: 'object', required: ['tender_id', 'item'], properties: { tender_id: { type: 'string' }, item: { type: 'integer' }, offset: { type: 'integer' } } },
    async run(a, ctx) {
      const offset = a.offset ?? 0;
      if (!Number.isSafeInteger(offset) || offset < 0) return { erro: 'offset deve ser um inteiro não negativo' };
      const it = await tenderItem(S(ctx), a.tender_id, a.item);
      return { ...it, descricao: it.descricao.slice(offset, offset + 6000), caracteres_descricao: it.descricao.length,
        offset, proximo_offset: offset + 6000 < it.descricao.length ? offset + 6000 : null };
    },
  },
  {
    name: 'list_catalog', description: 'Lista o catálogo e o perfil da empresa cliente.',
    parameters: { type: 'object', properties: {} },
    async run(_a, ctx) { const c = S(ctx).company; return { empresa: c.empresa, produtos: c.catalogo.map((p: any) => ({ id: p.id, nome: p.nome, marca: p.marca })) }; },
  },
  {
    name: 'get_product_sheet', description: 'Ficha técnica completa de um produto do catálogo.',
    parameters: { type: 'object', required: ['product_id'], properties: { product_id: { type: 'string' } } },
    async run(a, ctx) { const p = product(S(ctx), a.product_id); return { id: p.id, nome: p.nome, marca: p.marca, ficha: p.ficha }; },
  },
  {
    name: 'read_edital', description: 'Lê o edital/termo de referência do pregão e devolve trechos em torno dos tópicos pedidos (ex.: ANVISA, AFE, amostra, habilitação).',
    parameters: { type: 'object', required: ['tender_id', 'topics'], properties: { tender_id: { type: 'string' }, topics: { type: 'array', items: { type: 'string' } } } },
    async run(a, ctx) {
      const st = S(ctx);
      if (!st.editais[a.tender_id]) {
        const { cnpj, ano, seq } = parseId(a.tender_id);
        const files = (await pncp.files(cnpj, ano, seq)).filter(f => /edital|termo de refer/i.test(f.tipo + ' ' + f.titulo));
        const kinds: string[] = [];
        const sources: { nome: string; url: string; texto: string }[] = [];
        const anexos: { titulo: string; texto: string }[] = [];
        for (const f of files.slice(0, 2)) {
          const r = await pdf.fromUrl(f.url); kinds.push(`${f.titulo}: ${r.kind}`);
          anexos.push({ titulo: f.titulo, texto: r.text ?? '' });
          if (r.text) sources.push({ nome: f.titulo || f.tipo, url: f.url, texto: r.text });
        }
        const leitura = leituraDoEdital(anexos);
        if (!leitura.legivel) {
          const analysisStore = st.analysisStore ?? st.store;
          analysisStore?.openEscalation({
            tender: a.tender_id, motivo: leitura.motivo, recomendacao: 'Ler o anexo manualmente ou aguardar um PDF com texto.',
            prazo: new Date(st.now.getTime() + 864e5).toISOString(),
          }, { reuseOpen: true });
          return { erro: leitura.motivo, arquivos: kinds, escalar: true };
        }
        st.editais[a.tender_id] = leitura.texto.replace(/\s+/g, ' ');
        (st.editalSources ??= {})[a.tender_id] = sources;
      }
      const flat = st.editais[a.tender_id]; const nf = norm(flat);
      const out: any[] = [];
      for (const t of a.topics as string[]) {
        let from = 0; let n = 0;
        while (n < 3) { const i = nf.indexOf(norm(t), from); if (i < 0) break; out.push({ topico: t, trecho: flat.slice(Math.max(0, i - 350), i + 450) }); from = i + 800; n++; }
      }
      return { caracteres_edital: flat.length, trechos: out.slice(0, 12) };
    },
  },
  {
    name: 'record_requirement', description: 'Registra uma exigência do edital com citação literal. A citação é conferida contra o texto do edital.',
    parameters: { type: 'object', required: ['tender_id', 'requirement', 'quote'], properties: { tender_id: { type: 'string' }, requirement: { type: 'string', enum: ['registro_anvisa', 'afe', 'amostra', 'certidoes', 'marca_referencia', 'prazo_esclarecimento', 'outro'] }, quote: { type: 'string' } } },
    async run(a, ctx) {
      const st = S(ctx); const txt = st.editais[a.tender_id];
      if (!txt) return { erro: 'leia o edital (read_edital) antes de registrar exigências' };
      const v = verifyQuote(a.quote, txt);
      if (!v.found) return { aceito: false, motivo: `citação rejeitada: ${v.reason}. Copie o trecho literal do edital.` };
      const source = st.editalSources?.[a.tender_id]?.find(s => verifyQuote(a.quote, s.texto).found);
      if (!st.requirements.some(r => r.tender_id === a.tender_id && r.requirement === a.requirement && r.quote === a.quote)) {
        st.requirements.push({ tender_id: a.tender_id, requirement: a.requirement, quote: a.quote,
          ...(source ? { fonte: { nome: source.nome, url: source.url, citacao: a.quote } } : {}) });
      }
      return { aceito: true };
    },
  },
  {
    name: 'check_anvisa', description: 'Confere na base oficial da ANVISA o registro do produto e se a validade cobre a entrega do pregão.',
    parameters: { type: 'object', required: ['product_id', 'tender_id'], properties: { product_id: { type: 'string' }, tender_id: { type: 'string' } } },
    async run(a, ctx) {
      const st = S(ctx); const p = product(st, a.product_id);
      const t = st.tenders[a.tender_id]; const opening = t ? new Date(t.abertura + ':00-03:00') : st.now;
      const deliveryBy = new Date(opening.getTime() + st.company.empresa.prazoEntregaDias * 86400e3);
      const row = anvisa.byRegistro(p.registroAnvisa);
      const r = checkAnvisa(row, { today: st.now, deliveryBy });
      return { ...r, registro: p.registroAnvisa, nome_tecnico: row?.NOME_TECNICO, nome_comercial: row?.NOME_COMERCIAL, detentor: row?.DETENTOR_REGISTRO_CADASTRO, entrega_ate: deliveryBy.toISOString().slice(0, 10) };
    },
  },
  {
    name: 'find_catalog_codes', description: 'Para itens SEM catalog_code: busca códigos candidatos no catálogo federal (CATMAT) a partir da descrição.',
    parameters: { type: 'object', required: ['description'], properties: { description: { type: 'string' } } },
    async run(a) { return { candidatos: catmat.search(a.description, 8).map(c => ({ code: c.code, pdm: c.pdmName, descricao: c.desc.slice(0, 220) })) }; },
  },
  {
    name: 'get_price_history', description: 'Preços já homologados pelo governo para um código CATMAT: estatísticas, marcas e amostra de descrições (para conferir se o código corresponde ao item).',
    parameters: { type: 'object', required: ['catalog_code'], properties: { catalog_code: { type: 'integer' } } },
    async run(a) {
      const recs = await compras.priceHistory(a.catalog_code); const s = priceStats(recs); const b = brandConcentration(recs);
      return { n: s.n, min: s.min, p25: s.p25, mediana: s.median, p75: s.p75, max: s.max, marcas_distintas: b.distinct, marca_top: b.topBrand, participacao_marca_top: Number(b.share.toFixed(2)), concentracao_alta: b.flag,
        top_marcas: s.byBrand.slice(0, 5), amostra_descricoes: [...new Set(recs.map(r => r.descricao.slice(0, 160)))].slice(0, 3) };
    },
  },
  {
    name: 'record_fit', description: 'Registra o encaixe técnico item × produto, atributo a atributo. Cada atributo exige citação literal do item (citacao_item) e, se atende/não atende, da ficha (citacao_ficha). Citações são conferidas. Cada campo "nome: valor" do item precisa da própria citação; campo de fora deixa a cobertura não verificada.',
    parameters: { type: 'object', required: ['tender_id', 'item', 'product_id', 'attributes'], properties: {
      tender_id: { type: 'string' }, item: { type: 'integer' }, product_id: { type: 'string' },
      attributes: { type: 'array', items: { type: 'object', required: ['atributo', 'veredito', 'citacao_item'], properties: {
        atributo: { type: 'string' }, exigido: { type: 'string' }, ofertado: { type: 'string' },
        veredito: { type: 'string', enum: ['atende', 'nao_atende', 'nao_informado'] }, citacao_item: { type: 'string' }, citacao_ficha: { type: 'string' } } } } } },
    async run(a, ctx) {
      const st = S(ctx); const it = await tenderItem(st, a.tender_id, a.item); const p = product(st, a.product_id);
      // Uma nova análise não pode deixar a decisão anterior utilizável por engano.
      delete st.fits[key(a.tender_id, a.item)];
      delete st.decisions[key(a.tender_id, a.item)];
      const errors: string[] = [];
      if (!Array.isArray(a.attributes) || !a.attributes.length) return { aceito: false, erros: ['informe pelo menos um atributo exigido pelo item'] };
      const names = new Set<string>();
      for (const at of a.attributes) {
        const name = norm(at.atributo ?? '').trim();
        if (!name || names.has(name)) errors.push('atributo vazio ou duplicado');
        names.add(name);
        if (!verifyQuote(at.citacao_item, it.descricao, 8).found) errors.push(`${at.atributo}: citacao_item não encontrada no item`);
        if (at.veredito !== 'nao_informado' && !verifyQuote(at.citacao_ficha ?? '', p.ficha, 8).found) errors.push(`${at.atributo}: citacao_ficha não encontrada na ficha`);
        if (at.veredito === 'atende') {
          const required = exactLength(at.citacao_item ?? ''); const offered = exactLength(at.citacao_ficha ?? '');
          if (required !== null && offered !== null && Math.abs(required - offered) > 1e-9) errors.push(`${at.atributo}: medidas exatas incompatíveis; corrija o veredito`);
        }
      }
      if (errors.length) return { aceito: false, erros: errors, instrucao: 'corrija as citações copiando trechos literais e chame record_fit de novo' };
      const v = a.attributes.map((x: any) => x.veredito);
      const overall = v.includes('nao_atende') ? 'nao_atende' : v.includes('nao_informado') ? 'nao_informado' : 'atende';
      const inventario = inventarioCobertura(it.descricao ?? '', a.attributes);
      const varianteNaoCoberta = a.attributes.some((at: { atributo?: string; veredito?: string }) => at.veredito === 'nao_atende' && norm(at.atributo ?? '').includes('variante'));
      const validacao = { citacoes: 'conferidas', cobertura: inventario.cobertura, semantica: 'julgamento_modelo', lacunas: inventario.lacunas };
      st.fits[key(a.tender_id, a.item)] = { product_id: a.product_id, overall, attributes: a.attributes, varianteNaoCoberta, validacao };
      return { aceito: true, resultado: overall, validacao, lacunas: inventario.lacunas,
        instrucao: inventario.cobertura === 'conferida' ? 'todos os campos nomeados do item foram citados' : 'cada campo "nome: valor" do item precisa da própria citação literal; o que faltar continua não verificado' };
    },
  },
  {
    name: 'flag_restrictive', description: 'Sinaliza especificação possivelmente restritiva: marca de referência no texto (com citação) ou concentração de marca no histórico do código.',
    parameters: { type: 'object', required: ['tender_id', 'item', 'evidence'], properties: { tender_id: { type: 'string' }, item: { type: 'integer' }, evidence: { type: 'string', enum: ['marca_referencia', 'concentracao_marca'] }, quote: { type: 'string' }, catalog_code: { type: 'integer' } } },
    async run(a, ctx) {
      const st = S(ctx); const it = await tenderItem(st, a.tender_id, a.item);
      if (a.evidence === 'marca_referencia') {
        if (!verifyQuote(a.quote ?? '', it.descricao + ' ' + (st.editais[a.tender_id] ?? ''), 10).found) return { aceito: false, motivo: 'citação da marca de referência não encontrada' };
      } else {
        const b = brandConcentration(await compras.priceHistory(a.catalog_code ?? it.catalogCode));
        if (!b.flag) return { aceito: false, motivo: `concentração insuficiente (${b.topBrand} ${(b.share * 100).toFixed(0)}% de ${b.n})` };
      }
      st.restrictive[key(a.tender_id, a.item)] = { evidence: a.evidence, quote: a.quote };
      return { aceito: true };
    },
  },
  {
    name: 'decide_item', description: 'Calcula decisão com estimativa do órgão, documentos e regularização. Cobertura técnica não verificada escala. Não exige código CATMAT.',
    parameters: { type: 'object', required: ['tender_id', 'item', 'product_id'], properties: { tender_id: { type: 'string' }, item: { type: 'integer' }, product_id: { type: 'string' }, catalog_code: { type: 'integer' } } },
    async run(a, ctx) {
      const st = S(ctx); const k = key(a.tender_id, a.item); const fit = st.fits[k];
      if (!fit || fit.product_id !== a.product_id) return { erro: 'registre o encaixe (record_fit) antes de decidir' };
      const p = product(st, a.product_id); const t = st.tenders[a.tender_id];
      const raw = t?.abertura ?? '';
      const opening = new Date(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(raw) ? raw + ':00-03:00' : raw);
      if (!Number.isFinite(opening.getTime())) return { erro: 'data da sessão desconhecida; não agir' };
      const it = await tenderItem(st, a.tender_id, a.item);
      const policy = st.company.politica;
      const price = policy && Number.isFinite(policy.margemMinima) && Number.isFinite(policy.margemAlvo)
        ? priceCheck({ custo: p.custo, margemMinima: policy.margemMinima, margemAlvo: policy.margemAlvo, estimativa: it.valorEstimado ?? null, sigiloso: it.sigiloso === true })
        : { viavel: null, precoProposto: null, motivo: 'política de preço ausente' };
      const deliveryBy = new Date(opening.getTime() + st.company.empresa.prazoEntregaDias * 86400e3);
      let an;
      try { an = checkAnvisa(anvisa.byRegistro(p.registroAnvisa), { today: st.now, deliveryBy, coberturaDeclarada: p.coberturaDeclarada === true }); }
      catch { an = { regularizacao: 'nao_verificado' as const, cobertura: 'nao_comprovada' as const, classe: null, detentor: null, validUntil: null }; }
      const requirements = st.requirements.filter(r => r.tender_id === a.tender_id);
      const docs = checkDocs(st.company.cofre, requirements.map(r => ({ tipo: r.requirement, citacao: r.quote })), raw.slice(0, 10));
      const prazo = prazoEsclarecimentoAberto(raw, st.now);
      const varianteNaoCoberta = fit.varianteNaoCoberta === true || (fit.attributes ?? []).some((at: { atributo?: string; veredito?: string }) => at.veredito === 'nao_atende' && norm(at.atributo ?? '').includes('variante'));
      const d = decideItem({ fit: fit.validacao?.cobertura === 'conferida' ? fit.overall : 'desconhecido', regularizacao: an.regularizacao,
        cobertura: an.cobertura, preco: price, docs, restritivo: !!st.restrictive[k], varianteNaoCoberta,
        prazoEsclarecimentoAberto: prazo.prazo ? prazo.aberto : null, venceAntesEntrega: 'venceAntesEntrega' in an && an.venceAntesEntrega === true });
      const legacy: Record<string, string> = { disputar: 'ofertar', disputar_com_pendencia: 'ofertar_com_pendencia', nao_disputar: 'nao_ofertar', esclarecer: 'escalar', escalar: 'escalar' };
      const dec = { ...d, tenderId: a.tender_id, item: a.item, produto: a.product_id, product_id: a.product_id,
        precoProposto: price.precoProposto, preco_sugerido: price.precoProposto, preco: price, anvisa: an, docs,
        decision: legacy[d.estado], reasons: d.motivos, docs_vencidos: docs.filter(x => !['vigente', 'sem_vencimento'].includes(x.status)).map(x => x.exigencia) };
      st.decisions[k] = dec;
      return dec;
    },
  },
  {
    name: 'draft_esclarecimento', description: 'Redige pedido de esclarecimento ao órgão (não envia). Retorna o prazo legal.',
    parameters: { type: 'object', required: ['tender_id', 'item', 'texto'], properties: { tender_id: { type: 'string' }, item: { type: 'integer' }, texto: { type: 'string' } } },
    async run(a, ctx) {
      const st = S(ctx); const t = st.tenders[a.tender_id]; const prazo = esclarecimentoDeadline(t ? new Date(t.abertura + ':00-03:00') : st.now);
      st.drafts[key(a.tender_id, a.item)] = { texto: a.texto, prazo }; return { salvo: true, prazo, no_prazo: st.now.toISOString().slice(0, 10) <= prazo };
    },
  },
  {
    name: 'request_approval', description: 'Envia ao humano o resumo do turno e as ações propostas. Depois de chamar, ENCERRE o turno e aguarde.',
    parameters: { type: 'object', required: ['resumo'], properties: { resumo: { type: 'string' } } },
    async run(a, ctx) {
      const st = S(ctx); const id = 'AP-' + randomUUID().slice(0, 8);
      const ofertas = Object.entries(st.decisions).filter(([, d]: any) => d.decision === 'ofertar' || d.decision === 'ofertar_com_pendencia');
      st.approvals[id] = { resumo: a.resumo, ofertas: ofertas.map(([k]) => k), esclarecimentos: Object.keys(st.drafts), status: 'pendente' };
      return { approval_id: id, status: 'pendente', ofertas: ofertas.length, esclarecimentos: Object.keys(st.drafts).length };
    },
  },
  {
    name: 'submit_proposal', description: 'Pede o envio da proposta dos itens indicados. O código relê decisão, quantidade e preço no store, passa pela política e pelo recheque, e só então fala com o portal. Preço e aprovação não autorizam o envio.',
    parameters: { type: 'object', required: ['tender_id', 'itens'], properties: { tender_id: { type: 'string' }, itens: { type: 'array', items: { type: 'integer' } } } },
    async run(a, ctx) {
      return enviarPelaPorta(S(ctx), { tipo: 'enviar_proposta', tenderId: a.tender_id, itens: a.itens });
    },
  },
  {
    name: 'send_esclarecimento', description: 'Pede o envio de um esclarecimento já redigido. O motivo precisa coincidir com a evidência gravada no encaixe ou na sinalização restritiva. O prazo sai da abertura persistida. O texto vem do rascunho.',
    parameters: { type: 'object', required: ['tender_id', 'item', 'motivo'], properties: { tender_id: { type: 'string' }, item: { type: 'integer' }, motivo: { type: 'string', enum: ['nao_informado', 'variante_nao_coberta', 'marca_referencia'] } } },
    async run(a, ctx) {
      const st = S(ctx); const dr = st.drafts[key(a.tender_id, a.item)];
      if (!dr?.texto) return { resultado: 'bloqueada', motivo: 'esclarecimento sem rascunho; nada foi enviado' };
      if (!st.store) return { resultado: 'bloqueada', motivo: 'envio indisponível sem estado persistente; nada foi enviado' };
      const decisions = st.store.getDecisions(a.tender_id).filter(row => row.item === a.item);
      const [decision] = decisions;
      const evidencias = decisions.length === 1 && decision.produto
        ? motivosDaEvidencia(st.store, a.tender_id, a.item, decision.produto) : new Set<string>();
      if (!evidencias.has(a.motivo)) {
        if (!st.store.getItems(a.tender_id).some(item => item.numero === a.item)) {
          return { resultado: 'bloqueada', motivo: 'item do esclarecimento ausente no store' };
        }
        const motivo = 'motivo do esclarecimento não confere com a evidência gravada';
        st.store.openEscalation({
          tender: a.tender_id, item: String(a.item), motivo,
          recomendacao: 'Revisar a evidência e o rascunho antes de enviar o esclarecimento.',
          prazo: new Date(st.now.getTime() + 864e5).toISOString(),
        }, { reuseOpen: true });
        return { resultado: 'escalada', motivo };
      }
      return enviarPelaPorta(st, { tipo: 'enviar_esclarecimento', tenderId: a.tender_id, item: a.item, texto: dr.texto, motivo: a.motivo });
    },
  },
  {
    name: 'verify_submission', description: 'Consulta a proposta ou o esclarecimento no portal pelo protocolo persistido e verifica se o pregão segue aberto.',
    parameters: { type: 'object', required: ['protocolo', 'tender_id'], properties: { protocolo: { type: 'string' }, tender_id: { type: 'string' } } },
    async run(a, ctx) {
      const st = S(ctx);
      const actions = st.store?.getActions({ tenderId: a.tender_id }).filter(row => row.protocolo === a.protocolo) ?? [];
      if (!a.protocolo || actions.length !== 1) return { ok: false, motivo: 'protocolo sem ação única neste pregão no store' };
      const [action] = actions;
      const consulta = await consultarProtocolo(st.sandboxUrl, action.tipo, a.protocolo);
      if (!consulta.encontrado) return { ok: false, portal_confere: false, motivo: consulta.erro ?? 'protocolo não encontrado no portal' };
      const got = consulta.registro as { protocolo?: unknown; tender?: unknown; empresa?: unknown; itens?: unknown; item?: unknown; texto?: unknown } | null;
      const expected = action.payload as { empresa?: unknown; itens?: unknown; texto?: unknown } | null;
      const same = got != null && got.protocolo === a.protocolo && got.tender === a.tender_id
        && (action.tipo === 'proposta'
          ? Array.isArray(expected?.itens) && got.empresa === expected.empresa && isDeepStrictEqual(got.itens, expected.itens)
          : typeof expected?.texto === 'string' && got.item === action.item && got.texto === expected.texto);

      const { cnpj, ano, seq } = parseId(a.tender_id);
      try {
        const c = await pncp.compra(cnpj, ano, seq, { fresh: true });
        const fim = String(c.dataEncerramentoProposta ?? '');
        const timestamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(fim) ? fim + '-03:00' : fim;
        const aberto = situacao(c.situacaoCompraNome) === 'aberto' && Date.parse(timestamp) > st.now.getTime();
        return { ok: same && aberto, portal_confere: same, pncp_aberto: aberto, encerramento_propostas: fim, situacao: c.situacaoCompraNome };
      } catch {
        return { ok: false, portal_confere: same, pncp_aberto: null, motivo: 'PNCP indisponível para verificar a situação atual' };
      }
    },
  },
];
