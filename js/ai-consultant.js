/* ===========================
   AI Consultant — Senior e-commerce ad strategist powered by Claude API
   Embedded in Diário tab as sub-tab
   Analyzes metrics, detects patterns, generates reports
   =========================== */

const AIConsultantModule = {
    _loading: false,
    _apiKey: '',
    _openaiKey: '',
    _provider: 'anthropic', // 'anthropic' or 'openai'
    _history: [],

    SYSTEM_PROMPT: `Voce e um gestor de trafego senior e consultor tecnico que ja rodou mais de 50 milhoes em e-commerce.
Voce analisa metricas de ads com precisao, identifica padroes de fadiga criativa, tendencias de CPC/CPM, e da recomendacoes actionaveis.

IMPORTANTE - Analise de Padroes:
- Quando CPA sobe, SEMPRE investigue a causa raiz: CPM subiu? CPC subiu? Taxa de conversao caiu? Taxa de carrinho caiu? Taxa de checkout caiu?
- Compare metricas dia a dia para identificar tendencias (3+ dias na mesma direcao = tendencia)
- O nome da campanha contem o INTERESSE/PUBLICO alvo — use isso para comparar performance entre interesses
- Calcule e compare taxas do funil: CTR, % page view, % add to cart, % checkout, % compra
- Identifique gargalos no funil: onde esta a maior perda? (clique>page view? page view>carrinho? carrinho>checkout? checkout>compra?)

Seu estilo:
- Direto e tecnico, sem enrolacao
- Foca em numeros e tendencias
- Sempre da acoes concretas (pausar X, escalar Y, testar Z)
- Identifica sinais de kill/scale rapidamente
- Pensa em termos de unit economics e margem
- Quando apresenta dados, usa tabelas formatadas para facilitar comparacao

Formato de resposta:
Use secoes claras com emojis quando apropriado.
Sempre responda em portugues brasileiro.`,

    init() {
        // Send button
        const sendBtn = document.getElementById('ai-send-btn');
        if (sendBtn) sendBtn.addEventListener('click', () => this.sendMessage());

        // Enter to send
        const input = document.getElementById('ai-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        // Action buttons
        document.getElementById('ai-auto-analyze')?.addEventListener('click', () => this.autoAnalyze());
        document.getElementById('ai-report-daily')?.addEventListener('click', () => this.generateReport('daily'));
        document.getElementById('ai-report-weekly')?.addEventListener('click', () => this.generateReport('weekly'));
        document.getElementById('ai-kill-scale')?.addEventListener('click', () => this.killScaleAnalysis());
        document.getElementById('ai-budget-realloc')?.addEventListener('click', () => this.budgetReallocation());
        document.getElementById('ai-creative-fatigue')?.addEventListener('click', () => this.creativeFatigueAnalysis());
        document.getElementById('ai-pattern-detect')?.addEventListener('click', () => this.patternAnalysis());

        // Config button
        const configBtn = document.getElementById('ai-config-btn');
        if (configBtn) configBtn.addEventListener('click', () => this.openConfigModal());

        // Config modal save
        document.getElementById('ai-config-save')?.addEventListener('click', () => this.saveConfig());
        document.getElementById('ai-config-cancel')?.addEventListener('click', () => closeModal('ai-config-modal'));
        document.getElementById('ai-config-modal')?.querySelector('.modal-overlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeModal('ai-config-modal');
        });

        // Provider toggle in config
        document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
            radio.addEventListener('change', () => this._toggleProviderFields());
        });

        // Load saved config
        this._apiKey = localStorage.getItem('ai_consultant_api_key') || '';
        this._openaiKey = localStorage.getItem('ai_consultant_openai_key') || '';
        this._provider = localStorage.getItem('ai_consultant_provider') || 'anthropic';
        this._updateProviderBadge();
    },

    openConfigModal() {
        const modal = document.getElementById('ai-config-modal');
        if (!modal) return;
        // Set values
        document.getElementById('ai-key-anthropic').value = this._apiKey;
        document.getElementById('ai-key-openai').value = this._openaiKey;
        const radio = document.querySelector(`input[name="ai-provider"][value="${this._provider}"]`);
        if (radio) radio.checked = true;
        this._toggleProviderFields();
        openModal('ai-config-modal');
    },

    _toggleProviderFields() {
        const selected = document.querySelector('input[name="ai-provider"]:checked')?.value || 'anthropic';
        const anthropicGroup = document.getElementById('ai-anthropic-group');
        const openaiGroup = document.getElementById('ai-openai-group');
        if (anthropicGroup) anthropicGroup.style.display = selected === 'anthropic' ? '' : 'none';
        if (openaiGroup) openaiGroup.style.display = selected === 'openai' ? '' : 'none';
    },

    saveConfig() {
        this._provider = document.querySelector('input[name="ai-provider"]:checked')?.value || 'anthropic';
        this._apiKey = (document.getElementById('ai-key-anthropic')?.value || '').trim();
        this._openaiKey = (document.getElementById('ai-key-openai')?.value || '').trim();

        localStorage.setItem('ai_consultant_provider', this._provider);
        localStorage.setItem('ai_consultant_api_key', this._apiKey);
        localStorage.setItem('ai_consultant_openai_key', this._openaiKey);

        this._updateProviderBadge();
        closeModal('ai-config-modal');
        showToast(`Configurado: ${this._provider === 'openai' ? 'OpenAI GPT' : 'Claude (Anthropic)'}`, 'success');
    },

    _updateProviderBadge() {
        const badge = document.getElementById('ai-provider-badge');
        if (badge) {
            badge.textContent = this._provider === 'openai' ? 'GPT' : 'Claude';
            badge.className = 'ai-provider-badge ' + (this._provider === 'openai' ? 'ai-badge-openai' : 'ai-badge-anthropic');
        }
    },

    // ── Gather FULL context from AppState ──
    gatherContext() {
        const context = {};
        const today = new Date();
        const twoWeeksAgo = new Date(today - 14 * 86400000).toISOString().split('T')[0];
        const allDiary = AppState.diary || [];

        // Parent entries (daily aggregates, not sub-entries)
        const parentEntries = allDiary.filter(d => d.date >= twoWeeksAgo && !d.isCampaign);

        context.diaryEntries = parentEntries.map(d => {
            const clicks = d.impressions && d.cpc ? Math.round(d.budget / d.cpc) : 0;
            return {
                date: d.date,
                product: getProductName(d.productId),
                budget: d.budget,
                sales: d.sales,
                revenue: d.revenue,
                cpa: d.cpa,
                cpc: d.cpc,
                platform: d.platform,
                impressions: d.impressions || 0,
                pageViews: d.pageViews || 0,
                addToCart: d.addToCart || 0,
                checkout: d.checkout || 0,
                clicks: clicks,
                // Funnel rates
                ctr: d.impressions > 0 ? ((clicks / d.impressions) * 100).toFixed(2) + '%' : null,
                pageViewRate: clicks > 0 && d.pageViews ? ((d.pageViews / clicks) * 100).toFixed(1) + '%' : null,
                addToCartRate: d.pageViews > 0 && d.addToCart ? ((d.addToCart / d.pageViews) * 100).toFixed(1) + '%' : null,
                checkoutRate: d.addToCart > 0 && d.checkout ? ((d.checkout / d.addToCart) * 100).toFixed(1) + '%' : null,
                purchaseRate: d.checkout > 0 && d.sales ? ((d.sales / d.checkout) * 100).toFixed(1) + '%' : null,
                isTest: d.isTest,
                testGoal: d.testGoal || null,
                testValidation: d.testValidation || null
            };
        });

        // Campaign/Ad sub-entries (contain interest in campaign name)
        const subEntries = allDiary.filter(d => d.date >= twoWeeksAgo && d.isCampaign);
        if (subEntries.length > 0) {
            // Aggregate by campaign name across dates for interest analysis
            const byCampaign = {};
            subEntries.forEach(d => {
                const key = d.campaignName || 'Unknown';
                if (!byCampaign[key]) {
                    byCampaign[key] = {
                        campaignName: d.campaignName,
                        product: getProductName(d.productId),
                        days: 0, totalBudget: 0, totalSales: 0, totalRevenue: 0,
                        totalImpressions: 0, totalPageViews: 0, totalAddToCart: 0,
                        totalCheckout: 0, totalClicks: 0,
                        dailyData: []
                    };
                }
                const c = byCampaign[key];
                c.days++;
                c.totalBudget += Number(d.budget || 0);
                c.totalSales += Number(d.sales || 0);
                c.totalRevenue += Number(d.revenue || 0);
                c.totalImpressions += Number(d.impressions || 0);
                c.totalPageViews += Number(d.pageViews || 0);
                c.totalAddToCart += Number(d.addToCart || 0);
                c.totalCheckout += Number(d.checkout || 0);
                const clicks = d.cpc > 0 ? Math.round(d.budget / d.cpc) : 0;
                c.totalClicks += clicks;
                c.dailyData.push({
                    date: d.date,
                    budget: d.budget,
                    sales: d.sales,
                    cpa: d.cpa,
                    cpc: d.cpc,
                    impressions: d.impressions || 0,
                    pageViews: d.pageViews || 0,
                    addToCart: d.addToCart || 0,
                    checkout: d.checkout || 0
                });
            });

            // Build campaign summary with calculated rates
            context.campaignPerformance = Object.values(byCampaign).map(c => ({
                campaignName: c.campaignName,
                product: c.product,
                daysActive: c.days,
                totalBudget: +c.totalBudget.toFixed(2),
                totalSales: c.totalSales,
                totalRevenue: +c.totalRevenue.toFixed(2),
                avgCPA: c.totalSales > 0 ? +(c.totalBudget / c.totalSales).toFixed(2) : null,
                avgCPC: c.totalClicks > 0 ? +(c.totalBudget / c.totalClicks).toFixed(2) : null,
                roas: c.totalBudget > 0 ? +(c.totalRevenue / c.totalBudget).toFixed(2) : null,
                // Funnel rates
                ctr: c.totalImpressions > 0 ? +((c.totalClicks / c.totalImpressions) * 100).toFixed(2) : null,
                pageViewRate: c.totalClicks > 0 ? +((c.totalPageViews / c.totalClicks) * 100).toFixed(1) : null,
                addToCartRate: c.totalPageViews > 0 ? +((c.totalAddToCart / c.totalPageViews) * 100).toFixed(1) : null,
                checkoutRate: c.totalAddToCart > 0 ? +((c.totalCheckout / c.totalAddToCart) * 100).toFixed(1) : null,
                purchaseRate: c.totalCheckout > 0 ? +((c.totalSales / c.totalCheckout) * 100).toFixed(1) : null,
                dailyTrend: c.dailyData.sort((a, b) => a.date.localeCompare(b.date))
            }));

            // Also provide ad-level detail
            const byAd = {};
            subEntries.forEach(d => {
                const key = `${d.campaignName}|||${d.adName}`;
                if (!byAd[key]) {
                    byAd[key] = {
                        campaignName: d.campaignName,
                        adName: d.adName,
                        product: getProductName(d.productId),
                        totalBudget: 0, totalSales: 0, totalRevenue: 0,
                        totalImpressions: 0, totalPageViews: 0, totalAddToCart: 0,
                        totalCheckout: 0, totalClicks: 0, days: 0
                    };
                }
                const a = byAd[key];
                a.days++;
                a.totalBudget += Number(d.budget || 0);
                a.totalSales += Number(d.sales || 0);
                a.totalRevenue += Number(d.revenue || 0);
                a.totalImpressions += Number(d.impressions || 0);
                a.totalPageViews += Number(d.pageViews || 0);
                a.totalAddToCart += Number(d.addToCart || 0);
                a.totalCheckout += Number(d.checkout || 0);
                const clicks = d.cpc > 0 ? Math.round(d.budget / d.cpc) : 0;
                a.totalClicks += clicks;
            });

            context.adPerformance = Object.values(byAd).map(a => ({
                campaignName: a.campaignName,
                adName: a.adName,
                product: a.product,
                daysActive: a.days,
                totalBudget: +a.totalBudget.toFixed(2),
                totalSales: a.totalSales,
                avgCPA: a.totalSales > 0 ? +(a.totalBudget / a.totalSales).toFixed(2) : null,
                avgCPC: a.totalClicks > 0 ? +(a.totalBudget / a.totalClicks).toFixed(2) : null,
                roas: a.totalBudget > 0 ? +(a.totalRevenue / a.totalBudget).toFixed(2) : null,
                addToCartRate: a.totalPageViews > 0 ? +((a.totalAddToCart / a.totalPageViews) * 100).toFixed(1) : null,
                checkoutRate: a.totalAddToCart > 0 ? +((a.totalCheckout / a.totalAddToCart) * 100).toFixed(1) : null,
                purchaseRate: a.totalCheckout > 0 ? +((a.totalSales / a.totalCheckout) * 100).toFixed(1) : null
            }));
        }

        // Products with profit info
        context.products = (AppState.products || []).filter(p => p.status === 'ativo').map(p => ({
            name: p.name,
            price: p.price,
            cost: p.cost,
            tax: p.tax,
            variableCosts: p.variableCosts,
            targetCPA: p.cpa
        }));

        // Creatives with stats
        if (typeof CreativesModule !== 'undefined') {
            context.creatives = (AppState.creatives || []).map(c => {
                const stats = CreativesModule.getCreativeStats(c.id);
                const fatigue = CreativesModule.detectFatigue(c.id);
                const freshness = CreativesModule.getFreshness(c);
                return {
                    name: c.name,
                    product: getProductName(c.productId),
                    type: c.type,
                    status: c.status,
                    angle: c.angle,
                    hookType: c.hookType,
                    daysRunning: freshness.days,
                    fatigued: fatigue.fatigued,
                    fatigueReason: fatigue.reason,
                    stats: stats ? {
                        totalSpend: stats.totalSpend,
                        avgCTR: stats.avgCTR,
                        avgCPC: stats.avgCPC,
                        avgCPM: stats.avgCPM,
                        conversions: stats.totalConversions,
                        roas: stats.roas
                    } : null
                };
            });
        }

        // Pipeline summary
        if (typeof PipelineModule !== 'undefined') {
            const cards = PipelineModule.cards || [];
            context.pipeline = {};
            (PipelineModule.COLUMNS || []).forEach(col => {
                const colCards = cards.filter(c => c.columnId === col.id);
                if (colCards.length > 0) {
                    context.pipeline[col.title] = colCards.map(c => c.title);
                }
            });
        }

        // Lab tests
        if (typeof LabTestsModule !== 'undefined') {
            const tests = LabTestsModule._tests || [];
            context.labTests = tests.filter(t => t.status === 'ativo').map(t => ({
                title: t.title,
                category: t.category,
                hypothesis: t.hypothesis,
                expectedMetric: t.expectedMetric,
                expectedDirection: t.expectedDirection,
                dateStart: t.dateStart,
                dateEnd: t.dateEnd,
                observationsCount: (t.observations || []).length
            }));
        }

        return context;
    },

    // ── PATTERN ANALYSIS (new) ──
    async patternAnalysis() {
        const context = this.gatherContext();
        const contextStr = JSON.stringify(context, null, 2);

        const prompt = `Analise os dados abaixo e DETECTE PADROES detalhados. Os nomes das campanhas contém o INTERESSE/PÚBLICO-ALVO.

${contextStr}

Faça uma análise completa de padrões:

🔍 PADRÕES DE CPA
- CPA está subindo ou descendo? Em quais produtos/campanhas?
- Se CPA subiu: o que causou? Analise nesta ordem:
  1. CPM subiu? (custo de impressão — problema de leilão/saturação)
  2. CPC subiu? (custo de clique — problema de criativo/CTR)
  3. Taxa de conversão da página caiu? (problema de landing page/oferta)
  4. Taxa de carrinho caiu? (problema de preço/confiança)
  5. Taxa de checkout caiu? (problema de frete/pagamento)
  6. Taxa de compra caiu? (problema de checkout/abandono)

📊 ANÁLISE POR INTERESSE/PÚBLICO (baseado no nome da campanha)
Para cada interesse/campanha, mostre em tabela:
| Interesse | Gasto | Vendas | CPA | CPC | % Carrinho | % Checkout | % Compra | Veredicto |
- Qual interesse está convertendo MELHOR?
- Qual interesse tem o MELHOR funil (maiores taxas)?
- Qual interesse está gastando sem resultado?

🔬 GARGALOS DO FUNIL
Para cada campanha/interesse, identifique:
- Onde está a MAIOR PERDA no funil?
- Clique → Page View: taxa esperada > 70%. Se menor = problema de velocidade/relevância da página
- Page View → Carrinho: taxa esperada > 5-15%. Se menor = problema de preço/oferta/página
- Carrinho → Checkout: taxa esperada > 50-70%. Se menor = problema de frete/opções
- Checkout → Compra: taxa esperada > 60-80%. Se menor = problema de pagamento/confiança

📈 TENDÊNCIAS (dia a dia)
- Quais métricas estão PIORANDO consistentemente? (3+ dias)
- Quais métricas estão MELHORANDO?
- Há padrão de dia da semana? (ex: final de semana melhor/pior)

⚡ AÇÕES BASEADAS NOS PADRÕES
Para cada problema identificado, dê a AÇÃO CONCRETA:
- Se CPM subindo → trocar público/expandir
- Se CPC subindo → trocar criativo/hook
- Se taxa de carrinho caindo → ajustar preço/oferta na página
- Se taxa de checkout caindo → revisar frete/opções pagamento
- Se taxa de compra caindo → simplificar checkout

🏆 RANKING DE INTERESSES
Ordene os interesses do melhor para o pior, com score baseado em CPA + volume + tendência.`;

        this._addMessage('user', '🔍 Detectar Padrões');
        await this._sendToAPI(prompt);
    },

    // ── REPORT GENERATION ──
    async generateReport(type) {
        const context = this.gatherContext();
        const contextStr = JSON.stringify(context, null, 2);

        let prompt;
        if (type === 'daily') {
            const today = new Date().toISOString().split('T')[0];
            prompt = `Gere um RELATÓRIO DIÁRIO completo para hoje (${today}). Nomes de campanha contêm o interesse/público.

${contextStr}

O relatório deve conter:
📅 DATA E RESUMO EXECUTIVO (2-3 linhas)

📊 MÉTRICAS DO DIA
- Tabela: Produto | Gasto | Vendas | CPA | CPC | ROAS
- Comparação com dia anterior (se disponível)
- Destaque para métricas fora do alvo

🔍 FUNIL DO DIA
- Tabela por campanha/interesse: Campanha | Impressões | Cliques | PageView | Carrinho | Checkout | Vendas | %ATC | %Checkout | %Compra
- Onde está o gargalo hoje?

⚡ DECISÕES DO DIA
- O que pausar/escalar baseado nos números
- Ajustes de budget recomendados

🎯 PLANO PARA AMANHÃ`;
        } else {
            prompt = `Gere um RELATÓRIO SEMANAL completo (últimos 7 dias). Nomes de campanha contêm o interesse/público.

${contextStr}

O relatório deve conter:
📅 RESUMO EXECUTIVO (3-5 linhas)

📊 MÉTRICAS DA SEMANA
- Totais: Gasto, Vendas, CPA médio, ROAS
- Tabela por produto: Produto | Gasto | Vendas | CPA | CPC | ROAS
- Evolução dia a dia (tendência)

🔍 PERFORMANCE POR INTERESSE (baseado no nome da campanha)
- Tabela: Interesse | Gasto | Vendas | CPA | %ATC | %Checkout | %Compra | Veredicto
- Ranking do melhor ao pior
- Quais interesses manter, quais cortar

📈 TENDÊNCIAS DA SEMANA
- CPC/CPM: subindo ou descendo?
- Taxas de funil: melhorando ou piorando?
- Volume: crescendo ou caindo?

🔥 CRIATIVOS — quais performaram, quais fadigaram

💰 ANÁLISE FINANCEIRA — lucro, ROI, budget ideal

🎯 PLANO PRÓXIMA SEMANA — 3 prioridades`;
        }

        this._addMessage('user', type === 'daily' ? '📋 Gerar Relatório Diário' : '📈 Gerar Relatório Semanal');
        await this._sendToAPI(prompt);
    },

    async killScaleAnalysis() {
        const context = this.gatherContext();
        const contextStr = JSON.stringify(context, null, 2);

        const prompt = `Analise e diga EXATAMENTE o que PAUSAR (kill) e ESCALAR (scale). Nomes de campanha contêm o interesse.

${contextStr}

Para cada campanha/interesse E cada anúncio, classifique:
🔴 KILL — e por quê (CPA alto? funil ruim? sem volume?)
🟡 OBSERVAR — e o que monitorar
🟢 SCALE — e quanto aumentar

Inclua análise de funil: não basta CPA alto para kill — se a taxa de checkout é boa mas página converte mal, o problema é a página, não o interesse.`;

        this._addMessage('user', '⚡ Análise Kill / Scale');
        await this._sendToAPI(prompt);
    },

    async budgetReallocation() {
        const context = this.gatherContext();
        const contextStr = JSON.stringify(context, null, 2);

        const prompt = `Sugira REALOCAÇÃO DE BUDGET otimizada. Nomes de campanha contêm o interesse.

${contextStr}

Mostre:
💰 BUDGET ATUAL por campanha/interesse
📊 PERFORMANCE vs GASTO (CPA, ROAS, taxas de funil)
🔄 REALOCAÇÃO: budget atual → sugerido (com justificativa)
📈 IMPACTO ESPERADO na melhoria de CPA e vendas`;

        this._addMessage('user', '💰 Realocação de Budget');
        await this._sendToAPI(prompt);
    },

    async creativeFatigueAnalysis() {
        const context = this.gatherContext();
        const contextStr = JSON.stringify(context, null, 2);

        const prompt = `Analise FADIGA CRIATIVA detalhada. Compare performance dos anúncios dentro de cada campanha/interesse.

${contextStr}

Para cada criativo/anúncio:
🔥 NÍVEL: 🟢 Fresco | 🟡 Atenção | 🔴 Fadigado
📊 SINAIS: CTR caindo? CPM subindo? CPC subindo? Conversão caindo?
🎨 SUBSTITUIÇÃO: ângulo, hook, formato sugerido
📅 CRONOGRAMA: trocar agora vs preparar vs ok`;

        this._addMessage('user', '🔥 Análise de Fadiga Criativa');
        await this._sendToAPI(prompt);
    },

    async autoAnalyze() {
        const context = this.gatherContext();
        const contextStr = JSON.stringify(context, null, 2);

        const prompt = `Diagnóstico COMPLETO do e-commerce. Nomes de campanha contêm o interesse/público.

${contextStr}

Analise:
1. PADRÕES: CPA subindo/descendo? Por quê? (CPM, CPC, conversão, funil)
2. INTERESSES: Qual converte melhor? Qual tem melhor funil? Ranking.
3. FUNIL: Onde está o maior gargalo? (% carrinho, % checkout, % compra)
4. CRIATIVOS: Quais fadigados? Quais performando?
5. BUDGET: Onde realocar?
6. TENDÊNCIAS: O que está melhorando/piorando nos últimos dias?
7. AÇÕES: Top 5 ações prioritárias AGORA`;

        this._addMessage('user', '📊 Análise Automática Completa');
        await this._sendToAPI(prompt);
    },

    async sendMessage() {
        const input = document.getElementById('ai-input');
        if (!input) return;

        const message = input.value.trim();
        if (!message) return;

        input.value = '';

        const context = this.gatherContext();
        const contextStr = JSON.stringify(context, null, 2);

        const fullPrompt = `Contexto atual do e-commerce (dados reais). Nomes de campanha contêm o interesse/público-alvo.
${contextStr}

Pergunta: ${message}`;

        this._addMessage('user', message);
        await this._sendToAPI(fullPrompt);
    },

    async _sendToAPI(prompt) {
        const activeKey = this._provider === 'openai' ? this._openaiKey : this._apiKey;
        if (!activeKey) {
            this._addMessage('assistant', '⚠️ Configure sua API key primeiro clicando no botão <strong>⚙️ Configurar</strong> acima.');
            return;
        }

        this._loading = true;
        this._updateLoadingState();

        const recentHistory = this._history
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-6)
            .map(m => ({
                role: m.role,
                content: m.role === 'user' ? m._fullPrompt || m.content : m.content
            }));

        try {
            let text;
            if (this._provider === 'openai') {
                text = await this._callOpenAI(prompt, recentHistory, activeKey);
            } else {
                text = await this._callAnthropic(prompt, recentHistory, activeKey);
            }
            this._addMessage('assistant', text);
        } catch (err) {
            this._addMessage('assistant', `❌ Erro (${this._provider}): ${err.message}`);
        } finally {
            this._loading = false;
            this._updateLoadingState();
        }
    },

    async _callAnthropic(prompt, history, apiKey) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 4096,
                system: this.SYSTEM_PROMPT,
                messages: [...history, { role: 'user', content: prompt }]
            })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        return data.content?.[0]?.text || 'Sem resposta.';
    },

    async _callOpenAI(prompt, history, apiKey) {
        const messages = [
            { role: 'system', content: this.SYSTEM_PROMPT },
            ...history,
            { role: 'user', content: prompt }
        ];
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 4096,
                messages: messages
            })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        return data.choices?.[0]?.message?.content || 'Sem resposta.';
    },

    _addMessage(role, content, fullPrompt) {
        const msg = { role, content, timestamp: new Date() };
        if (fullPrompt) msg._fullPrompt = fullPrompt;
        this._history.push(msg);
        this._renderMessages();
    },

    _renderMessages() {
        const container = document.getElementById('ai-messages');
        if (!container) return;

        container.innerHTML = this._history.map(msg => {
            const isUser = msg.role === 'user';
            const escapedContent = this._escapeHtml(msg.content)
                .replace(/\n/g, '<br>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/📊|🔥|📈|⚡|💰|🎯|⚠️|❌|✅|🏆|🧪|📅|📋|🔴|🟡|🟢|🟣|🔵|🎨|🔄|🔍|🔬/g, match => `<span style="font-size:1.1em">${match}</span>`);

            return `<div class="ai-message ${isUser ? 'ai-message-user' : 'ai-message-assistant'}">
                <div class="ai-message-content">${escapedContent}</div>
            </div>`;
        }).join('');

        const chatArea = document.querySelector('.ai-chat-area');
        if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
    },

    _updateLoadingState() {
        const btn = document.getElementById('ai-send-btn');
        const loader = document.getElementById('ai-loading');
        const actionCards = document.querySelectorAll('.ai-action-card');

        if (btn) btn.disabled = this._loading;
        if (loader) loader.style.display = this._loading ? 'block' : 'none';
        actionCards.forEach(card => {
            card.disabled = this._loading;
            card.style.opacity = this._loading ? '0.5' : '1';
            card.style.pointerEvents = this._loading ? 'none' : '';
        });
    },

    _escapeHtml(raw) {
        return String(raw || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
};

document.addEventListener('DOMContentLoaded', () => AIConsultantModule.init());
