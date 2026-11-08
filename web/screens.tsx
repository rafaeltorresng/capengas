import { useRef, useState } from 'react';
import { CheckIcon, CircleIcon, Clock3Icon, InboxIcon, SearchIcon } from 'lucide-react';
import type { CofreAlert, Decision, Dossier, Escalation, HistoricoPregao, Item as AnalyzedItem, LinhaPauta, Pauta, Proof, QueueItem, SavedDecision, Today, TurnoStatus, Turnos } from '../src/server/contract.ts';
import { ApiError, request } from '@/lib/api';
import {
  coberturaAnvisa, dateTime, dateTimeWithSeconds, day, dayOf, deadlineLabel, deadlineTime, dossierPath,
  duration, itemPath, localDay, money, normalize, origemLabels, papelLabels, regularizacaoAnvisa, statusTurno, time, urgenciaLabels,
} from '@/lib/format';
import { AppLink, EmptyState, Evidence, Metrics, Page, PageHeader, StatusBadge, Trail } from '@/kit';
import { TurnDateFilter } from '@/components/turn-date-filter';
import { PdfButton } from '@/components/pdf-button';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemSeparator, ItemTitle } from '@/components/ui/item';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { OperationalConditions } from '@/components/operational-conditions';
import { Trace as TraceList, TraceDescription, TraceIcon, TraceLine, TraceTitle } from '@/components/ui/trace';

export function Historico({ rows }: { rows: HistoricoPregao[] }) {
  const [search, setSearch] = useState('');
  const query = normalize(search);
  const visible = rows.filter(row => [row.pregao, row.orgao, row.tender].some(value => normalize(value).includes(query)));
  return <Page>
    <PageHeader title="Histórico" detail="Consulte os resultados das análises concluídas e acesse a publicação oficial de cada pregão." />
    <InputGroup className="max-w-sm">
      <InputGroupAddon><SearchIcon /></InputGroupAddon>
      <InputGroupInput type="search" aria-label="Buscar pregão ou órgão" placeholder="Buscar pregão ou órgão" value={search} onChange={event => setSearch(event.target.value)} />
    </InputGroup>
    {!visible.length && <EmptyState icon={<SearchIcon />} title={query ? 'Nenhum pregão encontrado' : 'Nenhuma análise concluída'} description={query ? 'Nenhum pregão corresponde à busca.' : 'As análises concluídas aparecerão aqui.'} />}
    <div className="flex flex-col gap-3">
      {visible.map(row => <Card key={row.tender} size="sm">
        <CardHeader>
          <CardTitle><h2>{row.pregao}</h2></CardTitle>
          <CardDescription>{row.orgao}</CardDescription>
          {row.pncp
            ? <div className="col-start-2 row-span-2 row-start-1 justify-self-end"><AppLink href={row.pncp} external>Abrir no PNCP</AppLink></div>
            : <CardDescription>Link do PNCP indisponível</CardDescription>}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">Análise concluída em {dateTime.format(new Date(row.concluidoEm))}</p>
          <div className="flex flex-wrap gap-2">
            <AppLink href={'#/turnos/' + encodeURIComponent(row.turno)}>Ver turno da análise</AppLink>
            {row.dossie && <AppLink href={'#/' + dossierPath(row.tender)}>Abrir dossiê</AppLink>}
          </div>
          <Accordion>
            <AccordionItem value="itens">
              <AccordionTrigger>Ver resultados por item ({row.itens.length})</AccordionTrigger>
              <AccordionContent>
                <ItemGroup>
                  {row.itens.map((item, index) => <div key={item.item}>
                    {index > 0 && <ItemSeparator />}
                    <Item>
                      <ItemContent>
                        <ItemTitle>
                          <AppLink href={'#/' + itemPath(row.tender, item.item)}>Item {item.item}{item.descricao && ' · ' + item.descricao}</AppLink>
                        </ItemTitle>
                        <ItemDescription><span className="font-medium text-foreground">{item.estado}</span>{item.motivo && ' · ' + item.motivo}</ItemDescription>
                      </ItemContent>
                    </Item>
                  </div>)}
                </ItemGroup>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>)}
    </div>
  </Page>;
}

