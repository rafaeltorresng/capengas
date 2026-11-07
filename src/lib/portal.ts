// Consulta de protocolo no portal (sandbox na demo), depois de um envio.
// "Não encontrado" com erro significa que não deu para consultar: a ação fica para reconciliar, nunca é repetida às cegas.
export type Consulta =
  | { encontrado: true; registro: unknown }
  | { encontrado: false; erro?: string };

export async function consultarProtocolo(baseUrl: string, tipo: 'proposta' | 'esclarecimento', protocolo: string, timeoutMs = 10_000): Promise<Consulta> {
  const rota = tipo === 'proposta' ? 'propostas' : 'esclarecimentos';
  try {
    const r = await fetch(`${baseUrl}/api/${rota}/${encodeURIComponent(protocolo)}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 404) return { encontrado: false };
    if (!r.ok) return { encontrado: false, erro: `HTTP ${r.status}` };
    return { encontrado: true, registro: await r.json() };
  } catch (e: any) {
    return { encontrado: false, erro: e?.name === 'TimeoutError' ? 'timeout' : String(e?.cause?.code ?? e?.message ?? e) };
  }
}
