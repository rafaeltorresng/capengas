# Lance | Revisão local do Dev3

## Rodar a demo

Com Node 24, rode os comandos abaixo na raiz do repositório.

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
npm.cmd run demo
```

Abra `http://127.0.0.1:8080`. O servidor de demo carrega a amostra sintética em memória. Reinicie o processo para restaurar a escalada inicial.

1. Em **Hoje**, abra o rastro do turno. Siga o evento de esclarecimento até o item 40 e abra o PDF de exemplo na citação. Os links de PNCP e ANVISA levam aos portais de consulta.
2. Abra o **Dossiê** do pregão 17 e confira a CND que vence antes da sessão.
3. Em **Escaladas**, escolha **Ajustar**, descreva a correção e registre a decisão. A escalada sai da lista aberta. Volte a **Hoje** e confira o evento de revisão humana.
4. Volte à **Fila** para conferir os filtros por pregão, órgão e prazo. Termine em **Prova**, que identifica as medições históricas do spike e as pendências.

O wireframe segue a sequência hora, ocorrência e evidência. Em uma tela estreita, a evidência aparece abaixo da ocorrência. A confirmação do wireframe pela equipe está pendente.

## Publicar a amostra para a demo

Com o processo `npm.cmd run demo` ativo e o executável oficial do Cloudflare disponível, rode em outro terminal:

```powershell
cloudflared tunnel --url http://127.0.0.1:8080
```

Abra a URL temporária em outro computador. Visitantes compartilham o estado descartável daquela instância. Reinicie o servidor da amostra antes de uma nova apresentação para reabrir a escalada inicial.

## Modo integrado

O adaptador em `src/server/integrated.ts` recebe a projeção de leitura do Dev2 e delega a decisão ao `resolveEscalation` do Dev1. Rode `npm.cmd run integrado` com o build pronto. O servidor usa `data/lance.db` ou o caminho definido em `LANCE_DB`. Para demonstrar o fluxo, use um banco preenchido pelo turno. O túnel público usa apenas a amostra interna.

Para revisar localmente a amostra sintética do Dev2 gere `fixtures/estado-exemplo.json` conforme a [issue #4](https://github.com/rafaeltorresng/capengas/issues/4) e rode `npm.cmd run demo -- --dev2`. O comando de demo padrão continua usando a amostra interna. Use o padrão para o túnel público.

A tela **Prova** identifica as medições pendentes. O resultado histórico de encaixe cobre seis pares com fichas sintéticas, avaliados três vezes. O protocolo na amostra interna é fictício e representa uma verificação no sandbox. A tela de item separa regularização na ANVISA de cobertura do produto ofertado.