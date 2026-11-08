import { useState } from 'react';
import { ArrowLeftIcon, ArrowRightIcon, ExternalLinkIcon, RefreshCwIcon } from 'lucide-react';
import type { AnalysisStarted } from '../../src/server/onboarding.ts';
import type { FeedView } from '../../src/lib/oportunidades.ts';
import type { Turnos } from '../../src/server/contract.ts';
import { dataFonte, publicacaoRelativa } from '../../src/lib/feed-datas.ts';
import { request, useApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Spinner } from '@/components/ui/spinner';

export function OpportunityFeed({
  catalogos,
  disponivel,
  motivo,
  iniciar,
  voltar,
}: {
  catalogos: string[];
  disponivel: boolean;
  motivo: string | null;
  iniciar: (id: string) => Promise<AnalysisStarted>;
  voltar: () => void;
}) {
  const feed = useApi<FeedView>(
    'onboarding/editais?' + new URLSearchParams(catalogos.map((id) => ['catalogo', id])).toString(),
  );
  const turnos = useApi<Turnos>('turnos');
  const [busca, setBusca] = useState('');
  const [uf, setUf] = useState('');
  const [ordem, setOrdem] = useState('relacao');
  const [limite, setLimite] = useState(8);
  const [selecionado, setSelecionado] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro] = useState('');
  const dados = feed.data?.dados;
  const aguardandoFonte = !!dados?.proximaConsultaEm && Date.parse(dados.proximaConsultaEm) > Date.now();
  const correndo = turnos.data?.dados.turnos.find((t) => t.status === 'ativo' || t.status === 'sem_atualizacao');
  const pregoes = (dados?.pregoes ?? [])
    .filter(
      (p) =>
        (!uf || p.uf === uf) &&
        `${p.orgao} ${p.objeto}`.toLocaleLowerCase('pt-BR').includes(busca.toLocaleLowerCase('pt-BR')),
    )
    .sort((a, b) =>
      ordem === 'recentes'
        ? (b.publicadoEm ?? '').localeCompare(a.publicadoEm ?? '') || a.id.localeCompare(b.id)
        : b.itensCandidatos - a.itensCandidatos || a.id.localeCompare(b.id),
    );
  const escolhido = pregoes.find((p) => p.id === selecionado && p.disponivel);
  async function atualizar() {
    setRefreshing(true);
    setErro('');
    try {
      await request('onboarding/atualizar', { method: 'POST' });
      feed.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível atualizar.');
    } finally {
      setRefreshing(false);
    }
  }
  async function analisar() {
    if (busy || !escolhido || !disponivel || correndo || !turnos.data) return;
    setBusy(true);
    setErro('');
    try {
      const job = await iniciar(escolhido.id);
      window.location.hash = '/turnos/' + encodeURIComponent(job.turno);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível iniciar.');
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {dados
            ? `${pregoes.length}${busca || uf ? ` de ${dados.pregoes.length}` : ''} oportunidades relacionadas aos seus produtos`
            : 'Consultando oportunidades…'}
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing || dados?.status === 'atualizando' || aguardandoFonte}
          onClick={() => void atualizar()}
        >
          {refreshing || dados?.status === 'atualizando' ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {dados?.status === 'atualizando' ? 'Atualizando' : 'Atualizar'}
        </Button>
      </div>
      {dados && (dados.ultimaSincronizacao || dados.status === 'atualizando') && (
        <p className="text-sm text-muted-foreground">
          {dados.ultimaSincronizacao
            ? `Última coleta completa: ${dataFonte(dados.ultimaSincronizacao)} (Recife).`
            : ''}{' '}
          {dados.status === 'atualizando' ? 'Buscando atualizações no PNCP.' : ''}
        </p>
      )}
      {dados && ['parcial', 'indisponivel'].includes(dados.status) && (
        <Alert>
          <AlertDescription>
            {dados.status === 'parcial'
              ? 'Parte da coleta não pôde ser atualizada. Cada edital mostra sua última consulta.'
              : 'O PNCP não pôde ser atualizado. Exibindo os últimos dados disponíveis.'}
            {aguardandoFonte && ` Próxima consulta em ${dataFonte(dados.proximaConsultaEm!)} (Recife).`}
          </AlertDescription>
        </Alert>
      )}
      <FieldGroup className="flex flex-col sm:flex-row">
        <Field>
          <FieldLabel htmlFor="buscar-editais" className="sr-only">
            Buscar editais
          </FieldLabel>
          <Input
            id="buscar-editais"
            placeholder="Buscar por órgão ou objeto"
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setLimite(8);
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="uf-editais" className="sr-only">
            Filtrar por UF
          </FieldLabel>
          <NativeSelect
            id="uf-editais"
            value={uf}
            onChange={(e) => {
              setUf(e.target.value);
              setLimite(8);
            }}
          >
            <NativeSelectOption value="">Todas as UFs</NativeSelectOption>
            {[...new Set(dados?.pregoes.map((p) => p.uf) ?? [])].sort().map((u) => (
              <NativeSelectOption key={u} value={u}>
                {u}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="ordenar-editais" className="sr-only">
            Ordenar editais
          </FieldLabel>
          <NativeSelect id="ordenar-editais" value={ordem} onChange={(e) => setOrdem(e.target.value)}>
            <NativeSelectOption value="relacao">Mais relacionados</NativeSelectOption>
            <NativeSelectOption value="recentes">Publicados recentemente</NativeSelectOption>
          </NativeSelect>
        </Field>
      </FieldGroup>
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void analisar();
        }}
      >
        <FieldSet disabled={busy}>
          <FieldLegend className="sr-only">Escolha um edital para analisar</FieldLegend>
          <RadioGroup value={escolhido?.id ?? ''} onValueChange={setSelecionado} className="gap-0">
            {pregoes.slice(0, limite).map((p) => (
              <article key={p.id} className="flex flex-col gap-3 border-t py-5">
                <Field orientation="horizontal">
                  <RadioGroupItem id={'pregao-' + p.id} value={p.id} disabled={!p.disponivel} />
                  <FieldLabel htmlFor={'pregao-' + p.id} className="flex flex-col items-start gap-2">
                    <span title={p.objeto}>
                      {(p.objeto || p.orgao).length > 180
                        ? (p.objeto || p.orgao).slice(0, 180).replace(/\s+\S*$/, '') + '…'
                        : p.objeto || p.orgao}
                    </span>
                    <span className="text-sm font-normal text-muted-foreground">
                      {p.orgao} · {p.uf}
                    </span>
                  </FieldLabel>
                </Field>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <span title={dataFonte(p.publicadoEm)}>{publicacaoRelativa(p.publicadoEm)}</span>
                  <span className="text-muted-foreground">Abertura: {dataFonte(p.abertura)}</span>
                  <Badge variant="secondary">
                    {p.itensCandidatos} {p.itensCandidatos === 1 ? 'item candidato' : 'itens candidatos'}
                  </Badge>
                  {!p.disponivel && <Badge variant="outline">Indisponível para análise</Badge>}
                </div>
                <Collapsible>
                  <CollapsibleTrigger className="text-sm underline underline-offset-4">
                    Itens e fonte
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <div className="flex flex-col gap-3 text-sm">
                      <p>{p.objeto}</p>
                      <ul className="flex flex-col gap-2">
                        {[...new Map(p.matches.map((m) => [m.item, m])).values()].map((m) => (
                          <li key={m.item}>
                            Item {m.item} · {m.descricao}
                          </li>
                        ))}
                      </ul>
                      <p className="text-muted-foreground">
                        Candidatos encontrados por termos do catálogo. A análise ainda precisa conferir o encaixe.
                      </p>
                      <p>
                        Consultado em {dataFonte(p.consultadoEm)} (Recife).{' '}
                        {p.atualizadoNaFonteEm
                          ? `Registro atualizado na fonte em ${dataFonte(p.atualizadoNaFonteEm)}.`
                          : ''}
                      </p>
                      <p>Situação na consulta: {p.situacao}.</p>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 underline underline-offset-4"
                      >
                        Abrir publicação no PNCP <ExternalLinkIcon className="size-3" />
                      </a>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </article>
            ))}
          </RadioGroup>
        </FieldSet>
        {pregoes.length > limite && (
          <Button type="button" variant="ghost" onClick={() => setLimite((l) => l + 8)}>
            Mostrar mais oportunidades
          </Button>
        )}
        {!pregoes.length && dados && (
          <p>Nenhum edital encontrado para esta seleção. Experimente outros catálogos ou filtros.</p>
        )}
        {(feed.error || erro) && (
          <Alert variant="destructive">
            <AlertDescription>{erro || feed.error}</AlertDescription>
          </Alert>
        )}
        {!disponivel && (
          <Alert>
            <AlertDescription>{motivo}</AlertDescription>
          </Alert>
        )}
        {correndo && (
          <Alert>
            <AlertDescription>
              Há uma análise em andamento.{' '}
              <a className="underline" href={'#/turnos/' + encodeURIComponent(correndo.id)}>
                Acompanhar análise
              </a>
            </AlertDescription>
          </Alert>
        )}
        <footer className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-background py-3">
          <Button type="button" variant="ghost" disabled={busy} onClick={voltar}>
            <ArrowLeftIcon data-icon="inline-start" />
            Catálogos
          </Button>
          <Button type="submit" disabled={busy || !escolhido || !disponivel || !!correndo || !turnos.data}>
            {busy ? <Spinner data-icon="inline-start" /> : <ArrowRightIcon data-icon="inline-end" />}
            {busy ? 'Iniciando análise…' : 'Analisar edital'}
          </Button>
        </footer>
      </form>
    </div>
  );
}
