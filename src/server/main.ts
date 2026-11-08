import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openStore } from '../lib/store.ts';
import { createReadModel } from '../lib/read-model.ts';
import { createIntegratedStore } from './integrated.ts';
import { buildProof } from './proof.ts';
import { createServer } from './api.ts';
import { createSampleStore, type SampleState } from './sample.ts';
import { relatorioProva } from '../lib/cenarios.ts';
import { sancoesDoArquivo } from '../lib/carteira.ts';
import { DATA } from '../lib/data.ts';
import { join } from 'node:path';

async function loadSample(): Promise<SampleState | undefined> {
  if (process.argv[3] !== '--dev2') return undefined;
  return JSON.parse(await readFile(new URL('../../fixtures/estado-exemplo.json', import.meta.url), 'utf8'));
}

const mode = process.argv[2];
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));
const port = Number(process.env.LANCE_PORT ?? 8080);

if (mode === 'amostra' || mode === 'integrado') {
  try {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Informe uma porta válida em LANCE_PORT.');
    await access(new URL('../../web/dist/index.html', import.meta.url));
    const store = mode === 'integrado' ? openStore() : undefined;
    const company = store ? JSON.parse(await readFile(new URL('../../fixtures/company.json', import.meta.url), 'utf8')) : null;
    const prova = store ? await relatorioProva() : null;
    // Pauta: semáforo fiscal dos pregões da demo e CEIS do cliente (arquivo do Portal da Transparência, se houver).
    const demo = store ? JSON.parse(await readFile(new URL('../../fixtures/demo.json', import.meta.url), 'utf8')) : null;
    const semaforos = Object.fromEntries((demo?.pregoes ?? []).filter((p: any) => p.semaforoFiscal?.status).map((p: any) => [p.id, p.semaforoFiscal]));
    const sancoes = store ? sancoesDoArquivo(process.env.LANCE_CEIS_CSV ?? join(DATA, 'ceis.csv'), company.empresa?.cnpj) : null;
    const state = store
      ? createIntegratedStore(store, createReadModel(store, {
        actions: () => store.getActions(), cofre: company.cofre, semaforos, sancoes,
        proof: () => buildProof(prova!, store.events()),
      }))
      : createSampleStore(await loadSample());
    const server = createServer(state, webRoot);
    server.on('error', (error: NodeJS.ErrnoException) => {
      console.error(`Não foi possível iniciar o Lance em 127.0.0.1:${port} (${error.code}).`);
      store?.close();
      process.exitCode = 1;
    });
    server.listen(port, '127.0.0.1', () => console.log(`Lance • ${mode} • http://127.0.0.1:${port}`));
  } catch (error) {
    console.error('Falha ao iniciar o Lance. Confira o build e a fonte de dados selecionada.',
      error instanceof Error ? error.message : '');
    process.exitCode = 1;
  }
} else {
  console.error('Selecione o modo amostra ou integrado.');
  process.exitCode = 1;
}
