import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ApiResponse, CofreAlert, DeadlineKind, Decision, Dossier, Escalation, HistoricoPregao, Item, LinhaPauta, Origem, Papel, Pauta, Proof, QueueItem, SavedDecision, Source, Today, Trace, Turnos, TurnoStatus, Urgencia } from '../src/server/contract.ts';
import { Search, UserRound, ExternalLink, AlertCircle, Check, X, Pencil, FileText, Clock3, ChevronDown } from 'lucide-react';
import { Avatar, AvatarFallback } from './components/ui/avatar.tsx';
import { Button, buttonVariants } from './components/ui/button.tsx';
import { Card } from './components/ui/card.tsx';
import { Badge } from './components/ui/badge.tsx';
import { Input } from './components/ui/input.tsx';
import { Alert, AlertDescription } from './components/ui/alert.tsx';
import { TurnDateFilter } from './components/turn-date-filter.tsx';
import './style.css';

const fortaleza = 'America/Fortaleza';
const time = new Intl.DateTimeFormat('pt-BR', { timeZone: fortaleza, timeStyle: 'medium' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: fortaleza, dateStyle: 'short', timeStyle: 'short' });
const dateTimeWithSeconds = new Intl.DateTimeFormat('pt-BR', { timeZone: fortaleza, dateStyle: 'short', timeStyle: 'medium' });
const localDay = new Intl.DateTimeFormat('en-CA', { timeZone: fortaleza, year: 'numeric', month: '2-digit', day: '2-digit' });
const day = new Intl.DateTimeFormat('pt-BR', { timeZone: fortaleza, dateStyle: 'long' });
const money = (amount: number | null, currency: string) => amount === null ? 'Sem medição' :
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
const duration = (ms: number) => ms < 1000 ? ms + ' ms' :
  ms < 60_000 ? Math.round(ms / 1000) + ' s' : Math.floor(ms / 60_000) + ' min ' + Math.floor(ms / 1000 % 60) + ' s';
const deadlineLabels: Record<DeadlineKind, string> = {
  sessao: 'Sessão', esclarecimento: 'Prazo de esclarecimento',
  decisao_humana: 'Prazo de decisão', desconhecido: 'Prazo',
};
const deadlineTime = (value: string | null) => value ? Date.parse(value) : NaN;
function deadlineLabel(value: string | null, kind: DeadlineKind = 'desconhecido') {
  const timestamp = deadlineTime(value);
  return Number.isFinite(timestamp)
    ? deadlineLabels[kind] + ' · ' + dateTime.format(timestamp)
    : 'Prazo não informado';
}

const itemPath = (tender: string, item: string) => 'itens/' + encodeURIComponent(tender) + '/' + encodeURIComponent(item);
const dossierPath = (tender: string) => 'dossies/' + encodeURIComponent(tender);
const nav = [
  ['turnos', 'Acompanhamento'], ['hoje', 'Hoje'], ['pauta', 'Pauta'], ['fila', 'Fila'],
  ['escaladas', 'Aprovações'], ['historico', 'Histórico'], ['prova', 'Prova'],
] as const;

class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch('/api/' + path, options);
  const body = await response.json();
  if (!response.ok) {
    const rotaNova = response.status === 404 && (path === 'turnos' || path === 'historico');
    throw new ApiError(response.status, rotaNova
      ? 'Esta tela precisa da API atualizada. Reinicie o servidor local do Lance e tente novamente.'
      : body.erro || 'Não foi possível consultar o Lance.');
  }
  return body;
}

function useApi<T>(path: string, poll = true) {
  const [data, setData] = useState<ApiResponse<T>>();
  const [error, setError] = useState('');
  const [lastRead, setLastRead] = useState<number>();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let busy = false;
    async function load() {
      if (busy) return;
      busy = true;
      try {
        const result = await request<T>(path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
        if (active) { setData(result); setError(''); setLastRead(Date.now()); }
      } catch (failure) {
        if (active) setError(failure instanceof ApiError ? failure.message : 'Não foi possível conectar ao Lance.');
      } finally { busy = false; }
    }
    void load();
    const timer = poll ? window.setInterval(() => void load(), path === 'turnos' ? 5_000 : 10_000) : undefined;
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [path, poll, revision]);
  return { data, error, lastRead, refresh: () => setRevision(value => value + 1) };
}

function View<T>({ path, poll, children }: {
  path: string; poll?: boolean; children: (data: T, refresh: () => void, lastRead?: number) => ReactNode;
}) {
  return <ApiView resource={useApi<T>(path, poll)}>{children}</ApiView>;
}

