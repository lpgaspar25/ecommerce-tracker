/* ===========================
   Daily Targets Calculator — vendas/dia necessárias para breakeven, lucro X%
   e conversão Y%, baseado no orçamento real diário do produto.
   Atualiza automaticamente quando o orçamento muda (na aba Diário, na importação,
   ou manualmente neste formulário).
   =========================== */

const DailyTargetsCalculator = {
    _storageKey: 'etracker_daily_targets',
    _state: {
        productId: '',
        budgetUSD: 0,                 // valor atual em USD (UI mostra na moeda escolhida)
        budgetCurrency: 'USD',
        visitors: 0,
        targetProfitPct: 20,          // % sobre receita
        targetConvPct: 2,
    },
    _userOverrides: {},               // por productId: { budgetUSD?, visitors?, targetProfitPct?, targetConvPct? }

    init() {
        this._loadOverrides();

        const productSel = document.getElementById('dt-product');
        const budgetInput = document.getElementById('dt-budget');
        const budgetCurrencySel = document.getElementById('dt-budget-currency');
        const visitorsInput = document.getElementById('dt-visitors');
        const profitInput = document.getElementById('dt-target-profit');
        const convInput = document.getElementById('dt-target-conv');
        const resetBtn = document.getElementById('dt-reset');
        if (!productSel) return; // not on this page

        productSel.addEventListener('change', () => {
            this._state.productId = productSel.value;
            this._loadProductDefaults();
            this._render();
        });
        const onChangeBudget = () => {
            const v = parseFloat(budgetInput.value) || 0;
            const cur = budgetCurrencySel?.value || 'USD';
            this._state.budgetCurrency = cur;
            this._state.budgetUSD = (typeof convertToUSD === 'function')
                ? convertToUSD(v, cur)
                : v;
            this._state.budgetSource = 'Editado por você (não sincroniza com o Diário)';
            const srcEl = document.getElementById('dt-budget-source');
            if (srcEl) srcEl.textContent = this._state.budgetSource;
            const resyncBtn = document.getElementById('dt-budget-resync');
            if (resyncBtn) resyncBtn.style.display = '';
            this._saveOverride({ budgetUSD: this._state.budgetUSD });
            this._render();
        };
        budgetInput?.addEventListener('input', onChangeBudget);
        budgetCurrencySel?.addEventListener('change', onChangeBudget);
        document.getElementById('dt-budget-resync')?.addEventListener('click', () => {
            // Drop the budget override and re-pull from diary
            if (this._userOverrides[this._state.productId]) {
                delete this._userOverrides[this._state.productId].budgetUSD;
                this._saveAllOverrides();
            }
            this._loadProductDefaults();
            this._render();
        });
        visitorsInput?.addEventListener('input', () => {
            this._state.visitors = parseInt(visitorsInput.value) || 0;
            this._state.visitorsSource = 'Editado manualmente';
            const srcEl = document.getElementById('dt-visitors-source');
            if (srcEl) srcEl.textContent = this._state.visitorsSource;
            this._saveOverride({ visitors: this._state.visitors });
            this._render();
        });
        document.getElementById('dt-visitors-recalc')?.addEventListener('click', () => {
            this._estimateVisitorsFromCpc();
        });
        profitInput?.addEventListener('input', () => {
            this._state.targetProfitPct = parseFloat(profitInput.value) || 0;
            this._saveOverride({ targetProfitPct: this._state.targetProfitPct });
            this._render();
        });
        convInput?.addEventListener('input', () => {
            this._state.targetConvPct = parseFloat(convInput.value) || 0;
            this._saveOverride({ targetConvPct: this._state.targetConvPct });
            this._render();
        });
        resetBtn?.addEventListener('click', () => {
            delete this._userOverrides[this._state.productId];
            this._saveAllOverrides();
            this._loadProductDefaults();
            this._render();
        });

        // Auto-refresh when data changes
        if (typeof EventBus !== 'undefined') {
            EventBus.on('dataLoaded', () => this._refreshProductList());
            EventBus.on('productsChanged', () => this._refreshProductList());
            EventBus.on('diaryChanged', () => {
                // When budget for current product changes (new import), refresh defaults
                if (!this._userOverrides[this._state.productId]?.budgetUSD) {
                    this._loadProductDefaults();
                    this._render();
                }
            });
            EventBus.on('tabChanged', (tab) => {
                if (tab === 'goals') {
                    this._refreshProductList();
                }
            });
        }

        this._refreshProductList();
    },

    _loadOverrides() {
        try { this._userOverrides = JSON.parse(localStorage.getItem(this._storageKey) || '{}'); }
        catch { this._userOverrides = {}; }
    },
    _saveAllOverrides() {
        localStorage.setItem(this._storageKey, JSON.stringify(this._userOverrides));
    },
    _saveOverride(partial) {
        if (!this._state.productId || this._state.productId === 'todos') return;
        this._userOverrides[this._state.productId] = {
            ...(this._userOverrides[this._state.productId] || {}),
            ...partial,
        };
        this._saveAllOverrides();
    },

    _refreshProductList() {
        const sel = document.getElementById('dt-product');
        if (!sel) return;
        const products = (AppState.products || AppState.allProducts || []).filter(p => p.status === 'ativo');
        sel.innerHTML = products.map(p => `<option value="${p.id}">${this._esc(p.name)}</option>`).join('');
        if (products.length === 0) {
            sel.innerHTML = '<option value="">Sem produtos ativos</option>';
            this._render();
            return;
        }
        // Keep selection if still valid, else first
        if (!products.some(p => p.id === this._state.productId)) {
            this._state.productId = products[0].id;
        }
        sel.value = this._state.productId;
        this._loadProductDefaults();
        this._render();
    },

    _loadProductDefaults() {
        const pid = this._state.productId;
        if (!pid) return;
        const override = this._userOverrides[pid] || {};

        // Today's actual budget + visitors for this product.
        // Strategy: sum SUB-ENTRIES (per-campaign rows) when they exist, since the
        // parent entry can get overwritten when the user uploads multiple reports
        // for the same product/date (e.g. one per region). Sub-entries persist
        // across uploads, so summing them gives the true total budget.
        // Fallback to parent entry only when no sub-entries exist.
        const today = (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0, 10);
        const todaySubs = (AppState.diary || []).filter(d =>
            d.isCampaign && d.productId === pid && d.date === today
        );
        const todayParents = (AppState.diary || []).filter(d =>
            !d.isCampaign && !d.parentId && d.productId === pid && d.date === today
        );
        const todayEntries = todaySubs.length ? todaySubs : todayParents;

        let budgetUSD = 0;
        let visitors = 0;
        let visitorsSource = '';
        let budgetSource = '';
        let budgetUsedConfigured = false;
        let avgCpcUSD = 0;
        let detectedBudgetCurrency = '';
        if (todayEntries.length) {
            const anyConfigured = todayEntries.some(e => Number(e.budgetConfigured || 0) > 0);
            todayEntries.forEach(e => {
                const raw = anyConfigured ? Number(e.budgetConfigured || e.budget || 0) : Number(e.budget || 0);
                budgetUSD += convertToUSD(raw, e.budgetCurrency || 'USD');
                visitors  += Number(e.pageViews || 0);
                if (!detectedBudgetCurrency && e.budgetCurrency) detectedBudgetCurrency = e.budgetCurrency;
            });
            budgetUsedConfigured = anyConfigured;
            if (budgetUSD > 0) {
                const suffix = anyConfigured ? ' — orçamento configurado' : ' — gasto real';
                budgetSource = todaySubs.length
                    ? `Sincronizado com Diário (soma de ${todaySubs.length} campanhas hoje${suffix})`
                    : `Sincronizado com Diário (hoje${suffix})`;
            }
            if (visitors > 0) visitorsSource = todaySubs.length
                ? `Soma das ${todaySubs.length} campanhas hoje`
                : 'Visitantes de hoje';
        }

        const start = new Date();
        start.setDate(start.getDate() - 7);
        const startStr = start.toISOString().slice(0, 10);
        // For 7-day average, use sub-entries when available (more complete), else parents
        const recentSubs = (AppState.diary || []).filter(d =>
            d.isCampaign && d.productId === pid && d.date >= startStr && d.date <= today
        );
        const recentParents = (AppState.diary || []).filter(d =>
            !d.isCampaign && !d.parentId && d.productId === pid && d.date >= startStr && d.date <= today
        );
        // Group by date to compute daily totals, then average
        const groupByDate = (arr) => {
            const map = {};
            const anyConfiguredRecent = arr.some(e => Number(e.budgetConfigured || 0) > 0);
            arr.forEach(e => {
                const k = e.date;
                if (!map[k]) map[k] = { budgetUSD: 0, visitors: 0 };
                const raw = anyConfiguredRecent ? Number(e.budgetConfigured || e.budget || 0) : Number(e.budget || 0);
                map[k].budgetUSD += convertToUSD(raw, e.budgetCurrency || 'USD');
                map[k].visitors += Number(e.pageViews || 0);
                if (!detectedBudgetCurrency && e.budgetCurrency) detectedBudgetCurrency = e.budgetCurrency;
            });
            return map;
        };
        const recent = recentSubs.length ? recentSubs : recentParents;

        if (todayEntries.length === 0 && recent.length) {
            const dailyMap = groupByDate(recent);
            const dayKeys = Object.keys(dailyMap);
            const totalBudget = dayKeys.reduce((s, k) => s + dailyMap[k].budgetUSD, 0);
            const totalVisitors = dayKeys.reduce((s, k) => s + dailyMap[k].visitors, 0);
            budgetUSD = totalBudget / dayKeys.length;
            visitors = totalVisitors / dayKeys.length;
            if (budgetUSD > 0) budgetSource = 'Média dos últimos 7 dias (sem dado de hoje)';
            if (visitors > 0) visitorsSource = 'Média dos últimos 7 dias';
        }

        // CPC fallback for visitors: avg CPC over recent entries → visitors = budget / cpc
        if (recent.length) {
            let cpcSum = 0, cpcCount = 0;
            recent.forEach(e => {
                if ((e.cpc || 0) > 0) {
                    cpcSum += convertToUSD(e.cpc, e.cpcCurrency || e.budgetCurrency || 'USD');
                    cpcCount++;
                }
            });
            if (cpcCount > 0) avgCpcUSD = cpcSum / cpcCount;
        }
        this._state.avgCpcUSD = avgCpcUSD;

        // If no real visitor data but we have CPC + budget, estimate
        if (!visitors && avgCpcUSD > 0) {
            const targetBudget = override.budgetUSD ?? budgetUSD;
            if (targetBudget > 0) {
                visitors = targetBudget / avgCpcUSD;
                visitorsSource = `Estimado: orçamento ÷ CPC médio ($${avgCpcUSD.toFixed(2)})`;
            }
        }

        this._state.budgetUSD = override.budgetUSD ?? budgetUSD;
        this._state.budgetSource = override.budgetUSD !== undefined && override.budgetUSD !== null
            ? 'Editado por você (não sincroniza com o Diário)'
            : (budgetSource || 'Sem dados — preencha manualmente');
        this._state.visitors = override.visitors ?? Math.round(visitors);
        this._state.visitorsSource = override.visitors !== undefined && override.visitors !== null
            ? 'Editado manualmente'
            : (visitorsSource || 'Sem dados — preencha manualmente');
        this._state.targetProfitPct = override.targetProfitPct ?? 20;
        this._state.targetConvPct = override.targetConvPct ?? 2;

        // Sync inputs
        const budgetInput = document.getElementById('dt-budget');
        const budgetCurrencySel = document.getElementById('dt-budget-currency');
        const visitorsInput = document.getElementById('dt-visitors');
        const visitorsSrcEl = document.getElementById('dt-visitors-source');
        const profitInput = document.getElementById('dt-target-profit');
        const convInput = document.getElementById('dt-target-conv');
        const product = (AppState.products || []).find(p => p.id === pid);
        // Prefer the currency the budget actually arrived in (from import). Fallback
        // to product's price currency, then USD.
        const cur = (override.budgetCurrency || detectedBudgetCurrency || product?.priceCurrency || 'USD');
        this._state.budgetCurrency = cur;
        this._state.displayCurrency = cur;
        if (budgetCurrencySel) budgetCurrencySel.value = cur;
        if (budgetInput) budgetInput.value = (convertCurrency(this._state.budgetUSD, 'USD', cur) || 0).toFixed(2);
        const budgetSrcEl = document.getElementById('dt-budget-source');
        if (budgetSrcEl) budgetSrcEl.textContent = this._state.budgetSource || '';
        // Show resync button only when there's a manual override
        const resyncBtn = document.getElementById('dt-budget-resync');
        if (resyncBtn) resyncBtn.style.display = (override.budgetUSD !== undefined && override.budgetUSD !== null) ? '' : 'none';
        if (visitorsInput) visitorsInput.value = this._state.visitors;
        if (visitorsSrcEl) visitorsSrcEl.textContent = this._state.visitorsSource || '';
        if (profitInput) profitInput.value = this._state.targetProfitPct;
        if (convInput) convInput.value = this._state.targetConvPct;
    },

    // Force-recompute visitors estimate (Orçamento ÷ CPC médio).
    _estimateVisitorsFromCpc() {
        if (!this._state.avgCpcUSD || this._state.budgetUSD <= 0) return;
        const visitors = Math.round(this._state.budgetUSD / this._state.avgCpcUSD);
        this._state.visitors = visitors;
        this._state.visitorsSource = `Estimado: orçamento ÷ CPC médio ($${this._state.avgCpcUSD.toFixed(2)})`;
        // Clear manual override so next defaults reload doesn't keep stale value
        if (this._userOverrides[this._state.productId]) {
            delete this._userOverrides[this._state.productId].visitors;
            this._saveAllOverrides();
        }
        const visitorsInput = document.getElementById('dt-visitors');
        const visitorsSrcEl = document.getElementById('dt-visitors-source');
        if (visitorsInput) visitorsInput.value = visitors;
        if (visitorsSrcEl) visitorsSrcEl.textContent = this._state.visitorsSource;
        this._render();
    },

    // Per-sale margin BEFORE ad cost (Price - Cost - Tax% - VarCost%) in USD
    _marginPerSaleUSD(product) {
        if (!product) return 0;
        const priceUSD = convertToUSD(product.price || 0, product.priceCurrency || 'USD');
        const costUSD  = convertToUSD(product.cost || 0,  product.costCurrency  || product.priceCurrency || 'USD');
        const tax = (product.tax || 0) / 100;
        const varCost = (product.variableCosts || 0) / 100;
        return priceUSD * (1 - tax - varCost) - costUSD;
    },

    _calculate() {
        const product = (AppState.products || []).find(p => p.id === this._state.productId);
        if (!product) return null;

        const M = this._marginPerSaleUSD(product);            // margem unitária (USD)
        const Budget = this._state.budgetUSD;
        const Visitors = this._state.visitors;
        const PriceUSD = convertToUSD(product.price || 0, product.priceCurrency || 'USD');

        const result = {
            margin: M,
            budgetUSD: Budget,
            visitors: Visitors,
            priceUSD: PriceUSD,
            scenarios: []
        };

        // Helper: build a scenario object using a ceiled-integer sales count, so
        // the profit/conv/cpa/roas shown reflect what the user actually achieves
        // when they hit that integer sales target.
        const buildScenario = (key, label, exactSales) => {
            const sales = Math.ceil(exactSales);
            const revenue = sales * PriceUSD;
            const profit = sales * M - Budget;
            return {
                key, label, sales,
                profit,
                conv: Visitors > 0 ? (sales / Visitors) * 100 : null,
                cpa: sales > 0 ? Budget / sales : 0,
                roas: Budget > 0 ? revenue / Budget : 0,
            };
        };

        // 1) Breakeven
        if (M > 0 && Budget > 0) {
            result.scenarios.push(buildScenario('breakeven', 'Breakeven (zerar)', Budget / M));
        }

        // 2) Target profit margin %
        const x = this._state.targetProfitPct;
        if (M > 0 && Budget > 0 && x > 0) {
            const denom = M - (x / 100) * PriceUSD;
            if (denom > 0) {
                result.scenarios.push(buildScenario('profit', `Lucro ${x}% (sobre receita)`, Budget / denom));
            } else {
                result.scenarios.push({
                    key: 'profit',
                    label: `Lucro ${x}% (sobre receita)`,
                    sales: null,
                    unreachable: true,
                    note: 'Inalcançável: margem unitária menor que o lucro alvo',
                });
            }
        }

        // 3) Target conversion %
        const y = this._state.targetConvPct;
        if (Visitors > 0 && y > 0) {
            result.scenarios.push(buildScenario('conv', `Conversão ${y}%`, Visitors * (y / 100)));
        }

        return result;
    },

    _render() {
        const cardsEl = document.getElementById('dt-cards');
        const summary = document.getElementById('dt-summary');
        if (!cardsEl || !summary) return;

        const r = this._calculate();
        const cur = this._state.displayCurrency || this._state.budgetCurrency || 'USD';
        if (!r || r.budgetUSD <= 0) {
            summary.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">Preencha um orçamento diário para calcular as metas.</div>';
            cardsEl.innerHTML = '';
            return;
        }

        const M_local = convertCurrency(r.margin, 'USD', cur);
        // Today's actual sales / conversion: prefer summing sub-entries when present
        const todayPid = this._state.productId;
        const todayDate = todayISO();
        const todaySubsRender = (AppState.diary || []).filter(d =>
            d.isCampaign && d.productId === todayPid && d.date === todayDate
        );
        let todaySales = 0, todayPV = 0;
        if (todaySubsRender.length) {
            todaySubsRender.forEach(e => {
                todaySales += Number(e.sales || 0);
                todayPV += Number(e.pageViews || 0);
            });
        } else {
            const parentToday = (AppState.diary || []).find(d =>
                !d.isCampaign && !d.parentId && d.productId === todayPid && d.date === todayDate
            );
            todaySales = parentToday?.sales || 0;
            todayPV = parentToday?.pageViews || 0;
        }
        const todayConv = todayPV > 0 ? (todaySales / todayPV) * 100 : 0;

        summary.innerHTML = `
            <div style="display:flex;flex-wrap:wrap;gap:1rem;font-size:0.82rem;padding:0.6rem 0.8rem;background:var(--bg-input);border-radius:6px">
                <span><span style="color:var(--text-muted)">Margem/venda:</span> <strong>${this._fmtMoney(M_local, cur)}</strong></span>
                <span><span style="color:var(--text-muted)">Vendas hoje:</span> <strong>${todaySales}</strong></span>
                <span><span style="color:var(--text-muted)">Conversão hoje:</span> <strong>${todayConv > 0 ? todayConv.toFixed(2) + '%' : '--'}</strong></span>
            </div>`;

        if (r.scenarios.length === 0) {
            cardsEl.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:1.5rem">Margem zero ou negativa — verifique preço/custo do produto.</div>';
            return;
        }

        cardsEl.innerHTML = r.scenarios.map(s => {
            if (s.unreachable) {
                return `<div class="dt-card dt-card-unreachable">
                    <div class="dt-card-header">${this._esc(s.label)}</div>
                    <div class="dt-card-warning">${this._esc(s.note)}</div>
                </div>`;
            }
            const onTrack = todaySales >= s.sales;
            const statusCls = onTrack ? 'on-track' : 'off-track';
            const statusLabel = onTrack ? 'No alvo' : 'Faltam ' + (s.sales - todaySales);
            const profitFmt = s.profit !== undefined ? this._fmtMoney(convertCurrency(s.profit, 'USD', cur), cur) : '--';
            const convFmt = s.conv !== null && s.conv !== undefined && s.conv > 0 ? s.conv.toFixed(2) + '%' : '--';
            const cpaFmt = s.cpa > 0 ? this._fmtMoney(convertCurrency(s.cpa, 'USD', cur), cur) : '--';
            const roasFmt = s.roas > 0 ? s.roas.toFixed(2) + 'x' : '--';
            const accent = s.key === 'breakeven' ? '#6b7280' : s.key === 'profit' ? '#059669' : '#3b82f6';
            return `<div class="dt-card" style="--dt-accent:${accent}">
                <div class="dt-card-label">${this._esc(s.label)}</div>
                <div class="dt-card-main">
                    <span class="dt-card-sales">${s.sales}</span>
                    <span class="dt-card-unit">vendas/dia</span>
                </div>
                <div class="dt-card-status dt-status-${statusCls}">${statusLabel}</div>
                <div class="dt-card-grid">
                    <div><span>Lucro</span><strong>${profitFmt}</strong></div>
                    <div><span>Conv.</span><strong>${convFmt}</strong></div>
                    <div><span>CPA</span><strong>${cpaFmt}</strong></div>
                    <div><span>ROAS</span><strong>${roasFmt}</strong></div>
                </div>
            </div>`;
        }).join('');
    },

    _fmtMoney(v, currency) {
        const symbol = currency === 'BRL' ? 'R$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
        const sign = v < 0 ? '-' : '';
        return sign + symbol + Math.abs(v).toFixed(2);
    },

    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};

document.addEventListener('DOMContentLoaded', () => DailyTargetsCalculator.init());
