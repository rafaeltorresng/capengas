// Portal de pregão SANDBOX (genérico, não imita nenhum portal real). Recebe propostas e esclarecimentos.
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';

export async function startSandbox(port = 0) {
  const propostas = new Map<string, any>();
  const esclarecimentos: any[] = [];
  const srv = createServer(async (req, res) => {
    const send = (code: number, b: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
    let body = ''; for await (const c of req) body += c;
    let j: any = {}; try { j = body ? JSON.parse(body) : {}; } catch { return send(400, { erro: 'JSON inválido' }); }
    if (req.method === 'POST' && req.url === '/api/propostas') {
      const erros: string[] = [];
      if (!j.tender || !j.empresa || !Array.isArray(j.itens) || !j.itens.length) erros.push('tender, empresa e itens são obrigatórios');
      for (const i of j.itens ?? []) {
        if (!(i.precoUnitario > 0)) erros.push(`item ${i.numero}: preço inválido`);
        if (!/^\d{11}$/.test(String(i.registroAnvisa ?? ''))) erros.push(`item ${i.numero}: registro ANVISA ausente ou inválido`);
        if (!i.marca) erros.push(`item ${i.numero}: marca obrigatória`);
      }
      // Anexo: PDF em base64 com o sha256 do conteúdo; a consulta devolve nome, tamanho e hash, não o arquivo.
      const anexos = (Array.isArray(j.anexos) ? j.anexos : []).map((a: any) => {
        const bytes = Buffer.from(String(a?.conteudo ?? ''), 'base64');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if (!a?.nome) erros.push('anexo sem nome');
        else if (bytes.subarray(0, 5).toString() !== '%PDF-') erros.push(`anexo ${a.nome}: não é PDF`);
        else if (sha256 !== a.sha256) erros.push(`anexo ${a.nome}: hash não confere com o conteúdo`);
        return { nome: a?.nome, bytes: bytes.length, sha256 };
      });
      if (erros.length) return send(422, { erros });
      const protocolo = 'SBX-' + randomUUID().slice(0, 8).toUpperCase();
      propostas.set(protocolo, { ...j, ...(anexos.length ? { anexos } : {}), protocolo, recebidaEm: new Date().toISOString() });
      return send(201, { protocolo });
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/propostas/')) {
      const p = propostas.get(req.url.split('/').pop()!);
      return p ? send(200, p) : send(404, { erro: 'protocolo não encontrado' });
    }
    if (req.method === 'POST' && req.url === '/api/esclarecimentos') {
      if (!j.tender || !j.texto || String(j.texto).length < 30) return send(422, { erro: 'tender e texto (≥30 caracteres) obrigatórios' });
      const protocolo = 'SBX-E-' + randomUUID().slice(0, 6).toUpperCase();
      esclarecimentos.push({ ...j, protocolo, recebidoEm: new Date().toISOString() });
      return send(201, { protocolo });
    }
    if (req.method === 'GET' && req.url?.startsWith('/api/esclarecimentos/')) {
      const e = esclarecimentos.find(x => x.protocolo === req.url!.split('/').pop());
      return e ? send(200, e) : send(404, { erro: 'protocolo não encontrado' });
    }
    send(404, { erro: 'rota inexistente' });
  });
  await new Promise<void>(r => srv.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(srv.address() as any).port}`;
  return { url, propostas, esclarecimentos, close: () => srv.close() };
}
