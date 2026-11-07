// Agendador do Lance: dispara turnos nos horários da política (America/Recife) e o monitor a cada
// monitorMinutos, sem clique. Trava: nunca dois turnos ao mesmo tempo, e o monitor não roda durante um turno.
// Um horário não roda duas vezes, nem depois de reiniciar (consulta os eventos turno_inicio no store).
// Ao ligar fora de horário, roda só o turno mais recente que já passou no dia. Política inválida bloqueia tudo.
import { validatePolitica } from './policy.ts';
import { runMonitor as defaultMonitor, type MonitorResult } from './monitor.ts';
import type { Politica } from './contracts.ts';
import type { LanceStore } from './store.ts';

export type TurnContext = { motivo: 'agendado' | 'demo'; horario?: string };
export type SchedulerDeps = {
  store: LanceStore;
  politica: Politica | undefined;
  runTurn: (ctx: TurnContext) => Promise<{ resumo?: string } | void>;
  runMonitor?: (store: LanceStore) => Promise<MonitorResult>;
  now?: () => Date;
};
export type TickResult = {
  turno: 'nenhum' | 'concluido' | 'falhou' | 'ocupado' | 'bloqueado';
  monitor: 'nenhum' | 'rodou' | 'pulado' | 'falhou' | 'bloqueado';
};

const TZ = 'America/Recife';
function local(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}` };
}
const proximoDia = (data: string) => new Date(Date.parse(`${data}T12:00:00Z`) + 86400e3).toISOString().slice(0, 10);

export function createScheduler(d: SchedulerDeps) {
  const now = d.now ?? (() => new Date());
  const monitor = d.runMonitor ?? ((s: LanceStore) => defaultMonitor(s));
  const erros = validatePolitica(d.politica);
  const turnos = erros.length ? [] : [...d.politica!.turnos].sort();
  const rodados = new Set<string>();
  let rodando = false, bloqueioRegistrado = false, timer: ReturnType<typeof setInterval> | null = null;
  let ultimoMonitor: number | undefined, ultimoTurno: string | undefined;

  const jaRodou = (slot: string) =>
    rodados.has(slot) || d.store.events().some(e => e.tipo === 'turno_inicio' && e.detalhe === `agendado: ${slot}`);

  /** Horário devido agora: o mais recente de hoje que já passou e ainda não rodou. */
  const devido = (): string | null => {
    const { data, hm } = local(now());
    const passados = turnos.filter(t => t <= hm);
    if (!passados.length) return null;
    const slot = `${data} ${passados.at(-1)}`;
    return jaRodou(slot) ? null : slot;
  };

  async function executar(ctx: TurnContext): Promise<'concluido' | 'falhou'> {
    rodando = true;
    if (ctx.horario) rodados.add(ctx.horario);
    const t0 = now().getTime();
    d.store.logEvent({ tipo: 'turno_inicio', resumo: ctx.motivo === 'demo' ? 'turno de demonstração' : `turno das ${ctx.horario!.slice(11)}`, detalhe: ctx.motivo === 'demo' ? 'demo' : `agendado: ${ctx.horario}` });
    try {
      const r = await d.runTurn(ctx);
      d.store.logEvent({ tipo: 'turno_fim', resumo: `turno concluído${r && r.resumo ? `: ${r.resumo}` : ''}`, rastro: [{ ferramenta: 'turno', ms: now().getTime() - t0 }] });
      return 'concluido';
    } catch (e: any) {
      d.store.logEvent({ tipo: 'turno_fim', resumo: `turno falhou: ${String(e?.message ?? e).slice(0, 200)}`, rastro: [{ ferramenta: 'turno', ms: now().getTime() - t0 }] });
      return 'falhou';
    } finally {
      rodando = false;
      ultimoTurno = now().toISOString();
    }
  }

  async function tick(): Promise<TickResult> {
    if (erros.length) {
      if (!bloqueioRegistrado) { d.store.logEvent({ tipo: 'bloqueio', resumo: `agendador parado: política inválida (${erros.join('; ')})` }); bloqueioRegistrado = true; }
      return { turno: 'bloqueado', monitor: 'bloqueado' };
    }
    let m: TickResult['monitor'] = 'nenhum';
    if (rodando) m = 'pulado';
    else if (ultimoMonitor === undefined || now().getTime() - ultimoMonitor >= d.politica!.monitorMinutos * 60e3) {
      ultimoMonitor = now().getTime();
      try { await monitor(d.store); m = 'rodou'; } catch { m = 'falhou'; }
    }
    if (rodando) return { turno: 'ocupado', monitor: m };
    const slot = devido();
    if (!slot) return { turno: 'nenhum', monitor: m };
    return { turno: await executar({ motivo: 'agendado', horario: slot }), monitor: m };
  }

  /** Modo demo: roda um turno daqui a `delayMs`, respeitando a trava. */
  async function runNext(delayMs: number): Promise<'concluido' | 'falhou' | 'ocupado' | 'bloqueado'> {
    if (erros.length) return 'bloqueado';
    await new Promise(r => setTimeout(r, delayMs));
    if (rodando) return 'ocupado';
    return executar({ motivo: 'demo' });
  }

  function status() {
    const { data, hm } = local(now());
    const hoje = turnos.find(t => t > hm);
    const proximoTurno = turnos.length ? (hoje ? `${data} ${hoje}` : `${proximoDia(data)} ${turnos[0]}`) : undefined;
    return { rodando, proximoTurno, ultimoTurno, ultimoMonitor: ultimoMonitor === undefined ? undefined : new Date(ultimoMonitor).toISOString(), bloqueado: erros.length > 0 };
  }

  return {
    tick, runNext, status,
    start(intervalMs = 30_000) { if (!timer) timer = setInterval(() => { tick().catch(() => {}); }, intervalMs); },
    stop() { if (timer) { clearInterval(timer); timer = null; } },
  };
}
