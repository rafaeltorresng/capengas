// Snapshot de execução para outro dev reproduzir a UI sem executar o modelo novamente.
// Não exporta chave, configuração de ambiente ou cache; apenas as tabelas do Store.
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openStore } from '../src/lib/store.ts';

const tables = ['tenders', 'items', 'fits', 'requirements', 'decisions', 'dossies', 'actions', 'escalations', 'events'];
const [mode, database, snapshot] = process.argv.slice(2);
if (!database || !snapshot || !['exportar', 'importar'].includes(mode)) throw Error('Uso: node scripts/banco-demo.ts exportar|importar banco.db snapshot.json');
if (mode === 'exportar') {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const data = Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t}`).all()]));
    mkdirSync(dirname(snapshot), { recursive: true });
    writeFileSync(snapshot, JSON.stringify({ versao: 1, aviso: 'Snapshot de análise: pregão real, empresa e fichas sintéticas. Não comprova conformidade ou envio.', tabelas: data }, null, 2) + '\n');
    console.log(JSON.stringify(Object.fromEntries(tables.map(t => [t, data[t].length]))));
  } finally { db.close(); }
} else {
  if (existsSync(database)) throw Error('O banco de destino já existe; escolha um arquivo novo.');
  const input = JSON.parse(readFileSync(snapshot, 'utf8'));
  if (input.versao !== 1 || !input.tabelas) throw Error('Snapshot inválido');
  const initialized = openStore(database); initialized.close();
  const db = new DatabaseSync(database);
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const table of tables) {
      const allowed = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r: any) => r.name));
      if (!Array.isArray(input.tabelas[table])) throw Error(`Tabela ausente: ${table}`);
      for (const row of input.tabelas[table]) {
        const columns = Object.keys(row);
        if (columns.some(c => !allowed.has(c))) throw Error(`Coluna incompatível em ${table}`);
        db.prepare(`INSERT INTO ${table} (${columns.map(c => '"' + c + '"').join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row) as (string | number | null)[]);
      }
    }
    db.exec('COMMIT');
    console.log('Snapshot importado; horários e eventos originais preservados.');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.close(); }
}
