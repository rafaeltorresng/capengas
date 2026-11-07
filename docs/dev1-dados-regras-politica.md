# Dev 1 — plano de dados, regras e política

> Escopo: tudo que é **determinístico** no Lance: dados públicos, regras de negócio, política da
> empresa, persistência do estado, recheque, monitor e agendador.
> **Regra de ouro desta parte:** nenhuma ação sai do sistema sem passar pela política, e nenhuma
> regra existe sem teste escrito antes.

---

## 1. O que já existe (no spike, testado)

| Módulo | O que faz | Testes |
|---|---|---|
| `http.ts` | `fetchJson`: retry com backoff e jitter, timeout, cache em disco, cache vencido como reserva quando a rede falha | 7 |
| `data.ts` | **PNCP:** busca de abertos, compra, itens paginados, arquivos, download. **Compras.gov.br:** histórico de preço. **ANVISA:** CSV → SQLite, busca por registro e por nome. **PDF:** texto via `pdftotext`, detecta ZIP e escaneado. **CATMAT:** busca de texto | 9 de contrato, contra as APIs reais |
| `rules.ts` | `checkAnvisa`, `verifyQuote`, `esclarecimentoDeadline` (dias úteis + feriados nacionais 2026), `decideItem`, `priceStats`, `brandConcentration`, `suggestPrice`, `normalizeBrand` | 27 |
| `schema.ts` | Validador de argumentos (JSON Schema mínimo) | (nos testes do agente) |
| `sandbox.ts` | Portal de teste: recebe propostas e esclarecimentos; consulta proposta por protocolo | 4 |

## 2. O que falta (lacunas encontradas nos testes reais)

| Lacuna | Origem |
|---|---|
| Estado só existe em memória; nada persiste entre turnos | O agendador e o monitor precisam lembrar |
| Nenhuma política: o envio dependia de um clique | Plano v2 (autonomia) |
| A regra de preço usa o histórico, que o backtest refutou | Backtest de 494 itens |
| Envio para pregão **suspenso** | Turno real de hoje |
| Sem verificação de esclarecimento enviado | Turno real de hoje |
| Sem detecção de mudança no pregão (errata, documento novo) | 4 de 40 pregões suspensos, 1 errata |
| Pregões de outras plataformas misturados aos do Compras.gov.br | Só os do Compras.gov.br trazem código |
| Base ANVISA carregada de um arquivo manual | Precisa de script de atualização |
| Cofre de documentos sem regra de validade por sessão | Turno real (CND vence antes da sessão) |

---

## 3. A ordem de trabalho

Primeiro o que é **regra pura** (mais valor, sem dependência, fácil de testar). Depois a
**persistência**, e por fim o que roda **no tempo** (monitor e agendador).

| # | Tarefa | Tempo | Por que nesta posição |
|---|---|---|---|
| **1** | ✅ Portar o núcleo para o repositório (feito em 07/11) | 30 min | Base de tudo; os testes provam que nada quebrou |
| **2** | ✅ Regras novas: preço pela estimativa, cofre × sessão, estados de decisão (dfa525f) | 45 min | Corrige a decisão com o que aprendemos hoje |
| **3** | ✅ `policy.ts`: a política da empresa | 1 h | É o coração da autonomia; função pura |
| **4** | ✅ `store.ts`: estado em SQLite | 45 min | Necessário para recheque, monitor e agendador |
| **5** | ✅ Recheque antes de agir (verificação de esclarecimento: pendente) | 1 h | Corrige as duas falhas reais do turno |
| **6** | `monitor.ts`: detectar mudança nos pregões acompanhados | 1 h | Reação a eventos reais |
| **7** | `scheduler.ts`: turnos e monitor sem clique | 30 min | Autonomia de verdade |
| **8** | Dados da demo: filtro Compras.gov.br, atualização da ANVISA, cache pré-carregado | 45 min | Demo estável |
| 9 (desejável) | Calendário do cofre | 45 min | "Renove a CND até X ou perde N pregões" |
| 10 (desejável) | Semáforo financeiro do órgão (SICONFI) | 1 h | Informação extra no dossiê |

