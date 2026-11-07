# Lance — plano de execução da equipe (3 devs)

> Do sábado 07/11 às 15h até a submissão no domingo 08/11 às 13h.
> Escopo e regras: `lance-plano-fixo.md`. Produto: `lance-produto.md`.
> **Este documento substitui o cronograma da seção 6 do plano fixo**, que começava às 13h15.

---

## 1. Visão geral

| Dev | Responsabilidade | Entrega principal |
|---|---|---|
| **Dev 1 — Dados, regras e política** | Tudo que é determinístico: dados públicos, regras, política, persistência, agendador, monitor | Um núcleo confiável que nunca age fora da política |
| **Dev 2 — Agente e IA** | Loop do agente, prompt, ferramentas de julgamento, dossiê, desempenho e evals | Um turno que decide bem, em ≤ 3 min, com prova medida |
| **Dev 3 — API, tela e pitch** | API de leitura e escaladas, tela React, URL pública, pitch e vídeo | O que a banca vê e entende em 90 s |

**Ponto de partida:** o spike (fora do repositório) já tem `http`, `data`, `rules`, `schema`, `agent`,
`llm`, `tools` e `sandbox`, com **68 testes passando**, turno real ponta a ponta e evals
(encaixe 18/18). **Nada é reescrito do zero.**

---

## 2. Os primeiros 30 minutos (15:00–15:30): todos juntos

Combinar os contratos agora evita bloqueios depois.

### 2.1 Estrutura do repositório (Dev 1 cria)
```
src/
  lib/       http.ts data.ts rules.ts schema.ts            ← do spike (Dev 1)
             agent.ts llm.ts tools.ts dossie.ts            ← do spike + novo (Dev 2)
             policy.ts store.ts monitor.ts scheduler.ts    ← novo (Dev 1)
             sandbox.ts                                    ← do spike (Dev 1)
  server/    api.ts                                        ← novo (Dev 3)
web/         app React (Vite)                              ← novo (Dev 3)
test/        *.test.ts (unidade) · *.live.test.ts (rede)
evals/       gold.json · cenarios.json · run.ts            ← Dev 2
fixtures/    company.json (catálogo, cofre, política)
.env         (NÃO versionar; já está no .gitignore)
```

### 2.2 Contrato do estado (SQLite, Dev 1 implementa, todos usam)
| Tabela | Conteúdo |
|---|---|
| `tenders` | id, órgão, UF, abertura, situação, último check, hash dos arquivos |
| `items` | tender_id, número, descrição, código, quantidade, estimativa |
| `fits` | tender_id, item, produto, resultado, atributos (JSON com citações) |
| `requirements` | tender_id, tipo, citação |
| `decisions` | tender_id, item, estado, motivos, preço, pendências |
| `dossies` | tender_id, JSON do dossiê, versão |
| `actions` | tipo (proposta, esclarecimento), tender_id, protocolo, status, verificado |
| `escalations` | id, tender_id, item, motivo, recomendação, prazo, status, decisão humana |
| `events` | horário, tipo, resumo, rastro (ferramenta, entrada, saída, ms, custo) → **a linha do tempo** |

### 2.3 Contrato da API (Dev 3 implementa; Dev 1 e Dev 2 escrevem no estado)
| Rota | Retorna |
|---|---|
| `GET /api/hoje` | Contadores do dia + linha do tempo (`events`) |
| `GET /api/fila` | Itens com estado e motivo |
| `GET /api/itens/:tender/:item` | Encaixe com citações, ANVISA, preço × estimativa, decisão, rastro |
| `GET /api/dossies/:tender` | Dossiê completo |
| `GET /api/escaladas` | Escaladas abertas |
| `POST /api/escaladas/:id` | Decisão humana: aprovar, recusar ou ajustar |
| `GET /api/prova` | Evals, cenários, custo e tempo |

### 2.4 Dados falsos para a tela começar já
Dev 2 exporta, no primeiro minuto, o **resumo do turno real de hoje** (do spike) como `fixtures/estado-exemplo.json`.
Dev 3 constrói a tela em cima dele **até a API real existir**.

### 2.5 Regras de trabalho
- Uma branch por dev; merge na `main` só com os testes passando.
- **TDD:** teste antes da regra nova.
- Commits pequenos; `.env` nunca no commit.
- Bloqueado há mais de 20 min → avisar no grupo.

---

## 3. Tarefas por dev

