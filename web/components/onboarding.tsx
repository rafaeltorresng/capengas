import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, FileSpreadsheetIcon } from 'lucide-react';
import type { AnalysisStarted, OnboardingData } from '../../src/server/onboarding.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { useRelatarOnboarding } from '@/components/lance-presence';
import { OpportunityFeed } from '@/components/opportunity-feed';

const sessionKey = 'lance-demo-confirmado';
const catalogKey = 'lance-catalogos-v1';
function confirmado() {
  try {
    return sessionStorage.getItem(sessionKey) === 'sim';
  } catch {
    return false;
  }
}
function escolhaInicial(data: OnboardingData) {
  const todos = data.catalogos.map((a) => a.id);
  try {
    const salvo = JSON.parse(sessionStorage.getItem(catalogKey) ?? 'null');
    return Array.isArray(salvo) ? todos.filter((id) => salvo.includes(id)) : todos;
  } catch {
    return todos;
  }
}
const percent = new Intl.NumberFormat('pt-BR', { style: 'percent' });
const steps = ['Empresa', 'Catálogos', 'Editais'];
export function Onboarding({
  data,
  escolherEdital,
  iniciar,
}: {
  data: OnboardingData;
  escolherEdital: boolean;
  iniciar: (id: string, catalogos: string[]) => Promise<AnalysisStarted>;
}) {
  const [arquivos, setArquivos] = useState(() => escolhaInicial(data));
  const [passo, setPasso] = useState<1 | 2 | 3>(escolherEdital && confirmado() && arquivos.length ? 3 : 1);
  const [iniciando, setIniciando] = useState(false);
  useRelatarOnboarding(useMemo(() => ({ passo, iniciando }), [passo, iniciando]));
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
    window.scrollTo(0, 0);
  }, [passo]);
  useEffect(() => {
    try {
      sessionStorage.setItem(catalogKey, JSON.stringify(arquivos));
    } catch {
      /* A seleção permanece no estado da página. */
    }
  }, [arquivos]);
  const produtos = new Set(
    data.catalogos.filter((a) => arquivos.includes(a.id)).flatMap((a) => a.produtos.map((p) => p.id)),
  );
  function marcar(id: string, checked: boolean) {
    setArquivos((xs) => (checked ? [...new Set([...xs, id])] : xs.filter((x) => x !== id)));
  }
  async function comecar(id: string) {
    setIniciando(true);
    try {
      return await iniciar(id, arquivos);
    } catch (error) {
      setIniciando(false);
      throw error;
    }
  }
  return (
    <div className="flex w-full flex-col gap-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ol className="demo-steps" aria-label="Etapas de preparação">
          {steps.map((nome, i) => (
            <li key={nome} aria-current={passo === i + 1 ? 'step' : undefined}>
              <span className="demo-step-marker" aria-hidden="true">
                {passo > i + 1 ? <CheckIcon className="size-3" /> : i + 1}
              </span>
              {nome}
              {passo > i + 1 && <span className="sr-only">, concluída</span>}
            </li>
          ))}
        </ol>
        <Badge variant="secondary">Demonstração</Badge>
      </div>
      <header className="flex flex-col gap-2 border-t pt-6">
        <h1 ref={title} tabIndex={-1} className="text-3xl font-semibold tracking-tight outline-none">
          {passo === 1
            ? 'Confirme a empresa'
            : passo === 2
              ? 'Escolha seus catálogos'
              : 'Oportunidades para sua empresa'}
        </h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          {passo === 1
            ? 'Empresa e oferta comercial fictícias para experimentar o Lance.'
            : passo === 2
              ? 'Combine os arquivos que representam o que sua distribuidora fornece.'
              : 'Editais públicos relacionados aos produtos selecionados. O agente confere o encaixe antes de recomendar.'}
        </p>
      </header>
      <div key={passo} className="demo-step-content">
        {passo === 1 && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>{data.empresa.nome}</CardTitle>
                <CardDescription>
                  {data.empresa.porte} · {data.empresa.uf}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 border-t pt-4">
                  <div>
                    <dt className="text-sm text-muted-foreground">Margem mínima</dt>
                    <dd className="font-medium">{percent.format(data.empresa.margemMinima)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Prazo de entrega</dt>
                    <dd className="font-medium">{data.empresa.prazoEntregaDias} dias</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
            <footer className="mt-6 flex justify-end">
              <Button onClick={() => setPasso(2)}>
                Confirmar empresa
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </footer>
          </>
        )}
        {passo === 2 && (
          <div className="flex flex-col gap-6">
            <FieldSet>
              <FieldLegend className="sr-only">Arquivos de catálogo da demonstração</FieldLegend>
              <FieldGroup>
                {data.catalogos.map((a) => (
                  <div key={a.id} className="flex flex-col gap-3 border-b pb-5">
                    <Field orientation="horizontal">
                      <Checkbox
                        id={'catalogo-' + a.id}
                        checked={arquivos.includes(a.id)}
                        onCheckedChange={(v) => marcar(a.id, v)}
                      />
                      <FieldContent>
                        <FieldLabel htmlFor={'catalogo-' + a.id}>{a.titulo}</FieldLabel>
                        <FieldDescription className="flex flex-wrap items-center gap-2">
                          <FileSpreadsheetIcon className="size-4" />
                          {a.nome} · {a.produtos.length} produtos
                        </FieldDescription>
                      </FieldContent>
                    </Field>
                    <Collapsible>
                      <CollapsibleTrigger className="text-sm underline underline-offset-4">
                        Conferir produtos
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul className="flex flex-col gap-3 pt-3">
                          {a.produtos.map((p) => (
                            <li key={p.id} className="flex flex-col gap-1">
                              <span>
                                {p.nome} · {p.marca}
                              </span>
                              <span className="text-sm text-muted-foreground">Registro ANVISA {p.registroAnvisa}</span>
                            </li>
                          ))}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                ))}
              </FieldGroup>
            </FieldSet>
            <p className="text-sm text-muted-foreground">
              Arquivos ilustrativos, com produtos, fichas e custos sintéticos. Os números de registro são reais e serão
              conferidos na análise.
            </p>
            <footer className="flex flex-wrap items-center justify-between gap-3">
              <Button variant="ghost" onClick={() => setPasso(1)}>
                <ArrowLeftIcon data-icon="inline-start" />
                Voltar
              </Button>
              <Button
                disabled={!arquivos.length}
                onClick={() => {
                  try {
                    sessionStorage.setItem(sessionKey, 'sim');
                  } catch {
                    /* Navegação segue sem armazenamento. */
                  }
                  setPasso(3);
                }}
              >
                Ver oportunidades · {produtos.size} produtos
                <ArrowRightIcon data-icon="inline-end" />
              </Button>
            </footer>
          </div>
        )}
        {passo === 3 && (
          <OpportunityFeed
            catalogos={arquivos}
            disponivel={data.analise.disponivel}
            motivo={data.analise.motivo}
            iniciar={(id) => comecar(id)}
            voltar={() => setPasso(2)}
          />
        )}
      </div>
    </div>
  );
}
