// Pauta da manhã (#25, fase 1): o que a noite mudou no dia. Junta prazos legais, diferenças da errata,
// cofre, sanção do cliente e semáforo fiscal. Cada linha responde o que mudou, o que fazer, quem age, até
// quando e de onde vem (origem). Não decide item nem envia nada: só lê o que as regras já calcularam.
import { prazosDoPregao, type Origem, type Prazo } from './prazos.ts';
import { filtroSancao, type EntePregao, type Sancao } from './carteira.ts';
import type { DiffErrata, EstadoDiff } from './errata.ts';
import type { AlertaCofre } from './cofre.ts';
import type { SemaforoFiscal } from './siconfi.ts';
import type { DecisionRow, RequirementRow, TenderRow } from './contracts.ts';

/** Papel da empresa que age; quem é cada papel é configuração da casa do cliente. */
export type Papel = 'analista' | 'juridico' | 'financeiro' | 'lance';
export type TipoLinha = 'prazo' | 'errata' | 'cofre' | 'sancao' | 'fiscal' | 'calendario';
export type Urgencia = 'vencido' | 'hoje' | 'proximos_3_dias' | 'depois';
export type LinhaPauta = {
  id: string; tipo: TipoLinha;
  tenderId: string | null; item?: number;
  /** Pregões afetados quando a linha não é de um pregão só (cofre). */
  pregoes?: string[];
  oQueMudou: string; acao: string; papel: Papel;
  ate: string | null; urgencia: Urgencia | null;
  origem: Origem; acionavel: boolean;
  fonte?: { nome: string; url: string; citacao?: string };
  prazo?: Prazo; estado?: EstadoDiff;
  /** A errata que gerou a linha foi montada à mão (caso de teste), não aconteceu no PNCP. */
  sintetico?: boolean;
  /** Preenchidos pela leitura (read-model): há dossiê do pregão e decisão do item para abrir. */
  dossie?: boolean; itemDisponivel?: boolean;
};
export type Pauta = { data: string; linhas: LinhaPauta[]; contagem: { acionaveis: number; informativas: number } };
export type PregaoPauta = {
  tender: TenderRow; decisoes: DecisionRow[]; requisitos: RequirementRow[];
  diff?: DiffErrata | null; ente?: EntePregao; semaforo?: SemaforoFiscal | null;
  ataSessao?: { data: string; url: string } | null;
};

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const reais = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
const pncpUrl = (id: string) => /^\d{14}\/\d{4}\/\d+$/.test(id) ? `https://pncp.gov.br/app/editais/${id}` : null;
const DIA = 86400_000;
function urgencia(ate: string | null, hoje: string): Urgencia | null {
  if (!ate) return null;
  const dias = Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / DIA);
  return dias < 0 ? 'vencido' : dias === 0 ? 'hoje' : dias <= 3 ? 'proximos_3_dias' : 'depois';
}
const NOME_ESTADO: Record<EstadoDiff, [string, string]> = {
  reaproveitada: ['reaproveitada', 'reaproveitadas'], recalculada: ['recalculada', 'recalculadas'], reavaliada: ['reavaliada', 'reavaliadas'],
  citacao_orfa: ['citação órfã', 'citações órfãs'], ilegivel: ['ilegível', 'ilegíveis'],
};
const ESTADO_ITEM: Record<string, string> = { quantidade: 'quantidade', estimativa: 'estimativa', descricao: 'descrição', sigiloso: 'sigilo do orçamento' };

