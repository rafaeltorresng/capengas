# Lance — plano final (versão 2, 07/11/2026, 13h15)

> **Plano final, aprovado pela equipe em 07/11.** Substitui a versão 1. Mudanças de escopo só por decisão explícita da equipe.
> Produto: `lance-produto.md`. Embasamento: `lance-pesquisa.md`.
> **O que mudou em relação à v1:** o agente passa a trabalhar **sozinho, o dia inteiro**, dentro de uma
> **política** definida pela empresa. Ele monitora os pregões e reage a mudanças, e o humano só é
> chamado nas exceções.

## 1. O que vamos entregar

Um **digital worker de licitações** para uma distribuidora de material médico. Ele:
1. roda **turnos automáticos** sobre os pregões de saúde abertos no Compras.gov.br;
2. analisa item a item (encaixe técnico, ANVISA, exigências do edital) e decide;
3. monta o **dossiê** da proposta;
4. **dentro da política da empresa**, envia sozinho esclarecimentos e propostas ao portal sandbox e verifica;
5. **monitora** os pregões em andamento (suspensão, errata, documento novo) e reavalia só o que mudou;
6. **escala ao humano** apenas o que sai da política, com o contexto pronto;
7. publica uma **linha do tempo** e um **relatório do dia**: o que fez, por quê, quanto custou e o que precisa de decisão.

**O papel do humano:** definir a política uma vez e decidir o que for escalado. Ninguém clica em "rodar".

## 2. A política da empresa (configurada uma vez)

| Regra | Exemplo na demo |
|---|---|
| Margem mínima sobre o custo | 15% |
| Valor máximo por pregão para envio automático | R$ 50 mil |
| Envio automático só se o encaixe técnico for "atende" em todos os atributos, com citação | Sim |
| Documentos do cofre válidos até a sessão | Obrigatório; se não, "com pendência" e escala |
| Esclarecimentos que pode enviar sozinho | Atributo não informado; variante não coberta; marca de referência |
| Sempre escalar | Valor acima do limite; impugnação; qualquer item "não informado" com prazo de esclarecimento já vencido |

## 3. Escopo

### Obrigatório (a demo depende disso)
| # | Funcionalidade | Situação |
|---|---|---|
| O1 | Turno: buscar pregões abertos do Compras.gov.br e itens compatíveis com o catálogo | Pronto; **corrigir paginação** |
| O2 | Encaixe técnico atributo a atributo, com citações conferidas | Pronto; eval **18/18** |
| O3 | Registro ANVISA de cada produto | Pronto |
| O4 | Exigências do edital com citação, incluindo o prazo e o e-mail para esclarecimento | Pronto; eval 78–89% |
| O5 | Decisão por item com motivo | Pronto |
| O6 | **Dossiê**: quadro técnico + checklist de habilitação ligado ao cofre + pendências e prazos | **Novo** |
| O7 | **Política da empresa** aplicada pelo código: o que envia sozinho e o que escala | **Novo** |
| O8 | Envio automático, dentro da política, de propostas e esclarecimentos ao sandbox, com verificação | Pronto em parte; **falta a política e a verificação de esclarecimento** |
| O9 | **Recheque antes de agir**: não envia se o pregão estiver suspenso ou tiver errata nova | **Novo** |
| O10 | **Agendador de turnos** (sem clique) | **Novo** |
| O11 | **Monitor**: relê a situação e os arquivos dos pregões acompanhados e reavalia só o que mudou | **Novo** |
| O12 | **Escalada**: notificação "preciso de você" com o contexto pronto | **Novo** |
| O13 | **Tela**: linha do tempo do dia, fila de decisões, item com citações e "ver fonte", dossiê, escaladas, relatório do dia | **Novo** |
| O14 | Turno em ≤ 3 min | Hoje 12,5 min → compactar histórico, paralelizar itens e limitar pregões por turno |

