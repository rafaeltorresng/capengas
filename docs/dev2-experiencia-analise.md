# Experiência da análise e documentos — Dev 2, #25

## Panorama conferido

Base: main `aa4c64c`, com #31 (onboarding e Base UI), #32 (regras e documento de proposta) e #33 (plano documental) integrados. A aplicação usa Node 24 ESM, SQLite, agente com ferramentas, API HTTP e React/Vite/Base UI. Não há login nem envio real ao Compras.gov.br.

O #32 acrescentou leitura das regras citadas e geração determinística de Markdown, com ferramentas usadas pelo roteiro `scripts/turno.ts`. Não persistia a proposta nem a oferecia na API. O #33 acrescentou o plano documental no dossiê, condicionado à existência de item viável. As ferramentas de ambos ainda não estavam no agente iniciado pelo onboarding. Essa desconexão foi fechada nesta mudança.

Empresa, catálogo, fichas, custos, cofre e política continuam sendo os dados fictícios existentes; o cadastro declara `origemDados: sinteticos`. Conforme esclarecido pelo usuário, a análise, as exigências, os prazos, os documentos e o veredito precisam ser específicos do edital escolhido, com as fontes efetivamente consultadas. Não há resultado pronto usado como substituto da execução.

## Navegação e avaliação das telas

- **Editais:** reúne acompanhamento e histórico. A lista mostra a execução mais recente por edital, busca, data e acesso às execuções anteriores. Após a escolha, a página da análise continua até o resultado.
- **Pendências:** reúne decisões humanas e prazos/alertas acionáveis. Formulários ficam recolhidos até a pessoa escolher a pendência.
- **Pauta:** tem valor operacional concreto (prazo legal, retificação, cofre e sanções), mas não precisa de uma entrada concorrente na navegação. Suas ações aparecem no próprio edital e na área de pendências. A rota completa continua disponível para consulta.
- **Hoje:** é um registro de atividade e contadores, não o ponto de partida de uma decisão sobre um edital. Fica em Informações da execução.
- **Prova:** é diagnóstico e medição para equipe/apresentação, não uma tarefa diária do cliente. Fica em Informações da execução. Não se acrescentou percentual de acerto ou concordância.
- **Fila, item e dossiê:** continuam acessíveis como consultas detalhadas, sem exigir que o usuário percorra essas páginas para descobrir o resultado ou baixar um documento.

## Acompanhamento

`src/lib/experiencia-analise.ts` agrupa eventos em quatro áreas: conhecer o edital, conferir os produtos, avaliar a participação e preparar os documentos. Repetições continuam no rastro, mas não criam etapas primárias duplicadas. Somente uma área aparece em andamento, inclusive quando o agente volta a consultar uma fonte anterior. Falha, falta de atualização e execução incompleta não mantêm um indicador de processamento ativo.

Os novos eventos guardam também o nome da ferramenta; eventos anteriores usam o rótulo já registrado. O salvamento e a conferência final da publicação têm atividades próprias, para que espera por fonte não seja apresentada como raciocínio do modelo. Não há porcentagem fictícia, estimativa de término ou indicador que avance por temporizador. Animações são discretas e respeitam redução de movimento.

O evento de conclusão conserva o resultado por edital, incluindo o código da decisão, permitindo consultar aquela execução sem reconstruir o veredito a partir de texto livre. O histórico continua publicando somente turnos concluídos. Na mesma página aparecem Resultado, Documentos e Evidências; as atividades permanecem consultáveis depois do término.

## Veredito e integridade

O veredito usa `estadoCodigo`, não o resumo livre do modelo nem os rótulos visuais. Distingue disputar, participar com pendência, revisão e não disputar. Declara quantos itens foram analisados, sem sugerir cobertura de todos os itens do pregão. Documento indisponível ou conclusão antiga não vira resultado positivo.

O dossiê guarda `analiseId`, proposta, entradas da proposta, regras citadas e data. A projeção compara decisões, produto, quantidade e descrição atuais com a análise salva. Divergência invalida a proposta anterior sem afirmar que houve retificação publicada. A marca `reavaliar` continua identificando a necessidade já registrada pelo monitor. A atualidade da publicação é apresentada separadamente; falha de conferência não libera o envio nem é escondida pela conclusão técnica.

A prévia e o PDF aplicam o modelo de apresentação atual às entradas persistidas, sem refazer decisões, chamar o modelo ou substituir o artefato original no banco. O ID da análise no pedido impede baixar documentos de outra execução silenciosamente.