function ApiView<T>({ resource: { data, error, lastRead, refresh }, children }: {
  resource: ReturnType<typeof useApi<T>>;
  children: (data: T, refresh: () => void, lastRead?: number) => ReactNode;
}) {
  return <>
    {error && <Alert className="mt-4" role="status">
      <AlertCircle />
      <AlertDescription>
        <p>{data ? 'Mostrando a última leitura. ' : ''}{error}</p>
        <Button variant="outline" onClick={refresh}>Tentar novamente</Button>
      </AlertDescription>
    </Alert>}
    {!data && !error && <p role="status">Consultando o estado do Lance…</p>}
    {data && <>
      {data.origem === 'amostra' && <p className="origin">Modo demonstração</p>}
      {children(data.dados, refresh, lastRead)}
    </>}
  </>;
}

function Heading({ title, detail }: { title: string; detail?: string }) {
  return <header className="heading"><h1 tabIndex={-1}>{title}</h1>{detail && <p>{detail}</p>}</header>;
}

function Internal({ path, children }: { path: string; children: ReactNode }) {
  return <a href={'#/' + path}>{children}</a>;
}

function Evidence({ source, quote = false }: { source: Source; quote?: boolean }) {
  const safe = /^https?:\/\//i.test(source.url) || /^\/(?![/\\])/.test(source.url);
  return <>
    {quote && source.citacao && <blockquote>{source.citacao}</blockquote>}
    {safe && <a href={source.url} target="_blank" rel="noreferrer">Ver fonte: {source.nome}</a>}
  </>;
}

function Trail({ entries }: { entries: Trace[] }) {
  if (!entries.length) return <p>Rastro ainda indisponível.</p>;
  return <details className="trace"><summary>Ver rastro ({entries.length})</summary>
    <ul>{entries.map((entry, index) => <li key={index}>
      <strong>{entry.ferramenta}</strong>
      {entry.entrada && <div>Entrada · {entry.entrada}</div>}
      {entry.saida && <div>Saída · {entry.saida}</div>}
      {entry.ms !== undefined && <small>{duration(entry.ms)} </small>}
      {entry.custoUsd !== undefined && <small>{money(entry.custoUsd, 'USD')}</small>}
    </li>)}</ul>
  </details>;
}