export function montarPauta(e: { hoje: string; pregoes: PregaoPauta[]; cofre?: AlertaCofre[]; sancoes: Sancao[] | null | undefined }): Pauta {
  const linhas: LinhaPauta[] = [];
  const add = (l: Omit<LinhaPauta, 'id' | 'urgencia'> & { chave: string }) => {
    const { chave, ...resto } = l;
    linhas.push({ ...resto, id: `${l.tipo}:${l.tenderId ?? '-'}:${l.item ?? '-'}:${chave}`, urgencia: urgencia(l.ate, e.hoje) });
  };

  for (const p of e.pregoes) {
    const t = p.tender, id = t.id;
    const abertura = t.abertura?.slice(0, 10) ?? null;
    if (!abertura || abertura < e.hoje) continue;
    const url = pncpUrl(id);
    const fonte = url ? { nome: 'Publicação do pregão no PNCP', url } : undefined;
    const prazos = prazosDoPregao({ abertura: t.abertura, hoje: e.hoje, ataSessao: p.ataSessao,
      prazoEditalCitacao: p.requisitos.find(r => r.tipo === 'prazo_esclarecimento')?.citacao });
    const prazo = (acao: Prazo['acao']) => prazos.find(x => x.acao === acao)!;
    const sintetico = p.diff?.sintetico ? { sintetico: true } : {};
    const datasDeLei: string[] = [];

    for (const d of p.decisoes.filter(x => x.estado === 'esclarecer')) {
      const esc = prazo('esclarecimento');
      const aberto = esc.data !== null && e.hoje <= esc.data;
      if (aberto) datasDeLei.push(esc.data!);
      add({ tipo: 'prazo', chave: 'esclarecimento', tenderId: id, item: d.item, papel: 'analista', origem: esc.origem, prazo: esc,
        oQueMudou: `Item ${d.item} em esclarecimento: ${d.motivos.join('; ')}`,
        acao: aberto ? `Esclarecimento do item ${d.item} até ${br(esc.data!)} (${esc.artigo})` : `Prazo de esclarecimento ${esc.data ? 'encerrado em ' + br(esc.data) : 'não calculado'}`,
        ate: esc.data, acionavel: aberto, fonte: esc.citacao && fonte ? { ...fonte, citacao: esc.citacao } : fonte });
    }

    if (abertura === e.hoje && p.decisoes.some(x => x.estado === 'disputar' || x.estado === 'disputar_com_pendencia')) {
      const ri = prazo('recurso_intencao');
      add({ tipo: 'prazo', chave: 'sessao', tenderId: id, papel: 'analista', origem: ri.origem, prazo: ri, ate: ri.data, acionavel: true, fonte,
        oQueMudou: 'Sessão do pregão hoje', acao: 'Acompanhar a sessão: a intenção de recurso é imediata, sob pena de preclusão (art. 165, §1º, I)' });
    }

    const diff = p.diff;
    if (diff) {
      const n = diff.contagem;
      const partes = (Object.entries(n) as [EstadoDiff, number][]).filter(([, v]) => v > 0)
        .map(([k, v]) => `${v} ${NOME_ESTADO[k][v > 1 ? 1 : 0]}`);
      add({ tipo: 'errata', chave: 'resumo', tenderId: id, papel: 'lance', origem: 'publicado', ate: null, acionavel: false, fonte, ...sintetico,
        oQueMudou: `Errata conferida sem modelo: ${partes.join(', ') || 'nenhuma evidência a conferir'}`, acao: 'Nada a fazer: registro do que foi reaproveitado' });
      if (diff.abertura.estado === 'mudou') {
        add({ tipo: 'errata', chave: 'abertura', tenderId: id, papel: 'analista', origem: 'publicado', ate: abertura, acionavel: false, fonte, ...sintetico,
          oQueMudou: `Abertura mudou: ${diff.abertura.antes ?? 'sem data'} → ${diff.abertura.depois ?? 'sem data'}`, acao: 'Prazos recalculados pela nova data' });
      }
      const pr = diff.prazoNaoReaberto;
      if (pr) {
        const campos = [...new Set(diff.itens.filter(i => pr.itens.includes(i.item))
          .flatMap(i => i.novo ? ['item novo'] : i.removido ? ['item removido'] : i.mudancas.map(m => ESTADO_ITEM[m.campo])))];
        if (pr.acionavel) datasDeLei.push(pr.prazo.data!);
        add({ tipo: 'errata', chave: 'art55', tenderId: id, papel: 'juridico', origem: 'calculado', prazo: pr.prazo, ate: pr.prazo.data, acionavel: pr.acionavel, fonte, ...sintetico,
          oQueMudou: `Errata mudou ${campos.join(', ')} do${pr.itens.length > 1 ? 's itens' : ' item'} ${pr.itens.join(', ')} sem reabrir o prazo de propostas (${pr.artigo})`,
          acao: pr.acionavel ? `Decidir: pedir esclarecimento ou impugnar até ${br(pr.prazo.data!)} (${pr.prazo.artigo})`
            : `Prazo de impugnação ${pr.prazo.data ? 'encerrado em ' + br(pr.prazo.data) : 'não calculado'}: registro informativo` });
      }
      for (const i of diff.itens) {
        if (i.evidencia === 'citacao_orfa') add({ tipo: 'errata', chave: 'orfa', tenderId: id, item: i.item, papel: 'lance', origem: 'publicado', estado: 'citacao_orfa',
          ate: abertura, acionavel: true, fonte, ...sintetico, oQueMudou: `Item ${i.item}: ${i.motivo}`, acao: `Reavaliar o encaixe do item ${i.item} com o trecho novo` });
        if (i.removido) add({ tipo: 'errata', chave: 'removido', tenderId: id, item: i.item, papel: 'analista', origem: 'publicado', ate: null, acionavel: false, fonte, ...sintetico,
          oQueMudou: `Item ${i.item} removido do pregão`, acao: 'A decisão anterior deste item não vale mais' });
        if (i.novo) add({ tipo: 'errata', chave: 'novo', tenderId: id, item: i.item, papel: 'lance', origem: 'publicado', ate: abertura, acionavel: true, fonte, ...sintetico,
          oQueMudou: `Item ${i.item} incluído pela errata`, acao: `Analisar o item novo ${i.item}` });
        const pc = i.preco;
        if (pc?.estado === 'recalculada') {
          const mud = i.mudancas.filter(m => m.campo !== 'descricao').map(m => `${ESTADO_ITEM[m.campo]} ${m.antes ?? '—'} → ${m.depois ?? '—'}`).join('; ');
          const conta = pc.depois !== null && pc.total !== null ? `preço ${reais(pc.depois)} e total ${reais(pc.total)} recalculados pelo código` : pc.motivo;
          const precisa = pc.viavel !== true;
          add({ tipo: 'errata', chave: 'recalculada', tenderId: id, item: i.item, papel: precisa ? 'analista' : 'lance', origem: 'calculado', estado: 'recalculada',
            ate: precisa ? abertura : null, acionavel: precisa, fonte, ...sintetico, oQueMudou: `Item ${i.item}: ${mud}; ${conta}`,
            acao: pc.viavel === false ? `Revisar a disputa do item ${i.item}: o preço deixou de caber na estimativa`
              : pc.viavel === null ? `Definir o preço do item ${i.item}: sem estimativa utilizável` : 'Nada a fazer: o código recalculou' });
        }
      }
      if (diff.proposta.excedeLimite) add({ tipo: 'errata', chave: 'limite', tenderId: id, papel: 'analista', origem: 'calculado', ate: abertura, acionavel: true, fonte, ...sintetico,
        oQueMudou: `Total da proposta passou a ${reais(diff.proposta.total!)}`, acao: `Aprovar a proposta: acima do limite automático de ${reais(diff.proposta.limite)}` });
      for (const x of diff.exigencias.filter(x => x.estado === 'citacao_orfa')) add({ tipo: 'errata', chave: `exigencia-${x.tipo}`, tenderId: id, papel: 'lance', origem: 'publicado',
        estado: 'citacao_orfa', ate: abertura, acionavel: true, fonte: fonte ? { ...fonte, citacao: x.citacao } : undefined, ...sintetico,
        oQueMudou: `Exigência ${x.tipo}: a citação gravada não está no texto novo`, acao: `Reconferir a exigência ${x.tipo} no edital novo` });
      if (diff.exigencias.some(x => x.estado === 'ilegivel')) add({ tipo: 'errata', chave: 'ilegivel', tenderId: id, papel: 'analista', origem: 'publicado', estado: 'ilegivel',
        ate: abertura, acionavel: true, fonte, ...sintetico, oQueMudou: 'Texto novo do edital ilegível (ZIP, escaneado ou indisponível)', acao: 'Ler a errata e reconferir as exigências' });
    }

    if (datasDeLei.length) {
      const ate = datasDeLei.sort()[0];
      add({ tipo: 'calendario', chave: 'feriado-local', tenderId: id, papel: 'analista', origem: 'calculado', ate, acionavel: true, fonte,
        oQueMudou: `Prazos calculados só com feriados nacionais (${t.uf || 'UF não informada'})`, acao: `Conferir feriado local do órgão antes de ${br(ate)}` });
    }

    if (e.sancoes) {
      const f = filtroSancao(p.ente ?? {}, e.sancoes, e.hoje);
      if (f.status !== 'livre') add({ tipo: 'sancao', chave: f.status, tenderId: id, papel: 'juridico', origem: f.status === 'fora' ? 'publicado' : 'aguardando',
        ate: abertura, acionavel: true, fonte, oQueMudou: f.motivo,
        acao: f.status === 'fora' ? 'Pregão fora da carteira: não disputar' : 'Conferir a sanção antes de disputar' });
    }
    if (p.semaforo?.status === 'vermelho') add({ tipo: 'fiscal', chave: 'semaforo', tenderId: id, papel: 'financeiro', origem: 'publicado', ate: null, acionavel: false,
      fonte: p.semaforo.fonte ? { nome: 'RGF no SICONFI', url: p.semaforo.fonte } : fonte,
      oQueMudou: `Semáforo fiscal do órgão: ${p.semaforo.resumo}`, acao: 'Considerar no risco de pagamento; não muda a decisão do item' });
  }

  if (!e.sancoes && e.sancoes !== undefined) add({ tipo: 'sancao', chave: 'ceis', tenderId: null, papel: 'juridico', origem: 'aguardando', ate: null, acionavel: true,
    oQueMudou: 'CEIS do cliente não consultado nesta rodada', acao: 'Conferir sanções do cliente: até lá nenhum pregão fica liberado pela carteira' });

  for (const a of e.cofre ?? []) add({ tipo: 'cofre', chave: a.documento ?? a.exigencia, tenderId: null, pregoes: a.pregoes.map(x => x.tenderId),
    papel: 'analista', origem: 'informado_cliente', ate: a.renovarAte, acionavel: true, oQueMudou: a.resumo,
    acao: a.status === 'ausente' ? `Incluir ${a.documento ?? a.exigencia} no cofre` : `Renovar ${a.documento ?? a.exigencia}` });

  linhas.sort((a, b) => Number(b.acionavel) - Number(a.acionavel) || (a.ate ?? '9999').localeCompare(b.ate ?? '9999') || a.id.localeCompare(b.id));
  const acionaveis = linhas.filter(l => l.acionavel).length;
  return { data: e.hoje, linhas, contagem: { acionaveis, informativas: linhas.length - acionaveis } };
}
