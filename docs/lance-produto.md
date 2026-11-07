# Lance — documento do produto (07/11/2026)

> O que o produto é, para quem, o que faz, como o usuário o vive e como funciona por dentro.
> As evidências do problema estão em `lance-pesquisa.md`; o plano de construção está em `lance-plano-fixo.md`.
> **MVP** = o que entra no hackathon. **Futuro** = depois.

---

## 1. Visão

**O Lance é o analista de licitações digital de uma distribuidora de material médico-hospitalar.**

Ele trabalha sozinho, todo dia:
- encontra os pregões de saúde que o catálogo da empresa atende;
- confere tudo que pode fazer a proposta ser desclassificada;
- prepara a proposta pronta para envio;
- e só chama o time quando algo foge das regras que a empresa definiu.

**Promessa:** *"Propostas que não caem por erro evitável, preparadas em minutos, sem ninguém precisar
ler 300 mil caracteres de edital."*

**O que o Lance não é:** um buscador de editais, um chat para perguntar ao edital ou um robô de lances.

---

## 2. Para quem

| Papel | Quem é | O que espera do Lance |
|---|---|---|
| **Comprador** | Dono ou gerente comercial de uma distribuidora pequena ou média (ME/EPP) | Vender mais ao governo sem aumentar o time e sem ser desclassificado ou sancionado |
| **Usuário principal** | Analista de licitações | Receber pronto o que vale a pena disputar e decidir só as exceções |
| **Usuário ocasional** | Responsável técnico ou regulatório | Resolver pendências de ANVISA e de ficha técnica que o Lance aponta |

---

## 3. Problemas que o produto resolve (e os que não resolve)

| Problema do cliente | Como o Lance resolve | No MVP? |
|---|---|---|
| Ler e triar muitos editais longos | Turnos automáticos leem pregões e itens e filtram pelo catálogo | ✅ |
| Saber se o produto atende à especificação | Encaixe técnico atributo a atributo, com citação do item e da ficha | ✅ |
| Ofertar produto com registro ANVISA que não serve | Conferência na base oficial | ✅ |
| Esquecer uma exigência do edital | Exigências extraídas com citação conferida e ligadas aos documentos da empresa | ✅ |
| Documento vencido na data da sessão | Checklist de habilitação com validade × data da sessão | ✅ |
| Especificação ambígua ou restritiva | Pedido de esclarecimento redigido e enviado dentro do prazo do edital | ✅ |
| Pregão que muda depois de publicado | Monitor de suspensão, errata e documento novo | ✅ |
| Preço para vencer | ❌ O backtest mostrou que o histórico não prevê bem; o Lance só confere se a estimativa cobre custo + margem | Parcial |
| Entregar e receber depois de ganhar | ❌ Fora do escopo | Futuro |

---

## 4. Como o cliente vive o produto

### 4.1 Configuração (uma vez, ~30 min)
1. **Catálogo:** produtos com marca, modelo, **número de registro ANVISA**, ficha técnica e custo.
2. **Cofre de documentos:** AFE, certidões, balanço, atestados, cada um com validade.
3. **Política:** regras do que o Lance pode fazer sozinho (seção 6).
4. **Preferências:** UFs e esferas de atuação, valor mínimo de pregão, quem recebe as escaladas.

### 4.2 O dia a dia (sem ninguém operar)

| Horário (exemplo) | O que acontece |
|---|---|
| 07:00 | Turno automático: novos pregões de saúde abertos, itens compatíveis, análise completa |
| 07:20 | Esclarecimento enviado sozinho, dentro da política ("tamanho 00 não coberto pela ficha") |
| 09:00 | Monitor: um pregão acompanhado foi **suspenso** → envio cancelado e registrado |
| 11:00 | Turno automático: mais 2 pregões |
| 11:15 | **Escalada:** "item de R$ 80 mil, acima do limite da política; dossiê pronto, preciso de você" |
| 14:00 | Monitor: errata em outro pregão → reavaliou só os 3 itens afetados |
| 18:00 | **Relatório do dia** por e-mail ou na tela |

