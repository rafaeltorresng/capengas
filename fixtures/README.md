# fixtures/: o que é real e o que é sintético

| Arquivo | Origem | O que é real | O que é sintético |
|---|---|---|---|
| `company.json` | Montado pela equipe | **Números de registro ANVISA** dos produtos (base aberta TA_PRODUTO_SAUDE_SITE) | Empresa, catálogo (nomes, marcas, fichas técnicas, custos), cofre de documentos, política e termos de busca |
| `demo.json` | `scripts/preparar-demo.ts` | Pregões, órgãos, datas, itens, estimativas e situações (PNCP, retrato de `geradoEm`) | O casamento item × produto (pré-filtro por termos do catálogo sintético) |
| `estado-exemplo.json` | `scripts/estado-exemplo.ts` (Dev 2) | Identificação do pregão e texto dos itens usados | Decisões, catálogo e exigência documental ilustrativa (marcados no próprio arquivo) |
| `gold.json` | Rotulado manualmente | Textos de editais e itens reais | Fichas técnicas (escritas para produzir cada veredito) e os rótulos, que são julgamento da equipe |
| `coverage.json`, `coded-items.json` | Coleta de 07/11 | Pregões e itens reais do PNCP | — |
| `search_mh.json`, `preco_631440.json`, `preco_632751.json` | Respostas reais das APIs | Tudo | — |
| `afe.pdf` | Documento público baixado | Tudo (usado só para testar a extração de texto) | — |

**Regra:** número de produto, preço ou decisão que vem de `company.json` é sintético e nunca deve ser apresentado
como dado de uma empresa real.
