import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

function executar(aprovar: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'lance-fluxo-teste-'));
  cpSync(fileURLToPath(new URL('../fixtures', import.meta.url)), join(dir, 'fixtures'), { recursive: true,
    filter: source => source.endsWith('fixtures') || /[\\/](company|coverage|demo)\.json$/.test(source) });
  const script = fileURLToPath(new URL('../scripts/fluxo-completo.ts', import.meta.url));
  const stubs = new URL('./support/fluxo-completo-stubs.mjs', import.meta.url).href;
  const resultado = spawnSync(process.execPath, ['--import', stubs, script, '--recheque-demo', '--decisao', 'recusar',
    ...(aprovar ? ['--aprovar'] : [])], {
    cwd: dir, env: { ...process.env, LANCE_DB: join(dir, 'lance.db'), AI_API_KEY: 'chave-sintetica' },
    encoding: 'utf8', timeout: 20_000,
  });
  try {
    assert.equal(resultado.status, 0, resultado.stdout + resultado.stderr);
    const pasta = join(dir, 'out', 'fluxo-completo');
    const saida = join(pasta, readdirSync(pasta)[0]);
    if (!aprovar) {
      assert.match(resultado.stdout, /geração dos anexos e envio não aprovados/);
      assert.ok(readdirSync(saida).every(nome => (nome === 'relatorio.pdf' || !nome.endsWith('.pdf')) && nome !== 'protocolo.json'));
      return;
    }
    assert.ok(resultado.stdout.indexOf('humano: recusar') < resultado.stdout.indexOf('Gera os anexos'));
    assert.match(resultado.stdout, /protocolo SBX-.* confirmado/, resultado.stdout);
    const protocolo = JSON.parse(readFileSync(join(saida, 'protocolo.json'), 'utf8'));
    assert.deepEqual(protocolo.itens.map((i: { numero: number }) => i.numero), [1]);
    const anexo = protocolo.anexos.find((a: { nome: string }) => a.nome.startsWith('lance-proposta-'));
    const pdf = readFileSync(join(saida, anexo.nome));
    assert.equal(anexo.sha256, createHash('sha256').update(pdf).digest('hex'));
    const texto = readFileSync(join(dir, 'proposta-renderizada.md'), 'utf8');
    assert.match(texto, /PRODUTOAPROVADO/);
    assert.doesNotMatch(texto, /PRODUTORECUSADO/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('fluxo completo exige confirmação antes de gerar os anexos', () => executar(false));
test('fluxo completo envia somente os itens aprovados no POST e no PDF', () => executar(true));
