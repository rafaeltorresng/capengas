import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from './api.ts';
import { createSampleStore, type SampleState } from './sample.ts';

async function loadSample(): Promise<SampleState | undefined> {
  if (process.argv[3] !== '--dev2') return undefined;
  return JSON.parse(await readFile(new URL('../../fixtures/estado-exemplo.json', import.meta.url), 'utf8'));
}

const mode = process.argv[2];
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));

if (mode === 'integrado') {
  console.error('Modo integrado indisponível neste checkout. São necessários o store SQLite do Dev1 e os contratos de dossiê e prova do Dev2.');
  process.exitCode = 1;
} else if (mode === 'amostra') {
  try {
    await access(new URL('../../web/dist/index.html', import.meta.url));
    const server = createServer(createSampleStore(await loadSample()), webRoot);
    server.on('error', (error: NodeJS.ErrnoException) => {
      console.error('Não foi possível iniciar a demo em 127.0.0.1:8080 (' + error.code + ').');
      process.exitCode = 1;
    });
    server.listen(8080, '127.0.0.1', () => console.log('Lance • amostra descartável • http://127.0.0.1:8080'));
  } catch (error) {
    console.error('Falha ao iniciar a demo. Confira o build e, com --dev2, fixtures/estado-exemplo.json.',
      error instanceof Error ? error.message : '');
    process.exitCode = 1;
  }
} else {
  console.error('Selecione o modo amostra ou integrado.');
  process.exitCode = 1;
}
