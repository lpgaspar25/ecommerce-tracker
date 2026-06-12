/* ===========================
   Lab Tests Module — Hypothesis/Observation/Conclusion flow
   + Diary Calendar with metrics & test markers
   =========================== */

const LabTestsModule = {
    _storageKey: 'etracker_lab_tests',
    _tests: [],
    _selectedIds: new Set(),
    _shopifyByDate: {}, // "YYYY-MM-DD" → { sales, revenue, currency }
    _shopifyMonthKey: null,

    CATEGORIES: {
        loja:          { label: 'Loja',          icon: '<i data-lucide="store" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#059669', bg: '#d1fae5' },
        redes_sociais: { label: 'Redes Sociais', icon: '<i data-lucide="smartphone" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#2563eb', bg: '#dbeafe' },
        trafego:       { label: 'Tráfego',       icon: '<i data-lucide="bar-chart-3" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#7c3aed', bg: '#ede9fe' },
        criativo:      { label: 'Criativo',      icon: '<i data-lucide="clapperboard" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#db2777', bg: '#fce7f3' },
        oferta:        { label: 'Oferta',        icon: '<i data-lucide="dollar-sign" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#d97706', bg: '#fef3c7' },
        outro:         { label: 'Outro',         icon: '<i data-lucide="pin" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#6b7280', bg: '#f3f4f6' },
    },

    METRICS: {
        validar_criativo: { label: '<i data-lucide="target" style="width:14px;height:14px;vertical-align:-2px"></i> Validar Criativo', icon: '<i data-lucide="target" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        vendas:    { label: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i> Vendas',      icon: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        cpa:       { label: '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i> CPA',         icon: '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        cpc:       { label: '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i> CPC',         icon: '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        conv_page: { label: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i> Conv. Página', icon: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        atc_rate:  { label: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i> Add to Cart', icon: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        roas:      { label: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i> ROAS',        icon: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        outro:     { label: 'Outro',         icon: '<i data-lucide="pin" style="width:14px;height:14px;vertical-align:-2px"></i>' },
    },

    init() {
        this._load();
        this._bindEvents();
        if (typeof EventBus !== 'undefined') {
            EventBus.on('dataLoaded', () => this._backfillDiaryFromTests());
        }
        // Multi-tab safety: when another tab writes to lab tests storage,
        // re-read in this tab to avoid using stale in-memory state on next save.
        window.addEventListener('storage', (e) => {
            if (e.key === this._storageKey) {
                this._load();
                if (document.getElementById('lab-cards-container')) this._renderCards();
            }
        });
    },

    // Sync ALL tests into Diário on every load.
    // Why: ensures old/edited tests stay in sync with their diary entries (status,
    // dates, hypothesis, validation). _syncTestToDiary is idempotent and preserves
    // user-edited metric fields (budget/sales/etc.) via spread.
    _backfillDiaryFromTests() {
        if (!Array.isArray(this._tests) || !this._tests.length) return;
        if (typeof AppState === 'undefined' || !Array.isArray(AppState.allDiary)) return;
        let synced = 0;
        this._tests.forEach(test => {
            if (!test.productId || !test.dateStart) return;
            this._syncTestToDiary(test);
            synced++;
        });
        if (synced > 0) console.log(`[LabTests] Synced ${synced} test(s) into Diário`);
    },

    _load() {
        try { this._tests = JSON.parse(localStorage.getItem(this._storageKey)) || []; }
        catch { this._tests = []; }
    },

    // Multi-tab-safe persist for save/edit flows: re-read disk and merge by id
    // (newer updatedAt wins). For deletions, use _persistOverwrite which skips
    // the merge — otherwise deleted-from-memory items would resurrect from disk.
    _persist() {
        let onDisk = [];
        try { onDisk = JSON.parse(localStorage.getItem(this._storageKey)) || []; } catch {}

        const merged = this._mergeTests(onDisk, this._tests);
        this._tests = merged;
        try {
            localStorage.setItem(this._storageKey, JSON.stringify(merged));
        } catch (err) {
            // QuotaExceededError ou similar — tenta liberar backups e re-salvar
            console.warn('[LabTests] persist falhou, tentando limpar backups:', err);
            this._purgeOldBackups();
            try {
                localStorage.setItem(this._storageKey, JSON.stringify(merged));
            } catch (err2) {
                console.error('[LabTests] persist falhou de novo:', err2);
                if (typeof showToast === 'function') {
                    showToast('Erro ao salvar: armazenamento cheio. Exporte ou apague itens antigos.', 'error');
                }
                throw err2;
            }
        }
        try { this._writeBackup(merged); } catch {}
        if (typeof EventBus !== 'undefined') EventBus.emit('labTestsChanged');
    },

    // Apaga TODOS os backups antigos para liberar espaço
    _purgeOldBackups() {
        const prefix = `${this._storageKey}_backup_`;
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) keysToRemove.push(k);
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
    },

    // Used for deletions: write in-memory directly to disk, no merge.
    _persistOverwrite() {
        try {
            localStorage.setItem(this._storageKey, JSON.stringify(this._tests));
        } catch (err) {
            this._purgeOldBackups();
            try {
                localStorage.setItem(this._storageKey, JSON.stringify(this._tests));
            } catch (err2) {
                if (typeof showToast === 'function') {
                    showToast('Erro ao salvar: armazenamento cheio.', 'error');
                }
                throw err2;
            }
        }
        try { this._writeBackup(this._tests); } catch {}
    },

    // ===== Shopify Result Tracker =====
    // Auto-pulls Shopify revenue from baseline window (3 days before) and during the test,
    // returns { baselineRevenue, duringRevenue, deltaPct, deltaAbs, verdict, currency, days, ... }
    async computeShopifyResult(testId) {
        const test = this._tests.find(t => t.id === testId);
        if (!test) throw new Error('Teste não encontrado');
        if (!test.dateStart || !test.dateEnd) throw new Error('Datas do teste vazias');
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
            throw new Error('Shopify não conectado');
        }
        const start = new Date(test.dateStart);
        const end = new Date(test.dateEnd);
        // Janela de baseline: 3 dias ANTES (sem incluir o dia do início)
        const baselineEnd = new Date(start);
        baselineEnd.setDate(baselineEnd.getDate() - 1);
        const baselineStart = new Date(baselineEnd);
        baselineStart.setDate(baselineStart.getDate() - 2); // total 3 dias

        const fmt = (d) => d.toISOString().slice(0, 10);
        const baselineFrom = fmt(baselineStart);
        const baselineTo = fmt(baselineEnd);
        const duringFrom = fmt(start);
        const duringTo = fmt(end);

        // Decide se filtra por produto (teste de produto) ou conta total (teste de loja)
        const isProductTest = !!test.productId && test.category !== 'loja';

        let baselineRevenue = 0, baselineSales = 0;
        let duringRevenue = 0, duringSales = 0;
        let currency = (ShopifyModule.getConfig?.()?.shopCurrency) || 'BRL';

        if (isProductTest) {
            // Filtra por produto específico
            const baselineMap = await ShopifyModule.getRealSalesMapByDate(baselineFrom, baselineTo);
            const duringMap = await ShopifyModule.getRealSalesMapByDate(duringFrom, duringTo);
            Object.entries(baselineMap).forEach(([k, v]) => {
                if (k.endsWith('|' + test.productId)) {
                    baselineRevenue += v.revenue || 0;
                    baselineSales += v.sales || 0;
                    if (v.currency) currency = v.currency;
                }
            });
            Object.entries(duringMap).forEach(([k, v]) => {
                if (k.endsWith('|' + test.productId)) {
                    duringRevenue += v.revenue || 0;
                    duringSales += v.sales || 0;
                    if (v.currency) currency = v.currency;
                }
            });
        } else {
            // Loja inteira
            const baselineMap = await ShopifyModule.getSalesMapByDate(baselineFrom, baselineTo);
            const duringMap = await ShopifyModule.getSalesMapByDate(duringFrom, duringTo);
            Object.values(baselineMap).forEach(v => {
                baselineRevenue += v.revenue || 0;
                baselineSales += v.sales || 0;
                if (v.currency) currency = v.currency;
            });
            Object.values(duringMap).forEach(v => {
                duringRevenue += v.revenue || 0;
                duringSales += v.sales || 0;
                if (v.currency) currency = v.currency;
            });
        }

        // Normaliza por nº de dias
        const baselineDays = 3;
        const duringDays = Math.max(1, Math.ceil((end - start) / 86400000) + 1);
        const baselinePerDay = baselineRevenue / baselineDays;
        const duringPerDay = duringRevenue / duringDays;
        const deltaAbs = duringPerDay - baselinePerDay;
        const deltaPct = baselinePerDay > 0 ? ((duringPerDay - baselinePerDay) / baselinePerDay) * 100 : 0;

        // ───── Gasto em ads + visitas (clicks) (Facebook) ─────
        let baselineSpend = 0, duringSpend = 0;
        let baselineSpendDaily = {}, duringSpendDaily = {};
        let baselineClicks = 0, duringClicks = 0;
        let baselineClicksDaily = {}, duringClicksDaily = {};
        let baselineImpr = 0, duringImpr = 0;
        let fbHasData = false;
        try {
            if (typeof FacebookAds !== 'undefined' && FacebookAds.isConnected && FacebookAds.isConnected()) {
                const accountId = FacebookAds.config.activeAdAccountId;
                if (isProductTest) {
                    const dailyB = await FacebookAds.fetchDailyInsights(test.productId, { since: baselineFrom, until: baselineTo });
                    const dailyD = await FacebookAds.fetchDailyInsights(test.productId, { since: duringFrom, until: duringTo });
                    (dailyB || []).forEach(r => {
                        baselineSpend += r.spend || 0;
                        baselineSpendDaily[r.date] = r.spend || 0;
                        baselineClicks += r.clicks || 0;
                        baselineClicksDaily[r.date] = r.clicks || 0;
                        baselineImpr += r.impressions || 0;
                    });
                    (dailyD || []).forEach(r => {
                        duringSpend += r.spend || 0;
                        duringSpendDaily[r.date] = r.spend || 0;
                        duringClicks += r.clicks || 0;
                        duringClicksDaily[r.date] = r.clicks || 0;
                        duringImpr += r.impressions || 0;
                    });
                    fbHasData = ((dailyB || []).length + (dailyD || []).length) > 0;
                } else {
                    const fetchAllInsights = async (since, until) => {
                        const params = new URLSearchParams({
                            access_token: FacebookAds.config.accessToken,
                            fields: 'date_start,spend,inline_link_clicks,clicks,impressions',
                            level: 'account',
                            time_increment: '1',
                            time_range: JSON.stringify({ since, until }),
                            limit: '500',
                        });
                        const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/act_${accountId}/insights?${params}`;
                        const res = await fetch(url);
                        const data = await res.json();
                        return (data?.data || []).map(r => ({
                            date: r.date_start,
                            spend: parseFloat(r.spend || 0),
                            clicks: parseInt(r.inline_link_clicks || r.clicks || 0),
                            impressions: parseInt(r.impressions || 0),
                        }));
                    };
                    const sB = await fetchAllInsights(baselineFrom, baselineTo);
                    const sD = await fetchAllInsights(duringFrom, duringTo);
                    sB.forEach(r => {
                        baselineSpend += r.spend;
                        baselineSpendDaily[r.date] = r.spend;
                        baselineClicks += r.clicks;
                        baselineClicksDaily[r.date] = r.clicks;
                        baselineImpr += r.impressions;
                    });
                    sD.forEach(r => {
                        duringSpend += r.spend;
                        duringSpendDaily[r.date] = r.spend;
                        duringClicks += r.clicks;
                        duringClicksDaily[r.date] = r.clicks;
                        duringImpr += r.impressions;
                    });
                    fbHasData = (sB.length + sD.length) > 0;
                }
            }
        } catch (e) { console.warn('[LabTests] fetch ad data failed:', e); }

        // Manual budget override (escala de orçamento — testes de tráfego).
        // Se preenchido, usa orçamento/dia × nº de dias em vez do gasto puxado do FB.
        let manualBudget = false;
        if (test.budgetBefore != null && test.budgetAfter != null) {
            manualBudget = true;
            baselineSpend = parseFloat(test.budgetBefore) * baselineDays;
            duringSpend = parseFloat(test.budgetAfter) * duringDays;
        }

        const baselineROAS = baselineSpend > 0 ? baselineRevenue / baselineSpend : 0;
        const duringROAS = duringSpend > 0 ? duringRevenue / duringSpend : 0;
        const deltaROAS = duringROAS - baselineROAS;

        // ───── Escala de orçamento (vendas × orçamento) ─────
        const baselineBudgetPerDay = baselineSpend / baselineDays;
        const duringBudgetPerDay = duringSpend / duringDays;
        const deltaBudgetPct = baselineBudgetPerDay > 0
            ? ((duringBudgetPerDay - baselineBudgetPerDay) / baselineBudgetPerDay) * 100 : 0;
        const baselineSalesPerDay = baselineSales / baselineDays;
        const duringSalesPerDay = duringSales / duringDays;
        const deltaSalesPct = baselineSalesPerDay > 0
            ? ((duringSalesPerDay - baselineSalesPerDay) / baselineSalesPerDay) * 100 : 0;
        // Eficiência de escala: vendas cresceram tanto quanto o orçamento?
        const scaleEfficiency = deltaBudgetPct !== 0 ? (deltaSalesPct / deltaBudgetPct) : null;

        // Visitas (cliques no link do ad) — normalizado por dia
        const baselineClicksPerDay = baselineClicks / baselineDays;
        const duringClicksPerDay = duringClicks / duringDays;
        const deltaClicksPct = baselineClicksPerDay > 0
            ? ((duringClicksPerDay - baselineClicksPerDay) / baselineClicksPerDay) * 100 : 0;

        // Taxa de conversão = vendas / cliques
        const baselineCR = baselineClicks > 0 ? (baselineSales / baselineClicks) * 100 : 0;
        const duringCR = duringClicks > 0 ? (duringSales / duringClicks) * 100 : 0;
        const deltaCRPct = baselineCR > 0 ? ((duringCR - baselineCR) / baselineCR) * 100 : 0;

        // CPA = gasto / vendas
        const baselineCPA = baselineSales > 0 ? baselineSpend / baselineSales : 0;
        const duringCPA = duringSales > 0 ? duringSpend / duringSales : 0;
        const deltaCPAPct = baselineCPA > 0 ? ((duringCPA - baselineCPA) / baselineCPA) * 100 : 0;

        // ───── Cálculo de lucro ─────
        // Para teste de produto: usa custo unitário do produto + impostos + var costs
        // Para teste de loja: usa margem média (default 30% se não informada)
        let baselineProfit = 0, duringProfit = 0;
        let marginInfo = '';
        if (isProductTest && typeof AppState !== 'undefined') {
            const prod = (AppState.allProducts || AppState.products || []).find(p => p.id === test.productId);
            if (prod) {
                // Lucro por venda = preço − custo − (preço × imposto%) − (preço × var%)
                const price = parseFloat(prod.price || 0);
                const cost = parseFloat(prod.cost || 0);
                const tax = parseFloat(prod.tax || 0) / 100;
                const varCosts = parseFloat(prod.variableCosts || 0) / 100;
                const profitPerSale = price - cost - (price * tax) - (price * varCosts);
                baselineProfit = profitPerSale * baselineSales - baselineSpend;
                duringProfit = profitPerSale * duringSales - duringSpend;
                marginInfo = `Lucro/venda ≈ ${profitPerSale.toFixed(2)} ${prod.priceCurrency || ''}`;
            }
        } else {
            // Loja inteira — margem default
            const avgMargin = parseFloat(test.assumedMargin || 30) / 100;
            baselineProfit = (baselineRevenue * avgMargin) - baselineSpend;
            duringProfit = (duringRevenue * avgMargin) - duringSpend;
            marginInfo = `Margem assumida ${(avgMargin * 100).toFixed(0)}% (edite no teste)`;
        }
        const baselineProfitPerDay = baselineProfit / baselineDays;
        const duringProfitPerDay = duringProfit / duringDays;
        const deltaProfitPct = baselineProfitPerDay !== 0
            ? ((duringProfitPerDay - baselineProfitPerDay) / Math.abs(baselineProfitPerDay)) * 100 : 0;

        // ───── Daily breakdown para gráfico ─────
        // Para teste de produto: SEPARA receita/vendas APENAS do produto selecionado (não conta o resto da loja).
        // Para teste de loja: pega total da loja.
        const buildDailyMap = async (from, to, isProduct) => {
            let byDate = {}; // { date: { revenue, sales } }
            if (isProduct) {
                const map = await ShopifyModule.getRealSalesMapByDate(from, to);
                Object.entries(map).forEach(([k, v]) => {
                    if (k.endsWith('|' + test.productId)) {
                        const date = k.split('|')[0];
                        byDate[date] = byDate[date] || { revenue: 0, sales: 0 };
                        byDate[date].revenue += v.revenue || 0;
                        byDate[date].sales += v.sales || 0;
                    }
                });
            } else {
                const map = await ShopifyModule.getSalesMapByDate(from, to);
                Object.entries(map).forEach(([date, v]) => {
                    byDate[date] = byDate[date] || { revenue: 0, sales: 0 };
                    byDate[date].revenue += v.revenue || 0;
                    byDate[date].sales += v.sales || 0;
                });
            }
            return byDate;
        };
        const baselineDailyMap = await buildDailyMap(baselineFrom, baselineTo, isProductTest);
        const duringDailyMap = await buildDailyMap(duringFrom, duringTo, isProductTest);
        const allDates = [
            ...Object.keys(baselineDailyMap),
            ...Object.keys(duringDailyMap),
        ].sort();

        // Pré-calcula profit/venda para teste de produto
        let profitPerSaleProd = 0;
        if (isProductTest && typeof AppState !== 'undefined') {
            const prod = (AppState.allProducts || AppState.products || []).find(p => p.id === test.productId);
            if (prod) {
                const price = parseFloat(prod.price || 0);
                const cost = parseFloat(prod.cost || 0);
                const tax = parseFloat(prod.tax || 0) / 100;
                const varCosts = parseFloat(prod.variableCosts || 0) / 100;
                profitPerSaleProd = price - cost - (price * tax) - (price * varCosts);
            }
        }
        const storeMargin = parseFloat(test.assumedMargin || 30) / 100;

        const dailySeries = allDates.map(d => {
            const isBaseline = baselineDailyMap[d] !== undefined;
            const day = baselineDailyMap[d] || duringDailyMap[d] || { revenue: 0, sales: 0 };
            const spend = baselineSpendDaily[d] || duringSpendDaily[d] || 0;
            const clicks = baselineClicksDaily[d] || duringClicksDaily[d] || 0;
            // Lucro do dia
            let profit = 0;
            if (isProductTest) {
                // Lucro do PRODUTO (não da loja toda) menos o gasto em ads daquele dia
                profit = (profitPerSaleProd * day.sales) - spend;
            } else {
                profit = (day.revenue * storeMargin) - spend;
            }
            const profitPct = day.revenue > 0 ? (profit / day.revenue) * 100 : 0;
            return {
                date: d,
                revenue: day.revenue,
                sales: day.sales,
                spend,
                clicks,
                profit,
                profitPct,
                period: isBaseline ? 'baseline' : 'during',
            };
        });

        // ───── Veredicto agora considera LUCRO (não só receita) ─────
        let verdict = 'neutro';
        const judgeMetric = deltaProfitPct !== 0 ? deltaProfitPct : deltaPct;
        if (judgeMetric >= 5) verdict = 'positivo';
        else if (judgeMetric <= -5) verdict = 'negativo';

        const result = {
            isProductTest,
            baselineFrom, baselineTo, duringFrom, duringTo,
            baselineDays, duringDays,
            baselineRevenue, baselineSales, baselinePerDay,
            duringRevenue, duringSales, duringPerDay,
            deltaAbs, deltaPct,
            // ROAS
            baselineSpend, duringSpend,
            baselineROAS, duringROAS, deltaROAS,
            fbHasData,
            // Visitas
            baselineClicks, duringClicks, baselineClicksPerDay, duringClicksPerDay, deltaClicksPct,
            baselineImpr, duringImpr,
            // Conversão
            baselineCR, duringCR, deltaCRPct,
            // CPA
            baselineCPA, duringCPA, deltaCPAPct,
            // Escala de orçamento (tráfego)
            manualBudget,
            baselineBudgetPerDay, duringBudgetPerDay, deltaBudgetPct,
            baselineSalesPerDay, duringSalesPerDay, deltaSalesPct,
            scaleEfficiency,
            // Profit
            baselineProfit, duringProfit, baselineProfitPerDay, duringProfitPerDay, deltaProfitPct,
            marginInfo,
            // Daily breakdown
            dailySeries,
            verdict,
            currency,
            computedAt: new Date().toISOString(),
        };

        // Persiste no teste
        test.shopifyResult = result;
        test.updatedAt = new Date().toISOString();
        this._persist();
        if (typeof EventBus !== 'undefined') EventBus.emit('labTestsChanged');

        return result;
    },

    _mergeTests(a, b) {
        const byId = new Map();
        const ts = (t) => t?.updatedAt ? Date.parse(t.updatedAt) || 0 : 0;
        [...(a || []), ...(b || [])].forEach(t => {
            if (!t || !t.id) return;
            const existing = byId.get(t.id);
            if (!existing || ts(t) >= ts(existing)) byId.set(t.id, t);
        });
        return Array.from(byId.values());
    },

    _writeBackup(tests) {
        try {
            const today = new Date().toISOString().slice(0, 10);
            localStorage.setItem(`${this._storageKey}_backup_${today}`, JSON.stringify(tests));
            // Trim backups older than 7 days
            const cutoff = Date.now() - 7 * 86400000;
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith(`${this._storageKey}_backup_`)) continue;
                const dStr = k.slice(`${this._storageKey}_backup_`.length);
                const d = Date.parse(dStr);
                if (d && d < cutoff) localStorage.removeItem(k);
            }
        } catch {}
    },

    // Returns the most recent backup that contains tests (for recovery UIs).
    _latestBackup() {
        const prefix = `${this._storageKey}_backup_`;
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) keys.push(k);
        }
        keys.sort().reverse();
        for (const k of keys) {
            try {
                const arr = JSON.parse(localStorage.getItem(k) || '[]');
                if (Array.isArray(arr) && arr.length) return { key: k, date: k.slice(prefix.length), tests: arr };
            } catch {}
        }
        return null;
    },

    _bindEvents() {
        // Aba "Laboratório" (top-level): renderiza ao ativar
        document.querySelectorAll('[data-tab="laboratorio"]').forEach(btn => {
            btn.addEventListener('click', () => this._renderCards());
        });

        // Diary sub-tabs
        document.querySelectorAll('.diary-subtab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.diary-subtab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.subtab;
                const mainEl = document.getElementById('diary-main-sub');
                const calEl = document.getElementById('diary-calendar-sub');
                const aiEl = document.getElementById('diary-ai-sub');
                if (mainEl) mainEl.style.display = tab === 'diary' ? '' : 'none';
                if (calEl) calEl.style.display = tab === 'calendar' ? '' : 'none';
                if (aiEl) aiEl.style.display = tab === 'ai' ? '' : 'none';
                if (tab === 'calendar') this._renderCalendar();
            });
        });

        // Lab buttons
        document.getElementById('btn-add-lab-test')?.addEventListener('click', () => this._openModal());
        document.getElementById('lab-modal-close')?.addEventListener('click', () => this._closeModal());
        document.getElementById('lab-modal')?.querySelector('.modal-overlay')?.addEventListener('click', () => this._closeModal());

        // Chart modal
        document.getElementById('lab-chart-modal-close')?.addEventListener('click', () => this._closeChartModal());
        document.getElementById('lab-chart-modal-overlay')?.addEventListener('click', () => this._closeChartModal());
        document.getElementById('lab-form')?.addEventListener('submit', (e) => this._handleSave(e));
        // Show/hide budget-scale section based on category
        document.getElementById('lab-category')?.addEventListener('change', (e) => this._toggleBudgetScaleSection(e.target.value));
        document.getElementById('btn-lab-add-obs')?.addEventListener('click', () => this._addObservation());
        document.getElementById('btn-lab-add-task')?.addEventListener('click', () => this._addTask());
        document.getElementById('lab-task-text')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._addTask(); }
        });

        // Toggle metrics section
        document.getElementById('btn-lab-toggle-metrics')?.addEventListener('click', () => {
            const section = document.getElementById('lab-metrics-section');
            const btn = document.getElementById('btn-lab-toggle-metrics');
            if (section) {
                const show = section.style.display === 'none';
                section.style.display = show ? '' : 'none';
                if (btn) {
                    btn.innerHTML = show
                        ? '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i> Esconder métricas'
                        : '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i> Adicionar métricas';
                    if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                }
            }
        });

        // Stages toggle
        document.getElementById('test-has-stages')?.addEventListener('change', (e) => {
            const container = document.getElementById('test-stages-container');
            if (container) container.style.display = e.target.checked ? '' : 'none';
        });

        document.getElementById('btn-add-stage')?.addEventListener('click', () => {
            const list = document.getElementById('test-stages-list');
            if (list) this._addStageRow(list, null, list.children.length);
        });
    },

    // ── Cards Rendering ──────────────────────────────────────────────

    _renderCards() {
        const container = document.getElementById('lab-cards-container');
        if (!container) return;

        // (Auto-conclude removido — testes vencidos mostram badge "Vencido" mas
        // continuam ativos até o usuário decidir concluir. Isso evita testes
        // "sumirem" pra Concluídos quando o usuário ainda está trabalhando neles.)

        // Auto-recompute results that are stale or missing new fields
        this._scheduleAutoRefresh();

        const active = this._tests.filter(t => t.status === 'ativo');
        const concluded = this._tests.filter(t => t.status === 'concluido');
        const cancelled = this._tests.filter(t => t.status === 'cancelado');

        let html = '';

        // Stats summary
        const total = this._tests.length;
        const positivos = concluded.filter(t => t.result === 'positivo').length;
        const negativos = concluded.filter(t => t.result === 'negativo').length;
        const neutros = concluded.filter(t => t.result === 'neutro').length;
        const pctPositivo = concluded.length > 0 ? Math.round((positivos / concluded.length) * 100) : 0;
        const pctNegativo = concluded.length > 0 ? Math.round((negativos / concluded.length) * 100) : 0;
        const pctNeutro = concluded.length > 0 ? Math.round((neutros / concluded.length) * 100) : 0;

        if (total > 0) {
            html += `<div class="lab-stats-bar">
                <div class="lab-stat">
                    <span class="lab-stat-value">${total}</span>
                    <span class="lab-stat-label">Total</span>
                </div>
                <div class="lab-stat">
                    <span class="lab-stat-value" style="color:var(--accent)">${active.length}</span>
                    <span class="lab-stat-label">Ativos</span>
                </div>
                <div class="lab-stat">
                    <span class="lab-stat-value" style="color:#059669">${positivos}</span>
                    <span class="lab-stat-label"><i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Validados</span>
                </div>
                <div class="lab-stat">
                    <span class="lab-stat-value" style="color:#dc2626">${negativos}</span>
                    <span class="lab-stat-label"><i data-lucide="x-circle" style="width:14px;height:14px;vertical-align:-2px"></i> Falharam</span>
                </div>
                <div class="lab-stat">
                    <span class="lab-stat-value" style="color:#6b7280">${neutros}</span>
                    <span class="lab-stat-label"><i data-lucide="minus" style="width:14px;height:14px;vertical-align:-2px"></i> Neutros</span>
                </div>
                <div class="lab-stat lab-stat-highlight">
                    <span class="lab-stat-value" style="color:#059669">${pctPositivo}%</span>
                    <span class="lab-stat-label">Taxa de Acerto</span>
                </div>
            </div>`;

            // Progress bar visual
            if (concluded.length > 0) {
                html += `<div class="lab-stats-progress">
                    <div class="lab-stats-progress-bar lab-stats-progress-green" style="width:${pctPositivo}%" title="${positivos} validados (${pctPositivo}%)"></div>
                    <div class="lab-stats-progress-bar lab-stats-progress-gray" style="width:${pctNeutro}%" title="${neutros} neutros (${pctNeutro}%)"></div>
                    <div class="lab-stats-progress-bar lab-stats-progress-red" style="width:${pctNegativo}%" title="${negativos} falharam (${pctNegativo}%)"></div>
                </div>`;
            }
        }

        if (active.length) {
            html += `<h3 class="lab-section-title"><i data-lucide="microscope" style="width:14px;height:14px;vertical-align:-2px"></i> Ativos (${active.length})</h3>`;
            html += `<div class="lab-cards-grid">${active.map(t => this._renderCard(t)).join('')}</div>`;
        }

        if (concluded.length) {
            html += `<h3 class="lab-section-title" style="margin-top:1.5rem"><i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Concluídos (${concluded.length})</h3>`;
            html += `<div class="lab-cards-grid">${concluded.map(t => this._renderCard(t)).join('')}</div>`;
        }

        if (cancelled.length) {
            html += `<details style="margin-top:1rem"><summary class="lab-section-title" style="cursor:pointer"><i data-lucide="ban" style="width:14px;height:14px;vertical-align:-2px"></i> Cancelados (${cancelled.length})</summary>`;
            html += `<div class="lab-cards-grid" style="margin-top:0.5rem">${cancelled.map(t => this._renderCard(t)).join('')}</div></details>`;
        }

        if (!this._tests.length) {
            html = '<p style="text-align:center;color:var(--text-muted);padding:3rem 0">Nenhum teste. Clique em "+ Novo Teste" para começar.</p>';
        }

        container.innerHTML = html;

        // Bulk-select bar
        this._renderBulkBar();

        // Bind checkbox toggle
        container.querySelectorAll('.lab-card-bulk-check').forEach(cb => {
            cb.addEventListener('click', (e) => {
                e.stopPropagation();
            });
            cb.addEventListener('change', (e) => {
                const id = cb.dataset.id;
                if (cb.checked) this._selectedIds.add(id);
                else this._selectedIds.delete(id);
                const card = container.querySelector(`.lab-card[data-id="${id}"]`);
                if (card) card.classList.toggle('lab-card-bulk-selected', cb.checked);
                this._renderBulkBar();
            });
        });

        // Bind card clicks
        container.querySelectorAll('.lab-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.lab-stage-advance-btn')) return;
                if (e.target.closest('[data-action="calc-shopify"]')) return;
                if (e.target.closest('[data-action="open-chart"]')) return;
                if (e.target.closest('.lab-card-bulk-check')) return;
                this._openModal(card.dataset.id);
            });
        });

        // Click on result box → open chart
        container.querySelectorAll('[data-action="open-chart"]').forEach(box => {
            box.addEventListener('click', (e) => {
                if (e.target.closest('[data-action="calc-shopify"]')) return;
                e.stopPropagation();
                this.openChart(box.dataset.testId);
            });
        });

        // Shopify result calculation
        container.querySelectorAll('[data-action="calc-shopify"]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const testId = btn.dataset.testId;
                const orig = btn.innerHTML;
                btn.disabled = true;
                btn.innerHTML = '<i data-lucide="loader-2" style="width:13px;height:13px;animation:spin 1s linear infinite"></i> Calculando…';
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                try {
                    await this.computeShopifyResult(testId);
                    this._renderCards();
                    if (typeof showToast === 'function') showToast('Resultado Shopify atualizado', 'success');
                } catch (err) {
                    btn.disabled = false;
                    btn.innerHTML = orig;
                    if (typeof showToast === 'function') showToast('Erro: ' + err.message, 'error');
                }
            });
        });

        // Bind stage advance buttons
        container.querySelectorAll('.lab-stage-advance-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._advanceStage(btn.dataset.testId, btn.dataset.stageId);
            });
        });
    },

    _toggleBudgetScaleSection(category) {
        const sec = document.getElementById('lab-budget-scale-section');
        if (sec) sec.style.display = category === 'trafego' ? '' : 'none';
    },

    _renderBulkBar() {
        const container = document.getElementById('lab-cards-container');
        if (!container) return;
        let bar = document.getElementById('lab-bulk-bar');
        const count = this._selectedIds.size;
        if (count === 0) {
            if (bar) bar.remove();
            return;
        }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'lab-bulk-bar';
            bar.className = 'bulk-action-bar';
            container.parentNode.insertBefore(bar, container);
        }
        // Check if any selected is concluded (to show "Reativar")
        const anyConcluded = Array.from(this._selectedIds).some(id => {
            const t = this._tests.find(x => x.id === id);
            return t && t.status === 'concluido';
        });
        bar.innerHTML = `
            <span class="bulk-action-count"><i data-lucide="check-square" style="width:14px;height:14px;vertical-align:-2px"></i> ${count} selecionado(s)</span>
            <button class="btn btn-sm btn-secondary" id="lab-bulk-clear">Limpar seleção</button>
            <button class="btn btn-sm btn-secondary" id="lab-bulk-select-all">Selecionar tudo</button>
            ${anyConcluded ? `<button class="btn btn-sm btn-secondary" id="lab-bulk-reactivate" style="color:#10b981">
                <i data-lucide="rotate-ccw" style="width:13px;height:13px;vertical-align:-2px"></i> Reativar
            </button>` : ''}
            <button class="btn btn-sm bulk-action-danger" id="lab-bulk-delete">
                <i data-lucide="trash-2" style="width:13px;height:13px;vertical-align:-2px"></i> Excluir ${count}
            </button>
        `;
        document.getElementById('lab-bulk-clear')?.addEventListener('click', () => {
            this._selectedIds.clear();
            this._renderCards();
        });
        document.getElementById('lab-bulk-select-all')?.addEventListener('click', () => {
            this._tests.forEach(t => this._selectedIds.add(t.id));
            this._renderCards();
        });
        document.getElementById('lab-bulk-reactivate')?.addEventListener('click', () => this._bulkReactivate());
        document.getElementById('lab-bulk-delete')?.addEventListener('click', () => this._bulkDelete());
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    },

    _bulkReactivate() {
        const ids = Array.from(this._selectedIds);
        let reactivated = 0;
        ids.forEach(id => {
            const t = this._tests.find(x => x.id === id);
            if (t && t.status === 'concluido') {
                t.status = 'ativo';
                t.updatedAt = new Date().toISOString();
                reactivated++;
            }
        });
        if (!reactivated) return;
        this._selectedIds.clear();
        try {
            this._persist();
            this._renderCards();
            if (typeof showToast === 'function') showToast(`${reactivated} teste(s) reativado(s)`, 'success');
        } catch (e) { console.error('[LabTests] reactivate failed:', e); }
    },

    _bulkDelete() {
        const count = this._selectedIds.size;
        if (count === 0) return;
        if (!confirm(`Excluir ${count} teste(s) permanentemente? Esta ação não pode ser desfeita.`)) return;
        this._tests = this._tests.filter(t => !this._selectedIds.has(t.id));
        this._selectedIds.clear();
        try {
            this._persistOverwrite();
            this._renderCards();
            if (typeof showToast === 'function') showToast(`${count} teste(s) excluído(s)`, 'success');
        } catch (err) {
            console.error('[LabTests] bulk delete failed:', err);
        }
    },

    _renderCard(test) {
        const cat = this.CATEGORIES[test.category] || this.CATEGORIES.outro;
        const metric = this.METRICS[test.expectedMetric];
        const now = new Date();
        const start = new Date(test.dateStart);
        const end = new Date(test.dateEnd);
        const totalDays = Math.max(1, Math.ceil((end - start) / 86400000));
        const elapsed = Math.min(totalDays, Math.max(0, Math.ceil((now - start) / 86400000)));
        const progress = Math.min(100, Math.round((elapsed / totalDays) * 100));
        const isOverdue = now > end && test.status === 'ativo';

        let resultBadge = '';
        if (test.status === 'concluido') {
            const rc = { positivo: ['<i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Positivo', '#059669', '#d1fae5'], negativo: ['<i data-lucide="x-circle" style="width:14px;height:14px;vertical-align:-2px"></i> Negativo', '#dc2626', '#fee2e2'], neutro: ['<i data-lucide="minus" style="width:14px;height:14px;vertical-align:-2px"></i> Neutro', '#6b7280', '#f3f4f6'] };
            const [label, color, bg] = rc[test.result] || rc.neutro;
            resultBadge = `<span class="lab-result-badge" style="color:${color};background:${bg}">${label}</span>`;
        }

        const obsCount = (test.observations || []).length;

        // Resolve product and creative names
        let productName = '';
        if (test.productId && typeof AppState !== 'undefined') {
            const prod = (AppState.products || []).find(p => p.id === test.productId);
            productName = prod ? prod.name : '';
        }
        let creativeName = '';
        if (test.creativeId) {
            try {
                const c = JSON.parse(localStorage.getItem('etracker_creatives') || '[]').find(c => c.id === test.creativeId);
                creativeName = c ? (c.name || c.hook || '') : '';
            } catch {}
        }

        const isSelected = this._selectedIds && this._selectedIds.has(test.id);
        return `
        <div class="lab-card lab-card-${test.status} ${isSelected ? 'lab-card-bulk-selected' : ''}" data-id="${test.id}">
            <input type="checkbox" class="lab-card-bulk-check" data-id="${test.id}" ${isSelected ? 'checked' : ''} title="Selecionar para ação em massa">
            <div class="lab-card-header">
                <span class="lab-category-badge" style="background:${cat.bg};color:${cat.color}">${cat.icon} ${cat.label}</span>
                ${resultBadge}
                ${isOverdue ? '<span class="lab-overdue-badge"><i data-lucide="alarm-clock" style="width:14px;height:14px;vertical-align:-2px"></i> Vencido</span>' : ''}
            </div>
            <h4 class="lab-card-title">${this._esc(test.title)}</h4>
            ${productName || creativeName ? `<p class="lab-card-area">${productName ? `<i data-lucide="tag" style="width:14px;height:14px;vertical-align:-2px"></i>️ ${this._esc(productName)}` : ''}${productName && creativeName ? ' · ' : ''}${creativeName ? `<i data-lucide="clapperboard" style="width:14px;height:14px;vertical-align:-2px"></i> ${this._esc(creativeName)}` : ''}</p>` : ''}
            ${test.area ? `<p class="lab-card-area">${this._esc(test.area)}</p>` : ''}
            <p class="lab-card-hypothesis">${this._esc(test.hypothesis || '')}</p>
            ${test.status === 'ativo' ? `
            <div class="lab-progress-wrap">
                <div class="lab-progress-bar" style="width:${progress}%;background:${isOverdue ? 'var(--red)' : 'var(--accent)'}"></div>
            </div>
            <div class="lab-card-meta">
                <span>Dia ${elapsed}/${totalDays}</span>
                ${metric ? `<span>${metric.icon} ${metric.label}${test.baselineValue ? ': ' + this._esc(test.baselineValue) : ''}</span>` : ''}
                ${obsCount ? `<span><i data-lucide="message-circle" style="width:14px;height:14px;vertical-align:-2px"></i> ${obsCount}</span>` : ''}
                ${(() => {
                    const ts = test.tasks || [];
                    if (!ts.length) return '';
                    const done = ts.filter(t => t.done).length;
                    const today = new Date(); today.setHours(0,0,0,0);
                    const overdue = ts.filter(t => !t.done && t.dueDate && new Date(t.dueDate + 'T00:00:00') < today).length;
                    return `<span title="${done}/${ts.length} tarefas concluídas${overdue ? ' · ' + overdue + ' atrasada(s)' : ''}"><i data-lucide="check-square" style="width:14px;height:14px;vertical-align:-2px"></i> ${done}/${ts.length}${overdue ? ' <span style="color:var(--red);font-weight:700">!' + overdue + '</span>' : ''}</span>`;
                })()}
            </div>` : ''}
            ${test.status === 'concluido' && test.conclusion ? `<p class="lab-card-conclusion">${this._esc(test.conclusion)}</p>` : ''}
            ${test.stages && test.stages.length > 0 ? this._renderStagesProgress(test) : ''}
            ${this._renderShopifyResultBox(test)}
            <div class="lab-card-dates">${this._fmtBR(test.dateStart)} <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> ${this._fmtBR(test.dateEnd)}</div>
        </div>`;
    },

    _renderShopifyResultBox(test) {
        const r = test.shopifyResult;
        const fmtMoney = (v, cur) => {
            const sym = { BRL: 'R$', USD: '$', EUR: '€', GBP: '£' }[cur] || (cur + ' ');
            return `${sym} ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };
        if (!r) {
            return `<button class="lab-shopify-calc-btn" data-test-id="${this._esc(test.id)}" data-action="calc-shopify">
                <i data-lucide="trending-up" style="width:13px;height:13px;vertical-align:-2px"></i>
                Comparar com Shopify (baseline 3 dias antes vs durante)
            </button>`;
        }
        // Migration fallback: se faltam campos novos, computa on-the-fly (será sobrescrito pelo auto-refresh).
        const needsMigration = r.baselineProfit === undefined;
        if (needsMigration) {
            const margin = parseFloat(test.assumedMargin || 30) / 100;
            const spendB = r.baselineSpend || 0, spendD = r.duringSpend || 0;
            r.baselineProfit = (r.baselineRevenue || 0) * margin - spendB;
            r.duringProfit = (r.duringRevenue || 0) * margin - spendD;
            const bpd = r.baselineProfit / Math.max(1, r.baselineDays || 3);
            const dpd = r.duringProfit / Math.max(1, r.duringDays || 1);
            r.baselineProfitPerDay = bpd;
            r.duringProfitPerDay = dpd;
            r.deltaProfitPct = bpd !== 0 ? ((dpd - bpd) / Math.abs(bpd)) * 100 : 0;
        }
        const verdictMap = {
            positivo: { label: 'Aprovado', bg: 'rgba(34,197,94,0.12)', color: '#10b981', icon: 'check-circle-2' },
            negativo: { label: 'Reprovado', bg: 'rgba(239,68,68,0.12)', color: '#ef4444', icon: 'x-circle' },
            neutro: { label: 'Neutro', bg: 'rgba(156,163,175,0.12)', color: '#9ca3af', icon: 'minus-circle' },
        };
        const v = verdictMap[r.verdict] || verdictMap.neutro;
        const deltaProfit = r.deltaProfitPct || 0;
        const pctSign = deltaProfit >= 0 ? '+' : '';
        const pctColor = deltaProfit >= 5 ? '#10b981' : deltaProfit <= -5 ? '#ef4444' : '#9ca3af';
        const revSign = r.deltaPct >= 0 ? '+' : '';
        const revColor = r.deltaPct >= 5 ? '#10b981' : r.deltaPct <= -5 ? '#ef4444' : '#9ca3af';
        const hasROAS = (r.baselineSpend || 0) > 0 || (r.duringSpend || 0) > 0;
        const roasDeltaPct = (r.baselineROAS || 0) > 0 ? ((r.duringROAS - r.baselineROAS) / r.baselineROAS) * 100 : 0;
        const roasSign = roasDeltaPct >= 0 ? '+' : '';
        const roasColor = roasDeltaPct >= 5 ? '#10b981' : roasDeltaPct <= -5 ? '#ef4444' : '#9ca3af';
        const hasClicks = (r.baselineClicks || 0) > 0 || (r.duringClicks || 0) > 0;
        const clicksSign = (r.deltaClicksPct || 0) >= 0 ? '+' : '';
        const clicksColor = (r.deltaClicksPct || 0) >= 5 ? '#10b981' : (r.deltaClicksPct || 0) <= -5 ? '#ef4444' : '#9ca3af';
        const hasCR = (r.baselineCR || 0) > 0 || (r.duringCR || 0) > 0;
        const crSign = (r.deltaCRPct || 0) >= 0 ? '+' : '';
        const crColor = (r.deltaCRPct || 0) >= 5 ? '#10b981' : (r.deltaCRPct || 0) <= -5 ? '#ef4444' : '#9ca3af';
        const hasCPA = (r.baselineCPA || 0) > 0 || (r.duringCPA || 0) > 0;
        const cpaSign = (r.deltaCPAPct || 0) >= 0 ? '+' : '';
        // CPA é melhor quanto MENOR → cor invertida
        const cpaColor = (r.deltaCPAPct || 0) <= -5 ? '#10b981' : (r.deltaCPAPct || 0) >= 5 ? '#ef4444' : '#9ca3af';
        // Alerta: receita subiu mas lucro caiu → prejuízo escondido
        const alertHidden = r.deltaPct > 5 && r.deltaProfitPct < -5;

        return `<div class="lab-shopify-result" data-test-id="${this._esc(test.id)}" data-action="open-chart" title="Clique para ver gráfico">
            <div class="lab-shopify-result-header" style="background:${v.bg};color:${v.color}">
                <i data-lucide="${v.icon}" style="width:14px;height:14px"></i>
                <strong>${v.label}</strong>
                <span class="lab-shopify-delta" style="color:${pctColor}">${pctSign}${deltaProfit.toFixed(1)}% lucro/dia</span>
                <i data-lucide="bar-chart-3" style="width:12px;height:12px;margin-left:auto;opacity:0.7" title="Ver gráfico"></i>
                <button class="lab-shopify-refresh" data-test-id="${this._esc(test.id)}" data-action="calc-shopify" title="Recalcular">
                    <i data-lucide="refresh-cw" style="width:11px;height:11px"></i>
                </button>
            </div>
            <div class="lab-shopify-result-grid">
                <div>
                    <small>Baseline (${r.baselineDays}d)</small>
                    <strong>${fmtMoney(r.baselineRevenue, r.currency)}</strong>
                    <em>${fmtMoney(r.baselinePerDay, r.currency)}/dia</em>
                </div>
                <div>
                    <small>Durante teste (${r.duringDays}d)</small>
                    <strong>${fmtMoney(r.duringRevenue, r.currency)}</strong>
                    <em>${fmtMoney(r.duringPerDay, r.currency)}/dia</em>
                </div>
            </div>
            <div class="lab-shopify-metrics-row">
                <div class="lab-shopify-metric">
                    <span class="lab-shopify-metric-label">Receita</span>
                    <span class="lab-shopify-metric-value">${fmtMoney(r.baselinePerDay, r.currency)}/d → ${fmtMoney(r.duringPerDay, r.currency)}/d</span>
                    <span class="lab-shopify-metric-delta" style="color:${revColor}">${revSign}${r.deltaPct.toFixed(1)}%</span>
                </div>
                <div class="lab-shopify-metric">
                    <span class="lab-shopify-metric-label">
                        Lucro
                        <span class="lab-shopify-tag" title="Lucro = Receita − custo do produto − impostos − gasto em ads. Métrica mais confiável que faturamento para decidir se vale a pena.">
                            <i data-lucide="info" style="width:10px;height:10px"></i>
                        </span>
                    </span>
                    <span class="lab-shopify-metric-value">${fmtMoney(r.baselineProfit || 0, r.currency)} → ${fmtMoney(r.duringProfit || 0, r.currency)}</span>
                    <span class="lab-shopify-metric-delta" style="color:${pctColor}">${pctSign}${deltaProfit.toFixed(1)}%</span>
                </div>
                ${hasROAS ? `
                <div class="lab-shopify-metric">
                    <span class="lab-shopify-metric-label">
                        ROAS
                        <span class="lab-shopify-tag" title="ROAS = Receita ÷ Gasto em anúncios. Quanto maior, melhor o retorno. Ex: ROAS 3 = cada R$ 1 investido retornou R$ 3 em vendas.">
                            <i data-lucide="info" style="width:10px;height:10px"></i>
                        </span>
                    </span>
                    <span class="lab-shopify-metric-value">${(r.baselineROAS || 0).toFixed(2)}x → ${(r.duringROAS || 0).toFixed(2)}x</span>
                    <span class="lab-shopify-metric-delta" style="color:${roasColor}">${roasSign}${roasDeltaPct.toFixed(1)}%</span>
                </div>` : ''}
                ${hasClicks ? `
                <div class="lab-shopify-metric">
                    <span class="lab-shopify-metric-label">
                        Visitas
                        <span class="lab-shopify-tag" title="Visitas = cliques nos anúncios do Facebook (inline_link_clicks). Indica volume de tráfego enviado para a loja.">
                            <i data-lucide="info" style="width:10px;height:10px"></i>
                        </span>
                    </span>
                    <span class="lab-shopify-metric-value">${Math.round(r.baselineClicksPerDay || 0)}/d → ${Math.round(r.duringClicksPerDay || 0)}/d</span>
                    <span class="lab-shopify-metric-delta" style="color:${clicksColor}">${clicksSign}${(r.deltaClicksPct || 0).toFixed(1)}%</span>
                </div>` : ''}
                ${hasCR ? `
                <div class="lab-shopify-metric">
                    <span class="lab-shopify-metric-label">
                        Conv.
                        <span class="lab-shopify-tag" title="Taxa de Conversão = Vendas ÷ Visitas × 100. Mede a eficiência do funil: dos visitantes que chegaram, quantos compraram.">
                            <i data-lucide="info" style="width:10px;height:10px"></i>
                        </span>
                    </span>
                    <span class="lab-shopify-metric-value">${(r.baselineCR || 0).toFixed(2)}% → ${(r.duringCR || 0).toFixed(2)}%</span>
                    <span class="lab-shopify-metric-delta" style="color:${crColor}">${crSign}${(r.deltaCRPct || 0).toFixed(1)}%</span>
                </div>` : ''}
                ${hasCPA ? `
                <div class="lab-shopify-metric">
                    <span class="lab-shopify-metric-label">
                        CPA
                        <span class="lab-shopify-tag" title="Custo por Aquisição = Gasto em ads ÷ Vendas. Quanto MENOR, melhor — significa que cada venda custou menos para ser conquistada.">
                            <i data-lucide="info" style="width:10px;height:10px"></i>
                        </span>
                    </span>
                    <span class="lab-shopify-metric-value">${fmtMoney(r.baselineCPA || 0, r.currency)} → ${fmtMoney(r.duringCPA || 0, r.currency)}</span>
                    <span class="lab-shopify-metric-delta" style="color:${cpaColor}">${cpaSign}${(r.deltaCPAPct || 0).toFixed(1)}%</span>
                </div>` : ''}
            </div>
            ${alertHidden ? `
            <div class="lab-shopify-alert">
                <i data-lucide="alert-triangle" style="width:12px;height:12px;vertical-align:-1px"></i>
                <strong>Atenção:</strong> faturamento subiu (+${r.deltaPct.toFixed(1)}%) mas lucro caiu (${deltaProfit.toFixed(1)}%) — provável aumento de gasto em ads sem retorno proporcional.
            </div>` : ''}
            ${this._renderBudgetScaleBlock(test, r, fmtMoney)}
            <div class="lab-shopify-result-footer">
                ${r.isProductTest ? `<i data-lucide="package" style="width:11px;height:11px;vertical-align:-1px"></i> Produto específico` : `<i data-lucide="store" style="width:11px;height:11px;vertical-align:-1px"></i> Loja inteira`}
                · ${r.baselineSales} → ${r.duringSales} vendas
                ${r.marginInfo ? ` · <span style="opacity:0.7">${this._esc(r.marginInfo)}</span>` : ''}
            </div>
        </div>`;
    },

    // Bloco de escala de orçamento — só para testes de tráfego com dados de gasto.
    _renderBudgetScaleBlock(test, r, fmtMoney) {
        if (test.category !== 'trafego') return '';
        const budgetBefore = r.baselineBudgetPerDay || 0;
        const budgetAfter = r.duringBudgetPerDay || 0;
        if (budgetBefore <= 0 && budgetAfter <= 0) return '';

        const dBudget = r.deltaBudgetPct || 0;
        const dSales = r.deltaSalesPct || 0;
        const dProfit = r.deltaProfitPct || 0;
        const sign = (v) => (v >= 0 ? '+' : '');

        // Veredicto de escala: vale escalar se o LUCRO/dia subiu apesar do orçamento maior.
        let verdict, vColor, vIcon;
        if (dProfit >= 5) { verdict = 'Vale escalar'; vColor = '#10b981'; vIcon = 'check-circle-2'; }
        else if (dProfit <= -5) { verdict = 'Não compensou'; vColor = '#ef4444'; vIcon = 'x-circle'; }
        else { verdict = 'Neutro'; vColor = '#9ca3af'; vIcon = 'minus-circle'; }

        // Eficiência: vendas cresceram proporcionalmente ao orçamento?
        let effNote = '';
        if (r.scaleEfficiency != null && dBudget > 0) {
            const eff = r.scaleEfficiency;
            if (eff >= 1) effNote = `Vendas cresceram mais rápido que o gasto (eficiência ${eff.toFixed(2)}x) — escala saudável.`;
            else if (eff > 0) effNote = `Vendas cresceram menos que o gasto (eficiência ${eff.toFixed(2)}x) — escala diluindo retorno.`;
            else effNote = `Gasto subiu mas vendas caíram — escala negativa.`;
        }

        return `<div class="lab-budget-scale-result">
            <div class="lab-budget-scale-result-head" style="color:${vColor}">
                <i data-lucide="${vIcon}" style="width:14px;height:14px"></i>
                <strong>Escala: ${verdict}</strong>
            </div>
            <div class="lab-budget-scale-grid">
                <div class="lab-budget-scale-cell">
                    <small>Orçamento/dia</small>
                    <span>${fmtMoney(budgetBefore, r.currency)} → ${fmtMoney(budgetAfter, r.currency)}</span>
                    <em style="color:${dBudget > 0 ? '#f59e0b' : '#9ca3af'}">${sign(dBudget)}${dBudget.toFixed(0)}%</em>
                </div>
                <div class="lab-budget-scale-cell">
                    <small>Vendas/dia</small>
                    <span>${(r.baselineSalesPerDay || 0).toFixed(1)} → ${(r.duringSalesPerDay || 0).toFixed(1)}</span>
                    <em style="color:${dSales >= 0 ? '#10b981' : '#ef4444'}">${sign(dSales)}${dSales.toFixed(0)}%</em>
                </div>
                <div class="lab-budget-scale-cell lab-budget-scale-cell-profit">
                    <small>Lucro/dia</small>
                    <span>${fmtMoney(r.baselineProfitPerDay || 0, r.currency)} → ${fmtMoney(r.duringProfitPerDay || 0, r.currency)}</span>
                    <em style="color:${dProfit >= 0 ? '#10b981' : '#ef4444'};font-weight:800">${sign(dProfit)}${dProfit.toFixed(1)}%</em>
                </div>
            </div>
            ${effNote ? `<div class="lab-budget-scale-eff">${effNote}</div>` : ''}
        </div>`;
    },

    // Recomputa em background:
    //   1) testes com shopifyResult FALTANDO campos novos (versão antiga)
    //   2) testes ATIVOS com computedAt > 1h
    // Roda 1 por vez em série, com pequeno delay, sem travar UI.
    _scheduleAutoRefresh() {
        if (this._autoRefreshRunning) return;
        const now = Date.now();
        const ONE_HOUR = 60 * 60 * 1000;
        const queue = this._tests.filter(t => {
            if (!t.dateStart || !t.dateEnd) return false;
            const r = t.shopifyResult;
            if (!r) return false; // nunca calculou → não força (usuário clica)
            const needsMigration = r.baselineProfit === undefined || r.dailySeries === undefined;
            if (needsMigration) return true;
            if (t.status !== 'ativo') return false;
            const last = r.computedAt ? Date.parse(r.computedAt) : 0;
            return (now - last) > ONE_HOUR;
        }).map(t => t.id);

        if (!queue.length) return;
        this._autoRefreshRunning = true;
        const runNext = async () => {
            const id = queue.shift();
            if (!id) { this._autoRefreshRunning = false; return; }
            try {
                await this.computeShopifyResult(id);
                this._renderCards();
            } catch (e) { console.warn('[LabTests] auto-refresh failed for', id, e); }
            setTimeout(runNext, 500);
        };
        setTimeout(runNext, 800);
    },

    openChart(testId) {
        const test = this._tests.find(t => t.id === testId);
        if (!test || !test.shopifyResult) return;
        const r = test.shopifyResult;
        const modal = document.getElementById('lab-chart-modal');
        if (!modal) return;
        const titleEl = document.getElementById('lab-chart-title');
        const subEl = document.getElementById('lab-chart-subtitle');
        if (titleEl) titleEl.textContent = test.title;
        if (subEl) {
            const sym = { BRL: 'R$', USD: '$', EUR: '€', GBP: '£' }[r.currency] || r.currency;
            subEl.innerHTML = `Baseline ${this._fmtBR(r.baselineFrom)} → ${this._fmtBR(r.baselineTo)} · Durante ${this._fmtBR(r.duringFrom)} → ${this._fmtBR(r.duringTo)}
                <span style="margin-left:12px;opacity:0.7">Moeda: ${sym}</span>`;
        }
        modal.classList.remove('hidden');

        const canvas = document.getElementById('lab-chart-canvas');
        if (!canvas || typeof Chart === 'undefined') return;
        if (this._chartInstance) { try { this._chartInstance.destroy(); } catch {} }

        const series = r.dailySeries || [];
        const labels = series.map(s => this._fmtBR(s.date));
        const revData = series.map(s => s.revenue || 0);
        const spendData = series.map(s => s.spend || 0);
        const clicksData = series.map(s => s.clicks || 0);
        const profitPctData = series.map(s => s.profitPct || 0);
        const profitData = series.map(s => s.profit || 0);
        const hasClicks = clicksData.some(v => v > 0);
        const hasProfit = series.some(s => s.profitPct !== undefined);
        const periodColors = series.map(s => s.period === 'baseline' ? 'rgba(156,163,175,0.6)' : 'rgba(139,92,246,1)');

        const ctx = canvas.getContext('2d');
        const isDark = !document.body.classList.contains('light-theme');
        const textColor = isDark ? '#d1d5db' : '#374151';
        const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';

        this._chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Receita',
                        data: revData,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16,185,129,0.12)',
                        fill: true,
                        tension: 0.3,
                        yAxisID: 'y',
                        pointBackgroundColor: periodColors,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                    },
                    {
                        label: 'Gasto em ads',
                        data: spendData,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239,68,68,0.08)',
                        fill: false,
                        tension: 0.3,
                        yAxisID: 'y',
                        borderDash: [4, 4],
                        pointRadius: 3,
                    },
                    ...(hasClicks ? [{
                        label: 'Visitas (cliques)',
                        data: clicksData,
                        borderColor: '#8b5cf6',
                        backgroundColor: 'rgba(139,92,246,0.08)',
                        fill: false,
                        tension: 0.3,
                        yAxisID: 'y1',
                        pointRadius: 3,
                    }] : []),
                    ...(hasProfit ? [{
                        label: '% Lucro do dia',
                        data: profitPctData,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245,158,11,0.10)',
                        fill: false,
                        tension: 0.3,
                        yAxisID: 'y2',
                        pointRadius: 4,
                        borderWidth: 2.5,
                    }] : []),
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { color: textColor } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const v = ctx.parsed.y;
                                if (ctx.dataset.label === '% Lucro do dia') {
                                    const item = series[ctx.dataIndex];
                                    const profit = item?.profit || 0;
                                    const sym = { BRL: 'R$', USD: '$', EUR: '€', GBP: '£' }[r.currency] || r.currency;
                                    return `% Lucro: ${v.toFixed(1)}% (${sym} ${profit.toFixed(2)})`;
                                }
                                return `${ctx.dataset.label}: ${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}`;
                            },
                            afterLabel: (ctx) => {
                                if (ctx.datasetIndex !== 0) return '';
                                const item = series[ctx.dataIndex];
                                return item ? `Período: ${item.period === 'baseline' ? 'Baseline' : 'Durante teste'}` : '';
                            },
                        },
                    },
                },
                scales: {
                    x: { ticks: { color: textColor }, grid: { color: gridColor } },
                    y: {
                        position: 'left',
                        title: { display: true, text: 'Moeda', color: textColor },
                        ticks: { color: textColor }, grid: { color: gridColor }, beginAtZero: true,
                    },
                    ...(hasClicks ? { y1: {
                        position: 'right',
                        title: { display: true, text: 'Visitas', color: textColor },
                        ticks: { color: textColor }, grid: { display: false }, beginAtZero: true,
                    } } : {}),
                    ...(hasProfit ? { y2: {
                        position: 'right',
                        title: { display: true, text: '% Lucro', color: '#f59e0b' },
                        ticks: {
                            color: '#f59e0b',
                            callback: (v) => v + '%',
                        },
                        grid: { display: false },
                        offset: hasClicks,
                    } } : {}),
                },
            },
        });

        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    },

    _closeChartModal() {
        const modal = document.getElementById('lab-chart-modal');
        if (modal) modal.classList.add('hidden');
        if (this._chartInstance) { try { this._chartInstance.destroy(); } catch {} this._chartInstance = null; }
    },

    // ── Modal ─────────────────────────────────────────────────────────

    _openModal(id) {
        const modal = document.getElementById('lab-modal');
        if (!modal) return;
        this._editingId = id || null;
        const test = id ? this._tests.find(t => t.id === id) : null;
        if (!id) { this._tempObs = []; this._tempTasks = []; }

        // Fill form
        const get = (sel) => document.getElementById(sel);
        get('lab-title').value = test?.title || '';
        get('lab-category').value = test?.category || 'loja';
        get('lab-area').value = test?.area || '';
        // Budget-scale fields (traffic tests)
        if (get('lab-budget-before')) get('lab-budget-before').value = test?.budgetBefore != null ? test.budgetBefore : '';
        if (get('lab-budget-after')) get('lab-budget-after').value = test?.budgetAfter != null ? test.budgetAfter : '';
        if (get('lab-budget-currency')) get('lab-budget-currency').value = test?.budgetCurrency || 'BRL';
        this._toggleBudgetScaleSection(test?.category || 'loja');
        get('lab-date-start').value = test?.dateStart || new Date().toISOString().slice(0, 10);
        get('lab-date-end').value = test?.dateEnd || '';
        get('lab-hypothesis').value = test?.hypothesis || '';
        get('lab-expected-metric').value = test?.expectedMetric || 'validar_criativo';
        get('lab-baseline').value = test?.baselineValue || '';
        get('lab-status').value = test?.status || 'ativo';

        // Metrics
        const metrics = test?.metrics || {};
        const hasMetrics = Object.keys(metrics).length > 0;
        for (const key of ['cpc','cpa','ctr','sales','roas','budget']) {
            const bEl = document.getElementById(`lab-m-${key}-before`);
            const aEl = document.getElementById(`lab-m-${key}-after`);
            if (bEl) bEl.value = metrics[`${key}_before`] ?? '';
            if (aEl) aEl.value = metrics[`${key}_after`] ?? '';
        }
        // Show/hide metrics section
        const metricsSection = document.getElementById('lab-metrics-section');
        const metricsBtn = document.getElementById('btn-lab-toggle-metrics');
        if (metricsSection) metricsSection.style.display = hasMetrics ? '' : 'none';
        if (metricsBtn) {
            metricsBtn.innerHTML = hasMetrics
                ? '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i> Esconder métricas'
                : '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i> Adicionar métricas';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        }

        // Populate product dropdown from AppState
        const prodSelect = get('lab-product');
        if (prodSelect) {
            prodSelect.innerHTML = '<option value="">Nenhum produto</option>';
            const products = (typeof AppState !== 'undefined' && AppState.products) ? AppState.products : [];
            for (const p of products) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                prodSelect.appendChild(opt);
            }
            prodSelect.value = test?.productId || '';
        }

        // Populate creative dropdown from creatives
        const creatSelect = get('lab-creative');
        if (creatSelect) {
            creatSelect.innerHTML = '<option value="">Nenhum criativo</option>';
            try {
                const creatives = JSON.parse(localStorage.getItem('etracker_creatives') || '[]');
                for (const c of creatives) {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name || c.hook || `Criativo #${c.id?.slice(-4)}`;
                    creatSelect.appendChild(opt);
                }
            } catch {}
            creatSelect.value = test?.creativeId || '';
        }

        // Populate region dropdown from RegionTags
        const regionSelect = get('lab-region');
        if (regionSelect) {
            regionSelect.innerHTML = '<option value="">Todos / não específico</option>';
            if (typeof RegionTags !== 'undefined' && Array.isArray(RegionTags.PATTERNS)) {
                RegionTags.PATTERNS.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.code;
                    opt.textContent = RegionTags.labelPlain(p.code);
                    regionSelect.appendChild(opt);
                });
            }
            regionSelect.value = test?.region || '';
        }
        const interestEl = get('lab-interest');
        if (interestEl) interestEl.value = test?.interest || '';

        // Conclusion fields
        get('lab-conclusion').value = test?.conclusion || '';
        get('lab-result').value = test?.result || 'neutro';
        get('lab-final-value').value = test?.finalValue || '';
        get('lab-keep-change').value = test?.keepChange === false ? 'false' : 'true';
        get('lab-learnings').value = test?.learnings || '';

        // Observations
        this._renderObservations(test?.observations || []);

        // Tasks
        this._renderTasks(test?.tasks || []);

        // Show/hide conclusion section
        const conclusionSection = document.getElementById('lab-conclusion-section');
        if (conclusionSection) conclusionSection.style.display = test?.status === 'concluido' || test?.status === 'cancelado' ? '' : 'none';

        // Status change shows conclusion
        get('lab-status').onchange = () => {
            const s = get('lab-status').value;
            if (conclusionSection) conclusionSection.style.display = s === 'concluido' || s === 'cancelado' ? '' : 'none';
        };

        // Stages
        const stagesCheckbox = document.getElementById('test-has-stages');
        const stagesContainer = document.getElementById('test-stages-container');
        const stagesList = document.getElementById('test-stages-list');
        const hasStages = test?.stages && test.stages.length > 0;
        if (stagesCheckbox) stagesCheckbox.checked = hasStages;
        if (stagesContainer) stagesContainer.style.display = hasStages ? '' : 'none';
        if (stagesList) {
            stagesList.innerHTML = '';
            if (hasStages) {
                const sorted = [...test.stages].sort((a, b) => a.order - b.order);
                sorted.forEach((s, i) => this._addStageRow(stagesList, s, i));
            }
        }

        // Delete button
        const delBtn = document.getElementById('btn-lab-delete');
        if (delBtn) {
            delBtn.style.display = id ? '' : 'none';
            delBtn.onclick = () => { if (confirm('Excluir teste?')) { this._deleteTest(id); this._closeModal(); } };
        }

        modal.classList.remove('hidden');
    },

    _closeModal() {
        document.getElementById('lab-modal')?.classList.add('hidden');
        this._editingId = null;
    },

    _renderObservations(observations) {
        const container = document.getElementById('lab-observations-list');
        if (!container) return;

        if (!observations.length) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">Nenhuma observação ainda.</p>';
            return;
        }

        container.innerHTML = observations.map((obs, i) => {
            const sentimentIcon = { positive: '<i data-lucide="circle" style="width:10px;height:10px;fill:#10b981;color:#10b981"></i>', negative: '<i data-lucide="circle" style="width:10px;height:10px;fill:#ef4444;color:#ef4444"></i>', neutral: '<i data-lucide="circle" style="width:10px;height:10px;fill:#f59e0b;color:#f59e0b"></i>' }[obs.sentiment] || '<i data-lucide="circle" style="width:10px;height:10px;fill:#f59e0b;color:#f59e0b"></i>';
            return `<div class="lab-obs-item">
                <span class="lab-obs-date">${this._fmtBR(obs.date)}</span>
                <span class="lab-obs-sentiment">${sentimentIcon}</span>
                <span class="lab-obs-text">${this._esc(obs.text)}</span>
                <button class="lab-obs-del" data-idx="${i}" title="Remover"><i data-lucide="x" style="width:14px;height:14px;vertical-align:-2px"></i></button>
            </div>`;
        }).join('');

        container.querySelectorAll('.lab-obs-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx);
                if (this._editingId) {
                    const test = this._tests.find(t => t.id === this._editingId);
                    if (test) { test.observations.splice(idx, 1); this._persist(); this._renderObservations(test.observations); }
                }
            });
        });
    },

    _addObservation() {
        const text = document.getElementById('lab-obs-text')?.value?.trim();
        if (!text) { showToast('Escreva a observação', 'error'); return; }

        const sentiment = document.getElementById('lab-obs-sentiment')?.value || 'neutral';
        const date = new Date().toISOString().slice(0, 10);

        if (this._editingId) {
            const test = this._tests.find(t => t.id === this._editingId);
            if (test) {
                if (!test.observations) test.observations = [];
                test.observations.push({ date, text, sentiment });
                this._persist();
                this._renderObservations(test.observations);
            }
        } else {
            // Store temporarily for new tests
            if (!this._tempObs) this._tempObs = [];
            this._tempObs.push({ date, text, sentiment });
            this._renderObservations(this._tempObs);
        }

        document.getElementById('lab-obs-text').value = '';
        showToast('Observação adicionada!', 'success');
    },

    // ── Tasks (com prazos) ──────────────────────────────────────────

    _renderTasks(tasks) {
        const container = document.getElementById('lab-tasks-list');
        if (!container) return;
        tasks = tasks || [];
        if (!tasks.length) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">Nenhuma tarefa ainda.</p>';
            return;
        }
        const today = new Date(); today.setHours(0,0,0,0);
        container.innerHTML = tasks.map((task, i) => {
            const due = task.dueDate || '';
            let dueClass = '';
            let dueLabel = '';
            if (due) {
                const d = new Date(due + 'T00:00:00');
                const diff = Math.round((d - today) / 86400000);
                if (!task.done) {
                    if (diff < 0) { dueClass = 'lab-task-due-overdue'; dueLabel = `${Math.abs(diff)}d atrasado`; }
                    else if (diff === 0) { dueClass = 'lab-task-due-soon'; dueLabel = 'Hoje'; }
                    else if (diff <= 2) { dueClass = 'lab-task-due-soon'; dueLabel = `${diff}d`; }
                    else { dueLabel = `${diff}d`; }
                } else {
                    dueLabel = this._fmtBR(due);
                }
            }
            return `<div class="lab-task-item">
                <input type="checkbox" class="lab-task-check" data-idx="${i}" ${task.done ? 'checked' : ''}>
                <span class="lab-task-text ${task.done ? 'lab-task-done' : ''}">${this._esc(task.text)}</span>
                ${due ? `<span class="lab-task-due ${dueClass}" title="${this._fmtBR(due)}"><i data-lucide="calendar-clock" style="width:12px;height:12px;vertical-align:-2px"></i> ${dueLabel}</span>` : ''}
                <input type="date" class="input input-sm lab-task-due-input" data-idx="${i}" value="${due}" title="Prazo">
                <button class="lab-task-del" data-idx="${i}" title="Remover"><i data-lucide="x" style="width:14px;height:14px;vertical-align:-2px"></i></button>
            </div>`;
        }).join('');

        container.querySelectorAll('.lab-task-check').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const idx = parseInt(cb.dataset.idx);
                this._toggleTask(idx);
            });
        });
        container.querySelectorAll('.lab-task-due-input').forEach(inp => {
            inp.addEventListener('change', (e) => {
                const idx = parseInt(inp.dataset.idx);
                this._setTaskDueDate(idx, inp.value);
            });
        });
        container.querySelectorAll('.lab-task-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx);
                this._deleteTask(idx);
            });
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _getTasksList() {
        if (this._editingId) {
            const test = this._tests.find(t => t.id === this._editingId);
            if (test) {
                if (!test.tasks) test.tasks = [];
                return test.tasks;
            }
        }
        if (!this._tempTasks) this._tempTasks = [];
        return this._tempTasks;
    },

    _addTask() {
        const text = document.getElementById('lab-task-text')?.value?.trim();
        if (!text) { showToast('Escreva a tarefa', 'error'); return; }
        const dueDate = document.getElementById('lab-task-due')?.value || '';
        const tasks = this._getTasksList();
        tasks.push({
            id: 'labtask_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
            text,
            done: false,
            dueDate,
        });
        if (this._editingId) this._persist();
        this._renderTasks(tasks);
        document.getElementById('lab-task-text').value = '';
        document.getElementById('lab-task-due').value = '';
        showToast('Tarefa adicionada!', 'success');
        if (typeof EventBus !== 'undefined') EventBus.emit('labTestsChanged');
    },

    _toggleTask(idx) {
        const tasks = this._getTasksList();
        if (!tasks[idx]) return;
        tasks[idx].done = !tasks[idx].done;
        if (this._editingId) this._persist();
        this._renderTasks(tasks);
        if (typeof EventBus !== 'undefined') EventBus.emit('labTestsChanged');
    },

    _setTaskDueDate(idx, dueDate) {
        const tasks = this._getTasksList();
        if (!tasks[idx]) return;
        tasks[idx].dueDate = dueDate || '';
        if (this._editingId) this._persist();
        this._renderTasks(tasks);
        if (typeof EventBus !== 'undefined') EventBus.emit('labTestsChanged');
    },

    _deleteTask(idx) {
        const tasks = this._getTasksList();
        if (!tasks[idx]) return;
        tasks.splice(idx, 1);
        if (this._editingId) this._persist();
        this._renderTasks(tasks);
        if (typeof EventBus !== 'undefined') EventBus.emit('labTestsChanged');
    },

    _handleSave(e) {
        e.preventDefault();
        const get = (id) => document.getElementById(id)?.value?.trim() || '';

        const parseNum = (id) => {
            const v = get(id).replace(/[^0-9.,-]/g, '').replace(',', '.');
            const n = parseFloat(v);
            return isNaN(n) ? null : n;
        };
        const data = {
            title: get('lab-title'),
            category: get('lab-category'),
            area: get('lab-area'),
            dateStart: get('lab-date-start'),
            dateEnd: get('lab-date-end'),
            hypothesis: get('lab-hypothesis'),
            expectedMetric: get('lab-expected-metric'),
            baselineValue: get('lab-baseline'),
            budgetBefore: parseNum('lab-budget-before'),
            budgetAfter: parseNum('lab-budget-after'),
            budgetCurrency: get('lab-budget-currency') || 'BRL',
            productId: get('lab-product'),
            creativeId: get('lab-creative'),
            region: get('lab-region'),
            interest: get('lab-interest'),
            metrics: (() => {
                const m = {};
                for (const key of ['cpc','cpa','ctr','sales','roas','budget']) {
                    const bv = document.getElementById(`lab-m-${key}-before`)?.value;
                    const av = document.getElementById(`lab-m-${key}-after`)?.value;
                    if (bv) m[`${key}_before`] = parseFloat(bv);
                    if (av) m[`${key}_after`] = parseFloat(av);
                }
                return m;
            })(),
            status: get('lab-status'),
            conclusion: get('lab-conclusion'),
            result: get('lab-result'),
            finalValue: get('lab-final-value'),
            keepChange: get('lab-keep-change') === 'true',
            learnings: get('lab-learnings'),
            stages: (() => {
                const hasStages = document.getElementById('test-has-stages')?.checked;
                if (!hasStages) return [];
                return this._buildStagesFromForm();
            })(),
        };

        if (!data.title) { showToast('Preencha o título', 'error'); return; }

        // Conflict check: warn (but don't block) if another active test of the same product
        // overlaps in time AND can't be distinguished by region/creativeId/interest.
        const conflict = this._findOverlappingTest(data, this._editingId);
        if (conflict) {
            const reason = !data.region && !conflict.region && !data.creativeId && !conflict.creativeId && !data.interest && !conflict.interest
                ? 'Defina País, Criativo ou Interesse em pelo menos um deles pra evitar mistura de dados.'
                : 'Os filtros de País/Criativo/Interesse desses dois testes batem — eles vão computar os mesmos lançamentos.';
            showToast(`Conflito: já existe teste ativo "${conflict.title}" (${this._fmtBR(conflict.dateStart)} até ${this._fmtBR(conflict.dateEnd) || '—'}) sobreposto. ${reason}`, 'warning');
        }

        let savedTest;
        if (this._editingId) {
            const idx = this._tests.findIndex(t => t.id === this._editingId);
            if (idx >= 0) {
                this._tests[idx] = { ...this._tests[idx], ...data, updatedAt: new Date().toISOString() };
                savedTest = this._tests[idx];
            }
        } else {
            const newTest = {
                id: 'lab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
                ...data,
                observations: this._tempObs || [],
                tasks: this._tempTasks || [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            this._tests.unshift(newTest);
            this._tempObs = null;
            this._tempTasks = null;
            savedTest = newTest;
        }

        try {
            this._persist();
        } catch (err) {
            // _persist já mostrou toast de erro. Não fecha o modal pra usuário editar/exportar.
            console.error('[LabTests] save failed:', err);
            return;
        }
        try { if (savedTest) this._syncTestToDiary(savedTest); } catch (e) { console.warn('[LabTests] sync to diary failed:', e); }
        this._closeModal();
        this._renderCards();
        showToast(this._editingId ? 'Teste atualizado!' : 'Teste criado!', 'success');
    },

    _findOverlappingTest(data, ignoreId) {
        if (!data.productId || !data.dateStart) return null;
        const dataEnd = data.dateEnd || data.dateStart;
        return this._tests.find(t => {
            if (t.id === ignoreId) return false;
            if (t.productId !== data.productId) return false;
            if (t.status === 'cancelado' || t.status === 'concluido') return false;
            const tEnd = t.dateEnd || t.dateStart;
            const overlap = !(dataEnd < t.dateStart || data.dateStart > tEnd);
            if (!overlap) return false;
            // A segregator only distinguishes when BOTH sides set it to different values.
            // If one side is empty, its evaluation uses parents (full aggregate) — which
            // includes the other side's data, so they conflict.
            const distinguished = (
                (data.region && t.region && data.region !== t.region) ||
                (data.creativeId && t.creativeId && data.creativeId !== t.creativeId) ||
                (data.interest && t.interest && data.interest.trim().toLowerCase() !== t.interest.trim().toLowerCase())
            );
            return !distinguished;
        });
    },

    _deleteTest(id) {
        const test = this._tests.find(t => t.id === id);
        this._tests = this._tests.filter(t => t.id !== id);
        this._persistOverwrite();
        if (test) this._removeTestFromDiary(test);
        this._renderCards();
        showToast('Teste excluído', 'success');
    },

    // ── Diary integration ────────────────────────────────────────────
    // Mirror each lab test as a diary entry on the test's product so it shows up
    // in the Diário with isTest=true. Linked via labTestId, idempotent.

    _syncTestToDiary(test) {
        if (!test || !test.productId) return;
        if (typeof AppState === 'undefined' || !Array.isArray(AppState.allDiary)) return;
        if (!test.dateStart) return;

        const product = (AppState.allProducts || AppState.products || []).find(p => p.id === test.productId);
        const storeId = product?.storeId
            || (typeof AppState.currentStoreId !== 'undefined' ? AppState.currentStoreId : '');
        if (!storeId) return;

        const validation = (() => {
            if (test.status !== 'concluido') return 'pendente';
            if (test.result === 'positivo') return 'validado';
            if (test.result === 'negativo') return 'nao_validado';
            return 'pendente';
        })();

        const metricLabelHtml = this.METRICS[test.expectedMetric]?.label || '';
        const metricLabelText = metricLabelHtml.replace(/<[^>]*>/g, '').trim();
        const testGoal = test.baselineValue
            ? `${metricLabelText}${metricLabelText ? ': ' : ''}${test.baselineValue}`
            : metricLabelText;

        const noteParts = [`[Teste do Pipeline] ${test.title || ''}`.trim()];
        if (test.hypothesis) noteParts.push(test.hypothesis);
        const notes = noteParts.filter(Boolean).join(' — ');

        // Build the day-by-day list spanning [dateStart, dateEnd]. One diary entry
        // per day so the importer (which upserts by productId+date+single-day period)
        // finds and merges into it instead of creating a parallel row.
        const dates = (() => {
            const arr = [];
            const start = new Date(test.dateStart + 'T00:00:00');
            const end = new Date((test.dateEnd || test.dateStart) + 'T00:00:00');
            if (isNaN(start) || isNaN(end) || end < start) return [test.dateStart];
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                arr.push(d.toISOString().slice(0, 10));
            }
            return arr;
        })();

        // Migrate legacy single-period entry: drop it before creating per-day entries.
        const legacyId = 'dia_lab_' + test.id;
        const legacyIdx = AppState.allDiary.findIndex(d => d.id === legacyId);
        if (legacyIdx >= 0) AppState.allDiary.splice(legacyIdx, 1);

        const currency = product?.priceCurrency || 'BRL';

        dates.forEach(date => {
            const entryId = `dia_lab_${test.id}_${date}`;
            const baseFields = {
                id: entryId,
                productId: test.productId,
                storeId,
                date,
                periodStart: date,
                periodEnd: date,
                testEndDate: test.dateEnd || '',
                isTest: true,
                testType: 'product',
                testValidation: validation,
                testGoal,
                notes,
                creativeId: test.creativeId || '',
                labTestId: test.id,
                region: test.region || '',
                interest: test.interest || '',
            };

            // Find ALL candidate rows for this product+date (non-campaign), so we
            // can dedupe orphans left from earlier sync attempts. Skip rows owned
            // by a different test.
            const candidates = [];
            for (let i = 0; i < AppState.allDiary.length; i++) {
                const d = AppState.allDiary[i];
                if (d.id === entryId) { candidates.push(i); continue; }
                if (d.isCampaign || d.parentId) continue;
                if (d.productId !== test.productId) continue;
                if (d.date !== date) continue;
                if (d.labTestId && d.labTestId !== test.id) continue;
                candidates.push(i);
            }

            if (candidates.length === 0) {
                AppState.allDiary.push({
                    budget: 0, budgetCurrency: currency,
                    sales: 0, revenue: 0, revenueCurrency: currency,
                    cpa: 0, cpc: 0,
                    impressions: 0, pageViews: 0, addToCart: 0, checkout: 0,
                    platform: '',
                    ...baseFields,
                });
                return;
            }

            // Pick the keeper: prefer a row that already carries this test's labTestId,
            // else the row with the most data (sum of metrics), else the first.
            const score = (e) => {
                if (e.labTestId === test.id) return 1e9;
                return Number(e.sales || 0) + Number(e.budget || 0) + Number(e.pageViews || 0);
            };
            candidates.sort((a, b) => score(AppState.allDiary[b]) - score(AppState.allDiary[a]));
            const keeperIdx = candidates[0];
            const keeper = AppState.allDiary[keeperIdx];

            // Merge metrics from any duplicate orphans into the keeper before deleting,
            // so we don't lose data the user might have entered.
            const orphans = candidates.slice(1).map(i => AppState.allDiary[i]);
            orphans.forEach(o => {
                ['budget','sales','revenue','impressions','pageViews','addToCart','checkout'].forEach(k => {
                    if (!keeper[k] && o[k]) keeper[k] = o[k];
                });
                ['cpa','cpc','atcRate','checkoutRate','saleRate','viewPageRate'].forEach(k => {
                    if (!keeper[k] && o[k]) keeper[k] = o[k];
                });
            });
            // Apply test fields
            AppState.allDiary[keeperIdx] = { ...keeper, ...baseFields };
            // Drop the orphans (highest indices first to keep positions stable)
            const orphanIdxs = candidates.slice(1).sort((a, b) => b - a);
            orphanIdxs.forEach(i => AppState.allDiary.splice(i, 1));
        });

        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        if (typeof filterDataByStore === 'function') filterDataByStore();
        if (typeof EventBus !== 'undefined') EventBus.emit('diaryChanged');
    },

    _removeTestFromDiary(test) {
        if (!test || typeof AppState === 'undefined' || !Array.isArray(AppState.allDiary)) return;
        const before = AppState.allDiary.length;
        AppState.allDiary = AppState.allDiary.filter(d => d.labTestId !== test.id && d.id !== 'dia_lab_' + test.id);
        if (AppState.allDiary.length === before) return;
        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        if (typeof filterDataByStore === 'function') filterDataByStore();
        if (typeof EventBus !== 'undefined') EventBus.emit('diaryChanged');
    },

    // ── Calendar ──────────────────────────────────────────────────────

    _renderCalendar() {
        const container = document.getElementById('diary-calendar-content');
        if (!container) return;

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        // Get diary entries
        let diaryEntries = [];
        if (typeof DiaryModule !== 'undefined' && DiaryModule._entries) {
            diaryEntries = DiaryModule._entries;
        }

        // Get lab tests
        const labTests = this._tests.filter(t => t.status !== 'cancelado');

        // Get diary test entries (isTest=true)
        const diaryTests = diaryEntries.filter(e => e.isTest);

        // Build calendar
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

        // Group diary by date
        const byDate = {};
        for (const e of diaryEntries) {
            if (!e.date) continue;
            const d = e.date.slice(0, 10);
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(e);
        }

        let html = `
        <div class="cal-header">
            <button class="btn btn-secondary btn-sm" id="cal-prev-month">◀</button>
            <h3 class="cal-month-title">${monthNames[month]} ${year}</h3>
            <button class="btn btn-secondary btn-sm" id="cal-next-month">▶</button>
        </div>
        <div class="cal-weekdays">
            <span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span>
        </div>
        <div class="cal-grid">`;

        // Empty cells before first day
        for (let i = 0; i < firstDay; i++) html += '<div class="cal-day cal-day-empty"></div>';

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const entries = byDate[dateStr] || [];
            const isToday = dateStr === now.toISOString().slice(0, 10);

            // Find active lab tests on this day
            const activeLabTests = labTests.filter(t => t.dateStart <= dateStr && t.dateEnd >= dateStr);

            // Find active diary tests on this day
            const activeDiaryTests = diaryTests.filter(e => e.date?.slice(0, 10) === dateStr);

            // Metrics summary
            let totalSales = 0, totalBudget = 0, totalRevenue = 0;
            for (const e of entries) {
                totalSales += e.sales || 0;
                totalBudget += e.budget || 0;
                totalRevenue += e.revenue || 0;
            }
            const cpa = totalSales > 0 ? (totalBudget / totalSales) : 0;
            // Shopify data for this day (preloaded async)
            const shopifyData = this._shopifyByDate[dateStr] || null;
            const shopifySales = shopifyData ? Number(shopifyData.sales || 0) : 0;
            const realCpa = shopifySales > 0 ? (totalBudget / shopifySales) : 0;

            // Day color based on performance (prefer CPA Real when Shopify data available)
            let dayClass = '';
            if (entries.length > 0) {
                const cpaForColor = shopifySales > 0 ? realCpa : cpa;
                const salesForColor = shopifySales > 0 ? shopifySales : totalSales;
                if (salesForColor > 0 && cpaForColor <= 30) dayClass = 'cal-day-green';
                else if (salesForColor > 0 && cpaForColor <= 60) dayClass = 'cal-day-yellow';
                else if (totalBudget > 0) dayClass = 'cal-day-red';
                else dayClass = 'cal-day-neutral';
            }

            // Test markers
            const markers = activeLabTests.map(t => {
                const cat = this.CATEGORIES[t.category] || this.CATEGORIES.outro;
                return `<span class="cal-marker" style="background:${cat.color}" title="${this._esc(t.title)}"></span>`;
            }).join('');

            const diaryTestMarkers = activeDiaryTests.length > 0
                ? `<span class="cal-marker" style="background:#f59e0b" title="${activeDiaryTests.length} teste(s) de produto"></span>`
                : '';

            const shopifyCell = shopifyData
                ? `<span class="cal-metric-shopify" title="Vendas Shopify: ${shopifySales}${realCpa > 0 ? ' / CPA Real: R$' + realCpa.toFixed(2) : ''}"><i data-lucide="shopping-cart" style="width:14px;height:14px;vertical-align:-2px"></i>${shopifySales}${realCpa > 0 ? ' · R$' + Math.round(realCpa) : ''}</span>`
                : '';

            html += `
            <div class="cal-day ${dayClass} ${isToday ? 'cal-day-today' : ''}" data-date="${dateStr}">
                <span class="cal-day-num">${day}</span>
                ${entries.length > 0 || shopifyData ? `<div class="cal-day-metrics">
                    ${totalSales > 0 ? `<span class="cal-metric-sales" title="Vendas Facebook">${totalSales}v</span>` : ''}
                    ${shopifyCell}
                    ${totalBudget > 0 ? `<span class="cal-metric-budget">R$${Math.round(totalBudget)}</span>` : ''}
                </div>` : ''}
                <div class="cal-markers">${markers}${diaryTestMarkers}</div>
            </div>`;
        }

        html += '</div>';

        // Kick off Shopify preload for this month (re-renders when done)
        this._ensureShopifyMonthData(year, month);

        // Active tests summary
        const activeTests = labTests.filter(t => t.status === 'ativo');
        if (activeTests.length > 0 || diaryTests.length > 0) {
            html += `<div class="cal-tests-summary">
                <h4><i data-lucide="flask-conical" style="width:14px;height:14px;vertical-align:-2px"></i> Testes Ativos</h4>`;

            for (const t of activeTests) {
                const cat = this.CATEGORIES[t.category] || this.CATEGORIES.outro;
                const elapsed = Math.max(0, Math.ceil((now - new Date(t.dateStart)) / 86400000));
                const total = Math.max(1, Math.ceil((new Date(t.dateEnd) - new Date(t.dateStart)) / 86400000));
                html += `<div class="cal-test-item" data-id="${t.id}">
                    <span class="lab-category-badge" style="background:${cat.bg};color:${cat.color}">${cat.icon}</span>
                    <div class="cal-test-info">
                        <strong>${this._esc(t.title)}</strong>
                        <span>${t.dateStart} <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> ${t.dateEnd} (dia ${elapsed}/${total})</span>
                    </div>
                </div>`;
            }

            // Diary test entries
            const uniqueDiaryTests = [...new Set(diaryTests.map(e => e.testGoal || e.testNotes).filter(Boolean))];
            for (const goal of uniqueDiaryTests.slice(0, 5)) {
                html += `<div class="cal-test-item">
                    <span class="lab-category-badge" style="background:#fef3c7;color:#d97706"><i data-lucide="bar-chart-3" style="width:14px;height:14px;vertical-align:-2px"></i></span>
                    <div class="cal-test-info">
                        <strong>${this._esc(goal)}</strong>
                        <span>Teste de produto (diário)</span>
                    </div>
                </div>`;
            }

            html += '</div>';
        }

        container.innerHTML = html;

        // Bind day clicks
        container.querySelectorAll('.cal-day[data-date]').forEach(dayEl => {
            dayEl.addEventListener('click', () => this._showDayPopup(dayEl.dataset.date, byDate, labTests, diaryTests));
        });

        // Bind test item clicks
        container.querySelectorAll('.cal-test-item[data-id]').forEach(el => {
            el.addEventListener('click', () => {
                // Switch to Laboratório tab and open modal
                document.querySelector('.tab-btn[data-tab="laboratorio"]')?.click();
                this._openModal(el.dataset.id);
            });
        });

        // Month navigation
        document.getElementById('cal-prev-month')?.addEventListener('click', () => this._navigateMonth(-1));
        document.getElementById('cal-next-month')?.addEventListener('click', () => this._navigateMonth(1));

        this._calYear = year;
        this._calMonth = month;
    },

    _navigateMonth(delta) {
        let m = (this._calMonth || new Date().getMonth()) + delta;
        let y = this._calYear || new Date().getFullYear();
        if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
        this._calMonth = m;
        this._calYear = y;

        // Re-render with new month
        const now = new Date(y, m, 15);
        const container = document.getElementById('diary-calendar-content');
        if (!container) return;

        // Temporarily override Date for calendar render
        const origMonth = now.getMonth();
        // Just re-call with stored values
        this._renderCalendarMonth(y, m);
    },

    _renderCalendarMonth(year, month) {
        // Same logic as _renderCalendar but with specific year/month
        const container = document.getElementById('diary-calendar-content');
        if (!container) return;

        const now = new Date();
        let diaryEntries = [];
        if (typeof DiaryModule !== 'undefined' && DiaryModule._entries) diaryEntries = DiaryModule._entries;
        const labTests = this._tests.filter(t => t.status !== 'cancelado');
        const diaryTests = diaryEntries.filter(e => e.isTest);

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

        const byDate = {};
        for (const e of diaryEntries) {
            if (!e.date) continue;
            const d = e.date.slice(0, 10);
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(e);
        }

        let html = `
        <div class="cal-header">
            <button class="btn btn-secondary btn-sm" id="cal-prev-month">◀</button>
            <h3 class="cal-month-title">${monthNames[month]} ${year}</h3>
            <button class="btn btn-secondary btn-sm" id="cal-next-month">▶</button>
        </div>
        <div class="cal-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div>
        <div class="cal-grid">`;

        for (let i = 0; i < firstDay; i++) html += '<div class="cal-day cal-day-empty"></div>';

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const entries = byDate[dateStr] || [];
            const isToday = dateStr === now.toISOString().slice(0, 10);
            const activeLabTests = labTests.filter(t => t.dateStart <= dateStr && t.dateEnd >= dateStr);
            const activeDiaryTests = diaryTests.filter(e => e.date?.slice(0, 10) === dateStr);

            let totalSales = 0, totalBudget = 0;
            for (const e of entries) { totalSales += e.sales || 0; totalBudget += e.budget || 0; }
            const cpa = totalSales > 0 ? totalBudget / totalSales : 0;
            const shopifyData = this._shopifyByDate[dateStr] || null;
            const shopifySales = shopifyData ? Number(shopifyData.sales || 0) : 0;
            const realCpa = shopifySales > 0 ? (totalBudget / shopifySales) : 0;

            let dayClass = '';
            if (entries.length) {
                const cpaForColor = shopifySales > 0 ? realCpa : cpa;
                const salesForColor = shopifySales > 0 ? shopifySales : totalSales;
                if (salesForColor > 0 && cpaForColor <= 30) dayClass = 'cal-day-green';
                else if (salesForColor > 0 && cpaForColor <= 60) dayClass = 'cal-day-yellow';
                else if (totalBudget > 0) dayClass = 'cal-day-red';
                else dayClass = 'cal-day-neutral';
            }

            const markers = activeLabTests.map(t => {
                const cat = this.CATEGORIES[t.category] || this.CATEGORIES.outro;
                return `<span class="cal-marker" style="background:${cat.color}" title="${this._esc(t.title)}"></span>`;
            }).join('') + (activeDiaryTests.length ? `<span class="cal-marker" style="background:#f59e0b"></span>` : '');

            const shopifyCell = shopifyData
                ? `<span class="cal-metric-shopify" title="Shopify: ${shopifySales}${realCpa > 0 ? ' / CPA Real: R$' + realCpa.toFixed(2) : ''}"><i data-lucide="shopping-cart" style="width:14px;height:14px;vertical-align:-2px"></i>${shopifySales}${realCpa > 0 ? ' · R$' + Math.round(realCpa) : ''}</span>`
                : '';

            html += `<div class="cal-day ${dayClass} ${isToday ? 'cal-day-today' : ''}" data-date="${dateStr}">
                <span class="cal-day-num">${day}</span>
                ${entries.length || shopifyData ? `<div class="cal-day-metrics">${totalSales ? `<span class="cal-metric-sales" title="Vendas Facebook">${totalSales}v</span>` : ''}${shopifyCell}${totalBudget ? `<span class="cal-metric-budget">R$${Math.round(totalBudget)}</span>` : ''}</div>` : ''}
                <div class="cal-markers">${markers}</div>
            </div>`;
        }

        html += '</div>';
        container.innerHTML = html;

        container.querySelectorAll('.cal-day[data-date]').forEach(d => {
            d.addEventListener('click', () => this._showDayPopup(d.dataset.date, byDate, labTests, diaryTests));
        });
        document.getElementById('cal-prev-month')?.addEventListener('click', () => this._navigateMonth(-1));
        document.getElementById('cal-next-month')?.addEventListener('click', () => this._navigateMonth(1));

        // Kick off Shopify preload (re-renders when loaded)
        this._ensureShopifyMonthData(year, month);
    },

    async _ensureShopifyMonthData(year, month) {
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured || !ShopifyModule.isConfigured()) return;
        const key = `${year}-${month}`;
        if (this._shopifyMonthKey === key) return;
        const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const last = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        try {
            const map = await ShopifyModule.getSalesMapByDate(first, last);
            this._shopifyByDate = map || {};
            this._shopifyMonthKey = key;
            // Re-render current month (avoid recursive fetch via key guard above)
            if (this._calYear != null && this._calMonth != null) {
                this._renderCalendarMonth(this._calYear, this._calMonth);
            } else {
                this._renderCalendar();
            }
        } catch (err) {
            console.warn('[Calendar] Shopify preload failed:', err);
        }
    },

    _showDayPopup(dateStr, byDate, labTests, diaryTests) {
        document.getElementById('cal-day-popup')?.remove();

        const entries = byDate[dateStr] || [];
        const activeTests = labTests.filter(t => t.dateStart <= dateStr && t.dateEnd >= dateStr);
        const dayDiaryTests = diaryTests.filter(e => e.date?.slice(0, 10) === dateStr);

        let totalSales = 0, totalBudget = 0, totalRevenue = 0, totalImpressions = 0;
        let totalCpc = 0, cpcCount = 0;
        for (const e of entries) {
            totalSales += e.sales || 0;
            totalBudget += e.budget || 0;
            totalRevenue += e.revenue || 0;
            totalImpressions += e.impressions || 0;
            if (e.cpc) { totalCpc += e.cpc; cpcCount++; }
        }
        const cpa = totalSales > 0 ? totalBudget / totalSales : 0;
        const avgCpc = cpcCount > 0 ? totalCpc / cpcCount : 0;
        const shopifyData = this._shopifyByDate[dateStr] || null;
        const shopifySales = shopifyData ? Number(shopifyData.sales || 0) : 0;
        const shopifyRevenue = shopifyData ? Number(shopifyData.revenue || 0) : 0;
        const realCpa = shopifySales > 0 ? totalBudget / shopifySales : 0;
        const diff = shopifyData && totalSales > 0 ? (shopifySales - totalSales) : 0;

        const popup = document.createElement('div');
        popup.id = 'cal-day-popup';
        popup.className = 'cal-popup';
        popup.innerHTML = `
            <div class="cal-popup-header">
                <strong><i data-lucide="calendar" style="width:14px;height:14px;vertical-align:-2px"></i> ${dateStr}</strong>
                <button class="btn-close" onclick="document.getElementById('cal-day-popup').remove()"><i data-lucide="x" style="width:14px;height:14px;vertical-align:-2px"></i></button>
            </div>
            ${entries.length ? `
            <div class="cal-popup-metrics">
                <div class="cal-popup-metric"><span>Vendas FB</span><strong>${totalSales}</strong></div>
                <div class="cal-popup-metric"><span>Vendas Shopify</span><strong>${shopifyData ? shopifySales + (diff !== 0 && totalSales > 0 ? ` <small style="color:${diff > 0 ? 'var(--green)' : 'var(--red)'}">(${diff > 0 ? '+' : ''}${diff})</small>` : '') : '-'}</strong></div>
                <div class="cal-popup-metric"><span>Orçamento</span><strong>R$${totalBudget.toFixed(2)}</strong></div>
                <div class="cal-popup-metric"><span>CPA</span><strong>${cpa > 0 ? 'R$' + cpa.toFixed(2) : '-'}</strong></div>
                <div class="cal-popup-metric"><span>CPA Real</span><strong>${realCpa > 0 ? 'R$' + realCpa.toFixed(2) : '-'}</strong></div>
                <div class="cal-popup-metric"><span>CPC</span><strong>${avgCpc > 0 ? 'R$' + avgCpc.toFixed(2) : '-'}</strong></div>
                ${shopifyRevenue > 0 ? `<div class="cal-popup-metric"><span>Receita Shopify</span><strong>${shopifyData.currency || ''} ${shopifyRevenue.toFixed(2)}</strong></div>` : ''}
            </div>` : (shopifyData ? `<div class="cal-popup-metrics"><div class="cal-popup-metric"><span>Vendas Shopify</span><strong>${shopifySales}</strong></div>${shopifyRevenue > 0 ? `<div class="cal-popup-metric"><span>Receita</span><strong>${shopifyData.currency || ''} ${shopifyRevenue.toFixed(2)}</strong></div>` : ''}</div>` : '<p style="color:var(--text-muted);font-size:0.8rem;margin:0.5rem 0">Sem dados do diário</p>')}
            ${activeTests.length ? `<div class="cal-popup-tests">
                <strong><i data-lucide="flask-conical" style="width:14px;height:14px;vertical-align:-2px"></i> Testes Lab:</strong>
                ${activeTests.map(t => `<div class="cal-popup-test">${this.CATEGORIES[t.category]?.icon || '<i data-lucide="pin" style="width:14px;height:14px;vertical-align:-2px"></i>'} ${this._esc(t.title)}</div>`).join('')}
            </div>` : ''}
            ${dayDiaryTests.length ? `<div class="cal-popup-tests">
                <strong><i data-lucide="bar-chart-3" style="width:14px;height:14px;vertical-align:-2px"></i> Testes Produto:</strong>
                ${dayDiaryTests.map(e => `<div class="cal-popup-test"><i data-lucide="tag" style="width:14px;height:14px;vertical-align:-2px"></i>️ ${this._esc(e.testGoal || e.testNotes || 'Teste')}</div>`).join('')}
            </div>` : ''}
        `;

        document.getElementById('diary-calendar-content')?.appendChild(popup);
    },

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    },

    // Converte yyyy-mm-dd → dd/mm/yyyy (formato BR)
    _fmtBR(iso) {
        if (!iso || typeof iso !== 'string') return iso || '';
        const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return iso;
        return `${m[3]}/${m[2]}/${m[1]}`;
    },

    // ── Multi-Stage support ───────────────────────────────────────────

    _genStageId() {
        return 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    },

    _renderStagesProgress(test) {
        if (!test.stages || !test.stages.length) return '';
        const stages = [...test.stages].sort((a, b) => a.order - b.order);
        const statusIcon = { pendente: '<i data-lucide="hourglass" style="width:14px;height:14px;vertical-align:-2px"></i>', em_andamento: '<i data-lucide="microscope" style="width:14px;height:14px;vertical-align:-2px"></i>', concluido: '<i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i>' };
        const statusColor = { pendente: '#9ca3af', em_andamento: 'var(--accent)', concluido: '#059669' };

        const steps = stages.map((s, i) => {
            const isActive = s.status === 'em_andamento';
            const isDone = s.status === 'concluido';
            return `<div class="lab-stage-step ${isActive ? 'lab-stage-active' : ''} ${isDone ? 'lab-stage-done' : ''}" data-stage-id="${s.id}" data-test-id="${test.id}">
                <div class="lab-stage-circle" style="background:${statusColor[s.status] || '#9ca3af'}" title="${s.status}">${statusIcon[s.status] || '<i data-lucide="hourglass" style="width:14px;height:14px;vertical-align:-2px"></i>'}</div>
                <div class="lab-stage-label">
                    <span>${this._esc(s.name || 'Fase ' + s.order)}</span>
                    ${s.result !== null && s.result !== undefined ? `<small style="color:${s.result === 'positivo' ? '#059669' : s.result === 'negativo' ? '#dc2626' : '#6b7280'}">${s.result}</small>` : ''}
                </div>
                ${i < stages.length - 1 ? '<div class="lab-stage-arrow"><i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i></div>' : ''}
            </div>`;
        }).join('');

        const activeStage = stages.find(s => s.status === 'em_andamento');
        const advanceBtn = activeStage
            ? `<button class="btn btn-secondary btn-sm lab-stage-advance-btn" data-test-id="${test.id}" data-stage-id="${activeStage.id}" style="margin-top:0.5rem;font-size:0.75rem">
                ▶ Avançar Fase: "${this._esc(activeStage.name || 'Fase ' + activeStage.order)}"
               </button>` : '';

        return `<div class="lab-stages-container">
            <div class="lab-stages-track">${steps}</div>
            ${advanceBtn}
            ${activeStage?.observations ? `<p class="lab-stage-obs">${this._esc(activeStage.observations)}</p>` : ''}
        </div>`;
    },

    _advanceStage(testId, stageId) {
        const test = this._tests.find(t => t.id === testId);
        if (!test || !test.stages) return;

        const stages = [...test.stages].sort((a, b) => a.order - b.order);
        const idx = stages.findIndex(s => s.id === stageId);
        if (idx < 0) return;

        const result = prompt('Resultado desta fase (positivo / negativo / neutro):') || 'neutro';
        const obs = prompt('Observações desta fase (opcional):') || '';

        stages[idx].status = 'concluido';
        stages[idx].result = ['positivo','negativo','neutro'].includes(result) ? result : 'neutro';
        stages[idx].observations = obs;

        // Start next stage
        if (idx + 1 < stages.length) {
            stages[idx + 1].status = 'em_andamento';
        }

        test.stages = stages;
        test.updatedAt = new Date().toISOString();
        this._persist();
        this._renderCards();
        showToast('Fase avançada!', 'success');
    },

    _buildStagesFromForm() {
        const rows = document.querySelectorAll('#test-stages-list .lab-stage-row');
        const stages = [];
        rows.forEach((row, i) => {
            const name = row.querySelector('.lab-stage-name')?.value?.trim() || ('Fase ' + (i + 1));
            const status = row.querySelector('.lab-stage-status')?.value || 'pendente';
            const obs = row.querySelector('.lab-stage-obs-input')?.value?.trim() || '';
            stages.push({
                id: row.dataset.stageId || this._genStageId(),
                order: i + 1,
                name,
                status: i === 0 && stages.length === 0 ? 'em_andamento' : status,
                result: null,
                observations: obs,
            });
        });
        return stages;
    },

    _addStageRow(container, stage = null, index = 0) {
        const stageId = stage?.id || this._genStageId();
        const row = document.createElement('div');
        row.className = 'lab-stage-row';
        row.dataset.stageId = stageId;
        row.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:0.35rem';
        row.innerHTML = `
            <span style="color:var(--text-muted);font-size:0.75rem;min-width:50px">Fase ${index + 1}</span>
            <input class="input lab-stage-name" type="text" placeholder="Nome da fase" value="${this._esc(stage?.name || '')}" style="flex:2">
            <select class="input lab-stage-status" style="flex:1">
                <option value="pendente" ${(!stage || stage.status === 'pendente') ? 'selected' : ''}><i data-lucide="hourglass" style="width:14px;height:14px;vertical-align:-2px"></i> Pendente</option>
                <option value="em_andamento" ${stage?.status === 'em_andamento' ? 'selected' : ''}><i data-lucide="microscope" style="width:14px;height:14px;vertical-align:-2px"></i> Em andamento</option>
                <option value="concluido" ${stage?.status === 'concluido' ? 'selected' : ''}><i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Concluído</option>
            </select>
            <input class="input lab-stage-obs-input" type="text" placeholder="Observações" value="${this._esc(stage?.observations || '')}" style="flex:2">
            <button type="button" class="btn-icon lab-stage-del" style="color:var(--red)" title="Remover fase">×</button>
        `;
        row.querySelector('.lab-stage-del')?.addEventListener('click', () => row.remove());
        container.appendChild(row);
    },
};
