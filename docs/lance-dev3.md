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

## Integração pendente

O contrato `DemoStore`, em `src/server/contract.ts`, separa as sete rotas da origem dos dados. O checkout inicial ainda não inclui o SQLite e as operações do Dev1, nem a exportação do turno, do dossiê e das métricas do Dev2. `npm.cmd run integrado` sinaliza essas dependências e encerra com erro.

Quando os contratos chegarem, implementar o adaptador sobre o store do Dev1, gravando a resolução e o evento juntos em uma transação. Depois, repetir o percurso com um pregão real e verificar a persistência. A amostra e o servidor HTTP dispensam a Featherless. A tela **Prova** apresenta os números já documentados no spike e identifica as medições pendentes.
