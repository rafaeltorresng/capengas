# Dev 2 — entrega de integração

Atualização: 07/11/2026. Complementa a discussão das issues #2 e #4. Esta entrega ainda não conclui o turno autônomo.

## Pontos de entrada

```ts
import { openStore } from '../lib/store.ts';
import { createReadModel } from '../lib/read-model.ts';

const store = openStore();
const projection = createReadModel(store, {
  actions: () => store.getActions(),
  // proof: () => relatorioDaExecucao, // opcional; ausência mantém métricas null
});

// projection: hoje(), fila(), item(tender, item), dossie(tender),
// escaladas(), prova(), decidir(id, decisao), origem.
// Pode ser entregue a createIntegratedStore(store, projection), do Dev 3.
```

`hoje` seleciona o dia em America/Recife. Contadores de decisões usam os pares pregão/item dos eventos `decisao` daquele dia, sem atribuir decisões antigas à execução atual. Envios usam ações `confirmada`, `verificado === true`, com protocolo, únicas por `key`, segundo `atualizadaEm`. Custos do modelo só são somados se todas as entradas `llm`/`llm:<modelo>` presentes tiverem `custoUsd`; sem medição, ficam `null`.

`fila` e `item` usam estado, motivos e preço persistidos. Evidências, documentação e regularização vêm do JSON do dossiê. Havendo vários produtos para um item, usam a seleção explícita no dossiê; sem seleção, a projeção mostra a ambiguidade como escalada e não escolhe preço arbitrariamente. Isso não substitui a política de envio.

O prazo exibido nesta versão é a sessão, identificado como `prazoTipo: 'sessao'`; abertura ausente/inválida produz `prazo: null` e tipo `desconhecido`. Não se apresenta a sessão como prazo de esclarecimento. Escaladas usam o prazo de decisão humana registrado no store. O Dev 3 ajustou contrato e tela para aceitar os nulos.

`decidir` delega a `resolveEscalation`; a transação e a auditoria continuam sendo responsabilidade do SQLite. A projeção não escreve outro evento de decisão.

## Dossiê

```ts
import { buildDossie } from '../lib/dossie.ts';
import { checkDocs } from '../lib/rules.ts';

const exigencias = state.requirements
  .filter(r => r.tender_id === tenderId)
  .map(r => ({ tipo: r.requirement, citacao: r.quote }));
const documentos = checkDocs(state.company.cofre, exigencias, dataSessao);
const dossier = buildDossie(state, tenderId, { documentos });
store.upsertDossie(tenderId, dossier);
```

`buildDossie` aceita `DocCheck` publicado pelo Dev 1, incluindo `documento: null`. Liga as linhas documentais à citação da exigência; preserva preço, decisão, produto e citações. Exigências sem avaliação continuam não verificadas. Também aceita nomes de decisões do spike durante a transição, mas um `precoProposto: null` novo nunca reaproveita preço legado.

O resultado mantém `tender`, `pregao`, `versao`, `checklist`, `pendencias`, `documentos` do contrato visual. Acrescenta `geradoEm`, `orgao`, `sessao`, `empresa`, `exigencias`, `itens` e `envioAutomaticoLiberado: false`. O construtor nunca autoriza envio.

## Ferramentas e amostra

- `get_tender_items({ tender_id, keywords?, page?, page_size? })`: até 25 resumos de 240 caracteres por página. Siga `proxima_pagina`. O resumo curto evita truncar uma página inteira no limite padrão do histórico do agente.
- `get_tender_item({ tender_id, item, offset? })`: descrição em partes de 6000 caracteres. Siga `proximo_offset` até `null` antes de concluir a comparação.
- `record_fit`: recusa lista vazia, nomes vazios/duplicados e citações não encontradas; invalida a decisão anterior quando se refaz a análise. Bloqueia divergência de medidas exatas isoladas em mm/cm/m. Não valida toda a semântica ou completude: registra `validacao.cobertura: 'nao_verificada'`.
- `record_requirement`: preserva o arquivo de origem quando a citação foi localizada nele. Não inventa página de PDF.

```bash
node --disable-warning=ExperimentalWarning scripts/estado-exemplo.ts
```

O gerador escreve `fixtures/estado-exemplo.json` com o formato da tela (`hoje`, `fila`, `itens`, `dossies`, `escaladas`, `prova`) e `_meta` que distingue fontes reais de conteúdo sintético. Identificadores, descrições e estimativas dos itens são snapshots das fixtures existentes. Empresa, fichas, decisões e exigência documental ilustrativa são sintéticos. Sem turno, envio, protocolo ou medição de modelo inventados.

## Verificação desta entrega