### Desejável (só se O1–O14 estiverem prontos no Portão 3)
| # | Funcionalidade |
|---|---|
| D1 | Calendário do cofre ("renove a CND até 14/11 ou perde N pregões") |
| D2 | Semáforo financeiro do órgão (SICONFI), como informação |
| D3 | Releitura de respostas de esclarecimento publicadas no PNCP |

### Fora (não fazer)
Preço pelo histórico como base de decisão (o backtest refutou), mapa de oportunidades, pós-vitória,
outras plataformas, medicamentos, lances, envio a portais reais, login, OCR e multiagente.
Também saem as interações em que o avaliador opera a demo. O preço aparece só como checagem de
custo + margem contra a estimativa.

## 4. Arquitetura

```
Agendador (a cada N horas) ──► Turno do agente ──► Estado persistido (SQLite)
Monitor (a cada N min) ──► relê os pregões acompanhados ──► reavalia o que mudou
                │
   Política da empresa (código) ──► agir sozinho │ escalar
                │
Portal sandbox ◄── envio + verificação     Tela (React): linha do tempo, fila, item, dossiê, escaladas, relatório
```

- Node 24 + TypeScript, um processo; núcleo sem dependências; React (Vite) na tela.
- Um único agente, ferramentas tipadas, limites de passos e tokens. A política substitui o clique
  de aprovação nos casos permitidos; fora dela, a ação fica bloqueada (o mesmo portão já testado).
- Featherless `moonshotai/Kimi-K2.6`; custo real lido da API.
- **Princípio:** o modelo julga, o código confere, calcula e aplica a política, e o humano decide as exceções.

## 5. Como provamos aos avaliadores (sem ninguém operar)

| Prova | O que o avaliador vê |
|---|---|
| **Trabalho do dia** | Linha do tempo com horários reais: turnos automáticos desde a manhã, envios, esclarecimentos, bloqueios |
| **Autonomia ao vivo** | Um turno começa sozinho no horário durante o pitch, com o rastro aparecendo |
| **Reação a um evento real** | Um pregão real que recebeu errata ou ficou suspenso: o agente detecta e refaz só o que mudou |
| **Exceção escalada** | Uma notificação "preciso de você" com o contexto pronto, a única ação humana da demo |
| **Tudo conferível** | Botões "ver fonte": PDF do edital no trecho, página do PNCP, registro ANVISA, rastro com custo |
| **Números** | Encaixe técnico 18/18; bateria de 10 cenários de exceção; concordância com um revisor humano num turno real; custo e tempo |

### Bateria de cenários de exceção (resultado esperado definido antes)
1. Pregão suspenso antes do envio → não envia e registra.
2. Errata nova num pregão acompanhado → reavalia só os itens afetados.
3. Edital ilegível (ZIP ou escaneado) → tenta outro anexo; se falhar, escala.
4. Ficha sem um atributo exigido → envia esclarecimento (política) ou escala se o prazo venceu.
5. Variante não coberta (tamanho 00) → não disputa e envia esclarecimento.
6. Marca de referência → envia esclarecimento.
7. Citação inventada → rejeitada; refaz.
8. PNCP fora do ar → usa o cache, marca pendente e tenta no próximo ciclo.
9. Documento do cofre vence antes da sessão → "com pendência" e escala.
10. Valor acima do limite da política → escala em vez de enviar.

## 6. Cronograma e responsáveis

> **Atualizado:** o cronograma detalhado, com tarefas, estimativas e dependências por dev a partir das 15h, está em `lance-execucao.md` e substitui a tabela abaixo.