## Documentos e PDF

O onboarding oferece as seis ferramentas documentais existentes. Elas mantêm a exigência de item em `disputar` ou `disputar_com_pendencia`. Preço, quantidade e produto vêm do resultado do código. A proposta é persistida com o dossiê; o modelo não escreve preço ou quantidade no documento.

- `GET /api/dossies/:tender/relatorio.pdf?analise=:id`: relatório dos itens analisados, decisão, motivos, citações, plano, responsáveis, fontes e limitações.
- `GET /api/dossies/:tender/proposta.pdf?analise=:id`: minuta de proposta para revisão e assinatura. Recusa proposta ausente, incompatível com as decisões/itens, de outra análise, em execução não concluída ou marcada para reavaliar. Não recebe preço ou cadastro no pedido.

O relatório preserva a conferência interna e as fontes completas; a minuta não inclui o checklist interno como parte da proposta. A origem fictícia do cadastro, campos faltantes, ausência de assinatura e de envio ficam explícitos. A cidade do órgão não é usada como local da assinatura da empresa. Falta de regra extraída é descrita como **não identificada na análise**, não como inexistência da obrigação no edital.

Números de resumos precisam aparecer na citação; endereço de e-mail não citado é recusado. Casas decimais são extraídas da citação, e prazo e condições documentais não podem ser substituídos por argumentos do modelo. Citações e julgamento semântico continuam coisas distintas: localizar o trecho não prova toda a interpretação.

Os PDFs são gerados no servidor com PDFKit e texto/componentes, sem executar HTML. Tabelas têm colunas proporcionais e cabeçalho por página; célula maior que a página vira bloco rotulado, preservando o conteúdo. Fontes DejaVu Sans são incorporadas para acentos, letras gregas e símbolos técnicos; licença em `src/server/fonts/LICENSE`. Arquivo oficial 2.37 conferido pelo SHA-256 publicado em https://dejavu-fonts.github.io/Download.html.

O plano pode indicar outros documentos a providenciar. Isso não significa que o Lance fabricou certidões, comprovou cobertura de modelo ou produziu declarações assinadas. O envio continua no portal de testes, fora deste fluxo de análise e download.

## Verificação

Baseline: 492 testes; verificação final: 502 passando, tipagem do servidor e da interface e build concluídos. O build mantém avisos de diretivas de dependências e tamanho do pacote principal (664,77 kB antes da compressão); divisão de código não entrou neste corte. Novos testes cobrem grupos de progresso, estados finais/sem atualização, veredito parcial, persistência de documentos pelo onboarding, exportação HTTP, versão da execução, bloqueios, número/e-mail não citado, prazo/condições e paginação extensa. Testes com modelo controlado são casos unitários sintéticos, não resultados apresentados ao usuário.

Uma execução real foi iniciada pelo botão para `77816510000166/2026/348`, em banco temporário novo: item 4 com pendência de cobertura ANVISA e item 39 não recomendado; minuta com o item 4, quatro regras da proposta e plano de onze documentos. A leitura final dos arquivos no PNCP terminou em timeout; a interface e os PDFs avisam que a atualidade não está confirmada. Zero ações de envio. A execução está registrada separadamente em `research/experiencia-analise-2026-11-08.json`; não substitui medições anteriores. Os últimos ajustes de validação de regras e apresentação foram verificados por testes e pelos downloads sobre os dados persistidos dessa execução, sem outro turno pago.

Conferido no navegador: escolha → quatro grupos de atividade → resultado por item → revisão de documentos → dois downloads reais, além da prévia e navegação móvel. A 390 px, resultado e prévia não provocaram rolagem horizontal da página. PDFs renderizados e conferidos visualmente; o teste extenso preservou os doze marcadores finais de conteúdo, inclusive na célula maior que a página. Concordância humana e economia continuam sem medição. A execução real levou mais de três minutos; não houve demonstração de ganho de velocidade.

## Reprodução

```bash
npm ci
npm test
npm run typecheck
npm run build
LANCE_DB=out/analise.db npm run integrado
```

O modo integrado carrega `.env` no servidor, sem expor a chave. Para o fluxo ao vivo, configure a chave e escolha um edital pelo onboarding. O modo amostra continua identificado e não oferece PDFs como se fossem resultados reais. Para apresentar um resultado já concluído, use o banco daquela execução; não substitua por decisões montadas à mão. A coordenação atômica entre agendador e servidor em processos distintos continua sendo uma pendência já registrada na #25.