---

## 4. Detalhe de cada tarefa (testes primeiro)

### Tarefa 1 — Portar o núcleo
- Copiar para `src/lib/`: `http.ts`, `data.ts`, `rules.ts`, `schema.ts`, `sandbox.ts`. Copiar os testes para `test/`.
- `package.json` com `"type": "module"` e o script `test` (`node --test test/*.test.ts`); testes
  de rede separados em `test:live`.
- Caminhos configuráveis por variável de ambiente: `LANCE_CACHE_DIR`, `LANCE_DATA_DIR` (CSV da ANVISA, CATMAT).
- **Pronto quando:** todos os testes do spike passam no repositório, sem depender do scratchpad.

### Tarefa 2 — Regras novas (`rules.ts`)
**2a. Preço pela estimativa, não pelo histórico**
- `priceCheck({ custo, margemMinima, margemAlvo, estimativa, sigiloso })` →
  `{ viavel, precoProposto, motivo }`.
- Viável se `custo × (1 + margemMínima) ≤ estimativa`. Preço proposto = `min(estimativa, custo × (1 + margemAlvo))`.
- Orçamento sigiloso ou sem estimativa → `viavel: null` e motivo "sem estimativa: escalar".
- **Testes:**
  - custo baixo → viável, com o preço entre o mínimo e a estimativa;
  - custo + margem acima da estimativa → não viável;
  - preço proposto nunca acima da estimativa;
  - sigiloso → escalar.

**2b. Cofre × data da sessão**
- `checkDocs(cofre, exigencias, dataSessao)` → para cada exigência: documento correspondente, validade e status.
- Mapa exigência → documento: `afe` → AFE; `certidoes` → CND Federal, CRF FGTS, CNDT.
- Status `ok`, `vence_antes_sessao` ou `faltando`.
- **Testes:**
  - AFE válida → ok;
  - CND vence em 15/11 e a sessão é em 23/11 → `vence_antes_sessao`;
  - exigência sem documento no cofre → `faltando`.

**2c. Estados de decisão**
- `decideItem` passa a devolver: `disputar`, `disputar_com_pendencia`, `esclarecer`, `escalar` ou `nao_disputar`, com motivos.
- Ordem: restritivo ou variante não coberta com prazo aberto → `esclarecer`; não atende, registro
  inválido ou preço inviável → `nao_disputar`; atributo não informado → `esclarecer` (prazo aberto)
  ou `escalar` (prazo vencido); documento pendente → `disputar_com_pendencia`; senão → `disputar`.
- **Testes:** um para cada caminho, mais "não informado com prazo vencido → escalar".

**2d. Prazo de esclarecimento**
- Manter `esclarecimentoDeadline` (art. 164, padrão de 3 dias úteis) e aceitar o que vier do edital
  (`{ diasUteis, horaLimite }`).
- **Teste:** "até as 17h do 3º dia útil" → data + 17:00.
- **Limitação conhecida:** só feriados nacionais.

### Tarefa 3 — Política (`policy.ts`)
Configuração (em `fixtures/company.json`, campo `politica`):
```json
{
  "margemMinima": 0.15, "margemAlvo": 0.25,
  "valorMaxAutomatico": 50000,
  "exigirTodosAtributosAtende": true,
  "esclarecimentosAutomaticos": ["nao_informado", "variante_nao_coberta", "marca_referencia"],
  "sempreEscalar": ["impugnacao", "valor_acima_limite", "prazo_vencido_com_duvida", "pregao_alterado"],
  "turnos": ["07:00", "11:00", "15:00"], "monitorMinutos": 30
}
```
- `evaluate(acao, contexto, politica)` → `{ permitido: boolean, escalar: boolean, motivo: string }`.
- `acao`: `enviar_proposta`, `enviar_esclarecimento` ou `impugnar`.
- **Testes:**
  - proposta com todos os atributos ✅, documentos ok e valor ≤ limite → permitido;
  - valor > limite → escalar;
  - qualquer atributo ❓ → escalar;
  - documento `vence_antes_sessao` → escalar;
  - esclarecimento de tipo permitido → permitido;
  - impugnação → sempre escalar;
  - pregão alterado desde a análise → escalar;
  - política ausente ou inválida → **nada permitido** (falha segura).