### Dev 1 — Dados, regras e política
| # | Tarefa | Estimativa | Depende de | Pronto quando |
|---|---|---|---|---|
| D1.1 | Criar o repositório de código e portar `http`, `data`, `rules`, `schema`, `sandbox` + os testes | 30 min | — | 68 testes passando no repositório |
| D1.2 | `store.ts`: SQLite com as tabelas da seção 2.2 | 45 min | D1.1 | Teste grava e lê cada tabela |
| D1.3 | `policy.ts`: aplicar a política da empresa (limites, o que envia sozinho, o que escala) | 1 h | D1.1 | Testes: valor acima do limite escala; atributo ❓ escala; tudo ✅ libera |
| D1.4 | Recheque antes de agir: suspensão ou arquivo novo bloqueia o envio | 45 min | D1.2 | Teste com pregão suspenso real (achamos 4) |
| D1.5 | Verificação de esclarecimento no sandbox | 20 min | D1.1 | Teste de envio + consulta |
| D1.6 | `monitor.ts`: relê a situação e os arquivos dos pregões acompanhados e marca o que mudou | 1 h | D1.2 | Teste: hash de arquivos mudou → evento + itens marcados para reavaliar |
| D1.7 | `scheduler.ts`: turnos e monitor em horários configuráveis | 30 min | D1.6 + agente (D2.1) | Turno dispara sozinho e aparece em `events` |
| D1.8 | Achar pregões reais para a demo: 1 suspenso ou com errata + 2 ou 3 com itens compatíveis; pré-carregar o cache | 45 min | D1.1 | Lista em `fixtures/demo.json` |
| D1.9 (desejável) | Calendário do cofre | 45 min | D1.2 | "Renove a CND até X ou perde N pregões" |

### Dev 2 — Agente e IA
| # | Tarefa | Estimativa | Depende de | Pronto quando |
|---|---|---|---|---|
| D2.0 | Exportar `fixtures/estado-exemplo.json` do turno real (para o Dev 3) | 10 min | — | Arquivo no repositório |
| D2.1 | Portar `agent`, `llm`, `tools` + testes; agente grava no `store` | 45 min | D1.1, D1.2 | Testes do agente passando; turno grava `events` |
| D2.2 | Corrigir `get_tender_items`: paginação + filtro pelos produtos do catálogo | 30 min | D2.1 | Turno acha a tesoura (item 40) e a cadeira (item 54) |
| D2.3 | `dossie.ts`: montar o dossiê a partir de fits, requirements, decisions e cofre | 1 h 15 | D2.1 | Teste: checklist liga cada exigência a um documento e marca "vence antes da sessão" |
| D2.4 | Integrar a política: decisões e envios passam por `policy.ts`; ferramenta `escalate` | 45 min | D1.3 | Valor acima do limite vira escalada, sem envio |
| D2.5 | Desempenho: compactar o histórico entre pregões, analisar itens em paralelo, limitar pregões por turno | 1 h 30 | D2.1 | **Turno de 2 pregões em ≤ 3 min** |
| D2.6 | Prompt do digital worker (papel, metas, política, quando escalar) | 30 min | D2.4 | Turno real coerente com a política |
| D2.7 | Evals: ampliar o gabarito de encaixe para ~20 pares; criar os **10 cenários de exceção** com resultado esperado | 1 h 30 | D2.4, D1.4 | `evals/run.ts` mostra acertos e passa nos cenários |
| D2.8 | Turno real auditado: uma pessoa da equipe confere cada decisão (concordância %) | 30 min | D2.5 | Número de concordância registrado |

### Dev 3 — API, tela e pitch
| # | Tarefa | Estimativa | Depende de | Pronto quando |
|---|---|---|---|---|
| D3.1 | Wireframe das telas: Hoje, Fila, Item, Dossiê, Escaladas, Prova | 30 min | — | Combinado com a equipe |
| D3.2 | Tela **Hoje** (linha do tempo + contadores) e **Fila**, sobre `estado-exemplo.json` | 1 h 30 | D2.0 | Navegável com o exemplo |
| D3.3 | Tela **Item**: tabela de encaixe com citações e botões "ver fonte" (PDF do edital, PNCP, ANVISA) | 1 h | D3.2 | Citações clicáveis abrem a fonte |
| D3.4 | `server/api.ts` com as rotas da seção 2.3, lendo do `store` | 1 h | D1.2 | Tela troca o exemplo pela API real sem mudar componentes |
| D3.5 | Telas **Dossiê** e **Escaladas** (botões aprovar, recusar, ajustar) | 1 h 15 | D3.4, D2.3 | Decisão humana grava em `escalations` |
| D3.6 | Tela **Prova** (evals, cenários, custo, tempo) | 30 min | D2.7 | Números reais na tela |
| D3.7 | URL pública (Cloudflare Tunnel) com polling | 30 min | D3.4 | Abre de outro computador |
| D3.8 | Pitch de 3 min + slides, com os números de `lance-pesquisa.md` | 1 h 30 | — | Ensaiado 2× |
| D3.9 | Vídeo de reserva da demo | 30 min | Portão 3 | Gravado no domingo de manhã |

