function decodeSegment(value: string) {
  try { return decodeURIComponent(value); }
  catch { return value; }
}

function segments(path: string, prefix: string) {
  return path.slice(prefix.length).split('/').map(decodeSegment);
}

export function itemRoute(path: string) {
  if (!path.startsWith('itens/')) return null;
  const parts = segments(path, 'itens/');
  if (parts.length < 2 || parts.some(part => part.length === 0)) return null;
  const item = parts.at(-1)!;
  const tender = parts.slice(0, -1).join('/');
  return { tender, item, api: 'itens/' + encodeURIComponent(tender) + '/' + encodeURIComponent(item) };
}

export function dossierRoute(path: string) {
  if (!path.startsWith('dossies/')) return null;
  const parts = segments(path, 'dossies/');
  if (parts.length === 0 || parts.some(part => part.length === 0)) return null;
  const tender = parts.join('/');
  return { tender, api: 'dossies/' + encodeURIComponent(tender) };
}

export function turnoRoute(path: string) {
  if (path === 'turnos') return { id: null as string | null };
  if (!path.startsWith('turnos/')) return null;
  const parts = segments(path, 'turnos/');
  if (parts.length === 0 || parts.some(part => part.length === 0)) return null;
  return { id: parts.join('/') };
}
