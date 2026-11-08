import type { ReactNode } from 'react';
import { ActivityIcon, CircleCheckIcon, FlaskConicalIcon, HistoryIcon, ListChecksIcon, ListIcon, SunIcon } from 'lucide-react';
import type { OnboardingData } from '../src/server/onboarding.ts';
import { useApi } from '@/lib/api';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarInset, SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarRail,
  SidebarSeparator, SidebarTrigger, useSidebar,
} from '@/components/ui/sidebar';

const groups = [
  {
    label: 'Operação',
    items: [
      { id: 'turnos', title: 'Acompanhamento', icon: ActivityIcon },
      { id: 'hoje', title: 'Hoje', icon: SunIcon },
      { id: 'pauta', title: 'Pauta', icon: ListChecksIcon },
      { id: 'fila', title: 'Fila', icon: ListIcon },
    ],
  },
  {
    label: 'Decisão',
    items: [{ id: 'escaladas', title: 'Aprovações', icon: CircleCheckIcon }],
  },
  {
    label: 'Registro',
    items: [
      { id: 'historico', title: 'Histórico', icon: HistoryIcon },
      { id: 'prova', title: 'Prova', icon: FlaskConicalIcon },
    ],
  },
] as const;

function crumbs(path: string) {
  if (path === 'turnos' || path.startsWith('turnos/')) {
    const nested = path.startsWith('turnos/');
    return nested
      ? [{ href: '#/turnos', label: 'Acompanhamento' }, { label: 'Turno' }]
      : [{ label: 'Acompanhamento' }];
  }
  const known: Record<string, string> = {
    hoje: 'Hoje', pauta: 'Pauta', fila: 'Fila', escaladas: 'Aprovações', historico: 'Histórico', prova: 'Prova',
  };
  if (known[path]) return [{ label: known[path] }];
  if (path.startsWith('itens/')) return [{ href: '#/fila', label: 'Fila' }, { label: 'Item' }];
  if (path.startsWith('dossies/')) return [{ label: 'Dossiê' }];
  return [{ label: 'Página indisponível' }];
}

type ShellProps = {
  path: string; pending: number; amostra: boolean; mainRef: React.RefObject<HTMLElement | null>; children: ReactNode;
};

export function Shell(props: ShellProps) {
  return <SidebarProvider><ShellContent {...props} /></SidebarProvider>;
}

function ShellContent({ path, pending, amostra, mainRef, children }: ShellProps) {
  const { setOpenMobile } = useSidebar();
  const closeMobile = () => setOpenMobile(false);
  const perfil = useApi<OnboardingData>('onboarding', false);
  const empresa = perfil.data?.dados.empresa.nome;
  const trail = crumbs(path);
  return <>
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Lance" onClick={closeMobile} render={<a href="#/turnos" />}>
              <img src="/mark.png" alt="" className="size-8" />
              <span className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                <span className="truncate font-semibold tracking-tight">Lance</span>
                <span className="truncate text-xs text-muted-foreground">Diário de licitações</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {groups.map(group => <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map(item => {
                const active = path === item.id || path.startsWith(item.id + '/');
                const Icon = item.icon;
                const count = item.id === 'escaladas' ? pending : 0;
                return <SidebarMenuItem key={item.id}>
                  <SidebarMenuButton
                    onClick={closeMobile}
                    isActive={active}
                    tooltip={count > 0 ? `${item.title}, ${count} ${count === 1 ? 'pendência' : 'pendências'}` : item.title}
                    render={<a href={'#/' + item.id} aria-current={active ? 'page' : undefined} />}
                  >
                    <Icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                  {count > 0 && <SidebarMenuBadge>
                    {count}<span className="sr-only"> {count === 1 ? 'pendência' : 'pendências'}</span>
                  </SidebarMenuBadge>}
                </SidebarMenuItem>;
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>)}
      </SidebarContent>
      <SidebarFooter>
        <SidebarSeparator />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip={empresa ?? 'Empresa simulada'} onClick={closeMobile} render={<a href="#/onboarding" />}>
              <Avatar>
                <AvatarFallback>{(empresa ?? 'E').slice(0, 1)}</AvatarFallback>
              </Avatar>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{empresa ?? 'Empresa simulada'}</span>
                <span className="truncate text-xs text-muted-foreground">Preparar demonstração</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
    <SidebarInset ref={mainRef} tabIndex={-1} className="outline-none">
      <header className="flex h-14 shrink-0 items-center gap-2 px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink render={<a href="#/turnos" />}>Lance</BreadcrumbLink>
            </BreadcrumbItem>
            {trail.map((crumb, index) => <span key={crumb.label} className="contents">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {crumb.href && index < trail.length - 1
                  ? <BreadcrumbLink render={<a href={crumb.href} />}>{crumb.label}</BreadcrumbLink>
                  : <BreadcrumbPage>{crumb.label}</BreadcrumbPage>}
              </BreadcrumbItem>
            </span>)}
          </BreadcrumbList>
        </Breadcrumb>
        {amostra && <Badge variant="outline" className="ml-auto">Demonstração</Badge>}
      </header>
      <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
        {children}
      </div>
    </SidebarInset>
  </>;
}

export function OnboardingFrame({ children, mainRef }: { children: ReactNode; mainRef: React.RefObject<HTMLElement | null> }) {
  return <div className="min-h-svh bg-background">
    <header className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-4">
      <a href="#/onboarding" className="flex items-center gap-2">
        <img src="/mark.png" alt="" className="size-8" />
        <span className="font-heading text-lg font-semibold tracking-tight">Lance</span>
      </a>
      <Badge variant="outline" render={<a href="#/turnos" />}>Abrir painel</Badge>
    </header>
    <main ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 pt-8 pb-16 outline-none">
      {children}
    </main>
  </div>;
}
