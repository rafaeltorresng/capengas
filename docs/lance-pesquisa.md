# Lance — dossiê de pesquisa: problema, números, público e escopo inicial

> Consolida toda a pesquisa útil feita entre 06 e 07/11/2026 para embasar o problema e o produto.
> **Medição própria** = calculado por nós com dados abertos (scripts em `spike/scripts/`, fora do repositório).
> **[hipótese]** = ainda não comprovado. Hipóteses testadas e **descartadas** também estão registradas
> (seção 8), porque fazem parte do embasamento.

---

## Sumário executivo

1. **O governo não consegue comprar 1 em cada 5 itens de saúde na primeira tentativa.** No
   Compras.gov.br (abr/2026), **16–21%** dos itens de material médico fracassaram (nenhuma proposta
   aceita), contra **4,6%** em material de escritório. *Medição própria.*
2. **O preço não explica isso.** Num backtest com 494 itens, a estimativa do órgão abaixo ou acima do
   mercado não muda a taxa de fracasso de forma útil. *Medição própria.* A explicação que sobra é a
   **complexidade técnica e regulatória** dos editais de saúde **[hipótese apoiada por estudos e casos]**.
3. **O mercado é grande e pulverizado:** **1.647 pregões de saúde abertos** (≥ R$ 3,8 bi) num único
   dia; **5.513 distribuidoras** de material médico cadastradas para vender ao governo. *Medição própria.*
4. **O risco continua depois de ganhar:** **145 dessas distribuidoras** estão hoje com sanção vigente
   (impedimento, suspensão, inidoneidade), a maioria ligada a inexecução ou entrega. *Medição própria.*
5. **As ferramentas existentes leem editais; nenhuma que encontramos cruza o edital com o catálogo da
   empresa, a ANVISA e os documentos para dizer se a proposta passa.**
6. **A tecnologia funciona com dados reais:** a cadeia PNCP → ANVISA → edital → decisão foi testada de
   ponta a ponta. O modelo acertou o **encaixe técnico em 18 de 18** casos rotulados, e um turno real
   custou **US$ 0,22**.

---

## 1. Contexto: compras públicas no Brasil

