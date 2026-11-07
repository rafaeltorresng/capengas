# Lance

Digital worker de licitações para distribuidoras de material médico-hospitalar.

Todo dia, sozinho, o Lance:
- lê os pregões de saúde abertos no Compras.gov.br;
- confere, item a item, se o produto da empresa atende à especificação, se o registro na ANVISA serve
  e se os documentos exigidos estão em dia;
- monta o dossiê da proposta;
- dentro de uma política definida pela empresa, envia esclarecimentos e propostas;
- só chama o time nas exceções.

Projeto da equipe Capengas para o Converge Challenge 2026 (Recife, 7–8/11/2026).

**Estado:** pesquisa e validação técnica concluídas (spike com testes e evals); desenvolvimento em andamento.

## Documentos

| Documento | Conteúdo |
|---|---|
| [docs/lance-pesquisa.md](docs/lance-pesquisa.md) | Dossiê de pesquisa: problema, números com fonte, público-alvo, concorrência, dados disponíveis, validação técnica, hipóteses descartadas e escopo inicial |
| [docs/lance-produto.md](docs/lance-produto.md) | Documento do produto: visão, funcionalidades do MVP, política, telas, arquitetura, métricas e roteiro |
| [docs/lance-plano-fixo.md](docs/lance-plano-fixo.md) | Plano final aprovado: escopo, demo, riscos e ordem de corte |
| [docs/lance-execucao.md](docs/lance-execucao.md) | Plano de execução para 3 devs: contratos, tarefas, cronograma e portões |

## Números principais

| Fato | Número |
|---|---|
| Pregões de saúde abertos (07/11) | 1.647, somando ≥ R$ 3,8 bi |
| Itens de saúde que fracassam no Compras.gov.br | 16–21%, contra 4,6% em material de escritório |
| Distribuidoras de material médico cadastradas para vender ao governo | 5.513 (145 com sanção vigente) |
| Acerto do modelo no encaixe técnico (evals) | 18 de 18 |
| Custo de um turno real (3 pregões, 15 itens) | US$ 0,22 |

Fontes e metodologia em [docs/lance-pesquisa.md](docs/lance-pesquisa.md).

## Segredos

A chave do modelo (Featherless) fica em `.env`, que está no `.gitignore`. Nunca a versione.
