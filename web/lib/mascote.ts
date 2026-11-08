import type { TurnoStatus } from '../../src/server/contract.ts';
import { turnoRoute } from './routes.ts';

export type EstadoMascote = 'default' | 'working' | 'sleeping';
export type LugarMascote = 'float' | 'inline' | 'hidden';
export type TelaMascote = 'onboarding' | 'editais' | 'analise' | 'pendencias' | 'consulta';

export type FatosMascote = {
  tela: TelaMascote;
  passo?: 1 | 2 | 3;
  iniciando?: boolean;
  turnosConhecidos?: boolean;
  listaVazia?: boolean;
  algumAtivo?: boolean;
  analise?: { status: TurnoStatus; mostraResultado: boolean } | null;
  pendenciasConhecidas?: boolean;
  pendenciasVazias?: boolean;
};

export type ResumoTurno = { status: TurnoStatus; temResultado: boolean };
export type RelatoTurnos = {
  conhecidos: true;
  turnos: ResumoTurno[];
  analise: { status: TurnoStatus; mostraResultado: boolean } | null;
};

/** Um gesto por situação. O texto da tela continua sendo a única fala. */
export function presencaDoMascote(fatos: FatosMascote): { state: EstadoMascote; placement: LugarMascote } {
  if (fatos.tela === 'onboarding') {
    return { state: fatos.passo === 3 && fatos.iniciando ? 'working' : 'default', placement: 'float' };
  }
  if (fatos.tela === 'editais') {
    if (!fatos.turnosConhecidos) return { state: 'default', placement: 'float' };
    if (fatos.listaVazia) return { state: 'sleeping', placement: 'float' };
    if (fatos.algumAtivo) return { state: 'working', placement: 'float' };
    return { state: 'default', placement: 'float' };
  }
  if (fatos.tela === 'analise') {
    if (!fatos.analise || fatos.analise.mostraResultado) return { state: 'default', placement: 'float' };
    return { state: fatos.analise.status === 'ativo' ? 'working' : 'default', placement: 'inline' };
  }
  if (fatos.tela === 'pendencias') {
    if (fatos.pendenciasConhecidas && fatos.pendenciasVazias) return { state: 'sleeping', placement: 'float' };
    return { state: 'default', placement: 'float' };
  }
  return { state: 'default', placement: 'float' };
}

export function telaDoCaminho(path: string): TelaMascote {
  const turno = turnoRoute(path);
  if (turno) return turno.id ? 'analise' : 'editais';
  if (path === 'escaladas') return 'pendencias';
  return 'consulta';
}

export function fatosDoPainel(path: string, relato: RelatoTurnos | null, pendenciasConhecidas: boolean, pendencias: number): FatosMascote {
  const tela = telaDoCaminho(path);
  if (tela === 'editais') {
    return {
      tela,
      turnosConhecidos: relato?.conhecidos === true,
      listaVazia: relato ? relato.turnos.length === 0 : false,
      algumAtivo: relato?.turnos.some(turno => turno.status === 'ativo') ?? false,
    };
  }
  if (tela === 'analise') return { tela, analise: relato?.analise ?? null };
  if (tela === 'pendencias') return { tela, pendenciasConhecidas, pendenciasVazias: pendencias === 0 };
  return { tela: 'consulta' };
}
