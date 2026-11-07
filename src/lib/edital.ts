// Leitura do edital: tenta os anexos recebidos e só escala quando nenhum tem texto.
export function leituraDoEdital(anexos: { titulo: string; texto: string }[]) {
  const comTexto = anexos.filter(a => a.texto.trim().length > 0);
  if (comTexto.length) return { legivel: true as const, texto: comTexto.map(a => a.texto).join('\n'), tentados: anexos.length };
  return { legivel: false as const, escalar: true as const, motivo: 'nenhum edital legível (ZIP, escaneado ou ausente)', tentados: anexos.length };
}
