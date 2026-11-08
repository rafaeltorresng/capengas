# fixtures/: o que é real e o que é sintético

| Arquivo | Origem | O que é real | O que é sintético |
|---|---|---|---|
| `company.json` | Montado pela equipe | **Números de registro ANVISA** dos produtos (base aberta TA_PRODUTO_SAUDE_SITE) | Empresa, catálogo (nomes, marcas, fichas técnicas, custos), cofre de documentos, política e termos de busca |
| `catalogos.json` | Biblioteca ampliada da demonstração | Marca e registro dos produtos adicionais conferidos na base oficial ANVISA local de 07/11/2026 | Arquivos visuais, oferta comercial, modelos declarados, fichas, custos e termos; cobertura de modelo não é certificada pelo registro |
| `oportunidades.json` | Consultas públicas às APIs do PNCP | Pregões, itens, metadados e datas; a consulta efetiva acompanha cada registro. Retrato parcial, com falhas preservadas | O pré-filtro relaciona itens reais aos produtos da empresa fictícia; não é decisão de encaixe |
| `demo.json` | `scripts/preparar-demo.ts` | Pregões, órgãos, datas, itens, estimativas e situações (PNCP, retrato de `geradoEm`) | O casamento item × produto (pré-filtro por termos do catálogo sintético) |
| `estado-exemplo.json` | `scripts/estado-exemplo.ts` (Dev 2) | Identificação do pregão e texto dos itens usados | Decisões, catálogo e exigência documental ilustrativa (marcados no próprio arquivo) |
| `gold.json` | Rotulado manualmente | Textos de editais e itens reais | Fichas técnicas (escritas para produzir cada veredito) e os rótulos, que são julgamento da equipe |
| `coverage.json`, `coded-items.json` | Coleta de 07/11 | Pregões e itens reais do PNCP | — |
| `search_mh.json`, `preco_631440.json`, `preco_632751.json` | Respostas reais das APIs | Tudo | — |
| `afe.pdf` | Documento público baixado | Tudo (usado só para testar a extração de texto) | — |

**Errata da fase 1 (#25).** `scripts/errata-sintetica.ts` aplica a um pregão real já analisado uma errata
**sintética** que só muda a quantidade de um item. O diff, a versão persistida do dossiê e cada linha da pauta identificam a origem sintética; as linhas da pauta saem com `sintetico: true`, e a tela
mostra "Errata sintética de teste". Isso existe porque a busca de 07/11 não achou uma retificação real com impacto
conhecido. Não apresentar como retificação acontecida no PNCP.

**Regra:** número de produto, preço ou decisão que vem de `company.json` é sintético e nunca deve ser apresentado
como dado de uma empresa real.
