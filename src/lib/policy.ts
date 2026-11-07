// Política da empresa: decide se o agente pode agir sozinho ou se a ação vira escalada.
// Falha segura: política ausente/inválida, recheque não ok, dado desconhecido ou ação desconhecida → não permitido.
import type { AcaoContexto, AcaoTipo, AvaliacaoPolitica, Politica } from './contracts.ts';

const ESCLARECIMENTOS = ['nao_informado', 'variante_nao_coberta', 'marca_referencia'];
const ESCALAR = ['impugnacao', 'valor_acima_limite', 'prazo_vencido_com_duvida', 'pregao_alterado'];

/** Lista de problemas da política; vazia quando ela é válida. */
export function validatePolitica(p: unknown): string[] {
  if (!p || typeof p !== 'object') return ['política ausente'];
  const x = p as Record<string, unknown>;
  const errs: string[] = [];
  const num = (k: string, min = 0) => { if (typeof x[k] !== 'number' || !Number.isFinite(x[k] as number) || (x[k] as number) < min) errs.push(`${k}: número ≥ ${min}`); };
  num('margemMinima'); num('margemAlvo'); num('valorMaxAutomatico'); num('monitorMinutos', 1);
  if (typeof x.margemAlvo === 'number' && typeof x.margemMinima === 'number' && x.margemAlvo < x.margemMinima) errs.push('margemAlvo menor que margemMinima');
  if (typeof x.exigirTodosAtributosAtende !== 'boolean') errs.push('exigirTodosAtributosAtende: boolean');
  const list = (k: string, allowed: string[]) => {
    if (!Array.isArray(x[k]) || !(x[k] as unknown[]).every(v => typeof v === 'string' && allowed.includes(v))) errs.push(`${k}: lista com valores de ${allowed.join(', ')}`);
  };
  list('esclarecimentosAutomaticos', ESCLARECIMENTOS); list('sempreEscalar', ESCALAR);
  if (!Array.isArray(x.turnos) || !(x.turnos as unknown[]).every(t => typeof t === 'string' && /^\d{2}:\d{2}$/.test(t))) errs.push('turnos: lista de "HH:MM"');
  return errs;
}

const nega = (escalar: boolean, motivo: string): AvaliacaoPolitica => ({ permitido: false, escalar, motivo });
const BRL = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function evaluate(acao: AcaoTipo, c: AcaoContexto, politica: Politica | undefined): AvaliacaoPolitica {
  const errs = validatePolitica(politica);
  if (errs.length) return nega(true, `política ausente ou inválida (${errs.join('; ')}): nenhuma ação automática`);
  const p = politica!;

  // Recheque antes de qualquer ação externa.
  if (c.recheque?.status !== 'ok') {
    const motivo = c.recheque?.status === 'bloquear' ? c.recheque.motivo : 'recheque ausente';
    if (motivo === 'fonte_indisponivel') return nega(false, 'fonte indisponível no recheque: não age; tenta no próximo ciclo');
    if (motivo === 'arquivos_mudaram') return nega(p.sempreEscalar.includes('pregao_alterado'), 'pregão alterado desde a análise (arquivos novos): reavaliar antes de agir');
    if (motivo === 'recheque ausente') return nega(true, 'recheque ausente: nenhuma ação sem conferir o pregão');
    return nega(false, `pregão ${motivo}: ação bloqueada`);
  }

  if (acao === 'impugnar') return nega(true, 'impugnação sempre passa por decisão humana');

  if (acao === 'enviar_esclarecimento') {
    const e = c.esclarecimento;
    if (!e) return nega(true, 'esclarecimento sem motivo e prazo informados');
    // Com o prazo vencido a dúvida não se resolve por esclarecimento: sempre decisão humana.
    if (!e.prazoAberto) return nega(true, 'prazo de esclarecimento vencido com dúvida em aberto');
    if (!p.esclarecimentosAutomaticos.includes(e.motivo)) return nega(true, `esclarecimento por "${e.motivo}" não é automático na política`);
    return { permitido: true, escalar: false, motivo: `esclarecimento automático permitido (${e.motivo}, prazo aberto)` };
  }

  if (acao === 'enviar_proposta') {
    if (!c.decisoes?.length) return nega(false, 'proposta sem itens: nada a enviar');
    const contagem = (estado: string) => c.decisoes.filter(d => d.estado === estado).length;
    if (contagem('nao_disputar')) return nega(true, 'proposta inclui item marcado como não disputar: inconsistência');
    if (contagem('escalar') || contagem('esclarecer')) return nega(true, 'proposta inclui item que precisa de escalada ou esclarecimento');
    if (contagem('disputar_com_pendencia')) return nega(true, 'proposta com pendência (documento ou cobertura) exige decisão humana');
    if (p.exigirTodosAtributosAtende && contagem('disputar') !== c.decisoes.length) return nega(true, 'nem todos os itens estão em disputar');
    if (c.valor == null || !Number.isFinite(c.valor)) return nega(true, 'valor da proposta desconhecido');
    if (c.valor > p.valorMaxAutomatico) return nega(true, `valor ${BRL(c.valor)} acima do limite automático de ${BRL(p.valorMaxAutomatico)}`);
    return { permitido: true, escalar: false, motivo: `todos os itens em disputar; valor ${BRL(c.valor)} dentro do limite` };
  }

  return nega(true, `ação desconhecida: ${String(acao)}`);
}
