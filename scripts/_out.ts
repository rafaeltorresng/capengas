// Garante a pasta de saída dos scripts (resultados, rastros, logs).
import { mkdirSync } from 'node:fs';
mkdirSync('out', { recursive: true });
