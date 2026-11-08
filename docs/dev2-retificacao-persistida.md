# Retificação persistida — Dev 2, #25

O monitor, o dossiê e a Pauta passam a compartilhar o `DiffErrata`. A retificação é memória auditável, não autorização de envio.

## Fluxo e contrato

1. `monitor.ts` observa situação, arquivos e abertura. Guarda separadamente a abertura publicada (`abertura`) e a da análise (`aberturaAnalise`). O hash da análise continua intacto.
2. `errata.ts` confere as citações de item com o mesmo mínimo de 8 caracteres de `record_fit`. Um atributo sem citação impede reaproveitar o encaixe inteiro. Descrição vazia é ilegível. Custo ausente não vira zero.
3. `store.saveErrataDiff` grava o diff e sua versão em uma transação, atualiza `dossie.retificacao` se houver dossiê e mantém `reavaliar`. Se ainda não houver dossiê, a versão fica no histórico e é ligada quando ele for gravado. Não altera itens, preços ou decisões da análise anterior.
4. `versaoDaRetificacao({ diff, versao, hoje, ajustes })` projeta os estados e recálculos do diff. Não compara texto novamente. `getRetificacoes(tenderId)` lê as versões na ordem em que foram gravadas.
5. `montarPauta` calcula as ações da retificação. `GET /api/dossies/:tender` usa as mesmas linhas de `GET /api/pauta`, inclusive IDs, fontes, responsáveis e datas. O art. 55, §1º permanece na versão; a ação do art. 164 é conferida contra o dia corrente em Recife. Uma linha cujo prazo passou continua informativa. Abertura desconhecida não recebe data ou ação.
6. O dossiê exibe a retificação atual, o bloqueio de envio e o histórico. Os itens da análise anterior permanecem para auditoria, claramente separados dos recálculos.

`itensSemReleitura` conta itens com evidência reaproveitada pelo diff. Não mede chamadas poupadas: um item pode consumir várias chamadas e o turno ainda não usa este plano para restringir as ferramentas. O campo antigo `chamadasEvitadas` foi removido. `custoEvitadoUsd` permanece nulo, sem aceitar custo hipotético por chamada.

## Repetição, falhas e decisões humanas

- A publicação observada (`DiffErrata.publicacao`) tem hash dos arquivos, abertura e instante de observação. Ela não substitui a foto da análise usada pelo recheque.
- Outra publicação enquanto `reavaliar` está ativo gera nova versão. A mesma publicação não duplica a versão. Falha de leitura não avança a publicação observada: o monitor tenta novamente.
- Todos os diffs enquanto a análise estiver pendente comparam com a mesma foto analisada; a segunda errata não usa a primeira como se já estivesse analisada.
- Uma escalada nova guarda a versão da retificação na qual foi aberta (zero identifica a análise anterior à primeira retificação). Sua resolução e auditoria continuam atômicas. O ajuste do item reaparece na versão seguinte como `informado_cliente`, sem modificar a versão antiga e sem substituir fatos publicados.
- Escaladas legadas sem vínculo continuam sem vínculo; não são atribuídas retroativamente a uma versão.
- A porta `executarAcao` verifica `reavaliar` antes e depois do recheque, antes de criar intenção. Uma ação já enviada continua podendo reconciliar o protocolo, sem novo POST.

## Banco e snapshots

A migração acrescenta `errata_diffs.versao_json`, `escalations.versao_retificacao` e `tenders.abertura_analise`. A abertura da análise é gravada em JSON para distinguir ausência de valor legado de uma abertura explicitamente desconhecida. Diffs antigos continuam legíveis; nenhuma versão retroativa é inventada.

O exportador `scripts/banco-demo.ts` produz snapshot versão 2, incluindo `errata_diffs` e os vínculos de escalada. O importador continua aceitando o snapshot versão 1 de `fixtures/execucoes`, no qual a tabela de erratas era ausente. Bancos, snapshots gerados, CSVs e segredos continuam fora do commit.

## Reprodução sem modelo

Use um banco novo e descartável; os comandos abaixo não alteram o snapshot versionado:

```bash
node scripts/banco-demo.ts importar out/retificacao.db fixtures/execucoes/analise-2026-11-07.json
LANCE_OFFLINE=1 LANCE_DB=out/retificacao.db node scripts/errata-sintetica.ts
npm run build
LANCE_DB=out/retificacao.db npm run integrado
```

Abra Pauta e o dossiê `77816510000166/2026/348`. O script altera a quantidade à mão: **não é retificação publicada**. Empresa, catálogo, custos e cofre continuam sintéticos; o edital é o do cache real, conforme `fixtures/README.md`. A reprodução pode manter exigências ilegíveis se faltar o PDF no cache; isso não libera decisão.

## Verificação e limites

Os testes cobrem monitor → SQLite reaberto → API/dossiê/Pauta, segunda publicação pendente, repetição, retomada após falha inclusive só de abertura, rollback de diff/versão, migração legada, snapshot exportado/importado, ajuste humano e bloqueio de intenção/POST. Quantidade e limite agregado são recalculados pelo código. Texto ilegível não chama modelo nem entra na conta de reaproveitamento.

A conferência visual usou uma cópia temporária do snapshot publicado e a errata sintética, sem nova execução Featherless ou consulta ao PNCP. Não mede concordância, custo ou latência do modelo. Nenhum envio foi feito.

Este corte não muda a seleção preparada da carteira nem a reanálise do agendador. A versão identifica os itens que exigem agente, mas o turno ainda precisa consumir esse plano antes de prometer reanálise seletiva ou redução de chamadas. Também não incorpora a branch de pós-proposta do Dev 3: resultado publicado, ata, contrato, entrega e pagamento continuam próximos cortes, com fonte, dono e prazo quando sustentados. Casa do cliente, OCR e outros portais permanecem abertos à expansão; o envio real continua condicionado à credencial da empresa e ao passo humano explícito.
