# Auditoria do agente (08/11/2026)

Auditoria do comportamento do agente de análise, do edital escolhido até o veredito e os documentos. Responde com
evidência o que cada ação contribui, onde há repetição, se a conclusão bate com o que foi persistido e se o escopo
prometido é coberto. Empresa, catálogo, custos e política são **sintéticos**; pregões, itens, editais e ANVISA são reais.

## Como medir

| Peça | O que faz | Limite |
|---|---|---|
| `src/lib/auditoria.ts` · `eficiencia` | Classifica cada repetição do rastro gravado: `correcao_apos_rejeicao` e `cobertura_perseguida` (necessárias), `releitura_apos_compactacao` (o resultado saiu do histórico compactado), `refeito_sem_motivo`, `decisao_sem_dado_novo` e `leitura_identica` (evitáveis). Conta rejeições de evidência e chamadas por item. | Lê o rastro; não julga se o veredito do modelo está certo. |
| `src/lib/auditoria.ts` · `consistencia` | Contradições entre store, fila, dossiê, veredito e PDFs: decisão viável sem cobertura conferida, preço ou quantidade da proposta diferente do calculado, item escalado sem escalada, encaixe sem decisão e sem escalada, citação que não está na descrição, publicação não conferida omitida, candidatos não analisados omitidos. | Lista vazia = coerente, não = correto. |
| `test/cenarios-agente.test.ts` | 16 cenários **sintéticos** com modelo roteirizado e fontes simuladas, mas ferramentas, decisão, store, leitura e PDF reais: sucesso, incompatibilidade, informação ausente, citação inventada, fonte fora do ar, limite de passos, interrupção antes da decisão, edital alterado, escopo, marca de referência sem marca, candidatos no pedido, classificação de falhas e incoerência plantada. | Provam o código, não a qualidade do modelo. |
| `scripts/auditoria-agente.ts` | Roda o **agente real** (Kimi-K2.6 + PNCP) num banco novo, com teto de custo, e grava rastro, tokens, custo, eficiência e coerência em `out/auditoria/`. | Custa dinheiro; uma execução por pregão não é amostra estatística. |

Não medido: concordância humana, precisão do julgamento técnico, latência de publicação no PNCP.

## Defeitos encontrados e corrigidos

1. **Cobertura técnica rejeitava citações corretas** (`src/lib/cobertura.ts`). A descrição do Compras.gov.br vem como
   "nome do item campo: valor, …, campo: valor TEXTO LIVRE DO ÓRGÃO". O corte só por vírgula colava o nome do item ao
   primeiro campo e o texto livre ao último. "tamanho: nº 4" virava lacuna; o modelo refazia o `record_fit` até citar o
   texto livre inteiro como se fosse o tamanho, ou desistia. Agora: o nome do item não é exigido, o texto livre é uma
   exigência própria, a repetição em maiúsculas iniciais (pregão 22617) não duplica campos, e campos diferentes com o
   mesmo fim de nome continuam separados. Conferido nas 22 descrições reais em cache dos 3 pregões da demo.
2. **Análise interrompida deixava itens sem decisão e sem humano** (`persist-analysis.ts`). Encaixe gravado sem
   `decide_item` agora abre escalada com as exigências sem citação.
3. **Escopo não declarado** (`dossie.ts`, `experiencia-analise.ts`, `documentos.ts`, tela). O pré-filtro marca 11
   candidatos no pregão 348; o agente analisa até 3. Dossiê (`escopo`), pendências, veredito e relatório em PDF passam a
   dizer quais candidatos não foram analisados, em qualquer estado do veredito.
4. **Turno incompleto sem motivo** (`turn.ts`, `turnos.ts`, tela). O fim do turno registra se foi fonte indisponível,
   limite de passos, limite de tokens, agente sem decisão ou falha.
5. **Motivo de escalada genérico** (`tools.ts` · `decide_item`). "Encaixe técnico desconhecido" passa a nomear a
   exigência sem citação própria.
6. **Marca de referência sem marca** (`tools.ts` · `flag_restrictive`). Na execução real depois das correções, o modelo
   sinalizou marca de referência com um trecho que não fala de marca, e a ferramenta aceitou porque o trecho existia.
   Essa sinalização alimenta o motivo `marca_referencia` do esclarecimento automático. Agora o trecho precisa falar de
   marca, referência, similar, equivalente ou "ou superior" (condição necessária, não suficiente), e uma sinalização
   aceita depois da decisão descarta a decisão antiga.

