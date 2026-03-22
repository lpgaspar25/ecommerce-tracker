/* ===========================
   Diary.js — Daily metrics journal
   =========================== */

const DiaryModule = {
    _activeView: 'all', // 'all' or 'tests'
    _compareMode: false,
    _compareSlots: [],
    _compareColors: ['#3b82f6', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899'],
    _compareColorNames: ['Azul', 'Laranja', 'Verde', 'Roxo', 'Rosa'],
    _thresholdsKey: 'etracker_metric_thresholds',
    _columnsKey: 'etracker_diary_columns',

    _allColumns: [
        { id: 'date', label: 'Data', fixed: true },
        { id: 'product', label: 'Produto', fixed: true },
        { id: 'pageViews', label: 'Visitantes', default: true },
        { id: 'atcRate', label: 'Pag > Carrinho', default: true },
        { id: 'addToCart', label: 'Add to Cart', default: true },
        { id: 'icRate', label: 'Carrinho > IC', default: true },
        { id: 'sales', label: 'Vendas', default: true },
        { id: 'convPage', label: 'Conv. Pagina', default: true },
        { id: 'convCheckout', label: 'Conv. Checkout', default: true },
        { id: 'budget', label: 'Orcamento', default: false },
        { id: 'revenue', label: 'Receita', default: false },
        { id: 'cpa', label: 'CPA', default: false },
        { id: 'cpc', label: 'CPC', default: false },
        { id: 'roas', label: 'ROAS', default: false },
        { id: 'impressions', label: 'Impressoes', default: false },
        { id: 'profit', label: 'Lucro', default: false },
        { id: 'platform', label: 'Plataforma', default: false },
        { id: 'isTest', label: 'Teste', default: true },
        { id: 'testNotes', label: 'Desc. Teste', default: true },
        { id: 'testGoal', label: 'Meta Teste', default: true },
        { id: 'situation', label: 'Situacao', default: true },
    ],

    _loadColumnConfig() {
        try {
            const raw = localStorage.getItem(this._columnsKey);
            if (raw) {
                const saved = JSON.parse(raw);
                // Merge with _allColumns to pick up any new columns added later
                const savedMap = {};
                saved.forEach(s => { savedMap[s.id] = s; });
                const result = [];
                // Keep saved order for known columns
                saved.forEach(s => {
                    const def = this._allColumns.find(c => c.id === s.id);
                    if (def) result.push({ id: s.id, visible: def.fixed ? true : s.visible });
                });
                // Add any new columns not in saved config
                this._allColumns.forEach(c => {
                    if (!savedMap[c.id]) {
                        result.push({ id: c.id, visible: c.fixed || !!c.default });
                    }
                });
                return result;
            }
        } catch (e) { /* ignore */ }
        return this._allColumns.map(c => ({ id: c.id, visible: c.fixed || !!c.default }));
    },

    _saveColumnConfig(config) {
        localStorage.setItem(this._columnsKey, JSON.stringify(config));
    },

    _getVisibleColumns() {
        const config = this._loadColumnConfig();
        return config
            .filter(c => c.visible)
            .map(c => this._allColumns.find(col => col.id === c.id))
            .filter(Boolean);
    },

    _renderColumnConfig() {
        const dd = document.getElementById('diary-columns-dropdown');
        if (!dd) return;
        const config = this._loadColumnConfig();
        let html = '';
        config.forEach((item, idx) => {
            const def = this._allColumns.find(c => c.id === item.id);
            if (!def) return;
            const fixedCls = def.fixed ? ' diary-col-item-fixed' : '';
            const checked = item.visible ? 'checked' : '';
            html += `<div class="diary-col-item${fixedCls}" data-col-idx="${idx}">
                <input type="checkbox" ${checked} ${def.fixed ? 'disabled' : ''} data-col-id="${item.id}">
                <span>${this._escapeHtml(def.label)}</span>
                <div class="diary-col-arrows">
                    <button class="diary-col-arrow" data-dir="up" data-col-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>&#9650;</button>
                    <button class="diary-col-arrow" data-dir="down" data-col-idx="${idx}" ${idx === config.length - 1 ? 'disabled' : ''}>&#9660;</button>
                </div>
            </div>`;
        });
        dd.innerHTML = html;

        // Checkbox listeners
        dd.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', () => {
                const cfg = this._loadColumnConfig();
                const colId = cb.dataset.colId;
                const item = cfg.find(c => c.id === colId);
                if (item) item.visible = cb.checked;
                this._saveColumnConfig(cfg);
                this.render();
            });
        });

        // Arrow listeners
        dd.querySelectorAll('.diary-col-arrow').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.colIdx);
                const dir = btn.dataset.dir;
                const cfg = this._loadColumnConfig();
                const newIdx = dir === 'up' ? idx - 1 : idx + 1;
                if (newIdx < 0 || newIdx >= cfg.length) return;
                const tmp = cfg[idx];
                cfg[idx] = cfg[newIdx];
                cfg[newIdx] = tmp;
                this._saveColumnConfig(cfg);
                this._renderColumnConfig();
                this.render();
            });
        });
    },

    _getCellHtml(entry, colId) {
        const pageViews = entry.pageViews || 0;
        const addToCart = entry.addToCart || 0;
        const checkout = entry.checkout || 0;
        const sales = entry.sales || 0;

        switch (colId) {
            case 'date': {
                const hasCampaigns = (AppState.diary || []).some(d => d.parentId === entry.id);
                const toggleIcon = hasCampaigns
                    ? `<button class="diary-expand-btn" onclick="event.stopPropagation(); DiaryModule._toggleCampaigns('${entry.id}')" data-parent="${entry.id}"><i data-lucide="chevron-right" style="width:12px;height:12px" class="diary-expand-icon"></i></button>`
                    : '';
                return `<td class="diary-notion-date">${toggleIcon}${formatDate(entry.date)}</td>`;
            }
            case 'product': {
                const name = (!entry.productId || entry.testType === 'store')
                    ? '\u{1F3EA} Loja' : this._escapeHtml(getProductName(entry.productId));
                return `<td class="diary-notion-product">${name}</td>`;
            }
            case 'pageViews': return `<td class="num">${pageViews || '--'}</td>`;
            case 'atcRate': return this._fmtMetricCell(pageViews > 0 ? addToCart / pageViews * 100 : 0, 'atcRate');
            case 'addToCart': return `<td class="num">${addToCart || '--'}</td>`;
            case 'icRate': return this._fmtMetricCell(addToCart > 0 ? checkout / addToCart * 100 : 0, 'icRate');
            case 'sales': return `<td class="num">${sales || '--'}</td>`;
            case 'convPage': return this._fmtMetricCell(pageViews > 0 ? sales / pageViews * 100 : 0, 'convPage');
            case 'convCheckout': return this._fmtMetricCell(checkout > 0 ? sales / checkout * 100 : 0, 'convCheckout');
            case 'budget': return `<td class="num">${entry.budget ? entry.budget.toFixed(2) : '--'}</td>`;
            case 'revenue': return `<td class="num">${entry.revenue ? entry.revenue.toFixed(2) : '--'}</td>`;
            case 'cpa': return `<td class="num">${entry.cpa ? entry.cpa.toFixed(2) : '--'}</td>`;
            case 'cpc': return `<td class="num">${entry.cpc ? entry.cpc.toFixed(2) : '--'}</td>`;
            case 'roas': {
                const roas = entry.budget > 0 ? (entry.revenue / entry.budget) : 0;
                return `<td class="num">${roas > 0 ? roas.toFixed(2) + 'x' : '--'}</td>`;
            }
            case 'impressions': return `<td class="num">${entry.impressions ? entry.impressions.toLocaleString('pt-BR') : '--'}</td>`;
            case 'profit': {
                const profit = typeof this.getEntryProfit === 'function' ? this.getEntryProfit(entry) : 0;
                const cls = profit >= 0 ? 'metric-good' : 'metric-bad';
                return `<td class="num ${profit !== 0 ? cls : ''}">${profit !== 0 ? profit.toFixed(2) : '--'}</td>`;
            }
            case 'platform': return `<td>${entry.platform || '--'}</td>`;
            case 'isTest': {
                const isTest = entry.isTest;
                return `<td class="diary-notion-test">${isTest ? '<span class="diary-test-chip diary-test-chip-test"><i data-lucide="flask-conical" style="width:12px;height:12px"></i></span>' : ''}</td>`;
            }
            case 'testNotes': {
                if (!entry.isTest) return '<td></td>';
                const notes = (entry.notes || '').replace(/Via Facebook Ads \+ Diagnóstico\s*\|?\s*/i, '').replace(/Período do diagnóstico:.*$/i, '').trim();
                return `<td class="diary-test-notes diary-test-notes-cell" title="${this._escapeHtml(notes)}" onclick="DiaryModule._editTestNotes('${entry.id}')" data-entry-id="${entry.id}" data-field="testNotes">${this._escapeHtml(notes) || '--'}</td>`;
            }
            case 'testGoal': {
                if (!entry.isTest) return '<td></td>';
                const goal = entry.testGoal || '';
                const goalDisplay = goal
                    ? `<span class="test-goal-badge">${this._escapeHtml(goal)}</span>`
                    : '<span class="test-goal-empty">+ Meta</span>';
                return `<td class="diary-test-goal-cell" onclick="DiaryModule._openGoalPicker('${entry.id}', this)" data-entry-id="${entry.id}" data-field="testGoal">${goalDisplay}</td>`;
            }
            case 'situation': {
                let html = '';
                if (entry.isTest) {
                    const v = entry.testValidation || 'pendente';
                    const vKey = v === 'validado' ? 'validado' : v === 'nao_validado' ? 'nao-validado' : 'pendente';
                    const vLabel = vKey === 'validado' ? 'Validado' : vKey === 'nao-validado' ? 'Nao validado' : 'Pendente';
                    html = `<button class="diary-test-chip diary-test-chip-${vKey} diary-test-chip-clickable" onclick="event.stopPropagation(); DiaryModule._cycleTestValidation('${entry.id}')">${vLabel}</button>`;
                }
                return `<td>${html}</td>`;
            }
            default: return '<td>--</td>';
        }
    },

    _getHeaderHtml(col) {
        const numCols = ['pageViews','atcRate','addToCart','icRate','sales','convPage','convCheckout','budget','revenue','cpa','cpc','roas','impressions','profit'];
        const isNum = numCols.includes(col.id);
        return `<th${isNum ? ' class="num"' : ''}>${this._escapeHtml(col.label)}</th>`;
    },

    _getAvgCellHtml(colId, sortedEntries, totals) {
        const n = sortedEntries.length;
        if (n === 0) return '<td>--</td>';
        switch (colId) {
            case 'date': return '';
            case 'product': return '';
            case 'pageViews': return `<td class="num">${Math.round(totals.totalPageViews / n) || '--'}</td>`;
            case 'atcRate': return this._fmtMetricCell(totals.avgAtcRate, 'atcRate');
            case 'addToCart': return `<td class="num">${Math.round(totals.totalAddToCart / n) || '--'}</td>`;
            case 'icRate': return this._fmtMetricCell(totals.avgIcRate, 'icRate');
            case 'sales': return `<td class="num">${(totals.totalSales / n).toFixed(1).replace('.', ',')}</td>`;
            case 'convPage': return this._fmtMetricCell(totals.avgConvPage, 'convPage');
            case 'convCheckout': return this._fmtMetricCell(totals.avgConvCheckout, 'convCheckout');
            case 'budget': return `<td class="num">${totals.totalBudget > 0 ? (totals.totalBudget / n).toFixed(2) : '--'}</td>`;
            case 'revenue': return `<td class="num">${totals.totalRevenue > 0 ? (totals.totalRevenue / n).toFixed(2) : '--'}</td>`;
            case 'cpa': {
                const avgCpa = totals.totalSales > 0 ? totals.totalBudget / totals.totalSales : 0;
                return `<td class="num">${avgCpa > 0 ? avgCpa.toFixed(2) : '--'}</td>`;
            }
            case 'cpc': return `<td class="num">--</td>`;
            case 'roas': {
                const roas = totals.totalBudget > 0 ? totals.totalRevenue / totals.totalBudget : 0;
                return `<td class="num">${roas > 0 ? roas.toFixed(2) + 'x' : '--'}</td>`;
            }
            case 'impressions': {
                const avg = totals.totalImpressions > 0 ? Math.round(totals.totalImpressions / n) : 0;
                return `<td class="num">${avg > 0 ? avg.toLocaleString('pt-BR') : '--'}</td>`;
            }
            case 'profit': {
                let totalProfit = 0;
                sortedEntries.forEach(e => { totalProfit += (typeof this.getEntryProfit === 'function' ? this.getEntryProfit(e) : 0); });
                const avg = totalProfit / n;
                const cls = avg >= 0 ? 'metric-good' : 'metric-bad';
                return `<td class="num ${avg !== 0 ? cls : ''}">${avg !== 0 ? avg.toFixed(2) : '--'}</td>`;
            }
            case 'platform': return `<td>--</td>`;
            case 'isTest': return `<td></td>`;
            case 'testNotes': return `<td></td>`;
            case 'testGoal': return `<td></td>`;
            case 'situation': return `<td></td>`;
            default: return '<td>--</td>';
        }
    },

    _defaultThresholds: {
        atcRate:       { good: 8,  avg: 4  },
        icRate:        { good: 50, avg: 30 },
        convPage:      { good: 3,  avg: 1.5 },
        convCheckout:  { good: 50, avg: 30 }
    },

    _loadThresholds() {
        try {
            const raw = localStorage.getItem(this._thresholdsKey);
            if (raw) return { ...this._defaultThresholds, ...JSON.parse(raw) };
        } catch (e) { /* ignore */ }
        return { ...this._defaultThresholds };
    },

    _saveThresholds(t) {
        localStorage.setItem(this._thresholdsKey, JSON.stringify(t));
    },

    _metricClass(value, metricKey) {
        if (!value || value <= 0) return '';
        const t = this._loadThresholds()[metricKey];
        if (!t) return '';
        if (value >= t.good) return 'metric-good';
        if (value >= t.avg) return 'metric-avg';
        return 'metric-bad';
    },

    _fmtMetricCell(value, metricKey) {
        if (!value || value <= 0) return '<td class="num">--</td>';
        const cls = this._metricClass(value, metricKey);
        const txt = value.toFixed(1).replace('.', ',') + '%';
        return `<td class="num ${cls}">${txt}</td>`;
    },

    init() {
        document.getElementById('btn-add-entry').addEventListener('click', () => this.openForm());
        document.getElementById('diary-form').addEventListener('submit', (e) => this.handleSubmit(e));
        document.getElementById('diary-cancel').addEventListener('click', () => closeModal('diary-modal'));

        // Thresholds modal
        document.getElementById('btn-diary-thresholds')?.addEventListener('click', () => {
            const t = this._loadThresholds();
            ['atcRate', 'icRate', 'convPage', 'convCheckout'].forEach(key => {
                const goodEl = document.getElementById(`th-${key}-good`);
                const avgEl = document.getElementById(`th-${key}-avg`);
                const badEl = document.getElementById(`th-${key}-bad`);
                if (goodEl) goodEl.value = t[key]?.good ?? '';
                if (avgEl) avgEl.value = t[key]?.avg ?? '';
                if (badEl) badEl.value = `< ${t[key]?.avg ?? ''}`;
            });
            openModal('thresholds-modal');
        });

        document.getElementById('thresholds-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            const t = {};
            ['atcRate', 'icRate', 'convPage', 'convCheckout'].forEach(key => {
                const good = parseFloat(document.getElementById(`th-${key}-good`)?.value) || 0;
                const avg = parseFloat(document.getElementById(`th-${key}-avg`)?.value) || 0;
                t[key] = { good, avg };
            });
            this._saveThresholds(t);
            closeModal('thresholds-modal');
            this.render();
            showToast('Métricas alvo salvas!', 'success');
        });

        // Column config
        document.getElementById('btn-diary-columns')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const dd = document.getElementById('diary-columns-dropdown');
            if (dd.style.display === 'none' || !dd.style.display) {
                dd.style.display = 'block';
                this._renderColumnConfig();
            } else {
                dd.style.display = 'none';
            }
        });
        document.addEventListener('click', (e) => {
            const dd = document.getElementById('diary-columns-dropdown');
            const wrap = document.getElementById('btn-diary-columns')?.parentElement;
            if (dd && wrap && !wrap.contains(e.target)) dd.style.display = 'none';
        });

        // View tabs (Todos / Testes)
        document.querySelectorAll('.diary-view-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.diary-view-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this._activeView = tab.dataset.diaryView;
                this.render();
            });
        });

        // Period filter
        document.getElementById('diary-period').addEventListener('change', (e) => {
            const custom = document.getElementById('diary-custom-range');
            custom.style.display = e.target.value === 'custom' ? 'flex' : 'none';
            this.render();
        });

        document.getElementById('diary-filter-apply').addEventListener('click', () => this.render());
        document.getElementById('diary-product-filter').addEventListener('change', () => this.render());
        document.getElementById('diary-platform-filter').addEventListener('change', () => this.render());

        // Compare mode
        document.getElementById('btn-diary-compare')?.addEventListener('click', () => this._toggleCompareMode());
        document.getElementById('btn-diary-compare-close')?.addEventListener('click', () => this._toggleCompareMode());
        document.getElementById('btn-add-compare-slot')?.addEventListener('click', () => this._addCompareSlot());

        // Bulk delete
        document.getElementById('diary-select-all-cb')?.addEventListener('change', (e) => {
            document.querySelectorAll('.diary-row-cb').forEach(cb => { cb.checked = e.target.checked; });
            this._updateBulkBar();
        });
        document.getElementById('btn-diary-bulk-delete')?.addEventListener('click', () => this._bulkDelete());

        const entryProduct = document.getElementById('entry-product');
        if (entryProduct) {
            entryProduct.addEventListener('change', () => {
                this.prefillProductHistory();
                this.updateEntryPreview();
                this.populateCreativeDropdown();
            });
        }

        const entryIsTest = document.getElementById('entry-is-test');
        if (entryIsTest) {
            entryIsTest.addEventListener('change', () => this.toggleTestFields());
        }

        // Live preview on entry form
        ['entry-budget', 'entry-sales', 'entry-revenue', 'entry-product', 'entry-currency'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.updateEntryPreview());
        });

        EventBus.on('dataLoaded', () => this.render());
        EventBus.on('productsChanged', () => this.render());
        EventBus.on('rateUpdated', () => this.render());
        EventBus.on('diaryChanged', () => this.render());
        EventBus.on('tabChanged', (tab) => {
            if (tab === 'diary') {
                filterDataByStore();
                this.render();
            }
        });
    },

    openForm(entry = null) {
        const title = document.getElementById('diary-modal-title');
        const form = document.getElementById('diary-form');
        form.reset();

        document.getElementById('entry-date').value = todayISO();
        document.getElementById('entry-is-test').value = 'nao';
        document.getElementById('entry-test-end').value = '';
        document.getElementById('entry-test-validation').value = 'pendente';

        if (entry) {
            title.textContent = 'Editar Entrada';
            document.getElementById('entry-id').value = entry.id;
            document.getElementById('entry-date').value = entry.date;
            document.getElementById('entry-product').value = entry.productId || (entry.testType === 'store' ? '__STORE__' : '');
            document.getElementById('entry-platform').value = entry.platform;
            document.getElementById('entry-currency').value = entry.budgetCurrency;
            document.getElementById('entry-budget').value = entry.budget;
            document.getElementById('entry-sales').value = entry.sales;
            document.getElementById('entry-revenue').value = entry.revenue;
            document.getElementById('entry-cpc').value = entry.cpc;
            document.getElementById('entry-notes').value = entry.notes;
            document.getElementById('entry-impressions').value = entry.impressions || '';
            document.getElementById('entry-pageviews').value = entry.pageViews || '';
            document.getElementById('entry-addtocart').value = entry.addToCart || '';
            document.getElementById('entry-checkout').value = entry.checkout || '';
            document.getElementById('entry-product-history').value = entry.productHistory || '';
            this.populateCreativeDropdown();
            if (entry.creativeId) {
                const creativeSelect = document.getElementById('entry-creative');
                if (creativeSelect) creativeSelect.value = entry.creativeId;
            }
            document.getElementById('entry-is-test').value = entry.isTest ? 'sim' : 'nao';
            document.getElementById('entry-test-end').value = entry.testEndDate || '';
            document.getElementById('entry-test-validation').value = entry.testValidation || 'pendente';
            const testGoalInput = document.getElementById('entry-test-goal');
            if (testGoalInput) testGoalInput.value = entry.testGoal || '';
        } else {
            title.textContent = 'Nova Entrada';
            document.getElementById('entry-id').value = '';
            this.prefillProductHistory();
            this.populateCreativeDropdown();
        }

        this.toggleTestFields();
        this.updateEntryPreview();
        openModal('diary-modal');
    },

    toggleTestFields() {
        const isTest = document.getElementById('entry-is-test')?.value === 'sim';
        const endWrap = document.getElementById('entry-test-end-wrap');
        const validationWrap = document.getElementById('entry-test-validation-wrap');
        const goalWrap = document.getElementById('entry-test-goal-wrap');
        const endInput = document.getElementById('entry-test-end');
        const validationInput = document.getElementById('entry-test-validation');

        if (endWrap) endWrap.style.display = isTest ? 'flex' : 'none';
        if (validationWrap) validationWrap.style.display = isTest ? 'flex' : 'none';
        if (goalWrap) goalWrap.style.display = isTest ? 'flex' : 'none';
        if (endInput) endInput.required = isTest;
        if (validationInput) validationInput.required = isTest;

        if (!isTest) {
            if (endInput) endInput.value = '';
            if (validationInput) validationInput.value = 'pendente';
            const goalInput = document.getElementById('entry-test-goal');
            if (goalInput) goalInput.value = '';
        }
    },

    populateCreativeDropdown() {
        const select = document.getElementById('entry-creative');
        if (!select) return;

        const productId = document.getElementById('entry-product')?.value;
        const currentVal = select.value;

        while (select.options.length > 1) select.remove(1);

        if (productId && productId !== '__STORE__' && Array.isArray(AppState.allCreatives)) {
            AppState.allCreatives
                .filter(c => c.productId === productId && c.status !== 'killed')
                .forEach(c => {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name;
                    select.appendChild(opt);
                });
        }

        if (currentVal && [...select.options].some(o => o.value === currentVal)) {
            select.value = currentVal;
        }
    },

    prefillProductHistory() {
        const entryId = document.getElementById('entry-id').value;
        if (entryId) return; // Preserve existing value in edit mode.

        const historyEl = document.getElementById('entry-product-history');
        if (!historyEl) return;

        const productId = document.getElementById('entry-product').value;
        if (!productId) {
            historyEl.value = '';
            return;
        }

        const latestHistory = this.getLatestProductHistory(productId);
        historyEl.value = latestHistory;
    },

    getLatestProductHistory(productId) {
        if (!productId) return '';

        const latest = AppState.allDiary
            .filter(d => d.productId === productId && (d.productHistory || '').trim())
            .sort((a, b) => b.date.localeCompare(a.date))[0];

        return latest ? (latest.productHistory || '') : '';
    },

    updateEntryPreview() {
        const budget = parseFloat(document.getElementById('entry-budget').value) || 0;
        const sales = parseInt(document.getElementById('entry-sales').value) || 0;
        const revenue = parseFloat(document.getElementById('entry-revenue').value) || 0;
        const currency = document.getElementById('entry-currency').value;
        const productId = document.getElementById('entry-product').value;

        const cpaEl = document.getElementById('preview-entry-cpa');
        const profitEl = document.getElementById('preview-entry-profit');
        const roasEl = document.getElementById('preview-entry-roas');

        // CPA
        const cpa = sales > 0 ? budget / sales : 0;
        cpaEl.textContent = cpa > 0 ? formatCurrency(cpa, currency) : '--';

        // ROAS
        const roas = budget > 0 ? revenue / budget : 0;
        roasEl.textContent = roas > 0 ? roas.toFixed(2) + 'x' : '--';

        // Profit
        if (productId && sales > 0) {
            const product = getProductById(productId);
            if (product) {
                const revenueUSD = convertToUSD(revenue, currency);
                const budgetUSD = convertToUSD(budget, currency);
                const costUSD = convertToUSD(product.cost, product.costCurrency);

                const profit = revenueUSD
                    - (costUSD * sales)
                    - (revenueUSD * product.tax / 100)
                    - (revenueUSD * product.variableCosts / 100)
                    - budgetUSD;

                profitEl.textContent = formatDualCurrency(profit, 'USD');
                profitEl.style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
            } else {
                profitEl.textContent = '--';
            }
        } else {
            profitEl.textContent = '--';
        }
    },

    async handleSubmit(e) {
        e.preventDefault();

        const budget = parseFloat(document.getElementById('entry-budget').value) || 0;
        const sales = parseInt(document.getElementById('entry-sales').value) || 0;
        const revenue = parseFloat(document.getElementById('entry-revenue').value) || 0;
        const currency = document.getElementById('entry-currency').value;

        let entryId = document.getElementById('entry-id').value;
        const rawProductId = document.getElementById('entry-product').value;
        const entryDate = document.getElementById('entry-date').value;
        const entryPlatform = document.getElementById('entry-platform').value;

        // Auto-detect duplicate: same product + date + platform → update instead of insert
        if (!entryId) {
            const dupIdx = AppState.allDiary.findIndex(d =>
                d.date === entryDate &&
                d.productId === (rawProductId === '__STORE__' ? '' : rawProductId) &&
                d.platform === entryPlatform
            );
            if (dupIdx >= 0) {
                entryId = AppState.allDiary[dupIdx].id;
            }
        }

        if (!entryId) entryId = generateId('dia');
        const existingIdx = AppState.allDiary.findIndex(d => d.id === entryId);
        const existingEntry = existingIdx >= 0 ? AppState.allDiary[existingIdx] : null;
        const productId = rawProductId === '__STORE__' ? '' : rawProductId;
        const isStoreTest = rawProductId === '__STORE__';
        const storeId = existingEntry?.storeId || getWritableStoreId(productId);
        const isTest = document.getElementById('entry-is-test').value === 'sim';
        const testEndDate = isTest ? document.getElementById('entry-test-end').value : '';
        const testValidation = isTest ? (document.getElementById('entry-test-validation').value || 'pendente') : '';

        if (isTest && !testEndDate) {
            showToast('Informe a data de finalização do teste.', 'error');
            return;
        }

        if (!storeId) {
            showToast('Selecione uma loja específica para salvar no diário.', 'error');
            return;
        }

        const creativeId = document.getElementById('entry-creative')?.value || '';

        const data = {
            id: entryId,
            date: document.getElementById('entry-date').value,
            periodStart: existingEntry?.periodStart || document.getElementById('entry-date').value,
            periodEnd: existingEntry?.periodEnd || document.getElementById('entry-date').value,
            productId: productId,
            storeId: storeId,
            budget: budget,
            budgetCurrency: currency,
            sales: sales,
            revenue: revenue,
            revenueCurrency: currency,
            cpa: sales > 0 ? parseFloat((budget / sales).toFixed(2)) : 0,
            cpc: parseFloat(document.getElementById('entry-cpc').value) || 0,
            platform: document.getElementById('entry-platform').value,
            notes: document.getElementById('entry-notes').value.trim(),
            productHistory: document.getElementById('entry-product-history').value.trim(),
            impressions: parseInt(document.getElementById('entry-impressions').value) || 0,
            pageViews: parseInt(document.getElementById('entry-pageviews').value) || 0,
            addToCart: parseInt(document.getElementById('entry-addtocart').value) || 0,
            checkout: parseInt(document.getElementById('entry-checkout').value) || 0,
            isTest,
            testEndDate,
            testValidation,
            testType: isStoreTest ? 'store' : (isTest ? 'product' : ''),
            creativeId: creativeId,
            testGoal: document.getElementById('entry-test-goal')?.value || existingEntry?.testGoal || ''
        };

        if (existingIdx >= 0) {
            AppState.allDiary[existingIdx] = data;
            if (AppState.sheetsConnected) {
                await SheetsAPI.updateRowById(SheetsAPI.TABS.DIARY, data.id, SheetsAPI.diaryToRow(data));
            }
            showToast('Entrada atualizada!', 'success');
        } else {
            AppState.allDiary.push(data);
            if (AppState.sheetsConnected) {
                await SheetsAPI.appendRow(SheetsAPI.TABS.DIARY, SheetsAPI.diaryToRow(data));
            }
            showToast('Entrada registrada!', 'success');
        }

        // Persist immediately
        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        filterDataByStore();
        closeModal('diary-modal');
        this.render();
        EventBus.emit('diaryChanged');
    },

    async deleteEntry(id) {
        if (!confirm('Excluir esta entrada?')) return;

        const idx = AppState.allDiary.findIndex(d => d.id === id);
        if (idx >= 0) {
            AppState.allDiary.splice(idx, 1);
            if (AppState.sheetsConnected) {
                await SheetsAPI.deleteRowById(SheetsAPI.TABS.DIARY, id);
            }
            // Delete from Supabase
            if (typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn && SupabaseSync.client) {
                try {
                    await SupabaseSync.client.from('diary').delete().eq('id', id);
                } catch (e) { console.warn('[Delete] Supabase:', e); }
            }
            filterDataByStore();
            this.render();
            EventBus.emit('diaryChanged');
            showToast('Entrada excluída', 'info');
        }
    },

    _updateBulkBar() {
        const checked = document.querySelectorAll('.diary-row-cb:checked');
        const bar = document.getElementById('diary-bulk-bar');
        const countEl = document.getElementById('diary-selected-count');
        const selectAllCb = document.getElementById('diary-select-all-cb');
        const allCbs = document.querySelectorAll('.diary-row-cb');

        if (bar) bar.style.display = checked.length > 0 ? 'flex' : 'none';
        if (countEl) countEl.textContent = `${checked.length} selecionado${checked.length !== 1 ? 's' : ''}`;
        if (selectAllCb && allCbs.length > 0) {
            selectAllCb.checked = checked.length === allCbs.length;
            selectAllCb.indeterminate = checked.length > 0 && checked.length < allCbs.length;
        }
        // Toggle has-checked class on tables to show/hide all checkboxes
        document.querySelectorAll('.diary-notion-table').forEach(table => {
            const hasAny = table.querySelectorAll('.diary-row-cb:checked').length > 0;
            table.classList.toggle('has-checked', hasAny);
        });
    },

    async _bulkDelete() {
        const checked = document.querySelectorAll('.diary-row-cb:checked');
        const ids = Array.from(checked).map(cb => cb.dataset.entryId);
        if (ids.length === 0) return;

        if (!confirm(`Excluir ${ids.length} entrada${ids.length > 1 ? 's' : ''} do diário?`)) return;

        ids.forEach(id => {
            const idx = AppState.allDiary.findIndex(d => d.id === id);
            if (idx >= 0) AppState.allDiary.splice(idx, 1);
        });

        if (AppState.sheetsConnected) {
            for (const id of ids) {
                try { await SheetsAPI.deleteRowById(SheetsAPI.TABS.DIARY, id); } catch (e) { /* ignore */ }
            }
        }

        // Delete from Supabase
        if (typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn && SupabaseSync.client) {
            try {
                await SupabaseSync.client.from('diary').delete().in('id', ids);
            } catch (e) { console.warn('[BulkDelete] Supabase:', e); }
        }

        filterDataByStore();
        this.render();
        EventBus.emit('diaryChanged');

        const selectAllCb = document.getElementById('diary-select-all-cb');
        if (selectAllCb) selectAllCb.checked = false;
        document.getElementById('diary-bulk-bar').style.display = 'none';

        showToast(`${ids.length} entrada${ids.length > 1 ? 's' : ''} excluída${ids.length > 1 ? 's' : ''}`, 'info');
    },

    getFilteredEntries() {
        const period = document.getElementById('diary-period').value;
        const productFilter = document.getElementById('diary-product-filter').value;
        const platformFilter = document.getElementById('diary-platform-filter').value;

        const today = todayISO();
        let startDate, endDate;

        switch (period) {
            case 'today':
                startDate = endDate = today;
                break;
            case 'week': {
                const d = new Date();
                const day = d.getDay();
                const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday
                const monday = new Date(d.setDate(diff));
                startDate = monday.toISOString().split('T')[0];
                endDate = today;
                break;
            }
            case 'month': {
                const d = new Date();
                startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
                endDate = today;
                break;
            }
            case 'all':
                startDate = '';
                endDate = '';
                break;
            case 'custom':
                startDate = document.getElementById('diary-start').value;
                endDate = document.getElementById('diary-end').value;
                break;
        }

        return AppState.diary.filter(entry => {
            if (entry.isCampaign) return false;
            if (startDate && entry.date < startDate) return false;
            if (endDate && entry.date > endDate) return false;
            if (productFilter === '__STORE__' && entry.productId && entry.testType !== 'store') return false;
            if (productFilter !== 'todos' && productFilter !== '__STORE__' && entry.productId !== productFilter) return false;
            if (platformFilter !== 'todos' && entry.platform !== platformFilter) return false;
            return true;
        }).sort((a, b) => b.date.localeCompare(a.date));
    },

    getEntryProfit(entry) {
        if (!entry.productId || entry.productId === '__STORE__') return 0;
        const product = getProductById(entry.productId);
        if (!product) return 0;

        const revenueUSD = convertToUSD(entry.revenue, entry.revenueCurrency);
        const budgetUSD = convertToUSD(entry.budget, entry.budgetCurrency);
        const costUSD = convertToUSD(product.cost, product.costCurrency);

        return revenueUSD
            - (costUSD * entry.sales)
            - (revenueUSD * product.tax / 100)
            - (revenueUSD * product.variableCosts / 100)
            - budgetUSD;
    },

    _escapeHtml(raw) {
        return String(raw || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    // ── Test Management: cycle validation, inline edit notes & goal, auto-evaluate ──

    _cycleTestValidation(entryId) {
        const entry = AppState.allDiary.find(d => d.id === entryId);
        if (!entry) return;
        const current = (entry.testValidation || 'pendente').toLowerCase();
        const cycle = { 'pendente': 'validado', 'validado': 'nao_validado', 'nao_validado': 'pendente', '': 'validado' };
        entry.testValidation = cycle[current] || 'validado';
        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        filterDataByStore();
        this.render();
        EventBus.emit('diaryChanged');
    },

    _editTestNotes(entryId) {
        const entry = AppState.allDiary.find(d => d.id === entryId);
        if (!entry) return;
        const cell = document.querySelector(`td[data-entry-id="${entryId}"][data-field="testNotes"]`);
        if (!cell || cell.querySelector('.diary-inline-edit')) return;
        const current = (entry.notes || '').replace(/Via Facebook Ads \+ Diagnóstico\s*\|?\s*/i, '').replace(/Período do diagnóstico:.*$/i, '').trim();
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'diary-inline-edit';
        input.value = current;
        cell.textContent = '';
        cell.appendChild(input);
        input.focus();
        input.select();
        const save = () => { this._saveTestNotes(entryId, input.value); };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.removeEventListener('blur', save); save(); } if (e.key === 'Escape') { input.removeEventListener('blur', save); this.render(); } });
    },

    _saveTestNotes(entryId, value) {
        const entry = AppState.allDiary.find(d => d.id === entryId);
        if (!entry) return;
        entry.notes = value.trim();
        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        filterDataByStore();
        this.render();
        EventBus.emit('diaryChanged');
    },

    _defaultGoalPresets: [
        { group: 'Conversão', items: [
            'Conv > 3%', 'Conv > 5%', 'Checkout > 50%', 'Checkout > 70%',
            'Carrinho > 8%', 'Carrinho > 12%', 'IC > 40%', 'IC > 60%',
        ]},
        { group: 'Financeiro', items: [
            'ROAS > 1.5', 'ROAS > 2', 'ROAS > 3',
            'CPA < 30', 'CPA < 50', 'CPA < 80',
            'Vendas > 5', 'Vendas > 10',
        ]},
    ],

    _loadGoalPresets() {
        try {
            const raw = localStorage.getItem('etracker_goal_presets');
            if (raw) return JSON.parse(raw);
        } catch (e) { /* ignore */ }
        return JSON.parse(JSON.stringify(this._defaultGoalPresets));
    },

    _saveGoalPresets(presets) {
        localStorage.setItem('etracker_goal_presets', JSON.stringify(presets));
    },

    _openGoalPicker(entryId, cellEl) {
        document.querySelectorAll('.goal-picker-popup').forEach(p => p.remove());

        const entry = AppState.allDiary.find(d => d.id === entryId);
        if (!entry) return;

        const presets = this._loadGoalPresets();
        const popup = document.createElement('div');
        popup.className = 'goal-picker-popup';

        let html = '';
        presets.forEach(group => {
            html += `<div class="goal-picker-group">${this._escapeHtml(group.group)}</div>`;
            (group.items || []).forEach(item => {
                const isActive = entry.testGoal === item;
                html += `<button class="goal-picker-btn ${isActive ? 'active' : ''}" data-value="${this._escapeHtml(item)}">${this._escapeHtml(item)}</button>`;
            });
        });
        html += `<div class="goal-picker-group">Personalizado</div>`;
        html += `<div class="goal-picker-custom"><input type="text" class="diary-inline-edit" placeholder="Ex: Conv > 5%" value="${this._escapeHtml(entry.testGoal || '')}"><button class="btn btn-primary btn-sm goal-picker-save-custom">OK</button></div>`;
        if (entry.testGoal) {
            html += `<button class="goal-picker-btn goal-picker-clear" data-value=""><i data-lucide="x" style="width:11px;height:11px"></i> Remover</button>`;
        }
        html += `<div class="goal-picker-divider"></div>`;
        html += `<button class="goal-picker-btn goal-picker-edit-presets"><i data-lucide="settings" style="width:11px;height:11px"></i> Editar opções</button>`;

        popup.innerHTML = html;
        cellEl.style.position = 'relative';
        cellEl.appendChild(popup);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        requestAnimationFrame(() => {
            const rect = popup.getBoundingClientRect();
            if (rect.right > window.innerWidth) popup.style.right = '0';
            if (rect.bottom > window.innerHeight) { popup.style.bottom = '100%'; popup.style.top = 'auto'; }
        });

        popup.querySelectorAll('.goal-picker-btn:not(.goal-picker-edit-presets)').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._saveTestGoal(entryId, btn.dataset.value);
            });
        });

        popup.querySelector('.goal-picker-edit-presets')?.addEventListener('click', (e) => {
            e.stopPropagation();
            popup.remove();
            this._openGoalPresetsEditor();
        });

        const customInput = popup.querySelector('.goal-picker-custom input');
        const saveCustomBtn = popup.querySelector('.goal-picker-save-custom');
        if (saveCustomBtn && customInput) {
            saveCustomBtn.addEventListener('click', (e) => { e.stopPropagation(); this._saveTestGoal(entryId, customInput.value); });
            customInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.stopPropagation(); this._saveTestGoal(entryId, customInput.value); } });
            customInput.addEventListener('click', (e) => e.stopPropagation());
        }

        const close = (e) => { if (!popup.contains(e.target)) { popup.remove(); document.removeEventListener('click', close); } };
        setTimeout(() => document.addEventListener('click', close), 10);
    },

    _openGoalPresetsEditor() {
        const presets = this._loadGoalPresets();
        let html = `<div class="modal-header"><h3><i data-lucide="settings" style="width:16px;height:16px"></i> Editar Metas</h3><button class="modal-close" onclick="closeModal('goal-presets-modal')">&times;</button></div><div class="modal-body">`;

        presets.forEach((group, gi) => {
            html += `<div class="goal-editor-group"><label class="goal-editor-group-label">${this._escapeHtml(group.group)}</label>`;
            (group.items || []).forEach((item, ii) => {
                html += `<div class="goal-editor-item"><input type="text" class="input input-sm goal-editor-input" value="${this._escapeHtml(item)}" data-group="${gi}" data-idx="${ii}"><button class="btn-icon goal-editor-remove" data-group="${gi}" data-idx="${ii}"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button></div>`;
            });
            html += `<div class="goal-editor-add"><input type="text" class="input input-sm goal-editor-new-input" data-group="${gi}" placeholder="Nova meta..."><button class="btn btn-secondary btn-sm goal-editor-add-btn" data-group="${gi}">+</button></div>`;
            html += `</div>`;
        });

        html += `<div style="margin-top:0.75rem;display:flex;gap:0.5rem;justify-content:flex-end"><button class="btn btn-secondary btn-sm" id="goal-editor-reset">Restaurar padrão</button><button class="btn btn-primary btn-sm" id="goal-editor-save">Salvar</button></div></div>`;

        // Create modal dynamically
        let modal = document.getElementById('goal-presets-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'goal-presets-modal';
            modal.className = 'modal hidden';
            modal.innerHTML = '<div class="modal-overlay"></div><div class="modal-content modal-sm"></div>';
            document.body.appendChild(modal);
        }
        modal.querySelector('.modal-content').innerHTML = html;
        openModal('goal-presets-modal');
        if (typeof lucide !== 'undefined') lucide.createIcons();

        // Remove item
        modal.querySelectorAll('.goal-editor-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                const gi = parseInt(btn.dataset.group);
                const ii = parseInt(btn.dataset.idx);
                presets[gi].items.splice(ii, 1);
                this._saveGoalPresets(presets);
                this._openGoalPresetsEditor(); // re-render
            });
        });

        // Add item
        modal.querySelectorAll('.goal-editor-add-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const gi = parseInt(btn.dataset.group);
                const input = modal.querySelector(`.goal-editor-new-input[data-group="${gi}"]`);
                const val = input?.value?.trim();
                if (!val) return;
                presets[gi].items.push(val);
                this._saveGoalPresets(presets);
                this._openGoalPresetsEditor();
            });
        });

        // Save all edits
        document.getElementById('goal-editor-save')?.addEventListener('click', () => {
            modal.querySelectorAll('.goal-editor-input').forEach(input => {
                const gi = parseInt(input.dataset.group);
                const ii = parseInt(input.dataset.idx);
                presets[gi].items[ii] = input.value.trim();
            });
            // Remove empty
            presets.forEach(g => { g.items = g.items.filter(i => i); });
            this._saveGoalPresets(presets);
            closeModal('goal-presets-modal');
            showToast('Opções de meta salvas!', 'success');
        });

        // Reset
        document.getElementById('goal-editor-reset')?.addEventListener('click', () => {
            this._saveGoalPresets(JSON.parse(JSON.stringify(this._defaultGoalPresets)));
            this._openGoalPresetsEditor();
            showToast('Restaurado para padrão', 'info');
        });
    },

    _saveTestGoal(entryId, value) {
        document.querySelectorAll('.goal-picker-popup').forEach(p => p.remove());
        const entry = AppState.allDiary.find(d => d.id === entryId);
        if (!entry) return;
        entry.testGoal = (value || '').trim();
        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        filterDataByStore();
        this.render();
        EventBus.emit('diaryChanged');
    },

    _parseTestGoal(goalStr) {
        if (!goalStr) return null;
        const aliasMap = {
            'conv': 'convPage', 'conversao': 'convPage', 'roas': 'roas',
            'cpa': 'cpa', 'vendas': 'sales', 'sales': 'sales',
            'receita': 'revenue', 'revenue': 'revenue',
        };
        const m = goalStr.match(/^\s*(\w+)\s*([><]=?)\s*([\d.,]+)\s*%?\s*$/i);
        if (!m) return null;
        const rawMetric = m[1].toLowerCase();
        const op = m[2];
        const target = parseFloat(m[3].replace(',', '.'));
        const metric = aliasMap[rawMetric] || rawMetric;
        return { metric, op, target };
    },

    _evaluateTestResult(entry) {
        if (!entry.isTest || !entry.testEndDate) return;
        const today = todayISO();
        if (entry.testEndDate >= today) return; // test not ended yet
        const v = (entry.testValidation || 'pendente').toLowerCase();
        if (v !== 'pendente' && v !== '') return; // already evaluated

        const parsed = this._parseTestGoal(entry.testGoal);
        if (!parsed) return;

        // Gather diary entries during test period for same product
        const startDate = entry.date;
        const endDate = entry.testEndDate;
        const pid = entry.productId;
        const testEntries = AppState.allDiary.filter(d =>
            d.productId === pid && d.date >= startDate && d.date <= endDate
        );
        if (testEntries.length === 0) return;

        let actual = 0;
        const totalPV = testEntries.reduce((s, e) => s + (e.pageViews || 0), 0);
        const totalSales = testEntries.reduce((s, e) => s + (e.sales || 0), 0);
        const totalRevenue = testEntries.reduce((s, e) => s + Number(e.revenue || 0), 0);
        const totalBudget = testEntries.reduce((s, e) => s + Number(e.budget || 0), 0);

        switch (parsed.metric) {
            case 'convPage': actual = totalPV > 0 ? (totalSales / totalPV * 100) : 0; break;
            case 'roas': actual = totalBudget > 0 ? (totalRevenue / totalBudget) : 0; break;
            case 'cpa': actual = totalSales > 0 ? (totalBudget / totalSales) : 0; break;
            case 'sales': actual = totalSales; break;
            case 'revenue': actual = totalRevenue; break;
            default: return;
        }

        let passed = false;
        if (parsed.op === '>') passed = actual > parsed.target;
        else if (parsed.op === '>=') passed = actual >= parsed.target;
        else if (parsed.op === '<') passed = actual < parsed.target;
        else if (parsed.op === '<=') passed = actual <= parsed.target;

        entry.testValidation = passed ? 'validado' : 'nao_validado';
        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        EventBus.emit('diaryChanged');
    },

    _buildTestStatusHtml(entry) {
        if (!entry?.isTest) return '';

        const validationRaw = String(entry.testValidation || 'pendente').toLowerCase();
        const validationKey = validationRaw === 'validado'
            ? 'validado'
            : (validationRaw === 'nao_validado' ? 'nao-validado' : 'pendente');
        const validationLabel = validationKey === 'validado'
            ? 'Validado'
            : (validationKey === 'nao-validado' ? 'Não validado' : 'Pendente');
        const endDateText = entry.testEndDate ? formatDate(entry.testEndDate) : 'Sem data final';

        return `<div class="diary-entry-statuses">
            <span class="diary-test-chip diary-test-chip-test">🧪 Teste</span>
            <span class="diary-test-chip">Fim: ${this._escapeHtml(endDateText)}</span>
            <span class="diary-test-chip diary-test-chip-${validationKey}">${this._escapeHtml(validationLabel)}</span>
        </div>`;
    },

    render() {
        if (this._compareMode) {
            this._renderCompareView();
            return;
        }
        // Auto-evaluate test results for entries with ended test periods
        AppState.allDiary.forEach(e => { if (e.isTest && e.testEndDate) this._evaluateTestResult(e); });

        let entries = this.getFilteredEntries();
        if (this._activeView === 'tests') {
            entries = entries.filter(e => e.isTest);
        }
        this.renderNotionList(entries);
        this.renderSummary(entries);
        this._renderDiaryChart(entries);
    },

    _fmtPctCell(num) {
        if (!num || num <= 0) return '--';
        return num.toFixed(1).replace('.', ',') + '%';
    },

    _fmtPctCellPlain(num) {
        if (!num || num <= 0) return '<td class="num">--</td>';
        return `<td class="num">${num.toFixed(1).replace('.', ',')}%</td>`;
    },

    renderNotionList(entries) {
        const container = document.getElementById('diary-notion-list');
        if (!container) return;

        if (entries.length === 0) {
            const msg = this._activeView === 'tests'
                ? 'Nenhum teste encontrado para o periodo selecionado.'
                : 'Nenhuma entrada encontrada para o periodo selecionado.';
            container.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
            return;
        }

        const visibleCols = this._getVisibleColumns();

        // Group by product
        const byProduct = {};
        entries.forEach(entry => {
            const isStoreTest = !entry.productId || entry.testType === 'store';
            const key = isStoreTest ? '__STORE__' : entry.productId;
            if (!byProduct[key]) byProduct[key] = { entries: [], name: '' };
            byProduct[key].entries.push(entry);
            byProduct[key].name = isStoreTest ? '\u{1F3EA} Teste de Loja' : getProductName(entry.productId);
        });

        const groups = Object.keys(byProduct).sort((a, b) => {
            return byProduct[a].name.localeCompare(byProduct[b].name);
        });

        let html = '';
        groups.forEach(key => {
            const group = byProduct[key];
            const sortedEntries = group.entries.sort((a, b) => b.date.localeCompare(a.date));

            // Compute totals for average row
            let totalPageViews = 0, totalAddToCart = 0, totalCheckout = 0, totalSales = 0;
            let totalRevenue = 0, totalBudget = 0, totalImpressions = 0;
            sortedEntries.forEach(e => {
                totalPageViews += e.pageViews || 0;
                totalAddToCart += e.addToCart || 0;
                totalCheckout += e.checkout || 0;
                totalSales += e.sales || 0;
                totalRevenue += Number(e.revenue || 0);
                totalBudget += Number(e.budget || 0);
                totalImpressions += Number(e.impressions || 0);
            });
            const avgAtcRate = totalPageViews > 0 ? (totalAddToCart / totalPageViews * 100) : 0;
            const avgIcRate = totalAddToCart > 0 ? (totalCheckout / totalAddToCart * 100) : 0;
            const avgConvPage = totalPageViews > 0 ? (totalSales / totalPageViews * 100) : 0;
            const avgConvCheckout = totalCheckout > 0 ? (totalSales / totalCheckout * 100) : 0;
            const totals = { totalPageViews, totalAddToCart, totalCheckout, totalSales, totalRevenue, totalBudget, totalImpressions, avgAtcRate, avgIcRate, avgConvPage, avgConvCheckout };

            // Build header
            let headerHtml = '<th class="diary-check-col"><input type="checkbox" class="diary-group-select-all"></th>';
            visibleCols.forEach(col => { headerHtml += this._getHeaderHtml(col); });
            headerHtml += '<th></th>'; // actions column

            html += `<div class="diary-notion-group">
                <div class="diary-notion-group-header" onclick="this.parentElement.classList.toggle('collapsed')">
                    <span class="diary-notion-toggle">\u25BC</span>
                    <span class="diary-notion-group-name">${this._escapeHtml(group.name)}</span>
                    <span class="diary-notion-group-count">${sortedEntries.length}</span>
                </div>
                <div class="diary-notion-table-wrap">
                    <table class="diary-notion-table">
                        <thead><tr>${headerHtml}</tr></thead>
                        <tbody>`;

            sortedEntries.forEach(entry => {
                const isTest = entry.isTest;
                let rowHtml = `<td class="diary-check-col"><input type="checkbox" class="diary-row-cb" data-entry-id="${entry.id}"></td>`;
                visibleCols.forEach(col => { rowHtml += this._getCellHtml(entry, col.id); });
                rowHtml += `<td class="diary-notion-actions">
                    <button class="btn-icon" title="Editar" onclick="DiaryModule.openForm(AppState.diary.find(d=>d.id==='${entry.id}'))"><i data-lucide="pencil" style="width:14px;height:14px"></i></button>
                    <button class="btn-icon" title="Excluir" onclick="DiaryModule.deleteEntry('${entry.id}')"><i data-lucide="trash-2" style="width:14px;height:14px"></i></button>
                </td>`;

                html += `<tr class="diary-notion-row${isTest ? ' diary-notion-test-row' : ''}" data-entry-id="${entry.id}">${rowHtml}</tr>`;
                // Campaign sub-rows (hidden by default)
                if ((AppState.diary || []).some(d => d.parentId === entry.id)) {
                    html += `<tr class="diary-campaign-toggle-row" data-parent="${entry.id}" style="display:none"><td colspan="${visibleCols.length + 2}">${this._renderCampaignRows(entry.id, visibleCols)}</td></tr>`;
                }
            });

            // Average/footer row — count how many visible cols are fixed (date+product) to use as colspan for the MEDIA label
            const fixedCount = visibleCols.filter(c => this._allColumns.find(a => a.id === c.id)?.fixed).length;
            let avgHtml = `<td colspan="${fixedCount + 1}" style="text-align:right;font-weight:600;color:var(--text-secondary)">MEDIA</td>`;
            visibleCols.forEach(col => {
                const def = this._allColumns.find(a => a.id === col.id);
                if (def && def.fixed) return; // already in colspan
                avgHtml += this._getAvgCellHtml(col.id, sortedEntries, totals);
            });
            avgHtml += '<td></td>'; // actions column
            html += `<tr class="diary-notion-avg">${avgHtml}</tr>`;

            html += `</tbody></table></div></div>`;
        });

        container.innerHTML = html;

        // Initialize Lucide icons in rendered content
        if (typeof lucide !== 'undefined') lucide.createIcons();

        // Checkbox event listeners for bulk delete
        container.querySelectorAll('.diary-row-cb').forEach(cb => {
            cb.addEventListener('change', () => this._updateBulkBar());
        });
        container.querySelectorAll('.diary-group-select-all').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const table = e.target.closest('table');
                if (table) {
                    table.querySelectorAll('.diary-row-cb').forEach(rowCb => { rowCb.checked = e.target.checked; });
                    this._updateBulkBar();
                }
            });
        });
    },

    // ===========================
    //  DIARY FUNNEL CHART
    // ===========================
    _diaryChartInstance: null,
    _diaryChartType: 'bar',
    _diaryChartMode: 'funnel',
    _diaryChartVisible: new Set(),
    _diaryChartInited: false,

    _chartMetricDefs: {
        faturamento: [
            { key: 'revenue',  label: 'Total',              color: '#60a5fa', compute: (e) => Number(e.revenue || 0) },
            { key: 'profit',   label: 'Lucro',              color: '#34d399', compute: (e) => Number(e.revenue || 0) - Number(e.budget || 0) },
            { key: 'budget',   label: 'Custo de Marketing',  color: '#a78bfa', compute: (e) => Number(e.budget || 0) },
        ],
        funnel: [
            { key: 'impressions', label: 'Impressões', color: '#6366f1', compute: (e) => Number(e.impressions || 0) },
            { key: 'cliques',     label: 'Cliques',     color: '#8b5cf6', compute: (e) => { const cpc = Number(e.cpc || 0); return cpc > 0 ? Number(e.budget || 0) / cpc : 0; } },
            { key: 'pageViews',   label: 'View Page',   color: '#06b6d4', compute: (e) => Number(e.pageViews || 0) },
            { key: 'addToCart',   label: 'Add to Cart',  color: '#f59e0b', compute: (e) => Number(e.addToCart || 0) },
            { key: 'checkout',    label: 'Checkout',     color: '#f97316', compute: (e) => Number(e.checkout || 0) },
            { key: 'sales',       label: 'Vendas',       color: '#10b981', compute: (e) => Number(e.sales || 0) },
        ],
        rates: [
            { key: 'ctr',          label: 'CTR %',           color: '#8b5cf6', compute: (e) => { const imp = Number(e.impressions||0); const cpc = Number(e.cpc||0); const clicks = cpc > 0 ? Number(e.budget||0)/cpc : 0; return imp > 0 ? (clicks/imp)*100 : 0; } },
            { key: 'viewPageRate', label: 'Visualização %',   color: '#06b6d4', compute: (e) => { const cpc = Number(e.cpc||0); const clicks = cpc > 0 ? Number(e.budget||0)/cpc : 0; return clicks > 0 ? (Number(e.pageViews||0)/clicks)*100 : 0; } },
            { key: 'atcRate',      label: 'Carrinho %',       color: '#f59e0b', compute: (e) => { const pv = Number(e.pageViews||0); return pv > 0 ? (Number(e.addToCart||0)/pv)*100 : 0; } },
            { key: 'checkoutRate', label: 'Checkout %',       color: '#f97316', compute: (e) => { const atc = Number(e.addToCart||0); return atc > 0 ? (Number(e.checkout||0)/atc)*100 : 0; } },
            { key: 'saleRate',     label: 'Compra %',         color: '#10b981', compute: (e) => { const co = Number(e.checkout||0); return co > 0 ? (Number(e.sales||0)/co)*100 : 0; } },
            { key: 'convPage',     label: 'Conv. Página %',   color: '#ec4899', compute: (e) => { const pv = Number(e.pageViews||0); return pv > 0 ? (Number(e.sales||0)/pv)*100 : 0; } },
        ],
        budget: [
            { key: 'budgetVal', label: 'Budget',  color: '#a78bfa', compute: (e) => Number(e.budget || 0) },
            { key: 'cpa',      label: 'CPA',      color: '#ef4444', compute: (e) => { const s = Number(e.sales||0); return s > 0 ? Number(e.budget||0)/s : 0; } },
            { key: 'roas',     label: 'ROAS',     color: '#22c55e', compute: (e) => { const b = Number(e.budget||0); return b > 0 ? Number(e.revenue||0)/b : 0; } },
        ]
    },

    _initDiaryChart() {
        if (this._diaryChartInited) return;
        this._diaryChartInited = true;

        const toggles = document.getElementById('diary-chart-toggles');
        if (!toggles) return;

        toggles.addEventListener('click', (e) => {
            const btn = e.target.closest('.funnel-toggle-btn');
            if (!btn) return;
            const metric = btn.dataset.metric;
            if (this._diaryChartVisible.has(metric)) {
                this._diaryChartVisible.delete(metric);
                btn.classList.remove('active');
            } else {
                this._diaryChartVisible.add(metric);
                btn.classList.add('active');
            }
            this._renderDiaryChart();
        });

        document.getElementById('diary-chart-bar-btn')?.addEventListener('click', () => {
            this._diaryChartType = 'bar';
            document.getElementById('diary-chart-bar-btn').classList.add('active');
            document.getElementById('diary-chart-line-btn').classList.remove('active');
            this._renderDiaryChart();
        });
        document.getElementById('diary-chart-line-btn')?.addEventListener('click', () => {
            this._diaryChartType = 'line';
            document.getElementById('diary-chart-line-btn').classList.add('active');
            document.getElementById('diary-chart-bar-btn').classList.remove('active');
            this._renderDiaryChart();
        });

        document.getElementById('diary-chart-metric-select')?.addEventListener('change', (e) => {
            this._diaryChartMode = e.target.value;
            this._rebuildDiaryToggles();
            this._renderDiaryChart();
        });

        this._rebuildDiaryToggles();
    },

    _rebuildDiaryToggles() {
        const container = document.getElementById('diary-chart-toggles');
        if (!container) return;
        const defs = this._chartMetricDefs[this._diaryChartMode] || [];
        this._diaryChartVisible = new Set(defs.map(d => d.key));
        container.innerHTML = defs.map(d =>
            `<button type="button" class="funnel-toggle-btn active" data-metric="${d.key}" style="--toggle-color:${d.color}">${d.label}</button>`
        ).join('');
    },

    _renderDiaryChart(entries) {
        this._initDiaryChart();

        const canvas = document.getElementById('diary-chart-canvas');
        if (!canvas) return;

        if (this._diaryChartInstance) {
            this._diaryChartInstance.destroy();
            this._diaryChartInstance = null;
        }

        if (!entries) entries = this.getFilteredEntries();
        if (this._activeView === 'tests') entries = entries.filter(e => e.isTest);
        if (entries.length === 0) return;

        // Group by date
        const entriesByDate = {};
        entries.forEach(e => {
            const date = String(e.date || '').trim();
            if (!entriesByDate[date]) entriesByDate[date] = [];
            entriesByDate[date].push(e);
        });

        const dates = Object.keys(entriesByDate).sort();
        if (dates.length === 0) return;

        const defs = this._chartMetricDefs[this._diaryChartMode] || [];
        const visibleDefs = defs.filter(d => this._diaryChartVisible.has(d.key));
        if (visibleDefs.length === 0) return;

        const labels = dates.map(date => {
            const parts = date.split('-');
            return `${parts[2]}/${parts[1]}`;
        });

        const isBar = this._diaryChartType === 'bar';
        const isStacked = isBar && (this._diaryChartMode === 'faturamento' || this._diaryChartMode === 'funnel');

        const datasets = visibleDefs.map(def => {
            const data = dates.map(date => {
                const dayEntries = entriesByDate[date] || [];
                if (dayEntries.length === 0) return 0;
                return dayEntries.reduce((sum, e) => sum + def.compute(e), 0);
            });

            if (isBar) {
                return {
                    label: def.label,
                    data,
                    backgroundColor: def.color + 'CC',
                    borderColor: def.color,
                    borderWidth: 1,
                    borderRadius: 4,
                    stack: isStacked ? 'stack0' : def.key,
                };
            } else {
                return {
                    label: def.label,
                    data,
                    borderColor: def.color,
                    backgroundColor: def.color + '33',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    borderWidth: 2,
                };
            }
        });

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
                       (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
        const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';

        const isCurrency = this._diaryChartMode === 'faturamento' || this._diaryChartMode === 'budget';
        const isPercent = this._diaryChartMode === 'rates';

        const fmtC = (val) => {
            if (typeof FunnelModule !== 'undefined' && FunnelModule._fmtCurrency) return FunnelModule._fmtCurrency(val);
            return 'R$ ' + Number(val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };
        const fmtN = (val) => Math.round(val).toLocaleString('pt-BR');

        this._diaryChartInstance = new Chart(canvas, {
            type: isBar ? 'bar' : 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: textColor, usePointStyle: true, pointStyle: 'rect', padding: 12 }
                    },
                    tooltip: {
                        backgroundColor: isDark ? '#1e1e2e' : '#fff',
                        titleColor: textColor,
                        bodyColor: textColor,
                        borderColor: gridColor,
                        borderWidth: 1,
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.raw;
                                if (isCurrency) return `${ctx.dataset.label}: ${fmtC(val)}`;
                                if (isPercent) return `${ctx.dataset.label}: ${val.toFixed(2)}%`;
                                if (ctx.dataset.label === 'ROAS') return `ROAS: ${val.toFixed(2)}x`;
                                return `${ctx.dataset.label}: ${fmtN(val)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        stacked: isStacked,
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { size: 11 } }
                    },
                    y: {
                        stacked: isStacked,
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            font: { size: 11 },
                            callback: (val) => {
                                if (isCurrency) return fmtC(val);
                                if (isPercent) return val.toFixed(1) + '%';
                                return fmtN(val);
                            }
                        }
                    }
                }
            }
        });
    },

    renderSummary(entries) {
        let totalBudget = 0, totalSales = 0, totalRevenue = 0, totalProfit = 0;

        entries.forEach(entry => {
            const budgetUSD = convertToUSD(entry.budget, entry.budgetCurrency);
            const revenueUSD = convertToUSD(entry.revenue, entry.revenueCurrency);

            totalBudget += budgetUSD;
            totalSales += entry.sales;
            totalRevenue += revenueUSD;
            totalProfit += this.getEntryProfit(entry);
        });

        const avgCPA = totalSales > 0 ? totalBudget / totalSales : 0;
        const roas = totalBudget > 0 ? totalRevenue / totalBudget : 0;

        document.getElementById('summary-budget').textContent = formatDualCurrency(totalBudget, 'USD');
        document.getElementById('summary-sales').textContent = totalSales;
        document.getElementById('summary-revenue').textContent = formatDualCurrency(totalRevenue, 'USD');
        document.getElementById('summary-profit').textContent = formatDualCurrency(totalProfit, 'USD');
        document.getElementById('summary-profit').style.color = totalProfit >= 0 ? 'var(--green)' : 'var(--red)';
        document.getElementById('summary-cpa').textContent = avgCPA > 0 ? formatCurrency(avgCPA, 'USD') : '--';
        document.getElementById('summary-roas').textContent = roas > 0 ? roas.toFixed(2) + 'x' : '--';
    },

    // ===========================
    //  COMPARE MODE
    // ===========================

    _toggleCompareMode() {
        this._compareMode = !this._compareMode;
        const panel = document.getElementById('diary-compare-panel');
        const notionList = document.getElementById('diary-notion-list');
        const bulkBar = document.getElementById('diary-bulk-bar');
        const compareBtn = document.getElementById('btn-diary-compare');

        if (this._compareMode) {
            if (panel) panel.style.display = '';
            if (notionList) notionList.style.display = 'none';
            if (bulkBar) bulkBar.style.display = 'none';
            if (compareBtn) compareBtn.classList.add('active');
            this._compareSlots = [];
            this._addCompareSlot();
            this._addCompareSlot();
            this._renderCompareView();
        } else {
            if (panel) panel.style.display = 'none';
            if (notionList) notionList.style.display = '';
            if (compareBtn) compareBtn.classList.remove('active');
            this._compareSlots = [];
            this.render();
        }
    },

    _addCompareSlot() {
        if (this._compareSlots.length >= 5) {
            showToast('Máximo de 5 comparações simultâneas.', 'error');
            return;
        }
        const today = todayISO();
        const d = new Date();
        d.setDate(d.getDate() - 7);
        const startDate = d.toISOString().split('T')[0];
        this._compareSlots.push({ id: Date.now(), productId: 'todos', startDate, endDate: today });
        if (this._compareMode) this._renderCompareView();
    },

    _removeCompareSlot(index) {
        this._compareSlots.splice(index, 1);
        if (this._compareSlots.length === 0) {
            this._toggleCompareMode();
        } else {
            this._renderCompareView();
        }
    },

    _getSlotEntries(slot) {
        return AppState.diary.filter(entry => {
            if (slot.productId !== 'todos' && entry.productId !== slot.productId) return false;
            if (entry.date < slot.startDate || entry.date > slot.endDate) return false;
            return true;
        }).sort((a, b) => a.date.localeCompare(b.date));
    },

    _aggregateSlotMetrics(entries) {
        let budget = 0, revenue = 0, sales = 0, impressions = 0, pageViews = 0, addToCart = 0, checkout = 0;
        const uniqueDates = new Set();
        entries.forEach(e => {
            budget += Number(e.budget || 0);
            revenue += Number(e.revenue || 0);
            sales += Number(e.sales || 0);
            impressions += Number(e.impressions || 0);
            pageViews += Number(e.pageViews || 0);
            addToCart += Number(e.addToCart || 0);
            checkout += Number(e.checkout || 0);
            uniqueDates.add(e.date);
        });
        return {
            budget, revenue, sales, impressions, pageViews, addToCart, checkout,
            days: uniqueDates.size,
            atcRate: pageViews > 0 ? addToCart / pageViews * 100 : 0,
            icRate: addToCart > 0 ? checkout / addToCart * 100 : 0,
            convPage: pageViews > 0 ? sales / pageViews * 100 : 0,
            convCheckout: checkout > 0 ? sales / checkout * 100 : 0,
            cpa: sales > 0 ? budget / sales : 0,
            roas: budget > 0 ? revenue / budget : 0,
        };
    },

    _renderCompareView() {
        this._renderCompareSlots();
        this._renderCompareTable();
        this._renderCompareChart();
    },

    _renderCompareSlots() {
        const container = document.getElementById('diary-compare-slots');
        if (!container) return;

        const products = AppState.products || [];
        let html = '<div class="diary-compare-slots">';

        this._compareSlots.forEach((slot, i) => {
            let opts = '<option value="todos">Todos os Produtos</option>';
            products.forEach(p => {
                const sel = slot.productId === p.id ? ' selected' : '';
                opts += `<option value="${p.id}"${sel}>${this._escapeHtml(p.name)}</option>`;
            });

            html += `<div class="compare-slot">
                <span class="compare-slot-color" style="background:${this._compareColors[i]}"></span>
                <select class="input input-sm compare-slot-product" data-slot="${i}">${opts}</select>
                <input type="date" class="input input-sm compare-slot-start" data-slot="${i}" value="${slot.startDate}">
                <span style="color:var(--text-muted);font-size:0.75rem">até</span>
                <input type="date" class="input input-sm compare-slot-end" data-slot="${i}" value="${slot.endDate}">
                <div class="compare-slot-presets">
                    <button class="compare-slot-preset" data-slot="${i}" data-days="7">7d</button>
                    <button class="compare-slot-preset" data-slot="${i}" data-days="14">14d</button>
                    <button class="compare-slot-preset" data-slot="${i}" data-days="30">30d</button>
                </div>
                <button class="compare-slot-remove" data-slot="${i}" title="Remover">×</button>
            </div>`;
        });

        html += '</div>';
        container.innerHTML = html;

        // Bind events
        container.querySelectorAll('.compare-slot-product').forEach(el => {
            el.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.slot);
                this._compareSlots[idx].productId = e.target.value;
                this._renderCompareTable();
                this._renderCompareChart();
            });
        });
        container.querySelectorAll('.compare-slot-start').forEach(el => {
            el.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.slot);
                this._compareSlots[idx].startDate = e.target.value;
                this._renderCompareTable();
                this._renderCompareChart();
            });
        });
        container.querySelectorAll('.compare-slot-end').forEach(el => {
            el.addEventListener('change', (e) => {
                const idx = parseInt(e.target.dataset.slot);
                this._compareSlots[idx].endDate = e.target.value;
                this._renderCompareTable();
                this._renderCompareChart();
            });
        });
        container.querySelectorAll('.compare-slot-preset').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.slot);
                const days = parseInt(e.target.dataset.days);
                const end = new Date();
                const start = new Date();
                start.setDate(start.getDate() - days);
                this._compareSlots[idx].startDate = start.toISOString().split('T')[0];
                this._compareSlots[idx].endDate = end.toISOString().split('T')[0];
                this._renderCompareView();
            });
        });
        container.querySelectorAll('.compare-slot-remove').forEach(el => {
            el.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.slot);
                this._removeCompareSlot(idx);
            });
        });
    },

    _renderCompareTable() {
        const wrap = document.getElementById('diary-compare-table-wrap');
        if (!wrap) return;

        const slotData = this._compareSlots.map((slot, i) => {
            const entries = this._getSlotEntries(slot);
            const metrics = this._aggregateSlotMetrics(entries);
            const pName = slot.productId === 'todos' ? 'Todos' : (getProductName(slot.productId) || 'Produto');
            const label = `${pName} (${this._formatShortDate(slot.startDate)} - ${this._formatShortDate(slot.endDate)})`;
            return { slot, metrics, label, color: this._compareColors[i] };
        });

        if (slotData.length === 0) { wrap.innerHTML = ''; return; }

        const fmtCur = (v) => {
            if (typeof formatCurrency === 'function') return formatCurrency(v, 'USD');
            return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };
        const fmtDual = (v) => {
            if (typeof formatDualCurrency === 'function') return formatDualCurrency(v, 'USD');
            return fmtCur(v);
        };
        const fmtPct = (v) => v > 0 ? v.toFixed(1).replace('.', ',') + '%' : '--';
        const fmtNum = (v) => v > 0 ? Math.round(v).toLocaleString('pt-BR') : '--';
        const fmtRoas = (v) => v > 0 ? v.toFixed(2) + 'x' : '--';

        const rows = [
            { label: 'Dias', key: 'days', fmt: fmtNum },
            { label: 'Orçamento', key: 'budget', fmt: fmtDual },
            { label: 'Receita', key: 'revenue', fmt: fmtDual },
            { label: 'Vendas', key: 'sales', fmt: fmtNum },
            { label: 'Visitantes', key: 'pageViews', fmt: fmtNum },
            { label: 'Add to Cart', key: 'addToCart', fmt: fmtNum },
            { label: 'Checkout', key: 'checkout', fmt: fmtNum },
            { label: 'Pág>Carrinho', key: 'atcRate', fmt: fmtPct },
            { label: 'Carrinho>IC', key: 'icRate', fmt: fmtPct },
            { label: 'Conv. Página', key: 'convPage', fmt: fmtPct },
            { label: 'Conv. Checkout', key: 'convCheckout', fmt: fmtPct },
            { label: 'CPA', key: 'cpa', fmt: fmtCur },
            { label: 'ROAS', key: 'roas', fmt: fmtRoas },
        ];

        const showDelta = slotData.length >= 2;

        let html = '<div style="overflow-x:auto"><table class="compare-table"><thead><tr><th>Métrica</th>';
        slotData.forEach((sd) => {
            html += `<th style="border-bottom-color:${sd.color}; color:${sd.color}">${this._escapeHtml(sd.label)}</th>`;
        });
        if (showDelta) html += '<th>Δ 1↔2</th>';
        html += '</tr></thead><tbody>';

        rows.forEach(row => {
            html += `<tr><td>${row.label}</td>`;
            slotData.forEach(sd => {
                html += `<td>${row.fmt(sd.metrics[row.key])}</td>`;
            });
            if (showDelta) {
                const v1 = slotData[0].metrics[row.key];
                const v2 = slotData[1].metrics[row.key];
                if (v1 > 0 && v2 > 0) {
                    const delta = ((v2 - v1) / v1) * 100;
                    const cls = delta >= 0 ? 'delta-positive' : 'delta-negative';
                    const sign = delta >= 0 ? '+' : '';
                    html += `<td class="${cls}">${sign}${delta.toFixed(1).replace('.', ',')}%</td>`;
                } else {
                    html += '<td>--</td>';
                }
            }
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        wrap.innerHTML = html;
    },

    _formatShortDate(dateStr) {
        if (!dateStr) return '';
        const parts = dateStr.split('-');
        return `${parts[2]}/${parts[1]}`;
    },

    _renderCompareChart() {
        const canvas = document.getElementById('diary-chart-canvas');
        if (!canvas) return;

        if (this._diaryChartInstance) {
            this._diaryChartInstance.destroy();
            this._diaryChartInstance = null;
        }

        if (this._compareSlots.length === 0) return;

        // Get entries per slot grouped by date
        const slotDateData = this._compareSlots.map(slot => {
            const entries = this._getSlotEntries(slot);
            const byDate = {};
            entries.forEach(e => {
                if (!byDate[e.date]) byDate[e.date] = [];
                byDate[e.date].push(e);
            });
            return { slot, byDate, dates: Object.keys(byDate).sort() };
        });

        // Check if all slots have same period length
        const lengths = slotDateData.map(sd => sd.dates.length);
        const allSameLength = lengths.every(l => l === lengths[0]);

        // Use current chart mode defs
        const defs = this._chartMetricDefs[this._diaryChartMode] || [];
        const visibleDefs = defs.filter(d => this._diaryChartVisible.has(d.key));
        if (visibleDefs.length === 0) return;

        // Pick first visible metric for comparison chart
        const primaryDef = visibleDefs[0];

        // Determine max days
        const maxDays = Math.max(...lengths, 1);

        const datasets = [];
        const labelSet = new Set();

        slotDateData.forEach((sd, i) => {
            const pName = sd.slot.productId === 'todos' ? 'Todos' : (getProductName(sd.slot.productId) || 'Produto');
            const periodLabel = `${this._formatShortDate(sd.slot.startDate)}-${this._formatShortDate(sd.slot.endDate)}`;
            const dsLabel = `${pName} (${periodLabel})`;
            const color = this._compareColors[i];

            const data = [];
            sd.dates.forEach((date, di) => {
                const dayEntries = sd.byDate[date] || [];
                const val = dayEntries.reduce((sum, e) => sum + primaryDef.compute(e), 0);
                data.push(val);
                if (allSameLength) {
                    const parts = date.split('-');
                    labelSet.add(`${parts[2]}/${parts[1]}`);
                }
            });

            const isBar = this._diaryChartType === 'bar';
            if (isBar) {
                datasets.push({
                    label: dsLabel,
                    data,
                    backgroundColor: color + 'CC',
                    borderColor: color,
                    borderWidth: 1,
                    borderRadius: 4,
                });
            } else {
                datasets.push({
                    label: dsLabel,
                    data,
                    borderColor: color,
                    backgroundColor: color + '33',
                    fill: false,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 6,
                    borderWidth: 2,
                });
            }
        });

        let labels;
        if (allSameLength && lengths[0] > 0) {
            labels = [...labelSet];
        } else {
            labels = Array.from({ length: maxDays }, (_, i) => `Dia ${i + 1}`);
        }

        const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
                       (!document.documentElement.getAttribute('data-theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
        const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
        const textColor = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';

        const isCurrency = this._diaryChartMode === 'faturamento' || this._diaryChartMode === 'budget';
        const isPercent = this._diaryChartMode === 'rates';

        const fmtC = (val) => {
            if (typeof FunnelModule !== 'undefined' && FunnelModule._fmtCurrency) return FunnelModule._fmtCurrency(val);
            return 'R$ ' + Number(val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };
        const fmtN = (val) => Math.round(val).toLocaleString('pt-BR');

        this._diaryChartInstance = new Chart(canvas, {
            type: this._diaryChartType === 'bar' ? 'bar' : 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: textColor, usePointStyle: true, pointStyle: 'rect', padding: 12 }
                    },
                    tooltip: {
                        backgroundColor: isDark ? '#1e1e2e' : '#fff',
                        titleColor: textColor,
                        bodyColor: textColor,
                        borderColor: gridColor,
                        borderWidth: 1,
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.raw;
                                if (isCurrency) return `${ctx.dataset.label}: ${fmtC(val)}`;
                                if (isPercent) return `${ctx.dataset.label}: ${val.toFixed(2)}%`;
                                return `${ctx.dataset.label}: ${fmtN(val)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textColor, font: { size: 11 } }
                    },
                    y: {
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            font: { size: 11 },
                            callback: (val) => {
                                if (isCurrency) return fmtC(val);
                                if (isPercent) return val.toFixed(1) + '%';
                                return fmtN(val);
                            }
                        }
                    }
                }
            }
        });
    },

    // ── Campaign drill-down helpers ──────────────────────────────────
    _toggleCampaigns(parentId) {
        const rows = document.querySelectorAll(`.diary-campaign-toggle-row[data-parent="${parentId}"]`);
        const btn = document.querySelector(`.diary-expand-btn[data-parent="${parentId}"]`);
        rows.forEach(row => {
            const isHidden = row.style.display === 'none';
            row.style.display = isHidden ? '' : 'none';
        });
        if (btn) btn.classList.toggle('expanded');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _renderCampaignRows(parentId, visibleCols) {
        const subEntries = (AppState.diary || []).filter(d => d.parentId === parentId);
        if (subEntries.length === 0) return '';

        let html = '<table class="diary-campaign-sub-table"><tbody>';
        subEntries.forEach(sub => {
            html += '<tr class="diary-campaign-sub-row">';
            (visibleCols || []).forEach(col => {
                switch (col.id) {
                    case 'date':
                        html += `<td style="padding-left:1.5rem"><span class="diary-campaign-name"><i data-lucide="megaphone" style="width:10px;height:10px"></i> ${this._escapeHtml(sub.campaignName || '')}</span><span class="diary-ad-name">${this._escapeHtml(sub.adName || '')}</span></td>`;
                        break;
                    case 'product':
                        html += `<td class="diary-notion-product">${this._escapeHtml(sub.adName || '')}</td>`;
                        break;
                    case 'pageViews': html += `<td class="num">${sub.pageViews || '--'}</td>`; break;
                    case 'addToCart': html += `<td class="num">${sub.addToCart || '--'}</td>`; break;
                    case 'checkout': html += `<td class="num">${sub.checkout || '--'}</td>`; break;
                    case 'sales': html += `<td class="num">${sub.sales || '--'}</td>`; break;
                    case 'budget': html += `<td class="num">${sub.budget ? sub.budget.toFixed(2) : '--'}</td>`; break;
                    case 'revenue': html += `<td class="num">${sub.revenue ? sub.revenue.toFixed(2) : '--'}</td>`; break;
                    case 'cpa': html += `<td class="num">${sub.cpa ? sub.cpa.toFixed(2) : '--'}</td>`; break;
                    case 'cpc': html += `<td class="num">${sub.cpc ? sub.cpc.toFixed(2) : '--'}</td>`; break;
                    case 'roas': {
                        const roas = sub.budget > 0 ? (sub.revenue / sub.budget) : 0;
                        html += `<td class="num">${roas > 0 ? roas.toFixed(2) + 'x' : '--'}</td>`;
                        break;
                    }
                    case 'impressions': html += `<td class="num">${sub.impressions ? sub.impressions.toLocaleString('pt-BR') : '--'}</td>`; break;
                    case 'atcRate': {
                        const pv = sub.pageViews || 0;
                        const atc = sub.addToCart || 0;
                        const rate = pv > 0 ? (atc / pv * 100) : 0;
                        html += this._fmtMetricCell(rate, 'atcRate');
                        break;
                    }
                    case 'icRate': {
                        const atc = sub.addToCart || 0;
                        const ck = sub.checkout || 0;
                        const rate = atc > 0 ? (ck / atc * 100) : 0;
                        html += this._fmtMetricCell(rate, 'icRate');
                        break;
                    }
                    case 'convPage': {
                        const pv = sub.pageViews || 0;
                        const s = sub.sales || 0;
                        const rate = pv > 0 ? (s / pv * 100) : 0;
                        html += this._fmtMetricCell(rate, 'convPage');
                        break;
                    }
                    case 'convCheckout': {
                        const ck = sub.checkout || 0;
                        const s = sub.sales || 0;
                        const rate = ck > 0 ? (s / ck * 100) : 0;
                        html += this._fmtMetricCell(rate, 'convCheckout');
                        break;
                    }
                    case 'profit': {
                        const profit = Number(sub.revenue || 0) - Number(sub.budget || 0);
                        const cls = profit >= 0 ? 'metric-good' : 'metric-bad';
                        html += `<td class="num ${profit !== 0 ? cls : ''}">${profit !== 0 ? profit.toFixed(2) : '--'}</td>`;
                        break;
                    }
                    case 'platform': html += `<td>${sub.platform || '--'}</td>`; break;
                    default: html += '<td>--</td>'; break;
                }
            });
            html += '<td></td>'; // actions placeholder
            html += '</tr>';
        });
        html += '</tbody></table>';
        return html;
    }
};

document.addEventListener('DOMContentLoaded', () => DiaryModule.init());
