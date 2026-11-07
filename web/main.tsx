import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { ApiResponse, CofreAlert, DeadlineKind, Decision, Dossier, Escalation, Item, Proof, QueueItem, SavedDecision, Source, Today, Trace } from '../src/server/contract.ts';
import './style.css';

const fortaleza = 'America/Fortaleza';
const time = new Intl.DateTimeFormat('pt-BR', { timeZone: fortaleza, timeStyle: 'medium' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { timeZone: fortaleza, dateStyle: 'short', timeStyle: 'short' });
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
const nav = [['hoje', 'Hoje'], ['fila', 'Fila'], ['escaladas', 'Escaladas'], ['prova', 'Prova']] as const;

async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch('/api/' + path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.erro || 'Não foi possível consultar a API.');
  return body;
}

function useApi<T>(path: string, poll = true) {
  const [data, setData] = useState<ApiResponse<T>>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let busy = false;
    async function load() {
      if (busy) return;
      busy = true;
      try {
        const result = await request<T>(path, { signal: controller.signal });
        if (active) { setData(result); setError(''); }
      } catch (failure) {
        if (active) setError(failure instanceof Error ? failure.message : 'Falha na consulta.');
      } finally { busy = false; }
    }
    void load();
    const timer = poll ? window.setInterval(() => void load(), 10_000) : undefined;
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [path, poll, revision]);
  return { data, error, refresh: () => setRevision(value => value + 1) };
}

