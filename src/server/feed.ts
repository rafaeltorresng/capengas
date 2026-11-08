// Um coletor por processo, compartilhado entre os navegadores. Cache público fora do Git.
import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE } from '../lib/data.ts';
import { criarFeed, coletarOportunidades, type RetratoFeed } from '../lib/oportunidades.ts';
import type { BibliotecaCatalogos } from '../lib/catalogos-demo.ts';
import type { PreparedDemo } from './onboarding.ts';
export function feedDoServidor(biblioteca: BibliotecaCatalogos, demo: PreparedDemo) {
  const arquivo = join(CACHE, 'oportunidades.json');
  let inicial: RetratoFeed = JSON.parse(
    readFileSync(new URL('../../fixtures/oportunidades.json', import.meta.url), 'utf8'),
  );
  if (existsSync(arquivo)) {
    try {
      const cached = JSON.parse(readFileSync(arquivo, 'utf8'));
      if (
        cached.versao === 1 &&
        Array.isArray(cached.pregoes) &&
        (cached.ultimaTentativa ?? '') > (inicial.ultimaTentativa ?? '')
      )
        inicial = cached;
    } catch {
      /* Mantém a coleta pública preparada. */
    }
  }
  const coverage = JSON.parse(readFileSync(new URL('../../fixtures/coverage.json', import.meta.url), 'utf8'));
  const sementes = coverage
    .filter((p: any) => p.sistema === 'Compras.gov.br' && p.nItems <= 400)
    .map((p: any) => ({ ...p, plataforma: p.sistema, situacao: 'Situação a consultar', valorEstimado: null }));
  return criarFeed({
    inicial,
    coletar: (anterior) =>
      coletarOportunidades({
        anterior,
        sementes,
        produtos: biblioteca.produtos,
        excluidos: [demo.evento?.id, demo.editalIlegivel?.id].filter((id): id is string => !!id),
      }),
    salvar: (s) => {
      mkdirSync(CACHE, { recursive: true });
      const temp = arquivo + `.${process.pid}.tmp`;
      writeFileSync(temp, JSON.stringify(s));
      renameSync(temp, arquivo);
    },
  });
}
