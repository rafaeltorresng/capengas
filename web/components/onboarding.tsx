import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, FileSpreadsheet, ExternalLink } from 'lucide-react';
import { Button } from './ui/button.tsx';
import { Input } from './ui/input.tsx';
import type { AnalysisStarted, OnboardingData } from '../../src/server/onboarding.ts';

const sessionKey = 'lance-demo-confirmado';
function confirmado() { try { return sessionStorage.getItem(sessionKey) === 'sim'; } catch { return false; } }
const abertura = (raw: string | null) => {
  if (!raw) return 'Abertura não informada';
  const date = new Date(/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(raw) ? raw + ':00-03:00' : raw);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Recife', dateStyle: 'short', timeStyle: 'short',
  }).format(date) : 'Abertura não informada';
};

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
  return <div className="onboarding-flow">
    <ol className="onboarding-steps" aria-label="Etapas de preparação">
      {['Empresa', 'Produtos', 'Edital'].map((nome, i) => <li key={nome} aria-current={passo === i + 1 ? 'step' : undefined}>
        {passo > i + 1 ? <Check size={18} aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}{nome}
      </li>)}
    </ol>
    <header className="onboarding-heading">
      <h1 ref={title} tabIndex={-1}>{passo === 1 ? 'Sua empresa' : passo === 2 ? 'Seu catálogo' : 'Escolha um edital'}</h1>
      <p>{passo === 1 ? 'Confirme os dados para conhecer o Lance.' : passo === 2
        ? 'A lista de produtos já está anexada. Confira para continuar.'
        : 'Estes editais têm itens candidatos para o catálogo. O agente vai conferir o encaixe.'}</p>
    </header>
    {passo === 1 && <>
      <p className="onboarding-disclosure">Empresa, catálogo e condições comerciais simulados para esta demonstração.</p>
      <form className="onboarding-form" onSubmit={e => { e.preventDefault(); setPasso(2); }}>
        <div className="onboarding-fields">
          <label className="onboarding-wide">Nome da empresa<Input readOnly value={data.empresa.nome} /></label>
          <label>Porte<Input readOnly value={data.empresa.porte} /></label>
          <label>UF<Input readOnly value={data.empresa.uf} /></label>
          <label>Margem mínima<Input readOnly value={new Intl.NumberFormat('pt-BR', { style: 'percent' }).format(data.empresa.margemMinima)} /></label>
          <label>Prazo de entrega<Input readOnly value={`${data.empresa.prazoEntregaDias} dias`} /></label>
        </div>
        <div className="onboarding-actions"><Button size="lg" type="submit">Confirmar empresa <ArrowRight /></Button></div>
      </form>
    </>}
    {passo === 2 && <>
      <div className="onboarding-file">
        <FileSpreadsheet size={32} aria-hidden="true" />
        <div><strong>{data.arquivo}</strong><p>Arquivo ilustrativo, já anexado.</p></div>
        <Check size={22} aria-label="Arquivo selecionado" />
      </div>
      {!revelado ? <div className="onboarding-actions">
        <Button variant="ghost" size="lg" onClick={() => setPasso(1)}><ArrowLeft /> Voltar</Button>
        <Button size="lg" onClick={() => setRevelado(true)}>Conferir produtos <ArrowRight /></Button>
      </div> : <>
        <div className="onboarding-products" role="region" aria-label="Produtos do catálogo">
          <ul>{data.produtos.map(p => <li key={p.id}>
            <div><strong>{p.nome}</strong><p>{p.marca}</p></div>
            <p><span>Registro ANVISA</span>{p.registroAnvisa}</p>
          </li>)}</ul>
        </div>
        <p className="onboarding-note">Os números de registro são reais. A conferência regulatória é feita na análise.</p>
        <div className="onboarding-actions">
          <Button variant="ghost" size="lg" onClick={() => setPasso(1)}><ArrowLeft /> Voltar</Button>
          <Button size="lg" onClick={() => { try { sessionStorage.setItem(sessionKey, 'sim'); } catch { /* navegação segue sem armazenamento */ } setPasso(3); }}>Confirmar catálogo <ArrowRight /></Button>
        </div>
      </>}
    </>}
    {passo === 3 && <>
      <p className="onboarding-note">Seleção de editais públicos preparada em {new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Recife', dateStyle: 'short' }).format(new Date(data.geradoEm))}.</p>
      <form className="onboarding-form" onSubmit={e => { e.preventDefault(); void analisar(); }}>
        <fieldset className="onboarding-tenders" disabled={busy}>
          <legend className="sr-only">Escolha um dos editais preparados</legend>
          {data.pregoes.map(p => <article key={p.id} className={'onboarding-tender' + (selecionado === p.id ? ' selected' : '')}>
            <label className="onboarding-tender-choice">
              <input type="radio" name="edital" value={p.id} checked={selecionado === p.id} onChange={() => { setSelecionado(p.id); setError(''); }} required />
              <span><strong>{p.orgao}</strong><span>{p.municipio ? p.municipio + ' · ' : ''}{p.uf} · Abertura {abertura(p.abertura)}</span><span>{p.situacao}</span></span>
            </label>
            <div className="onboarding-tender-detail">
              <details><summary>{new Set(p.matches.map(m => m.item)).size} itens candidatos</summary>
                <ul>{p.matches.map(m => <li key={`${m.item}-${m.produto}`}><strong>Item {m.item}</strong> · {m.descricao}
                  <span>Produto candidato: {data.produtos.find(prod => prod.id === m.produto)?.nome ?? m.produto}</span></li>)}</ul>
              </details>
              <a href={p.url} target="_blank" rel="noreferrer">Ver no PNCP <ExternalLink size={16} aria-hidden="true" /></a>
            </div>
          </article>)}
        </fieldset>
        {!data.analise.disponivel && <p role="status" className="onboarding-disclosure">{data.analise.motivo}</p>}
        {error && <p role="alert" className="onboarding-error">{error} <a href="#/turnos">Abrir acompanhamento</a></p>}
        <div className="onboarding-actions">
          <Button type="button" variant="ghost" size="lg" disabled={busy} onClick={() => setPasso(2)}><ArrowLeft /> Voltar</Button>
          <Button size="lg" type="submit" disabled={busy || !selecionado || !data.analise.disponivel}>{busy ? 'Iniciando análise…' : 'Analisar edital'}{!busy && <ArrowRight />}</Button>
        </div>
      </form>
    </>}
  </div>;
}
