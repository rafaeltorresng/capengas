import { useState } from 'react';
import { Lexer } from 'marked';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, CircleIcon, FileDownIcon, FileTextIcon, InboxIcon, SearchIcon, ShieldCheckIcon, SparklesIcon, TriangleAlertIcon } from 'lucide-react';
import type { Dossier, Escalation, Pauta, ResultadoPregao, Turno, Turnos } from '../../src/server/contract.ts';
import { concluirAnalise, resumirProgresso } from '../../src/lib/experiencia-analise.ts';
import { useApi, View } from '@/lib/api';
import { dateTime, dossierPath, itemPath, localDay, normalize, statusTurno } from '@/lib/format';
import { AppLink, EmptyState, Page, PageHeader, StatusBadge, Evidence } from '@/kit';
import { AgendaLine, DocumentPlan, EscalationCard } from '@/screens';
import { TurnDateFilter } from '@/components/turn-date-filter';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const estadoFase: Record<string, string> = { aguardando: 'A seguir', consultada: 'Consultada', concluida: 'Conferida', atencao: 'Verificação pendente', em_andamento: 'Em andamento' };

function ActivityHistory({ turno }: { turno: Turno }) {
  return <Accordion><AccordionItem value="atividades"><AccordionTrigger>Consultar atividades registradas</AccordionTrigger><AccordionContent>
    <ol className="flex max-h-64 flex-col gap-3 overflow-auto pr-2">
      {turno.etapas.map((etapa, index) => <li key={index} className="flex flex-col gap-1 text-sm">
        <span>{etapa.atividade}</span>
        <span className="text-xs text-muted-foreground">{dateTime.format(new Date(etapa.horario))} · {etapa.estado === 'pendente' ? 'Verificação pendente' : etapa.estado === 'concluida' ? 'Verificação registrada' : 'Atividade registrada'}</span>
      </li>)}
    </ol>
  </AccordionContent></AccordionItem></Accordion>;
}

function AgentProgress({ turno }: { turno: Turno }) {
  const resumo = resumirProgresso(turno);
  const ativa = turno.status === 'ativo';
  const atual = turno.etapas.at(-1);
  return <Card className="agent-progress">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><SparklesIcon className="size-5" /> {ativa ? 'O Lance está trabalhando no seu edital' : 'O que ficou registrado nesta análise'}</CardTitle>
      <CardDescription>Cada conclusão é apoiada nas fontes consultadas. Você pode sair desta página e voltar depois.</CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-6">
      <div className="flex items-start gap-3 rounded-lg bg-muted p-4" role="status" aria-live="polite" aria-atomic="true">
        {ativa ? <Spinner className="mt-0.5" /> : <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />}
        <div className="flex flex-col gap-1">
          <p className="font-medium">{ativa ? atual?.estado === 'concluida' ? 'Relacionando as evidências para o próximo passo' : resumo.atividade
            : turno.status === 'sem_atualizacao' ? 'Aguardando uma atualização do servidor'
            : turno.status === 'falhou' ? 'A análise foi interrompida' : 'A análise terminou sem uma conclusão completa'}</p>
          <p className="text-sm text-muted-foreground">{ativa ? 'O tempo varia com o edital e as fontes. Nenhuma proposta será enviada.'
            : `${turno.motivo ? `Motivo: ${turno.motivo}. ` : ''}O progresso registrado está preservado. Confira os detalhes antes de iniciar outra análise.`}</p>
        </div>
      </div>
      <ol className="agent-stages" aria-label="Etapas da análise">
        {resumo.fases.map(fase => <li key={fase.id} className="agent-stage" data-state={fase.estado} aria-current={fase.estado === 'em_andamento' ? 'step' : undefined}>
          <span className="agent-stage-icon" aria-hidden="true">{fase.estado === 'em_andamento' ? <span className="agent-pulse" /> : fase.estado === 'concluida' || fase.estado === 'consultada' ? <CheckIcon className="size-4" /> : <CircleIcon className="size-3" />}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-medium">{fase.titulo}</p>
            <p className="text-sm text-muted-foreground">{fase.descricao}</p>
          </div>
          <span className="agent-stage-label text-xs text-muted-foreground">{estadoFase[fase.estado]}</span>
        </li>)}
      </ol>
      <ActivityHistory turno={turno} />
    </CardContent>
  </Card>;
}

