// Auditoria de uma execução do agente, lida só do store: o que cada chamada fez, repetições (necessárias ou
// evitáveis), rejeições de evidência, e se a conclusão persistida é a mesma na fila, no dossiê, no veredito e
// nos documentos. Não chama modelo nem fonte; não mede concordância humana nem precisão.
import { createReadModel } from './read-model.ts';
import { concluirAnalise } from './experiencia-analise.ts';
import { verifyQuote } from './rules.ts';
import { prepararDocumento, DocumentoError } from '../server/documentos.ts';
import type { Dossier } from '../server/contract.ts';
import type { LanceStore } from './store.ts';

export type Passo = { i: number; ferramenta: string; entrada?: string; saida?: string; ms?: number; custoUsd?: number };
export type ClasseRepeticao =
  | 'correcao_apos_rejeicao'   // a chamada anterior foi recusada: refazer é necessário
  | 'cobertura_perseguida'     // aceito, mas com campo sem citação: refazer pode ser necessário
  | 'refeito_sem_motivo'       // aceito e completo: refazer é desperdício
  | 'decisao_sem_dado_novo'    // decide_item igual sem nenhuma evidência nova do item no meio
  | 'releitura_apos_compactacao' // o resultado anterior já saiu do histórico compactado
  | 'leitura_identica';        // mesma leitura com o resultado ainda no histórico: desperdício
export type Repeticao = { passo: number; ferramenta: string; item?: number; classe: ClasseRepeticao };
export const EVITAVEIS = new Set<ClasseRepeticao>(['refeito_sem_motivo', 'decisao_sem_dado_novo', 'leitura_identica']);

const json = (s?: string) => { try { return s ? JSON.parse(s) : undefined; } catch { return undefined; } };
const recusado = (saida: any) => !saida || saida.aceito === false || typeof saida.erro === 'string' || typeof saida.error === 'string';
const LEITURAS = new Set(['list_catalog', 'get_tender_items', 'get_tender_item', 'get_product_sheet', 'read_edital', 'read_proposal_docs', 'read_proposal_excerpt', 'check_anvisa']);
const EVIDENCIA_DO_ITEM = new Set(['record_fit', 'flag_restrictive']);
const EVIDENCIA_DO_PREGAO = new Set(['record_requirement', 'check_anvisa']);

/** Passos do agente para o pregão, na ordem gravada (eventos analise_item). */
export function passosDoTurno(store: LanceStore, tenderId: string): Passo[] {
  // O agendador grava os passos sem pregão; nesse caso entram todos (um pregão por turno é o padrão).
  const eventos = store.events().filter(e => e.tipo === 'analise_item');
  const doPregao = eventos.filter(e => e.tender === tenderId);
  return (doPregao.length ? doPregao : eventos.filter(e => !e.tender))
    .flatMap(e => e.rastro ?? []).map((r, i) => ({ i, ferramenta: r.ferramenta, entrada: r.entrada, saida: r.saida, ms: r.ms, custoUsd: r.custoUsd }));
}

