# Plano de Implementação — Diagnóstico de Funil

## Resumo

Adicionar dois grandes blocos ao app:

1. **Expandir o Diário** com novos campos (CPM, CTR, eventos de funil, idioma)
2. **Nova aba "Diagnóstico de Funil"** com tabela estilo planilha, simulação de cenários e análise de impacto

---

## ETAPA 1 — Expandir a aba Diário

### 1.1 Novos campos no formulário (diary modal)

Adicionar ao modal `diary-form` os seguintes campos:

| Campo | ID | Tipo | Obrigatório | Observação |
|-------|-----|------|-------------|------------|
| Idioma | `entry-language` | select | Sim | Opções: EN, ES, PT, FR, DE, IT, Outro |
| CPM | `entry-cpm` | number | Não | Custo por mil impressões |
| CTR (%) | `entry-ctr` | number | Não | Click-through rate |
| Impressões | `entry-impressions` | number | Não | Total de impressões |
| Page View | `entry-pageview` | number | Não | Visualizações de página |
| Add to Cart | `entry-atc` | number | Não | Adições ao carrinho |
| Initiate Checkout | `entry-ic` | number | Não | Checkouts iniciados |

### 1.2 Campos auto-calculados no preview

- **CTR** = Cliques / Impressões × 100 (se impressões e cliques preenchidos)
- **CPA** = Budget / Sales (já existe)
- **CPM** = (Budget / Impressões) × 1000 (se impressões preenchidos)

Obs: Se o usuário digitar CTR ou CPM manualmente, o valor manual prevalece.

### 1.3 Novo filtro: Idioma

Adicionar select `diary-language-filter` na filter-bar com opções: Todos, EN, ES, PT, FR, DE, IT, Outro.

### 1.4 Novas colunas na tabela do Diário

Adicionar coluna "Idioma" após "Plataforma".

### 1.5 Novos summary cards

Adicionar cards: CPM Médio, CTR Médio.

### 1.6 Estrutura de dados atualizada

```javascript
// Diary entry (expandido)
{
    id, date, productId, budget, budgetCurrency,
    sales, revenue, revenueCurrency, cpa, cpc,
    platform, notes,
    // NOVOS:
    language: 'EN',        // idioma
    cpm: 0,                // custo por mil impressões
    ctr: 0,                // click-through rate %
    impressions: 0,        // total impressões
    pageViews: 0,          // page views
    addToCart: 0,           // add to cart
    initiateCheckout: 0    // initiate checkout
}
```

### 1.7 Google Sheets — expandir headers do Diario

Colunas adicionais na tab Diario (M-S):
`Idioma, CPM, CTR, Impressoes, PageViews, AddToCart, InitiateCheckout`

Backward-compatible: dados antigos carregam com `|| 0` / `|| ''`.

---

## ETAPA 2 — Nova aba "Diagnóstico de Funil"

### 2.1 Novo tab button

```html
<button class="tab-btn" data-tab="funnel">Diagnóstico de Funil</button>
```

### 2.2 Estrutura da aba

A aba terá 4 seções:

#### A) Controles (topo)
- Select Produto
- Select Idioma
- Select Período (para importar dados do Diário)
- Botão "Importar do Diário"
- Botão "Limpar / Novo Cenário"

#### B) Tabela de Funil (principal) — estilo planilha

Layout de colunas:
| Métrica | Realizado | Benchmarking | Sim: CTR | Sim: ViewPage | Sim: Checkout | Sim: Venda |

Linhas — **Premissas (Taxas de conversão)**:
| Linha | Cálculo |
|-------|---------|
| % Cliques / Impressão (CTR) | cliques ÷ impressões × 100 |
| % View Page / Cliques | pageViews ÷ cliques × 100 |
| % Add to Cart / View Page | addToCart ÷ pageViews × 100 |
| % Initiate Checkout / Add to Cart | initiateCheckout ÷ addToCart × 100 |
| % Venda / Initiate Checkout | vendas ÷ initiateCheckout × 100 |

Linhas — **Números (Volumes)** — calculados automaticamente:
| Linha | Cálculo |
|-------|---------|
| # Impressões | INPUT manual (base) |
| # Cliques | impressões × CTR% |
| # View Page | cliques × ViewPage% |
| # Add to Cart | pageViews × ATC% |
| # Initiate Checkout | addToCart × IC% |
| # Vendas | initiateCheckout × Venda% |

Linhas — **Financeiro**:
| Linha | Cálculo |
|-------|---------|
| Ticket Médio | INPUT manual (ou puxado do produto) |
| Custo do Produto | INPUT (ou puxado do produto) |
| Impostos % | INPUT (ou puxado do produto) |
| Custos Var % | INPUT (ou puxado do produto) |
| Custo Ads (orçamento) | INPUT manual |
| Faturamento | vendas × ticket |
| CPA | orçamento ÷ vendas |
| Lucro por Venda | ticket - custo - impostos - custosVar - CPA |
| Lucro Total | lucroPorVenda × vendas |
| ROAS | faturamento ÷ orçamento |

#### Lógica das colunas de Simulação:

Cada coluna de simulação muda **uma única taxa** de conversão. As outras taxas ficam iguais à coluna "Realizado".

- Coluna "Sim: CTR" → usuário edita o CTR, resto usa Realizado
- Coluna "Sim: ViewPage" → usuário edita ViewPage%, resto usa Realizado
- Coluna "Sim: Checkout" → usuário edita IC%, resto usa Realizado (nota: agrupamos ATC+IC)
- Coluna "Sim: Venda" → usuário edita Venda%, resto usa Realizado

Os campos editáveis (verdes) são inputs dentro da tabela. Todos os outros são calculados.

#### C) Análise de Impacto (ranking)

