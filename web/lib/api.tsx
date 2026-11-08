import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircleIcon } from 'lucide-react';
import type { ApiResponse, Origin } from '../../src/server/contract.ts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function request<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const response = await fetch('/api/' + path, options);
  const body = await response.json();
  if (!response.ok) {
    const rotaNova = response.status === 404 && (path === 'turnos' || path === 'historico' || path === 'onboarding' || path.startsWith('onboarding/'));
    throw new ApiError(response.status, rotaNova
      ? 'Esta tela precisa da API atualizada. Reinicie o servidor local do Lance e tente novamente.'
      : body.erro || 'Não foi possível consultar o Lance.');
  }
  return body;
}

export function useApi<T>(path: string, poll = true) {
  const [data, setData] = useState<ApiResponse<T>>();
  const [error, setError] = useState('');
  const [lastRead, setLastRead] = useState<number>();
  const [revision, setRevision] = useState(0);
  const [loadedPath, setLoadedPath] = useState(path);
  if (loadedPath !== path) {
    setLoadedPath(path);
    setData(undefined);
    setError('');
    setLastRead(undefined);
  }
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

export function View<T>({ path, poll, children }: {
  path: string; poll?: boolean; children: (data: T, refresh: () => void, lastRead?: number, origem?: Origin) => ReactNode;
}) {
  return <ApiView resource={useApi<T>(path, poll)}>{children}</ApiView>;
}

export function ApiView<T>({ resource: { data, error, lastRead, refresh }, children }: {
  resource: ReturnType<typeof useApi<T>>;
  children: (data: T, refresh: () => void, lastRead?: number, origem?: Origin) => ReactNode;
}) {
  return <>
    {error && <Alert variant="destructive">
      <AlertCircleIcon />
      <AlertTitle>{data ? 'Mostrando a última leitura' : 'Consulta indisponível'}</AlertTitle>
      <AlertDescription>
        <p>{error}</p>
        <Button variant="outline" onClick={refresh}>Tentar novamente</Button>
      </AlertDescription>
    </Alert>}
    {!data && !error && <LoadingState />}
    {data && children(data.dados, refresh, lastRead, data.origem)}
  </>;
}

function LoadingState() {
  return <div className="flex flex-col gap-3" role="status">
    <span className="sr-only">Consultando o estado do Lance…</span>
    <Skeleton className="h-8 w-56" />
    <Skeleton className="h-28 w-full" />
    <Skeleton className="h-28 w-full" />
  </div>;
}