export function eficiencia(passos: Passo[]) {
  const ferramentas: Record<string, number> = {};
  const rejeicoes: { passo: number; ferramenta: string; motivo: string }[] = [];
  const repeticoes: Repeticao[] = [];
  const porItem: Record<number, { record_fit: number; decide_item: number }> = {};
  const llm = passos.filter(p => p.ferramenta.startsWith('llm'));
  const tools = passos.filter(p => !p.ferramenta.startsWith('llm') && p.ferramenta !== 'stop');
  // Grupo de resultados = ferramentas entre duas chamadas ao modelo. A compactação mantém os 2 últimos grupos.
  let grupo = 0; const grupoDoPasso = new Map<number, number>();
  for (const p of passos) { if (p.ferramenta.startsWith('llm')) grupo++; else grupoDoPasso.set(p.i, grupo); }
  const anteriores: Passo[] = [];
  for (const p of tools) {
    ferramentas[p.ferramenta] = (ferramentas[p.ferramenta] ?? 0) + 1;
    const args = json(p.entrada) ?? {}; const saida = json(p.saida);
    const item: number | undefined = typeof args.item === 'number' ? args.item : undefined;
    if (item !== undefined && (p.ferramenta === 'record_fit' || p.ferramenta === 'decide_item')) {
      porItem[item] ??= { record_fit: 0, decide_item: 0 };
      porItem[item][p.ferramenta]++;
    }
    if (recusado(saida)) rejeicoes.push({ passo: p.i, ferramenta: p.ferramenta,
      motivo: String(saida?.erros?.join('; ') ?? saida?.motivo ?? saida?.erro ?? saida?.error ?? 'sem saída').slice(0, 200) });

    if (p.ferramenta === 'record_fit' && item !== undefined) {
      const ultimo = [...anteriores].reverse().find(a => a.ferramenta === 'record_fit' && json(a.entrada)?.item === item);
      if (ultimo) {
        const s = json(ultimo.saida);
        // Mesma entrada que já foi aceita devolve o mesmo resultado: não há o que perseguir.
        const classe: ClasseRepeticao = recusado(s) ? 'correcao_apos_rejeicao'
          : ultimo.entrada === p.entrada || s?.validacao?.cobertura === 'conferida' ? 'refeito_sem_motivo' : 'cobertura_perseguida';
        repeticoes.push({ passo: p.i, ferramenta: p.ferramenta, item, classe });
      }
    } else if (p.ferramenta === 'decide_item' && item !== undefined) {
      const k = [...anteriores].reverse().findIndex(a => a.ferramenta === 'decide_item' && json(a.entrada)?.item === item);
      if (k >= 0) {
        const desde = anteriores.slice(anteriores.length - k);
        const novo = desde.some(a => !recusado(json(a.saida)) && (EVIDENCIA_DO_PREGAO.has(a.ferramenta)
          || (EVIDENCIA_DO_ITEM.has(a.ferramenta) && json(a.entrada)?.item === item)));
        if (!novo) repeticoes.push({ passo: p.i, ferramenta: p.ferramenta, item, classe: 'decisao_sem_dado_novo' });
      }
    } else if (LEITURAS.has(p.ferramenta)) {
      const igual = [...anteriores].reverse().find(a => a.ferramenta === p.ferramenta && a.entrada === p.entrada);
      if (igual) {
        const distancia = (grupoDoPasso.get(p.i) ?? 0) - (grupoDoPasso.get(igual.i) ?? 0);
        repeticoes.push({ passo: p.i, ferramenta: p.ferramenta, item, classe: distancia > 2 ? 'releitura_apos_compactacao' : 'leitura_identica' });
      }
    }
    anteriores.push(p);
  }
  const custoUsd = llm.every(p => typeof p.custoUsd === 'number') && llm.length ? llm.reduce((s, p) => s + p.custoUsd!, 0) : null;
  return { chamadasModelo: llm.length, chamadasFerramenta: tools.length, custoUsd, ferramentas, rejeicoes, repeticoes,
    evitaveis: repeticoes.filter(r => EVITAVEIS.has(r.classe)).length, porItem,
    final: [...passos].reverse().find(p => p.ferramenta.startsWith('llm'))?.saida ?? null };
}

const VIAVEL = new Set(['disputar', 'disputar_com_pendencia']);