function View<T>({ path, poll, children }: {
  path: string; poll?: boolean; children: (data: T, refresh: () => void) => ReactNode;
}) {
  const { data, error, refresh } = useApi<T>(path, poll);
  return <>
    {error && <div className="notice" role="status">
      <span>{data ? 'Mostrando a última leitura. ' : ''}{error}</span>
      <button onClick={refresh}>Tentar novamente</button>
    </div>}
    {!data && !error && <p role="status">Consultando o estado do Lance…</p>}
    {data && <>
      <p className="origin">{data.origem === 'amostra' ? 'Amostra de demonstração · alterações descartáveis' : 'Estado integrado'}</p>
      {children(data.dados, refresh)}
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
  return <>
    <Heading title="Hoje" detail={day.format(new Date(data.data + 'T12:00:00-03:00'))} />
    <Metrics items={[
      ['Pregões', data.pregoes], ['Itens', data.itens], ['Disputar', data.disputar],
      ['Pendências', data.pendencias], ['Escaladas abertas', data.escaladasAbertas], ['Custo', money(data.custoUsd, 'USD')],
    ]} />
    {data.cofre?.length ? <CofreAlerts alerts={data.cofre} /> : null}
    <section className="journal">
      <div className="section-title"><h2>Linha do tempo</h2><span>Horário de Fortaleza</span></div>
      {data.eventos.length === 0 && <p>Nenhum evento registrado neste dia.</p>}
      <ol>{data.eventos.map(event => <li key={event.id}>
        <time dateTime={event.horario}>{time.format(new Date(event.horario))}</time>
        <div className="event"><small>{['decisao-humana', 'escalada_decidida'].includes(event.tipo) ? 'Revisão humana' : event.tipo}</small>
          <h3>{event.resumo}</h3>{event.detalhe && <p>{event.detalhe}</p>}
          {event.rastro?.length ? <Trail entries={event.rastro} /> : null}
        </div>
        <div className="evidence-links">
          {event.tender && event.item && event.itemDisponivel !== false && <Internal path={itemPath(event.tender, event.item)}>Abrir item {event.item}</Internal>}
          {event.tender && event.dossie && <Internal path={dossierPath(event.tender)}>Abrir dossiê</Internal>}
          {['Escalada', 'escalada_aberta'].includes(event.tipo) && <Internal path="escaladas">Ver escaladas</Internal>}
        </div>
      </li>)}</ol>
    </section>
    <section className="panel"><h2>Relatório do dia</h2>
      <Metrics items={[[ 'Envios registrados', data.envios ]]} />
      <ul>{data.porDecisao.map(row => <li key={row.estado}>{row.estado}: {row.quantidade}</li>)}</ul>
    </section>
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

const regularizacaoAnvisa = {
  vigente: 'Vigente', vencido: 'Vencida', nao_encontrado: 'Registro não encontrado',
  nao_verificado: 'Não verificada',
};
const coberturaAnvisa = {
  declarada_pelo_cliente: 'Declarada pelo cliente', nao_comprovada: 'Não comprovada',
};

function ItemScreen({ item }: { item: Item }) {
  return <>
    <Internal path="fila">Voltar à fila</Internal>
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
        <dd>{(item.regularizacao && regularizacaoAnvisa[item.regularizacao]) || 'Não verificada'}</dd>
        <dt>Cobertura do produto ofertado</dt>
        <dd>{(item.cobertura && coberturaAnvisa[item.cobertura]) || 'Não comprovada'}</dd>
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
      <ul>{data.pendencias.map(text => <li key={text}>{text}</li>)}</ul><Internal path="escaladas">Ver escaladas</Internal>
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

function EscalationCard({ row, onSaved }: { row: Escalation; onSaved: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
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
      onSaved('Decisão registrada no diário de operações.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível registrar a decisão.');
    } finally { setBusy(false); }
  }

  return <article className="panel escalation">
    <small>{row.pregao} / {deadlineLabel(row.prazo, row.prazoTipo ?? 'decisao_humana')}</small>
    <h2>{row.motivo}</h2>
    <p><strong>Recomendação.</strong> {row.recomendacao}</p>
    <div className="actions">
      {row.dossie && <Internal path={dossierPath(row.tender)}>Abrir dossiê</Internal>}
      {row.item && (row.itemDisponivel === false ? <span>Item {row.item}</span>
        : <Internal path={itemPath(row.tender, row.item)}>Abrir item {row.item}</Internal>)}
    </div>
    <div className="actions">
      <button className="primary" disabled={busy || saved} onClick={() => void save('aprovar')}>Aprovar</button>
      <button disabled={busy || saved} onClick={() => void save('recusar')}>Recusar</button>
      <button disabled={busy || saved} aria-expanded={editing} onClick={() => setEditing(value => !value)}>Ajustar</button>
    </div>
    {editing && <form onSubmit={event => { event.preventDefault(); void save('ajustar'); }}>
      <label>Descreva o ajuste<textarea value={adjustment} onChange={event => setAdjustment(event.target.value)} required maxLength={600} /></label>
      <button className="primary" disabled={busy || saved || !adjustment.trim()}>Registrar ajuste</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </article>;
}

function EscalationScreen({ rows, refresh }: { rows: Escalation[]; refresh: () => void }) {
  const [message, setMessage] = useState('');
  return <>
    <Heading title="Escaladas" detail="Decisões que precisam da equipe." />
    <div role="status">{message && <p className="notice">{message} <Internal path="hoje">Ver linha do tempo</Internal></p>}</div>
    {rows.map(row => <EscalationCard key={row.id} row={row} onSaved={text => { setMessage(text); refresh(); }} />)}
    {!rows.length && <p>Nenhuma escalada aberta.</p>}
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

const currentPath = () => window.location.hash.replace(/^#\/?/, '') || 'hoje';

function App() {
  const [path, setPath] = useState(currentPath);
  const main = useRef<HTMLElement>(null);
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
  if (path === 'hoje') view = <View<Today> path={path}>{data => <TodayScreen data={data} />}</View>;
  else if (path === 'fila') view = <View<QueueItem[]> path={path}>{rows => <QueueScreen rows={rows} />}</View>;
  else if (path === 'escaladas') view = <View<Escalation[]> path={path}>{(rows, refresh) => <EscalationScreen rows={rows} refresh={refresh} />}</View>;
  else if (path === 'prova') view = <View<Proof> path={path} poll={false}>{data => <ProofScreen data={data} />}</View>;
  else if (/^itens\/[^/]+\/[^/]+$/.test(path)) view = <View<Item> path={path}>{item => <ItemScreen item={item} />}</View>;
  else if (/^dossies\/[^/]+$/.test(path)) view = <View<Dossier> path={path}>{data => <DossierScreen data={data} />}</View>;
  else view = <><Heading title="Página indisponível" /><Internal path="hoje">Voltar a Hoje</Internal></>;
  return <>
    <header className="masthead">
      <div className="shell mast-content"><Internal path="hoje"><span className="wordmark">Lance</span></Internal>
        <span>Diário de licitações</span>
        <nav aria-label="Telas do Lance">{nav.map(([id, title]) =>
          <a key={id} aria-current={path === id ? 'page' : undefined} href={'#/' + id}>{title}</a>)}</nav>
      </div>
    </header>
    <main key={path} className="shell" ref={main} tabIndex={-1}>{view}</main>
  </>;
}

createRoot(document.getElementById('root')!).render(<App />);
