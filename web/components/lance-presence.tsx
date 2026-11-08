import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { BotAvatar } from 'bot-avatars';
import {
  fatosDoPainel, presencaDoMascote,
  type EstadoMascote, type RelatoTurnos,
} from '@/lib/mascote';

const seed = 0.42;
/** Bake at the library's finest tier, then scale down to the on-screen size. */
const renderSize = 128;
const rotulos: Record<EstadoMascote, string> = {
  default: 'Lance',
  working: 'Lance trabalhando',
  sleeping: 'Lance em repouso',
};

const noop = () => {};
const SetTurnos = createContext<(relato: RelatoTurnos | null) => void>(noop);
const TurnosRelato = createContext<RelatoTurnos | null>(null);
const SetOnboarding = createContext<(relato: { passo: 1 | 2 | 3; iniciando: boolean } | null) => void>(noop);
const OnboardingRelato = createContext<{ passo: 1 | 2 | 3; iniciando: boolean } | null>(null);

function useRelato<T>(set: (value: T | null) => void, relato: T) {
  const key = JSON.stringify(relato);
  useEffect(() => {
    set(JSON.parse(key) as T);
  }, [set, key]);
  useEffect(() => () => set(null), [set]);
}

export function TurnosProvider({ children }: { children: ReactNode }) {
  const [relato, setRelato] = useState<RelatoTurnos | null>(null);
  return <SetTurnos.Provider value={setRelato}><TurnosRelato.Provider value={relato}>{children}</TurnosRelato.Provider></SetTurnos.Provider>;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [relato, setRelato] = useState<{ passo: 1 | 2 | 3; iniciando: boolean } | null>(null);
  return <SetOnboarding.Provider value={setRelato}><OnboardingRelato.Provider value={relato}>{children}</OnboardingRelato.Provider></SetOnboarding.Provider>;
}

export function useRelatarTurnos(relato: RelatoTurnos) {
  useRelato(useContext(SetTurnos), relato);
}

export function useRelatarOnboarding(relato: { passo: 1 | 2 | 3; iniciando: boolean }) {
  useRelato(useContext(SetOnboarding), relato);
}

function LanceGlyph({ state, size, interactive, decorative = false }: {
  state: EstadoMascote; size: number; interactive: boolean; decorative?: boolean;
}) {
  return <span className="lance-glyph" style={{ width: size, height: size }}>
    <BotAvatar
      type="ghost"
      face="eyes"
      state={state}
      size={renderSize}
      shading="plastic"
      color="#2a2a2a"
      brightness={1.05}
      shadow={0.55}
      highlight={0.42}
      depth={0.9}
      rim={0.12}
      spread={1.9}
      light={300}
      speed={0.7}
      jumpEvery={0}
      turn={0.6}
      interactive={interactive}
      theme="light"
      seed={seed}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : rotulos[state]}
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        marginTop: 0,
        marginRight: 0,
        marginBottom: 0,
        marginLeft: 0,
        transform: `translate(-50%, -50%) scale(${size / renderSize})`,
      }}
    />
  </span>;
}

export function LanceFloat({ state, column = false }: { state: EstadoMascote; column?: boolean }) {
  return <div className="lance-float" data-column={column ? '' : undefined} data-state={state}>
    <LanceGlyph state={state} size={32} interactive />
  </div>;
}

export function LanceInline({ state }: { state: EstadoMascote }) {
  return <span className="lance-inline" data-state={state}><LanceGlyph state={state} size={56} interactive={false} decorative /></span>;
}

export function usePresencaPainel(path: string, pending: number, pendingKnown: boolean) {
  return presencaDoMascote(fatosDoPainel(path, useContext(TurnosRelato), pendingKnown, pending));
}

export function OnboardingMascote() {
  const relato = useContext(OnboardingRelato);
  const presenca = presencaDoMascote({ tela: 'onboarding', passo: relato?.passo, iniciando: relato?.iniciando });
  return <LanceFloat state={presenca.state} column />;
}