/** Contradições entre o que foi persistido e o que fila, dossiê, veredito e documentos mostram. Lista vazia = coerente. */
export function consistencia(store: LanceStore, tenderId: string): string[] {
  const erros: string[] = [];
  const model = createReadModel(store, { actions: () => store.getActions() });
  const decisoes = store.getDecisions(tenderId);
  const itens = store.getItems(tenderId);
  const fits = store.getFits(tenderId);
  const dossie = model.dossie(tenderId) as (Dossier & { itens?: any[]; proposta?: any; reavaliar?: boolean; desatualizado?: boolean; publicacao?: { conferida: boolean; motivo: string } }) | undefined;
  const fila = model.fila().filter(r => r.tender === tenderId);
  if (!decisoes.length && !fits.length) return dossie ? [] : ['nenhuma decisão nem dossiê persistidos'];
  if (!dossie) return ['decisões persistidas sem dossiê'];

  for (const d of decisoes) {
    const row = fila.find(r => r.item === String(d.item)) as { estadoCodigo?: string } | undefined;
    if (!row) erros.push(`item ${d.item}: decisão persistida fora da fila`);
    else if (row.estadoCodigo !== d.estado) erros.push(`item ${d.item}: fila mostra ${row.estadoCodigo}, store tem ${d.estado}`);
    const di = dossie.itens?.find((x: any) => x.item === d.item);
    if (!di) erros.push(`item ${d.item}: ausente do dossiê`);
    else if (di.estado !== d.estado) erros.push(`item ${d.item}: dossiê mostra ${di.estado}, store tem ${d.estado}`);
    const fit = fits.find(f => f.item === d.item && f.produto === d.produto);
    const cobertura = (fit?.atributos as any)?.validacao?.cobertura;
    if (VIAVEL.has(d.estado) && cobertura !== 'conferida') erros.push(`item ${d.item}: ${d.estado} sem cobertura conferida`);
    if (d.estado === 'escalar' && !store.openEscalations().some(e => e.tender === tenderId && e.item === String(d.item))
      && !store.events().some(e => e.tipo === 'escalada_decidida' && e.tender === tenderId && e.item === String(d.item)))
      erros.push(`item ${d.item}: escalar sem escalada aberta para o humano`);
  }
  for (const f of fits) {
    if (!decisoes.some(d => d.item === f.item) && !store.openEscalations().some(e => e.tender === tenderId && e.item === String(f.item)))
      erros.push(`item ${f.item}: encaixe sem decisão e sem escalada para o humano`);
  }
  for (const f of fits) {
    const desc = itens.find(i => i.numero === f.item)?.descricao ?? '';
    for (const a of (f.atributos as any)?.attributes ?? []) {
      if (!verifyQuote(a.citacao_item ?? '', desc, 8).found) erros.push(`item ${f.item}: citação "${String(a.citacao_item).slice(0, 60)}" não está na descrição persistida`);
    }
  }
  const proposta = dossie.proposta;
  if (proposta?.itens) {
    for (const pi of proposta.itens) {
      const d = decisoes.find(x => x.item === pi.numero);
      if (!d || !VIAVEL.has(d.estado)) erros.push(`proposta inclui item ${pi.numero} sem decisão viável`);
      else if (d.precoProposto !== pi.precoUnitario) erros.push(`proposta: preço do item ${pi.numero} (${pi.precoUnitario}) difere do calculado (${d.precoProposto})`);
      const it = itens.find(i => i.numero === pi.numero);
      if (it && it.quantidade !== pi.quantidade) erros.push(`proposta: quantidade do item ${pi.numero} difere do edital persistido`);
    }
    for (const d of decisoes.filter(x => VIAVEL.has(x.estado) && (x.precoProposto ?? 0) > 0)) {
      if (!proposta.itens.some((pi: any) => pi.numero === d.item)) erros.push(`item ${d.item} viável fora da proposta`);
    }
  }
  const veredito = concluirAnalise(fila as any, dossie.reavaliar === true, dossie.desatualizado === true, dossie.publicacao?.conferida === false, dossie.escopo?.naoAnalisados.length);
  if (dossie.escopo?.naoAnalisados.length && !/não (foi|foram) analisad/.test(veredito.detalhe)) erros.push('veredito omite candidatos não analisados');
  const viaveis = decisoes.filter(d => VIAVEL.has(d.estado)).length;
  if (veredito.liberados + veredito.condicionados !== viaveis) erros.push(`veredito conta ${veredito.liberados + veredito.condicionados} viáveis, store tem ${viaveis}`);
  if (dossie.publicacao?.conferida === false && veredito.estado !== 'revisao_necessaria') erros.push('publicação não conferida, mas o veredito não pede revisão');
  try {
    const rel = prepararDocumento(dossie as Dossier, 'relatorio').markdown;
    for (const d of decisoes) if (!rel.includes(`${d.item}`)) erros.push(`relatório não menciona o item ${d.item}`);
    if (dossie.publicacao?.conferida === false && !/n[ãa]o (est[áa] )?confirmad|n[ãa]o conferid/i.test(rel)) erros.push('relatório omite que a publicação não foi conferida');
  } catch (e) { erros.push(`relatório não gerado: ${e instanceof Error ? e.message : e}`); }
  if (proposta?.itens?.length) {
    try {
      const prop = prepararDocumento(dossie as Dossier, 'proposta').markdown;
      if (dossie.publicacao?.conferida === false && !/n[ãa]o (est[áa] )?confirmad|n[ãa]o conferid|minuta/i.test(prop)) erros.push('PDF da proposta omite que a publicação não foi conferida');
      if (proposta.origemDados === 'sinteticos' && !/fict[íi]ci|sint[ée]tic/i.test(prop)) erros.push('PDF da proposta omite que empresa e catálogo são fictícios');
    } catch (e) { if (!(e instanceof DocumentoError)) erros.push(`proposta não gerada: ${e instanceof Error ? e.message : e}`); }
  }
  return erros;
}