function Metrics({ items }: { items: [string, string | number][] }) {
  return <dl className="metrics">{items.map(([label, value]) =>
    <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

const statusTurno: Record<TurnoStatus, string> = {
  ativo: 'Em andamento', sem_atualizacao: 'Sem atualização recente',
  concluido: 'Concluído', incompleto: 'Incompleto', falhou: 'Falhou',
};

function Acompanhamento({ data, lastRead }: { data: Turnos; lastRead?: number }) {
  const [date, setDate] = useState('');
  const visible = data.turnos.filter(turno => !date || localDay.format(new Date(turno.inicio)) === date);
  const feed = new Map<string, (typeof visible)[number]>();
  for (const turno of visible) {
    for (const edital of turno.pregoes) {
      if (!feed.has(edital)) feed.set(edital, turno);
    }
  }
  const editais = [...feed].sort(([, a], [, b]) => Date.parse(b.atualizadoEm) - Date.parse(a.atualizadoEm));
  return <>
    <Heading title="Acompanhamento" detail="Acompanhe os editais e abra cada processo para consultar as etapas da análise." />
    <div className="list-tools">
      <TurnDateFilter dates={data.turnos.map(turno => localDay.format(new Date(turno.inicio)))} value={date} onChange={setDate} />
      {date && <Button variant="outline" onClick={() => setDate('')}>Mostrar todos os turnos</Button>}
      {lastRead && <small>Última consulta às {time.format(lastRead)}</small>}
    </div>
    {!editais.length && <p className="panel">{date ? 'Nenhum edital teve análise iniciada nesta data.' : 'Os editais aparecem aqui assim que uma análise começa.'}</p>}
    <div className="edital-feed">
    {editais.map(([edital, turno]) => {
      const etapa = turno.etapas.at(-1);
      const nome = turno.nomesEditais?.[edital] || 'Edital ' + edital.split('/').at(-1);
      const codigoPncp = /^\d{14}\/\d{4}\/\d+$/.test(edital);
      const emAndamento = turno.status === 'ativo';
      return <details className="edital-card" key={edital}>
        <summary>
          <span className="edital-identidade">
            <strong>{nome}</strong>
            <small>{codigoPncp ? 'PNCP ' + edital : 'Código PNCP indisponível'}</small>
          </span>
          <span className="edital-atualizacao">
            <span>{emAndamento && etapa ? etapa.atividade : statusTurno[turno.status]}</span>
            <time dateTime={turno.atualizadoEm}>{dateTime.format(new Date(turno.atualizadoEm))}</time>
          </span>
          <ChevronDown size={17} aria-hidden="true" />
        </summary>
        <div className="edital-detalhe">
        <div className="panel-heading">
          <h2>Etapas da análise</h2>
          <Badge variant="secondary" className={'badge ' + turno.status}>{statusTurno[turno.status]}</Badge>
        </div>
        <p>Início em <time dateTime={turno.inicio}>{dateTime.format(new Date(turno.inicio))}</time></p>
        {turno.pregoes.length > 1 && <p>Este turno analisa {turno.pregoes.length} editais. As etapas mostram o progresso do turno.</p>}
        {turno.legado && <p>O progresso deste turno antigo está indisponível.</p>}
        {turno.status === 'falhou' && <p>A execução foi interrompida por uma falha.</p>}
        <small>Última atualização em <time dateTime={turno.atualizadoEm}>{dateTimeWithSeconds.format(new Date(turno.atualizadoEm))}</time></small>
        {turno.etapas.length > 0 && <details className="record-details checklist-details">
          <summary><span className="checklist-expand">Ver histórico de etapas</span><span className="checklist-collapse">Recolher histórico de etapas</span> <ChevronDown size={16} aria-hidden="true" /></summary>
          <ol className="agent-checklist" aria-label="Etapas da análise em ordem cronológica">
          {turno.etapas.map(({ horario, atividade, estado }, index) => {
            const atual = estado === 'em_andamento' && turno.status === 'sem_atualizacao' ? 'sem_atualizacao' : estado;
            return <li key={index} data-estado={atual}>
              <svg viewBox="0 0 20 20" className="agent-check" aria-hidden="true">
                <path d="m5 10 3 3 7-7" pathLength="1" />
              </svg>
              <span className="agent-check-text">{atividade}</span>
              <small>{atual === 'concluida' ? 'Concluída' : atual === 'pendente' ? 'Pendente' :
                atual === 'em_andamento' ? 'Em andamento' : atual === 'sem_atualizacao' ? 'Sem atualização' : 'Registrada'}</small>
              <time dateTime={horario}>{time.format(new Date(horario))}</time>
            </li>;
          })}
          </ol>
        </details>}
        </div>
      </details>;
    })}
    </div>
  </>;
}

const normalize = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

function Historico({ rows }: { rows: HistoricoPregao[] }) {
  const [search, setSearch] = useState('');
  const query = normalize(search);
  const visible = rows.filter(row => [row.pregao, row.orgao, row.tender].some(value => normalize(value).includes(query)));
  return <>
    <Heading title="Histórico" detail="Consulte os resultados das análises concluídas e acesse a publicação oficial de cada pregão." />
    <div className="search">
      <Input type="search" aria-label="Buscar pregão ou órgão" placeholder="Buscar pregão ou órgão"
        value={search} onChange={event => setSearch(event.target.value)} />
      {search.length > 0 && <span className="search-icon" aria-hidden="true"><Search size={18} /></span>}
    </div>
    {!visible.length && <p className="panel">{query ? 'Nenhum pregão corresponde à busca.' : 'As análises concluídas aparecerão aqui.'}</p>}
    {visible.map(row => <Card className="panel" key={row.tender}>
      <div className="panel-heading">
        <div><h2>{row.pregao}</h2><p>{row.orgao}</p></div>
        {row.pncp ? <a className={buttonVariants({ variant: "outline" })} href={row.pncp} target="_blank" rel="noreferrer">Abrir no PNCP <ExternalLink aria-hidden="true" /><span className="sr-only"> (nova aba)</span></a> : <small>Link do PNCP indisponível</small>}
      </div>
      <p><small>Análise concluída em {dateTime.format(new Date(row.concluidoEm))}</small></p>
      <div className="actions">
        <Internal path={'turnos/' + encodeURIComponent(row.turno)}>Ver turno da análise</Internal>
        {row.dossie && <Internal path={dossierPath(row.tender)}>Abrir dossiê</Internal>}
      </div>
      <details className="record-details">
        <summary>Ver resultados por item ({row.itens.length})</summary>
        <ul className="resultados">{row.itens.map(item => <li key={item.item}>
          <Internal path={itemPath(row.tender, item.item)}>Item {item.item}{item.descricao && ' · ' + item.descricao}</Internal>
          <p><strong>{item.estado}</strong>{item.motivo && ' · ' + item.motivo}</p>
        </li>)}</ul>
      </details>
    </Card>)}
  </>;
}

const papelLabels: Record<Papel, string> = { analista: 'Analista', juridico: 'Jurídico', financeiro: 'Financeiro', lance: 'Lance' };
const origemLabels: Record<Origem, string> = {
  publicado: 'Publicado no PNCP', calculado: 'Calculado pela regra', aguardando: 'Aguardando a fonte', informado_cliente: 'Informado pela empresa',
};
const urgenciaLabels: Record<Urgencia, string> = { vencido: 'Vencido', hoje: 'Vence hoje', proximos_3_dias: 'Próximos 3 dias', depois: 'Mais adiante' };
const dayOf = (value: string) => day.format(new Date(value + 'T12:00:00-03:00'));

function CofreAlerts({ alerts }: { alerts: CofreAlert[] }) {
  return <section className="panel cofre" aria-labelledby="cofre-title">
    <h2 id="cofre-title">Calendário do cofre</h2>
    <ul className="cofre-alerts">{alerts.map(alert => <li key={alert.documento ?? alert.exigencia}>
      <p>{alert.resumo}</p>
      <ul>{alert.pregoes.map(pregao => <li key={pregao.tenderId}>
        {pregao.dossie
          ? <Internal path={dossierPath(pregao.tenderId)}>Dossiê do pregão {pregao.tenderId}</Internal>
          : <span>Pregão {pregao.tenderId}</span>}
        {' · '}<time dateTime={pregao.sessao}>Sessão em {day.format(new Date(pregao.sessao + 'T12:00:00-03:00'))}</time>
      </li>)}</ul>
    </li>)}</ul>
  </section>;
}

function TodayScreen({ data }: { data: Today }) {
  const eventos = data.eventos.filter(event => event.tipo !== 'turno_progresso');
  return <>
    <Heading title="Hoje" detail={day.format(new Date(data.data + 'T12:00:00-03:00'))} />
    <Metrics items={[
      ['Pregões', data.pregoes], ['Itens', data.itens], ['Disputar', data.disputar],
      ['Pendências', data.pendencias], ['Escaladas abertas', data.escaladasAbertas], ['Custo', money(data.custoUsd, 'USD')],
    ]} />
    {data.cofre?.length ? <CofreAlerts alerts={data.cofre} /> : null}
    <section className="journal">
      <div className="section-title"><h2>Linha do tempo</h2><span>Horário de Fortaleza</span></div>
      {eventos.length === 0 && <p>Nenhum evento registrado neste dia.</p>}
      <ol>{eventos.map(event => <li key={event.id}>
        <time dateTime={event.horario}>{time.format(new Date(event.horario))}</time>
        <div className="event"><small>{['decisao-humana', 'escalada_decidida'].includes(event.tipo) ? 'Revisão humana' : event.tipo}</small>
          <h3>{event.resumo}</h3>{event.detalhe && <p>{event.detalhe}</p>}
          {event.rastro?.length ? <Trail entries={event.rastro} /> : null}
        </div>
        <div className="evidence-links">
          {event.tender && event.item && event.itemDisponivel !== false && <Internal path={itemPath(event.tender, event.item)}>Abrir item {event.item}</Internal>}
          {event.tender && event.dossie && <Internal path={dossierPath(event.tender)}>Abrir dossiê</Internal>}
          {['Escalada', 'escalada_aberta'].includes(event.tipo) && <Internal path="escaladas">Ver aprovações</Internal>}
        </div>
      </li>)}</ol>
    </section>
    <section className="panel"><h2>Relatório do dia</h2>
      <Metrics items={[[ 'Envios registrados', data.envios ]]} />
      <ul>{data.porDecisao.map(row => <li key={row.estado}>{row.estado}: {row.quantidade}</li>)}</ul>
    </section>
  </>;
}

function AgendaLine({ line }: { line: LinhaPauta }) {
  return <li className={'agenda-line' + (line.urgencia ? ' agenda-' + line.urgencia : '')}>
    <div className="agenda-meta">
      <span className="agenda-role">{papelLabels[line.papel]}</span>
      {line.ate && <time dateTime={line.ate}>Até {dayOf(line.ate)}</time>}
      {line.urgencia && line.acionavel && <span>{urgenciaLabels[line.urgencia]}</span>}
      <span>{origemLabels[line.origem]}</span>
      {line.sintetico && <span className="agenda-synthetic">Errata sintética de teste</span>}
    </div>
    <h3>{line.acao}</h3>
    <p>{line.oQueMudou}</p>
    {line.prazo?.artigo && <small>Base: {line.prazo.artigo} da Lei 14.133
      {line.prazo.divergencia && ` · lei: ${dayOf(line.prazo.divergencia.lei)}, edital: ${dayOf(line.prazo.divergencia.edital)}`}
    </small>}
    <div className="evidence-links">
      {line.fonte && <Evidence source={line.fonte} quote />}
      {line.tenderId && line.item !== undefined && line.itemDisponivel && <Internal path={itemPath(line.tenderId, String(line.item))}>Abrir item {line.item}</Internal>}
      {line.tenderId && line.dossie && <Internal path={dossierPath(line.tenderId)}>Abrir dossiê</Internal>}
      {line.pregoes?.map(id => <span key={id}>Pregão {id}</span>)}
    </div>
  </li>;
}

function AgendaScreen({ data }: { data: Pauta }) {
  const now = data.linhas.filter(line => line.acionavel);
  const info = data.linhas.filter(line => !line.acionavel);
  return <>
    <Heading title="Pauta" detail={dayOf(data.data) + ' · o que mudou desde ontem e quem precisa agir'} />
    <Metrics items={[['Para agir', data.contagem.acionaveis], ['Informativas', data.contagem.informativas]]} />
    <section className="panel agenda" aria-labelledby="agenda-now">
      <h2 id="agenda-now">Para agir</h2>
      {now.length ? <ol className="agenda-lines">{now.map(line => <AgendaLine key={line.id} line={line} />)}</ol> : <p>Nada pede ação hoje.</p>}
    </section>
    {info.length > 0 && <section className="panel" aria-labelledby="agenda-info">
      <h2 id="agenda-info">Informativas</h2>
      <ol className="agenda-lines">{info.map(line => <AgendaLine key={line.id} line={line} />)}</ol>
    </section>}
  </>;
}

function QueueScreen({ rows }: { rows: QueueItem[] }) {
  const [tender, setTender] = useState('');
  const [agency, setAgency] = useState('');
  const [deadline, setDeadline] = useState('');
  const tenders = new Map(rows.map(row => [row.tender, row.pregao]));
  const agencies = [...new Set(rows.map(row => row.orgao))];
  const deadlineLimit = deadline ? Date.parse(deadline + 'T23:59:59.999-03:00') : Infinity;
  const visible = rows.filter(row => (!tender || row.tender === tender) &&
    (!agency || row.orgao === agency) && (!deadline || deadlineTime(row.prazo) <= deadlineLimit));
  return <>
    <Heading title="Fila de decisões" detail="Acompanhe o estado e o motivo de cada item." />
    <div className="filters">
      <div className="filter"><label htmlFor="pregao">Pregão</label><select id="pregao" value={tender} onChange={event => setTender(event.target.value)}>
        <option value="">Todos</option>{[...tenders].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></div>
      <div className="filter"><label htmlFor="orgao">Órgão</label><select id="orgao" value={agency} onChange={event => setAgency(event.target.value)}>
        <option value="">Todos</option>{agencies.map(name => <option key={name}>{name}</option>)}
      </select></div>
      <label>Prazo até<input type="date" value={deadline} onChange={event => setDeadline(event.target.value)} /></label>
    </div>
    <div className="rows">{visible.map(row => <article className="panel" key={row.tender + ':' + row.item}>
      <small>{row.pregao} / item {row.item}</small>
      <h2><Internal path={itemPath(row.tender, row.item)}>{row.descricao}</Internal></h2>
      <p><strong>{row.estado}.</strong> {row.motivo}</p>
      <small>{row.orgao} • {deadlineLabel(row.prazo, row.prazoTipo)}</small>
    </article>)}</div>
    {!visible.length && <p>Nenhum item encontrado. Confira os filtros da fila.</p>}
  </>;
}

function ProofScreen({ data }: { data: Proof }) {
  return <>
    <Heading title="Prova" detail={data.fonte} />
    <Metrics items={[
      ['Concordância', data.concordancia === null ? 'Sem medição' : data.concordancia + '%'],
      ['Custo do turno', money(data.custoUsd, 'USD')],
      ['Tempo do turno', data.duracaoMs === null ? 'Sem medição' : duration(data.duracaoMs)],
    ]} />
    <section className="panel"><h2>Avaliações</h2>
      {data.avaliacoes.length ? <ul>{data.avaliacoes.map(row => <li key={row.nome}>{row.nome}: <strong>{row.valor}</strong></li>)}</ul> : <p>Sem medição.</p>}
    </section>
    <section className="panel"><h2>Cenários de exceção</h2>
      {data.cenarios.length ? <ul>{data.cenarios.map(row => <li key={row.nome}>{row.nome}: {row.resultado}</li>)}</ul> : <p>Sem medição.</p>}
    </section>
  </>;
}

const regularizacaoAnvisa = {
  vigente: 'Vigente', vencido: 'Vencida', nao_encontrado: 'Registro não encontrado',
  nao_verificado: 'Não verificada',
};
const coberturaAnvisa = {
  declarada_pelo_cliente: 'Declarada pelo cliente', nao_comprovada: 'Não comprovada',
};

function ItemScreen({ item }: { item: Item }) {
  return <>
    <Internal path="fila">Ver fila</Internal>
    <Heading title={item.descricao} detail={item.pregao + ' / item ' + item.item + ' / ' + deadlineLabel(item.prazo, item.prazoTipo)} />
    <div className="notice"><span><strong>{item.estado}.</strong> {item.motivo}</span>
      {item.dossie && <Internal path={dossierPath(item.tender)}>Abrir dossiê</Internal>}</div>
    <section className="panel"><h2>Encaixe técnico</h2>
      <dl className="metrics">
        <div><dt>Citações</dt><dd>{item.validacao?.citacoes === 'conferidas' ? 'Trechos conferidos' : 'Não verificadas'}</dd></div>
        <div><dt>Cobertura dos campos</dt><dd>{item.validacao?.cobertura === 'conferida' ? 'Conferida' : 'Não verificada'}</dd></div>
        <div><dt>Conclusão técnica</dt><dd>{item.validacao?.semantica === 'julgamento_modelo' ? 'Julgamento do modelo' : 'Não verificada'}</dd></div>
      </dl>
      {item.validacao?.lacunas.length ? <details className="trace">
        <summary>Campos sem citação própria ({item.validacao.lacunas.length})</summary>
        <ul>{item.validacao.lacunas.map((clause, index) => <li key={index}>{clause}</li>)}</ul>
      </details> : null}
      {item.encaixe.length ? <div className="scroll-table" role="region" aria-label="Tabela de encaixe" tabIndex={0}><table>
        <thead><tr>{['Atributo', 'Exigido', 'Ofertado', 'Resultado e evidência'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{item.encaixe.map((row, index) => <tr key={index}><th scope="row">{row.atributo}</th><td>{row.exigido}</td>
          <td>{row.ofertado}</td><td><strong>{row.resultado}</strong>{row.fonte && <div><Evidence source={row.fonte} quote /></div>}</td>
        </tr>)}</tbody>
      </table></div> : <p>O encaixe deste item ainda está em análise.</p>}
    </section>
    <section className="panel"><h2>Preço e registro sanitário</h2>
      <Metrics items={[[ 'Preço da proposta', money(item.preco, 'BRL') ], [ 'Estimativa', money(item.estimativa, 'BRL') ]]} />
      <dl>
        <dt>Regularização na ANVISA</dt>
        <dd>{item.regularizacao ? regularizacaoAnvisa[item.regularizacao] : 'Não verificada'}</dd>
        <dt>Cobertura do produto ofertado</dt>
        <dd>{item.cobertura ? coberturaAnvisa[item.cobertura] : 'Não comprovada'}</dd>
      </dl>
      {!item.regularizacao && !item.cobertura && <p>{item.anvisa}</p>}
      <ul>{item.fontes.map(source => <li key={source.url}><Evidence source={source} /></li>)}</ul>
      <Trail entries={item.rastro} />
    </section>
  </>;
}

function DossierScreen({ data }: { data: Dossier }) {
  return <>
    <Heading title="Dossiê" detail={data.pregao + ' / versão ' + data.versao} />
    {data.pendencias.length > 0 && <div className="notice">
      <ul>{data.pendencias.map(text => <li key={text}>{text}</li>)}</ul><Internal path="escaladas">Ver aprovações</Internal>
    </div>}
    {data.retificacao && <section className="panel"><h2>Retificação {data.retificacao.versao}</h2>
      {data.retificacao.aviso && <p>{data.retificacao.aviso}</p>}
      <p>Abertura {data.retificacao.abertura}. Publicada antes: {data.retificacao.aberturaPublicadaAntes ?? 'sem data'}. Publicada depois: {data.retificacao.aberturaPublicadaDepois ?? 'sem data'}. Itens com evidência reaproveitada: {data.retificacao.itensSemReleitura}.
        {' Economia de chamadas e custo sem medição.'}</p>
      <ul>{data.retificacao.linhas.map((linha, index) => <li key={index}>Item {linha.item}: {linha.estado}. {linha.motivo}
        {linha.quantidadeNova != null && <> Quantidade {linha.quantidadeAnterior} para {linha.quantidadeNova}.</>}
        {linha.precoUnitario !== undefined && <> Preço unitário {money(linha.precoUnitario, 'BRL')}. Total {money(linha.valorTotal ?? null, 'BRL')}.</>}
        {linha.escalarLimite ? ' Não libera decisão automática.' : ''}
        {linha.chamarAgente ? ' O agente relê este item.' : ''}{linha.discordancia ? ' ' + linha.discordancia : ''}</li>)}</ul>
      {data.reavaliar && <p role="status">Envio bloqueado: reavaliação pendente. Os dados da análise anterior permanecem no dossiê para auditoria.</p>}
      <ol className="agenda-lines">{data.retificacao.pauta.map(linha => <AgendaLine key={linha.id} line={linha} />)}</ol>
      {!!data.retificacoes?.length && <details><summary>Histórico de retificações ({data.retificacoes.length})</summary>
        {data.retificacoes.map(v => <div key={v.versao}><h3>Retificação {v.versao}</h3>
          <p>{v.sintetica ? 'Caso sintético. ' : ''}Abertura: {v.aberturaPublicadaDepois ?? 'desconhecida'}.</p>
          <ul>{v.linhas.map((l, i) => <li key={i}>Item {l.item}: {l.estado}. {l.motivo} {l.discordancia}</li>)}</ul>
        </div>)}
      </details>}
    </section>}
    <section className="panel"><h2>Checklist</h2>
      <ul className="checklist">{data.checklist.map((row, index) => <li key={index}>
        <strong>{row.exigencia}</strong><span>{row.documento ?? 'Documento indisponível'}</span><span>{row.status}</span>
        {row.detalhe && <p>{row.detalhe}</p>}{row.fonte && <Evidence source={row.fonte} quote />}
      </li>)}</ul>
    </section>
    <section className="panel"><h2>Documentos</h2>
      {data.documentos.length ? <ul>{data.documentos.map(source => <li key={source.url}><Evidence source={source} /></li>)}</ul>
        : <p>Nenhum documento disponível.</p>}
    </section>
  </>;
}

function EscalationCard({ row, onResolved }: { row: Escalation; onResolved: (message: string) => void }) {
  const [choice, setChoice] = useState<Decision['decisao']>();
  const [adjustment, setAdjustment] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function save(decisao: Decision['decisao']) {
    setBusy(true);
    setError('');
    try {
      await request<SavedDecision>('escaladas/' + encodeURIComponent(row.id), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisao, ...(decisao === 'ajustar' ? { ajuste: adjustment } : {}) }),
      });
      setSaved(true);
      onResolved('Decisão registrada.');
    } catch (failure) {
      if (failure instanceof ApiError && [404, 409].includes(failure.status)) {
        setSaved(true);
        onResolved(failure.status === 404 ? 'Esta pendência não está mais disponível.' : failure.message.replace('escalada', 'pendência'));
      }
      else setError(failure instanceof ApiError ? failure.message : 'Não foi possível registrar a decisão.');
    } finally { setBusy(false); }
  }

  const options = [
    { value: 'aprovar', label: 'Aprovar', detail: 'Registrar sua concordância', Icon: Check },
    { value: 'recusar', label: 'Recusar', detail: 'Registrar sua recusa', Icon: X },
    { value: 'ajustar', label: 'Solicitar ajuste', detail: 'Descrever o que precisa mudar', Icon: Pencil },
  ] as const;

  return <Card className="panel escalation">
    <div className="panel-heading">
      <p className="record-context">{row.pregao}{row.item && ' / Item ' + row.item}</p>
      <Badge variant="secondary"><Clock3 />{deadlineLabel(row.prazo, row.prazoTipo ?? 'decisao_humana')}</Badge>
    </div>
    <h2>{row.motivo}</h2>
    <div className="recommendation"><h3>Recomendação do Lance</h3><p>{row.recomendacao}</p></div>
    {(row.dossie || row.item) && <details className="record-details">
      <summary><FileText size={16} /> Consultar evidências <ChevronDown size={16} /></summary>
      <div className="actions">
        {row.dossie && <Internal path={dossierPath(row.tender)}>Abrir dossiê</Internal>}
        {row.item && (row.itemDisponivel === false
          ? <span>Item {row.item}</span>
          : <Internal path={itemPath(row.tender, row.item)}>Abrir item {row.item}</Internal>)}
      </div>
    </details>}
    <form className="decision-form" onSubmit={event => {
      event.preventDefault();
      if (choice && !busy && !saved) void save(choice);
    }}>
      <fieldset disabled={busy || saved}>
        <legend>Qual é a decisão da sua equipe?</legend>
        <div className="decision-options">
          {options.map(({ value, label, detail, Icon }) => <label key={value}>
            <input type="radio" name={'decision-' + row.id} value={value} checked={choice === value}
              onChange={() => setChoice(value)} required />
            <span><Icon size={17} aria-hidden="true" /> <strong>{label}</strong><small>{detail}</small></span>
          </label>)}
        </div>
        {choice === 'ajustar' && <label className="adjustment">Descreva o ajuste
          <textarea value={adjustment} onChange={event => setAdjustment(event.target.value)} required maxLength={600} />
        </label>}
      </fieldset>
      <Button disabled={busy || saved || !choice || (choice === 'ajustar' && !adjustment.trim())}>
        {busy ? 'Registrando…' : 'Registrar decisão'}
      </Button>
      {error && <p role="alert">{error}</p>}
    </form>
  </Card>;
}

function EscalationScreen({ rows, refresh }: { rows: Escalation[]; refresh: () => void }) {
  const [message, setMessage] = useState('');
  const status = useRef<HTMLDivElement>(null);
  const sorted = [...rows].sort((a, b) => (deadlineTime(a.prazo) || Infinity) - (deadlineTime(b.prazo) || Infinity));
  return <>
    <Heading title="Aprovações" detail="Revise as pendências e registre a decisão da sua equipe." />
    <div role="status" tabIndex={-1} ref={status}>{message && <p className="notice">{message}</p>}</div>
    {sorted.map(row => <EscalationCard key={row.id} row={row} onResolved={text => {
      setMessage(text);
      status.current?.focus();
      refresh();
    }} />)}
    {!rows.length && <p className="panel">Nenhuma decisão pendente.</p>}
  </>;
}

const currentPath = () => window.location.hash.replace(/^#\/?/, '') || 'turnos';

function App() {
  const [path, setPath] = useState(currentPath);
  const approvals = useApi<Escalation[]>('escaladas');
  const pending = approvals.data?.dados.length ?? 0;
  const main = useRef<HTMLElement>(null);
  const navigation = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const bar = navigation.current;
    if (!bar) return;
    const active = bar.querySelector<HTMLElement>('[aria-current="page"]');
    const update = () => {
      bar.dataset.hasActive = String(!!active);
      if (!active) return;
      bar.style.setProperty('--tab-x', active.offsetLeft + 'px');
      bar.style.setProperty('--tab-y', active.offsetTop + 'px');
      bar.style.setProperty('--tab-width', active.offsetWidth + 'px');
      bar.style.setProperty('--tab-height', active.offsetHeight + 'px');
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(bar);
    bar.querySelectorAll('a').forEach(link => resize.observe(link));
    return () => resize.disconnect();
  }, [path]);
  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (window.location.hash) {
      main.current?.focus();
      window.scrollTo(0, 0);
    }
  }, [path]);

  let view;
  if (path === 'turnos' || path.startsWith('turnos/')) {
    const id = path.split('/')[1];
    view = <View<Turnos> path="turnos">{(data, _, lastRead) => id
      ? <><Internal path="turnos">Ver todos os turnos</Internal>
        {data.turnos.some(turno => encodeURIComponent(turno.id) === id)
          ? <Acompanhamento data={{ ...data, turnos: data.turnos.filter(turno => encodeURIComponent(turno.id) === id) }} lastRead={lastRead} />
          : <Heading title="Turno indisponível" />}</>
      : <Acompanhamento data={data} lastRead={lastRead} />}</View>;
  }
  else if (path === 'historico') view = <View<HistoricoPregao[]> path={path}>{rows => <Historico rows={rows} />}</View>;
  else if (path === 'hoje') view = <View<Today> path={path}>{data => <TodayScreen data={data} />}</View>;
  else if (path === 'pauta') view = <View<Pauta> path={path}>{data => <AgendaScreen data={data} />}</View>;
  else if (path === 'fila') view = <View<QueueItem[]> path={path}>{rows => <QueueScreen rows={rows} />}</View>;
  else if (path === 'escaladas') view = <ApiView resource={approvals}>{(rows, refresh) => <EscalationScreen rows={rows} refresh={refresh} />}</ApiView>;
  else if (path === 'prova') view = <View<Proof> path={path} poll={false}>{data => <ProofScreen data={data} />}</View>;
  else if (/^itens\/[^/]+\/[^/]+$/.test(path)) view = <View<Item> path={path}>{item => <ItemScreen item={item} />}</View>;
  else if (/^dossies\/[^/]+$/.test(path)) view = <View<Dossier> path={path}>{data => <DossierScreen data={data} />}</View>;
  else view = <><Heading title="Página indisponível" /><Internal path="turnos">Voltar ao acompanhamento</Internal></>;
  return <>
    <header className="masthead">
      <div className="shell mast-content">
        <div className="brand">
          <a href="#/turnos" aria-describedby="brand-product"><span className="wordmark">Lance</span></a>
          <span className="brand-reveal"><span id="brand-product">Diário de Licitação.</span></span>
        </div>
        <nav ref={navigation} aria-label="Telas do Lance"><span className="nav-indicator" aria-hidden="true" />{nav.map(([id, title]) =>
          <a key={id} aria-current={(path === id || path.startsWith(id + '/')) ? 'page' : undefined} href={'#/' + id}>{title}
            {id === 'escaladas' && pending > 0 && <span className="approval-count">
              {pending}<span className="sr-only"> {pending === 1 ? 'pendência' : 'pendências'}</span>
            </span>}
          </a>)}</nav>
        <Avatar className="company-avatar" role="img" aria-label="Perfil ilustrativo da empresa">
          <AvatarFallback><UserRound size={19} aria-hidden="true" /></AvatarFallback>
        </Avatar>
      </div>
    </header>
    <main key={path} className="shell" ref={main} tabIndex={-1}>{view}</main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
