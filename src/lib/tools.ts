// Ferramentas do Lance. Princípio: o modelo julga e cita; o código verifica, calcula e monta o que é enviado.
import type { Tool, Ctx } from './agent.ts';
import { pncp, compras, anvisa, pdf, catmat } from './data.ts';
import { checkAnvisa, priceStats, brandConcentration, suggestPrice, verifyQuote, esclarecimentoDeadline, decideItem, type ItemChecks } from './rules.ts';
import { randomUUID } from 'node:crypto';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const parseId = (id: string) => { const [cnpj, ano, seq] = id.split('/'); return { cnpj, ano: +ano, seq: +seq }; };
const S = (ctx: Ctx) => ctx.state as LanceState;

export type LanceState = {
  company: any; now: Date; sandboxUrl: string;
  tenders: Record<string, any>; items: Record<string, any[]>; editais: Record<string, string>;
  requirements: any[]; fits: Record<string, any>; restrictive: Record<string, any>; decisions: Record<string, any>;
  drafts: Record<string, any>; approvals: Record<string, any>; submissions: any[];
};
export const newState = (company: any, sandboxUrl: string, now = new Date()): LanceState =>
  ({ company, now, sandboxUrl, tenders: {}, items: {}, editais: {}, requirements: [], fits: {}, restrictive: {}, decisions: {}, drafts: {}, approvals: {}, submissions: [] });