### Tarefa 4 — Estado (`store.ts`)
- `node:sqlite`, arquivo em `LANCE_DATA_DIR/lance.db`.
- Tabelas: `tenders`, `items`, `fits`, `requirements`, `decisions`, `dossies`, `actions`, `escalations`, `events`.
- Funções com **upsert** (gravar duas vezes atualiza, não duplica) e `logEvent(tipo, resumo, rastro)`.
- **Testes:**
  - grava e lê cada tabela;
  - upsert não duplica;
  - eventos em ordem de horário;
  - escalada muda de `aberta` para `decidida` com a decisão gravada;
  - banco novo cria as tabelas sozinho.

### Tarefa 5 — Recheque e verificação
- `recheckTender(id)`: busca a situação e os arquivos no PNCP e compara com o que foi guardado na análise.
  - Situação suspensa, revogada, anulada ou cancelada → `bloquear`.
  - Hash da lista de arquivos mudou → `bloquear` + `reavaliar`.
- `sandbox.ts`: rota `GET /api/esclarecimentos/:protocolo` + `verifyEsclarecimento`.
- **Testes:**
  - pregão suspenso (fixture real: um dos 4 encontrados) → bloqueia;
  - arquivo novo → bloqueia e marca;
  - pregão inalterado → libera;
  - PNCP fora do ar → **não libera** (falha segura) e registra evento;
  - esclarecimento enviado → consultável por protocolo.

### Tarefa 6 — Monitor (`monitor.ts`)
- Para cada pregão acompanhado e ainda aberto: rodar o recheque; quando algo mudar, gravar um evento
  e marcar os itens para reavaliação.
- Pregões encerrados saem do acompanhamento.
- **Testes:**
  - mudança de situação → evento + marcação;
  - arquivo novo → evento;
  - nada mudou → nenhum evento duplicado;
  - falha de rede → tenta no próximo ciclo e registra.

### Tarefa 7 — Agendador (`scheduler.ts`)
- Dispara turnos nos horários da política e o monitor a cada N minutos.
- **Trava:** nunca dois turnos ao mesmo tempo.
- Registra início e fim de cada turno em `events`.
- Modo demo: "rodar o próximo turno daqui a X segundos".
- **Testes:** com relógio falso:
  - dispara no horário;
  - não sobrepõe turnos;
  - registra os eventos.

### Tarefa 8 — Dados da demo
- Filtro: só pregões cuja `compra.usuarioNome` é `Compras.gov.br`.
- Script `scripts/atualizar-anvisa.ts`: baixa o CSV oficial, converte de Latin-1 para UTF-8 e reimporta.
- Script `scripts/preparar-demo.ts`: escolhe de 2 a 3 pregões com itens compatíveis com o catálogo
  + 1 suspenso ou com errata; pré-carrega o cache; grava `fixtures/demo.json`.
- **Pronto quando:** a demo roda com a rede desligada, a partir do cache.

---

## 5. Contrato mínimo com o resto do sistema

Só o necessário para quem consome esta parte:
- **Funções puras:** `priceCheck`, `checkDocs`, `decideItem`, `evaluate` (política), `verifyQuote`, `esclarecimentoDeadline`.
- **Estado:** `store.*` (upserts, leitura e `logEvent`).
- **Antes de qualquer ação externa:** `recheckTender` → `evaluate` → executa → verifica → `logEvent`.

---

## 6. Critérios de pronto desta parte
1. Todos os testes passando (`npm test`), e os de rede em `npm run test:live`.
2. **Nenhum caminho de ação externa sem `recheckTender` + `evaluate`** (com teste que prova isso).
3. Toda falha de rede ou de dado resulta em **não agir**, nunca em agir às cegas.
4. Cada decisão e ação gera um evento com motivo.
