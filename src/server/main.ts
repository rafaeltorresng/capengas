import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { openStore } from '../lib/store.ts';
import { createReadModel } from '../lib/read-model.ts';
import { createIntegratedStore } from './integrated.ts';
import { buildProof } from './proof.ts';
import { createServer } from './api.ts';
import { createSampleStore, type SampleState } from './sample.ts';

async function loadSample(): Promise<SampleState | undefined> {
  if (process.argv[3] !== '--dev2') return undefined;
  return JSON.parse(await readFile(new URL('../../fixtures/estado-exemplo.json', import.meta.url), 'utf8'));
}

const mode = process.argv[2];
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));

if (mode === 'amostra' || mode === 'integrado') {
  try {
    await access(new URL('../../web/dist/index.html', import.meta.url));
    const store = mode === 'integrado' ? openStore() : undefined;
    const company = store ? JSON.parse(await readFile(new URL('../../fixtures/company.json', import.meta.url), 'utf8')) : null;
    const state = store
      ? createIntegratedStore(store, createReadModel(store, {
        actions: () => store.getActions(), cofre: company.cofre,
        proof: () => buildProof(store.events()),
      }))
      : createSampleStore(await loadSample());
    const server = createServer(state, webRoot);
    server.on('error', (error: NodeJS.ErrnoException) => {
      console.error('Não foi possível iniciar o Lance em 127.0.0.1:8080 (' + error.code + ').');
      store?.close();
      process.exitCode = 1;
    });
    server.listen(8080, '127.0.0.1', () => console.log('Lance • ' + mode + ' • http://127.0.0.1:8080'));
  } catch (error) {
    console.error('Falha ao iniciar o Lance. Confira o build e a fonte de dados selecionada.',
      error instanceof Error ? error.message : '');
    process.exitCode = 1;
  }
} else {
  console.error('Selecione o modo amostra ou integrado.');
  process.exitCode = 1;
}