const product = (st: LanceState, id: string) => { const p = st.company.catalogo.find((p: any) => p.id === id); if (!p) throw new Error(`produto ${id} não existe no catálogo`); return p; };
const tenderItem = async (st: LanceState, tid: string, n: number) => {
  if (!st.items[tid]) { const { cnpj, ano, seq } = parseId(tid); st.items[tid] = await pncp.items(cnpj, ano, seq); }
  const it = st.items[tid].find(i => i.numero === n); if (!it) throw new Error(`item ${n} não existe no pregão ${tid}`); return it;
};
const key = (tid: string, n: number) => `${tid}#${n}`;

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
    name: 'get_tender_items', description: 'Lista itens de um pregão. Use keywords para filtrar pregões grandes (máx. 25 itens retornados).',
    parameters: { type: 'object', required: ['tender_id'], properties: { tender_id: { type: 'string' }, keywords: { type: 'array', items: { type: 'string' } } } },
    async run(a, ctx) {
      const st = S(ctx); const { cnpj, ano, seq } = parseId(a.tender_id);
      st.items[a.tender_id] ??= await pncp.items(cnpj, ano, seq);
      const kws = (a.keywords ?? []).map(norm);
      const all = st.items[a.tender_id];
      const hit = kws.length ? all.filter(i => kws.some((k: string) => norm(i.descricao).includes(k))) : all;
      return { total_itens: all.length, filtrados: hit.length, itens: hit.slice(0, 25).map(i => ({ numero: i.numero, descricao: i.descricao.slice(0, 900), quantidade: i.quantidade, valor_estimado: i.valorEstimado, catalog_code: i.catalogCode, beneficio: i.beneficio })) };
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
        let text = ''; const kinds: string[] = [];
        for (const f of files.slice(0, 2)) { const r = await pdf.fromUrl(f.url); kinds.push(`${f.titulo}: ${r.kind}`); if (r.text) text += '\n' + r.text; }
        if (!text) return { erro: 'nenhum edital legível (ZIP, escaneado ou ausente)', arquivos: kinds };
        st.editais[a.tender_id] = text.replace(/\s+/g, ' ');
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
      st.requirements.push({ tender_id: a.tender_id, requirement: a.requirement, quote: a.quote });
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
    name: 'record_fit', description: 'Registra o encaixe técnico item × produto, atributo a atributo. Cada atributo exige citação literal do item (citacao_item) e, se atende/não atende, da ficha (citacao_ficha). Citações são conferidas.',
    parameters: { type: 'object', required: ['tender_id', 'item', 'product_id', 'attributes'], properties: {
      tender_id: { type: 'string' }, item: { type: 'integer' }, product_id: { type: 'string' },
      attributes: { type: 'array', items: { type: 'object', required: ['atributo', 'veredito', 'citacao_item'], properties: {
        atributo: { type: 'string' }, exigido: { type: 'string' }, ofertado: { type: 'string' },
        veredito: { type: 'string', enum: ['atende', 'nao_atende', 'nao_informado'] }, citacao_item: { type: 'string' }, citacao_ficha: { type: 'string' } } } } } },
    async run(a, ctx) {
      const st = S(ctx); const it = await tenderItem(st, a.tender_id, a.item); const p = product(st, a.product_id);
      const errors: string[] = [];
      for (const at of a.attributes) {
        if (!verifyQuote(at.citacao_item, it.descricao, 8).found) errors.push(`${at.atributo}: citacao_item não encontrada no item`);
        if (at.veredito !== 'nao_informado' && !verifyQuote(at.citacao_ficha ?? '', p.ficha, 8).found) errors.push(`${at.atributo}: citacao_ficha não encontrada na ficha`);
      }
      if (errors.length) return { aceito: false, erros: errors, instrucao: 'corrija as citações copiando trechos literais e chame record_fit de novo' };
      const v = a.attributes.map((x: any) => x.veredito);
      const overall = v.includes('nao_atende') ? 'nao_atende' : v.includes('nao_informado') ? 'nao_informado' : 'atende';
      st.fits[key(a.tender_id, a.item)] = { product_id: a.product_id, overall, attributes: a.attributes };
      return { aceito: true, resultado: overall };
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
    name: 'decide_item', description: 'Calcula a decisão do item (ofertar / ofertar_com_pendencia / nao_ofertar / escalar) a partir do encaixe registrado, ANVISA, preço histórico do catalog_code escolhido, documentos e sinais de restrição. O preço sugerido é calculado aqui.',
    parameters: { type: 'object', required: ['tender_id', 'item', 'product_id', 'catalog_code'], properties: { tender_id: { type: 'string' }, item: { type: 'integer' }, product_id: { type: 'string' }, catalog_code: { type: 'integer' } } },
    async run(a, ctx) {
      const st = S(ctx); const k = key(a.tender_id, a.item); const fit = st.fits[k];
      if (!fit || fit.product_id !== a.product_id) return { erro: 'registre o encaixe (record_fit) deste item com este produto antes de decidir' };
      const p = product(st, a.product_id); const t = st.tenders[a.tender_id];
      const opening = t ? new Date(t.abertura + ':00-03:00') : st.now;
      const deliveryBy = new Date(opening.getTime() + st.company.empresa.prazoEntregaDias * 86400e3);
      const an = checkAnvisa(anvisa.byRegistro(p.registroAnvisa), { today: st.now, deliveryBy });
      const stats = priceStats(await compras.priceHistory(a.catalog_code));
      const price = suggestPrice(stats, p.custo, st.company.empresa.margemMinima);
      const openYmd = opening.toISOString().slice(0, 10);
      const expired = st.company.cofre.filter((d: any) => d.validade < openYmd);
      const checks: ItemChecks = { fit: fit.overall, anvisa: an.status, price, docsOk: !expired.length, restrictive: !!st.restrictive[k] };
      const d = decideItem(checks);
      const prazo = esclarecimentoDeadline(opening);
      const dec = { ...d, product_id: a.product_id, catalog_code: a.catalog_code, preco_sugerido: price.ok ? price.price : null, preco: price, anvisa: an, docs_vencidos: expired.map((x: any) => `${x.doc} (vence ${x.validade})`), prazo_esclarecimento: prazo, esclarecimento_no_prazo: st.now.toISOString().slice(0, 10) <= prazo };
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
    name: 'submit_proposal', description: 'Envia ao portal a proposta de um pregão com os itens aprovados. Exige approval_id aprovado pelo humano. Preços vêm das decisões calculadas, não do modelo.',
    requiresApproval: true,
    parameters: { type: 'object', required: ['approval_id', 'tender_id'], properties: { approval_id: { type: 'string' }, tender_id: { type: 'string' } } },
    async run(a, ctx) {
      const st = S(ctx); const ap = st.approvals[a.approval_id];
      const keys = ap.ofertas.filter((k: string) => k.startsWith(a.tender_id + '#'));
      if (!keys.length) return { erro: 'nenhum item aprovado para este pregão' };
      const itens = keys.map((k: string) => { const d = st.decisions[k]; const p = product(st, d.product_id); return { numero: Number(k.split('#')[1]), produto: p.id, marca: p.marca, registroAnvisa: p.registroAnvisa, precoUnitario: d.preco_sugerido }; });
      const res = await fetch(st.sandboxUrl + '/api/propostas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tender: a.tender_id, empresa: st.company.empresa.nome, itens }) });
      const j = await res.json(); if (res.status !== 201) return { erro: 'portal rejeitou', detalhes: j };
      st.submissions.push({ tender_id: a.tender_id, protocolo: j.protocolo, itens }); return { protocolo: j.protocolo, itens: itens.length };
    },
  },
  {
    name: 'send_esclarecimento', description: 'Envia ao portal um pedido de esclarecimento já redigido e aprovado. Exige approval_id.',
    requiresApproval: true,
    parameters: { type: 'object', required: ['approval_id', 'tender_id', 'item'], properties: { approval_id: { type: 'string' }, tender_id: { type: 'string' }, item: { type: 'integer' } } },
    async run(a, ctx) {
      const st = S(ctx); const k = key(a.tender_id, a.item); const dr = st.drafts[k];
      if (!dr || !st.approvals[a.approval_id].esclarecimentos.includes(k)) return { erro: 'esclarecimento não redigido ou não aprovado' };
      const res = await fetch(st.sandboxUrl + '/api/esclarecimentos', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tender: a.tender_id, item: a.item, texto: dr.texto }) });
      return { status: res.status, ...(await res.json()) };
    },
  },
  {
    name: 'verify_submission', description: 'Confere no portal que a proposta foi registrada como aprovada e, no PNCP, que o pregão segue aberto.',
    parameters: { type: 'object', required: ['protocolo', 'tender_id'], properties: { protocolo: { type: 'string' }, tender_id: { type: 'string' } } },
    async run(a, ctx) {
      const st = S(ctx); const sub = st.submissions.find(s => s.protocolo === a.protocolo);
      const r = await fetch(`${st.sandboxUrl}/api/propostas/${a.protocolo}`); if (r.status !== 200) return { ok: false, motivo: 'protocolo não encontrado no portal' };
      const got = await r.json();
      const same = JSON.stringify(got.itens) === JSON.stringify(sub?.itens);
      const { cnpj, ano, seq } = parseId(a.tender_id); const c = await pncp.compra(cnpj, ano, seq);
      const fim = String(c.dataEncerramentoProposta ?? ''); const aberto = fim > st.now.toISOString();
      return { ok: same && aberto, portal_confere: same, pncp_aberto: aberto, encerramento_propostas: fim, situacao: c.situacaoCompraNome };
    },
  },
];
