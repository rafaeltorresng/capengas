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
| [docs/dev2-analise-produto.md](docs/dev2-analise-produto.md) | Revisão de produto, concorrência, limites das evidências e prioridades do agente |
| [docs/dev2-retificacao-persistida.md](docs/dev2-retificacao-persistida.md) | Monitor → diff único → histórico do dossiê → Pauta, migração e reprodução sintética |
| [docs/dev2-onboarding-demo.md](docs/dev2-onboarding-demo.md) | Entrada Empresa → Produtos → Edital, análise real e limites da demonstração |
| [docs/dev2-experiencia-analise.md](docs/dev2-experiencia-analise.md) | Editais e Pendências, acompanhamento agrupado, veredito por item e documentos em PDF |
| [docs/dev2-integracao.md](docs/dev2-integracao.md) | Contrato do dossiê e da projeção para a tela, amostra e verificação da integração |

## Números principais

| Fato | Número |
|---|---|
| Pregões de saúde abertos (07/11) | 1.647, somando ≥ R$ 3,8 bi |
| Itens de saúde que fracassam no Compras.gov.br | 16–21%, contra 4,6% em material de escritório |
| Distribuidoras de material médico cadastradas para vender ao governo | 5.513 (145 com sanção vigente) |
| Acerto do modelo no encaixe técnico (evals) | 18 de 18 (6 pares × 3 repetições, fichas sintéticas) |
| Custo de um turno real (3 pregões, 15 itens) | US$ 0,22 |

Fontes e metodologia em [docs/lance-pesquisa.md](docs/lance-pesquisa.md); medições próprias agregadas em [research/](research/README.md). O que é real e o que é sintético nas fixtures: [fixtures/README.md](fixtures/README.md).

## Como rodar

Requer **Node 24+** e **pdftotext** (`brew install poppler` no macOS). A tela usa React e Vite; instale as dependências com `npm ci`.

```bash
npm run setup        # baixa a base da ANVISA (~28 MB) e o CATMAT de saúde; monta os bancos locais
cp .env.example .env # preencha AI_API_KEY com a chave da Featherless
npm test             # testes unitários (sem rede)
npm run test:live    # testes contra as APIs reais (PNCP, Compras.gov.br, ANVISA)
npm run smoke        # confere a chave e o tool calling do modelo
npm run turno        # turno ponta a ponta em 3 pregões reais (usa o modelo; ~US$ 0,20)
npm run evals        # evals do modelo com gabarito (~US$ 0,80)
node scripts/estado-exemplo.ts # gera a amostra identificada para integrar a tela, sem rede ou modelo
npm run errata:sintetica  # caso da quantidade com versão persistida (#25) num banco importado; ver o cabeçalho do script
```

| Pasta | Conteúdo |
|---|---|
| `src/lib/` | Núcleo: HTTP resiliente, dados públicos, regras, agente, modelo, ferramentas, sandbox |
| `test/` | Testes unitários · `test/live/`: testes com rede |
| `fixtures/` | Empresa fictícia (catálogo, cofre), gabarito dos evals, respostas reais de APIs |
| `scripts/` | Setup, turno, evals · `scripts/pesquisa/`: scripts que geraram os números da pesquisa |
| `cache/`, `data/`, `out/` | Gerados localmente; fora do Git |

## Experimentar a demonstração

```bash
npm run build
npm run integrado
```

Abra a raiz do servidor para confirmar a empresa simulada, conferir o catálogo já anexado e escolher um dos editais preparados. O botão inicia uma análise real no banco configurado por `LANCE_DB` (padrão `data/lance.db`); o modo integrado carrega `.env`. Sem chave do modelo, a análise fica indisponível. A escolha não executa envio ao portal.

`npm run demo` permite percorrer os mesmos três passos sem modelo; o painel de amostra continua identificado. Não há upload de planilha. Detalhes e verificação em [docs/dev2-onboarding-demo.md](docs/dev2-onboarding-demo.md).

## Segredos

A chave do modelo (Featherless) fica em `.env`, que está no `.gitignore`. Nunca a versione.
