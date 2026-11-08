# Lance

O Lance é um agente de licitações para distribuidoras de material médico-hospitalar. Ele cruza editais públicos com o catálogo da empresa, recomenda o que fazer por item e prepara um dossiê com evidências e documentos para revisão. Projeto da equipe Capengas para o Converge Challenge 2026, no Recife.

## Rodar e usar

Instale **Node.js 24+** e **Poppler**. Para a análise integrada, confirme que `pdftotext -v` funciona no mesmo terminal que vai iniciar o servidor. No macOS, use `brew install poppler`. No Windows, adicione a pasta dos executáveis do Poppler ao `PATH`.

```bash
npm ci
npm run setup         # baixa e indexa as bases locais da ANVISA e do CATMAT
cp .env.example .env  # no PowerShell: Copy-Item .env.example .env
```

Preencha `AI_API_KEY` no `.env`. Você pode selecionar um modelo da Featherless com `LANCE_MODEL`. Mantenha o `.env` fora do Git.

```bash
npm run build
npm run integrado
```

Abra [http://127.0.0.1:8080](http://127.0.0.1:8080). Use `LANCE_PORT` se precisar de outra porta. O banco padrão é `data/lance.db`. Use `LANCE_DB` para indicar outro arquivo.

Para explorar a interface com dados de amostra, rode `npm ci`, `npm run build` e `npm run demo`. Esse modo dispensa a chave e não executa análise ao vivo.

1. **Empresa e Produtos.** Confira o perfil simulado e selecione um ou mais catálogos de demonstração. A seleção define quais produtos o agente vai considerar. Os arquivos de catálogo representam planilhas prontas da demo.
2. **Edital.** Escolha uma oportunidade aberta relacionada à seleção e inicie a análise. O pré-filtro encontra candidatos por termos do catálogo. A compatibilidade só é avaliada depois, na análise por item.
3. **Acompanhamento.** Veja as etapas conforme o servidor as registra. Você pode sair da tela e voltar pelo menu **Editais**. Quando o turno terminar, abra a execução para conferir o resultado.
4. **Resultado, Documentos e Evidências.** Confira a recomendação e o motivo de cada item, as condições para fornecer e as fontes citadas. Abra **Documentos** para revisar a minuta, o plano de documentos e as pendências antes de baixar os arquivos.
5. **Pendências.** Abra **Decisões** para revisar exceções que exigem uma decisão humana, e **Prazos e alertas** para acompanhar os avisos da operação.

A análise ao vivo usa editais públicos reais e um perfil de demonstração com catálogo, fichas, custos, cofre e política sintéticos. O fluxo iniciado pela interface termina em análise e preparação de documentos. O agendador é um fluxo separado, com fase de ações em sandbox.

Para demonstrar a retomada pela tela **Pendências**, inicie o modo integrado com `LANCE_DEMO_RETOMADA=1` e um banco de demonstração. Ao registrar uma decisão, a interface volta ao acompanhamento. Quando as decisões do edital terminam, o agente simulado confirma os itens aprovados ou ajustados que têm produto, quantidade e preço, e o Lance monta a minuta para download em **Documentos**. Recusas excluem o item. A minuta identifica a simulação e fica bloqueada para envio.

## Como o agente trabalha

1. **Reúne as fontes.** O agente consulta os itens do pregão e as fichas dos produtos selecionados. O servidor baixa os anexos do edital e extrai o texto dos PDFs com `pdftotext`, para que o agente possa buscar e citar trechos.
2. **Registra o encaixe.** O modelo compara os atributos da ficha com as exigências do item. As ferramentas conferem se as citações estão nas fontes e se os campos do item foram cobertos. Informação ausente fica registrada como lacuna.
3. **Calcula a decisão.** O agente chama uma ferramenta que aplica as regras de encaixe, registro ANVISA, preço com margem, documentos do cofre e prazo de esclarecimento. O resultado pode ser **Disputar**, **Disputar com pendência**, **Não disputar**, **Em esclarecimento** ou revisão humana. Nos casos elegíveis, o agente prepara a minuta de esclarecimento.
4. **Prepara os documentos.** Para itens viáveis, o agente consulta os anexos da proposta e registra as regras de preenchimento e exigências de habilitação com suas fontes. O Lance monta a minuta de preços e o plano de documentos. O plano separa o que o Lance pode gerar, o que deve ser declarado no portal, o que vem do cofre e o que depende da equipe ou de terceiros.
5. **Revisa e persiste.** Uma revisão curta busca condições de entrega, fornecimento, amostra, validade e pagamento nos trechos consultados. O servidor registra as ressalvas, salva o dossiê e tenta confirmar a publicação do edital no PNCP. A interface mostra o resultado persistido e sinaliza análises incompletas ou que exigem reavaliação.

O modelo interpreta e cita as fontes. As ferramentas validam a evidência e aplicam as regras da empresa. O histórico da execução permite distinguir uma incompatibilidade técnica de uma falta de evidência, uma pendência documental ou uma análise que encerrou sem decisão.

## Interface

| Tela | O que você pode fazer |
|---|---|
| **Empresa → Produtos → Edital** | Confirmar o perfil, combinar catálogos, filtrar oportunidades e iniciar uma análise. O feed informa a data da consulta e sinaliza quando a atualização é parcial. |
| **Editais** | Consultar o histórico de execuções e abrir o acompanhamento de um turno ou sua análise concluída. |
| **Análise · Resultado** | Ler o veredito por item, os motivos da decisão e as condições de fornecimento. |
| **Análise · Documentos** | Conferir a minuta e o plano por fase. Quando houver arquivo gerado, baixar a proposta e as declarações disponíveis em PDF. |
| **Análise · Evidências** | Abrir as fontes do edital, conferir trechos e consultar os detalhes do dossiê. |
| **Pendências** | Revisar decisões encaminhadas à equipe e acompanhar prazos e alertas. |
| **Atividade do dia, Agenda completa e Todos os itens** | Ver a operação diária, os próximos prazos e os itens analisados. |
| **Item, Dossiê e Histórico** | Inspecionar uma decisão, consultar documentos e exigências e acompanhar o rastro da execução. |
| **Medições e avaliações** | Abrir a área de prova, com as evidências e métricas disponíveis na instância. |

No resultado da análise integrada, **Baixar análise em PDF** exporta o relatório. Para testar a geração completa, escolha uma análise concluída com item viável e confira **Documentos**. **Baixar minuta em PDF** aparece quando há uma proposta disponível, e **Baixar declaração em PDF** aparece nas linhas com arquivo gerado. Se o edital ou os dados mudarem, o Lance pede uma nova análise para liberar novamente a proposta e as declarações.

## APIs e dados

| Integração | Como o Lance usa |
|---|---|
| **PNCP** | A busca pública encontra oportunidades. As consultas de compras, itens e arquivos trazem a publicação, as especificações, o preço estimado e os anexos. O Lance usa uma consulta sem cache para conferir se a publicação continua atual. [Cliente PNCP](src/lib/data.ts) |
| **Dados Abertos do Compras.gov.br** | Consulta o histórico de preços por código CATMAT, quando disponível, e fornece o catálogo de materiais usado na busca local de códigos. [Cliente de preços](src/lib/data.ts) · [Importação CATMAT](scripts/catmat-download.ts) |
| **Dados Abertos da ANVISA** | O setup baixa a base oficial de produtos para saúde e cria um índice SQLite. A análise verifica o cadastro local do registro. A vigência do registro, por si só, não comprova que ele cobre o modelo ofertado. [Setup das bases](scripts/setup.ts) |
| **Featherless** | A API de chat compatível com OpenAI recebe mensagens e esquemas de ferramentas. O servidor executa as chamadas de ferramenta do modelo e devolve os resultados para a próxima etapa. [Cliente do modelo](src/lib/llm.ts) · [Ciclo do agente](src/lib/agent.ts) |

O frontend em **React e Vite** chama a API HTTP do próprio Lance. `GET /api/onboarding` apresenta o perfil e os catálogos, `GET /api/onboarding/editais` lista oportunidades por catálogo e `POST /api/onboarding/analisar` inicia um turno. A interface acompanha o progresso em `GET /api/turnos` e consulta o dossiê em `GET /api/dossies/:id`. O servidor gera os PDFs a partir da análise persistida, nas rotas `proposta.pdf`, `relatorio.pdf` e `documento-:indice.pdf` do dossiê. [Rotas da API](src/server/api.ts)

## Documentos

| Documento | Conteúdo |
|---|---|
| [docs/lance-pesquisa.md](docs/lance-pesquisa.md) | Dossiê de pesquisa: problema, números com fonte, público-alvo, concorrência, dados disponíveis, validação técnica, hipóteses descartadas e escopo inicial |
| [docs/lance-produto.md](docs/lance-produto.md) | Documento do produto: visão, funcionalidades do MVP, política, telas, arquitetura, métricas e roteiro |
| [docs/lance-plano-fixo.md](docs/lance-plano-fixo.md) | Plano final aprovado: escopo, demo, riscos e ordem de corte |
| [docs/lance-execucao.md](docs/lance-execucao.md) | Plano de execução para 3 devs: contratos, tarefas, cronograma e portões |
| [docs/dev2-analise-produto.md](docs/dev2-analise-produto.md) | Revisão de produto, concorrência, limites das evidências e prioridades do agente |
| [docs/dev2-retificacao-persistida.md](docs/dev2-retificacao-persistida.md) | Monitor → diff único → histórico do dossiê → Pauta, migração e reprodução sintética |
| [docs/dev2-catalogos-feed.md](docs/dev2-catalogos-feed.md) | Catálogos combináveis, feed público atualizado e seleção preservada na análise |
| [docs/dev2-onboarding-demo.md](docs/dev2-onboarding-demo.md) | Entrada Empresa → Produtos → Edital, análise real e limites da demonstração |
| [docs/dev2-experiencia-analise.md](docs/dev2-experiencia-analise.md) | Editais e Pendências, acompanhamento agrupado, veredito por item e documentos em PDF |
| [docs/dev2-viabilidade-operacional.md](docs/dev2-viabilidade-operacional.md) | Condições para fornecer: entrega, fornecimento, amostra, validade e pagamento, com citações e ressalvas |
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

## Desenvolvimento e validação

```bash
npm test             # testes unitários (sem rede)
npm run typecheck    # checa os tipos do servidor e do frontend
npm run test:live    # testes contra as APIs reais (PNCP, Compras.gov.br, ANVISA)
npm run smoke        # confere a chave e o tool calling do modelo
npm run turno        # turno ponta a ponta em 3 pregões reais (usa o modelo; ~US$ 0,20)
npm run evals        # evals do modelo com gabarito (~US$ 0,80)
node scripts/estado-exemplo.ts # gera a amostra identificada para integrar a tela, sem rede ou modelo
npm run errata:sintetica  # caso da quantidade com versão persistida (#25) num banco importado; ver o cabeçalho do script
```

| Pasta | Conteúdo |
|---|---|
| `web/` | Interface React, navegação, acompanhamento, evidências e exportação |
| `src/server/` | API HTTP, entrada da análise integrada e geração de PDFs |
| `src/lib/` | Núcleo: HTTP resiliente, dados públicos, regras, agente, modelo, ferramentas, sandbox |
| `test/` | Testes unitários · `test/live/`: testes com rede |
| `fixtures/` | Empresa fictícia (catálogo, cofre), gabarito dos evals, respostas reais de APIs |
| `scripts/` | Setup, turno, evals · `scripts/pesquisa/`: scripts que geraram os números da pesquisa |
| `cache/`, `data/`, `out/` | Gerados localmente; fora do Git |
