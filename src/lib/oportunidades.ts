// Descoberta pública limitada. Nenhum modelo, preço calculado ou autorização de envio neste módulo.
import { mapSearchItem } from './data.ts';
import { matchCatalog, type CatalogoProduto } from './demo.ts';
export type ItemFeed = {
  numero: number;
  descricao: string;
  quantidade: number;
  unidade?: string;
  valorEstimado?: number | null;
};
export type PregaoFeed = {
  id: string;
  orgao: string;
  uf: string;
  municipio?: string;
  objeto: string;
  abertura: string | null;
  situacao: string;
  plataforma: string;
  url: string;
  publicadoEm: string | null;
  atualizadoNaFonteEm: string | null;
  consultadoEm: string;
  fontes: string[];
  itens: ItemFeed[];
};
export type RetratoFeed = {
  versao: 1;
  ultimaSincronizacao: string | null;
  ultimaTentativa: string | null;
  proximaConsultaEm?: string;
  status: 'preparado' | 'atualizando' | 'atualizado' | 'parcial' | 'indisponivel';
  avisos: string[];
  pregoes: PregaoFeed[];
};
export type Oportunidade = Omit<PregaoFeed, 'itens'> & {
  matches: { item: number; produto: string; descricao: string }[];
  itensCandidatos: number;
  disponivel: boolean;
  motivo: string | null;
};
export type FeedView = Omit<RetratoFeed, 'pregoes'> & { pregoes: Oportunidade[] };
export const instanteFonte = (s: string) =>
  Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(s) ? s + '-03:00' : s);