### 4.3 O que o analista faz
- Lê o relatório do dia (5 minutos).
- Decide as **escaladas**: aprova, recusa ou ajusta.
- Resolve as **pendências** apontadas (renovar certidão, pedir ficha ao fabricante).

---

## 5. Funcionalidades

### 5.1 Turno automático (MVP)
- Roda por **agendador**, sem clique.
- Busca pregões de saúde abertos no **Compras.gov.br**, nas UFs e esferas configuradas.
- Lista **todos** os itens (com paginação) e filtra os compatíveis com o catálogo.

### 5.2 Encaixe técnico (MVP)
Para cada par **item × produto**, uma tabela:

| Atributo exigido | O que o item pede (citação) | O que o produto oferece (citação) | Veredito |
|---|---|---|---|
| Tamanho | "tamanho*: neonatal nº 00" | "tamanhos 0 a 5, incluindo nº 4" | ❌ Não atende |
| Material | "material*: silicone" | "pronga nasal em silicone" | ✅ Atende |
| Embalagem | "embalagem individual" | — | ❓ Não informado |

- Toda citação é **conferida pelo código** contra o texto real. Citação inventada é rejeitada e refeita.
- O resultado do item vem das linhas: algum ❌ → não atende; algum ❓ → não informado; senão, atende.

### 5.3 Regularização ANVISA (MVP)
- Busca o registro do produto na base oficial (116 mil produtos).
- Mostra classe, detentor, nome técnico e validade frente ao prazo de entrega.

### 5.4 Leitura do edital (MVP)
- Lê só os trechos relevantes (os editais têm de 130 a 290 mil caracteres).
- Registra, com citação, as exigências: registro ANVISA, AFE, amostra, marca de referência,
  **prazo e e-mail para esclarecimento** e outras de habilitação.

### 5.5 Decisão por item (MVP)
| Estado | Quando |
|---|---|
| ✅ **Disputar** | Atende, registro ok, documentos ok, dentro da política |
| 🟡 **Disputar com pendência** | Atende, mas há algo a resolver antes da sessão (ex.: certidão vence antes) |
| ❓ **Escalar** | Atributo não informado, valor acima do limite ou caso fora da política |
| ✉️ **Esclarecer** | Ambiguidade, variante não coberta ou marca de referência, com prazo ainda aberto |
| ❌ **Não disputar** | Não atende, registro não serve ou custo + margem acima da estimativa |

Cada decisão traz **o motivo em uma frase** e o caminho até ela no rastro.

### 5.6 Dossiê da proposta (MVP)
Por pregão:
1. **Resumo:** órgão, data da sessão, itens que serão disputados, valor estimado total.
2. **Proposta por item:** produto, marca, modelo, registro ANVISA, quantidade e preço
   (custo + margem, ou o valor definido pela empresa).
3. **Quadro técnico:** a tabela de encaixe de cada item.
4. **Checklist de habilitação:**

   | Exigência do edital (citação) | Documento do cofre | Validade | Status |
   |---|---|---|---|
   | "Autorização de Funcionamento de Empresa – AFE…" | AFE ANVISA | 31/05/2027 | ✅ |
   | "Certidão de regularidade… Receita Federal" | CND Federal | 15/11/2026 | 🟡 Vence antes da sessão (23/11) |

5. **Pendências e prazos:** o que resolver, até quando e quem resolve.
6. **Esclarecimentos:** texto enviado ou a enviar, prazo e status da resposta.

### 5.7 Esclarecimentos (MVP)
- Redige com a citação do edital e o fundamento (art. 164 da Lei 14.133; regras de indicação de marca).
- Usa o **prazo e o e-mail extraídos do próprio edital**.
- Dentro da política, envia sozinho; fora dela, escala.
- No MVP, o envio vai para o portal **sandbox**.

