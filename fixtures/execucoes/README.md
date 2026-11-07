# Execução real de análise — 07/11/2026

`analise-2026-11-07.json` contém o resultado de uma execução Featherless Kimi-K2.6 do comando `scripts/analisar.ts` no código `88fc7ac`, sobre o pregão real `77816510000166/2026/348`. Empresa, catálogo, custos e cofre são sintéticos, conforme `company.json`.

Resultado: 1 pregão, 46 itens carregados, 3 encaixes, 4 exigências, 3 decisões, 1 dossiê, 3 escaladas abertas e 42 eventos. Nenhuma ação foi enviada. As três decisões escalaram porque a cobertura das exigências técnicas continua não verificada; isso não é uma medição de acurácia.

A execução encerrou em `final`, durou 292.040 ms (4min52s) e a API informou custo de US$ 0,062826164, 130.130 tokens de entrada e 9.722 de saída. A meta de turno em até 3 minutos não foi atingida. Não houve revisão humana completa dos julgamentos; concordância permanece não medida.

## Restaurar sem modelo ou APIs

Requer Node 24+. O destino deve ser um arquivo novo:

```bash
node scripts/banco-demo.ts importar data/validacao-dev3.db fixtures/execucoes/analise-2026-11-07.json
```

Na branch do PR #3, execute o modo integrado usando `LANCE_DB=data/validacao-dev3.db`. Em PowerShell:

```powershell
$env:LANCE_DB="data/validacao-dev3.db"
npm.cmd run integrado
```

Use uma cópia para testar decisões humanas: a resolução altera esse banco. O snapshot preserva os horários originais, as fontes e a auditoria; não renova prazos ou resultados. A importação foi testada com a projeção real: 3 itens, 3 escaladas e dossiê disponíveis, custo igual ao registrado na execução. O binário SQLite não é versionado.

Os eventos contêm citações rejeitadas e tentativas corrigidas pelo agente. Esses registros são parte da execução e não devem ser apresentados como conclusões aceitas. Não há chaves de ambiente no snapshot.
