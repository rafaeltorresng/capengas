# Entrada da demonstração — Dev 2, #25

A página inicial percorre Empresa → Produtos → Edital. É uma confirmação dos dados preparados, não cadastro de conta ou importação real.

- Empresa: nome, porte, UF, margem mínima e prazo de entrega de `fixtures/company.json`. Não acrescenta CNPJ. Empresa, catálogo e condições comerciais são identificados como simulados.
- Produtos: `catalogo-distribuidora.xlsx` é uma indicação visual de arquivo já anexado. Não há seletor de arquivo, parser ou upload. Conferir o arquivo revela os seis produtos do mesmo catálogo, com nome, marca e registro. Não altera custo, ficha, termos, cofre ou política. Registros reais são conferidos pelas ferramentas atuais da análise.
- Edital: somente `fixtures/demo.json.pregoes`, com data do retrato, órgão, UF, abertura e situação. Os itens candidatos aparecem ao expandir cada opção. Não consulta o PNCP nesta etapa; exceções `evento` e `editalIlegivel` não são opções.

## Execução

`GET /api/onboarding` entrega somente os campos necessários à tela, sem chave, custo, ficha ou política completos. `POST /api/onboarding/analisar` aceita exclusivamente `{ tenderId }`, valida a presença na lista e devolve HTTP 202 com o ID do turno.

A confirmação dispara `runAnalysisTurn` → `runAgent` no servidor integrado. O catálogo é o objeto de `company.json`, e a referência do pregão escolhido é resolvida pela seleção preparada. Ferramentas disponíveis são as de análise, sinalização de restrição e rascunho; ferramentas de envio e aprovação não são oferecidas. O código atual continua conferindo citações, cobertura, ANVISA, documentos, preço e decisão. O clique não autoriza proposta ou esclarecimento no portal.

`turnoId` é um parâmetro opcional de `runAnalysisTurn`; sem ele, a identidade continua gerada como antes. A tela abre `#/turnos/:id` e acompanha eventos reais do #30, com o cartão expandido. Resultados novos seguem para o Histórico somente quando o turno termina com decisões novas, conforme a projeção atual. Falha ou execução sem decisão fica falha/incompleta, sem substituir pela amostra pronta.

Sem chave (`AI_API_KEY`, ou os aliases já aceitos `FEATHERLESS_API_KEY`/`Api_key`), ou no modo amostra, a tela informa que a análise ao vivo está indisponível e a API devolve 503. `npm run integrado` passa a carregar `.env` pelo recurso nativo do Node; a chave permanece somente no servidor.

Um clique repetido durante a mesma análise devolve o mesmo turno. Outro edital aguarda o término (409). Um turno já ativo ou sem confirmação de término no banco também impede iniciar outro pela entrada web. Isso não altera a trava do agendador em outro processo nem substitui a coordenação geral de execuções.

## Navegação e reprodução

```bash
npm run build
LANCE_DB=out/onboarding.db npm run integrado
```

Acesse a raiz do servidor. Para conferir somente as três etapas sem modelo, `npm run demo` usa a mesma entrada e informa a indisponibilidade da análise ao vivo. O modo amostra do painel permanece identificado; não é apresentado como resultado da escolha.

Empresa e catálogo confirmados são lembrados somente na sessão do navegador para permitir “Escolher outro edital”, no Acompanhamento. A escolha seguinte volta diretamente à terceira etapa. Sem armazenamento de sessão disponível, o usuário pode confirmar novamente as duas primeiras etapas. As telas existentes continuam acessíveis por suas rotas e por “Abrir painel”; monitor e agendador não consultam esse estado de navegação.

A tela usa abertura em America/Recife e a situação do retrato preparado, sem anunciá-la como consulta atual. Somente o início da análise pode consultar fontes/modelo. Não mede concordância ou economia, e não inventa protocolo, preço ou resultado.

## Verificação

`test/onboarding.test.ts` cobre os três pregões permitidos, exclusão das exceções e de ID externo, indisponibilidade, rejeição de dados enviados pelo navegador, repetição/concorrência, ferramentas sem envio, persistência e progresso pelo agente/turno, falha e ausência de decisões novas. A interface é conferida no navegador com os dados das próprias fixtures. Execução com modelo real, quando realizada, deve ser registrada separadamente das execuções históricas já publicadas.

A verificação ao vivo foi executada pelo botão da tela no pregão `77816510000166/2026/348`, em banco temporário novo. Terminou com 46 itens carregados, três encaixes, três decisões escaladas por cobertura técnica não verificada, um dossiê e três escaladas. O Histórico exibiu os resultados da própria execução. Foram 8 chamadas, 276.510 ms e US$ 0,053452588 reportados no rastro; meta de 3 minutos não cumprida. Zero ações de envio. A medição está em `research/onboarding-2026-11-07.json`, sem alterar referências anteriores. Conferi também a interface a 390 px, sem rolagem horizontal, e o retorno à escolha com aviso de execução concorrente.

## Interface unificada e correções da revisão

A interface usa componentes Base UI, navegação lateral e as mesmas rotas de operação. O onboarding mantém os três passos e os dados das fixtures. `npm run build` usa a configuração Vite da raiz; `npm run typecheck` confere servidor e interface, incluindo `tsconfig.web.json`.

As quatro regressões identificadas na revisão foram corrigidas: o botão de decisão envia o formulário explicitamente; o rastro permite expandir entrada e saída; selecionar uma página fecha o menu móvel, inclusive ao selecionar a página atual; e os botões do calendário recebem a referência necessária para mover o foco pelo teclado.

Verificação desta revisão: 459 testes passaram, tipagem completa, build e conferência do diff passaram. No navegador, a aprovação foi registrada no store de amostra em memória e apareceu na linha do tempo com entrada e saída visíveis no rastro. O calendário foi conferido antes e depois da correção com turnos sintéticos temporários em três datas: a seta passou a mover o foco e Enter selecionou a data e filtrou os turnos. Esses turnos de teste não foram acrescentados às fixtures nem ao banco. A navegação móvel fechou o menu após escolher outra página e a página atual. Os três passos do onboarding foram conferidos, com seis produtos, três editais preparados, ausência de seletor de arquivo e aviso de análise indisponível no modo amostra; a 390 px, sem rolagem horizontal. Esta revisão não executou o modelo nem acrescentou medição de custo, latência ou concordância. O build emite aviso de tamanho do pacote JavaScript.