function CofreAlerts({ alerts }: { alerts: CofreAlert[] }) {
  return <Alert>
    <AlertTitle>Calendário do cofre</AlertTitle>
    <AlertDescription>
      <ul className="flex flex-col gap-3">
        {alerts.map(alert => <li key={alert.documento ?? alert.exigencia}>
          <p>{alert.resumo}</p>
          <ul className="mt-1 flex flex-col gap-1">
            {alert.pregoes.map(pregao => <li key={pregao.tenderId}>
              {pregao.dossie
                ? <AppLink href={'#/' + dossierPath(pregao.tenderId)}>Dossiê do pregão {pregao.tenderId}</AppLink>
                : <span>Pregão {pregao.tenderId}</span>}
              {' · '}<time dateTime={pregao.sessao}>Sessão em {day.format(new Date(pregao.sessao + 'T12:00:00-03:00'))}</time>
            </li>)}
          </ul>
        </li>)}
      </ul>
    </AlertDescription>
  </Alert>;
}

export function TodayScreen({ data }: { data: Today }) {
  const eventos = data.eventos.filter(event => event.tipo !== 'turno_progresso');
  return <Page>
    <PageHeader title="Hoje" detail={day.format(new Date(data.data + 'T12:00:00-03:00'))} />
    <Metrics items={[
      ['Pregões', data.pregoes], ['Itens', data.itens], ['Disputar', data.disputar],
      ['Pendências', data.pendencias], ['Escaladas abertas', data.escaladasAbertas], ['Custo', money(data.custoUsd, 'USD')],
    ]} />
    {data.cofre?.length ? <CofreAlerts alerts={data.cofre} /> : null}
    <Card>
      <CardHeader>
        <CardTitle><h2>Linha do tempo</h2></CardTitle>
        <CardDescription>Horário de Fortaleza</CardDescription>
      </CardHeader>
      <CardContent>
        {eventos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum evento registrado neste dia.</p>}
        <ItemGroup>
          {eventos.map((event, index) => <div key={event.id}>
            {index > 0 && <ItemSeparator />}
            <Item>
              <ItemContent>
                <ItemDescription>
                  <time dateTime={event.horario}>{time.format(new Date(event.horario))}</time>
                  {' · '}{['decisao-humana', 'escalada_decidida'].includes(event.tipo) ? 'Revisão humana' : event.tipo}
                </ItemDescription>
                <ItemTitle>{event.resumo}</ItemTitle>
                {event.detalhe && <ItemDescription>{event.detalhe}</ItemDescription>}
                {event.rastro?.length ? <Trail entries={event.rastro} /> : null}
                <div className="flex flex-wrap gap-2">
                  {event.tender && event.item && event.itemDisponivel !== false && <AppLink href={'#/' + itemPath(event.tender, event.item)}>Abrir item {event.item}</AppLink>}
                  {event.tender && event.dossie && <AppLink href={'#/' + dossierPath(event.tender)}>Abrir dossiê</AppLink>}
                  {['Escalada', 'escalada_aberta'].includes(event.tipo) && <AppLink href="#/escaladas">Ver aprovações</AppLink>}
                </div>
              </ItemContent>
            </Item>
          </div>)}
        </ItemGroup>
      </CardContent>
    </Card>
    <Card size="sm">
      <CardHeader>
        <CardTitle><h2>Relatório do dia</h2></CardTitle>
        <CardDescription>Envios registrados: {data.envios}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1 text-sm">
          {data.porDecisao.map(row => <li key={row.estado}>{row.estado}: {row.quantidade}</li>)}
        </ul>
      </CardContent>
    </Card>
  </Page>;
}

