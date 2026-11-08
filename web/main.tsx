import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { InboxIcon } from 'lucide-react';
import type { Escalation, HistoricoPregao, Item, Dossier, Pauta, Proof, QueueItem, Today, Turnos } from '../src/server/contract.ts';
import type { AnalysisStarted, OnboardingData } from '../src/server/onboarding.ts';
import { ApiView, request, useApi, View } from '@/lib/api';
import { AppLink, EmptyState, Page, PageHeader } from '@/kit';
import { Onboarding } from '@/components/onboarding';
import { TooltipProvider } from '@/components/ui/tooltip';
import { OnboardingFrame, Shell } from '@/shell';
import { AgendaScreen, DossierScreen, Historico, ItemScreen, ProofScreen, QueueScreen, TodayScreen } from '@/screens';
import { Acompanhamento, PendingWorkspace } from '@/components/analysis-workspace';
import { dossierRoute, itemRoute, turnoRoute } from '@/lib/routes';
import './style.css';

const currentPath = () => window.location.hash.replace(/^#\/?/, '') || 'onboarding';

function App() {
  const [path, setPath] = useState(currentPath);
  const approvals = useApi<Escalation[]>('escaladas');
  const pending = approvals.data?.dados.length ?? 0;
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (window.location.hash) {
      main.current?.focus();
      window.scrollTo(0, 0);
    }
  }, [path]);

  if (path === 'onboarding' || path === 'onboarding/editais') return <OnboardingFrame mainRef={main}>
    <View<OnboardingData> path="onboarding" poll={false}>{data => <Onboarding key={path} data={data} escolherEdital={path.endsWith('/editais')}
      iniciar={async tenderId => (await request<AnalysisStarted>('onboarding/analisar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tenderId }),
      })).dados} />}</View>
  </OnboardingFrame>;

  const turno = turnoRoute(path);
  const item = itemRoute(path);
  const dossier = dossierRoute(path);
  let view;
  if (turno) {
    view = <View<Turnos> key="turnos" path="turnos">{(data, _, lastRead) => turno.id
      ? data.turnos.some(entry => entry.id === turno.id)
        ? <Acompanhamento data={{ ...data, turnos: data.turnos.filter(entry => entry.id === turno.id) }} lastRead={lastRead} expandir />
        : <Page><PageHeader title="Turno indisponível" /><AppLink href="#/turnos">Ver todos os turnos</AppLink></Page>
      : <Acompanhamento data={data} lastRead={lastRead} />}</View>;
  }
  else if (path === 'historico') view = <View<HistoricoPregao[]> key={path} path={path}>{rows => <Historico rows={rows} />}</View>;
  else if (path === 'hoje') view = <View<Today> key={path} path={path}>{data => <TodayScreen data={data} />}</View>;
  else if (path === 'pauta') view = <View<Pauta> key={path} path={path}>{data => <AgendaScreen data={data} />}</View>;
  else if (path === 'fila') view = <View<QueueItem[]> key={path} path={path}>{rows => <QueueScreen rows={rows} />}</View>;
  else if (path === 'escaladas') view = <ApiView resource={approvals}>{(rows, refresh) => <PendingWorkspace rows={rows} refresh={refresh} />}</ApiView>;
  else if (path === 'prova') view = <View<Proof> key={path} path={path} poll={false}>{data => <ProofScreen data={data} />}</View>;
  else if (item) view = <View<Item> key={item.api} path={item.api}>{entry => <ItemScreen item={entry} />}</View>;
  else if (dossier) view = <View<Dossier> key={dossier.api} path={dossier.api}>{data => <DossierScreen data={data} />}</View>;
  else view = <Page>
    <EmptyState icon={<InboxIcon />} title="Página indisponível" />
    <AppLink href="#/turnos">Voltar ao acompanhamento</AppLink>
  </Page>;

  return <Shell path={path} pending={pending} amostra={approvals.data?.origem === 'amostra'} mainRef={main}>{view}</Shell>;
}

createRoot(document.getElementById('root')!).render(
  <TooltipProvider>
    <App />
  </TooltipProvider>,
);
