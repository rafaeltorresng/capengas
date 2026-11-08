import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ApiResponse, DeadlineKind, Decision, Dossier, Escalation, HistoricoPregao, Item, SavedDecision, Source, Turnos, TurnoStatus } from '../src/server/contract.ts';
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
const money = (amount: number | null, currency: string) => amount === null ? 'Sem medição' :
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
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
const nav = [['turnos', 'Acompanhamento'], ['escaladas', 'Aprovações'], ['historico', 'Histórico']] as const;

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

const regularizacaoAnvisa = {
  vigente: 'Vigente', vencido: 'Vencida', nao_encontrado: 'Registro não encontrado',
  nao_verificado: 'Não verificada',
};
const coberturaAnvisa = {
  declarada_pelo_cliente: 'Declarada pelo cliente', nao_comprovada: 'Não comprovada',
};

function ItemScreen({ item }: { item: Item }) {
  return <>
    <Internal path="historico">Ver histórico</Internal>
    <Heading title={item.descricao} detail={item.pregao + ' / item ' + item.item + ' / ' + deadlineLabel(item.prazo, item.prazoTipo)} />
    <div className="notice"><span><strong>{item.estado}.</strong> {item.motivo}</span>
      {item.dossie && <Internal path={dossierPath(item.tender)}>Abrir dossiê</Internal>}</div>
    <section className="panel"><h2>Encaixe técnico</h2>
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
      <p>{item.anvisa}</p>
      <ul>{item.fontes.map(source => <li key={source.url}><Evidence source={source} /></li>)}</ul>
    </section>
  </>;
}

function DossierScreen({ data }: { data: Dossier }) {
  return <>
    <Heading title="Dossiê" detail={data.pregao + ' / versão ' + data.versao} />
    {data.pendencias.length > 0 && <div className="notice">
      <ul>{data.pendencias.map(text => <li key={text}>{text}</li>)}</ul><Internal path="escaladas">Ver aprovações</Internal>
    </div>}
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
        {row.item && <Internal path={itemPath(row.tender, row.item)}>Abrir item {row.item}</Internal>}
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

const aliases = new Map([['hoje', 'turnos'], ['fila', 'historico']]);
function currentPath() {
  const path = window.location.hash.replace(/^#\/?/, '') || 'turnos';
  return aliases.get(path) ?? path;
}

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
  else if (path === 'escaladas') view = <ApiView resource={approvals}>{(rows, refresh) => <EscalationScreen rows={rows} refresh={refresh} />}</ApiView>;
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
