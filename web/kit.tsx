import type { ReactNode } from 'react';
import { ExternalLinkIcon } from 'lucide-react';
import type { Source, Trace, TurnoStatus } from '../src/server/contract.ts';
import { duration, money } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Trace as TraceList, TraceCollapsible, TraceCollapsibleContent, TraceCollapsibleTrigger, TraceDescription, TraceLine, TraceTitle } from '@/components/ui/trace';

const statusVariant: Record<TurnoStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  ativo: 'default', concluido: 'secondary', incompleto: 'outline', sem_atualizacao: 'outline', falhou: 'destructive',
};

export function StatusBadge({ status, label }: { status: TurnoStatus; label: string }) {
  return <Badge variant={statusVariant[status]}>{label}</Badge>;
}

export function PageHeader({ title, detail, actions }: { title: string; detail?: string; actions?: ReactNode }) {
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="flex max-w-2xl flex-col gap-1">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{title}</h1>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>;
}

export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">{children}</div>;
}

export function Metrics({ items }: { items: [string, string | number][] }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {items.map(([label, value]) => <Card key={label} size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl">{value}</CardTitle>
      </CardHeader>
    </Card>)}
  </div>;
}

export function AppLink({ href, children, external = false }: { href: string; children: ReactNode; external?: boolean }) {
  return <Button variant="link" nativeButton={false} render={external
    ? <a href={href} target="_blank" rel="noreferrer" />
    : <a href={href} />}>
    {children}
    {external && <ExternalLinkIcon data-icon="inline-end" />}
  </Button>;
}

export function Evidence({ source, quote = false }: { source: Source; quote?: boolean }) {
  const safe = /^https?:\/\//i.test(source.url) || /^\/(?![/\\])/.test(source.url);
  return <div className="flex flex-col gap-2">
    {quote && source.citacao && <blockquote className="border-l border-border pl-3 text-sm text-muted-foreground">{source.citacao}</blockquote>}
    {safe && <AppLink href={source.url} external>Ver fonte: {source.nome}</AppLink>}
  </div>;
}

export function Trail({ entries }: { entries: Trace[] }) {
  if (!entries.length) return <p className="text-sm text-muted-foreground">Rastro ainda indisponível.</p>;
  return <TraceList>
    {entries.map((entry, index) => {
      const line = <TraceLine>
        <TraceTitle>{entry.ferramenta}</TraceTitle>
        <TraceDescription>
          {entry.ms !== undefined && duration(entry.ms)}
          {entry.ms !== undefined && entry.custoUsd !== undefined && ' · '}
          {entry.custoUsd !== undefined && money(entry.custoUsd, 'USD')}
        </TraceDescription>
      </TraceLine>;
      return entry.entrada || entry.saida ? <TraceCollapsible key={index}>
        <TraceCollapsibleTrigger aria-label={'Ver rastro: ' + entry.ferramenta}>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <dl className="flex flex-col gap-2">
            {entry.entrada && <div><dt className="font-medium">Entrada</dt><dd className="whitespace-pre-wrap wrap-anywhere">{entry.entrada}</dd></div>}
            {entry.saida && <div><dt className="font-medium">Saída</dt><dd className="whitespace-pre-wrap wrap-anywhere">{entry.saida}</dd></div>}
          </dl>
        </TraceCollapsibleContent>
      </TraceCollapsible> : <div key={index}>{line}</div>;
    })}
  </TraceList>;
}

export function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">{icon}</EmptyMedia>
      <EmptyTitle>{title}</EmptyTitle>
      {description && <EmptyDescription>{description}</EmptyDescription>}
    </EmptyHeader>
  </Empty>;
}