export function AgendaLine({ line }: { line: LinhaPauta }) {
  return <Item>
    <ItemContent>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary">{papelLabels[line.papel]}</Badge>
        {line.ate && <span className="text-xs text-muted-foreground"><time dateTime={line.ate}>Até {dayOf(line.ate)}</time></span>}
        {line.urgencia && line.acionavel && <Badge variant={line.urgencia === 'vencido' || line.urgencia === 'hoje' ? 'destructive' : 'outline'}>{urgenciaLabels[line.urgencia]}</Badge>}
        <span className="text-xs text-muted-foreground">{origemLabels[line.origem]}</span>
        {line.sintetico && <Badge variant="outline">Errata sintética de teste</Badge>}
      </div>
      <ItemTitle>{line.acao}</ItemTitle>
      <ItemDescription>{line.oQueMudou}</ItemDescription>
      {line.prazo?.artigo && <ItemDescription>Base: {line.prazo.artigo} da Lei 14.133
        {line.prazo.divergencia && ` · lei: ${dayOf(line.prazo.divergencia.lei)}, edital: ${dayOf(line.prazo.divergencia.edital)}`}
      </ItemDescription>}
      <div className="flex flex-col gap-2">
        {line.fonte && <Evidence source={line.fonte} quote />}
        <div className="flex flex-wrap gap-2">
          {line.tenderId && line.item !== undefined && line.itemDisponivel && <AppLink href={'#/' + itemPath(line.tenderId, String(line.item))}>Abrir item {line.item}</AppLink>}
          {line.tenderId && line.dossie && <AppLink href={'#/' + dossierPath(line.tenderId)}>Abrir dossiê</AppLink>}
          {line.pregoes?.map(id => <span key={id} className="text-sm text-muted-foreground">Pregão {id}</span>)}
        </div>
      </div>
    </ItemContent>
  </Item>;
}

export function AgendaScreen({ data }: { data: Pauta }) {
  const now = data.linhas.filter(line => line.acionavel);
  const info = data.linhas.filter(line => !line.acionavel);
  return <Page>
    <PageHeader title="Pauta" detail={dayOf(data.data) + ' · o que mudou desde ontem e quem precisa agir'} />
    <Metrics items={[['Para agir', data.contagem.acionaveis], ['Informativas', data.contagem.informativas]]} />
    <Card>
      <CardHeader>
        <CardTitle><h2>Para agir</h2></CardTitle>
      </CardHeader>
      <CardContent>
        {now.length ? <ItemGroup>{now.map((line, index) => <div key={line.id}>{index > 0 && <ItemSeparator />}<AgendaLine line={line} /></div>)}</ItemGroup>
          : <p className="text-sm text-muted-foreground">Nada pede ação hoje.</p>}
      </CardContent>
    </Card>
    {info.length > 0 && <Card>
      <CardHeader><CardTitle><h2>Informativas</h2></CardTitle></CardHeader>
      <CardContent>
        <ItemGroup>{info.map((line, index) => <div key={line.id}>{index > 0 && <ItemSeparator />}<AgendaLine line={line} /></div>)}</ItemGroup>
      </CardContent>
    </Card>}
  </Page>;
}

