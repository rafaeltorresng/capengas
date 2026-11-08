import { registerHooks } from 'node:module';

registerHooks({
  load(url, context, next) {
    if (url.endsWith('/lib/agente-operacional.ts')) {
      return { format: 'module', shortCircuit: true, source: `
        import { gerarDocumentoProposta } from ${JSON.stringify(new URL('../../src/lib/documento-proposta.ts', import.meta.url))};
        export async function runAgentWithOperationalReview({ state }) {
          const [id] = Object.keys(state.tenders);
          const { marca, registroAnvisa } = state.company.catalogo[0];
          const itens = [{ numero: 1, descricao: 'PRODUTOAPROVADO' }, { numero: 2, descricao: 'PRODUTORECUSADO' }]
            .map(item => ({ ...item, quantidade: 2, precoUnitario: 100, marca, registroAnvisa }));
          state.items[id] = itens;
          state.operationalReviews = { [id]: { estado: 'concluida', motivo: 'Revisao simulada' } };
          for (const { numero } of itens) {
            state.decisions[id + '#' + numero] = { produto: state.company.catalogo[0].id, precoProposto: 100,
              estado: numero === 1 ? 'disputar' : 'disputar_com_pendencia', motivos: ['Conferir amostra'] };
          }
          state.proposals[id] = gerarDocumentoProposta({ pregao: { id, orgao: 'Hospital' }, empresa: state.company.empresa,
            itens, regras: [], hoje: state.now });
          return { trace: [], stopped: 'final', ms: 0, usage: {} };
        }` };
    }
    if (url.endsWith('/lib/recheck.ts')) {
      return { format: 'module', shortCircuit: true, source: `
        export * from ${JSON.stringify(url + '?real')};
        export async function snapshotTender(id, store) {
          store.upsertTender({ ...store.getTender(id), arquivosHash: 'fixture', ultimoCheck: new Date().toISOString() });
        }` };
    }
    if (url.endsWith('/lib/data.ts')) {
      return { format: 'module', shortCircuit: true, source: `
        import { readFileSync } from 'node:fs';
        export * from ${JSON.stringify(url + '?real')};
        export const anvisa = { byRegistro: () => ({
          NOME_COMERCIAL: JSON.parse(readFileSync('fixtures/company.json', 'utf8')).catalogo[0].marca,
          VALIDADE_REGISTRO_CADASTRO: 'VIGENTE',
        }) };` };
    }
    if (url.endsWith('/server/documentos.ts')) {
      return { format: 'module', shortCircuit: true, source: `
        import { writeFileSync } from 'node:fs';
        import { renderizarPdf as render } from ${JSON.stringify(url + '?real')};
        export * from ${JSON.stringify(url + '?real')};
        export function renderizarPdf(arquivo) {
          if (arquivo.nomeArquivo.startsWith('lance-proposta-')) writeFileSync('proposta-renderizada.md', arquivo.markdown);
          return render(arquivo);
        }` };
    }
    return next(url, context);
  },
});
