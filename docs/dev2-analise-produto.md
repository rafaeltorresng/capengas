# Lance — revisão de produto e prioridades do Dev 2

Data: 07/11/2026. Autoria: análise do Dev 2 para discussão da equipe.

Este documento revisa a proposta, os cinco documentos de `docs/` existentes e o código disponível. As recomendações **não são uma mudança de escopo aprovada**. O pedido atual permite questionar o escopo; os contratos com os outros devs devem continuar estáveis até alinhamento. Nenhum código de execução foi alterado nesta revisão.

## 1. Recomendação

Manter distribuidoras de material médico como entrada e concentrar o hackathon em um trabalho completo: **preparar uma participação por item, resolver as pendências que estiverem ao alcance do agente e entregar um pacote conferível, aplicando a política antes de agir**.

A promessa comercial a validar é diminuir o tempo humano necessário para preparar cada participação, mantendo controle sobre erros críticos. Redução de desclassificações é um resultado de piloto; ainda não é um benefício medido.

Não ampliar agora para uma plataforma que também faz CRM, contratos, crédito e pós-venda. Essa visão pode ser ampla no futuro, mas a demonstração deve fechar um trabalho reconhecível. O principal ajuste é aprofundar a resolução de exceções, e não acrescentar telas.

O diferencial proposto é operacional: encontrar um impedimento, buscar uma alternativa permitida, recalcular, atualizar os artefatos e comprovar o que foi concluído. **É uma hipótese competitiva, não exclusividade demonstrada.**

## 2. Qual problema estamos comprando do cliente?

O comprador não paga para o governo ter menos itens fracassados. Ele paga para seu próprio time preparar mais participações corretas com a capacidade que já tem.

Trabalho atual a investigar: localizar oportunidades → selecionar itens → comparar especificações com produtos → conferir regularização e documentos → escolher produto/preço → preparar proposta → tratar dúvidas → acompanhar alterações. A hipótese é que leitura e reconciliação entre essas fontes concentram trabalho repetitivo e revisão especializada.

Consequências possíveis: horas de analista e responsável técnico, oportunidades ignoradas por falta de capacidade, retrabalho e desclassificações evitáveis. Não temos entrevistas nem dados de clientes que quantifiquem essas consequências.

Não confundir:

- Item fracassado: desfecho da compra pública; pode ter diversos motivos e vários participantes.
- Proposta desclassificada: desfecho de um participante; outro pode vencer o mesmo item.
- Empresa sancionada: outro evento, frequentemente ligado à execução contratual; não demonstra que a leitura do edital teria evitado a sanção.

Por isso, a taxa de fracasso não mede diretamente a taxa de erro do nosso cliente, nem a parcela que conseguimos resolver.

## 3. Cliente e entrada no mercado

**Perfil inicial, ainda hipotético:** distribuidora ME/EPP que já disputa compras públicas, possui catálogo recorrente e documentação organizada, tem 1–3 pessoas na operação e encontra mais itens relevantes do que consegue revisar confortavelmente. Priorizar famílias de consumíveis com especificações comparáveis; não assumir que todo material médico tenha a mesma complexidade.

| Papel | Interesse | O que precisamos descobrir |
|---|---|---|
| Dono ou gerente comercial | Capacidade, margem e risco operacional | Quem aprova gasto e qual ganho justificaria a compra? |
| Analista de licitações | Menos leitura e retrabalho | Onde gasta tempo e quais conclusões precisa revisar? |
| Responsável técnico/regulatório | Correspondência do produto e documentação | Quais evidências bastam para aceitar uma comparação? |
| Fabricante/importador, como parceiro | Manter fichas e modelos corretos | Consegue fornecer documentação confiável e atualizada? |

Começar com empresas que já possuem buscador/ERP: importar uma oportunidade ou uma lista de produtos e entregar o pacote de preparação. Não exigir substituir toda a operação para testar o valor. Consultorias especializadas podem ser canal posterior; multiempresa amplia requisitos de isolamento e não precisa entrar na demo.

