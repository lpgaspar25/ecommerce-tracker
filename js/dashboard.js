/* ===========================
   Dashboard.js — Comprehensive Analytics Dashboard
   =========================== */

const DashboardModule = {
    _chartInstance: null,
    _topMode: 'profit',

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

    refresh() {
        this._populateProductFilter();
        this._renderKPIs();
        this._renderActions();
        this._renderAlerts();
        this._renderGoals();
        this._renderFunnelDiagnosis();
        this._renderChart();
        this._renderTopProducts();
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
        if (this._currency === 'BRL') {
            const brl = typeof convertToBRL === 'function' ? convertToBRL(valUSD, 'USD') : valUSD * 5.25;
            return 'R$' + Number(brl || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return '$' + Number(valUSD || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    // Format currency using pre-computed BRL and USD values (avoids round-trip conversion)
    _fmtCurrencyDirect(valBRL, valUSD) {
        if (this._currency === 'BRL') {
            return 'R$' + Number(valBRL || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return '$' + Number(valUSD || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
        const entries = this._getPeriodEntries();
        const byProduct = this._groupByProduct(entries);

        Object.entries(byProduct).forEach(([pid, pEntries]) => {
            const agg = this._aggregate(pEntries);
            const name = getProductName(pid);

            // Calculate CPA in the product's currency for accurate comparison
            const product = typeof getProductById === 'function' ? getProductById(pid) : null;
            if (product && agg.sales > 0) {
                // Get total budget in original currency (not converted)
                let budgetOriginal = 0;
                pEntries.forEach(e => { budgetOriginal += e.budget || 0; });
                const cpaReal = budgetOriginal / agg.sales; // CPA in original currency
                const cpaCur = pEntries[0]?.budgetCurrency || 'BRL';
                const cpaTarget = product.cpa || 0;
                const targetCur = product.cpaCurrency || 'BRL';

                // Convert both to same currency for comparison
                const cpaRealUSD = convertToUSD(cpaReal, cpaCur);
                const cpaTargetUSD = convertToUSD(cpaTarget, targetCur);

                if (cpaTargetUSD > 0 && cpaRealUSD > cpaTargetUSD * 1.5) {
                    const fmtReal = cpaCur === 'BRL' ? `R$${cpaReal.toFixed(0)}` : `$${cpaReal.toFixed(0)}`;
                    const fmtTarget = targetCur === 'BRL' ? `R$${cpaTarget.toFixed(0)}` : `$${cpaTarget.toFixed(0)}`;
                    alerts.push({ text: `CPA ${fmtReal} (alvo ${fmtTarget}): ${name}`, type: 'danger' });
                }
            }
            if (agg.roas > 0 && agg.roas < 1) alerts.push({ text: `ROAS < 1 (${agg.roas.toFixed(1)}x): ${name}`, type: 'danger' });
            if (agg.sales === 0 && agg.budget > 50) alerts.push({ text: `Sem vendas ($${agg.budget.toFixed(0)} gasto): ${name}`, type: 'danger' });
            if (agg.convPage > 0 && agg.convPage < 1) alerts.push({ text: `Conv. ${agg.convPage.toFixed(1)}%: ${name}`, type: 'warning' });
        });

        if (alerts.length === 0) {
            container.innerHTML = '<div class="dash-empty">Nenhum produto em risco</div>';
            return;
        }
        container.innerHTML = alerts.slice(0, 8).map(a =>
            `<div class="dash-alert-item dash-alert-${a.type}">${a.text}</div>`
        ).join('');
    },

    // Row 3 Left: Performance chart (revenue + profit + budget over time)
    _renderChart() {
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

        const labels = dates.map(d => { const p = d.split('-'); return `${p[2]}/${p[1]}`; });
        const revenueData = dates.map(d => this._aggregate(byDate[d]).revenue);
        const profitData = dates.map(d => this._aggregate(byDate[d]).profit);
        const budgetData = dates.map(d => this._aggregate(byDate[d]).budget);

        const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
        const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
        const textColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.6)';

        this._chartInstance = new Chart(canvas, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    { label: 'Receita', data: revenueData, backgroundColor: '#3b82f6aa', borderRadius: 4 },
                    { label: 'Lucro', data: profitData, backgroundColor: '#10b981aa', borderRadius: 4 },
                    { label: 'Gasto', data: budgetData, backgroundColor: '#f59e0baa', borderRadius: 4 },
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { labels: { color: textColor, usePointStyle: true } } },
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
                    y: { grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 }, callback: v => '$' + (v >= 1000 ? (v/1000).toFixed(1) + 'k' : v.toFixed(0)) } }
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
            container.innerHTML = '<div class="dash-empty">Selecione [TODAS] para comparar lojas</div>';
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

        let totalClicks = 0;
        entries.forEach(e => { if (e.cpc > 0 && e.budget > 0) totalClicks += Math.round(e.budget / e.cpc); });

        const steps = [
            { label: 'CTR', value: agg.impressions > 0 ? (totalClicks / agg.impressions * 100) : 0, fmt: v => v.toFixed(2) + '%' },
            { label: 'View Page', value: totalClicks > 0 ? (agg.pageViews / totalClicks * 100) : 0, fmt: v => v.toFixed(1) + '%' },
            { label: 'Add to Cart', value: agg.pageViews > 0 ? (agg.addToCart / agg.pageViews * 100) : 0, fmt: v => v.toFixed(1) + '%' },
            { label: 'Checkout', value: agg.addToCart > 0 ? (agg.checkout / agg.addToCart * 100) : 0, fmt: v => v.toFixed(1) + '%' },
            { label: 'Compra', value: agg.checkout > 0 ? (agg.sales / agg.checkout * 100) : 0, fmt: v => v.toFixed(1) + '%' },
        ];

        const validSteps = steps.filter(s => s.value > 0);
        const minStep = validSteps.length > 0 ? validSteps.reduce((a, b) => a.value < b.value ? a : b) : null;

        container.innerHTML = steps.map(s => {
            const isBottleneck = minStep && s.label === minStep.label;
            const cls = isBottleneck ? 'dash-funnel-step bottleneck' : 'dash-funnel-step';
            return `<div class="${cls}">
                <span class="dash-funnel-label">${s.label}</span>
                <span class="dash-funnel-value">${s.value > 0 ? s.fmt(s.value) : '--'}</span>
                ${isBottleneck ? '<span class="dash-funnel-badge">Gargalo</span>' : ''}
            </div>`;
        }).join('<div class="dash-funnel-arrow">\u2192</div>');
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
};

document.addEventListener('DOMContentLoaded', () => DashboardModule.init());