### 5.8 Monitor (MVP)
- Revisita os pregões acompanhados: situação (suspenso, revogado) e arquivos novos (errata, aviso, resposta).
- Reavalia **só os itens afetados**.
- Faz o **recheque antes de qualquer envio**.

### 5.9 Escaladas (MVP)
Uma notificação com:
- o que aconteceu;
- o que o Lance recomenda;
- o dossiê ou a tabela pronta;
- o prazo para decidir;
- botões **aprovar / recusar / ajustar**.

### 5.10 Linha do tempo, rastro e relatório (MVP)
- **Linha do tempo:** tudo que o Lance fez, com horário.
- **Rastro:** para cada ação, as ferramentas usadas, entradas, saídas, tempo e custo.
- **"Ver fonte":** cada citação abre o PDF do edital no trecho, a página do PNCP ou o registro ANVISA.
- **Relatório do dia:** pregões analisados, itens por decisão, envios, escaladas, pendências e custo.

---

## 6. Política da empresa

| Regra | Padrão sugerido |
|---|---|
| Margem mínima sobre o custo | 15% |
| Valor máximo por pregão para envio automático | R$ 50 mil |
| Exigir "atende" em todos os atributos, com citação, para envio automático | Sim |
| Documentos válidos até a data da sessão | Obrigatório; se não, "com pendência" e escala |
| Esclarecimentos que pode enviar sozinho | Atributo não informado; variante não coberta; marca de referência |
| Sempre escalar | Valor acima do limite; impugnação; prazo de esclarecimento vencido com dúvida aberta; pregão alterado depois da análise |
| Horários dos turnos | 07:00, 11:00, 15:00 |
| Notificações | E-mail do analista + tela |

**Regra de ouro:** o Lance **nunca** dá lance, assina ou envia algo fora da política.

---

## 7. Telas (MVP)

| Tela | O que mostra |
|---|---|
| **Hoje** | Linha do tempo do dia + contadores (pregões, itens, disputar, pendências, escaladas, custo) |
| **Fila de decisões** | Itens por estado, com motivo; filtros por pregão, órgão e prazo |
| **Item** | Tabela de encaixe com citações clicáveis, ANVISA, preço × estimativa, decisão e rastro |
| **Dossiê** | O pacote completo do pregão, com checklist e pendências |
| **Escaladas** | O que precisa do humano, com prazo e botões |
| **Configuração** | Catálogo, cofre, política e preferências |
| **Prova** (para a demo) | Evals, cenários de exceção, custo e tempo |

---

## 8. Como funciona por dentro

### 8.1 Princípio
**O modelo julga, o código confere, calcula e aplica a política, e o humano decide as exceções.**
O modelo nunca escreve preço, data ou decisão final; o que é enviado é montado pelo código.

### 8.2 Componentes
```
Agendador ─► Turno do agente ─┐
Monitor ──► Reavaliação ──────┼─► Estado (SQLite) ─► Tela / Relatório / Notificações
                              │
        Ferramentas tipadas ──┤── Regras determinísticas (ANVISA, datas, citações, política)
                              │── Dados: PNCP · Compras.gov.br · ANVISA · PDFs (pdftotext)
                              └── Ações: portal sandbox (propostas e esclarecimentos) + verificação
Modelo: Featherless (Kimi-K2.6), API compatível com OpenAI
```

### 8.3 Ferramentas do agente
`search_tenders` · `get_tender_items` · `list_catalog` · `get_product_sheet` · `check_anvisa` ·
`read_edital` · `record_requirement` · `record_fit` · `flag_restrictive` · `decide_item` ·
`draft_esclarecimento` · `send_esclarecimento` · `submit_proposal` · `verify_submission` ·
`recheck_tender` · `escalate`

