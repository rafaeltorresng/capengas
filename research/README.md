# research/: medições próprias (agregadas)

Saídas **agregadas** das medições feitas em 07/11/2026 com dados públicos. Cada arquivo traz data, fonte,
método, denominadores, script que gera e ressalvas. Não há dados pessoais nem listas de empresas.

| Arquivo | O que mede | Número principal | Script |
|---|---|---|---|
| `fracasso-comprasgov-abr2026.json` | Situação final dos itens de pregões do Compras.gov.br publicados em abr/2026, por classe | Fracassado: **20,9%** (6515) e **16,3%** (6510), contra **4,6%** (7510, controle) | `scripts/pesquisa/estimativa2.ts`, `scripts/pesquisa/valor.ts` |
| `fracasso-pncp.json` | Situação final dos itens em pregões encerrados do PNCP (majoritariamente plataformas municipais) | Fracassado + deserto: 8,5% (material hospitalar), 9,1% (equipamentos), 5,9% (controle) | `scripts/pesquisa/fracasso.ts` |
| `backtest-preco.json` | O histórico de preços (congelado antes do pregão) prevê fracasso ou o preço vencedor? | Não forneceu filtro útil; erro mediano de 32% contra **11%** da estimativa do órgão | `scripts/pesquisa/backtest.ts` |
| `abertos-2026-11-07.json` | Pregões de saúde com propostas abertas (07/11, 11h) | **1.647** pregões, ≥ R$ 3,8 bi; 686 no Compras.gov.br | `scripts/pesquisa/abertos.ts` |
| `cobertura-codigo-catalogo.json` | Itens com código de catálogo, por plataforma | 17 de 40 pregões e 709 de 2.920 itens (só Compras.gov.br) | `scripts/pesquisa/coverage.ts` |
| `recuperacao-catmat.json` | Busca local do código CATMAT a partir do texto | Recall@8 de 96% com texto padrão; 24% só com texto do órgão | `scripts/eval-retrieval.ts` |
| `fornecedores-cnae.json` | Fornecedores ativos no cadastro do governo por CNAE de saúde | **5.513** distribuidoras de material médico | `scripts/pesquisa/sancoes.ts` |
| `sancoes-ceis.json` | Sanções no CEIS contra essas distribuidoras | **145** empresas com sanção vigente; 206 impedimentos | `scripts/pesquisa/sancoes.ts` |
| `evals-kimi-k2.6.json` | Evals do modelo com gabarito (`fixtures/gold.json`) | Encaixe **18/18** (6 pares × 3); exigências 21/27; código 13/18; reescrita sem ganho | `scripts/evals.ts` |
| `turno-real-2026-11-07.json` | Turno ponta a ponta com o modelo em 3 pregões reais | **US$ 0,22**; 12,5 min + 1,7 min; 85 chamadas ok, 5 com erro | `scripts/turno.ts` |

## Como ler estes números (ressalvas que valem para todos)

- **Amostras não são aleatórias:** seguem a ordem da busca e das primeiras páginas das APIs.
- **Fracasso de item não é desclassificação de uma proposta específica.** O item fracassa quando nenhuma proposta é aceita.
- **O backtest não prova que o preço não causa fracasso.** Só mostra que as regras testadas não serviram como filtro.
- **5.513 cadastros ativos não são compradores qualificados**, e R$ 1 trilhão em compras públicas não é o TAM de um software.
- **18/18 no encaixe técnico** são 6 pares distintos repetidos 3 vezes, com fichas sintéticas; não é precisão de produção.
- **Sanções por entrega** mostram risco depois de ganhar, não o impacto do produto na preparação.

## Reproduzir

Os scripts estão em `scripts/` e `scripts/pesquisa/` e usam as APIs públicas, com cache em `cache/`.
Os números mudam com o tempo, porque os pregões abertos e os desfechos mudam todo dia. Os arquivos aqui são o retrato de 07/11/2026.
