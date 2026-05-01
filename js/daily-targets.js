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
            this._saveOverride({ budgetUSD: this._state.budgetUSD });
            this._render();
        };
        budgetInput?.addEventListener('input', onChangeBudget);
        budgetCurrencySel?.addEventListener('change', onChangeBudget);
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

        // Today's actual budget + visitors for this product (excluding sub-entries)
        const today = (typeof todayISO === 'function') ? todayISO() : new Date().toISOString().slice(0, 10);
        const todayEntries = (AppState.diary || []).filter(d =>
            !d.isCampaign && !d.parentId && d.productId === pid && d.date === today
        );

        // Fallback: avg of last 7 days
        let budgetUSD = 0;
        let visitors = 0;
        let visitorsSource = '';   // human-readable label about where visitors came from
        let avgCpcUSD = 0;
        if (todayEntries.length) {
            todayEntries.forEach(e => {
                budgetUSD += convertToUSD(e.budget || 0, e.budgetCurrency || 'USD');
                visitors  += Number(e.pageViews || 0);
            });
            if (visitors > 0) visitorsSource = 'Visitantes de hoje';
        }

        const start = new Date();
        start.setDate(start.getDate() - 7);
        const startStr = start.toISOString().slice(0, 10);
        const recent = (AppState.diary || []).filter(d =>
            !d.isCampaign && !d.parentId && d.productId === pid && d.date >= startStr && d.date <= today
        );

        if (todayEntries.length === 0 && recent.length) {
            let bSum = 0, vSum = 0;
            recent.forEach(e => {
                bSum += convertToUSD(e.budget || 0, e.budgetCurrency || 'USD');
                vSum += Number(e.pageViews || 0);
            });
            budgetUSD = bSum / recent.length;
            visitors = vSum / recent.length;
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
        const cur = product?.priceCurrency || 'USD';
        this._state.budgetCurrency = cur;
        if (budgetCurrencySel) budgetCurrencySel.value = cur;
        if (budgetInput) budgetInput.value = (convertCurrency(this._state.budgetUSD, 'USD', cur) || 0).toFixed(2);
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
        const tbody = document.getElementById('dt-results-body');
        const summary = document.getElementById('dt-summary');
        if (!tbody || !summary) return;

        const r = this._calculate();
        if (!r || r.budgetUSD <= 0) {
            summary.innerHTML = '<div style="color:var(--text-muted);font-size:0.85rem">Preencha um orçamento diário para calcular as metas.</div>';
            tbody.innerHTML = '';
            return;
        }

        // Summary line
        const product = (AppState.products || []).find(p => p.id === this._state.productId);
        const cur = product?.priceCurrency || 'USD';
        const M_local = convertCurrency(r.margin, 'USD', cur);
        const todaySalesEntry = (AppState.diary || []).find(d =>
            !d.isCampaign && !d.parentId && d.productId === this._state.productId && d.date === todayISO()
        );
        const todaySales = todaySalesEntry?.sales || 0;
        summary.innerHTML = `
            <div class="dt-summary-line">
                <span>Margem unitária (antes de ads): <strong>${this._fmtMoney(M_local, cur)}</strong></span>
                <span>Vendas hoje: <strong>${todaySales}</strong></span>
            </div>`;

        if (r.scenarios.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1rem">Margem zero ou negativa — verifique preço/custo do produto.</td></tr>';
            return;
        }

        tbody.innerHTML = r.scenarios.map(s => {
            if (s.unreachable) {
                return `<tr>
                    <td><strong>${this._esc(s.label)}</strong></td>
                    <td colspan="5" style="color:var(--red);font-style:italic">${this._esc(s.note)}</td>
                </tr>`;
            }
            const onTrack = todaySales >= s.sales;
            const statusIcon = onTrack ? '✅' : '🎯';
            const profitFmt = s.profit !== undefined ? this._fmtMoney(convertCurrency(s.profit, 'USD', cur), cur) : '--';
            const convFmt = s.conv !== null && s.conv !== undefined ? s.conv.toFixed(2) + '%' : '--';
            const cpaFmt = s.cpa > 0 ? this._fmtMoney(convertCurrency(s.cpa, 'USD', cur), cur) : '--';
            const roasFmt = s.roas > 0 ? s.roas.toFixed(2) + 'x' : '--';
            return `<tr>
                <td><strong>${this._esc(s.label)}</strong></td>
                <td class="num"><span style="font-size:1.1rem"><strong>${s.sales}</strong></span> ${statusIcon}</td>
                <td class="num">${profitFmt}</td>
                <td class="num">${convFmt}</td>
                <td class="num">${cpaFmt}</td>
                <td class="num">${roasFmt}</td>
            </tr>`;
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
