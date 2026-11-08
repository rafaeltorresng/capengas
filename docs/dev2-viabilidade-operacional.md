# Condições para fornecer — Dev 2

## Problema e corte

Base inicial: merge #34 (`122a8b5`), atualizada para a auditoria #35 (`6912ffe`) durante o desenvolvimento. Foram preservados os candidatos não analisados no veredito/PDF, a escalada de encaixe sem decisão, os motivos de interrupção e as correções de cobertura e marca. Antes, `prazoEntregaDias` servia para estimar a vigência ANVISA, sem confrontar a obrigação operacional publicada com a capacidade declarada. Esta mudança acrescenta entrega, forma/local do fornecimento, amostra, validade dos produtos e pagamento ao mesmo fluxo, sem tela nova ou nova fonte de dados.

O cadastro e catálogo continuam os de `company.json`. Os 60 dias existentes não informam unidade nem marco de contagem; a implementação não os inventa. Empresa, catálogo, custos, cofre e política continuam sintéticos. As cláusulas dependem do edital selecionado, sem dados de outro pregão ou preenchimento por exemplo pronto.

## Fluxo

1. `read_edital` conserva os até doze trechos técnicos existentes e passa a devolver nomes dos arquivos. A leitura continua limitada aos arquivos que esse fluxo realmente consultou; não se declara cobertura de todos os anexos. A pré-leitura operacional acontece na etapa específica, sem ocupar o espaço dos trechos técnicos.
2. `read_operational_excerpt` amplia o contexto de um arquivo já aberto, sem nova chamada de rede. `record_operational_condition` recebe somente campo, arquivo, citação e item opcional. Não recebe prazo, preço ou conclusão do modelo. A pré-leitura prioriza cláusulas operacionais e distribui o espaço entre os campos; rodapé de assinatura e validade de ata/proposta não viram validade de produto.
3. `runAgentWithOperationalReview` conclui o fluxo técnico e executa uma etapa separada com somente a ferramenta de registro, até duas chamadas ao modelo por pregão e até 25 mil tokens dentro do saldo do limite original. Assim a revisão não vira outro ciclo de buscas. Falha ou limite mantém a ressalva e não apaga o resultado técnico; custo não informado pelo provedor permanece desconhecido. Rastro e uso das duas etapas são reunidos. Os tetos acumulados de tokens são conferidos após as respostas pelo loop existente; não representam um teto monetário rígido.
4. `registrarCondicao` verifica arquivo, citação literal, assunto e escopo. Duplicatas exatas não acumulam. Referência explícita a item exige escopo; lote não é tratado como número de item. Validade de proposta não é validade de produto.
5. O código compara entrega somente com um prazo explícito em dias úteis/corridos, recebimento da ordem de fornecimento, nota de empenho ou pedido, e bases iguais no cadastro. Vários prazos, divergências, exceções e bases ausentes ficam para confirmação. Não calcula data de entrega pela abertura da sessão e não prevê data de pagamento.
6. Fonte, texto consultado, cláusulas, perfil usado e avaliação são persistidos no dossiê. Cadastro e comparação são os da análise, não uma confirmação de estoque ou de logística atual.
7. Na finalização, conflito ou obrigação citada que exija confirmação rebaixa `disputar` para `disputar_com_pendencia`; preço e quantidade não mudam. Quando a revisão termina sem registrar uma cláusula, o campo fica como aviso de cobertura, sem rebaixar a decisão e sem afirmar dispensa. Revisão não executada, falha ou inconclusiva mantém a ressalva de autonomia. A ressalva é reavaliada sobre a base técnica, sem remover pendência ANVISA/documental. Item recusado não é promovido.
8. O resultado e o dossiê exibem cinco seções recolhidas com estado, escopo, explicação, fonte e responsável (analista). O veredito e as pendências refletem as ressalvas. Relatório inclui as cláusulas; minuta avisa sobre a revisão operacional pendente.

Ausência de cláusula significa **não identificada na análise**, nunca dispensa. Dispensa explícita e sem ressalva, para amostra/validade mínima, pode ser registrada como informação. Amostra exigida e validade de lote precisam de confirmação porque o cadastro não contém essas capacidades. Fornecimento e pagamento são condições informativas: não afirmam capacidade financeira, recebimento efetivo ou execução contratual.

## Decisão e envio

O módulo operacional é habilitado nos turnos de análise, inclusive onboarding, agendador e roteiros de análise. As duas ferramentas também estão disponíveis nas listas desses pontos de entrada. O modelo localiza as evidências, mas as comparações e a ressalva são código.