---

## 4. Cronograma

| Horário | Dev 1 | Dev 2 | Dev 3 |
|---|---|---|---|
| **15:00–15:30** | Kickoff: contratos (seção 2) · D1.1 | Kickoff · D2.0 | Kickoff · D3.1 |
| 15:30–17:00 | D1.2 → D1.3 | D2.1 → D2.2 | D3.2 |
| 17:00–18:00 | D1.4 · D1.5 | D2.3 | D3.3 |
| **18:00 — Portão 2** | **Turno real com dossiê gravado no estado, decisões passando pela política, visto na tela (com a API real ou o exemplo)** | | |
| 18:00–20:00 | D1.6 → D1.7 | D2.4 → D2.5 | D3.4 → D3.5 |
| 20:00–20:30 | Pausa | Pausa | Pausa |
| 20:30–22:00 | D1.8 · testes | D2.6 → D2.7 | D3.6 · D3.7 · início de D3.8 |
| **22:00 — Portão 3** | **Agendador dispara turnos sozinho; monitor reage a um evento real; 1 escalada resolvida pela tela; 10 cenários passando; turno ≤ 3 min; URL pública** | | |
| 22:00–23:30 | Correções · D1.9 se houver tempo | D2.8 · evals finais | D3.8 (pitch e slides) |
| **Dom 08:00** | **Ligar o agendador**: o agente trabalha sozinho a manhã toda e gera a linha do tempo real do dia | Acompanhar e corrigir | Ensaio |
| 08:00–10:00 | Estabilizar | Registrar os números finais em `/api/prova` | D3.9 (vídeo) |
| **Dom 10:00** | **Congelar o código** | | |
| 10:00–12:30 | Apoio no ensaio | Apoio no ensaio | Ensaios finais |
| **Dom 13:00** | **Submissão** | | |

### Pontos de sincronização (10 min, todos)
16:30 · **18:00 (Portão 2)** · 20:00 · **22:00 (Portão 3)** · dom 08:00 · dom 10:00

---

## 5. Portões

| Portão | Critério | Se falhar |
|---|---|---|
| **P2 — 18:00** | Turno real → estado → dossiê → tela; decisões passam pela política | Segurar D2.5 e D1.6; todos ajudam a fechar o fluxo básico |
| **P3 — 22:00** | Autonomia (agendador + monitor), escalada pela tela, 10 cenários, ≤ 3 min, URL pública | Cortar na ordem da seção 7 |
| **Congelamento — dom 10:00** | Nada novo; só correções | — |

---

## 6. Dependências críticas

```
D1.1 ─► D1.2 ─► D2.1 ─► D2.3 ─► D3.5
          │        └──► D2.5
          ├──► D1.3 ─► D2.4 ─► D2.7
          ├──► D1.6 ─► D1.7 (precisa de D2.1)
          └──► D3.4 ─► D3.5 · D3.6 · D3.7
D2.0 ─► D3.2 (a tela começa sem esperar ninguém)
```

**Caminho crítico:** D1.1 → D1.2 → D2.1 → D2.3 → D3.5. Se D1.2 atrasar, todos atrasam: ele é o
primeiro foco do Dev 1.

---

## 7. Se faltar tempo: o que cortar, nesta ordem
1. D1.9 Calendário do cofre
2. D3.6 Tela Prova (mostrar os números num slide)
3. D3.7 URL pública (demo local)
4. D2.8 Turno auditado
5. D1.6/D1.7 Monitor e agendador (mostrar a linha do tempo de turnos rodados por script)

**Nunca cortar:** encaixe técnico com citação, dossiê, política com escalada, envio com verificação.

---

## 8. Definição de pronto (vale para toda tarefa)
1. Teste escrito antes da regra nova, e passando.
2. Funciona num pregão real, não só no cache.
3. Aparece na linha do tempo (`events`) com rastro, tempo e custo.
4. Tem o caminho de exceção testado.

---

## 9. Riscos de execução

| Risco | Quem resolve | Resposta |
|---|---|---|
| Contratos mudam no meio do caminho | Todos | Mudança só nos pontos de sincronização |
| Turno continua lento | Dev 2 | Menos pregões por turno; a linha do tempo da manhã mostra o volume |
| PNCP instável na demo | Dev 1 | Cache pré-carregado (D1.8) |
| Nenhum evento real para o monitor | Dev 1 | Usar um dos 4 pregões suspensos achados; em último caso, cenário de teste rotulado |
| Pitch sem ensaio | Dev 3 | Pitch começa às 20:30, não depois do código |
| Chave vazar | Todos | `.env` no `.gitignore`; conferir `git status` antes de cada commit |