export function QueueScreen({ rows }: { rows: QueueItem[] }) {
  const [tender, setTender] = useState('');
  const [agency, setAgency] = useState('');
  const [deadline, setDeadline] = useState('');
  const tenders = new Map(rows.map(row => [row.tender, row.pregao]));
  const agencies = [...new Set(rows.map(row => row.orgao))];
  const deadlineLimit = deadline ? Date.parse(deadline + 'T23:59:59.999-03:00') : Infinity;
  const visible = rows.filter(row => (!tender || row.tender === tender) &&
    (!agency || row.orgao === agency) && (!deadline || deadlineTime(row.prazo) <= deadlineLimit));
  return <Page>
    <PageHeader title="Fila de decisões" detail="Acompanhe o estado e o motivo de cada item." />
    <div className="flex flex-wrap items-end gap-3">
      <Field className="w-56">
        <FieldLabel htmlFor="pregao">Pregão</FieldLabel>
        <NativeSelect id="pregao" value={tender} onChange={event => setTender(event.target.value)}>
          <NativeSelectOption value="">Todos</NativeSelectOption>
          {[...tenders].map(([id, name]) => <NativeSelectOption key={id} value={id}>{name}</NativeSelectOption>)}
        </NativeSelect>
      </Field>
      <Field className="w-56">
        <FieldLabel htmlFor="orgao">Órgão</FieldLabel>
        <NativeSelect id="orgao" value={agency} onChange={event => setAgency(event.target.value)}>
          <NativeSelectOption value="">Todos</NativeSelectOption>
          {agencies.map(name => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}
        </NativeSelect>
      </Field>
      <Field className="w-44">
        <FieldLabel htmlFor="prazo">Prazo até</FieldLabel>
        <Input id="prazo" type="date" value={deadline} onChange={event => setDeadline(event.target.value)} />
      </Field>
    </div>
    {!visible.length && <EmptyState icon={<InboxIcon />} title="Nenhum item encontrado" description="Confira os filtros da fila." />}
    {visible.length > 0 &&     <Card size="sm" className="overflow-visible">
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Pregão</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Órgão</TableHead>
              <TableHead>Prazo</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map(row => <TableRow key={row.tender + ':' + row.item}>
              <TableCell className="whitespace-normal">
                <AppLink href={'#/' + itemPath(row.tender, row.item)}>{row.descricao}</AppLink>
                <span className="mt-1 block text-xs text-muted-foreground">Item {row.item}</span>
              </TableCell>
              <TableCell className="whitespace-normal">{row.pregao}</TableCell>
              <TableCell className="whitespace-normal"><span className="font-medium">{row.estado}.</span> {row.motivo}</TableCell>
              <TableCell className="whitespace-normal">{row.orgao}</TableCell>
              <TableCell className="whitespace-normal">{deadlineLabel(row.prazo, row.prazoTipo)}</TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      </CardContent>
    </Card>}
  </Page>;
}

export function ProofScreen({ data }: { data: Proof }) {
  return <Page>
    <PageHeader title="Prova" detail={data.fonte} />
    <Metrics items={[
      ['Concordância', data.concordancia === null ? 'Sem medição' : data.concordancia + '%'],
      ['Custo do turno', money(data.custoUsd, 'USD')],
      ['Tempo do turno', data.duracaoMs === null ? 'Sem medição' : duration(data.duracaoMs)],
    ]} />
    <div className="grid gap-3 lg:grid-cols-2">
      <Card size="sm">
        <CardHeader><CardTitle><h2>Avaliações</h2></CardTitle></CardHeader>
        <CardContent>
          {data.avaliacoes.length ? <ItemGroup>{data.avaliacoes.map((row, index) => <div key={row.nome}>
            {index > 0 && <ItemSeparator />}
            <Item><ItemContent><ItemTitle>{row.nome}</ItemTitle><ItemDescription>{row.valor}</ItemDescription></ItemContent></Item>
          </div>)}</ItemGroup> : <p className="text-sm text-muted-foreground">Sem medição.</p>}
        </CardContent>
      </Card>
      <Card size="sm">
        <CardHeader><CardTitle><h2>Cenários de exceção</h2></CardTitle></CardHeader>
        <CardContent>
          {data.cenarios.length ? <ItemGroup>{data.cenarios.map((row, index) => <div key={row.nome}>
            {index > 0 && <ItemSeparator />}
            <Item><ItemContent><ItemTitle>{row.nome}</ItemTitle><ItemDescription>{row.resultado}</ItemDescription></ItemContent></Item>
          </div>)}</ItemGroup> : <p className="text-sm text-muted-foreground">Sem medição.</p>}
        </CardContent>
      </Card>
    </div>
  </Page>;
}

export function ItemScreen({ item }: { item: AnalyzedItem }) {
  return <Page>
    <PageHeader
      title={item.descricao}
      detail={item.pregao + ' / item ' + item.item + ' / ' + deadlineLabel(item.prazo, item.prazoTipo)}
      actions={<Button variant="outline" nativeButton={false} render={<a href="#/fila" />}>Ver fila</Button>}
    />
    <Alert>
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span><span className="font-medium text-foreground">{item.estado}.</span> {item.motivo}</span>
        {item.dossie && <AppLink href={'#/' + dossierPath(item.tender)}>Abrir dossiê</AppLink>}
      </AlertDescription>
    </Alert>
    <Tabs defaultValue="encaixe">
      <TabsList>
        <TabsTrigger value="encaixe">Encaixe técnico</TabsTrigger>
        <TabsTrigger value="sanitario">Preço e registro</TabsTrigger>
      </TabsList>
      <TabsContent value="encaixe">
        <Card>
          <CardHeader><CardTitle>Conferência</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Metrics items={[
              ['Citações', item.validacao?.citacoes === 'conferidas' ? 'Trechos conferidos' : 'Não verificadas'],
              ['Cobertura dos campos', item.validacao?.cobertura === 'conferida' ? 'Conferida' : 'Não verificada'],
              ['Conclusão técnica', item.validacao?.semantica === 'julgamento_modelo' ? 'Julgamento do modelo' : 'Não verificada'],
            ]} />
            {item.validacao?.lacunas.length ? <Accordion>
              <AccordionItem value="lacunas">
                <AccordionTrigger>Campos sem citação própria ({item.validacao.lacunas.length})</AccordionTrigger>
                <AccordionContent>
                  <ul className="flex flex-col gap-2">{item.validacao.lacunas.map((clause, index) => <li key={index}>{clause}</li>)}</ul>
                </AccordionContent>
              </AccordionItem>
            </Accordion> : null}
            {item.encaixe.length ? <div role="region" aria-label="Tabela de encaixe" tabIndex={0}>
              <Table>
                <TableHeader>
                  <TableRow>{['Atributo', 'Exigido', 'Ofertado', 'Resultado e evidência'].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow>
                </TableHeader>
                <TableBody>
                  {item.encaixe.map((row, index) => <TableRow key={index}>
                    <TableCell className="font-medium">{row.atributo}</TableCell>
                    <TableCell>{row.exigido}</TableCell>
                    <TableCell>{row.ofertado}</TableCell>
                    <TableCell>
                      <span className="font-medium">{row.resultado}</span>
                      {row.fonte && <div className="mt-2"><Evidence source={row.fonte} quote /></div>}
                    </TableCell>
                  </TableRow>)}
                </TableBody>
              </Table>
            </div> : <p className="text-sm text-muted-foreground">O encaixe deste item ainda está em análise.</p>}
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="sanitario">
        <Card>
          <CardHeader><CardTitle>Preço e registro sanitário</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Metrics items={[['Preço da proposta', money(item.preco, 'BRL')], ['Estimativa', money(item.estimativa, 'BRL')]]} />
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-sm text-muted-foreground">Regularização na ANVISA</dt><dd>{item.regularizacao ? regularizacaoAnvisa[item.regularizacao] : 'Não verificada'}</dd></div>
              <div><dt className="text-sm text-muted-foreground">Cobertura do produto ofertado</dt><dd>{item.cobertura ? coberturaAnvisa[item.cobertura] : 'Não comprovada'}</dd></div>
            </dl>
            {!item.regularizacao && !item.cobertura && <p className="text-sm">{item.anvisa}</p>}
            <ul className="flex flex-col gap-2">{item.fontes.map(source => <li key={source.url}><Evidence source={source} /></li>)}</ul>
            <Trail entries={item.rastro} />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  </Page>;
}

type Plan = NonNullable<Dossier['planoDocumentos']>;
const faseLabel: Record<Plan['linhas'][number]['fase'], string> = {
  proposta_inicial: 'Proposta inicial (antes da sessão)', proposta_ajustada: 'Proposta ajustada (após o último lance)',
  habilitacao: 'Habilitação', nao_informada: 'Fase não informada no edital',
};
const responsavelLabel = { lance: 'Lance', humano: 'Sua equipe', terceiro: 'Fabricante' } as const;
const planProblem = new Set(['vence_antes', 'ausente', 'irregular', 'pedir_terceiro', 'conferir']);

/** `arquivos` libera o download das declarações geradas; fica de fora quando a análise está desatualizada. */
export function DocumentPlan({ plan, arquivos }: { plan: Plan; arquivos?: { tender: string; analise?: string } }) {
  const fases = [...new Set(plan.linhas.map(l => l.fase))];
  const faseInicial = plan.linhas.find(l => planProblem.has(l.status))?.fase ?? fases[0];
  return <Card>
    <CardHeader>
      <CardTitle><h2>Documentos para disputar</h2></CardTitle>
      <CardDescription>
        {plan.resumo.total} {plan.resumo.total === 1 ? 'exigência registrada' : 'exigências registradas'} · {plan.resumo.problemas} {plan.resumo.problemas === 1 ? 'pendência' : 'pendências'}
      </CardDescription>
    </CardHeader>
    <CardContent className="flex flex-col gap-6">
      <Accordion defaultValue={faseInicial ? [faseInicial] : []}>{fases.map(fase => <AccordionItem key={fase} value={fase}>
        <AccordionTrigger>{faseLabel[fase]} <Badge variant="secondary">{plan.linhas.filter(l => l.fase === fase).length}</Badge></AccordionTrigger>
        <AccordionContent>
        <ItemGroup>
          {plan.linhas.filter(l => l.fase === fase).map((linha, index) => <div key={linha.tipo + index}>
            {index > 0 && <ItemSeparator />}
            <Item>
              <ItemContent>
                <ItemTitle>
                  {linha.documento}
                  <Badge variant={planProblem.has(linha.status) ? 'destructive' : linha.status === 'nao_se_aplica' ? 'outline' : 'secondary'}>{linha.rotulo}</Badge>
                  {linha.status !== 'lance_gera' && linha.status !== 'nao_se_aplica' && <Badge variant="outline">{responsavelLabel[linha.responsavel]}</Badge>}
                  {linha.condicional && <Badge variant="outline">Condicional</Badge>}
                </ItemTitle>
                <ItemDescription>{linha.acao}</ItemDescription>
                {linha.prazo && <ItemDescription>Prazo: {linha.prazo}</ItemDescription>}
                {linha.ate && planProblem.has(linha.status) && <ItemDescription>Resolver até a sessão, em {dayOf(linha.ate)}.</ItemDescription>}
                {linha.declaracao && arquivos && <PdfButton tender={arquivos.tender} analise={arquivos.analise} tipo={`documento-${plan.linhas.indexOf(linha)}`} rotulo="Baixar declaração em PDF" />}
                {linha.fonte && <Accordion><AccordionItem value="fonte"><AccordionTrigger>Conferir exigência no edital</AccordionTrigger><AccordionContent><Evidence source={{ ...linha.fonte, citacao: linha.citacao }} quote /></AccordionContent></AccordionItem></Accordion>}
              </ItemContent>
            </Item>
          </div>)}
        </ItemGroup>
        </AccordionContent>
      </AccordionItem>)}</Accordion>
    </CardContent>
  </Card>;
}

export function DossierScreen({ data }: { data: Dossier }) {
  return <Page>
    <PageHeader title="Dossiê" detail={data.pregao + ' / versão ' + data.versao} />
    <OperationalConditions operacao={data.operacao} />
    {data.desatualizado && <Alert><AlertDescription>Os dados ou as decisões mudaram após esta análise. A proposta anterior está bloqueada até atualizar o dossiê.</AlertDescription></Alert>}
    {data.pendencias.length > 0 && <Alert>
      <AlertTitle>Pendências</AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-1">{data.pendencias.map(text => <li key={text}>{text}</li>)}</ul>
        <AppLink href="#/escaladas">Ver aprovações</AppLink>
      </AlertDescription>
    </Alert>}
    {data.retificacao && <Card>
      <CardHeader>
        <CardTitle><h2>Retificação {data.retificacao.versao}</h2></CardTitle>
        {data.retificacao.aviso && <CardDescription>{data.retificacao.aviso}</CardDescription>}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">Abertura {data.retificacao.abertura}. Publicada antes: {data.retificacao.aberturaPublicadaAntes ?? 'sem data'}. Publicada depois: {data.retificacao.aberturaPublicadaDepois ?? 'sem data'}. Itens com evidência reaproveitada: {data.retificacao.itensSemReleitura}. Economia de chamadas e custo sem medição.</p>
        <ul className="flex flex-col gap-3 text-sm">
          {data.retificacao.linhas.map((linha, index) => <li key={index}>Item {linha.item}: {linha.estado}. {linha.motivo}
            {linha.quantidadeNova != null && <> Quantidade {linha.quantidadeAnterior} para {linha.quantidadeNova}.</>}
            {linha.precoUnitario !== undefined && <> Preço unitário {money(linha.precoUnitario, 'BRL')}. Total {money(linha.valorTotal ?? null, 'BRL')}.</>}
            {linha.escalarLimite ? ' Não libera decisão automática.' : ''}
            {linha.chamarAgente ? ' O agente relê este item.' : ''}{linha.discordancia ? ' ' + linha.discordancia : ''}
          </li>)}
        </ul>
        {data.reavaliar && <Alert><AlertDescription>Envio bloqueado: reavaliação pendente. Os dados da análise anterior permanecem no dossiê para auditoria.</AlertDescription></Alert>}
        <ItemGroup>{data.retificacao.pauta.map((linha, index) => <div key={linha.id}>{index > 0 && <ItemSeparator />}<AgendaLine line={linha} /></div>)}</ItemGroup>
        {!!data.retificacoes?.length && <Accordion>
          <AccordionItem value="historico">
            <AccordionTrigger>Histórico de retificações ({data.retificacoes.length})</AccordionTrigger>
            <AccordionContent>
              <div className="flex flex-col gap-4">
                {data.retificacoes.map(versao => <div key={versao.versao} className="flex flex-col gap-2">
                  <h3 className="font-medium">Retificação {versao.versao}</h3>
                  <p className="text-muted-foreground">{versao.sintetica ? 'Caso sintético. ' : ''}Abertura: {versao.aberturaPublicadaDepois ?? 'desconhecida'}.</p>
                  <ul className="flex flex-col gap-1">{versao.linhas.map((linha, index) => <li key={index}>Item {linha.item}: {linha.estado}. {linha.motivo} {linha.discordancia}</li>)}</ul>
                </div>)}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>}
      </CardContent>
    </Card>}
    {data.planoDocumentos && <DocumentPlan plan={data.planoDocumentos} arquivos={!data.reavaliar && !data.desatualizado ? { tender: data.tender, analise: data.analiseId } : undefined} />}
    <Card>
      <CardHeader><CardTitle><h2>Checklist</h2></CardTitle></CardHeader>
      <CardContent>
        <ItemGroup>
          {data.checklist.map((row, index) => <div key={index}>
            {index > 0 && <ItemSeparator />}
            <Item>
              <ItemContent>
                <ItemTitle>{row.exigencia}</ItemTitle>
                <ItemDescription>{row.documento ?? 'Documento indisponível'}</ItemDescription>
                <ItemDescription>{row.status}</ItemDescription>
                {row.detalhe && <ItemDescription>{row.detalhe}</ItemDescription>}
                {row.fonte && <Evidence source={row.fonte} quote />}
              </ItemContent>
            </Item>
          </div>)}
        </ItemGroup>
      </CardContent>
    </Card>
    <Card size="sm">
      <CardHeader><CardTitle><h2>Documentos</h2></CardTitle></CardHeader>
      <CardContent>
        {data.documentos.length
          ? <ul className="flex flex-col gap-2">{data.documentos.map(source => <li key={source.url}><Evidence source={source} /></li>)}</ul>
          : <p className="text-sm text-muted-foreground">Nenhum documento disponível.</p>}
      </CardContent>
    </Card>
  </Page>;
}

const decisionOptions = [
  { value: 'aprovar', label: 'Aprovar' },
  { value: 'recusar', label: 'Recusar' },
  { value: 'ajustar', label: 'Solicitar ajuste' },
] as const;

export function EscalationCard({ row, onResolved, embedded = false }: { row: Escalation; onResolved: (message: string) => void; embedded?: boolean }) {
  const [choice, setChoice] = useState<Decision['decisao'] | ''>('');
  const [adjustment, setAdjustment] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function save(decisao: Decision['decisao']) {
    setBusy(true);
    setError('');
    try {
      const { dados } = await request<SavedDecision>('escaladas/' + encodeURIComponent(row.id), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisao, ...(decisao === 'ajustar' ? { ajuste: adjustment } : {}) }),
      });
      setSaved(true);
      onResolved('Decisão registrada.');
      if (dados.turno) window.location.hash = '#/turnos/' + encodeURIComponent(dados.turno);
    } catch (failure) {
      if (failure instanceof ApiError && [404, 409].includes(failure.status)) {
        setSaved(true);
        onResolved(failure.status === 404 ? 'Esta pendência não está mais disponível.' : failure.message.replace('escalada', 'pendência'));
      }
      else setError(failure instanceof ApiError ? failure.message : 'Não foi possível registrar a decisão.');
    } finally { setBusy(false); }
  }
  const deadline = deadlineLabel(row.prazo, row.prazoTipo ?? 'decisao_humana');
  const details = <div className="flex flex-col gap-4">
      {embedded && <p className="text-sm text-muted-foreground">{deadline}</p>}
      <div className="border-l pl-3">
        <p className="text-sm font-medium">Recomendação do Lance</p>
        <p className="text-sm text-muted-foreground wrap-anywhere">{row.recomendacao}</p>
      </div>
      {(row.dossie || row.item) && <div className="flex flex-wrap gap-x-4 gap-y-1">
        {row.dossie && <AppLink href={'#/' + dossierPath(row.tender)}>Abrir dossiê</AppLink>}
        {row.item && (row.itemDisponivel === false
          ? <span className="text-sm">Item {row.item}</span>
          : <AppLink href={'#/' + itemPath(row.tender, row.item)}>Abrir item {row.item}</AppLink>)}
      </div>}
      <form onSubmit={event => {
        event.preventDefault();
        if (choice && !busy && !saved) void save(choice);
      }}>
        <FieldSet disabled={busy || saved}>
          <FieldLegend>Decisão da equipe</FieldLegend>
          <RadioGroup value={choice} onValueChange={value => setChoice(value as Decision['decisao'])} className="flex flex-wrap gap-x-5 gap-y-3">
            {decisionOptions.map(({ value, label }) => <FieldLabel key={value} htmlFor={row.id + '-' + value} className="flex items-center gap-2">
              <RadioGroupItem value={value} id={row.id + '-' + value} />
              {label}
            </FieldLabel>)}
          </RadioGroup>
          {choice === 'ajustar' && <Field>
            <FieldLabel htmlFor={row.id + '-ajuste'}>Descreva o ajuste</FieldLabel>
            <Textarea id={row.id + '-ajuste'} value={adjustment} onChange={event => setAdjustment(event.target.value)} required maxLength={600} />
          </Field>}
        </FieldSet>
        <Button type="submit" className="mt-4" disabled={busy || saved || !choice || (choice === 'ajustar' && !adjustment.trim())}>
          {busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
          {busy ? 'Registrando…' : 'Registrar decisão'}
        </Button>
        {error && <FieldError>{error}</FieldError>}
      </form>
    </div>;
  if (embedded) return details;
  return <Card size="sm">
    <CardHeader>
      <CardDescription>{row.pregao}{row.item && ' / Item ' + row.item}</CardDescription>
      <CardTitle><h2>{row.motivo}</h2></CardTitle>
      <div className="col-start-2 row-span-2 row-start-1 justify-self-end">
        <Badge variant="outline"><Clock3Icon />{deadline}</Badge>
      </div>
    </CardHeader>
    <CardContent>{details}</CardContent>
  </Card>;
}

export function EscalationScreen({ rows, refresh }: { rows: Escalation[]; refresh: () => void }) {
  const [message, setMessage] = useState('');
  const status = useRef<HTMLDivElement>(null);
  const sorted = [...rows].sort((a, b) => (deadlineTime(a.prazo) || Infinity) - (deadlineTime(b.prazo) || Infinity));
  return <Page>
    <PageHeader title="Aprovações" detail="Revise as pendências e registre a decisão da sua equipe." />
    <div role="status" tabIndex={-1} ref={status}>
      {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
    </div>
    {sorted.map(row => <EscalationCard key={row.id} row={row} onResolved={text => {
      setMessage(text);
      status.current?.focus();
      refresh();
    }} />)}
    {!rows.length && <EmptyState icon={<CheckIcon />} title="Nenhuma decisão pendente" />}
  </Page>;
}
