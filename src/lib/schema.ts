// Validador mínimo de JSON Schema para argumentos de ferramentas (sem dependências).
export type Schema = { type?: string; required?: string[]; properties?: Record<string, Schema>; items?: Schema; enum?: unknown[]; description?: string };

export function validate(s: Schema, v: unknown, path = ''): string[] {
  const at = path || 'argumentos';
  const errs: string[] = [];
  const t = s.type;
  if (t === 'object') {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return [`${at}: esperado object`];
    for (const r of s.required ?? []) if ((v as any)[r] === undefined) errs.push(`${path ? path + '.' : ''}${r}: obrigatório`);
    for (const [k, ps] of Object.entries(s.properties ?? {})) {
      const x = (v as any)[k];
      if (x !== undefined) errs.push(...validate(ps, x, path ? `${path}.${k}` : k));
    }
  } else if (t === 'array') {
    if (!Array.isArray(v)) return [`${at}: esperado array`];
    if (s.items) v.forEach((x, i) => errs.push(...validate(s.items!, x, `${path}[${i}]`)));
  } else if (t === 'string') { if (typeof v !== 'string') errs.push(`${at}: esperado string`); }
  else if (t === 'number') { if (typeof v !== 'number' || !Number.isFinite(v)) errs.push(`${at}: esperado number`); }
  else if (t === 'integer') { if (!Number.isInteger(v)) errs.push(`${at}: esperado integer`); }
  else if (t === 'boolean') { if (typeof v !== 'boolean') errs.push(`${at}: esperado boolean`); }
  if (s.enum && !s.enum.includes(v)) errs.push(`${at}: deve ser um de ${s.enum.join(', ')}`);
  return errs;
}