**Custo de entrada escondido:** o catálogo fictício está pronto e limpo. No cliente, fichas podem estar incompletas, em PDFs ou sem ligação confiável ao modelo. Medir tempo de cadastro e de atualização. A base de evidências deve ser reaproveitada nas análises seguintes; sem isso, o serviço pode virar consultoria manual.

## 4. O que os números realmente sustentam

| Evidência | Situação nesta revisão | Uso defensável |
|---|---|---|
| R$ 1 trilhão homologado no PNCP em 2025, mais de 1 milhão de compras | Confirmado em publicação oficial via MGI | Contexto do mercado de compras públicas; não é o TAM de software |
| HC-UFPE: 13,17% de itens fracassados + 6,22% desertos, em 819 pregões de 2017–2022 | Localizado em nota técnica da UFPE | Evidência histórica e local de compras sem sucesso; não causalidade ou taxa nacional atual |
| 16–21% de fracasso em duas classes de saúde | Registrado na pesquisa interna; script localizado; coleta não refeita | Só usar com período, classe, denominador, metodologia e artefato do cálculo |
| 1.647 pregões abertos / ≥ R$ 3,8 bi | Medição interna documentada; coleta não refeita | Fotografia de busca por quatro termos, sem extrapolar para faturamento do cliente |
| 5.513 fornecedores e 3.999 ME/EPP | Contagens internas documentadas; não recontadas | Base cadastrada no recorte de CNAE, não número de compradores qualificados |
| 145 empresas com sanção vigente | Contagem interna; não reproduzida | Não usar como prova de que o produto evitaria sanções |
| Encaixe 18/18 | Documento relata seis pares repetidos três vezes; gabarito confirmado | Pequeno teste de consistência; não 18 casos independentes ou 100% de precisão em produção |
| US$ 0,22 / turno de 15 itens; 12,5 min + 1,7 min | Execução anterior relatada, sem novo turno nesta revisão | Referência inicial; não custo marginal garantido nem latência atual medida |
| Testes locais | `npm test` executado nesta revisão: 55 passaram | Verifica a bateria local existente; não comprova integração ao vivo |

O gabarito usa itens de editais reais com fichas sintéticas escritas para produzir determinados resultados. Um caso aceita tanto `atende` quanto `nao_informado`. Isso precisa aparecer na descrição do experimento.

O backtest refuta a utilidade das regras testadas de preço histórico nessa amostra. **Não prova que preço não causa fracassos, nem que complexidade regulatória seja a causa predominante.** A frase do pitch deve ser: “nosso teste não encontrou um filtro de preço histórico útil; concentramos o protótipo na preparação técnica e documental”.

Para as medições próprias, guardar antes do pitch: resposta bruta ou snapshot, parâmetros e horário da coleta, script/versão, tamanho da amostra, denominador e saída agregada. Hoje `out/` é ignorado pelo Git e os resultados anteriores não estão disponíveis neste checkout. Não apresentar números como revalidados nesta sessão.

