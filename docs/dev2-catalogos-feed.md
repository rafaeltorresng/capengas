# Catálogos selecionáveis e oportunidades públicas — Dev 2

## Corte e origem

O onboarding passa de um arquivo visual com seis produtos e três pregões preparados para quatro arquivos combináveis, treze produtos e um feed público filtrado pela seleção. Os seis produtos de `company.json` permanecem intactos. Sete ofertas sintéticas adicionais estão em `fixtures/catalogos.json`; marca e registro foram conferidos na base ANVISA local de 07/11/2026. Isso não comprova a cobertura do modelo ofertado. Fichas, custos e condições comerciais são sintéticos, e nenhum produto foi declarado compatível para assegurar um resultado positivo.

`fixtures/oportunidades.json` contém **12 pregões reais**, obtidos em consultas às APIs do PNCP. Identificação, objeto, itens, quantidades, situações e datas são públicos; relações com o catálogo são apenas candidatos por termos. O alvo de 15–25 oportunidades não foi artificialmente completado: as consultas tiveram falhas e HTTP 429. O retrato está identificado como parcial, com a consulta efetiva de cada pregão e sem uma data inventada de sincronização completa. O serviço pode descobrir outras oportunidades dentro dos limites abaixo.

## Seleção e análise

- `catalogos-demo.ts` reúne os seis produtos originais e as ofertas adicionais numa biblioteca canônica. Arquivos agrupam identificadores, e produtos repetidos em vários arquivos não se duplicam.
- O servidor aceita somente identificadores de arquivos conhecidos, rejeita seleção vazia/desconhecida e resolve fichas e custos canônicos. Não recebe catálogo, preço ou empresa arbitrários do navegador.
- Cada análise usa uma cópia da empresa com somente os produtos selecionados. A escolha não modifica a empresa global do agendador.
- A seleção completa, os arquivos e suas versões por hash ficam no dossiê e no evento de início da execução. O turno guarda arquivos, hash e identificadores dos produtos; a tela da análise mostra os nomes dos arquivos, e o relatório PDF registra arquivos e versão. Uma nova escolha não altera o retrato anterior.
- O mesmo pregão com seleção diferente não reaproveita uma execução em andamento. Continua existindo um único turno de onboarding ativo por servidor.
- O agente e as ferramentas atuais fazem a análise. O limite técnico permanece em 30 passos/250 mil tokens, além da revisão operacional limitada já existente. Sem chave não há resultado substituto.

## Descoberta, atualização e datas

`oportunidades.ts` faz consultas públicas sem modelo. Combina buscas paginadas com referências da coleta pública anterior (`coverage.json`), conferindo novamente os fatos na fonte. Não apresenta a lista antiga como nova descoberta.

Limites por coleta: seis termos em duas páginas, até sessenta candidatos, até quatro páginas de cem itens por pregão, vinte e cinco oportunidades e noventa segundos. Buscas usam duas consultas concorrentes; detalhes usam até quatro trabalhadores. Cada requisição tem timeout de oito segundos e no máximo duas tentativas. Só entram pregões do Compras.gov.br confirmados nos metadados da contratação, com itens relacionados ao universo da biblioteca.

O coletor não certifica que todos os anexos sejam legíveis. O caso ilegível e o evento já conhecidos da demonstração são excluídos. Novas exceções de leitura continuam sendo tratadas pelo agente e pela escalada, sem transformar cobertura desconhecida em autorização.

Um serviço por processo compartilha a coleta entre navegadores. Atualiza a cada cinco minutos, reúne solicitações simultâneas e limita pedidos manuais a um intervalo mínimo de trinta segundos. HTTP 429 interrompe o restante da coleta, preserva dados válidos e respeita `Retry-After`, com espera mínima de cinco minutos. A interface identifica a espera. Cache público em `cache/oportunidades.json`, com escrita temporária e substituição atômica, permanece fora do Git.

Publicação, atualização do registro e consulta são campos distintos. “Publicado hoje/ontem/há N dias” usa a publicação na fonte e o dia de America/Recife. Data ausente não recebe substituto. Uma atualização de metadados não é apresentada como retificação; o monitor existente continua responsável pelos arquivos e diferenças da análise.

Consulta sem sucesso não renova o horário de uma oportunidade antiga. Suspensão/encerramento confirmados retiram a oportunidade da nova seleção. O feed também impede iniciar análise com situação/prazo incompatíveis nos dados conhecidos. A conferência da publicação ao finalizar e os bloqueios de envio continuam independentes.

## Interface e reprodução

Mantidos três passos: Empresa → Catálogos → Editais. Seleção de arquivos com prévia recolhida, sem upload/XLSX. Feed com busca, UF, ordenação, itens distintos, fonte sob demanda e ação de análise sempre alcançável. A seleção é preservada na sessão do navegador. Catálogos antigos e análises existentes não são apresentados como se tivessem recebido uma nova configuração.

```sh
npm ci
npm run oportunidades:preparar  # consulta fontes reais; pode terminar parcial
npm run build
npm run integrado             # feed compartilhado + análise com chave do modelo
```

`npm run demo` também permite percorrer a configuração/feed, mas a análise permanece indisponível e o painel de amostra continua identificado. `LANCE_OFFLINE=1` impede consulta externa; os dados preparados conservam seus horários e a atualização não é tratada como bem-sucedida.

## Verificação e limites

Testes novos cobrem combinação e deduplicação, versões, seleção vazia/desconhecida, isolamento do catálogo global, seleção efetiva no agente, histórico/dossiê, API e exportação PDF, publicação por dia em Recife, paginação e identidade na coleta, suspensão, atualização concorrente, falha com dados preservados e limite da fonte. Casos controlados são explicitamente sintéticos e não medem qualidade do modelo.

Conferência no navegador: seleção múltipla, ausência de seleção, troca de catálogo, busca, filtro por UF, fonte e habilitação da análise; 390 px sem rolagem horizontal, além da composição em 768 px. Sem erros de console observados. Nenhum turno novo com modelo pago foi executado nesta entrega. Não há nova medição de custo, concordância, economia ou acerto.

A porta de envio permanece inalterada. Não há envio real ou automação de lance, alteração de política, novo preço pelo histórico ou promoção de evidência ausente a fato.
