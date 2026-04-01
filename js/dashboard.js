/* ===========================
   Dashboard.js — Comprehensive Analytics Dashboard
   =========================== */

const DashboardModule = {
    _chartInstance: null,
    _topMode: 'profit',
    _calMetric: 'cpa',
    _calYear: new Date().getFullYear(),
    _calMonth: new Date().getMonth(), // 0-based
    _calProduct: 'todos',

    // Date state
    _startDate: '',
    _endDate: '',
    _compareStart: '',
    _compareEnd: '',
    _compareMode: 'prev',  // 'prev', 'lastYear', 'custom', 'none'
    _productFilter: 'todos',
    _currency: 'BRL',
    _activePreset: '30',

    init() {
        // Set default dates (last 30 days)
        this._applyPreset('30');
        this._initRiskParamsModal();

        // Date picker toggle
        document.getElementById('dash-date-picker-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const dd = document.getElementById('dash-date-dropdown');
            const cdd = document.getElementById('dash-compare-dropdown');
            if (cdd) cdd.style.display = 'none';
            dd.style.display = dd.style.display === 'none' ? 'flex' : 'none';
        });

        // Date presets
        document.querySelectorAll('.dash-date-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.dash-date-preset').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const preset = btn.dataset.preset;
                if (preset !== 'custom') {
                    this._applyPreset(preset);
                    document.getElementById('dash-date-dropdown').style.display = 'none';
                    this.refresh();
                }
                // For 'custom', keep dropdown open for manual date input
            });
        });

        // Date apply/cancel
        document.getElementById('dash-date-apply')?.addEventListener('click', () => {
            this._startDate = document.getElementById('dash-date-start').value;
            this._endDate = document.getElementById('dash-date-end').value;
            this._activePreset = 'custom';
            this._updateDateLabel();
            this._updateCompare();
            document.getElementById('dash-date-dropdown').style.display = 'none';
            this.refresh();
        });
        document.getElementById('dash-date-cancel')?.addEventListener('click', () => {
            document.getElementById('dash-date-dropdown').style.display = 'none';
        });

        // Compare toggle
        document.getElementById('dash-compare-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const dd = document.getElementById('dash-compare-dropdown');
            const pdd = document.getElementById('dash-date-dropdown');
            if (pdd) pdd.style.display = 'none';
            dd.style.display = dd.style.display === 'none' ? 'flex' : 'none';
        });

        // Compare presets
        document.querySelectorAll('.dash-compare-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.dash-compare-preset').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._compareMode = btn.dataset.cmp;
                if (btn.dataset.cmp !== 'custom') {
                    this._updateCompare();
                    document.getElementById('dash-compare-dropdown').style.display = 'none';
                    this.refresh();
                }
            });
        });

        document.getElementById('dash-compare-apply')?.addEventListener('click', () => {
            this._compareStart = document.getElementById('dash-compare-start').value;
            this._compareEnd = document.getElementById('dash-compare-end').value;
            this._compareMode = 'custom';
            document.getElementById('dash-compare-dropdown').style.display = 'none';
            this._updateCompareLabel();
            this.refresh();
        });
        document.getElementById('dash-compare-cancel')?.addEventListener('click', () => {
            document.getElementById('dash-compare-dropdown').style.display = 'none';
        });

        // Close dropdowns on outside click
        document.addEventListener('click', (e) => {
            ['dash-date-dropdown', 'dash-compare-dropdown'].forEach(id => {
                const dd = document.getElementById(id);
                if (dd && dd.style.display !== 'none') {
                    const wrap = dd.parentElement;
                    if (wrap && !wrap.contains(e.target)) dd.style.display = 'none';
                }
            });
        });

        // Currency selector
        document.getElementById('dash-currency')?.addEventListener('change', (e) => {
            this._currency = e.target.value;
            this.refresh();
        });

        // Product filter
        document.getElementById('dash-product-filter')?.addEventListener('change', (e) => {
            this._productFilter = e.target.value;
            this.refresh();
        });

        // Top products tabs
        document.querySelectorAll('.dash-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dash-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._topMode = btn.dataset.top;
                this._renderTopProducts();
            });
        });

        EventBus.on('dataLoaded', () => this.refresh());
        EventBus.on('storeChanged', () => this.refresh());
        EventBus.on('diaryChanged', () => this.refresh());
        EventBus.on('productsChanged', () => this.refresh());
        EventBus.on('goalsChanged', () => this.refresh());
        EventBus.on('tabChanged', (tab) => { if (tab === 'dashboard') this.refresh(); });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _applyPreset(preset) {
        const today = todayISO();
        const d = new Date();
        let start, end = today, label = '';

        switch (preset) {
            case 'today': start = end = today; label = 'Hoje'; break;
            case 'yesterday':
                d.setDate(d.getDate() - 1);
                start = end = d.toISOString().split('T')[0]; label = 'Ontem'; break;
            case '7': d.setDate(d.getDate() - 6); start = d.toISOString().split('T')[0]; label = 'Últimos 7 dias'; break;
            case '14': d.setDate(d.getDate() - 13); start = d.toISOString().split('T')[0]; label = 'Últimos 14 dias'; break;
            case '30': d.setDate(d.getDate() - 29); start = d.toISOString().split('T')[0]; label = 'Últimos 30 dias'; break;
            case '90': d.setDate(d.getDate() - 89); start = d.toISOString().split('T')[0]; label = 'Últimos 90 dias'; break;
            case 'month':
                start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                label = 'Este mês'; break;
            case 'lastMonth': {
                const lm = new Date(d.getFullYear(), d.getMonth() - 1, 1);
                start = lm.toISOString().split('T')[0];
                const lmEnd = new Date(d.getFullYear(), d.getMonth(), 0);
                end = lmEnd.toISOString().split('T')[0];
                label = 'Mês passado'; break;
            }
            default: return;
        }
        this._startDate = start;
        this._endDate = end;
        this._activePreset = preset;

        const startEl = document.getElementById('dash-date-start');
        const endEl = document.getElementById('dash-date-end');
        if (startEl) startEl.value = start;
        if (endEl) endEl.value = end;

        const labelEl = document.getElementById('dash-date-label');
        if (labelEl) labelEl.textContent = label;

        this._updateCompare();
    },

    _updateDateLabel() {
        const labelEl = document.getElementById('dash-date-label');
        if (!labelEl) return;
        if (this._activePreset === 'custom') {
            labelEl.textContent = `${formatDate(this._startDate)} – ${formatDate(this._endDate)}`;
        }
    },

    _updateCompare() {
        if (this._compareMode === 'none') {
            this._compareStart = '';
            this._compareEnd = '';
            this._updateCompareLabel();
            return;
        }

        const start = new Date(this._startDate + 'T00:00:00');
        const end = new Date(this._endDate + 'T00:00:00');
        const days = Math.round((end - start) / 86400000) + 1;

        if (this._compareMode === 'prev') {
            const cEnd = new Date(start);
            cEnd.setDate(cEnd.getDate() - 1);
            const cStart = new Date(cEnd);
            cStart.setDate(cStart.getDate() - days + 1);
            this._compareStart = cStart.toISOString().split('T')[0];
            this._compareEnd = cEnd.toISOString().split('T')[0];
        } else if (this._compareMode === 'lastYear') {
            const cStart = new Date(start);
            cStart.setFullYear(cStart.getFullYear() - 1);
            const cEnd = new Date(end);
            cEnd.setFullYear(cEnd.getFullYear() - 1);
            this._compareStart = cStart.toISOString().split('T')[0];
            this._compareEnd = cEnd.toISOString().split('T')[0];
        }

        const csEl = document.getElementById('dash-compare-start');
        const ceEl = document.getElementById('dash-compare-end');
        if (csEl) csEl.value = this._compareStart;
        if (ceEl) ceEl.value = this._compareEnd;

        this._updateCompareLabel();
    },

    _updateCompareLabel() {
        const el = document.getElementById('dash-compare-label');
        if (!el) return;
        if (this._compareMode === 'none' || !this._compareStart) {
            el.textContent = 'Comparar';
        } else {
            el.textContent = `vs ${formatDate(this._compareStart)} – ${formatDate(this._compareEnd)}`;
        }
    },

    // ── Risk Parameters ──────────────────────────────────────────
    _riskDefaults: { cpaOver: 50, cpmInc: 30, cpcInc: 30, noSalesBRL: 250, convMin: 1 },

    _getRiskParams() {
        try {
            const saved = JSON.parse(localStorage.getItem('dashRiskParams') || '{}');
            return Object.assign({}, this._riskDefaults, saved);
        } catch(e) { return Object.assign({}, this._riskDefaults); }
    },

    _saveRiskParams(params) {
        localStorage.setItem('dashRiskParams', JSON.stringify(params));
    },

    _initRiskParamsModal() {
        document.getElementById('btn-risk-params')?.addEventListener('click', () => {
            const p = this._getRiskParams();
            document.getElementById('rp-cpa-over').value  = p.cpaOver;
            document.getElementById('rp-cpm-inc').value   = p.cpmInc;
            document.getElementById('rp-cpc-inc').value   = p.cpcInc;
            document.getElementById('rp-no-sales').value  = p.noSalesBRL;
            document.getElementById('rp-conv-min').value  = p.convMin;
            openModal('risk-params-modal');
        });

        document.getElementById('risk-params-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const p = {
                cpaOver:    parseFloat(document.getElementById('rp-cpa-over').value)  || this._riskDefaults.cpaOver,
                cpmInc:     parseFloat(document.getElementById('rp-cpm-inc').value)   || this._riskDefaults.cpmInc,
                cpcInc:     parseFloat(document.getElementById('rp-cpc-inc').value)   || this._riskDefaults.cpcInc,
                noSalesBRL: parseFloat(document.getElementById('rp-no-sales').value)  ?? this._riskDefaults.noSalesBRL,
                convMin:    parseFloat(document.getElementById('rp-conv-min').value)  ?? this._riskDefaults.convMin,
            };
            this._saveRiskParams(p);
            closeModal('risk-params-modal');
            this._renderAlerts();
        });

        document.getElementById('rp-reset')?.addEventListener('click', () => {
            const d = this._riskDefaults;
            document.getElementById('rp-cpa-over').value  = d.cpaOver;
            document.getElementById('rp-cpm-inc').value   = d.cpmInc;
            document.getElementById('rp-cpc-inc').value   = d.cpcInc;
            document.getElementById('rp-no-sales').value  = d.noSalesBRL;
            document.getElementById('rp-conv-min').value  = d.convMin;
        });
    },

    refresh() {
        this._populateProductFilter();
        this._renderKPIs();
        this._renderActions();
        this._renderAlerts();
        this._renderGoals();
        this._renderFunnelDiagnosis();
        this._renderChart();
        this._renderTopProducts();
        this._renderMetricsCalendar();
        this._renderEcommerceDates();
        this._renderOpportunities();
        this._renderPortfolio();
        this._renderPipeline();
        this._renderScores();
        this._renderStoresRanking();
        this._renderWidgets();
        this._renderCalendar();
        this._renderBudgetByProduct();
    },

    _populateProductFilter() {
        const select = document.getElementById('dash-product-filter');
        if (!select) return;
        const current = this._productFilter;
        const products = AppState.products || [];
        let html = '<option value="todos">Todos os Produtos</option>';
        products.forEach(p => {
            html += `<option value="${p.id}" ${p.id === current ? 'selected' : ''}>${typeof escapeHtml === 'function' ? escapeHtml(p.name) : p.name}</option>`;
        });
        select.innerHTML = html;
        select.value = current;
    },

    // Helper: get diary entries for the selected period (filtered by product, deduplicated)
    _getPeriodEntries() {
        const entries = (AppState.diary || []).filter(e => {
            if (e.date < this._startDate || e.date > this._endDate) return false;
            if (e.isCampaign) return false;
            if (this._productFilter !== 'todos' && e.productId !== this._productFilter) return false;
            return true;
        });
        // Deduplicate: keep only 1 entry per date+product (last one wins)
        const seen = new Map();
        entries.forEach(e => {
            const key = `${e.date}|${e.productId}`;
            seen.set(key, e);
        });
        return Array.from(seen.values());
    },

    // Helper: get compare period entries (filtered by product, deduplicated)
    _getPrevPeriodEntries() {
        if (this._compareMode === 'none' || !this._compareStart || !this._compareEnd) return [];
        const entries = (AppState.diary || []).filter(e => {
            if (e.date < this._compareStart || e.date > this._compareEnd) return false;
            if (e.isCampaign) return false;
            if (this._productFilter !== 'todos' && e.productId !== this._productFilter) return false;
            return true;
        });
        const seen = new Map();
        entries.forEach(e => { seen.set(`${e.date}|${e.productId}`, e); });
        return Array.from(seen.values());
    },

    // Aggregate metrics from entries
    _aggregate(entries) {
        let budget = 0, revenue = 0, sales = 0, impressions = 0, pageViews = 0, addToCart = 0, checkout = 0, profit = 0;
        let budgetBRL = 0, revenueBRL = 0;
        entries.forEach(e => {
            const bUSD = convertToUSD(e.budget, e.budgetCurrency);
            const rUSD = convertToUSD(e.revenue, e.revenueCurrency);
            budget += bUSD;
            revenue += rUSD;
            // Track original BRL amounts for accurate CPA/ticket in BRL
            budgetBRL += (e.budgetCurrency === 'BRL') ? (e.budget || 0) : convertToBRL(e.budget, e.budgetCurrency);
            revenueBRL += (e.revenueCurrency === 'BRL') ? (e.revenue || 0) : convertToBRL(e.revenue, e.revenueCurrency);
            sales += e.sales || 0;
            impressions += e.impressions || 0;
            pageViews += e.pageViews || 0;
            addToCart += e.addToCart || 0;
            checkout += e.checkout || 0;
            if (typeof DiaryModule !== 'undefined' && DiaryModule.getEntryProfit) {
                profit += DiaryModule.getEntryProfit(e);
            } else {
                profit += rUSD - bUSD;
            }
        });
        return {
            budget, revenue, sales, impressions, pageViews, addToCart, checkout, profit,
            budgetBRL, revenueBRL,
            roas: budget > 0 ? revenue / budget : 0,
            cpa: sales > 0 ? budget / sales : 0,
            cpaBRL: sales > 0 ? budgetBRL / sales : 0,
            ticket: sales > 0 ? revenue / sales : 0,
            ticketBRL: sales > 0 ? revenueBRL / sales : 0,
            convPage: pageViews > 0 ? sales / pageViews * 100 : 0,
        };
    },

    // Row 1: KPIs with comparison to previous period
    _renderKPIs() {
        const current = this._aggregate(this._getPeriodEntries());
        const prev = this._aggregate(this._getPrevPeriodEntries());

        const kpis = [
            { label: 'Faturamento', value: this._fmtCurrencyDirect(current.revenueBRL, current.revenue), delta: this._delta(current.revenue, prev.revenue) },
            { label: 'Lucro', value: this._fmtCurrency(current.profit), delta: this._delta(current.profit, prev.profit), color: current.profit >= 0 ? 'green' : 'red' },
            { label: 'Gasto Ads', value: this._fmtCurrencyDirect(current.budgetBRL, current.budget), delta: this._delta(current.budget, prev.budget) },
            { label: 'ROAS', value: current.roas > 0 ? current.roas.toFixed(2) + 'x' : '--', delta: this._delta(current.roas, prev.roas) },
            { label: 'CPA', value: current.cpa > 0 ? this._fmtCurrencyDirect(current.cpaBRL, current.cpa) : '--', delta: this._delta(current.cpa, prev.cpa, true) },
            { label: 'Pedidos', value: current.sales.toLocaleString('pt-BR'), delta: this._delta(current.sales, prev.sales) },
            { label: 'Ticket Médio', value: current.ticket > 0 ? this._fmtCurrencyDirect(current.ticketBRL, current.ticket) : '--', delta: this._delta(current.ticket, prev.ticket) },
        ];

        const container = document.getElementById('dash-kpis');
        if (!container) return;
        container.innerHTML = kpis.map(k => {
            const deltaClass = k.delta > 0 ? 'dash-delta-up' : k.delta < 0 ? 'dash-delta-down' : '';
            const deltaIcon = k.delta > 0 ? '↑' : k.delta < 0 ? '↓' : '';
            const deltaText = k.delta !== 0 ? `${deltaIcon} ${Math.abs(k.delta).toFixed(0)}%` : '';
            const valueColor = k.color ? `color:var(--${k.color})` : '';
            return `<div class="dash-kpi">
                <span class="dash-kpi-label">${k.label}</span>
                <span class="dash-kpi-value" style="${valueColor}">${k.value}</span>
                <span class="dash-kpi-delta ${deltaClass}">${deltaText}</span>
            </div>`;
        }).join('');
    },

    // Delta calculation (percentage change)
    _delta(current, previous, invert = false) {
        if (!previous || previous === 0) return 0;
        const pct = ((current - previous) / Math.abs(previous)) * 100;
        return invert ? -pct : pct;
    },

    _fmtCurrency(valUSD) {
        // valUSD is always in USD from _aggregate. Convert to selected currency.
        const converted = convertCurrency(valUSD, 'USD', this._currency);
        return formatCurrency(converted, this._currency);
    },

    // Format currency using pre-computed BRL and USD values (avoids round-trip conversion)
    _fmtCurrencyDirect(valBRL, valUSD) {
        if (this._currency === 'BRL') return formatCurrency(valBRL, 'BRL');
        if (this._currency === 'USD') return formatCurrency(valUSD, 'USD');
        // For GBP/EUR, convert from USD
        const converted = convertCurrency(valUSD, 'USD', this._currency);
        return formatCurrency(converted, this._currency);
    },

    // Row 2 Left: Centro de Decisão - action items
    _renderActions() {
        const container = document.getElementById('dash-actions');
        if (!container) return;
        const actions = [];
        const today = todayISO();

        // Tests to validate
        (AppState.diary || []).forEach(e => {
            if (e.isTest && e.testEndDate && e.testEndDate <= today && (!e.testValidation || e.testValidation === 'pendente')) {
                actions.push({ icon: 'flask-conical', text: `Validar teste: ${getProductName(e.productId)}`, type: 'warning' });
            }
        });

        // ROAS dropping products (current period ROAS < 1.5)
        const byProduct = this._groupByProduct(this._getPeriodEntries());
        Object.entries(byProduct).forEach(([pid, entries]) => {
            const agg = this._aggregate(entries);
            if (agg.roas > 0 && agg.roas < 1.5 && agg.budget > 10) {
                actions.push({ icon: 'trending-down', text: `ROAS ${agg.roas.toFixed(1)}x: ${getProductName(pid)}`, type: 'danger' });
            }
        });

        // Goals behind
        (AppState.goals || []).filter(g => g.status === 'ativa').forEach(g => {
            const remaining = daysRemaining(g.endDate);
            if (remaining && remaining.days <= 3 && remaining.days >= 0) {
                actions.push({ icon: 'target', text: `Meta vence em ${remaining.days}d: ${getProductName(g.productId)}`, type: 'warning' });
            }
        });

        if (actions.length === 0) {
            container.innerHTML = '<div class="dash-empty">Nenhuma ação pendente</div>';
            return;
        }
        container.innerHTML = actions.slice(0, 8).map(a =>
            `<div class="dash-action-item dash-action-${a.type}"><i data-lucide="${a.icon}" style="width:14px;height:14px"></i> ${a.text}</div>`
        ).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // Row 2 Right: Produtos em Risco
    _renderAlerts() {
        const container = document.getElementById('dash-alerts');
        if (!container) return;
        const alerts = [];
        const p = this._getRiskParams();
        const entries = this._getPeriodEntries();
        const byProduct = this._groupByProduct(entries);
        const prevEntries = this._getPrevPeriodEntries();
        const byProductPrev = this._groupByProduct(prevEntries);

        // Helper: compute avg CPC in BRL from entries
        const avgCpcBRL = (ents) => {
            let totalBRL = 0, totalClicks = 0;
            ents.forEach(e => {
                if ((e.cpc || 0) > 0) {
                    const clicks = e.budget / e.cpc;
                    totalClicks += clicks;
                    totalBRL += (e.budgetCurrency === 'BRL') ? e.budget : convertToBRL(e.budget, e.budgetCurrency);
                }
            });
            return totalClicks > 0 ? totalBRL / totalClicks : 0;
        };

        Object.entries(byProduct).forEach(([pid, pEntries]) => {
            const agg = this._aggregate(pEntries);
            const name = getProductName(pid);

            // CPA vs target
            const product = typeof getProductById === 'function' ? getProductById(pid) : null;
            if (product && agg.sales > 0) {
                let budgetOriginal = 0;
                pEntries.forEach(e => { budgetOriginal += e.budget || 0; });
                const cpaReal = budgetOriginal / agg.sales;
                const cpaCur = pEntries[0]?.budgetCurrency || 'BRL';
                const cpaTarget = product.cpa || 0;
                const targetCur = product.cpaCurrency || 'BRL';
                const cpaRealUSD = convertToUSD(cpaReal, cpaCur);
                const cpaTargetUSD = convertToUSD(cpaTarget, targetCur);
                if (cpaTargetUSD > 0 && cpaRealUSD > cpaTargetUSD * (1 + p.cpaOver / 100)) {
                    const fmtReal = cpaCur === 'BRL' ? `R$${cpaReal.toFixed(0)}` : `$${cpaReal.toFixed(0)}`;
                    const fmtTarget = targetCur === 'BRL' ? `R$${cpaTarget.toFixed(0)}` : `$${cpaTarget.toFixed(0)}`;
                    alerts.push({ text: `CPA ${fmtReal} (alvo ${fmtTarget}): ${name}`, type: 'danger' });
                }
            }

            // Sem vendas
            if (agg.roas > 0 && agg.roas < 1) alerts.push({ text: `ROAS < 1 (${agg.roas.toFixed(1)}x): ${name}`, type: 'danger' });
            const noSalesUSD = convertToUSD(p.noSalesBRL, 'BRL');
            if (agg.sales === 0 && agg.budget > noSalesUSD) alerts.push({ text: `Sem vendas (R$${agg.budgetBRL.toFixed(0)} gasto): ${name}`, type: 'danger' });
            if (p.convMin > 0 && agg.convPage > 0 && agg.convPage < p.convMin) alerts.push({ text: `Conv. ${agg.convPage.toFixed(1)}% (mín ${p.convMin}%): ${name}`, type: 'warning' });

            // CPM increase vs previous period
            const prevPEntries = byProductPrev[pid] || [];
            if (prevPEntries.length > 0) {
                const prevAgg = this._aggregate(prevPEntries);
                const currCPM = agg.impressions > 0 ? (agg.budgetBRL / agg.impressions * 1000) : 0;
                const prevCPM = prevAgg.impressions > 0 ? (prevAgg.budgetBRL / prevAgg.impressions * 1000) : 0;
                if (currCPM > 0 && prevCPM > 0 && currCPM > prevCPM * (1 + p.cpmInc / 100)) {
                    const pct = Math.round((currCPM / prevCPM - 1) * 100);
                    alerts.push({ text: `CPM +${pct}% (R$${currCPM.toFixed(2)}): ${name}`, type: 'warning' });
                }

                // CPC increase vs previous period
                const currCPC = avgCpcBRL(pEntries);
                const prevCPC = avgCpcBRL(prevPEntries);
                if (currCPC > 0 && prevCPC > 0 && currCPC > prevCPC * (1 + p.cpcInc / 100)) {
                    const pct = Math.round((currCPC / prevCPC - 1) * 100);
                    alerts.push({ text: `CPC +${pct}% (R$${currCPC.toFixed(2)}): ${name}`, type: 'warning' });
                }
            }
        });

        if (alerts.length === 0) {
            container.innerHTML = '<div class="dash-empty">Nenhum produto em risco</div>';
            return;
        }
        container.innerHTML = alerts.slice(0, 8).map(a =>
            `<div class="dash-alert-item dash-alert-${a.type}">${a.text}</div>`
        ).join('');
    },

    // Row 3 Left: Full funnel chart (identical to diary chart)
    _chartMode: 'funnel',
    _chartType: 'bar',
    _chartVisible: null,
    _chartInited: false,

    _chartMetricDefs: {
        faturamento: [
            { key: 'revenue', label: 'Total',              color: '#60a5fa', compute: e => convertToBRL(e.revenue||0, e.revenueCurrency||'BRL') },
            { key: 'profit',  label: 'Lucro',              color: '#34d399', compute: e => convertToBRL(e.revenue||0, e.revenueCurrency||'BRL') - convertToBRL(e.budget||0, e.budgetCurrency||'BRL') },
            { key: 'budget',  label: 'Custo de Marketing', color: '#a78bfa', compute: e => convertToBRL(e.budget||0, e.budgetCurrency||'BRL') },
        ],
        funnel: [
            { key: 'impressions', label: 'Impressões', color: '#6366f1', compute: e => Number(e.impressions || 0) },
            { key: 'cliques',     label: 'Cliques',    color: '#8b5cf6', compute: e => { const c = Number(e.cpc||0); return c > 0 ? Number(e.budget||0)/c : 0; } },
            { key: 'pageViews',   label: 'View Page',  color: '#06b6d4', compute: e => Number(e.pageViews || 0) },
            { key: 'addToCart',   label: 'Add to Cart', color: '#f59e0b', compute: e => Number(e.addToCart || 0) },
            { key: 'checkout',    label: 'Checkout',   color: '#f97316', compute: e => Number(e.checkout || 0) },
            { key: 'sales',       label: 'Vendas',     color: '#10b981', compute: e => Number(e.sales || 0) },
        ],
        rates: [
            { key: 'ctr',          label: 'CTR %',         color: '#8b5cf6', compute: e => { const imp = Number(e.impressions||0); const c = Number(e.cpc||0); const cl = c > 0 ? Number(e.budget||0)/c : 0; return imp > 0 ? (cl/imp)*100 : 0; } },
            { key: 'viewPageRate', label: 'Visualização %', color: '#06b6d4', compute: e => { const c = Number(e.cpc||0); const cl = c > 0 ? Number(e.budget||0)/c : 0; return cl > 0 ? (Number(e.pageViews||0)/cl)*100 : 0; } },
            { key: 'atcRate',      label: 'Carrinho %',    color: '#f59e0b', compute: e => { const pv = Number(e.pageViews||0); return pv > 0 ? (Number(e.addToCart||0)/pv)*100 : 0; } },
            { key: 'checkoutRate', label: 'Checkout %',    color: '#f97316', compute: e => { const atc = Number(e.addToCart||0); return atc > 0 ? (Number(e.checkout||0)/atc)*100 : 0; } },
            { key: 'saleRate',     label: 'Compra %',      color: '#10b981', compute: e => { const co = Number(e.checkout||0); return co > 0 ? (Number(e.sales||0)/co)*100 : 0; } },
            { key: 'convPage',     label: 'Conv. Página %', color: '#ec4899', compute: e => { const pv = Number(e.pageViews||0); return pv > 0 ? (Number(e.sales||0)/pv)*100 : 0; } },
        ],
        budget: [
            { key: 'budgetVal', label: 'Budget',    color: '#a78bfa', compute: e => convertToBRL(e.budget||0, e.budgetCurrency||'BRL') },
            { key: 'cpa',       label: 'CPA',       color: '#ef4444', compute: e => { const s = Number(e.sales||0); return s > 0 ? convertToBRL(e.budget||0, e.budgetCurrency||'BRL') / s : 0; } },
            { key: 'cpc',       label: 'CPC Médio', color: '#f59e0b', compute: e => convertToBRL(e.cpc||0, e.cpcCurrency||e.budgetCurrency||'BRL') },
            { key: 'cpm',       label: 'CPM',       color: '#06b6d4', compute: e => { const imp = Number(e.impressions||0); return imp > 0 ? (convertToBRL(e.budget||0, e.budgetCurrency||'BRL')/imp)*1000 : 0; } },
            { key: 'roas',      label: 'ROAS',      color: '#22c55e', compute: e => { const b = Number(e.budget||0); return b > 0 ? Number(e.revenue||0)/b : 0; } },
        ],
    },

    _initDashChart() {
        if (this._chartInited) return;
        this._chartInited = true;

        document.getElementById('dash-chart-toggles')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.funnel-toggle-btn');
            if (!btn) return;
            const metric = btn.dataset.metric;
            if (this._chartVisible.has(metric)) { this._chartVisible.delete(metric); btn.classList.remove('active'); }
            else { this._chartVisible.add(metric); btn.classList.add('active'); }
            this._renderChart();
        });

        document.getElementById('dash-chart-bar-btn')?.addEventListener('click', () => {
            this._chartType = 'bar';
            document.getElementById('dash-chart-bar-btn').classList.add('active');
            document.getElementById('dash-chart-line-btn').classList.remove('active');
            this._renderChart();
        });
        document.getElementById('dash-chart-line-btn')?.addEventListener('click', () => {
            this._chartType = 'line';
            document.getElementById('dash-chart-line-btn').classList.add('active');
            document.getElementById('dash-chart-bar-btn').classList.remove('active');
            this._renderChart();
        });
        document.getElementById('dash-chart-metric-select')?.addEventListener('change', (e) => {
            this._chartMode = e.target.value;
            this._rebuildDashToggles();
            this._renderChart();
        });

        this._rebuildDashToggles();
    },

    _rebuildDashToggles() {
        const container = document.getElementById('dash-chart-toggles');
        if (!container) return;
        const defs = this._chartMetricDefs[this._chartMode] || [];
        this._chartVisible = new Set(defs.map(d => d.key));
        container.innerHTML = defs.map(d =>
            `<button type="button" class="funnel-toggle-btn active" data-metric="${d.key}" style="--toggle-color:${d.color}">${d.label}</button>`
        ).join('');
    },

    _renderChart() {
        this._initDashChart();
        const canvas = document.getElementById('dash-main-chart');
        if (!canvas) return;
        if (this._chartInstance) { this._chartInstance.destroy(); this._chartInstance = null; }

        const entries = this._getPeriodEntries();
        const byDate = {};
        entries.forEach(e => {
            if (!byDate[e.date]) byDate[e.date] = [];
            byDate[e.date].push(e);
        });
        const dates = Object.keys(byDate).sort();
        if (dates.length === 0) return;

        if (!this._chartVisible) this._rebuildDashToggles();

        const defs = this._chartMetricDefs[this._chartMode] || [];
        const visibleDefs = defs.filter(d => this._chartVisible.has(d.key));
        if (visibleDefs.length === 0) return;

        const labels = dates.map(d => { const p = d.split('-'); return `${p[2]}/${p[1]}`; });
        const isBar      = this._chartType === 'bar';
        const isStacked  = isBar && (this._chartMode === 'faturamento' || this._chartMode === 'funnel');
        const isCurrency = this._chartMode === 'faturamento' || this._chartMode === 'budget';
        const isPercent  = this._chartMode === 'rates';

        const datasets = visibleDefs.map(def => {
            const data = dates.map(date =>
                (byDate[date] || []).reduce((sum, e) => sum + def.compute(e), 0)
            );
            if (isBar) return { label: def.label, data, backgroundColor: def.color + 'CC', borderColor: def.color, borderWidth: 1, borderRadius: 4, stack: isStacked ? 'stack0' : def.key };
            return { label: def.label, data, borderColor: def.color, backgroundColor: def.color + '33', fill: true, tension: 0.4, pointRadius: 3, pointHoverRadius: 6, borderWidth: 2 };
        });

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
                       (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
        const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
        const fmtC = v => 'R$' + Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2});
        const fmtN = v => Math.round(v).toLocaleString('pt-BR');

        this._chartInstance = new Chart(canvas, {
            type: isBar ? 'bar' : 'line',
            data: { labels, datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { display: true, position: 'top', labels: { color: textColor, usePointStyle: true, pointStyle: 'rect', padding: 12 } },
                    tooltip: {
                        backgroundColor: isDark ? '#1e1e2e' : '#fff',
                        titleColor: textColor, bodyColor: textColor, borderColor: gridColor, borderWidth: 1,
                        callbacks: { label: ctx => {
                            const v = ctx.raw;
                            if (isCurrency) return `${ctx.dataset.label}: ${fmtC(v)}`;
                            if (isPercent)  return `${ctx.dataset.label}: ${v.toFixed(2)}%`;
                            if (ctx.dataset.label === 'ROAS') return `ROAS: ${v.toFixed(2)}x`;
                            return `${ctx.dataset.label}: ${fmtN(v)}`;
                        }}
                    }
                },
                scales: {
                    x: { stacked: isStacked, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 11 } } },
                    y: { stacked: isStacked, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 11 },
                        callback: v => isCurrency ? fmtC(v) : isPercent ? v.toFixed(1) + '%' : fmtN(v) } }
                }
            }
        });
    },

    // Row 3 Right: Top 5 products
    _renderTopProducts() {
        const container = document.getElementById('dash-top-products');
        if (!container) return;

        const entries = this._getPeriodEntries();
        const byProduct = this._groupByProduct(entries);

        let ranked = Object.entries(byProduct).map(([pid, pEntries]) => {
            const agg = this._aggregate(pEntries);
            return { pid, name: getProductName(pid), ...agg };
        });

        // Sort by selected mode
        if (this._topMode === 'profit') ranked.sort((a, b) => b.profit - a.profit);
        else if (this._topMode === 'roas') ranked.sort((a, b) => b.roas - a.roas);
        else if (this._topMode === 'cpa') ranked = ranked.filter(p => p.cpa > 0).sort((a, b) => a.cpa - b.cpa); // lowest CPA first
        else ranked.sort((a, b) => b.revenue - a.revenue);

        ranked = ranked.slice(0, 5);

        if (ranked.length === 0) {
            container.innerHTML = '<div class="dash-empty">Sem dados</div>';
            return;
        }

        container.innerHTML = ranked.map((p, i) => {
            let mainVal;
            if (this._topMode === 'profit') mainVal = this._fmtCurrency(p.profit);
            else if (this._topMode === 'roas') mainVal = p.roas.toFixed(2) + 'x';
            else if (this._topMode === 'cpa') mainVal = this._fmtCurrency(p.cpa);
            else mainVal = this._fmtCurrency(p.revenue);
            const profitColor = p.profit >= 0 ? 'var(--green)' : 'var(--red)';
            return `<div class="dash-rank-item">
                <span class="dash-rank-pos">${i + 1}</span>
                <span class="dash-rank-name">${escapeHtml(p.name)}</span>
                <span class="dash-rank-value" style="color:${this._topMode === 'profit' ? profitColor : ''}">${mainVal}</span>
            </div>`;
        }).join('');
    },

    // Row 4 Left: Pipeline summary
    _renderPipeline() {
        const container = document.getElementById('dash-pipeline');
        if (!container) return;

        if (typeof PipelineModule === 'undefined' || !PipelineModule.cards) {
            container.innerHTML = '<div class="dash-empty">Pipeline não disponível</div>';
            return;
        }

        const stages = [
            { id: 'ideia', label: 'Ideia', icon: 'lightbulb' },
            { id: 'teste_ads', label: 'Teste', icon: 'megaphone' },
            { id: 'otimizacao', label: 'Otimização', icon: 'settings' },
            { id: 'escala', label: 'Escala', icon: 'trending-up' },
            { id: 'kill', label: 'Kill', icon: 'skull' },
        ];

        container.innerHTML = stages.map(s => {
            const count = PipelineModule.cards.filter(c => c.columnId === s.id).length;
            return `<div class="dash-pipe-item">
                <i data-lucide="${s.icon}" style="width:16px;height:16px"></i>
                <span class="dash-pipe-label">${s.label}</span>
                <span class="dash-pipe-count">${count}</span>
            </div>`;
        }).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // Row 4 Center: Product scores (0-100)
    _renderScores() {
        const container = document.getElementById('dash-scores');
        if (!container) return;

        const entries = this._getPeriodEntries();
        const byProduct = this._groupByProduct(entries);

        let products = Object.entries(byProduct).map(([pid, pEntries]) => {
            const agg = this._aggregate(pEntries);
            // Score: 40% profit margin + 30% ROAS + 20% conversion + 10% volume
            let profitScore = agg.revenue > 0 ? Math.min((agg.profit / agg.revenue) * 200, 40) : 0;
            let roasScore = Math.min(agg.roas * 10, 30);
            let convScore = Math.min(agg.convPage * 5, 20);
            let volScore = Math.min(agg.sales * 1, 10);
            let score = Math.max(0, Math.round(profitScore + roasScore + convScore + volScore));
            return { pid, name: getProductName(pid), score, ...agg };
        });

        products.sort((a, b) => b.score - a.score);
        products = products.slice(0, 5);

        if (products.length === 0) {
            container.innerHTML = '<div class="dash-empty">Sem dados</div>';
            return;
        }

        container.innerHTML = products.map(p => {
            const color = p.score >= 70 ? 'var(--green)' : p.score >= 40 ? 'var(--yellow)' : 'var(--red)';
            return `<div class="dash-score-item">
                <div class="dash-score-ring" style="--score-color:${color};--score-pct:${p.score}%">
                    <span>${p.score}</span>
                </div>
                <div class="dash-score-info">
                    <span class="dash-score-name">${escapeHtml(p.name)}</span>
                    <span class="dash-score-detail">ROAS ${p.roas.toFixed(1)}x · ${p.sales} vendas</span>
                </div>
            </div>`;
        }).join('');
    },

    // Row 4 Right: Store ranking
    _renderStoresRanking() {
        const container = document.getElementById('dash-stores-ranking');
        if (!container) return;

        if (typeof isAllStoresSelected === 'function' && isAllStoresSelected() && AppState.stores && AppState.stores.length > 1) {
            // Show all stores comparison
            const storeData = AppState.stores.filter(s => s.status === 'ativo').map(s => {
                const storeEntries = (AppState.allDiary || AppState.diary || []).filter(e => e.storeId === s.id);
                const d = new Date();
                d.setDate(d.getDate() - (this._period - 1));
                const startDate = d.toISOString().split('T')[0];
                const periodEntries = storeEntries.filter(e => e.date >= startDate);
                const agg = this._aggregate(periodEntries);
                const activeProducts = (AppState.allProducts || AppState.products || []).filter(p => p.storeId === s.id && p.status === 'ativo').length;
                return { name: s.name, ...agg, activeProducts };
            });

            storeData.sort((a, b) => b.revenue - a.revenue);

            container.innerHTML = storeData.map((s, i) =>
                `<div class="dash-rank-item">
                    <span class="dash-rank-pos">${i + 1}</span>
                    <span class="dash-rank-name">${escapeHtml(s.name)}</span>
                    <span class="dash-rank-detail">${s.activeProducts} prod · ${s.sales} vendas</span>
                    <span class="dash-rank-value">${this._fmtCurrency(s.revenue)}</span>
                </div>`
            ).join('') || '<div class="dash-empty">Sem dados</div>';
        } else {
            container.innerHTML = '<div class="dash-empty">Selecione TODAS para comparar lojas</div>';
        }
    },

    // Helper: number of days in current period
    _getDayCount() {
        const start = new Date(this._startDate + 'T00:00:00');
        const end = new Date(this._endDate + 'T00:00:00');
        return Math.round((end - start) / 86400000) + 1;
    },

    // Goals progress
    _renderGoals() {
        const container = document.getElementById('dash-goals');
        if (!container) return;
        const goals = (AppState.goals || []).filter(g => g.status === 'ativa');
        if (goals.length === 0) { container.innerHTML = '<div class="dash-empty">Nenhuma meta ativa</div>'; return; }

        container.innerHTML = goals.map(g => {
            const entries = this._getPeriodEntries().filter(e => g.productId === 'todos' || e.productId === g.productId);
            const agg = this._aggregate(entries);
            const target = convertToUSD(g.dailyTarget, g.currency) * this._getDayCount();
            const pct = target > 0 ? Math.round((agg.profit / target) * 100) : 0;
            const name = g.productId === 'todos' ? 'Geral' : getProductName(g.productId);
            const barColor = pct >= 100 ? 'var(--green)' : pct >= 70 ? 'var(--yellow)' : 'var(--red)';
            return `<div class="dash-goal-item">
                <div class="dash-goal-header">
                    <span class="dash-goal-name">${name}</span>
                    <span class="dash-goal-pct" style="color:${barColor}">${pct}%</span>
                </div>
                <div class="dash-progress-bar"><div class="dash-progress-fill" style="width:${Math.min(pct,100)}%;background:${barColor}"></div></div>
                <div class="dash-goal-detail">${this._fmtCurrency(agg.profit)} de ${this._fmtCurrency(target)}</div>
            </div>`;
        }).join('');
    },

    // Funnel diagnosis with bottleneck detection
    _renderFunnelDiagnosis() {
        const container = document.getElementById('dash-funnel-diagnosis');
        if (!container) return;
        const entries = this._getPeriodEntries();
        const agg = this._aggregate(entries);

        let totalClicks = 0, totalCpcBudget = 0;
        entries.forEach(e => {
            if ((e.cpc || 0) > 0 && e.budget > 0) {
                const clicks = e.budget / e.cpc;
                totalClicks += clicks;
                totalCpcBudget += (e.budgetCurrency === 'BRL') ? e.budget : convertToBRL(e.budget, e.budgetCurrency);
            }
        });

        const avgCpcBRL = totalClicks > 0 ? totalCpcBudget / totalClicks : 0;
        const cpaBRL    = agg.sales > 0 ? agg.budgetBRL / agg.sales : 0;
        const prefix    = this._currency === 'BRL' ? 'R$' : '$';
        const cpcDisp   = this._currency === 'BRL' ? avgCpcBRL : (avgCpcBRL > 0 ? convertToUSD(avgCpcBRL, 'BRL') : 0);
        const cpaDisp   = this._currency === 'BRL' ? cpaBRL    : agg.cpa;

        // Conversion steps (used for bottleneck detection)
        const steps = [
            { label: 'CTR',         value: agg.impressions > 0 ? (totalClicks / agg.impressions * 100) : 0, fmt: v => v.toFixed(2) + '%' },
            { label: 'View Page',   value: totalClicks > 0 ? (agg.pageViews / totalClicks * 100) : 0,       fmt: v => v.toFixed(1) + '%' },
            { label: 'Add to Cart', value: agg.pageViews > 0 ? (agg.addToCart / agg.pageViews * 100) : 0,  fmt: v => v.toFixed(1) + '%' },
            { label: 'Checkout',    value: agg.addToCart > 0 ? (agg.checkout / agg.addToCart * 100) : 0,   fmt: v => v.toFixed(1) + '%' },
            { label: 'Compra',      value: agg.checkout > 0 ? (agg.sales / agg.checkout * 100) : 0,        fmt: v => v.toFixed(1) + '%' },
        ];

        const validSteps = steps.filter(s => s.value > 0);
        const minStep = validSteps.length > 0 ? validSteps.reduce((a, b) => a.value < b.value ? a : b) : null;

        const convHtml = steps.map(s => {
            const isBottleneck = minStep && s.label === minStep.label;
            const cls = isBottleneck ? 'dash-funnel-step bottleneck' : 'dash-funnel-step';
            return `<div class="${cls}">
                <span class="dash-funnel-label">${s.label}</span>
                <span class="dash-funnel-value">${s.value > 0 ? s.fmt(s.value) : '--'}</span>
                ${isBottleneck ? '<span class="dash-funnel-badge">Gargalo</span>' : ''}
            </div>`;
        }).join('<div class="dash-funnel-arrow">→</div>');

        container.innerHTML = `<div class="dash-funnel-inner">${convHtml}</div>`;
    },

    // ── E-commerce Important Dates ────────────────────────────────
    _datesFilter: 'all',

    _getEcommerceDates(year) {
        const nth = (y, m, wd, n) => { // nth weekday (wd=0 Sun) of month m (1-based)
            let d = new Date(y, m - 1, 1), cnt = 0;
            while (d.getMonth() === m - 1) { if (d.getDay() === wd && ++cnt === n) return new Date(d); d.setDate(d.getDate() + 1); }
        };
        const last = (y, m, wd) => { // last weekday of month
            let d = new Date(y, m, 0);
            while (d.getDay() !== wd) d.setDate(d.getDate() - 1);
            return d;
        };
        const fixed = (m, day) => new Date(year, m - 1, day);
        const add = (d, n) => { let r = new Date(d); r.setDate(r.getDate() + n); return r; };

        const thanksgiving = nth(year, 11, 4, 4);
        const easterDate = (() => { // Meeus/Jones/Butcher algorithm
            const a=year%19, b=Math.floor(year/100), c=year%100;
            const d2=Math.floor(b/4), e=b%4, f=Math.floor((b+8)/25), g=Math.floor((b-f+1)/3);
            const h=(19*a+b-d2-g+15)%30, i=Math.floor(c/4), k=c%4;
            const l=(32+2*e+2*i-h-k)%7, m2=Math.floor((a+11*h+22*l)/451);
            const month=Math.floor((h+l-7*m2+114)/31), day=((h+l-7*m2+114)%31)+1;
            return new Date(year, month-1, day);
        })();

        return [
            // ── Global ─────────────────────────────────────────
            { cc:'global', flag:'🌍', name:"Ano Novo",           date: fixed(1,1) },
            { cc:'global', flag:'🌍', name:"Dia dos Namorados",  date: fixed(2,14) },
            { cc:'global', flag:'🌍', name:"Páscoa",             date: easterDate },
            { cc:'global', flag:'🌍', name:"Dia das Mães",       date: nth(year,5,0,2) },
            { cc:'global', flag:'🌍', name:"Singles' Day",       date: fixed(11,11) },
            { cc:'global', flag:'🌍', name:"Black Friday",       date: add(thanksgiving, 1) },
            { cc:'global', flag:'🌍', name:"Cyber Monday",       date: add(thanksgiving, 4) },
            { cc:'global', flag:'🌍', name:"Natal",              date: fixed(12,25) },
            // ── EUA ────────────────────────────────────────────
            { cc:'eua', flag:'🇺🇸', name:"Dia dos Pais (EUA)",   date: nth(year,6,0,3) },
            { cc:'eua', flag:'🇺🇸', name:"Independence Day",     date: fixed(7,4) },
            { cc:'eua', flag:'🇺🇸', name:"Labor Day",            date: nth(year,9,1,1) },
            { cc:'eua', flag:'🇺🇸', name:"Halloween",            date: fixed(10,31) },
            { cc:'eua', flag:'🇺🇸', name:"Thanksgiving (EUA)",   date: thanksgiving },
            { cc:'eua', flag:'🇺🇸', name:"Memorial Day",         date: last(year,5,1) },
            // ── Austrália ──────────────────────────────────────
            { cc:'aus', flag:'🇦🇺', name:"Australia Day",        date: fixed(1,26) },
            { cc:'aus', flag:'🇦🇺', name:"EOFY Sale",            date: fixed(6,30) },
            { cc:'aus', flag:'🇦🇺', name:"Dia dos Pais (AUS)",   date: nth(year,9,0,1) },
            { cc:'aus', flag:'🇦🇺', name:"Click Frenzy (AUS)",   date: nth(year,11,2,2) },
            { cc:'aus', flag:'🇦🇺', name:"Boxing Day (AUS)",     date: fixed(12,26) },
            // ── Europa ─────────────────────────────────────────
            { cc:'eur', flag:'🇪🇺', name:"Dia dos Pais (EUR)",   date: nth(year,6,0,3) },
            { cc:'eur', flag:'🇪🇺', name:"Summer Sale (EUR)",    date: fixed(7,1) },
            { cc:'eur', flag:'🇪🇺', name:"Boxing Day (UK)",      date: fixed(12,26) },
            // ── Canadá ─────────────────────────────────────────
            { cc:'can', flag:'🇨🇦', name:"Victoria Day",         date: add(last(year,5,1), -7) },
            { cc:'can', flag:'🇨🇦', name:"Canada Day",           date: fixed(7,1) },
            { cc:'can', flag:'🇨🇦', name:"Dia dos Pais (CAN)",   date: nth(year,6,0,3) },
            { cc:'can', flag:'🇨🇦', name:"Thanksgiving (CAN)",   date: nth(year,10,1,2) },
            { cc:'can', flag:'🇨🇦', name:"Boxing Day (CAN)",     date: fixed(12,26) },
        ].filter(d => d.date); // remove any nulls from failed nth computations
    },

    _renderEcommerceDates() {
        const container = document.getElementById('dash-ecommerce-dates');
        const filtersEl  = document.getElementById('dash-dates-filters');
        if (!container) return;

        const today = new Date(); today.setHours(0,0,0,0);
        const yearNow = today.getFullYear();

        // Collect dates from this year + next year, deduplicate, sort
        const all = [...this._getEcommerceDates(yearNow), ...this._getEcommerceDates(yearNow + 1)];
        const seen = new Set();
        const unique = all.filter(d => {
            const k = d.name + d.date.toISOString().slice(0,10);
            if (seen.has(k)) return false;
            seen.add(k); return true;
        });
        unique.sort((a, b) => a.date - b.date);

        // Build filter buttons
        const filters = [
            { key: 'all', label: 'Todas' },
            { key: 'global', label: '🌍 Global' },
            { key: 'eua',    label: '🇺🇸 EUA' },
            { key: 'aus',    label: '🇦🇺 AUS' },
            { key: 'eur',    label: '🇪🇺 EUR' },
            { key: 'can',    label: '🇨🇦 CAN' },
        ];
        if (filtersEl && !filtersEl._inited) {
            filtersEl._inited = true;
            filtersEl.innerHTML = filters.map(f =>
                `<button class="dash-date-filter${this._datesFilter === f.key ? ' active' : ''}" data-cc="${f.key}">${f.label}</button>`
            ).join('');
            filtersEl.addEventListener('click', e => {
                const btn = e.target.closest('.dash-date-filter');
                if (!btn) return;
                this._datesFilter = btn.dataset.cc;
                filtersEl.querySelectorAll('.dash-date-filter').forEach(b => b.classList.toggle('active', b.dataset.cc === this._datesFilter));
                this._renderEcommerceDates();
            });
        } else if (filtersEl) {
            filtersEl.querySelectorAll('.dash-date-filter').forEach(b => b.classList.toggle('active', b.dataset.cc === this._datesFilter));
        }

        const filtered = unique.filter(d => this._datesFilter === 'all' || d.cc === this._datesFilter);

        // Show next 30 upcoming + past 5
        const upcoming = filtered.filter(d => d.date >= today);
        const past     = filtered.filter(d => d.date < today).slice(-3);
        const display  = [...past, ...upcoming.slice(0, 20)];

        const months = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const fmt = d => `${String(d.getDate()).padStart(2,'0')} ${months[d.getMonth()]} ${d.getFullYear()}`;
        const diffDays = d => Math.round((d - today) / 86400000);

        container.innerHTML = display.map(d => {
            const diff = diffDays(d.date);
            const isPast = diff < 0;
            const isToday = diff === 0;
            const isSoon = diff > 0 && diff <= 14;
            let badge = '';
            if (isToday)       badge = `<span class="dash-date-badge today">Hoje</span>`;
            else if (isPast)   badge = `<span class="dash-date-badge past">${Math.abs(diff)}d atrás</span>`;
            else if (isSoon)   badge = `<span class="dash-date-badge soon">em ${diff}d</span>`;
            else               badge = `<span class="dash-date-badge future">em ${diff}d</span>`;
            return `<div class="dash-date-item${isPast ? ' past' : ''}${isToday ? ' today' : ''}${isSoon ? ' soon' : ''}">
                <span class="dash-date-flag">${d.flag}</span>
                <div class="dash-date-info">
                    <span class="dash-date-name">${d.name}</span>
                    <span class="dash-date-day">${fmt(d.date)}</span>
                </div>
                ${badge}
            </div>`;
        }).join('') || '<div class="dash-empty">Nenhuma data encontrada</div>';
    },

    // Opportunity map - products with untapped potential
    _renderOpportunities() {
        const container = document.getElementById('dash-opportunities');
        if (!container) return;
        const entries = this._getPeriodEntries();
        const byProduct = this._groupByProduct(entries);
        const opps = [];

        Object.entries(byProduct).forEach(([pid, pEntries]) => {
            const agg = this._aggregate(pEntries);
            const name = getProductName(pid);
            if (agg.impressions > 500 && agg.pageViews > 50 && agg.convPage < 2) {
                opps.push({ text: `${name}: ${agg.impressions.toLocaleString('pt-BR')} imp, conv ${agg.convPage.toFixed(1)}% \u2014 melhorar p\u00e1gina`, type: 'page' });
            }
            if (agg.addToCart > 10 && agg.checkout > 0 && (agg.checkout / agg.addToCart) < 0.3) {
                opps.push({ text: `${name}: ${agg.addToCart} ATC mas s\u00f3 ${((agg.checkout/agg.addToCart)*100).toFixed(0)}% chegam ao checkout`, type: 'checkout' });
            }
            if (agg.pageViews > 100 && agg.sales === 0) {
                opps.push({ text: `${name}: ${agg.pageViews} visitantes, 0 vendas \u2014 revisar oferta`, type: 'offer' });
            }
        });

        container.innerHTML = opps.length > 0
            ? opps.slice(0, 6).map(o => `<div class="dash-opp-item"><i data-lucide="lightbulb" style="width:13px;height:13px;color:var(--yellow)"></i> ${o.text}</div>`).join('')
            : '<div class="dash-empty">Nenhuma oportunidade identificada</div>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // Portfolio health by pipeline stage
    _renderPortfolio() {
        const container = document.getElementById('dash-portfolio');
        if (!container) return;

        const cards = typeof PipelineModule !== 'undefined' ? (PipelineModule.cards || []) : [];
        const total = cards.length || 1;

        const categories = [
            { label: 'Em Teste', stages: ['teste_ads'], color: 'var(--yellow)', icon: 'flask-conical' },
            { label: 'Otimizando', stages: ['otimizacao'], color: 'var(--blue)', icon: 'settings' },
            { label: 'Escalando', stages: ['escala'], color: 'var(--green)', icon: 'trending-up' },
            { label: 'Kill', stages: ['kill'], color: 'var(--red)', icon: 'skull' },
            { label: 'Prepara\u00e7\u00e3o', stages: ['ideia', 'validacao', 'pesquisa', 'angulos', 'criativos', 'pagina'], color: 'var(--text-muted)', icon: 'loader' },
        ];

        container.innerHTML = categories.map(c => {
            const count = cards.filter(card => c.stages.includes(card.columnId)).length;
            const pct = Math.round((count / total) * 100);
            return `<div class="dash-portfolio-item">
                <i data-lucide="${c.icon}" style="width:14px;height:14px;color:${c.color}"></i>
                <span class="dash-portfolio-label">${c.label}</span>
                <span class="dash-portfolio-count" style="color:${c.color}">${count}</span>
                <span class="dash-portfolio-pct">${pct}%</span>
            </div>`;
        }).join('');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // Mini stat widgets
    _renderWidgets() {
        const entries = this._getPeriodEntries();
        const byProduct = this._groupByProduct(entries);
        const cards = typeof PipelineModule !== 'undefined' ? (PipelineModule.cards || []) : [];

        // % validated tests
        const allTests = (AppState.diary || []).filter(e => e.isTest);
        const validated = allTests.filter(e => e.testValidation === 'validado').length;
        const validPct = allTests.length > 0 ? Math.round((validated / allTests.length) * 100) : 0;
        const el1 = document.getElementById('dw-validated-pct');
        if (el1) el1.textContent = validPct + '%';

        // % kill
        const killCount = cards.filter(c => c.columnId === 'kill').length;
        const killPct = cards.length > 0 ? Math.round((killCount / cards.length) * 100) : 0;
        const el2 = document.getElementById('dw-killed-pct');
        if (el2) el2.textContent = killPct + '%';

        // Open tests
        const openTests = (AppState.diary || []).filter(e => e.isTest && (!e.testValidation || e.testValidation === 'pendente')).length;
        const el3 = document.getElementById('dw-open-tests');
        if (el3) el3.textContent = openTests;

        // Products without diagnosis
        const productsWithData = new Set(entries.map(e => e.productId));
        const noDiag = (AppState.products || []).filter(p => !productsWithData.has(p.id)).length;
        const el4 = document.getElementById('dw-no-diag');
        if (el4) el4.textContent = noDiag;

        // Worst checkout rate
        let worstCheckout = '--';
        let worstCheckoutVal = Infinity;
        Object.entries(byProduct).forEach(([pid, pe]) => {
            const agg = this._aggregate(pe);
            if (agg.addToCart > 5 && agg.checkout > 0) {
                const rate = agg.checkout / agg.addToCart * 100;
                if (rate < worstCheckoutVal) { worstCheckoutVal = rate; worstCheckout = rate.toFixed(0) + '%'; }
            }
        });
        const el5 = document.getElementById('dw-worst-checkout');
        if (el5) el5.textContent = worstCheckout;

        // Best conversion
        let bestConv = '--';
        let bestConvVal = 0;
        Object.entries(byProduct).forEach(([pid, pe]) => {
            const agg = this._aggregate(pe);
            if (agg.pageViews > 10 && agg.convPage > bestConvVal) { bestConvVal = agg.convPage; bestConv = agg.convPage.toFixed(1) + '%'; }
        });
        const el6 = document.getElementById('dw-best-conv');
        if (el6) el6.textContent = bestConv;
    },

    // Weekly calendar with deadlines
    _renderCalendar() {
        const container = document.getElementById('dash-calendar');
        if (!container) return;
        const today = todayISO();
        const weekEnd = new Date();
        weekEnd.setDate(weekEnd.getDate() + 7);
        const weekEndStr = weekEnd.toISOString().split('T')[0];

        const events = [];

        // Test endings this week
        (AppState.diary || []).forEach(e => {
            if (e.isTest && e.testEndDate && e.testEndDate >= today && e.testEndDate <= weekEndStr) {
                events.push({ date: e.testEndDate, text: `Teste termina: ${getProductName(e.productId)}`, icon: 'flask-conical', color: 'var(--yellow)' });
            }
        });

        // Goal endings
        (AppState.goals || []).forEach(g => {
            if (g.status === 'ativa' && g.endDate && g.endDate >= today && g.endDate <= weekEndStr) {
                events.push({ date: g.endDate, text: `Meta vence: ${getProductName(g.productId)}`, icon: 'target', color: 'var(--red)' });
            }
        });

        // Pipeline deadlines
        const cards = typeof PipelineModule !== 'undefined' ? (PipelineModule.cards || []) : [];
        cards.forEach(c => {
            if (c.endDate && c.endDate >= today && c.endDate <= weekEndStr) {
                events.push({ date: c.endDate, text: `Prazo: ${c.title}`, icon: 'clock', color: 'var(--accent)' });
            }
        });

        events.sort((a, b) => a.date.localeCompare(b.date));

        container.innerHTML = events.length > 0
            ? events.map(e => `<div class="dash-cal-item"><span class="dash-cal-date">${formatDate(e.date)}</span><i data-lucide="${e.icon}" style="width:12px;height:12px;color:${e.color}"></i><span>${e.text}</span></div>`).join('')
            : '<div class="dash-empty">Nenhum prazo esta semana</div>';
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // Budget ranking by product
    _renderBudgetByProduct() {
        const container = document.getElementById('dash-budget-by-product');
        if (!container) return;
        const entries = this._getPeriodEntries();
        const byProduct = this._groupByProduct(entries);

        let ranked = Object.entries(byProduct).map(([pid, pe]) => {
            const agg = this._aggregate(pe);
            return { name: getProductName(pid), budget: agg.budget };
        }).sort((a, b) => b.budget - a.budget).slice(0, 5);

        container.innerHTML = ranked.length > 0
            ? ranked.map((p, i) => `<div class="dash-rank-item"><span class="dash-rank-pos">${i+1}</span><span class="dash-rank-name">${p.name}</span><span class="dash-rank-value">${this._fmtCurrency(p.budget)}</span></div>`).join('')
            : '<div class="dash-empty">Sem dados</div>';
    },

    // Helper: group entries by productId
    _groupByProduct(entries) {
        const map = {};
        entries.forEach(e => {
            const pid = e.productId || '__none__';
            if (!map[pid]) map[pid] = [];
            map[pid].push(e);
        });
        return map;
    },

    // ── Metrics Calendar ─────────────────────────────────────────
    _renderMetricsCalendar() {
        const container = document.getElementById('dash-metrics-calendar');
        if (!container) return;

        // Use calendar's own product filter
        const calFilter = this._calProduct;
        const allEntries = (AppState.diary || []).filter(e => {
            if (e.isCampaign) return false;
            if (calFilter !== 'todos' && e.productId !== calFilter) return false;
            return true;
        });
        const byDate = {};
        allEntries.forEach(e => {
            if (!byDate[e.date]) byDate[e.date] = [];
            const existing = byDate[e.date].findIndex(x => x.productId === e.productId);
            if (existing >= 0) byDate[e.date][existing] = e;
            else byDate[e.date].push(e);
        });

        const isSingleProduct = calFilter !== 'todos';
        let targetCpaUSD = 0;
        if (isSingleProduct) {
            const product = typeof getProductById === 'function' ? getProductById(calFilter) : null;
            if (product && product.cpa) {
                targetCpaUSD = convertToUSD(product.cpa, product.cpaCurrency || 'BRL');
            }
        }

        // Metric tabs + product selector on same row
        const tabs = [
            { key: 'cpa',     label: 'CPA'      },
            { key: 'profit',  label: 'Lucro'    },
            { key: 'revenue', label: 'Receita'  },
            { key: 'sales',   label: 'Vendas'   },
            { key: 'cpm',     label: 'CPM'      },
            { key: 'cpc',     label: 'CPC Médio'},
        ];

        // Build product options
        const products = (AppState.products || []);
        const prodOptions = products.map(p =>
            `<option value="${p.id}"${calFilter === p.id ? ' selected' : ''}>${p.name}</option>`
        ).join('');

        const headerHtml = `
        <div class="mcal-header-bar">
            <div class="mcal-tabs">${tabs.map(t =>
                `<button class="mcal-tab${this._calMetric === t.key ? ' active' : ''}" data-metric="${t.key}">${t.label}</button>`
            ).join('')}</div>
            <select class="mcal-product-select" id="mcal-product">
                <option value="todos"${calFilter === 'todos' ? ' selected' : ''}>Todos os Produtos</option>
                ${prodOptions}
            </select>
        </div>`;

        // Month navigation header
        const names = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        const navHtml = `
        <div class="mcal-nav">
            <button class="mcal-nav-btn" id="mcal-prev" title="Mês anterior">&#8249;</button>
            <span class="mcal-nav-title">${names[this._calMonth]} ${this._calYear}</span>
            <button class="mcal-nav-btn" id="mcal-next" title="Próximo mês">&#8250;</button>
        </div>`;

        // Single month grid
        const monthDate = new Date(this._calYear, this._calMonth, 1);
        const monthHtml = this._renderCalMonth(monthDate, byDate, isSingleProduct, targetCpaUSD);

        container.innerHTML = headerHtml + navHtml + '<div class="mcal-months-wrapper">' + monthHtml + '</div>';

        // Tab click handlers
        container.querySelectorAll('.mcal-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._calMetric = btn.dataset.metric;
                this._renderMetricsCalendar();
            });
        });

        // Product select handler
        container.querySelector('#mcal-product')?.addEventListener('change', (e) => {
            this._calProduct = e.target.value;
            this._renderMetricsCalendar();
        });

        // Prev/next month
        container.querySelector('#mcal-prev')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._calMonth--;
            if (this._calMonth < 0) { this._calMonth = 11; this._calYear--; }
            this._renderMetricsCalendar();
        });
        container.querySelector('#mcal-next')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this._calMonth++;
            if (this._calMonth > 11) { this._calMonth = 0; this._calYear++; }
            this._renderMetricsCalendar();
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _renderCalMonth(monthDate, byDate, isSingleProduct, targetCpaUSD) {
        const year  = monthDate.getFullYear();
        const month = monthDate.getMonth();
        const days  = ['D','S','T','Q','Q','S','S'];
        const firstDow  = new Date(year, month, 1).getDay();
        const totalDays = new Date(year, month + 1, 0).getDate();
        const todayStr  = new Date().toISOString().slice(0, 10);

        let html = `<div class="mcal-month"><div class="mcal-grid">`;
        days.forEach(d => { html += `<div class="mcal-header">${d}</div>`; });
        for (let i = 0; i < firstDow; i++) html += '<div class="mcal-day mcal-day-empty"></div>';

        for (let day = 1; day <= totalDays; day++) {
            const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday    = ds === todayStr;
            const isFuture   = ds > todayStr;
            const dayEntries = byDate[ds] || [];
            const hasData    = dayEntries.length > 0 && !isFuture;

            let numCls  = isFuture ? 'mcal-dim' : '';
            let todayCls = isToday ? ' mcal-today' : '';
            let valHtml = '';

            if (hasData) {
                const mv = this._getDayMetricValue(dayEntries, this._calMetric, isSingleProduct, targetCpaUSD);
                valHtml = `<span class="mcal-day-val ${mv.cls}">${mv.text}</span>`;
            }

            html += `<div class="mcal-day${todayCls}"><span class="mcal-day-num ${numCls}">${day}</span>${valHtml}</div>`;
        }

        html += '</div></div>';
        return html;
    },

    _getDayMetricValue(dayEntries, metric, isSingleProduct, targetCpaUSD) {
        const agg = this._aggregate(dayEntries);

        if (metric === 'cpa') {
            if (agg.sales === 0) return { text: '--', cls: 'mcal-val-muted' };
            const val    = this._currency === 'BRL' ? agg.cpaBRL : agg.cpa;
            const prefix = this._currency === 'BRL' ? 'R$' : '$';
            const text   = prefix + this._compactNum(val);
            if (isSingleProduct && targetCpaUSD > 0) {
                const ratio = agg.cpa / targetCpaUSD;
                if (ratio <= 1.0) return { text, cls: 'mcal-val-green' };
                if (ratio <= 1.5) return { text, cls: 'mcal-val-yellow' };
                return { text, cls: 'mcal-val-red' };
            }
            return { text, cls: 'mcal-val-neutral' };
        }

        if (metric === 'profit') {
            const val    = this._currency === 'BRL' ? (agg.revenueBRL - agg.budgetBRL) : agg.profit;
            const prefix = this._currency === 'BRL' ? 'R$' : '$';
            const isNeg  = val < 0;
            const text   = (isNeg ? '-' : '') + prefix + this._compactNum(Math.abs(val));
            return { text, cls: val >= 0 ? 'mcal-val-green' : 'mcal-val-red' };
        }

        if (metric === 'roas') {
            if (agg.roas <= 0) return { text: '--', cls: 'mcal-val-muted' };
            const text = agg.roas.toFixed(1) + 'x';
            if (agg.roas >= 2)  return { text, cls: 'mcal-val-green' };
            if (agg.roas >= 1)  return { text, cls: 'mcal-val-yellow' };
            return { text, cls: 'mcal-val-red' };
        }

        if (metric === 'revenue') {
            const val    = this._currency === 'BRL' ? agg.revenueBRL : agg.revenue;
            const prefix = this._currency === 'BRL' ? 'R$' : '$';
            return { text: prefix + this._compactNum(val), cls: 'mcal-val-accent' };
        }

        if (metric === 'sales') {
            if (agg.sales === 0) return { text: '--', cls: 'mcal-val-muted' };
            return { text: agg.sales + (agg.sales === 1 ? ' venda' : ' vendas'), cls: 'mcal-val-neutral' };
        }

        if (metric === 'cpm') {
            if (agg.impressions === 0) return { text: '--', cls: 'mcal-val-muted' };
            const budgetVal = this._currency === 'BRL' ? agg.budgetBRL : agg.budget;
            const cpm = (budgetVal / agg.impressions) * 1000;
            const prefix = this._currency === 'BRL' ? 'R$' : '$';
            return { text: prefix + this._compactNum(cpm), cls: 'mcal-val-neutral' };
        }

        if (metric === 'cpc') {
            let totalBudget = 0, totalClicks = 0;
            dayEntries.forEach(e => {
                if ((e.cpc || 0) > 0) {
                    const clicks = e.budget / e.cpc;
                    totalClicks += clicks;
                    const b = this._currency === 'BRL'
                        ? ((e.budgetCurrency === 'BRL') ? e.budget : convertToBRL(e.budget, e.budgetCurrency))
                        : convertToUSD(e.budget, e.budgetCurrency);
                    totalBudget += b;
                }
            });
            if (totalClicks === 0) return { text: '--', cls: 'mcal-val-muted' };
            const avgCpc = totalBudget / totalClicks;
            const prefix = this._currency === 'BRL' ? 'R$' : '$';
            return { text: prefix + this._compactNum(avgCpc), cls: 'mcal-val-neutral' };
        }

        return { text: '--', cls: 'mcal-val-muted' };
    },

    _compactNum(val) {
        if (val >= 1000000) return (val / 1000000).toFixed(1).replace('.', ',') + 'M';
        if (val >= 10000)   return (val / 1000).toFixed(1).replace('.', ',') + 'k';
        if (val >= 1000)    return (val / 1000).toFixed(2).replace('.', ',') + 'k';
        if (val >= 100)     return Math.round(val).toString();
        if (val >= 10)      return val.toFixed(1);
        return val.toFixed(2);
    },
};

document.addEventListener('DOMContentLoaded', () => DashboardModule.init());