Fontes: [MGI via Agência Gov](https://agenciagov.ebc.com.br/noticias/202601/ano-de-2025-e-marcado-pela-inovacao-no-mercado-de-compras-publicas-brasileiro); [nota técnica UFPE](https://agencia.ufpe.br/documents/39922/3386137/02-2024%2BGANHOS%2BDE%2BEFICI%C3%8ANCIA%2BCOM%2BA%2BIMPLANTA%C3%87%C3%83O%2BDO%2BPARECER%2BREFERENCIAL%2BNA%2BREDU%C3%87%C3%83O%2BDO%2BTEMPO%2BDE%2BTRAMITA%C3%87%C3%83O%2BDO%2BPROCESSO%2BLICITAT%C3%93RIO%2BO%2BCASO%2BDE%2BUM%2BHOSPITAL%2BUNIVERSIT%C3%81RIO.pdf/494bd46c-d746-41bc-bc79-0976d39c3b64); métodos internos em `lance-pesquisa.md` e `scripts/pesquisa/`.

## 5. Concorrência: a premissa precisa mudar

Leitura das páginas públicas em 07/11/2026. São funcionalidades anunciadas pelos fornecedores, sem teste autenticado, comprovação independente de desempenho ou conclusão sobre sua arquitetura interna.

| Concorrente/alternativa | O que anuncia | Implicação para o Lance |
|---|---|---|
| Olicita | Comparação de exigências com ficha, citações, checklist de habilitação e recorte de saúde com Anvisa | Sobreposição direta; catálogo + Anvisa + dossiê não sustenta sozinho uma alegação de originalidade |
| Effecti / Aimê | Perguntas e referências ao edital; validação e decisão permanecem com a equipe | Busca, leitura e referências já fazem parte da oferta estabelecida |
| Settle | Prospecção, aderência técnica, análise de editais, demanda e concorrência | “Usamos agentes para escolher editais” também tem concorrência |
| Axedro | Agentes coordenados, habilitação, propostas e gestão da operação; revisão humana | Nem “multiagente” nem “do edital à proposta” são diferenciais suficientes |
| ConLicitação | Resumo, perguntas ao edital, IA jurídica e geração de peças | Redigir esclarecimento ou impugnação isoladamente tem substitutos |
| Analista + responsável técnico + planilha + buscador | Processo flexível, conhecimento da empresa e responsabilidade clara | É o principal substituto: medir tempo total de revisão, confiança e esforço de adoção |

O Olicita publica planos mensais de R$ 199/15 pareceres, R$ 399/40, R$ 799/100 e R$ 1.299 com uso justo. Isso estabelece uma referência pública de preço, não valida nossa disposição a pagar.

A afirmação da pesquisa anterior de que nenhuma ferramenta encontrada cruza catálogo, Anvisa e documentos ficou desatualizada. Também não há base para afirmar que nenhum concorrente executa autonomamente: ausência de descrição na página não prova ausência da capacidade.

**Diferencial a testar:** conseguir concluir mais trabalho com menos intervenção, incluindo trocar por outro produto já autorizado do catálogo, buscar evidência faltante em fontes permitidas, reavaliar após alteração e provar cada ação. Comparar dois produtos com o mesmo edital e catálogo: tempo humano total, erros críticos, pendências realmente resolvidas e custo. Sem essa comparação, o diferencial continua proposto.

Fontes: [Olicita saúde](https://olicita.com.br/licitacoes-de-saude), [preços Olicita](https://olicita.com.br/precos), [Aimê](https://effecti.com.br/aime/), [Settle](https://www.settlegov.com/), [Axedro](https://www.axedro.com/plataforma/), [ConLicitação](https://conlicitacao.com.br/grupo-conlicitacao-faz-investimento-milionario-e-lanca-no-mercado-a-maior-plataforma-de-ia-para-licitacoes-publicas/).

## 6. Por que agentes e por que agora?

Agentes fazem sentido quando a próxima ação depende de evidência encontrada: escolher quais anexos ler, comparar candidatos, perceber uma lacuna, procurar documentação complementar, tentar outro produto e decidir quando parar/escalar. O resultado deve mudar o estado da participação e gerar artefatos úteis.

| Parte | Implementação adequada |
|---|---|
| Paginação, datas, cálculos, orçamento, persistência e agendamento | Código convencional |
| Interpretação de exigências e comparação de textos heterogêneos | Modelo com ferramentas e saídas estruturadas |
| Escolha de próxima diligência, alternativa ou escalada | Agente limitado por política, orçamento e número de tentativas |
| Autorização, validade, bloqueios e confirmação de protocolo | Código e consulta ao destino |

Uma agenda não prova capacidade agêntica. Uma sequência fixa com resumo também não. A prova é observar o sistema mudar de estratégia diante de uma pendência e verificar se terminou o trabalho corretamente.

O “agora” combina acesso centralizado a publicações e ferramentas de modelo que já executaram o fluxo no spike. O PNCP e a regulação não surgiram neste ano; evitar a narrativa de que os dados públicos só passaram a existir em 2026. O experimento da equipe indica viabilidade técnica inicial, ainda sem validação comercial.

## 7. Mercado e economia: contas sem inflar o TAM

Usando **provisoriamente** os cadastros internos e um preço **hipotético** de R$ 999/mês:

| Recorte | Conta anual | Interpretação |
|---|---|---|
| Todos os 5.513 cadastros do CNAE | 5.513 × 999 × 12 = R$ 66,09 mi | Teto aritmético desse recorte, com adoção de 100%; não TAM validado |
| 3.999 ME/EPP documentadas | 3.999 × 999 × 12 = R$ 47,94 mi | Teto antes de filtrar volume, catálogo, canal e disposição a pagar |
| 20 clientes | 20 × 999 × 12 = R$ 239.760 | Cenário de receita, não projeção comercial |
| 100 clientes | 100 × 999 × 12 = R$ 1.198.800 | Cenário de receita, não mercado já capturado |

Não somar segmentos por CNAE sem deduplicar CNPJs. Não multiplicar valor de pregões por uma taxa arbitrária para obter nosso mercado. Contratos públicos movimentados não são receita disponível para um fornecedor de software.

**ROI ilustrativo:** 150 itens/mês, 30 minutos humanos antes e 10 depois, hora de R$ 37,50 → 50 horas e R$ 1.875/mês de capacidade liberada. A R$ 799/mês, diferença de R$ 1.076, antes de cadastro, manutenção e demais custos. Todos os tempos, volume e custo/hora desse exemplo são hipóteses. Horas liberadas não significam automaticamente redução de caixa.

**Modelo a testar:** assinatura por empresa com franquia de análises e reavaliações; cobrar pela preparação e resolução, com pacote exportável. Testar inicialmente R$ 799–999/mês em piloto, condicionado a ganho medido. A proposta precisa justificar o preço frente ao concorrente de pareceres.

US$ 0,22/15 itens dá aproximadamente US$ 0,0147 por item naquela execução. Não extrapolar linearmente: leitura de edital é compartilhada, retries, catálogo, cache, revisão humana e hospedagem alteram o custo. Registrar custo por trabalho concluído, não só por chamada. Nenhum crédito Featherless foi consumido nesta revisão.

## 8. Riscos concretos encontrados no código

| Achado | Evidência | Consequência e encaminhamento |
|---|---|---|
| Encaixe vazio vira `atende` | `record_fit`, em `tools.ts`; reproduzido com `attributes: []` | Bloqueador Dev 2: recusar entrada vazia e exigir cobertura das exigências extraídas |
| Citações reais aceitam conclusão errada | Reproduzido: item “Tamanho 10 mm”, ficha “Tamanho 5 mm”, veredito `atende` → aceito | Existência da citação não verifica semântica; comparações estruturadas quando possível e evals de contradição |
| Exigência omitida não aparece no resultado | Não existe inventário obrigatório de atributos cobertos em `record_fit` | Avaliar completude, além de acerto dos atributos escolhidos pelo modelo |
| Anvisa verifica número e validade | `checkAnvisa` e `check_anvisa`; sem checar correspondência de modelo | Separar situação da regularização e comprovação do modelo; desconhecido bloqueia envio automático |
| Ficha, custo e cofre são sintéticos | Nota de `fixtures/company.json` | Rotular na demo; não apresentar ficha sintética como documento do fabricante |
| Preço histórico ainda decide | `decide_item` chama `priceHistory` e `suggestPrice` | Integrar a nova regra do Dev 1; retirar a dependência obrigatória de CATMAT da decisão, se alinhado |
| Apenas 25 itens chegam ao modelo | `get_tender_items` usa `slice(0, 25)` | API já pagina internamente; corrigir a janela da ferramenta, sem duplicar o trabalho de dados |
| Aprovação geral ainda é o fluxo | `request_approval`, `requiresApproval` e `scripts/turno.ts` | Política automática ainda não integrada; não alegar autonomia operacional concluída |
| Verificação ocorre depois do envio e usa data | `verify_submission`; não bloqueia suspensão antes da ação | Recheque fresco + política no caminho de envio; idempotência e verificação por protocolo |
| Estado só em memória | `newState`; sem `store.ts` neste checkout | Definir contrato com Dev 1 antes de integrar tela/agendamento |
| Resultado não salva páginas de origem | Texto dos PDFs é concatenado/normalizado | Link genérico do PDF não é navegação ao trecho; preservar identificação de arquivo e localização |

Os dois primeiros casos foram reproduzidos localmente, sem API externa ou modelo. A segunda reprodução prova que o validador aceita o erro; não mede a frequência com que o modelo comete esse erro.

**Correções regulatórias para os contratos:**

- A página oficial do serviço AFE de dispositivos médicos informa validade sem prazo. A data fictícia no cofre não deve virar regra de vencimento universal. Diferenciar ausência de prazo, documento ausente e situação/atividade não comprovada.
- Classes I e II usam notificação; classes III e IV, registro. Usar “regularização” como categoria abrangente, respeitando o enquadramento aplicável.
- Registro pode abranger uma família. Número existente e vigente não basta para demonstrar que a variante ofertada está coberta. Detentor não precisa ser a distribuidora: não exigir igualdade entre seus CNPJs.
- Ausência na base é “não localizado nesta fonte”, não prova automática de irregularidade ou dispensa. Escalar quando necessário.

Fontes oficiais: [AFE — Anvisa](https://www.gov.br/pt-br/servicos/solicitar-autorizacao-de-funcionamento-afe-dispositivos-medicos), [notificação](https://www.gov.br/anvisa/pt-br/setorregulado/regularizacao/produtos-para-saude/notificacao/notificacao-de-produtos-para-saude), [registro e famílias](https://www.gov.br/anvisa/pt-br/setorregulado/regularizacao/produtos-para-saude/registro/registro-de-produtos).

## 9. Recorte demonstrável e oportunidades de expansão

| Frente | Valor potencial | Decisão recomendada |
|---|---|---|
| Preparação técnica e documental por item | Próxima ao código existente e ao trabalho do analista | Núcleo da demo |
| Resolver lacunas de ficha e escolher alternativa no catálogo | Mostra ação contingente e pode reduzir intervenção | Aprofundar primeiro, após fechar o fluxo básico |
| Detectar mudanças e invalidar pacote anterior | Forte prova de confiabilidade | Uma exceção demonstrável, sem depender de evento novo ao vivo |
| Vigiar certidões e criar pendências | Útil, mas relativamente convencional | Parte do pacote, não narrativa central |
| Fornecedor alternativo fora do catálogo | Pode ampliar oportunidades, mas exige preço, estoque e autorização | Futuro após validar preparação |
| Contratos, empenhos, entrega e cobrança | Amplia receita possível, muda integrações e responsabilidade | Visão futura; não construir neste hackathon |
| Parecer jurídico/impugnação autônoma | Concorrência e maior custo de validação | Não priorizar |

Buscar ficha complementar é diferente de pedir esclarecimento ao órgão: se a dúvida é sobre o produto, buscar fonte do fabricante/cliente; se é sobre a exigência, preparar esclarecimento pelo canal apropriado. Incompatibilidade objetiva não exige questionar o edital; tentar alternativa ou recusar o item.

**Um caso, três resultados, em aproximadamente 90 segundos:**

1. Edital real + empresa de demonstração identificada. Um item atende: pacote montado, cálculo visível e comprovante consultável no portal de teste.
2. Um produto não atende: o agente consulta outra opção autorizada ou busca a evidência permitida; atualiza a decisão. Se não resolver, escala com contexto e prazo, sem declarar a tarefa concluída.
3. Uma suspensão/retificação invalida a análise: envio bloqueado e pacote marcado para revisão. Usar replay de evento histórico ou injeção de teste claramente rotulada, sem esperar uma alteração real durante o pitch.

O cronômetro não deve obrigar uma chamada de 100 segundos no caminho principal. Mostrar trabalho persistido, permitir nova execução e ter vídeo de reserva identificado. Manter um caso pequeno e limites reais de execução para os jurados testarem, inclusive alterando uma característica ou documento da empresa de demonstração. Um turno agendado ajuda a operação, mas não substitui interação testável.

Prova independente da resposta do modelo: documento gerado e consultável, citações na fonte preservada, registros de ferramenta, política aplicada e leitura do protocolo no destino. A consulta ao portal de teste prova integração e persistência nesse ambiente; não comprova aceitação pelo Compras.gov.br.

## 10. Prioridades assumidas como Dev 2

1. **Contrato e segurança:** alinhar vocabulário de decisões, `store`, política e eventos com Dev 1/3. Corrigir encaixe vazio e estabelecer cobertura das exigências antes de automatizar envios.
2. **Fluxo completo pequeno:** seleção de itens paginada, encaixe, evidência, decisão, dossiê e exportação persistida. Não fabricar `estado-exemplo.json` como se fosse saída do turno real; recuperar o artefato original ou rotular como exemplo sintético.
3. **Integração:** consumir política/recheque do Dev 1 no caminho de ação. Aprovação humana não deve liberar evidência inválida nem reaproveitar análise alterada.
4. **Autonomia demonstrável:** pelo menos uma recuperação contingente, como produto alternativo aprovado, e uma escalada útil.
5. **Latência:** medir etapas antes de otimizar; reutilizar extração por edital, limitar pregões e paralelizar apenas análises independentes. Envios e mutações compartilhadas continuam controlados.
6. **Avaliação:** ampliar para casos distintos, reservar casos não usados para ajustar o prompt e registrar custo, duração e resultado por caso. Repetições medem estabilidade separadamente.

Métricas mínimas: taxa de trabalhos elegíveis concluídos, intervenções por trabalho, falsos `atende`, cobertura das exigências, erro crítico de envio, latência mediana/p95, custo por trabalho concluído e tempo humano total. Registrar numerador e denominador; encaminhar tudo ao humano não é autonomia bem-sucedida.

Testes negativos prioritários: atributos vazios; exigência omitida; valores incompatíveis com citações válidas; regularização sem correspondência de modelo; documento sem vencimento; documento obrigatório ausente; suspensão/errata antes do envio; API indisponível; timeout depois de gravar no destino; tentativa duplicada; valor acima da política; resposta do modelo inválida. Um timeout após POST exige consultar/reconciliar antes de tentar novo envio.

O plano anterior tem 14 obrigatórios, várias telas e integração distribuída. O tempo bruto informado não comporta tratar tudo como igualmente essencial. Priorizar um fluxo vertical com interface profissional, pacote útil, execução comprovada e um caminho de exceção. URL acessível aos jurados e fluxo testável devem ter prioridade sobre recursos adicionais.

## 11. Validação comercial que falta

Buscar três conversas curtas com distribuidores/analistas ou mentores que conheçam essa operação. Pedir exemplos recentes e artefatos, não apenas opinião sobre a ideia:

1. Qual foi a última participação preparada? Quantos itens, pessoas, horas e ferramentas?
2. Em que etapa precisou do técnico ou fabricante? O que ficou esperando?
3. Qual foi a última desclassificação e o motivo registrado? O problema era evitável na preparação?
4. Quais fichas e documentos conseguiria fornecer hoje? Quanto trabalho exige atualizá-los?
5. O que aceitaria delegar automaticamente e o que exigiria revisão?
6. Aceitaria testar em três editais reais e comparar tempo e erros? Quem poderia aprovar um piloto pago?

Meta proposta para piloto, ainda não resultado: reduzir pelo menos pela metade o tempo humano total em participações comparáveis, sem aumentar erros críticos, incluindo o esforço de revisar as saídas. Se não houver dor recorrente e acesso às evidências, rever o perfil de cliente antes de expandir funcionalidades.

## 12. Estado desta revisão

- Lidos todos os documentos originais de `docs/`, README, módulos centrais, scripts de turno/evals/pesquisa e testes relevantes.
- Executado `npm test`: 55 testes aprovados, zero falhas. Os “68 testes” dos documentos não são o número da bateria local atual; testes ao vivo são separados.
- Reproduzidas duas limitações de `record_fit` em memória.
- Consultadas páginas públicas de concorrentes e fontes oficiais. Produtos concorrentes não foram testados por dentro.
- Não executados setup, coleta integral das APIs, turno Featherless ou evals pagos; não revalidados os agregados anteriores.
- Nenhuma mudança no código funcional, branch, commit, push, deploy ou infraestrutura.
