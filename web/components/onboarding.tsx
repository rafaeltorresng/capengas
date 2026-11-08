import { useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ExternalLinkIcon, FileSpreadsheetIcon } from 'lucide-react';
import type { AnalysisStarted, OnboardingData } from '../../src/server/onboarding.ts';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from '@/components/ui/attachment';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
  const [revelado, setRevelado] = useState(escolherEdital && confirmado());
  const [selecionado, setSelecionado] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { title.current?.focus(); window.scrollTo(0, 0); }, [passo]);
  async function analisar() {
    if (busy || !selecionado || !data.analise.disponivel) return;
    setBusy(true); setError('');
    try {
      const job = await iniciar(selecionado);
      window.location.hash = '/turnos/' + encodeURIComponent(job.turno);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível iniciar a análise.');
      setBusy(false);
    }
  }
  return <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
    <ol className="flex flex-wrap items-center gap-3" aria-label="Etapas de preparação">
      {steps.map((nome, index) => <li key={nome} className="flex items-center gap-3" aria-current={passo === index + 1 ? 'step' : undefined}>
        <Badge variant={passo === index + 1 ? 'default' : passo > index + 1 ? 'secondary' : 'outline'}>
          {passo > index + 1 ? <CheckIcon /> : index + 1}
        </Badge>
        <span className="text-sm">{nome}</span>
      </li>)}
    </ol>
    <header className="flex flex-col gap-2">
      <h1 ref={title} tabIndex={-1} className="font-heading text-3xl font-semibold tracking-tight outline-none">
        {passo === 1 ? 'Sua empresa' : passo === 2 ? 'Seu catálogo' : 'Escolha um edital'}
      </h1>
      <p className="max-w-xl text-sm text-muted-foreground">{passo === 1
        ? 'Confirme os dados para conhecer o Lance.'
        : passo === 2
          ? 'A lista de produtos já está anexada. Confira para continuar.'
          : 'Estes editais têm itens candidatos para o catálogo. O agente vai conferir o encaixe.'}</p>
    </header>
    {passo === 1 && <>
      <Alert>
        <AlertDescription>Empresa, catálogo e condições comerciais simulados para esta demonstração.</AlertDescription>
      </Alert>
      <form onSubmit={event => { event.preventDefault(); setPasso(2); }}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="empresa-nome">Nome da empresa</FieldLabel>
            <Input id="empresa-nome" readOnly value={data.empresa.nome} />
          </Field>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="empresa-porte">Porte</FieldLabel>
              <Input id="empresa-porte" readOnly value={data.empresa.porte} />
            </Field>
            <Field>
              <FieldLabel htmlFor="empresa-uf">UF</FieldLabel>
              <Input id="empresa-uf" readOnly value={data.empresa.uf} />
            </Field>
            <Field>
              <FieldLabel htmlFor="empresa-margem">Margem mínima</FieldLabel>
              <Input id="empresa-margem" readOnly value={percent.format(data.empresa.margemMinima)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="empresa-prazo">Prazo de entrega</FieldLabel>
              <Input id="empresa-prazo" readOnly value={`${data.empresa.prazoEntregaDias} dias`} />
            </Field>
          </div>
        </FieldGroup>
        <div className="mt-6 flex justify-end">
          <Button type="submit">Confirmar empresa <ArrowRightIcon data-icon="inline-end" /></Button>
        </div>
      </form>
    </>}
    {passo === 2 && <>
      <Attachment>
        <AttachmentMedia><FileSpreadsheetIcon /></AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{data.arquivo}</AttachmentTitle>
          <AttachmentDescription>Arquivo ilustrativo, já anexado.</AttachmentDescription>
        </AttachmentContent>
        <CheckIcon aria-label="Arquivo selecionado" />
      </Attachment>
      {!revelado ? <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" onClick={() => setPasso(1)}><ArrowLeftIcon data-icon="inline-start" /> Voltar</Button>
        <Button onClick={() => setRevelado(true)}>Conferir produtos <ArrowRightIcon data-icon="inline-end" /></Button>
      </div> : <>
        <ItemGroup>
          {data.produtos.map((produto, index) => <div key={produto.id}>
            {index > 0 && <ItemSeparator />}
            <Item>
              <ItemContent>
                <ItemTitle>{produto.nome}</ItemTitle>
                <ItemDescription>{produto.marca}</ItemDescription>
              </ItemContent>
              <ItemContent>
                <ItemDescription>Registro ANVISA</ItemDescription>
                <ItemTitle>{produto.registroAnvisa}</ItemTitle>
              </ItemContent>
            </Item>
          </div>)}
        </ItemGroup>
        <p className="text-sm text-muted-foreground">Os números de registro são reais. A conferência regulatória é feita na análise.</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setPasso(1)}><ArrowLeftIcon data-icon="inline-start" /> Voltar</Button>
          <Button onClick={() => { try { sessionStorage.setItem(sessionKey, 'sim'); } catch { /* navegação segue sem armazenamento */ } setPasso(3); }}>
            Confirmar catálogo <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>
      </>}
    </>}
    {passo === 3 && <>
      <p className="text-sm text-muted-foreground">Seleção de editais públicos preparada em {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short' }).format(new Date(data.geradoEm))}.</p>
      <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); void analisar(); }}>
        <FieldSet disabled={busy}>
          <FieldLegend className="sr-only">Escolha um dos editais preparados</FieldLegend>
          <RadioGroup value={selecionado} onValueChange={value => { setSelecionado(value); setError(''); }} className="gap-3">
            {data.pregoes.map(pregao => <Card key={pregao.id} size="sm">
              <CardHeader>
                <Field orientation="horizontal">
                  <RadioGroupItem value={pregao.id} id={'edital-' + pregao.id} />
                  <div className="flex flex-col gap-1">
                    <FieldLabel htmlFor={'edital-' + pregao.id}>{pregao.orgao}</FieldLabel>
                    <FieldDescription>{pregao.municipio ? pregao.municipio + ' · ' : ''}{pregao.uf} · Abertura {abertura(pregao.abertura)}</FieldDescription>
                    <FieldDescription>{pregao.situacao}</FieldDescription>
                  </div>
                </Field>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Collapsible>
                  <CollapsibleTrigger className="text-sm text-muted-foreground underline-offset-4 hover:underline">
                    {new Set(pregao.matches.map(match => match.item)).size} itens candidatos
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className="mt-3 flex flex-col gap-3">
                      {pregao.matches.map(match => <li key={`${match.item}-${match.produto}`} className="text-sm">
                        <span className="font-medium">Item {match.item}</span> · {match.descricao}
                        <span className="mt-1 block text-muted-foreground">Produto candidato: {data.produtos.find(produto => produto.id === match.produto)?.nome ?? match.produto}</span>
                      </li>)}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              </CardContent>
              <CardFooter>
                <Button variant="link" nativeButton={false} render={<a href={pregao.url} target="_blank" rel="noreferrer" />}>
                  Ver no PNCP <ExternalLinkIcon data-icon="inline-end" />
                </Button>
              </CardFooter>
            </Card>)}
          </RadioGroup>
        </FieldSet>
        {!data.analise.disponivel && <Alert><AlertDescription>{data.analise.motivo}</AlertDescription></Alert>}
        {error && <Alert variant="destructive"><AlertDescription>
          {error} <a href="#/turnos">Abrir acompanhamento</a>
        </AlertDescription></Alert>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setPasso(2)}>
            <ArrowLeftIcon data-icon="inline-start" /> Voltar
          </Button>
          <Button type="submit" disabled={busy || !selecionado || !data.analise.disponivel}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? 'Iniciando análise…' : 'Analisar edital'}
            {!busy && <ArrowRightIcon data-icon="inline-end" />}
          </Button>
        </div>
      </form>
    </>}
  </div>;
}
