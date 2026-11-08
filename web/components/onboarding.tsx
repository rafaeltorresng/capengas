import { useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ExternalLinkIcon } from 'lucide-react';
import type { AnalysisStarted, OnboardingData } from '../../src/server/onboarding.ts';
import type { Turnos } from '../../src/server/contract.ts';
import { useApi } from '@/lib/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from '@/components/ui/item';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';

const sessionKey = 'lance-demo-confirmado';
function confirmado() { try { return sessionStorage.getItem(sessionKey) === 'sim'; } catch { return false; } }
const abertura = (raw: string | null) => {
  if (!raw) return 'Abertura não informada';
  const date = new Date(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(raw) ? raw + ':00-03:00' : raw);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short',
  }).format(date) : 'Abertura não informada';
};
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent' });
const steps = ['Empresa', 'Produtos', 'Edital'];

export function Onboarding({ data, escolherEdital, iniciar }: {
  data: OnboardingData; escolherEdital: boolean; iniciar: (id: string) => Promise<AnalysisStarted>;
}) {
  const [passo, setPasso] = useState(escolherEdital && confirmado() ? 3 : 1);
  const [selecionado, setSelecionado] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const turnos = useApi<Turnos>('turnos', passo === 3);
  const emAnalise = new Set(turnos.data?.dados.turnos
    .filter(turno => turno.status === 'ativo' || turno.status === 'sem_atualizacao')
    .flatMap(turno => turno.pregoes));
  const selecaoDisponivel = turnos.data && !emAnalise.has(selecionado) ? selecionado : '';
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); window.scrollTo(0, 0); }, [passo]);
  async function analisar() {
    if (busy || !selecaoDisponivel || !data.analise.disponivel) return;
    setBusy(true); setError('');
    try {
      const job = await iniciar(selecaoDisponivel);
      window.location.hash = '/turnos/' + encodeURIComponent(job.turno);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível iniciar a análise.');
      setBusy(false);
    }
  }
  return <div className="flex w-full flex-col gap-7">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <ol className="demo-steps" aria-label="Etapas de preparação">
        {steps.map((nome, index) => <li key={nome} aria-current={passo === index + 1 ? 'step' : undefined}>
          <span className="demo-step-marker" aria-hidden="true">{passo > index + 1 ? <CheckIcon className="size-3" /> : index + 1}</span>
          {nome}
          {passo > index + 1 && <span className="sr-only">, concluída</span>}
        </li>)}
      </ol>
      <Badge variant="secondary">Demonstração</Badge>
    </div>

    <header className="space-y-2 border-t pt-6">
      <h1 ref={title} tabIndex={-1} className="text-3xl font-semibold tracking-tight outline-none">
        {passo === 1 ? 'Confirme a empresa' : passo === 2 ? 'Confira o catálogo' : 'Escolha um edital'}
      </h1>
      <p className="max-w-xl text-sm text-muted-foreground">
        {passo === 1 ? 'Empresa, catálogo e condições comerciais já preparados com dados fictícios.'
          : passo === 2 ? 'O Lance vai usar estes produtos para conferir o encaixe com o edital.'
          : 'Escolha um edital público para analisar os itens candidatos.'}
      </p>
    </header>

    <div key={passo} className="demo-step-content">
      {passo === 1 && <>
        <Card>
          <CardContent className="space-y-5">
            <div>
              <h2 className="text-xl font-semibold tracking-tight wrap-anywhere">{data.empresa.nome}</h2>
              <p className="text-sm text-muted-foreground">{data.empresa.porte} · {data.empresa.uf}</p>
            </div>
            <dl className="grid grid-cols-2 gap-4 border-t pt-4">
              <div><dt className="text-sm text-muted-foreground">Margem mínima</dt><dd className="font-medium">{percent.format(data.empresa.margemMinima)}</dd></div>
              <div><dt className="text-sm text-muted-foreground">Prazo de entrega</dt><dd className="font-medium">{data.empresa.prazoEntregaDias} dias</dd></div>
            </dl>
          </CardContent>
        </Card>
        <footer className="mt-6 flex justify-end">
          <Button onClick={() => setPasso(2)}>Confirmar empresa <ArrowRightIcon data-icon="inline-end" /></Button>
        </footer>
      </>}
      {passo === 2 && <>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-3">
          <h2 className="font-medium">{data.produtos.length} {data.produtos.length === 1 ? 'produto' : 'produtos'}</h2>
          <span className="text-sm text-muted-foreground wrap-anywhere">{data.arquivo}</span>
        </div>
        <ItemGroup>
          {data.produtos.map((produto, index) => <div key={produto.id}>
            {index > 0 && <ItemSeparator />}
            <Item className="gap-2 px-0">
              <ItemContent className="min-w-0">
                <ItemTitle className="wrap-anywhere">{produto.nome}</ItemTitle>
                <ItemDescription>{produto.marca}</ItemDescription>
              </ItemContent>
              <span className="text-xs text-muted-foreground">ANVISA {produto.registroAnvisa}</span>
            </Item>
          </div>)}
        </ItemGroup>
        {!data.produtos.length && <p className="py-4 text-sm text-muted-foreground">Nenhum produto foi carregado para a demonstração.</p>}
        <p className="mt-3 text-sm text-muted-foreground">Os registros são reais e serão conferidos na análise.</p>
        <footer className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setPasso(1)}><ArrowLeftIcon data-icon="inline-start" /> Voltar</Button>
          <Button onClick={() => { try { sessionStorage.setItem(sessionKey, 'sim'); } catch { /* navegação segue sem armazenamento */ } setPasso(3); }}>
            Confirmar catálogo <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </footer>
      </>}
      {passo === 3 && <>
        <p className="mb-3 text-sm text-muted-foreground">Seleção de {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short' }).format(new Date(data.geradoEm))}.</p>
        <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void analisar(); }}>
          <FieldSet disabled={busy || !turnos.data}>
            <FieldLegend className="sr-only">Escolha um dos editais preparados</FieldLegend>
            <RadioGroup value={selecaoDisponivel} onValueChange={value => { setSelecionado(value); setError(''); }} className="gap-3">
              {data.pregoes.map(pregao => <Card key={pregao.id} size="sm" className="demo-tender" data-selected={selecaoDisponivel === pregao.id}>
                <CardContent>
                  {emAnalise.has(pregao.id) ? <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 font-semibold wrap-anywhere">{pregao.orgao}</span>
                    <Badge variant="secondary">Este edital já está sob análise</Badge>
                  </div> : <FieldLabel htmlFor={'edital-' + pregao.id} className="flex cursor-pointer items-start gap-3">
                    <RadioGroupItem value={pregao.id} id={'edital-' + pregao.id} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 font-semibold wrap-anywhere">{pregao.orgao}</span>
                  </FieldLabel>}
                  <div className={emAnalise.has(pregao.id) ? 'mt-1' : 'mt-1 pl-7'}>
                    <FieldDescription>{pregao.municipio ? pregao.municipio + ', ' : ''}{pregao.uf} · {pregao.abertura ? 'Abertura ' + abertura(pregao.abertura) : abertura(null)}</FieldDescription>
                    {pregao.situacao && <FieldDescription>{pregao.situacao}</FieldDescription>}
                    <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-1">
                      <Collapsible className="min-w-0">
                        <CollapsibleTrigger render={<Button variant="link" size="sm" className="px-0" />}>
                          {new Set(pregao.matches.map(match => match.item)).size} itens candidatos
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <ul className="my-2 space-y-3 border-l pl-3">
                            {pregao.matches.map(match => <li key={`${match.item}-${match.produto}`} className="text-sm wrap-anywhere">
                              <span className="font-medium">Item {match.item}</span> · {match.descricao}
                              <span className="block text-muted-foreground">{data.produtos.find(produto => produto.id === match.produto)?.nome ?? match.produto}</span>
                            </li>)}
                          </ul>
                        </CollapsibleContent>
                      </Collapsible>
                      <Button variant="link" size="sm" className="px-0" nativeButton={false} render={<a href={pregao.url} target="_blank" rel="noreferrer" />}>
                        Ver no PNCP <ExternalLinkIcon data-icon="inline-end" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>)}
            </RadioGroup>
          </FieldSet>
          {!turnos.data && <p role="status" className="text-sm text-muted-foreground">
            {turnos.error || 'Consultando os editais em análise…'}
          </p>}
          {!data.pregoes.length && <p className="text-sm text-muted-foreground">Nenhum edital disponível para esta demonstração.</p>}
          {!data.analise.disponivel && <Alert><AlertDescription>{data.analise.motivo}</AlertDescription></Alert>}
          {error && <Alert variant="destructive"><AlertDescription>
            {error} <a href="#/turnos">Abrir acompanhamento</a>
          </AlertDescription></Alert>}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setPasso(2)}>
              <ArrowLeftIcon data-icon="inline-start" /> Voltar
            </Button>
            <Button type="submit" disabled={busy || !selecaoDisponivel || !data.analise.disponivel}>
              {busy && <Spinner data-icon="inline-start" />}
              {busy ? 'Iniciando análise…' : 'Analisar edital'}
              {!busy && <ArrowRightIcon data-icon="inline-end" />}
            </Button>
          </div>
        </form>
      </>}
    </div>
  </div>;
}