export function filtrarOportunidades(s: RetratoFeed, produtos: CatalogoProduto[], agora: Date): FeedView {
  return {
    ...structuredClone(s),
    pregoes: s.pregoes
      .flatMap((p) => {
        const matches = matchCatalog(p.itens, produtos).map((m) => ({
          ...m,
          descricao: p.itens.find((i) => i.numero === m.item)!.descricao,
        }));
        if (!matches.length) return [];
        const { itens, ...meta } = p;
        const disponivel = /divulgad/i.test(p.situacao) && !!p.abertura && instanteFonte(p.abertura) > agora.getTime();
        return [
          {
            ...structuredClone(meta),
            matches,
            itensCandidatos: new Set(matches.map((m) => m.item)).size,
            disponivel,
            motivo: disponivel ? null : 'Situação ou prazo de recebimento não permite iniciar uma nova análise.',
          },
        ];
      })
      .sort((a, b) => b.itensCandidatos - a.itensCandidatos || a.id.localeCompare(b.id)),
  };
}
const QUERIES = ['instrumental cirurgico', 'material hospitalar', 'seringa', 'mascara', 'cadeira de rodas', 'andador'];
type Consulta = (url: string, signal: AbortSignal) => Promise<any>;
export class FonteLimitadaError extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs = 300_000) {
    super('Fonte retornou HTTP 429.');
    this.retryAfterMs = retryAfterMs;
  }
}
async function consultaPublica(url: string, signal: AbortSignal) {
  if (process.env.LANCE_OFFLINE === '1') throw new Error('Modo offline: dados da última coleta preservados.');
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(8_000)]),
        headers: { Accept: 'application/json' },
      });
      if (r.status === 429) {
        const retry = r.headers.get('retry-after');
        const segundos = retry ? Number(retry) : NaN;
        const atraso = Number.isFinite(segundos) ? segundos * 1000 : retry ? Date.parse(retry) - Date.now() : 300_000;
        throw new FonteLimitadaError(Math.max(300_000, Number.isFinite(atraso) ? atraso : 300_000));
      }
      if (!r.ok) throw new Error(`Fonte retornou HTTP ${r.status}.`);
      return await r.json();
    } catch (e) {
      if (tentativa === 1 || signal.aborted || e instanceof FonteLimitadaError) throw e;
    }
  }
  throw new Error('Fonte indisponível.');
}
/** No máximo 12 buscas, 60 candidatos, 4 páginas de itens por candidato e 25 oportunidades; 90 s por coleta. */
export async function coletarOportunidades(o: {
  anterior: RetratoFeed;
  produtos: CatalogoProduto[];
  consultar?: Consulta;
  now?: () => Date;
  excluidos?: string[];
  sementes?: ReturnType<typeof mapSearchItem>[];
}): Promise<RetratoFeed> {
  const now = o.now ?? (() => new Date());
  const inicio = now().toISOString();
  const timeout = AbortSignal.timeout(90_000);
  const limitada = new AbortController();
  const signal = AbortSignal.any([timeout, limitada.signal]);
  let proximaConsultaEm: string | undefined;
  const limiteDaFonte = (e: unknown) => {
    if (e instanceof FonteLimitadaError) {
      const proxima = new Date(now().getTime() + e.retryAfterMs).toISOString();
      if (!proximaConsultaEm || proxima > proximaConsultaEm) proximaConsultaEm = proxima;
      limitada.abort();
    }
  };
  const get = o.consultar ?? consultaPublica;
  const avisos: string[] = [];
  const candidatos = new Map<string, ReturnType<typeof mapSearchItem>>();
  let buscasOk = 0;
  for (const t of o.sementes ?? []) {
    const id = `${t.cnpj}/${t.ano}/${t.seq}`;
    if (t.plataforma === 'Compras.gov.br' && !o.excluidos?.includes(id)) candidatos.set(id, t);
  }
  // A paginação é limitada, e a união é deduplicada antes de consultar os itens.
  for (let pagina = 1; pagina <= 2; pagina++)
    for (let j = 0; j < QUERIES.length; j += 2)
      await Promise.all(
        QUERIES.slice(j, j + 2).map(async (q) => {
          if (signal.aborted) return;
          try {
            const d = await get(
              `https://pncp.gov.br/api/search/?q=${encodeURIComponent(q)}&tipos_documento=edital&ordenacao=-data&pagina=${pagina}&tam_pagina=20&status=recebendo_proposta`,
              signal,
            );
            if (!Array.isArray(d.items)) throw new Error('Resposta de busca inválida.');
            buscasOk++;
            for (const raw of d.items) {
              const t = mapSearchItem(raw);
              const id = `${t.cnpj}/${t.ano}/${t.seq}`;
              if (
                /^\d{14}\/\d{4}\/\d+$/.test(id) &&
                t.plataforma === 'Compras.gov.br' &&
                /preg[aã]o/i.test(t.modalidade) &&
                !o.excluidos?.includes(id)
              )
                candidatos.set(id, t);
            }
          } catch (e) {
            limiteDaFonte(e);
            avisos.push(`Não foi possível concluir a busca por ${q} (página ${pagina}).`);
          }
        }),
      );
  if (!buscasOk && !candidatos.size && !limitada.signal.aborted)
    throw new Error('Não foi possível consultar o PNCP. Últimos dados preservados.');
  const novas = new Map<string, PregaoFeed>();
  const removidos = new Set<string>();
  const fila = [...candidatos.entries()].slice(0, 60);
  let indice = 0;
  async function worker() {
    while (indice < fila.length && !signal.aborted && novas.size < 25) {
      const [id, t] = fila[indice++];
      try {
        const compraUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${t.cnpj}/compras/${t.ano}/${t.seq}`;
        const d = await get(compraUrl, signal);
        if (
          d.orgaoEntidade?.cnpj !== t.cnpj ||
          Number(d.anoCompra) !== t.ano ||
          Number(d.sequencialCompra) !== t.seq ||
          typeof d.situacaoCompraNome !== 'string'
        )
          throw new Error('Identidade ou metadados da contratação não conferem.');
        if (
          d.usuarioNome !== 'Compras.gov.br' ||
          !/preg[aã]o/i.test(d.modalidadeNome ?? '') ||
          !/divulgad/i.test(d.situacaoCompraNome) ||
          !d.dataEncerramentoProposta ||
          instanteFonte(d.dataEncerramentoProposta) <= now().getTime()
        ) {
          removidos.add(id);
          continue;
        }
        const itens: ItemFeed[] = [];
        const fontes = [compraUrl];
        let completa = false;
        for (let p = 1; p <= 4; p++) {
          const url = `https://pncp.gov.br/api/pncp/v1/orgaos/${t.cnpj}/compras/${t.ano}/${t.seq}/itens?pagina=${p}&tamanhoPagina=100`;
          const a = await get(url, signal);
          if (!Array.isArray(a)) throw new Error('Resposta dos itens inválida.');
          fontes.push(url);
          for (const i of a) {
            if (!Number.isInteger(i.numeroItem) || typeof i.descricao !== 'string' || typeof i.quantidade !== 'number')
              throw new Error('Item sem identificação ou descrição válida.');
            itens.push({
              numero: i.numeroItem,
              descricao: i.descricao,
              quantidade: i.quantidade,
              unidade: i.unidadeMedida,
              valorEstimado: i.orcamentoSigiloso ? null : (i.valorUnitarioEstimado ?? null),
            });
          }
          if (a.length < 100) {
            completa = true;
            break;
          }
        }
        if (new Set(itens.map((i) => i.numero)).size !== itens.length)
          throw new Error('Itens duplicados entre páginas.');
        if (!completa) throw new Error('Limite de páginas de itens atingido.');
        const relacionados = new Set(matchCatalog(itens, o.produtos).map((m) => m.item));
        if (!relacionados.size) {
          removidos.add(id);
          continue;
        }
        const data = (v: unknown) => (typeof v === 'string' && Number.isFinite(instanteFonte(v)) ? v : null);
        novas.set(id, {
          id,
          orgao: d.orgaoEntidade.razaoSocial ?? t.orgao,
          uf: d.unidadeOrgao?.ufSigla ?? t.uf,
          municipio: d.unidadeOrgao?.municipioNome ?? t.municipio,
          objeto: d.objetoCompra ?? t.objeto,
          abertura: data(d.dataEncerramentoProposta),
          situacao: d.situacaoCompraNome,
          plataforma: t.plataforma,
          url: t.url,
          publicadoEm: data(d.dataPublicacaoPncp),
          atualizadoNaFonteEm: data(d.dataAtualizacao),
          consultadoEm: now().toISOString(),
          fontes,
          itens: itens.filter((i) => relacionados.has(i.numero)),
        });
      } catch (e) {
        limiteDaFonte(e);
        avisos.push(
          `Não foi possível verificar os dados de ${id} (${e instanceof Error ? e.message.slice(0, 100) : 'fonte indisponível'}); consulta anterior preservada, se existente.`,
        );
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  if (timeout.aborted) avisos.push('Limite de tempo da coleta atingido.');
  if (limitada.signal.aborted) avisos.push('Coleta interrompida para respeitar o limite da fonte.');
  const unidos = new Map(
    o.anterior.pregoes.filter((p) => !removidos.has(p.id) && !o.excluidos?.includes(p.id)).map((p) => [p.id, p]),
  );
  for (const [id, p] of novas) unidos.set(id, p);
  const preservados = [...unidos.keys()].filter((id) => !novas.has(id)).length;
  if (preservados) avisos.push(`${preservados} oportunidades anteriores não foram reconferidas nesta coleta.`);
  const pregoes = [...unidos.values()]
    .sort((a, b) => (b.publicadoEm ?? '').localeCompare(a.publicadoEm ?? '') || a.id.localeCompare(b.id))
    .slice(0, 25);
  return {
    versao: 1,
    ...(proximaConsultaEm ? { proximaConsultaEm } : {}),
    status: avisos.length ? 'parcial' : 'atualizado',
    ultimaTentativa: inicio,
    ultimaSincronizacao: avisos.length ? o.anterior.ultimaSincronizacao : now().toISOString(),
    avisos,
    pregoes,
  };
}
export function criarFeed(o: {
  inicial: RetratoFeed;
  coletar: (anterior: RetratoFeed) => Promise<RetratoFeed>;
  now?: () => Date;
  salvar?: (s: RetratoFeed) => void;
}) {
  let estado = structuredClone(o.inicial);
  let pendente: Promise<void> | undefined;
  let ultima = 0;
  const now = o.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    retrato: () => structuredClone(estado),
    atualizar(): Promise<void> {
      if (pendente) return pendente;
      if (estado.proximaConsultaEm && Date.parse(estado.proximaConsultaEm) > now().getTime()) return Promise.resolve();
      if (ultima && now().getTime() - ultima < 30_000) return Promise.resolve();
      ultima = now().getTime();
      estado = { ...estado, status: 'atualizando', ultimaTentativa: now().toISOString() };
      // Captura o retrato anterior; falha nunca renova ultimaSincronizacao nem consultadoEm.
      const anterior = structuredClone(estado);
      pendente = Promise.resolve()
        .then(() => o.coletar(anterior))
        .then((novo) => {
          estado = structuredClone(novo);
          o.salvar?.(estado);
        })
        .catch(() => {
          estado = {
            ...anterior,
            status: 'indisponivel',
            avisos: ['Não foi possível atualizar o PNCP. Exibindo a última consulta disponível.'],
          };
        })
        .finally(() => {
          pendente = undefined;
        });
      return pendente;
    },
    iniciar() {
      if (timer) return;
      void this.atualizar();
      timer = setInterval(() => void this.atualizar(), 5 * 60_000);
      timer.unref?.();
    },
    parar() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
export type FeedOportunidades = ReturnType<typeof criarFeed>;