function PdfButton({ tender, analise, tipo }: { tender: string; analise: string; tipo: 'proposta' | 'relatorio' }) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  async function baixar() {
    setBusy(true); setErro('');
    try {
      const response = await fetch(`/api/dossies/${encodeURIComponent(tender)}/${tipo}.pdf?analise=${encodeURIComponent(analise)}`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error((await response.json()).erro ?? 'Não foi possível gerar o PDF.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = `lance-${tipo}-${tender.replaceAll('/', '-')}.pdf`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (failure) { setErro(failure instanceof Error ? failure.message : 'Não foi possível baixar o documento.'); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col items-start gap-2">
    <Button variant={tipo === 'proposta' ? 'default' : 'outline'} disabled={busy} onClick={() => void baixar()}>
      {busy ? <Spinner data-icon="inline-start" /> : <FileDownIcon data-icon="inline-start" />}
      {busy ? 'Preparando PDF…' : tipo === 'proposta' ? 'Baixar minuta em PDF' : 'Baixar análise em PDF'}
    </Button>
    {erro && <p role="alert" className="max-w-sm text-sm text-destructive">{erro}</p>}
  </div>;
}

const plain = (s: string) => s.replace(/\*\*|__/g, '').replace(/\\\|/g, '|');
/** Apenas texto e componentes: HTML vindo de uma fonte nunca é executado. */
function DocumentPreview({ markdown }: { markdown: string }) {
  return <div className="document-preview flex flex-col gap-4">
    {Lexer.lex(markdown).map((token, index) => {
      if (token.type === 'space' || token.type === 'hr') return null;
      if (token.type === 'heading') return <h3 key={index} className="font-medium">{plain(token.text)}</h3>;
      if (token.type === 'list') return <ul key={index} className="flex list-disc flex-col gap-2 pl-5 text-sm">{token.items.map((item: { text: string }, i: number) => <li key={i}>{plain(item.text)}</li>)}</ul>;
      if (token.type === 'table') return <Table key={index}>
        <TableHeader><TableRow>{token.header.map((cell: { text: string }, i: number) => <TableHead key={i} className="whitespace-normal">{plain(cell.text)}</TableHead>)}</TableRow></TableHeader>
        <TableBody>{token.rows.map((row: { text: string }[], i: number) => <TableRow key={i}>{row.map((cell, j) => <TableCell key={j} className="whitespace-normal">{plain(cell.text)}</TableCell>)}</TableRow>)}</TableBody>
      </Table>;
      return <p key={index} className="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">{plain('text' in token && typeof token.text === 'string' ? token.text : token.raw)}</p>;
    })}
  </div>;
}

function AnalysisResult({ resultado, turno }: { resultado: ResultadoPregao; turno: Turno }) {
  const [aba, setAba] = useState('resumo');
  const recurso = useApi<Dossier>('dossies/' + encodeURIComponent(resultado.tender));
  const dossier = recurso.data?.dados;
  const atual = dossier?.analiseId === turno.id;
  const veredito = concluirAnalise(resultado.itens, atual && dossier?.reavaliar, atual && dossier?.desatualizado, atual && dossier?.publicacao?.conferida === false, atual ? dossier?.escopo?.naoAnalisados.length : 0);
  const proposta = atual ? dossier?.proposta : undefined;
  const revisao = veredito.estado === 'revisao_necessaria' || veredito.estado === 'com_pendencias';
  if (!recurso.data && !recurso.error) return <p role="status" className="text-sm text-muted-foreground">Conferindo a versão da análise e os documentos…</p>;
  return <section className="analysis-result flex flex-col gap-6" aria-label={'Resultado de ' + resultado.orgao}>
    <Card>
      <CardHeader>
        <CardDescription className="flex items-center gap-2">{revisao ? <TriangleAlertIcon className="size-4" /> : <ShieldCheckIcon className="size-4" />} Veredito da análise</CardDescription>
        <CardTitle><h2 className="text-2xl tracking-tight">{recurso.error ? 'Não foi possível confirmar a versão atual.' : veredito.titulo}</h2></CardTitle>
        <CardDescription>{veredito.detalhe}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{resultado.itens.length} itens analisados · {[
          veredito.liberados ? `${veredito.liberados} para disputar` : '', veredito.condicionados ? `${veredito.condicionados} com pendências` : '',
          veredito.revisar ? `${veredito.revisar} para revisão` : '', veredito.recusados ? `${veredito.recusados} fora da proposta` : '',
        ].filter(Boolean).join(' · ')}. Nenhuma proposta enviada.</p>
        {atual && recurso.data?.origem === 'integrado' && <div className="flex flex-wrap items-start gap-3">
          {(proposta || dossier?.planoDocumentos) && <Button onClick={() => setAba('documentos')}><FileTextIcon data-icon="inline-start" /> Revisar documentos</Button>}
          <PdfButton tender={resultado.tender} analise={turno.id} tipo="relatorio" />
        </div>}
      </CardContent>
    </Card>
    {recurso.error && <Alert><AlertDescription>Não foi possível atualizar os documentos. {recurso.error}</AlertDescription></Alert>}
    {dossier?.analiseId && !atual && <Alert><AlertDescription>Uma análise mais recente substituiu o dossiê. Este resultado é o histórico desta execução; os documentos atuais estão na análise mais recente. <AppLink href="#/turnos">Ver editais</AppLink></AlertDescription></Alert>}
    <Tabs value={aba} onValueChange={setAba}>
      <TabsList>
        <TabsTrigger value="resumo">Resultado</TabsTrigger>
        <TabsTrigger value="documentos">Documentos</TabsTrigger>
        <TabsTrigger value="evidencias">Evidências</TabsTrigger>
      </TabsList>
      <TabsContent value="resumo" className="mt-4 flex flex-col gap-6">
        <Card>
          <CardHeader><CardTitle>O que disputar e o que revisar</CardTitle><CardDescription>Abra um item para entender o motivo e consultar a conferência.</CardDescription></CardHeader>
          <CardContent>
            <Accordion>
              {resultado.itens.map(item => <AccordionItem key={item.item} value={item.item}>
                <AccordionTrigger>
                  <span className="flex min-w-0 flex-col gap-2 text-left"><span>Item {item.item} · {item.descricao.length > 110 ? item.descricao.slice(0, 110).replace(/\s+\S*$/, '') + '…' : item.descricao}</span><Badge variant={item.estadoCodigo === 'disputar' ? 'secondary' : 'outline'}>{item.estado}</Badge></span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="flex flex-col gap-3"><p className="text-muted-foreground">{item.descricao}</p><p>{item.motivo || 'Motivo não registrado.'}</p><AppLink href={'#/' + itemPath(resultado.tender, item.item)}>Consultar evidências deste item <ArrowRightIcon /></AppLink></div>
                </AccordionContent>
              </AccordionItem>)}
            </Accordion>
          </CardContent>
        </Card>
        <TenderActions tender={resultado.tender} />
      </TabsContent>
      <TabsContent value="documentos" className="mt-4 flex flex-col gap-6">
        {proposta ? <Card>
          <CardHeader><CardTitle>{dossier?.reavaliar || dossier?.desatualizado ? 'Proposta aguardando atualização' : 'Proposta de preços'}</CardTitle><CardDescription>Minuta baseada nas decisões calculadas e nas regras citadas do edital. Revise e assine antes de utilizar.</CardDescription></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Alert><AlertDescription>{proposta.origemDados === 'sinteticos' ? 'O cadastro, o catálogo e as condições comerciais atuais são sintéticos. O PDF identifica essa origem e não representa uma empresa real.' : 'Dados cadastrais sem verificação independente de autenticidade.'}</AlertDescription></Alert>
            {dossier?.publicacao?.conferida === false && <Alert><AlertDescription>{dossier.publicacao.motivo}</AlertDescription></Alert>}
            {proposta.pendencias.length > 0 && <Alert>
              <AlertTitle>Complete antes de utilizar</AlertTitle><AlertDescription><ul className="list-disc pl-4">{proposta.pendencias.map(p => <li key={p}>{p}</li>)}</ul></AlertDescription>
            </Alert>}
            {!dossier?.reavaliar && !dossier?.desatualizado && <PdfButton tender={resultado.tender} analise={turno.id} tipo="proposta" />}
            <Accordion><AccordionItem value="previa"><AccordionTrigger>Visualizar documento</AccordionTrigger><AccordionContent><DocumentPreview markdown={proposta.markdown} /></AccordionContent></AccordionItem></Accordion>
          </CardContent>
        </Card> : <EmptyState icon={<FileTextIcon />} title="Proposta ainda não preparada" description={veredito.liberados + veredito.condicionados > 0 ? 'Há itens candidatos, mas esta execução ainda não produziu um documento. Nenhum arquivo será preenchido com dados inventados.' : 'A proposta é preparada quando existe um item viável. Resolva as pendências técnicas antes de avançar.'} />}
        {atual && dossier?.planoDocumentos && <DocumentPlan plan={dossier.planoDocumentos} />}
      </TabsContent>
      <TabsContent value="evidencias" className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Confira as fontes, as citações e o encaixe técnico antes de tomar uma decisão.</p>
        {resultado.dossie && <AppLink href={'#/' + dossierPath(resultado.tender)}>Abrir dossiê completo</AppLink>}
        {dossier?.documentos.map((fonte, i) => <Evidence key={i} source={fonte} quote />)}
        <AppLink href={'https://pncp.gov.br/app/editais/' + resultado.tender} external>Consultar publicação no PNCP</AppLink>
        <ActivityHistory turno={turno} />
      </TabsContent>
    </Tabs>
  </section>;
}

function TenderActions({ tender }: { tender: string }) {
  const recurso = useApi<Escalation[]>('escaladas');
  const pendencias = recurso.data?.dados.filter(p => p.tender === tender) ?? [];
  return <>
    {!!pendencias.length && <Card><CardHeader><CardTitle>Precisa da sua decisão</CardTitle><CardDescription>{pendencias.length} {pendencias.length === 1 ? 'pendência para a sua equipe' : 'pendências para a sua equipe'}. Abra para conferir e decidir.</CardDescription></CardHeader><CardContent><Accordion>{pendencias.map(row => <AccordionItem key={row.id} value={row.id}>
      <AccordionTrigger>{row.item ? 'Item ' + row.item + ' · ' : ''}{row.motivo}</AccordionTrigger>
      <AccordionContent><EscalationCard row={row} onResolved={() => recurso.refresh()} /></AccordionContent>
    </AccordionItem>)}</Accordion></CardContent></Card>}
    <View<Pauta> path="pauta">{pauta => {
      const linhas = pauta.linhas.filter(l => l.tenderId === tender && l.acionavel);
      return linhas.length ? <Card><CardHeader><CardTitle>Prazos e próximos passos</CardTitle></CardHeader><CardContent><ItemGroup>{linhas.map(l => <AgendaLine key={l.id} line={l} />)}</ItemGroup></CardContent></Card> : null;
    }}</View>
  </>;
}

export function Acompanhamento({ data, expandir = false }: { data: Turnos; lastRead?: number; expandir?: boolean }) {
  const [busca, setBusca] = useState('');
  const [date, setDate] = useState('');
  if (expandir && data.turnos[0]) {
    const turno = data.turnos[0];
    const nome = turno.pregoes.length === 1 ? turno.nomesEditais?.[turno.pregoes[0]] : 'Análise de editais';
    return <Page>
      <PageHeader title={nome || 'Análise do edital'} detail={'Iniciada em ' + dateTime.format(new Date(turno.inicio))}
        actions={<Button variant="ghost" nativeButton={false} render={<a href="#/turnos" />}><ArrowLeftIcon data-icon="inline-start" /> Todos os editais</Button>} />
      {turno.status === 'concluido' && turno.resultados?.length
        ? turno.resultados.map(resultado => <AnalysisResult key={resultado.tender} resultado={resultado} turno={turno} />)
        : <><AgentProgress turno={turno} />{turno.status === 'concluido' && <Alert><AlertDescription>Esta execução antiga não registrou o resultado por item. Consulte o histórico e as evidências disponíveis. <AppLink href="#/historico">Abrir histórico</AppLink></AlertDescription></Alert>}</>}
    </Page>;
  }
  const query = normalize(busca);
  const visiveis = data.turnos.filter(t => (!date || localDay.format(new Date(t.inicio)) === date) && (!query || normalize([t.id, ...t.pregoes, ...Object.values(t.nomesEditais ?? {})].join(' ')).includes(query)));
  const recentes = new Map<string, Turno>();
  for (const t of visiveis) for (const id of t.pregoes) if (!recentes.has(id)) recentes.set(id, t);
  return <Page>
    <PageHeader title="Seus editais" detail="Da análise à proposta, tudo o que você precisa para decidir."
      actions={<Button nativeButton={false} render={<a href="#/onboarding/editais" />}><SparklesIcon data-icon="inline-start" /> Analisar um edital</Button>} />
    <div className="flex flex-wrap items-center gap-3">
      <InputGroup className="max-w-sm"><InputGroupAddon><SearchIcon /></InputGroupAddon><InputGroupInput aria-label="Buscar edital" placeholder="Buscar edital ou órgão" value={busca} onChange={e => setBusca(e.target.value)} /></InputGroup>
      <TurnDateFilter dates={data.turnos.map(t => localDay.format(new Date(t.inicio)))} value={date} onChange={setDate} />
      {date && <Button variant="ghost" onClick={() => setDate('')}>Limpar data</Button>}
    </div>
    {!recentes.size && <EmptyState icon={<InboxIcon />} title={busca || date ? 'Nenhum edital encontrado' : 'Seu próximo edital começa aqui'} description="Escolha um edital para o Lance conferir os itens, analisar as exigências e preparar o próximo passo." />}
    <div className="grid gap-4 md:grid-cols-2">
      {[...recentes].map(([id, turno]) => {
        const resultado = turno.resultados?.find(r => r.tender === id);
        const veredito = resultado ? concluirAnalise(resultado.itens) : undefined;
        return <Card key={id} className="analysis-card">
          <CardHeader><div className="mb-2"><StatusBadge status={turno.status} label={statusTurno[turno.status]} /></div>
            <CardTitle><h2>{turno.nomesEditais?.[id] || id}</h2></CardTitle><CardDescription>PNCP {id}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm">{veredito?.titulo ?? (turno.status === 'ativo' ? resumirProgresso(turno).atividade : 'Consulte o progresso e as evidências disponíveis.')}</p>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{dateTime.format(new Date(turno.inicio))}</span>
              <Button variant="outline" nativeButton={false} render={<a href={'#/turnos/' + encodeURIComponent(turno.id)} />}>{turno.status === 'ativo' ? 'Acompanhar análise' : 'Ver resultado'} <ArrowRightIcon data-icon="inline-end" /></Button>
            </div>
          </CardContent>
        </Card>;
      })}
    </div>
    {visiveis.length > 1 && <Accordion><AccordionItem value="historico"><AccordionTrigger>Histórico de execuções ({visiveis.length})</AccordionTrigger><AccordionContent>
      <ItemGroup>{visiveis.map(turno => <Item key={turno.id}><ItemContent><ItemTitle><AppLink href={'#/turnos/' + encodeURIComponent(turno.id)}>{dateTime.format(new Date(turno.inicio))} · {statusTurno[turno.status]}</AppLink></ItemTitle><ItemDescription>{Object.values(turno.nomesEditais ?? {}).join(' · ')}</ItemDescription></ItemContent></Item>)}</ItemGroup>
    </AccordionContent></AccordionItem></Accordion>}
  </Page>;
}

export function PendingWorkspace({ rows, refresh }: { rows: Escalation[]; refresh: () => void }) {
  return <Page>
    <PageHeader title="Suas pendências" detail="Decisões que precisam de você e prazos que merecem atenção." />
    <Tabs defaultValue="decisoes"><TabsList><TabsTrigger value="decisoes">Decisões {rows.length > 0 && <Badge variant="secondary">{rows.length}</Badge>}</TabsTrigger><TabsTrigger value="prazos">Prazos e alertas</TabsTrigger></TabsList>
      <TabsContent value="decisoes" className="mt-4 flex flex-col gap-4">{rows.length ? <Card><CardContent><Accordion>{rows.map(row => <AccordionItem key={row.id} value={row.id}>
        <AccordionTrigger><span className="flex flex-col gap-1 text-left"><span>{row.motivo}</span><span className="text-xs font-normal text-muted-foreground">{row.pregao}{row.item ? ' · Item ' + row.item : ''}</span></span></AccordionTrigger>
        <AccordionContent><EscalationCard row={row} onResolved={refresh} /></AccordionContent>
      </AccordionItem>)}</Accordion></CardContent></Card> : <EmptyState icon={<CheckIcon />} title="Nenhuma decisão pendente" description="Quando uma análise precisar de você, a pendência aparecerá aqui e no próprio edital." />}</TabsContent>
      <TabsContent value="prazos" className="mt-4"><View<Pauta> path="pauta">{pauta => {
        const linhas = pauta.linhas.filter(l => l.acionavel);
        return linhas.length ? <Card><CardContent><ItemGroup>{linhas.map(l => <AgendaLine key={l.id} line={l} />)}</ItemGroup></CardContent></Card> : <EmptyState icon={<CheckIcon />} title="Nenhum prazo pede ação agora" description="Mudanças no edital e alertas documentais continuam sendo acompanhados." />;
      }}</View></TabsContent>
    </Tabs>
  </Page>;
}
