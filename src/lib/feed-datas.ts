// Horários sem offset das APIs do PNCP são horários de Brasília, equivalentes a Recife neste fluxo.
const instante = (s: string) =>
  new Date(
    /^\d{4}-\d\d-\d\d$/.test(s)
      ? s + 'T12:00:00-03:00'
      : /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?$/.test(s)
        ? s + '-03:00'
        : s,
  );
export function dataFonte(raw: string | null) {
  if (!raw) return 'Não informado';
  const d = instante(raw);
  return Number.isFinite(d.getTime())
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Recife',
        dateStyle: 'short',
        ...(/^\d{4}-\d\d-\d\d$/.test(raw) ? {} : { timeStyle: 'short' as const }),
      }).format(d)
    : 'Não informado';
}
export function publicacaoRelativa(raw: string | null, now = new Date()) {
  if (!raw || !Number.isFinite(instante(raw).getTime())) return 'Publicação não informada';
  const dia = (d: Date) => {
    const ps = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Recife',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d);
    const v = (t: string) => Number(ps.find((p) => p.type === t)!.value);
    return Date.UTC(v('year'), v('month') - 1, v('day'));
  };
  const n = Math.round((dia(now) - dia(instante(raw))) / 86400e3);
  return n === 0
    ? 'Publicado hoje'
    : n === 1
      ? 'Publicado ontem'
      : n > 1
        ? `Publicado há ${n} dias`
        : `Publicação em ${dataFonte(raw)}`;
}