### 8.4 Exceções tratadas
| Exceção | Comportamento |
|---|---|
| Citação inexistente | Rejeitada pelo código; o agente refaz |
| Ficha sem atributo exigido | Esclarecer (se houver prazo) ou escalar |
| Variante não coberta | Não disputar + esclarecer |
| Marca de referência ou compatibilidade que amarra marca | Sinalizar + esclarecer |
| Documento vence antes da sessão | Com pendência + escalar |
| Pregão suspenso ou com errata | Bloqueia o envio; reavalia o que mudou |
| Edital ilegível (ZIP ou escaneado) | Tenta outro anexo; senão, escala |
| PNCP fora do ar | Retry com espera, cache e nova tentativa no próximo ciclo |
| Ação fora da política | Bloqueada; vira escalada |

---

## 9. Requisitos não funcionais

| Requisito | Meta |
|---|---|
| **Confiabilidade** | Toda afirmação com citação conferida; nenhuma ação fora da política |
| **Auditoria** | Rastro completo de cada decisão e ação |
| **Custo** | Centavos por item (medido: US$ 0,22 por turno de 15 itens) |
| **Latência** | ≤ 3 min por turno na demo (hoje 12,5 min) |
| **Resiliência** | Funciona com o PNCP instável (retry e cache) |
| **Segurança** | Chaves só em variáveis de ambiente; nada sensível no navegador; documentos do cliente isolados |
| **Qualidade do julgamento** | Encaixe técnico ≥ 95% nos evals (medido: 18/18); exigências ≥ 80% (medido: 78–89%) |

---

## 10. Métricas de sucesso do produto

| Métrica | O que mostra |
|---|---|
| Itens analisados por dia | Volume que o Lance tira do analista |
| % de decisões que o analista confirma | Confiança no julgamento |
| % de itens escalados | Autonomia (quanto menor, sem erro, melhor) |
| Desclassificações por motivo evitável | Resultado final para o cliente (a medir em piloto) |
| Tempo do analista por pregão | Ganho de produtividade (a medir em piloto) |
| Custo por item | Viabilidade |

---

## 11. Modelo de negócio (hipóteses)

| Item | Hipótese |
|---|---|
| Plano | Assinatura mensal por faixa de itens analisados |
| Preço | R$ 500 a R$ 1.500/mês |
| Mercado inicial | 5.513 distribuidoras de material médico → R$ 33–99 mi/ano |
| Expansão | Medicamentos, odonto e ortopedia (9.434 fornecedores de saúde); outros setores regulados |
| Aquisição | Teste grátis com o catálogo do cliente rodando sobre os pregões abertos daquela semana |

---

## 12. Roteiro

| Fase | O que entra |
|---|---|
| **MVP (hackathon)** | Seções 5.1 a 5.10, política, sandbox, Compras.gov.br, saúde (material médico) |
| **V1 (piloto com 2 ou 3 distribuidoras)** | Envio real assistido; cofre com alertas de vencimento; semáforo financeiro do órgão (SICONFI); medir tempo poupado e desclassificações |
| **V2** | Outras plataformas de pregão (mapeamento de código); mapa de oportunidades (demanda × catálogo × fabricantes ANVISA) |
| **V3** | Medicamentos e outros setores regulados; acompanhamento pós-vitória |

---

## 13. Riscos do produto

| Risco | Mitigação |
|---|---|
| O modelo erra o encaixe | Citação obrigatória; ambíguo vai para escalada; evals contínuos |
| Concorrente horizontal copia | Foco no setor, velocidade e dados de resultado por cliente |
| Cliente não confia em envio automático | Começar com política conservadora (só esclarecimentos automáticos) e ampliar com o histórico |
| Responsabilidade pela proposta | Política autorizada pela empresa; a empresa assina; o rastro mostra o porquê |
| Dependência de dados públicos instáveis | Cache, retry e monitor de qualidade dos dados |

---

## 14. Perguntas em aberto
1. Quanto tempo uma distribuidora gasta, de fato, por item e por pregão?
2. Qual política inicial o cliente aceitaria (o que pode ser automático no primeiro mês)?
3. Qual preço e qual plano fazem sentido?
4. O analista prefere receber escaladas por e-mail, WhatsApp ou na tela?
