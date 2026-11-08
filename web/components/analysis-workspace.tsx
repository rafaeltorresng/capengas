import { useMemo, useState } from 'react';
import { Lexer } from 'marked';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, FileTextIcon, InboxIcon, SearchIcon, TriangleAlertIcon } from 'lucide-react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LanceInline, useRelatarTurnos } from '@/components/lance-presence';
import { presencaDoMascote, type RelatoTurnos } from '@/lib/mascote';
import { OperationalConditions } from '@/components/operational-conditions';
import { PdfButton } from '@/components/pdf-button';

const estadoFase: Record<string, string> = { aguardando: 'A seguir', consultada: 'Percorrida', concluida: 'Conferida', atencao: 'Com pendência', em_andamento: 'Em curso' };

function ActivityHistory({ turno }: { turno: Turno }) {
  return <Accordion><AccordionItem value="atividades"><AccordionTrigger>Histórico de atividades</AccordionTrigger><AccordionContent>
    <ol className="flex max-h-64 flex-col gap-3 overflow-auto pr-2">
      {turno.etapas.map((etapa, index) => <li key={index} className="flex flex-col gap-1 text-sm">
        <span>{etapa.atividade}</span>
        <span className="text-xs text-muted-foreground">{dateTime.format(new Date(etapa.horario))} · {etapa.estado === 'pendente' ? 'Verificação pendente' : etapa.estado === 'concluida' ? 'Concluída' : etapa.estado === 'em_andamento' && turno.status === 'ativo' ? 'Em andamento' : 'Registrada'}</span>
      </li>)}
    </ol>
  </AccordionContent></AccordionItem></Accordion>;
}

