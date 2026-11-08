import { useState } from 'react';
import { FileDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

/** Baixa um PDF montado no servidor a partir do dossiê persistido. `tipo` é o nome do arquivo na rota, sem ".pdf". */
export function PdfButton({ tender, analise, tipo, rotulo, destaque }: { tender: string; analise?: string; tipo: string; rotulo: string; destaque?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  async function baixar() {
    setBusy(true); setErro('');
    try {
      const response = await fetch(`/api/dossies/${encodeURIComponent(tender)}/${tipo}.pdf${analise ? `?analise=${encodeURIComponent(analise)}` : ''}`, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error((await response.json()).erro ?? 'Não foi possível gerar o PDF.');
      const nome = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? `lance-${tipo}-${tender.replaceAll('/', '-')}.pdf`;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = nome; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (failure) { setErro(failure instanceof Error ? failure.message : 'Não foi possível baixar o documento.'); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-col items-start gap-2">
    <Button variant={destaque ? 'default' : 'outline'} disabled={busy} onClick={() => void baixar()}>
      {busy ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <FileDownIcon data-icon="inline-start" />}
      {busy ? 'Preparando PDF…' : rotulo}
    </Button>
    {erro && <p role="alert" className="max-w-sm text-sm text-destructive">{erro}</p>}
  </div>;
}