| Horário | Dev 1 — dados, regras e política | Dev 2 — agente | Dev 3 — tela e pitch |
|---|---|---|---|
| **13:15–14:00** | Repositório de código com o núcleo e os 68 testes; `.gitignore` com `.env`; persistência do estado em SQLite | Paginação e filtro por catálogo (O1); prompt do digital worker | Wireframe: linha do tempo, fila, item, dossiê, escaladas |
| **14:00–15:30** | Política (O7) + recheque (O9) + verificação de esclarecimento, com testes antes | Dossiê (O6); compactação do histórico e paralelismo (O14) | Tela: linha do tempo + fila + item com "ver fonte" |
| **15:30 — Portão 2** | **Turno automático com dossiê e envio dentro da política em 2 pregões reais, visto na tela** | | |
| 15:30–17:30 | Agendador (O10) + monitor (O11) + escalada (O12); achar pregões reais com errata ou suspensão para a demo | Bateria dos 10 cenários; ajustes de prompt | Tela: dossiê, escaladas, relatório do dia; URL pública |
| **17:30 — Portão 3** | **Dia simulado completo: 3 turnos automáticos, 1 reação a evento real, 1 escalada; 10 cenários passando; ≤ 3 min por turno** | | |
| 17:30–20:00 | D1 se houver tempo | Turno real auditado por um revisor humano (concordância) | Roteiro do pitch de 3 min + slides |
| Noite | Correções | Evals finais registrados | Ensaio |
| **Dom 08:00** | **Ligar o agendador**: o agente trabalha sozinho a manhã inteira, gerando a linha do tempo real do dia da apresentação | | |
| **Dom 10:00** | Congelar o código | Vídeo de reserva | Ensaio final |
| **Dom 13:00** | **Submissão** | | |

## 7. Definição de pronto
1. Testes das regras novas escritos antes da implementação.
2. Funciona num pregão real, não só no cache.
3. Aparece na linha do tempo e no rastro (entrada, saída, tempo, custo).
4. Tem o caminho de exceção testado.

## 8. A demo (90 s dentro do pitch de 3 min)
1. Abrir a **linha do tempo de domingo**: tudo o que o agente fez sozinho desde as 8h.
2. Um turno **começa sozinho** no horário; o rastro aparece.
3. Abrir um item: o CPAP de tamanho 00 não atende → esclarecimento enviado sozinho, dentro da política.
4. Abrir o dossiê: checklist com "CND vence antes da sessão" → escalada.
5. Mostrar a **reação a um evento real**: errata ou suspensão detectada, reavaliação ou envio bloqueado.
6. Fechar com o painel de prova: 18/18, cenários, concordância, custo e tempo.

## 9. Números do pitch (medidos)
| Número | Fonte |
|---|---|
| 1.647 pregões de saúde abertos, ≥ R$ 3,8 bi | PNCP, 07/11 |
| 16–21% dos itens de saúde fracassam, contra 4,6% em escritório | Compras.gov.br, abr/2026 |
| O preço não explica o fracasso (backtest de 494 itens) | Medição própria |
| 5.513 distribuidoras de material médico; 145 com sanção vigente | Fornecedores + CEIS |
| Encaixe técnico 18/18; exigências 78–89%; código × descrição 13/18 | Evals (Kimi-K2.6, 3 repetições) |
| Turno real US$ 0,22; todos os evals US$ 0,77 | Custo real da API |

## 10. Riscos e resposta já decidida
| Risco | Resposta |
|---|---|
| Turno continua lento | Menos pregões por turno; a linha do tempo da manhã mostra o volume |
| Nenhum pregão real com errata ou suspensão útil | Usar um dos 4 suspensos achados hoje; em último caso, cenário da bateria, rotulado como teste |
| PNCP fora do ar | Cache pré-carregado |
| Crítica "é só pipeline" | Autonomia: agendador, monitor, reação a eventos reais e escalada, tudo visível na linha do tempo |
| Responsabilidade de enviar sozinho | Política autorizada pela empresa; na demo, só sandbox |
| Falta de tempo | Cortar nesta ordem: D3 → D2 → D1 → URL pública → monitor (O11). **Nunca** cortar O2, O6, O7 ou O8 |

## 11. Decisões pendentes da equipe
1. **Autorizar levar o código ao repositório** (hoje tudo está no scratchpad).
2. Confirmar quem é Dev 1, 2 e 3.