Cards mostrando para cada simulação:
- **Nome da simulação** (ex: "Melhorar CTR para 3.00%")
- **Lucro adicional** (diferença vs Realizado)
- **% de aumento** no lucro
- Ordenados do maior impacto para o menor

#### D) Gráfico de Funil Visual

Barras horizontais mostrando a progressão:
```
Impressões  ████████████████████████████████  2.168.285
Cliques     ██████████                          65.049
View Page   █████████                           54.693
Add to Cart ██████                              12.400
Checkout    ████                                 2.860
Vendas      ██                                     583
```

### 2.3 Fluxo bidirecional

**Importar do Diário:**
- Agrega dados do Diário filtrados por produto + idioma + período
- Calcula médias das taxas
- Soma volumes
- Preenche coluna "Realizado"

**Enviar para o Diário:**
- Botão "Salvar como entrada no Diário"
- Pega os valores da coluna "Realizado" e cria uma entrada no Diário
- Abre o modal do diário pré-preenchido

### 2.4 Estrutura de dados do módulo

```javascript
// Estado interno do FunnelModule (não persiste no AppState principal)
{
    productId: '',
    language: '',

    // Coluna Realizado (editável manualmente ou importada)
    actual: {
        impressions: 0,
        ctr: 0,           // %
        viewPageRate: 0,   // %
        atcRate: 0,        // %
        icRate: 0,         // %
        saleRate: 0,       // %
        ticket: 0,
        productCost: 0,
        tax: 0,            // %
        variableCosts: 0,  // %
        adBudget: 0
    },

    // Coluna Benchmarking (referência manual)
    benchmark: {
        ctr: 0,
        viewPageRate: 0,
        atcRate: 0,
        icRate: 0,
        saleRate: 0
    },

    // 4 Simulações (cada uma sobrescreve UMA taxa)
    simulations: [
        { field: 'ctr', value: 0 },
        { field: 'viewPageRate', value: 0 },
        { field: 'icRate', value: 0 },
        { field: 'saleRate', value: 0 }
    ]
}
```

### 2.5 Módulo JS — funnel.js

```
FunnelModule = {
    state: { ... },         // Estado local

    init(),                 // EventBus subscriptions + DOM listeners

    // Dados
    importFromDiary(),      // Agrega dados do diário → preenche actual
    sendToDiary(),          // Abre modal do diário com dados da coluna Realizado
    clearScenario(),        // Limpa tudo

    // Cálculos
    calculateColumn(rates, base),   // Dado taxas + impressões + financeiro → retorna todos os números
    calculateImpact(),              // Compara cada simulação com Realizado → retorna deltas

    // Renderização
    render(),               // Chama renderTable + renderImpact + renderFunnel
    renderTable(),          // Monta a tabela principal estilo planilha
    renderImpact(),         // Monta os cards de ranking de impacto
    renderFunnelChart(),    // Monta o gráfico visual de barras do funil

    // Eventos
    onInputChange(),        // Recalcula tudo quando qualquer input muda
    onProductChange(),      // Atualiza ticket/custo do produto selecionado
}
```

---

## ETAPA 3 — Mudanças em arquivos existentes

### 3.1 app.js
- Adicionar `'funnel-product'` e `'funnel-language'` ao array de selectors em `populateProductDropdowns()`
- Não precisa de AppState para funil (estado local no módulo)

### 3.2 sheets.js
- Expandir `TABS` com `FUNNEL: 'Funil'` (opcional, para salvar cenários favoritos)
- Expandir headers do DIARY com novas colunas
- Atualizar `diaryToRow()` e parser do diary no `loadAll()` para incluir novos campos
- Atualizar range do diary de `A2:L` para `A2:S`

### 3.3 index.html
- Adicionar tab button "Diagnóstico de Funil"
- Adicionar section `#tab-funnel`
- Expandir diary modal com novos campos
- Adicionar `<script src="js/funnel.js"></script>`

### 3.4 styles.css
- Estilos para `.funnel-table` (tabela estilo planilha com inputs inline)
- Estilos para `.funnel-input` (inputs editáveis dentro da tabela)
- Estilos para `.funnel-input.highlight` (célula sendo simulada — verde)
- Estilos para `.impact-cards` (cards de ranking)
- Estilos para `.funnel-chart` (barras horizontais do funil visual)
- Estilos para `.funnel-controls` (barra de controles do topo)

---

## ETAPA 4 — Ordem de implementação

1. **diary.js + diary HTML** — Expandir com novos campos (language, CPM, CTR, funnel events)
2. **sheets.js** — Atualizar row converters e headers
3. **app.js** — Atualizar dropdown selectors
4. **styles.css** — Adicionar estilos do funil
5. **index.html** — Adicionar tab + section do Diagnóstico de Funil
6. **funnel.js** — Novo módulo completo
7. **Testar integração** — Importar do diário, simular, verificar cálculos

---

## Fórmulas de Referência

### Cálculo de uma coluna completa:

```
cliques = impressões × (CTR / 100)
pageViews = cliques × (viewPageRate / 100)
addToCart = pageViews × (atcRate / 100)
initiateCheckout = addToCart × (icRate / 100)
vendas = initiateCheckout × (saleRate / 100)

faturamento = vendas × ticket
CPA = adBudget / vendas
lucroPorVenda = ticket - productCost - (ticket × tax/100) - (ticket × variableCosts/100) - CPA
lucroTotal = lucroPorVenda × vendas
ROAS = faturamento / adBudget
```

### Impacto de uma simulação:

```
lucroSim = calculateColumn(simRates).lucroTotal
lucroReal = calculateColumn(actualRates).lucroTotal
delta = lucroSim - lucroReal
deltaPercent = (delta / |lucroReal|) × 100
```