## Agente real: antes × depois

Mesmo pregão (77816510000166/2026/348), mesmo modelo, mesmo prompt, mesmo teto.

| | Antes (`base-348`) | Depois (`depois-348`) |
|---|---|---|
| Duração | 697 s | 474 s |
| Custo | US$ 0,146 | US$ 0,071 |
| Chamadas ao modelo / ferramentas | 21 / 50 | 11 / 26 |
| Tokens de entrada / saída | 240.559 / 22.722 | 95.671 / 10.496 |
| `record_fit` | 25 (20 perseguindo cobertura, 3 idênticos) | 6 (3 perseguindo cobertura) |
| Repetições evitáveis | 3 | 0 |
| Como terminou | limite de tokens, frase pela metade | resumo final |
| Decisões persistidas | **0** (itens 4 e 39 sem decisão nem escalada) | 3: item 3 e 39 `nao_disputar`, item 4 `esclarecer` |
| Coerência (auditor atual) | 2 contradições | 0 |

Leitura do resultado depois: item 3 pede nº 3 e o produto é nº 4; item 39 tem divergência técnica com a ficha; item 4 não
tem "longo" na ficha e o rascunho de esclarecimento pergunta exatamente isso. O veredito pede revisão e avisa 8
candidatos não analisados. A sinalização de marca sem marca dessa execução motivou a correção 6, conferida em teste;
o modelo real não foi reexecutado depois dela no pregão 348.

## Agente real em outro formato de edital (pregão 00394429000100/2026/2941)

235 itens, descrição "Campo:Valor" em maiúsculas iniciais, 5 candidatos no pré-filtro (182, 198, 223, 224, 225).

| | `depois-2941` | `depois2-2941` (candidatos no pedido) |
|---|---|---|
| Duração | 412 s | 222 s |
| Custo | US$ 0,103 | US$ 0,046 |
| Chamadas ao modelo / ferramentas | 26 / 72 | 10 / 15 |
| `get_tender_items` / `get_tender_item` | 41 / 18 (abriu até "Pincel Arte Plástica") | 3 / 6 |
| Repetições evitáveis | 5 | 0 |
| Encaixes / decisões | 0 / 0 | 0 / 0 |
| Motivo registrado | (classificação errada, corrigida: "produto P3" não é fonte indisponível) | agente encerrou sem decisão persistida |

7. **Busca às cegas** (`onboarding.ts`). O pré-filtro sabia os candidatos, mas o pedido ao agente dizia só "analise o
   pregão". O pedido agora traz os candidatos, marcados como não comprovados. Efeito medido: de 26 para 10 chamadas.
8. **Descarte só em texto livre** (`onboarding.ts`). Na segunda execução o modelo concluiu corretamente que nenhum dos
   5 candidatos atende (nº 3 × nº 4; 14 cm × 20 cm; modelos Íris e Spencer fora do catálogo), mas só no resumo, sem
   citação conferida nem decisão do código; a tela mostra, com razão, "incompleto". A frase que eu tinha acrescentado
   ("se nenhum servir, diga isso no resumo") favorecia isso. O pedido agora exige `record_fit` e `decide_item` também
   para o candidato que não atende. **Validado só em teste**: o teto de custo da auditoria não permitiu outra execução real.
9. **Motivo de turno incompleto** (`turn.ts`): só rede, HTTP ou tempo esgotado conta como fonte indisponível; produto
   ou item inexistente aparece como erro de uso de ferramenta.

Custo total das execuções reais desta auditoria: US$ 0,366 (teto: US$ 0,40).

## Riscos restantes

- **Uma execução por pregão.** O modelo é estocástico; os números acima são uma amostra, não uma média.
- **Julgamento técnico do modelo não é medido.** Citação e cobertura são conferidas; "atende" continua julgamento.
- **Tempo.** 474 s ainda está longe da meta de 3 minutos; a latência é do modelo (11 chamadas).
- **Escopo limitado a 3 itens** por instrução do prompt; agora declarado, não resolvido.
- **Descarte com evidência (correção 8) não comprovado com o modelo real**; o 2941 ainda pode terminar sem decisão.
- **Correção 6 (marca sem marca) não reexecutada com o modelo real.**
- **Marca de referência**: o filtro lexical barra trechos sem marca, mas não distingue "informar a marca" de restrição.
- **Trava entre processos** (agendador × servidor) continua pendente, fora desta auditoria.
