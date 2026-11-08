import { setTimeout } from 'node:timers/promises';
import type { DemoStore } from './contract.ts';
import type { StoreProjection } from './integrated.ts';
import type { LanceStore } from '../lib/store.ts';
import { agruparResultados, eventoTurno, type TurnoEvento } from '../lib/turnos.ts';
import { gerarDocumentoProposta } from '../lib/documento-proposta.ts';
import { planoDoEstado } from '../lib/plano-documentos.ts';
import { priceCheck } from '../lib/rules.ts';
import { newState, type LanceState } from '../lib/tools.ts';

const revisaveis = new Set(['disputar', 'disputar_com_pendencia', 'escalar', 'esclarecer']);

/** Substitui apenas o raciocínio após a decisão humana. Documentos e acompanhamento usam o fluxo real. */
export function criarDecisaoDemo(store: LanceStore, model: StoreProjection, company: LanceState['company'],
  pausa = (ms: number) => setTimeout(ms)): DemoStore['decidir'] {
  const emAndamento = new Set<string>();

  return (id, decisao) => {
    const escalada = store.openEscalations().find(e => e.id === id);
    const resultado = store.resolveEscalation(id, decisao);
    if (resultado.status !== 'salva' || !escalada?.analiseId || !escalada.item) return resultado;

    const { tender, analiseId } = escalada;
    const anterior = model.dossie(tender);
    const turno = model.turnos().turnos.find(t => t.id === analiseId);
    if (!anterior?.itens?.length || anterior.analiseId !== analiseId || anterior.reavaliar || anterior.desatualizado ||
        anterior.continuacaoSimulada || turno?.pregoes.length !== 1 || turno.pregoes[0] !== tender) return resultado;
    const registrar = (e: TurnoEvento) => store.logEvent(eventoTurno({ turno: analiseId, ...e }));
    const aberto = () => store.openEscalations().some(e => e.tender === tender && e.analiseId === analiseId);

    async function retomar() {
      registrar({ tipo: 'retomada' });
      registrar({ tipo: 'atividade', atividade: 'Demo: agente recebeu a decisão da equipe' });
      await pausa(1500);
      registrar({ tipo: 'resultado', concluida: true });
      if (aberto()) {
        registrar({ tipo: 'fim', status: 'incompleto', resultados: [], motivo: 'Ainda há decisões da equipe para este edital. Resolva as demais pendências para continuar.' });
        return;
      }
      registrar({ tipo: 'atividade', atividade: 'Demo: confirmando o encaixe e preparando a minuta', ferramenta: 'draft_proposal_document' });
      await pausa(2500);

      store.transaction(() => {
        const atual = model.dossie(tender);
        if (!atual?.itens || atual.analiseId !== analiseId || atual.reavaliar || atual.desatualizado || aberto()) {
          throw new Error('A análise mudou. Abra o resultado mais recente.');
        }
        const feedback = store.decidedEscalations?.(tender).filter(e => e.analiseId === analiseId) ?? [];
        const cadastro = store.getItems(tender);
        const st = newState(company, '');
        st.tenders[tender] = { orgao: atual.orgao, abertura: atual.sessao };
        st.requirements = store.getRequirements(tender).map(r => ({ tender_id: tender, requirement: r.tipo, quote: r.citacao }));
        const regras = atual.proposta?.regras ?? [];
        st.proposalRules = { [tender]: regras };
        const itens = atual.itens.map(item => {
          const decisoes = feedback.filter(d => d.item === String(item.item));
          const recusado = decisoes.some(d => d.decisao === 'recusar');
          if (!recusado && !revisaveis.has(item.estado)) return item;
          const produto = company.catalogo.find((p: { id: string }) => p.id === item.produto?.id);
          const publicado = cadastro.find(row => row.numero === item.item);
          const politica = company.politica;
          const preco = item.precoUnitario ?? (produto && publicado && politica
            ? priceCheck({ custo: produto.custo, estimativa: publicado.estimativa, sigiloso: publicado.sigiloso,
              margemMinima: politica.margemMinima, margemAlvo: politica.margemAlvo }).precoProposto : null);
          const liberado = !recusado && (item.estado === 'disputar' || decisoes.length > 0) &&
            !!produto?.marca && /^\d{11}$/.test(produto.registroAnvisa ?? '') &&
            item.quantidade !== null && item.quantidade > 0 && preco !== null && preco > 0;
          if (!recusado && !liberado && !['disputar', 'disputar_com_pendencia'].includes(item.estado)) return item;
          const estado = recusado ? 'nao_disputar' : liberado ? 'disputar' : 'escalar';
          const motivos = recusado ? ['Item recusado pela equipe.'] : liberado ? [
            'Encaixe confirmado na simulação da demo.',
            ...decisoes.flatMap(d => d.decisao === 'ajustar' && d.ajuste ? [`Ajuste da equipe considerado na simulação: ${d.ajuste}`] : []),
          ] : ['A simulação não encontrou produto, quantidade ou preço suficientes para montar a oferta.'];
          const precoUnitario = liberado ? preco : null;
          store.upsertDecision({ tenderId: tender, item: item.item, produto: item.produto?.id ?? '', estado, motivos, precoProposto: precoUnitario });
          if (liberado) st.decisions[`${tender}#${item.item}`] = { estado, produto: produto.id, anvisa: item.anvisa };
          return { ...item, estado, motivos, precoUnitario,
            valorTotal: precoUnitario !== null && item.quantidade !== null ? Math.round(precoUnitario * item.quantidade * 100) / 100 : null };
        });
        const ofertados = itens.flatMap(i => st.decisions[`${tender}#${i.item}`] && i.produto && i.quantidade !== null && i.precoUnitario !== null
          ? [{ numero: i.item, descricao: i.descricao, quantidade: i.quantidade, precoUnitario: i.precoUnitario,
            marca: i.produto.marca, modelo: i.produto.nome, registroAnvisa: i.produto.registroAnvisa }] : []);
        const proposta = ofertados.length ? gerarDocumentoProposta({
          pregao: { id: tender, orgao: atual.orgao ?? '', abertura: atual.sessao ?? undefined },
          empresa: company.empresa, itens: ofertados, regras, hoje: st.now, origemDados: 'sinteticos',
        }) : undefined;
        if (proposta) st.proposals = { [tender]: proposta };
        store.upsertDossie(tender, { ...atual, itens, proposta, continuacaoSimulada: true, planoDocumentos: planoDoEstado(st, tender) ?? undefined });
        registrar({ tipo: 'resultado', concluida: true });
        registrar({ tipo: 'fim', status: 'concluido', resultados: agruparResultados(model.fila().filter(i => i.tender === tender), model.dossie) });
      });
    }

    if (!emAndamento.has(analiseId)) {
      emAndamento.add(analiseId);
      void retomar().catch(error => {
        registrar({ tipo: 'fim', status: 'falhou', resultados: [], motivo: error instanceof Error ? error.message : 'Falha na retomada da demonstração.' });
      }).finally(() => emAndamento.delete(analiseId));
    }
    return { ...resultado, registro: { ...resultado.registro, turno: analiseId } };
  };
}