function AgentProgress({ turno }: { turno: Turno }) {
  const resumo = resumirProgresso(turno);
  const ativa = turno.status === 'ativo';
  const atual = turno.etapas.at(-1);
  const titulo = ativa ? 'O Lance está analisando o edital'
    : turno.status === 'sem_atualizacao' ? 'Sem atualização do servidor'
    : turno.status === 'falhou' ? 'A análise foi interrompida'
    : turno.status === 'concluido' ? 'Análise concluída' : 'Análise incompleta';
  const detalhe = ativa ? resumo.atividade
    : turno.status === 'sem_atualizacao' ? 'Aguarde uma nova atualização ou consulte a última atividade.'
    : turno.motivo ?? (turno.status === 'concluido' ? undefined : 'Consulte as atividades registradas para verificar onde a execução parou.');
  const foco = resumo.fases.find(fase => fase.estado === 'em_andamento')
    ?? resumo.fases.find(fase => fase.estado === 'atencao')
    ?? [...resumo.fases].reverse().find(fase => fase.estado !== 'aguardando');
  return <Card className="agent-progress">
    <CardContent className="flex flex-col gap-5">
      <div className="agent-status" data-active={ativa}>
        <LanceInline state={presencaDoMascote({ tela: 'analise', analise: { status: turno.status, mostraResultado: false } }).state} />
        <div className="min-w-0" role="status" aria-live="polite" aria-atomic="true">
          <h2 className="text-xl font-semibold tracking-tight wrap-anywhere">{titulo}</h2>
          {detalhe && <p className="mt-1 text-sm text-muted-foreground wrap-anywhere">
            {ativa && (atual?.estado === 'pendente' ? 'Verificação pendente · ' : resumo.retomando ? 'Retomando · ' : atual?.estado === 'concluida' ? 'Última atividade · ' : '')}
            {detalhe}
          </p>}
        </div>
      </div>
      <ol className="agent-stages" aria-label="Etapas da análise">
        {resumo.fases.map((fase, index) => <li key={fase.id} className="agent-stage" data-state={fase.estado} aria-current={fase.estado === 'em_andamento' ? 'step' : undefined}>
          <span className="agent-stage-icon" aria-hidden="true">
            {fase.estado === 'concluida' || fase.estado === 'consultada' ? <CheckIcon className="size-3.5" />
              : fase.estado === 'atencao' ? <TriangleAlertIcon className="size-3.5" /> : index + 1}
          </span>
          <span className="agent-stage-title">{fase.titulo}</span>
          <span className="agent-stage-label">
            {fase.estado === 'em_andamento' && <span className="agent-stage-live" aria-hidden="true" />}
            {!ativa && fase.estado === 'aguardando' ? 'Não iniciada' : estadoFase[fase.estado]}
          </span>
        </li>)}
      </ol>
      {foco && <p key={foco.id} className="agent-stage-note">{foco.descricao}</p>}
      {turno.etapas.length > 0 && <ActivityHistory turno={turno} />}
    </CardContent>
  </Card>;
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
  const veredito = concluirAnalise(resultado.itens, atual && dossier?.reavaliar, atual && dossier?.desatualizado, atual && dossier?.publicacao?.conferida === false, atual ? dossier?.escopo?.naoAnalisados.length : 0, atual && dossier?.operacao?.requerRevisao);
  const proposta = atual ? dossier?.proposta : undefined;
  const revisao = veredito.estado === 'revisao_necessaria' || veredito.estado === 'com_pendencias';
  if (!recurso.data && !recurso.error) return <p role="status" className="text-sm text-muted-foreground">Conferindo a versão da análise e os documentos…</p>;
  return <section className="analysis-result flex flex-col gap-6" aria-label={'Resultado de ' + resultado.orgao}>
    <section className="verdict" data-review={revisao} aria-label="Veredito da análise">
      <div className="min-w-0">
        <h2 className="text-2xl font-semibold tracking-tight wrap-anywhere">{recurso.error ? 'Versão da análise não confirmada' : veredito.titulo}</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{veredito.detalhe}</p>
        <p className="mt-2 text-xs text-muted-foreground">Nenhuma proposta enviada.</p>
      </div>
      {atual && recurso.data?.origem === 'integrado' && <PdfButton tender={resultado.tender} analise={turno.id} tipo="relatorio" rotulo="Baixar análise em PDF" />}
    </section>
    {turno.catalogos && <p className="text-sm text-muted-foreground">Catálogos desta análise: {turno.catalogos.arquivos.map(a => a.titulo).join(' · ')}.</p>}
    {recurso.error && <Alert><AlertDescription>Não foi possível atualizar os documentos. {recurso.error}</AlertDescription></Alert>}
    {dossier?.analiseId && !atual && <Alert><AlertDescription>Uma análise mais recente substituiu o dossiê. Este resultado é o histórico desta execução; os documentos atuais estão na análise mais recente. <AppLink href="#/turnos">Ver editais</AppLink></AlertDescription></Alert>}
    <Tabs value={aba} onValueChange={setAba}>
      <TabsList variant="line" className="workspace-tabs">
        <TabsTrigger value="resumo">Resultado</TabsTrigger>
        <TabsTrigger value="documentos">Documentos</TabsTrigger>
        <TabsTrigger value="evidencias">Evidências</TabsTrigger>
      </TabsList>
      <TabsContent value="resumo" className="mt-4 flex flex-col gap-6">
        <section aria-label="Itens analisados">
          <h3 className="border-b pb-3 text-base font-semibold">Itens analisados <span className="ml-1 text-sm font-normal text-muted-foreground">({resultado.itens.length})</span></h3>
          <ul className="divide-y">
            {resultado.itens.map(item => <li key={item.item} className="py-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Item {item.item}</span>
                <Badge variant={item.estadoCodigo === 'disputar' ? 'secondary' : 'outline'}>{item.estado}</Badge>
              </div>
              <p className="mt-2 font-medium wrap-anywhere">{item.motivo || 'Motivo não registrado.'}</p>
              <p className="mt-1 text-muted-foreground wrap-anywhere">{item.descricao}</p>
              {atual && <AppLink href={'#/' + itemPath(resultado.tender, item.item)}>Ver evidências do item</AppLink>}
            </li>)}
          </ul>
        </section>
        {atual && <OperationalConditions operacao={dossier?.operacao} />}
        {atual && <TenderActions tender={resultado.tender} />}
      </TabsContent>
      <TabsContent value="documentos" className="mt-4 flex flex-col gap-6">
        {proposta ? <Card>
          <CardHeader>
            <CardTitle><h3>{dossier?.reavaliar || dossier?.desatualizado ? 'Proposta bloqueada até a atualização' : 'Minuta da proposta'}</h3></CardTitle>
            <CardDescription>Revise e assine antes de utilizar.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{proposta.origemDados === 'sinteticos' ? 'A minuta usa cadastro, catálogo e condições comerciais fictícios. O PDF identifica essa origem.' : 'Dados cadastrais sem verificação independente de autenticidade.'}</p>
            {dossier?.publicacao?.conferida === false && <Alert>
              <TriangleAlertIcon /><AlertTitle>Publicação ainda não confirmada</AlertTitle>
              <AlertDescription>{dossier.publicacao.motivo}</AlertDescription>
            </Alert>}
            {dossier?.operacao?.requerRevisao && <Alert><AlertDescription>Há condições operacionais a confirmar. Confira “Condições para fornecer” no resultado antes de utilizar a minuta.</AlertDescription></Alert>}
            {proposta.pendencias.length > 0 && <div className="border-y py-3">
              <h4 className="mb-2 font-medium">Complete antes de utilizar</h4>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{proposta.pendencias.map(p => <li className="wrap-anywhere" key={p}>{p}</li>)}</ul>
            </div>}
            {!dossier?.reavaliar && !dossier?.desatualizado && <PdfButton tender={resultado.tender} analise={turno.id} tipo="proposta" rotulo="Baixar minuta em PDF" destaque />}
            <Accordion><AccordionItem value="previa"><AccordionTrigger>Abrir prévia da minuta</AccordionTrigger><AccordionContent><DocumentPreview markdown={proposta.markdown} /></AccordionContent></AccordionItem></Accordion>
          </CardContent>
        </Card> : <EmptyState icon={<FileTextIcon />} title="Proposta ainda não preparada" description={veredito.liberados + veredito.condicionados > 0 ? 'Há itens candidatos, mas esta execução ainda não produziu um documento. Nenhum arquivo será preenchido com dados inventados.' : 'A proposta é preparada quando existe um item viável. Resolva as pendências técnicas antes de avançar.'} />}
        {atual && dossier?.planoDocumentos && <DocumentPlan plan={dossier.planoDocumentos} arquivos={!dossier.reavaliar && !dossier.desatualizado ? { tender: resultado.tender, analise: turno.id } : undefined} />}
      </TabsContent>
      <TabsContent value="evidencias" className="mt-4 flex flex-col gap-4">
        <h3 className="text-base font-semibold">Fontes do edital</h3>
        {(!atual || !dossier?.documentos.length) && <p className="text-sm text-muted-foreground">Nenhuma citação documental disponível para esta execução.</p>}
        {resultado.dossie && <AppLink href={'#/' + dossierPath(resultado.tender)}>{atual ? 'Abrir dossiê completo' : 'Abrir dossiê atual'}</AppLink>}
        {atual && dossier?.documentos.map((fonte, i) => <Evidence key={i} source={fonte} quote />)}
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
    {!!pendencias.length && <Card><CardHeader><CardTitle>Precisa da sua decisão</CardTitle><CardDescription>{pendencias.length} {pendencias.length === 1 ? 'pendência' : 'pendências'}.</CardDescription></CardHeader><CardContent><Accordion>{pendencias.map(row => <AccordionItem key={row.id} value={row.id}>
      <AccordionTrigger>{row.item ? 'Item ' + row.item + ' · ' : ''}{row.motivo}</AccordionTrigger>
      <AccordionContent><EscalationCard row={row} embedded onResolved={() => recurso.refresh()} /></AccordionContent>
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
  const relato = useMemo<RelatoTurnos>(() => {
    const aberto = expandir ? data.turnos[0] : undefined;
    return {
      conhecidos: true,
      turnos: data.turnos.map(turno => ({ status: turno.status, temResultado: (turno.resultados?.length ?? 0) > 0 })),
      analise: aberto ? { status: aberto.status, mostraResultado: aberto.status === 'concluido' && (aberto.resultados?.length ?? 0) > 0 } : null,
    };
  }, [data.turnos, expandir]);
  useRelatarTurnos(relato);
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
    <PageHeader title="Seus editais"
      actions={<Button nativeButton={false} render={<a href="#/onboarding/editais" />}>Analisar um edital</Button>} />
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
            {(veredito || turno.status === 'ativo' || turno.motivo) && <p className="text-sm">{veredito?.titulo ?? (turno.status === 'ativo' ? resumirProgresso(turno).atividade : turno.motivo)}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">{dateTime.format(new Date(turno.inicio))}</span>
              <Button variant="outline" nativeButton={false} render={<a href={'#/turnos/' + encodeURIComponent(turno.id)} />}>{turno.status === 'ativo' ? 'Acompanhar análise' : turno.status === 'concluido' ? 'Ver resultado' : 'Ver análise'} <ArrowRightIcon data-icon="inline-end" /></Button>
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
    <PageHeader title="Pendências" />
    <Tabs defaultValue="decisoes"><TabsList variant="line" className="workspace-tabs"><TabsTrigger value="decisoes">Decisões {rows.length > 0 && <Badge variant="secondary">{rows.length}</Badge>}</TabsTrigger><TabsTrigger value="prazos">Prazos e alertas</TabsTrigger></TabsList>
      <TabsContent value="decisoes" className="mt-4 flex flex-col gap-4">{rows.length ? <Card><CardContent><Accordion>{rows.map(row => <AccordionItem key={row.id} value={row.id}>
        <AccordionTrigger><span className="flex flex-col gap-1 text-left"><span>{row.motivo}</span><span className="text-xs font-normal text-muted-foreground">{row.pregao}{row.item ? ' · Item ' + row.item : ''}</span></span></AccordionTrigger>
        <AccordionContent><EscalationCard row={row} embedded onResolved={refresh} /></AccordionContent>
      </AccordionItem>)}</Accordion></CardContent></Card> : <EmptyState icon={<CheckIcon />} title="Nenhuma decisão pendente" description="As decisões que exigem revisão aparecem aqui." />}</TabsContent>
      <TabsContent value="prazos" className="mt-4"><View<Pauta> path="pauta">{pauta => {
        const linhas = pauta.linhas.filter(l => l.acionavel);
        return linhas.length ? <Card><CardContent><ItemGroup>{linhas.map(l => <AgendaLine key={l.id} line={l} />)}</ItemGroup></CardContent></Card> : <EmptyState icon={<CheckIcon />} title="Nenhum prazo pede ação agora"  />;
      }}</View></TabsContent>
    </Tabs>
  </Page>;
}
