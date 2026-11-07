# Runbook de domingo 08/11 — agente trabalhando sozinho até a submissão (13h)

> Dono: Dev 1. Depende do PR #15, a fase de ações (`--demo N --uma-vez` e o envio pela porta).
> Medição de referência: 1 pregão por turno = 428,5 s e US$ 0,0867 (turno real de 07/11, docs/dev1-dados-regras-politica.md, tarefa 11).

## Sábado à noite (preparação)
1. `git pull` na main, `npm ci`, `npm test`, `npm run typecheck` e `npm run build` (gera `web/dist` para o modo integrado).
2. Conferir `.env` com `AI_API_KEY` (sem exibir o valor) e o cache em `cache/`. Os dois ficam fora do Git.

## Domingo
| Hora | Quem | O quê |
|---|---|---|
| 07:45 | Dev 1 | `npm run demo:preparar`: refaz `fixtures/demo.json` e pré-carrega o cache. Conferir os avisos: o suspenso continua suspenso? Sessões ainda futuras? |
| 08:00 | Dev 1 | Terminal 1: `LANCE_DB=data/domingo.db LANCE_PREGOES_POR_TURNO=2 npm run agendador -- --demo 30` |
| 08:00 | Dev 3 | Terminal 2: `LANCE_DB=data/domingo.db npm run integrado`, depois abrir http://127.0.0.1:8080 |
| 08:00–10:00 | todos | Acompanhar a linha do tempo. Não reiniciar o agendador (ver "Cuidados") |
| 10:00 | todos | **Congelamento**: nada novo na main; só correção, por PR revisado |
| 11:00 | agendador | Turno das 11h sozinho: reavalia o que o monitor marcou |
| 13:00 | — | Submissão |

### O que o agendador faz a partir das 08:00
- Turno de demonstração em 30 s: analisa 2 pregões da demo, tira a foto e roda a fase de ações (esclarecimento com evidência, proposta só com tudo em `disputar`).
- Logo depois, o tick roda o turno das 07:00, que é o mais recente já passado: os pregões restantes, incluindo o edital ilegível (ZIP).
- O recheque barra o suspenso (`bloqueio`). O monitor roda a cada 30 min e marca `reavaliar` quando o pregão muda.
- O custo e o tempo de 2 pregões por turno não foram medidos. A estimativa linear pela referência é de cerca de 14 min e US$ 0,17 por turno.

### Como saber que está funcionando
- Linha do tempo: `turno_inicio` → `analise_item` → `decisao` → `esclarecimento_enviado` / `escalada_aberta` → `turno_fim`, com o resumo "ações: …".
- Evento `bloqueio` do pregão suspenso 60448040000122/2026/701.
- Escaladas abertas aparecem na tela; a decisão humana grava no mesmo banco (o store espera a trava do agendador por até 5 s).

## Cuidados
- **Não reiniciar o agendador depois de um envio.** O sandbox é em memória: ao reiniciar, os protocolos somem e uma ação pendente cai em `reconciliar`. Se precisar reiniciar, use um banco novo.
- Um banco só para domingo (`data/domingo.db`), sem misturar com os testes de sábado.
- Sem o `.env`, o agendador cai antes do turno (`featherless()` exige a chave).

## Plano B
| Falha | Resposta |
|---|---|
| PNCP fora do ar | Reiniciar com `LANCE_OFFLINE=1` (usa só o cache pré-carregado), num banco novo |
| Modelo fora do ar ou lento | `npm run demo` (modo amostra) + vídeo de reserva (Dev 3) |
| Turno passando de 15 min | `LANCE_PREGOES_POR_TURNO=1`, num banco novo |
| Tela sem dados | Conferir que os dois terminais usam o mesmo `LANCE_DB` |

## Depois da demo (opcional)
- Snapshot sem segredos para reproduzir a tela: `node scripts/banco-demo.ts exportar data/domingo.db out/domingo.json`.