A política existente bloqueia `disputar_com_pendencia`; não se criou caminho alternativo de envio. Aprovar uma escalada registra a ação humana, mas não muda prazo, evidência ou decisão e não libera a proposta automaticamente. Pendência técnica já aberta não esconde uma nova ressalva operacional. Abertura desconhecida não recebe prazo operacional inventado; as condições continuam no dossiê.

A revisão registra estado e motivo próprios: concluída, não executada, inconclusiva ou falhou. Avaliações legadas sem esse registro ficam com conclusão desconhecida; não se inventa que foram ou não executadas. Sem candidatos, ferramenta ou orçamento, ou com análise técnica interrompida, não se afirma que o agente procurou uma cláusula e não encontrou. Citações aceitas antes de interrupção continuam visíveis.

Dossiês anteriores sem avaliação operacional continuam sem ela, identificados na interface e no relatório. Avaliação antiga sem estado da revisão aparece como conclusão não registrada. Não se migra um documento antigo para uma confirmação nunca executada. Atualidade da publicação e retificação mantêm seus estados próprios e seus bloqueios.

## Verificação

Na revisão final foram corrigidos três casos com teste de regressão: a etapa operacional preserva os doze trechos técnicos de `read_edital`; prazo fracionário/faixa não vira um inteiro nem solicitação de pedido vira recebimento; dispensa temporal ou contraposta a outra obrigação exige confirmação. A tela identifica o início da revisão antes de aguardar o modelo.

Os casos em `test/operacao*.test.ts` são sintéticos, com fonte/modelo controlados quando indicado. Cobrem literalidade, assunto, arquivo, escopo por item, unidade e marco, cláusulas ambíguas/divergentes, ausência, dispensa, preservação de preço e pendência técnica, omissão do agente, onboarding, persistência, API, PDF, escalada anterior e a porta de envio sem POST.

Na publicação inicial (`e93117b`), passaram 539 testes no ambiente local e 538 em worktree limpa. A diferença foi reproduzida: `test/catalogo.test.ts` só executa a conferência dos produtos contra a base oficial quando `data/anvisa.csv` existe. Não é um teste perdido nem uma medição de qualidade do modelo. Na revisão, a main `10df50e` trouxe as interfaces do #36 (já com limites de 30 passos/250 mil tokens restaurados) e a geração documental do #37. A integração conserva esses fluxos.

A decisão de produto foi confirmada neste chat: simplificar a demonstração mantendo ausências como avisos após revisão concluída e conservar o cadastro fictício atual, sem inventar unidade ou marco para seus 60 dias. Assim, quando uma cláusula de entrega exige comparação, o cadastro atual ainda pode exigir confirmação humana; não se promete envio automático nesse caso. O auditor passa a detectar ressalva operacional sem correspondência no dossiê, na lista de pendências ou no conteúdo do relatório PDF. Foram acrescentadas regressões para omissão, interrupção, falha e revisão concluída sem cláusula de validade.

Após os ajustes do review: 553 testes passaram no ambiente com base ANVISA local, além de `npm run typecheck` (servidor e interface) e `npm run build`. A interface integrada e a exportação do relatório legado foram conferidas: a conclusão ausente é explicitada, o cadastro permanece com 60 dias sem bases presumidas e as cinco páginas renderizadas preservam fontes e ressalvas. O build mantém o aviso de pacote principal acima de 500 kB. Não foi executado novo turno com modelo pago nesta revisão.

Não há ganho de tempo, economia ou concordância humana medidos por esses testes. A primeira tentativa com modelo real atingiu o limite local de 60 segundos sem resposta. As tentativas seguintes mostraram leituras excessivas, rodapés como candidatos e citações recusadas; motivaram a pré-leitura dirigida e a etapa separada. Uma tentativa encerrada pelo modelo sem registros não conta como extração completa.

A última validação real, limitada à extração operacional sobre os PDFs em cache do pregão `77816510000166/2026/348`, terminou com cinco citações aceitas em quatro campos: entrega (duas), fornecimento, amostra e pagamento. Validade de produto não identificada. Entrega e amostra continuam para confirmação, e a publicação continua não confirmada. Foram duas chamadas, 118.695 ms, 7.704 tokens de entrada, 4.774 de saída e US$ 0,020694528. Zero envios. A etapa operacional usa limite de saída de 8.192 tokens, como nessa validação; a análise técnica conserva sua configuração anterior. O limite de rodadas operacionais é dois. O encaixe técnico foi preservado da execução anterior; isso não é um turno completo novo nem uma medição estatística. Tentativas e limites separados em `research/operacao-2026-11-08.json`.
