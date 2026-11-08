import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarFeed, filtrarOportunidades, coletarOportunidades, type RetratoFeed } from '../src/lib/oportunidades.ts';
const now = () => new Date('2026-11-08T12:00:00Z');
const base: RetratoFeed = {
  versao: 1,
  ultimaSincronizacao: '2026-11-07T12:00:00Z',
  ultimaTentativa: null,
  status: 'preparado',
  avisos: [],
  pregoes: [
    {
      id: '12345678000199/2026/1',
      orgao: 'Órgão sintético',
      uf: 'PR',
      objeto: 'Aquisição de materiais',
      abertura: '2026-11-23T09:00:00',
      situacao: 'Divulgada no PNCP',
      plataforma: 'Compras.gov.br',
      url: 'https://pncp.gov.br/app/editais/12345678000199/2026/1',
      publicadoEm: '2026-11-06T12:00:00',
      atualizadoNaFonteEm: '2026-11-07T12:00:00',
      consultadoEm: '2026-11-07T12:00:00Z',
      fontes: [],
      itens: [
        { numero: 4, descricao: 'Tesoura instrumental', quantidade: 10 },
        { numero: 9, descricao: 'Luva látex para procedimento', quantidade: 100 },
      ],
    },
  ],
};
const produtos = [
  { id: 'P1', termos: ['tesoura'] },
  { id: 'P2', termos: ['tesoura'] },
];
test('feed usa catálogo selecionado e conta itens distintos, sem inventar publicação', () => {
  const f = filtrarOportunidades(base, produtos, now());
  assert.equal(f.pregoes.length, 1);
  assert.equal(f.pregoes[0].itensCandidatos, 1);
  assert.equal(f.pregoes[0].matches.length, 2);
  assert.equal(f.pregoes[0].publicadoEm, base.pregoes[0].publicadoEm);
  assert.equal(filtrarOportunidades(base, [{ id: 'P3', termos: ['cadeira'] }], now()).pregoes.length, 0);
  const velho = structuredClone(base);
  velho.pregoes[0].abertura = '2026-11-01T09:00:00';
  assert.equal(filtrarOportunidades(velho, produtos, now()).pregoes[0].disponivel, false);
});
test('atualização é compartilhada; falha não renova sucesso nem consulta anterior', async () => {
  let chamadas = 0;
  let resolver!: (v: RetratoFeed) => void;
  const pendente = new Promise<RetratoFeed>((r) => (resolver = r));
  const feed = criarFeed({
    inicial: base,
    now,
    coletar: async () => {
      chamadas++;
      return pendente;
    },
  });
  const a = feed.atualizar();
  const b = feed.atualizar();
  assert.equal(a, b);
  await Promise.resolve();
  assert.equal(chamadas, 1);
  assert.equal(feed.retrato().status, 'atualizando');
  resolver({ ...base, status: 'atualizado', ultimaSincronizacao: now().toISOString() });
  await Promise.all([a, b]);
  assert.equal(feed.retrato().ultimaSincronizacao, now().toISOString());
  const fail = criarFeed({
    inicial: base,
    now,
    coletar: async () => {
      throw Error('Fonte indisponível');
    },
  });
  await fail.atualizar();
  const s = fail.retrato();
  assert.equal(s.status, 'indisponivel');
  assert.equal(s.ultimaSincronizacao, base.ultimaSincronizacao);
  assert.equal(s.pregoes[0].consultadoEm, base.pregoes[0].consultadoEm);
  assert.equal(s.ultimaTentativa, now().toISOString());
});
test('coleta falha não vira lista vazia atualizada e resultado sem metadados não é aceito', async () => {
  await assert.rejects(
    coletarOportunidades({
      anterior: base,
      produtos,
      now,
      consultar: async () => {
        throw Error('HTTP 503');
      },
    }),
  );
  const parcial = await coletarOportunidades({
    anterior: base,
    produtos,
    now,
    consultar: async (url) =>
      url.includes('/api/search/')
        ? {
            items: [
              {
                orgao_cnpj: '12345678000199',
                ano: 2026,
                numero_sequencial: 1,
                usuario_nome: 'Compras.gov.br',
                modalidade_licitacao_nome: 'Pregão - Eletrônico',
              },
            ],
          }
        : {},
  });
  assert.equal(parcial.status, 'parcial');
  assert.equal(parcial.ultimaSincronizacao, base.ultimaSincronizacao);
  assert.equal(parcial.pregoes[0].consultadoEm, base.pregoes[0].consultadoEm);
});