- Suíte local após integrar a `main` em `0a1b81e`: **184 testes passaram**, incluindo 36 regressões do Dev 2 sobre a base de 148 testes do Dev 1.
- TypeScript 5.9.3 em modo estrito: passou em `src/lib`, testes, gerador e scripts de turno/evals. A atribuição da projeção ao `StoreProjection` do Dev 3 também passou na verificação de tipos.
- SQLite real em arquivo temporário: a projeção lê dossiê/decisões/ações após reabrir e preserva uma resolução de escalada com exatamente um evento de auditoria.
- API/adaptador do Dev 3 no commit `36469150c553faca2ce874e5d18c41ec731533f8`, com a projeção real do Dev 2 e SQLite do Dev 1: seis GETs, POST de escalada, prazo nulo, 409 na repetição e persistência após reabrir passaram em diretório temporário.
- Sem teste visual nesta entrega, sem chamadas Featherless, sem coleta pública ao vivo e sem envio a portais externos. Os dados de teste acima não demonstram execução de um turno autônomo.

## Fronteiras e pendências

### Turno de análise persistido

`scripts/analisar.ts` executa o modelo com ferramentas somente de análise e grava as decisões, dossiês, eventos e escaladas no SQLite. Requer bases locais (`npm run setup`), `pdftotext` e chave Featherless configurada. Exemplo em shell POSIX, usando banco separado:

```bash
LANCE_DB=data/turno-validacao.db node --env-file-if-exists=.env scripts/analisar.ts 77816510000166/2026/348
```

O comando limita a análise a três itens relevantes por instrução, com limites de passos e tokens. O limite de itens é uma instrução ao modelo, não uma quota garantida pelo código. A empresa continua fictícia; as fontes do pregão são reais. O comando não expõe ferramentas de envio. A porta de envio está em `src/lib/act.ts` (`executarAcao`) e ainda não foi ligada às ferramentas do modelo. Não versionar o banco gerado.

`decide_item` usa agora preço pela estimativa, documentos e regularização do contrato novo. Cobertura técnica não verificada escala; preço desconhecido permanece nulo. Campos de saída legados são mantidos temporariamente para os consumidores do spike. As funções legadas de `rules.ts` ainda são usadas por testes e não devem ser removidas sem migrá-los.

O turno real foi executado: 3 decisões, dossiê e 3 escaladas, 292 segundos e US$ 0,062826164 informados pela API. O snapshot e os comandos para restaurar o SQLite sem gastar modelo estão em `fixtures/execucoes/README.md`. Nesta etapa, 202 testes locais passaram. A bateria ao vivo antiga ainda contém expectativas do fluxo legado e precisa ser atualizada antes da validação completa.

Implementação própria: `tools.ts`, `dossie.ts`, `read-model.ts`, gerador/amostra, ajustes dos scripts de turno/evals e testes correspondentes. A entrega foi integrada sobre os commits do Dev 1 na `main`, preservando contratos, regras, store, política, recheque, dados e testes já publicados por ele; essas mudanças não são autoria do Dev 2.

Já na `main`: `decide_item` no contrato novo, persistência do turno de análise, dossiê, projeção e o snapshot `fixtures/execucoes/analise-2026-11-07.json`. O PR #3 foi integrado. Cobertura técnica não verificada continua indo para `decideItem` como `fit: 'desconhecido'`.

`executarAcao` aplica a ordem da #2: recheque, `evaluate`, `recordIntent`, POST no sandbox, `consultarProtocolo` e `updateAction`. O pedido só informa pregão e números de item (e o texto do esclarecimento). Quantidade, decisão, `precoProposto` e o prazo legal saem do store e de `esclarecimentoDeadline`. Sem `recheck` injetado, a função bloqueia. Timeout ou consulta falha depois do POST não gera outro envio. O `runAnalysisTurn` grava a foto com `snapshotTender` quando o chamador passa `snapshot`; falha da foto não apaga a análise, e sem foto o recheque continua bloqueando. `submit_proposal` e `send_esclarecimento` chamam `executarAcao` sobre a análise já gravada. O envio não tira nova foto nem regrava a decisão. Sem foto, ou com `reavaliar`, o resultado é bloqueio. O motivo do esclarecimento tem de coincidir com o encaixe ou com a sinalização restritiva gravados. Sem `store` no estado, não há POST. O preço continua o `precoProposto` gravado. O `scripts/analisar.ts` segue sem essas ferramentas. O `scripts/turno.ts` liga o store para a segunda fase passar pela mesma porta.

`runAnalysisTurn` (`src/lib/turn.ts`) persiste a análise. Com `origem: 'direto'`, grava `turno_inicio` e `turno_fim`. Com `origem: 'agendador'`, não grava esses dois eventos: o `createScheduler` já os grava, e o teste conjunto garante um único par. O `scripts/analisar.ts` usa a origem direta e não oferece as ferramentas de envio.

Ainda faltam: inventário de exigências técnicas e cobertura; evals distintos e a meta de 3 minutos. As funções legadas de `rules.ts` continuam nos testes e não devem ser removidas sem migrá-los.
