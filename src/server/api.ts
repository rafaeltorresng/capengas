import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Decision, DemoStore } from './contract.ts';
import { OnboardingError, type Onboarding } from './onboarding.ts';
import { DocumentoError, prepararDocumento, renderizarPdf } from './documentos.ts';

class RequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new RequestError(400, 'Envie os dados em JSON.');
  }
  // Drain oversized requests without buffering beyond the limit.
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes <= 4096) chunks.push(chunk);
  }
  if (bytes > 4096) throw new RequestError(400, 'Solicitação longa demais.');
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError(400, 'JSON inválido.'); }
  return value;
}

async function readDecision(req: IncomingMessage): Promise<Decision> {
  const value = await readBody(req);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError(400, 'Informe uma decisão.');
  }
  const { decisao, ajuste } = value as Record<string, unknown>;
  if (decisao === 'aprovar' || decisao === 'recusar') {
    if (ajuste === undefined) return { decisao };
  } else if (decisao === 'ajustar' && typeof ajuste === 'string' && ajuste.trim()) {
    return { decisao, ajuste: ajuste.trim() };
  }
  throw new RequestError(400, 'Escolha aprovar, recusar ou ajustar. Descreva o ajuste quando solicitado.');
}

const contentTypes: Record<string, string> = {
  '.pdf': 'application/pdf', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2', '.png': 'image/png',
};

async function staticFile(root: string, pathname: string, res: ServerResponse) {
  // The app uses hash navigation. Only the entry point, the brand, the interface font and Vite assets are served.
  const files = new Set(['/edital-exemplo.pdf', '/fonts/halden.woff2', '/logo.png', '/mark.png']);
  if (pathname !== '/' && !files.has(pathname) && !/^\/assets\/[\w.-]+$/.test(pathname)) return false;
  const path = resolve(root, pathname === '/' ? 'index.html' : '.' + pathname);
  if (!path.startsWith(resolve(root) + sep)) return false;
  const contentType = contentTypes[extname(path)];
  if (!contentType) return false;
  try {
    const content = await readFile(path);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return false;
  }
}

export function createServer(store: DemoStore, webRoot?: string, onboarding?: Onboarding) {
  return createHttpServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const { pathname, searchParams } = new URL(req.url ?? '/', 'http://localhost');
      const [prefix, route, ...params] = pathname.slice(1).split('/').map(decodeURIComponent);
      if (prefix !== 'api') {
        if (req.method === 'GET' && webRoot && await staticFile(webRoot, pathname, res)) return;
        throw new RequestError(404, 'Página indisponível.');
      }

      if (onboarding && route === 'onboarding') {
        if (req.method === 'GET' && !params.length) { json(res, 200, { origem: store.origem, dados: onboarding.dados() }); return; }
        if (req.method === 'POST' && params.length === 1 && params[0] === 'analisar') {
          const body = await readBody(req);
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
            || typeof (body as { tenderId?: unknown }).tenderId !== 'string') throw new RequestError(400, 'Informe somente o edital escolhido.');
          const started = onboarding.iniciar((body as { tenderId: string }).tenderId);
          json(res, 202, { origem: store.origem, dados: started }); return;
        }
      }

      let dados: unknown;
      if (req.method === 'GET') {
        if (route === 'dossies' && params.length === 2 && ['proposta.pdf', 'relatorio.pdf'].includes(params[1])) {
          const dossie = store.dossie(params[0]);
          if (!dossie || store.origem !== 'integrado') throw new RequestError(404, 'Não há documento de análise persistida para este edital.');
          const analise = searchParams.get('analise');
          if (analise && analise !== dossie.analiseId) throw new RequestError(409, 'Este dossiê pertence a outra análise. Abra o resultado mais recente.');
          if (params[1] === 'proposta.pdf' && dossie.analiseId && !store.turnos().turnos.some(t => t.id === dossie.analiseId && t.status === 'concluido')) {
            throw new RequestError(409, 'A análise ainda não foi concluída.');
          }
          const arquivo = prepararDocumento(dossie, params[1] === 'proposta.pdf' ? 'proposta' : 'relatorio');
          const pdf = await renderizarPdf(arquivo);
          res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${arquivo.nomeArquivo}"`, 'Cache-Control': 'no-store' });
          res.end(pdf); return;
        }
        if (!params.length) {
          if (route === 'hoje') dados = store.hoje();
          if (route === 'fila') dados = store.fila();
          if (route === 'escaladas') dados = store.escaladas();
          if (route === 'prova') dados = store.prova();
          if (route === 'pauta') dados = store.pauta();
          if (route === 'turnos') dados = store.turnos();
          if (route === 'historico') dados = store.historico();
        } else {
          if (route === 'itens' && params.length === 2) dados = store.item(params[0], params[1]);
          if (route === 'dossies' && params.length === 1) dados = store.dossie(params[0]);
        }
      } else if (req.method === 'POST' && route === 'escaladas' && params.length === 1 && params[0]) {
        const result = store.decidir(params[0], await readDecision(req));
        if (result.status === 'ausente') throw new RequestError(404, 'Escalada não encontrada.');
        if (result.status === 'resolvida') throw new RequestError(409, 'Esta escalada já foi resolvida.');
        if (result.status === 'expirada') throw new RequestError(409, 'O prazo desta escalada terminou.');
        if (result.status === 'salva') dados = result.registro;
      }
      if (dados === undefined) throw new RequestError(404, 'Registro ou rota indisponível.');
      json(res, 200, { origem: store.origem, dados });
    } catch (error) {
      if (error instanceof RequestError || error instanceof OnboardingError || error instanceof DocumentoError) json(res, error.status, { erro: error.message });
      else if (error instanceof URIError) json(res, 400, { erro: 'Endereço inválido.' });
      else json(res, 500, { erro: 'Não foi possível consultar o estado. Tente novamente.' });
    }
  });
}