| Fato | Número | Fonte |
|---|---|---|
| Valor homologado em contratações no PNCP em 2025 | **≈ R$ 1 trilhão** | [Convergência Digital](https://convergenciadigital.com.br/governo/compras-governamentais-ultrapassam-r-1-trilhao-em-2025/) (atribuído ao PNCP; conferir no painel oficial) |
| Compras com micro e pequenas empresas em 2025 | **R$ 272,6 bi** em 481,7 mil compras | Mesma fonte |
| Regime legal | Lei 14.133/2021, regime único desde o fim de 2023; obriga publicação no PNCP | Lei 14.133 |
| Por que agora | Pela primeira vez há uma base nacional aberta de editais, itens, códigos e resultados | PNCP |

---

## 2. O problema

### 2.1 Itens que o governo não consegue comprar

**Medição própria — Compras.gov.br, itens publicados em abril/2026 e já concluídos**
(API `modulo-contratacoes/2_consultarItensContratacoes_PNCP_14133`; até 3.000 itens por classe):

| Classe | Itens concluídos | Fracassado | Deserto |
|---|---|---|---|
| 6515 — Instrumentos e materiais médicos | 1.802 | **20,9%** | 2,6% |
| 6510 — Material cirúrgico e curativos | 706 | **16,3%** | 3,1% |
| 7510 — Material de escritório (**controle**) | 2.027 | 4,6% | 0,3% |

- Saúde fracassa **3,5 a 4,5 vezes** mais que o controle.
- Em valor (classe 6515): os itens que falham são **23,5% dos itens e 5,3% do valor**. Valor médio do
  item que falha: **R$ 21 mil**. Extrapolando para o mês: **≈ R$ 63 milhões/mês** em itens de saúde que
  falham, só no Compras.gov.br (≈ R$ 750 mi/ano). *Estimativa; ressalvas abaixo.*

**Medição própria — PNCP, 181 pregões encerrados (ago/2024 a nov/2026), majoritariamente de plataformas
municipais:**

| Categoria | Pregões | Itens concluídos | Fracassado | Deserto | Pregões com ≥ 1 item fracassado ou deserto |
|---|---|---|---|---|---|
| Material hospitalar | 70 | 7.812 | 5,9% | 2,6% | 42 de 70 |
| Equipamentos hospitalares | 70 | 6.511 | 5,0% | 4,1% | 30 de 70 |
| Material de expediente (controle) | 41 | 5.810 | 4,6% | 1,3% | 20 de 41 |

**Estudos publicados:**

| Fonte | Amostra | Resultado |
|---|---|---|
| [HC-UFPE, nota técnica 02/2024](https://www.ufpe.br/documents/39922/3386137/02-2024+GANHOS+DE+EFICI%C3%8ANCIA+COM+A+IMPLANTA%C3%87%C3%83O+DO+PARECER+REFERENCIAL+NA+REDU%C3%87%C3%83O+DO+TEMPO+DE+TRAMITA%C3%87%C3%83O+DO+PROCESSO+LICITAT%C3%93RIO+O+CASO+DE+UM+HOSPITAL+UNIVERSIT%C3%81RIO.pdf/494bd46c-d746-41bc-bc79-0976d39c3b64) | 819 pregões, 2017–2022 | **19,4%** dos itens sem sucesso (13,2% fracassados + 6,2% desertos); um pregão dura em média **246 dias** (177 de fase interna + 70 de externa) |
| [UFSC, Revista do Serviço Público v.71 (2020)](https://repositorio.enap.gov.br/items/23527356-c4fe-4b7c-98d6-f7ce5acf16e3) | 4.745 itens cancelados, material de consumo, 2014–2018 | Deserto 38% · preço acima do estimado 36% · documentos de habilitação ~10% · proposta em desacordo com o edital 7% · fornecedor não respondeu ao pregoeiro 5% |
| [HCFMUSP, Rev. Adm. Saúde v.19 (2019)](https://cqh.org.br/ojs-2.4.8/index.php/ras/article/view/174/281) | 984 itens de **medicamentos**, 2012 | **49,6%** fracassados; preço 62% · deserto 16% · regulatório (certificado de boas práticas, registro) ~10% · habilitação 2% |
| [TRE-SP, indicadores 2023](https://www.tre-sp.jus.br/transparencia-e-prestacao-de-contas/licitacoes/governanca-de-aquisicoes-e-contratacoes/arquivos-pac/indicadores-pca-2023) | 120 itens | 15% desertos ou fracassados |

**Ressalvas:**
- as amostras próprias seguem a ordem das APIs, não são aleatórias;
- cerca de 40% dos itens de abril ainda estavam "em andamento" e foram excluídos;
- um item que falha **volta a ser licitado**: o valor atrasa, não some.

### 2.2 Por que os itens de saúde falham: o que sabemos e o que não sabemos

**O que testamos e descartamos: o preço.** Backtest com 494 itens de saúde de abril/2026, usando o
histórico de preços só até 31/03/2026, sem ver o futuro:

| Regra | Fracasso nos itens marcados | Fracasso nos demais | Conclusão |
|---|---|---|---|
| Estimativa < 60% da mediana histórica | 17,0% | 21,1% | Não prevê |
| Estimativa < 80% | 18,7% | 21,0% | Não prevê |
| Estimativa < 100% | 28,0% | 18,4% | Prevê pouco: para evitar 33 fracassos, descartaria 85 itens bons |

| Para prever o preço vencedor | Erro mediano |
|---|---|
| Estimativa do próprio órgão | **11%** |
| 0,78 × estimativa | 22% |
| Mediana histórica | 32% |
| p25 histórico | 40% |

**Hipótese que sobra:** a taxa de fracasso alta em saúde vem da **complexidade técnica e regulatória**:
especificação que não confere, registro ANVISA de outra marca, documento faltando ou exigências que
variam por edital. Apoios:
- motivos de fracasso nos estudos (desacordo com o edital, documentação e regulatório somam cerca de
  20% das falhas classificadas);
- casos reais de desclassificação: registro ANVISA de marca diferente da proposta e produto fora do
  descritivo ([CIRC/RS](https://circ.rs.gov.br/arqs/3221.pdf));
- equipamento que não atende ao descritivo e falta de amostra
  ([SESACRE](https://www.licitacao.ac.gov.br/cpl/sie/fotos/PARECER%20TECNICO%20PREGAO%20ELETRONICO%20SRP%20N%20391%202025%20SESACRE%20AQUIS%20DE%20INSUMO%20HOSPITALAR.pdf));
- outras decisões e recursos: [Bombinhas/SC](https://bombinhas.sc.gov.br/uploads/sites/369/2022/06/1677681_analise_documentos_pregao_limpeza.pdf),
  [Campos/RJ](https://licitacao.campos.rj.gov.br/wp-content/uploads/2026/03/Recurso-Prge-008-26-SMS.pdf),
  [SES-MT](https://www.saude.mt.gov.br/storage/old/files/pe-007-2022_julgamento-e-homologacao-recurso-item--[247-200622-SES-MT].pdf).

**O que não sabemos:** o motivo de cada fracasso nos dados atuais. Nos pregões do Compras.gov.br, o
PNCP publica só o edital; **as atas com os motivos ficam no sistema, sem API**. Verificado em 8 pregões
com itens fracassados.

### 2.3 Por que os editais de saúde são difíceis (evidências diretas)

| Evidência | Número ou caso | Fonte |
|---|---|---|
| Editais de saúde mencionam ANVISA | **15 de 15** legíveis; 14 exigem registro do produto; 11 exigem AFE da empresa; muitos exigem amostra | Amostra de 20 editais reais (06/11) |
| Tamanho dos editais | **131 mil a 294 mil caracteres** | 3 editais reais (07/11) |
| Regras que variam por edital | Prazo de esclarecimento: "até 17h do 3º dia útil" (SENAC/CE) contra "até 3 dias úteis" (UEPG, art. 164) | Editais reais |
| Marca de referência explícita no item | "MARCA DE REFERÊNCIA: RHOSSE - MONTSERRAT - HART" em 9 itens | Pregão 03648344000108/2026/14 |
| Restrição disfarçada | "Compatibilidade com equipamento já existente… não decorre de preferência por determinada marca" | Edital UEPG 80257355000108/2026/493 |
| Código de catálogo errado | Código de **atadura crepom** em item de **esparadrapo**; código de pinça *back biter* em item de pinça **Adson** | Itens reais do PNCP |
| Estimativa fora da realidade | Cabo de bisturi estimado em **R$ 126,97**; mediana paga pelo governo **R$ 10,82** | PNCP + Compras.gov.br |
| Variantes por tamanho | CPAP neonatal em 13 itens de tamanhos diferentes (00 a 5) | Pregão UEPG |

### 2.4 O risco depois de ganhar

| Fato | Número | Fonte |
|---|---|---|
| Distribuidoras de material médico com sanção registrada | **149 de 5.513 (2,7%)**, 258 sanções | Medição própria: [CEIS](https://portaldatransparencia.gov.br/download-de-dados/ceis) (06/11/2026) × cadastro de fornecedores |
| Com sanção vigente hoje | **145 empresas** (253 sanções) | Idem |
| Tipo | 206 impedimentos de licitar e contratar (até 3 anos, art. 156 da Lei 14.133), 47 suspensões, 5 inidoneidades | Idem |
| Motivo | ≥ 112 citam explicitamente inexecução ou entrega; 132 citam só o artigo de lei | Idem (heurística sobre o texto da fundamentação) |
| Prefeituras que atrasam pagamento a fornecedores | **28,8%** de 4.172 | [CNM via Brasil 61](https://brasil61.com/n/cerca-de-um-terco-das-prefeituras-estao-com-o-pagamento-de-fornecedores-atrasado-bras2515415) |
| Restos a pagar processados da União (liquidados e não pagos, todos os credores) | R$ 109 bi (2026) | [Tesouro, Relatório RAP 2026](https://cdn.tesouro.gov.br/sistemas-internos/apex/producao/sistemas/thot/arquivos/publicacoes/53729_1689657/Relatorio%20RAP_2026.pdf) |

**Ressalvas:** o CEIS guarda sobretudo as sanções ativas, então a série histórica não serve como
tendência. **Multas não entram no CEIS**, logo a perda real é maior.

### 2.5 Quanto o problema custa para uma empresa (modelo)

| Peça | Valor | Fonte |
|---|---|---|
| Salário de analista de licitações | R$ 3.000 a R$ 4.000 | [Vagas.com](https://www.vagas.com.br/mapa-de-carreiras/cargos/analista-de-licitacoes), [IPOG](https://blog.ipog.edu.br/?p=13597) |
| Custo da hora com encargos | ≈ R$ 37,50 | Cálculo (fator de encargos 1,8 **[hipótese]**) |
| Taxa de antecipação de recebíveis públicos | a partir de ~1,7% ao mês | [Antecipa Fácil](https://antecipafacil.com.br/sacados/setor-publico) (anúncio) |
| Horas por proposta (exemplo de mercado) | 12 a 35 horas | [Effecti](https://effecti.com.br/custo-de-oportunidade-licitacao/) (ilustrativo, sem metodologia) |

| Cenário **[hipóteses]** | Itens por mês | Horas por item | Tempo gasto em itens que fracassam | Custo total de triagem e preparo |
|---|---|---|---|---|
| Pequena | 50 | 0,5 | R$ 200/mês | R$ 940/mês |
| Média | 150 | 1 | R$ 1,2 mil/mês | R$ 5,6 mil/mês |
| Grande | 400 | 2 | R$ 6,3 mil/mês | R$ 30 mil/mês |

**Leitura:** o tempo perdido só nos itens que fracassam é pequeno. O valor está em **automatizar a
triagem e o preparo de todos os itens** e em **evitar desclassificações e sanções**. As horas reais
por item **não foram validadas**.

---

## 3. Mercado e público-alvo

### 3.1 Tamanho da demanda

| Fato | Número | Fonte |
|---|---|---|
| Pregões de saúde com propostas abertas (07/11, 11h; 4 termos, sem duplicatas) | **1.647**, somando **≥ R$ 3,8 bi** (29% sem valor publicado) | Medição própria, busca do PNCP |
| Desses, no Compras.gov.br | **686**, com ≥ R$ 1,1 bi | Idem |
| Distribuição do valor | Mediana de R$ 543 mil por pregão; 1% dos pregões concentra 43% do valor | Idem |
| Por esfera | Municipal 862 · estadual 455 · federal 163 · outros 167 | Idem |
| Itens de material médico publicados por mês no Compras.gov.br | ~14 mil (6515: 12.836; 6510: 1.236 em abr/2026) | API do Compras.gov.br |
| Snapshot de terceiro (data não informada) | Material médico-hospitalar: 3.218 licitações (~R$ 3,5 bi); equipamentos: 1.471 (~R$ 1,6 bi) | ConLicitação |

### 3.2 Quem sofre: a base de clientes

| Segmento (CNAE, ativos no cadastro de fornecedores do governo) | Empresas |
|---|---|
| **4645-1/01 — Atacadista de instrumentos e materiais médicos, cirúrgicos, hospitalares e de laboratório** | **5.513** (2.001 ME, 1.998 EPP, 1.514 demais) |
| 4644-3/01 — Atacadista de medicamentos | 3.270 |
| 4645-1/03 — Atacadista de produtos odontológicos | 439 |
| 4645-1/02 — Atacadista de próteses e artigos de ortopedia | 212 |

*Fonte: API `modulo-fornecedor/1_consultarFornecedor` do Compras.gov.br, medição própria.*

### 3.3 Público-alvo

| | Descrição |
|---|---|
| **Cliente ideal** | Distribuidora **pequena ou média** de material médico-hospitalar (ME/EPP), com 1 a 3 pessoas em licitação, que vende para prefeituras, estados e hospitais públicos e tem catálogo de dezenas a centenas de itens **[hipótese de perfil]** |
| **Comprador** | Dono ou gerente comercial: quer vender mais ao governo sem contratar e sem ser desclassificado ou sancionado |
| **Usuário** | Analista de licitações: quer parar de ler tudo e receber pronto o que vale a pena |
| **Como resolvem hoje** | Ferramenta de busca e alerta (Effecti, ConLicitação) + leitura humana do edital + planilha + experiência |
| **Por que pagariam** | Menos tempo por item, menos desclassificação evitável, menos risco de sanção **[disposição a pagar não validada]** |

### 3.4 Tamanho de mercado (hipóteses)

| Recorte | Conta | Resultado |
|---|---|---|
| Material médico | 5.513 × R$ 500–1.500/mês × 12 | ≈ R$ 33–99 mi/ano |
| Saúde completa | 9.434 × R$ 500–1.500/mês × 12 | ≈ R$ 57–170 mi/ano |

O preço é uma **hipótese**. Ferramentas simples de licitação cobram de R$ 27 a R$ 30/mês, e a Effecti tem plano gratuito.

---

## 4. Concorrência

| Categoria | Quem | O que faz | O que não encontramos |
|---|---|---|---|
| Busca + IA para editais | [Effecti](https://effecti.com.br/aime/) (Aimê; [robô de lances](https://effecti.com.br/robo-de-lance/); [3 mil+ empresas](https://effecti.com.br/teste-gratis-effecti/)) | Busca, alertas, perguntas ao edital, lances automáticos | Encaixe com o catálogo, ANVISA, dossiê de conformidade |
| | [ConLicitação](https://conlicitacao.com.br/grupo-conlicitacao-faz-investimento-milionario-e-lanca-no-mercado-a-maior-plataforma-de-ia-para-licitacoes-publicas/) (plataforma de IA, investimento milionário) | Busca, resumo, perguntas ao edital | Idem |
| | [licitAI](https://licitai.advances.com.br/licitai), [Liciton](https://www.liciton.com.br/blog/ia-aplicada-licitacoes-futuro-chegou), ferramentas de R$ 27–30/mês | Busca e alertas no PNCP | Idem |
| Agentes (enterprise) | **Settle** (US$ 3 mi; "100+ agentes"; análise técnica, jurídica, comercial e de habilitação) ([Portal Convênios](https://portalconvenios.com/licitacoes-entram-na-era-dos-agentes-de-inteligencia-artificial/)) | Triagem e análise completa | Foco em grandes empresas e vários setores; sem menção a ANVISA ou catálogo |
| Nicho saúde | [Effecti saúde](https://effecti.com.br/saude/), [Lance Fácil](https://blog.lancefacil.com/licitacao-de-medicamentos/), [V2Saúde](https://v2saude.com/), [JD System](https://jdsystem.com.br/distribuidores/distribuidores-de-materiais-hospitalar/) | Busca por setor; ERP de distribuidor; registro no estoque | Cruzamento edital × registro do produto ofertado |
| Cotação hospitalar | [Bionexo](https://neofeed.com.br/negocios/a-eminencia-parda-dos-hospitais-privados-vai-entrar-na-area-financeira/) (34 mil+ clientes) | Marketplace de cotação, foco em hospitais privados | Pregões públicos ("sem tração com governo") |
| Preço para órgãos | Banco de Preços (R$ 8–12 mil/ano; [TRE-CE](https://www.tre-ce.jus.br/transparencia-e-prestacao-de-contas/gestao-de-contratacoes/arquivos-inteiro-teor/tre-ce-pad-17-120-2019-contratacao-do-sistema-de-banco-de-precos)), Painel de Preços (gratuito) | Pesquisa de preço para o governo | O cliente é o órgão |
| Crédito | [AntecipaGov](https://conlicitacao.com.br/antecipagov-o-que-e-e-como-funciona/), [Antecipa Fácil](https://antecipafacil.com.br/sacados/setor-publico), [Ótmow](https://www.letsmoney.com.br/fintech/otmow-capta-fidc-recebiveis-publicos/) | Antecipar recebíveis | Não previnem desclassificação nem sanção |

**Conclusões:**
- **"IA que lê edital" já é commodity.** O espaço livre está em **cruzar o edital com dados do setor**
  (catálogo do cliente, ANVISA, documentos) e **entregar a proposta conferida**.
- O fosso técnico é baixo; a defesa é foco no setor, velocidade e histórico de resultados por cliente.
- Não testamos os concorrentes por dentro.

---

## 5. Dados públicos disponíveis (e seus limites)

| Fonte | O que dá | Situação testada |
|---|---|---|
| **PNCP** (busca, consulta, itens, arquivos, situação) | Editais abertos e encerrados, itens, documentos, situação do pregão | ✅ Funciona. `/api/search` e `/api/consulta` resetam 30–50% das conexões; `/api/pncp/v1` é estável. Retry com jitter + cache resolvem |
| **Compras.gov.br** (itens 14.133, pesquisa de preço, CATMAT, fornecedores) | Código de catálogo, estimativa, situação, preço homologado, histórico de preços com marca, cadastro de fornecedores por CNAE | ✅ Funciona; às vezes lento (até ~14 s por página) |
| **Código de catálogo nos itens** | Só nos pregões do **Compras.gov.br**: 17 de 40 pregões, 709 de 2.920 itens (24%) | ⚠️ Outras plataformas (BLL, Licitanet, IPM, BNC) publicam sem código |
| **ANVISA** — `TA_PRODUTO_SAUDE_SITE.csv` | **116.008** produtos para saúde; classes I 37.679 · II 48.291 · III 19.313 · IV 10.725; 85.970 "VIGENTE" (sem data) e 30.038 com data | ✅ Importado em SQLite; consulta < 1 ms |
| **CATMAT** (grupo 65, saúde) | **42.537** itens ativos | ✅ Indexado com busca de texto |
| **SICONFI** (RGF Anexo 5) | Caixa e restos a pagar por município | ✅ Testado com Recife |
| **CEIS** (sanções) | Sanções a empresas e pessoas | ✅ Baixado e cruzado |
| Atas com motivos de desclassificação | — | ❌ Não estão no PNCP para pregões do Compras.gov.br |
| Lances, lance a lance | — | ❌ Não há dado aberto |
| Empenhos e pagamentos municipais | — | ❌ Sem API nacional padronizada |
| AFE das empresas | — | ❌ Não está em dado aberto útil |

---

## 6. Validação técnica (spike)

### 6.1 O que foi construído e testado (fora do repositório)
- Node 24 + TypeScript, zero dependências; **68 testes passando**:
  - regras;
  - cliente HTTP contra resets, 429 e timeouts simulados;
  - loop do agente e portão de aprovação;
  - portal sandbox;
  - contrato com as APIs reais.
- Agente com ~17 ferramentas. **Princípio:** o modelo julga, o código confere e calcula, e o humano aprova.
- Modelo: Featherless `moonshotai/Kimi-K2.6`; tool calling testado também com DeepSeek-V4-Flash e GLM-5.3-Flash.

### 6.2 Turno real de ponta a ponta (3 pregões abertos, 07/11)

| O que aconteceu | Detalhe |
|---|---|
| Exigências registradas | 10, todas com citação aceita na conferência |
| Encaixe por variante | CPAP: atende nos tamanhos 0 a 5 (11 itens), não atende no tamanho 00 → esclarecimento |
| Escalada | Escova sem "embalagem individual" na ficha → esclarecimento |
| Marca de referência | Sinalizada em 9 itens |
| Exceção real | Pregão **suspenso** detectado no PNCP |
| Autocorreção | 2 citações rejeitadas e refeitas; 2 chamadas com JSON inválido e refeitas |
| Pendência | CND vence antes da sessão → "disputar com pendência" |
| Custo e tempo | **US$ 0,22**; 12,5 min (fase 1) + 1,7 min (fase 2) |
| Falhas encontradas | Lista de itens limitada a 25 (perdeu 2 produtos); enviou para pregão suspenso; não verificava esclarecimento; lento |

### 6.3 Evals com o modelo real (Kimi-K2.6, cada caso 3 vezes)

| Eval | Resultado |
|---|---|
| **Encaixe técnico** (6 pares rotulados) | **18 de 18** |
| Exigências do edital (3 editais) | 21 de 27 campos (78%); 24 de 27 (89%) contando a compatibilidade da UEPG como restrição de marca |
| Código × descrição (6 casos) | 13 de 18 |
| Reescrita da descrição para o CATMAT | 5 de 25, contra 4 de 25 sem o modelo (**não ajuda**) |
| Latência do encaixe por par | ~100 s; custo ~US$ 0,018 |
| Custo de todos os evals | US$ 0,77 |

---

## 7. Escopo inicial do produto (preliminar)

> Escopo de trabalho para o hackathon. Detalhes em `lance-plano-fixo.md`. **Não está 100% fechado**
> como produto: as hipóteses da seção 9 podem mudá-lo.

**O que é:** um **digital worker de licitações** para distribuidoras de material médico.

**O que faz:**
1. **Turnos automáticos** sobre pregões de saúde abertos no **Compras.gov.br**.
2. **Encaixe técnico** item × produto, atributo a atributo, com citações conferidas.
3. **Registro ANVISA** de cada produto ofertado.
4. **Exigências do edital** com citação (registro, AFE, amostra, marca de referência, prazo e e-mail de esclarecimento).
5. **Decisão por item:** disputar / disputar com pendência / escalar / não disputar, com motivo.
6. **Dossiê da proposta:** quadro técnico + checklist de habilitação ligado aos documentos da empresa + pendências e prazos.
7. **Política da empresa:** dentro dela, envia sozinho esclarecimentos e propostas (sandbox) e verifica; fora dela, **escala**.
8. **Monitor:** suspensão, errata e documento novo → reavalia só o que mudou.
9. **Linha do tempo e relatório do dia**, com rastro, tempo e custo.

**Fora do escopo inicial:** preço pelo histórico como base de decisão, outras plataformas, medicamentos,
lances, envio a portais reais, acompanhamento pós-vitória (entrega e pagamento), mapa de oportunidades.

**Possíveis extensões futuras:**
- calendário do cofre de documentos;
- semáforo financeiro do órgão (SICONFI);
- mapa de oportunidades (demanda × catálogo × fabricantes com registro ANVISA);
- outras plataformas;
- outros setores regulados (EPI, Anatel, Inmetro).

---

## 8. Hipóteses testadas e descartadas

| Hipótese | Teste | Resultado |
|---|---|---|
| O histórico de preços prevê fracasso | Backtest, 494 itens | ❌ Lift < 1 nos cortes de 60% e 80%; fraco no de 100% |
| O histórico de preços prevê o preço vencedor | Mesmo backtest | ❌ Erro de 32%, contra 11% da estimativa do órgão |
| Todo item traz código de catálogo | 40 pregões abertos | ❌ Só os do Compras.gov.br (24% dos itens) |
| A busca por texto recupera o código | 273 itens | ❌ Recall@8 de 24% com o texto do órgão |
| O LLM, reescrevendo a descrição, recupera o código | 25 itens | ❌ 5 de 25, contra 4 de 25 sem ele |
| "Registro ANVISA vencendo" é um alerta frequente | Base ANVISA | ❌ Raro em consumíveis: classes I e II quase sempre "VIGENTE" sem data |
| Dá para minerar os motivos de desclassificação | 8 pregões com fracassos | ❌ Atas não estão no PNCP |
| Aprender com os resultados do próprio cliente | Duração dos pregões | ⚠️ Lento demais (meses); só como fosso de longo prazo |
| Acompanhamento pós-vitória como diferencial | Análise | ⚠️ Útil, mas é automação de fluxo; dados de empenho são privados |
| Monitorar mudanças em pregões | 40 pregões abertos | ⚠️ 4 suspensos (10%), 1 errata: existe, mas é pouco frequente |
| Governo como cliente | Decisão da equipe | ❌ Venda lenta; o foco é a empresa fornecedora |

Outras ideias avaliadas e descartadas antes do Lance (Vê AI, EUDR, glosas, SupplySwitch, ProofRun,
ClaimPilot, FulfillFix, captação municipal, DP e SRE). Em todas, faltou ao menos um destes pontos: problema medido com dado público, espaço de mercado (havia concorrentes financiados) ou demo com dados reais.

---

## 9. Lacunas: o que ainda precisa ser validado

| Lacuna | Por que importa | Como validar |
|---|---|---|
| Horas reais por item e por proposta | Sustenta o ROI | Perguntar a mentores ou distribuidoras |
| Disposição a pagar e preço | Viabilidade como startup | Mesma conversa |
| Motivo real dos fracassos em saúde | Confirma a hipótese central | Atas no sistema do Compras.gov.br (fora de API) ou entrevistas |
| Concorrentes por dentro (Settle, Effecti, ConLicitação) | Diferencial | Testar as versões gratuitas ou de demonstração |
| Acerto do modelo em mais casos | Confiança | Ampliar o gabarito para ~20 pares e criar a bateria de 10 cenários de exceção |
| Latência do turno | Demo e custo | Compactar o histórico e paralelizar |

---

## 10. Metodologia (resumo)

| Medição | Fonte e método | Data |
|---|---|---|
| Pregões abertos e valor | PNCP `/api/search`, `status=recebendo_proposta`, 4 termos de saúde, deduplicado por id | 07/11, 11h |
| Fracasso por classe | Compras.gov.br itens 14.133, classes 6515/6510/7510, publicados em abr/2026, 6 páginas de 500 por classe | 07/11 |
| Fracasso PNCP | `/api/search`, `status=encerradas`, páginas 8–15, 70 pregões por categoria, situação final de cada item | 07/11 |
| Backtest | Itens concluídos de abr/2026; histórico `1_consultarMaterial` com `dataCompraFim=2026-03-31`; ≥ 5 compras; 350 códigos sorteados | 07/11 |
| Distribuidoras | `modulo-fornecedor/1_consultarFornecedor`, `codigoCnae`, `ativo=true` | 07/11 |
| Sanções | CEIS de 06/11/2026 × CNPJs do CNAE 4645-1/01 | 07/11 |
| Evals | Gabarito rotulado manualmente a partir de editais e itens reais; fichas técnicas sintéticas; Kimi-K2.6, temperatura 0,1, 3 repetições | 07/11 |

## Fontes gerais
- PNCP: [dados abertos](https://www.gov.br/pncp/pt-br/acesso-a-informacao/copy_of_dados-abertos)
- Compras.gov.br: [dados abertos](https://dadosabertos.compras.gov.br/)
- ANVISA: [dados abertos](https://dados.anvisa.gov.br/dados/)
- Tesouro: [SICONFI API](https://apidatalake.tesouro.gov.br/docs/siconfi/)
- CEIS: [Portal da Transparência](https://portaldatransparencia.gov.br/download-de-dados/ceis)
- TCU: [licitação deserta ou fracassada (art. 75, III)](https://licitacoesecontratos.tcu.gov.br/5-10-2-2-licitacao-deserta-ou-fracassada-inciso-iii/)
- Mercado: [Convergência Digital](https://convergenciadigital.com.br/governo/compras-governamentais-ultrapassam-r-1-trilhao-em-2025/), [Effecti — tamanho do mercado](https://effecti.com.br/tamanho-mercado-licitacoes-brasil/)
