import type { ReactNode } from 'react';
import { FilesIcon, CircleCheckIcon } from 'lucide-react';
import type { OnboardingData } from '../src/server/onboarding.ts';
import { useApi } from '@/lib/api';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
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
    label: 'Sua operação',
    items: [
      { id: 'turnos', title: 'Editais', icon: FilesIcon },
      { id: 'escaladas', title: 'Pendências', icon: CircleCheckIcon },
    ],
  },
] as const;

function crumbs(path: string) {
  if (path === 'turnos' || path.startsWith('turnos/')) {
    const nested = path.startsWith('turnos/');
    return nested
      ? [{ href: '#/turnos', label: 'Editais' }, { label: 'Análise' }]
      : [{ label: 'Editais' }];
  }
  const known: Record<string, string> = {
    hoje: 'Atividade do dia', pauta: 'Agenda completa', fila: 'Todos os itens', escaladas: 'Pendências', historico: 'Histórico', prova: 'Dados da execução',
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
        <Accordion className="group-data-[collapsible=icon]:hidden">
          <AccordionItem value="diagnostico">
            <AccordionTrigger>Informações da execução</AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
                {[['hoje', 'Atividade do dia'], ['pauta', 'Agenda completa'], ['fila', 'Todos os itens'], ['prova', 'Medições e avaliações']].map(([id, label]) => <a key={id} href={'#/' + id} onClick={closeMobile}>{label}</a>)}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
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
      <a href="#/turnos" className="rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-4">Abrir painel</a>
    </header>
    <main ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-2xl px-4 pt-8 pb-16 outline-none">
      {children}
    </main>
  </div>;
}