test('coleta confere identidade, pagina itens e deduplica pregão descoberto em várias buscas', async () => {
  let detalhes = 0;
  const fonte = base.pregoes[0];
  const s = await coletarOportunidades({
    anterior: { ...base, pregoes: [] },
    produtos,
    now,
    consultar: async (url) => {
      if (url.includes('/api/search/'))
        return {
          items: [
            {
              orgao_cnpj: '12345678000199',
              ano: 2026,
              numero_sequencial: 1,
              usuario_nome: 'Compras.gov.br',
              modalidade_licitacao_nome: 'Pregão - Eletrônico',
            },
          ],
        };
      if (!url.includes('/itens?')) {
        detalhes++;
        return {
          orgaoEntidade: { cnpj: '12345678000199', razaoSocial: fonte.orgao },
          unidadeOrgao: { ufSigla: 'PR' },
          anoCompra: 2026,
          sequencialCompra: 1,
          situacaoCompraNome: 'Divulgada no PNCP',
          usuarioNome: 'Compras.gov.br',
          modalidadeNome: 'Pregão - Eletrônico',
          dataEncerramentoProposta: fonte.abertura,
          dataPublicacaoPncp: fonte.publicadoEm,
          dataAtualizacao: fonte.atualizadoNaFonteEm,
          objetoCompra: fonte.objeto,
        };
      }
      const pagina = Number(new URL(url).searchParams.get('pagina'));
      return pagina === 1
        ? Array.from({ length: 100 }, (_, n) => ({
            numeroItem: n + 1,
            descricao: n === 3 ? 'Tesoura instrumental' : 'Outro material',
            quantidade: 10,
          }))
        : [];
    },
  });
  assert.equal(detalhes, 1);
  assert.equal(s.pregoes.length, 1);
  assert.equal(s.pregoes[0].itens.length, 1);
  assert.equal(s.pregoes[0].itens[0].numero, 4);
  assert.equal(s.pregoes[0].fontes.length, 3);
  assert.equal(s.pregoes[0].publicadoEm, fonte.publicadoEm);
  assert.equal(s.status, 'atualizado');
  assert.equal(s.ultimaSincronizacao, now().toISOString());
});
test('data ausente não é inventada e suspensão confirmada retira o pregão anterior', async () => {
  const s = await coletarOportunidades({
    anterior: base,
    produtos,
    now,
    consultar: async (url) =>
      url.includes('/api/search/')
        ? {
            items: [
              {
                orgao_cnpj: '12345678000199',
                ano: 2026,
                numero_sequencial: 1,
                usuario_nome: 'Compras.gov.br',
                modalidade_licitacao_nome: 'Pregão - Eletrônico',
              },
            ],
          }
        : {
            orgaoEntidade: { cnpj: '12345678000199' },
            anoCompra: 2026,
            sequencialCompra: 1,
            usuarioNome: 'Compras.gov.br',
            modalidadeNome: 'Pregão - Eletrônico',
            situacaoCompraNome: 'Suspensa',
            dataEncerramentoProposta: '2026-11-23T09:00:00',
          },
  });
  assert.equal(s.pregoes.length, 0);
  assert.equal(s.status, 'atualizado');
  const semData = structuredClone(base);
  semData.pregoes[0].publicadoEm = null;
  assert.equal(filtrarOportunidades(semData, produtos, now()).pregoes[0].publicadoEm, null);
});

test('limite da fonte interrompe coleta e impede novas consultas antes do Retry-After', async () => {
  const { FonteLimitadaError } = await import('../src/lib/oportunidades.ts');
  let chamadas = 0;
  const r = await coletarOportunidades({
    anterior: base,
    produtos,
    now,
    sementes: [
      {
        cnpj: '12345678000199',
        ano: 2026,
        seq: 1,
        plataforma: 'Compras.gov.br',
        modalidade: 'Pregão - Eletrônico',
        abertura: '2026-11-23T09:00',
        objeto: 'Teste',
        orgao: 'Teste',
        uf: 'PR',
        municipio: 'Teste',
        url: 'https://example.org',
        situacao: 'A consultar',
        valorEstimado: null,
      },
    ],
    consultar: async () => {
      chamadas++;
      throw new FonteLimitadaError(600_000);
    },
  });
  assert.ok(chamadas <= 2);
  assert.equal(r.status, 'parcial');
  assert.equal(r.pregoes[0].consultadoEm, base.pregoes[0].consultadoEm);
  assert.equal(r.proximaConsultaEm, '2026-11-08T12:10:00.000Z');
  let tentativas = 0;
  const feed = criarFeed({
    inicial: r,
    now,
    coletar: async () => {
      tentativas++;
      return r;
    },
  });
  await feed.atualizar();
  assert.equal(tentativas, 0);
});

test('falha síncrona do coletor não prende o feed para sempre', async () => {
  let instante = now().getTime();
  let chamadas = 0;
  const feed = criarFeed({
    inicial: base,
    now: () => new Date(instante),
    coletar: () => {
      chamadas++;
      throw new Error('Falha controlada');
    },
  });
  await feed.atualizar();
  assert.equal(feed.retrato().status, 'indisponivel');
  instante += 31_000;
  await feed.atualizar();
  assert.equal(chamadas, 2);
});
