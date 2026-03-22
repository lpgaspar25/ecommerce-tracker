/* ===========================
   Funnel.js — Diagnóstico de Conversão
   Spreadsheet-like funnel analysis with simulation
   Mobile: card-based layout
   =========================== */

const FunnelModule = {
    MOBILE_BP: 768,

    _rateFields: ['ctr', 'viewPageRate', 'atcRate', 'checkoutRate', 'saleRate'],
    _rateLabels: [
        'CTR (Taxa de Cliques)',
        'Taxa de Visualização',
        'Taxa de Carrinho',
        'Taxa de Checkout',
        'Taxa de Compra'
    ],
    _rateLabelsShort: [
        'CTR',
        'Visualização',
        'Carrinho',
        'Checkout',
        'Compra'
    ],
    _simLabels: [
        'Sim: CTR',
        'Sim: Visualização',
        'Sim: Carrinho',
        'Sim: Checkout',
        'Sim: Compra'
    ],
    _metricTooltips: {
        cpc: {
            desc: 'Quanto custa cada clique no link do anúncio',
            fb: 'Valor Usado ÷ Cliques no Link'
        },
        ctr: {
            desc: 'De quem viu o anúncio, quantos clicaram',
            fb: 'CTR (taxa de cliques no link)'
        },
        viewPageRate: {
            desc: 'De quem clicou, quantos chegaram na página',
            fb: 'Visualizações da página de destino ÷ Cliques no link'
        },
        atcRate: {
            desc: 'De quem viu a página, quantos adicionaram ao carrinho',
            fb: 'Visu. Página > Add To Cart'
        },
        checkoutRate: {
            desc: 'De quem adicionou ao carrinho, quantos iniciaram checkout',
            fb: 'Carrinho > Checkout'
        },
        saleRate: {
            desc: 'De quem iniciou checkout, quantos compraram',
            fb: 'IC > Compras'
        }
    },

    _tooltipHtml(field) {
        const t = this._metricTooltips[field];
        if (!t) return '';
        return `<span class="metric-info-btn" data-tooltip-field="${field}" tabindex="0">ⓘ<span class="metric-info-popup"><strong>${t.desc}</strong><br><span class="metric-info-fb">Facebook: <code>${t.fb}</code></span></span></span>`;
    },

    state: {
        productId: '',
        actual: {
            ctr: 0, viewPageRate: 0, atcRate: 0, checkoutRate: 0, saleRate: 0,
            impressions: 0, cpc: 0, cpcCurrency: 'BRL', ticket: 0, ticketCurrency: 'BRL'
        },
        benchmark: {
            cpc: 0, ctr: 0, viewPageRate: 0, atcRate: 0, checkoutRate: 0, saleRate: 0
        },
        simulations: [
            { field: 'ctr', value: 0 },
            { field: 'viewPageRate', value: 0 },
            { field: 'atcRate', value: 0 },
            { field: 'checkoutRate', value: 0 },
            { field: 'saleRate', value: 0 }
        ]
    },

    _resizeTimer: null,
    _lastFBData: null,
    _snapshotStorageKey: 'etracker_funnel_snapshots',
    _compareMode: false,
    _compareState: null,

    init() {
        document.getElementById('funnel-product').addEventListener('change', () => this.onProductChange());
        document.getElementById('funnel-date-start').addEventListener('change', () => { this._clearActivePreset(); this.onPeriodChange(); });
        document.getElementById('funnel-date-end').addEventListener('change', () => { this._clearActivePreset(); this.onPeriodChange(); });

        // Arrow navigation
        document.getElementById('funnel-date-prev')?.addEventListener('click', () => this._shiftPeriod(-1));
        document.getElementById('funnel-date-next')?.addEventListener('click', () => this._shiftPeriod(1));

        // Preset buttons
        document.querySelectorAll('.date-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => this._applyPreset(btn.dataset.preset));
        });
        // Compare mode
        document.getElementById('btn-compare-toggle')?.addEventListener('click', () => this._toggleCompareMode());
        document.getElementById('compare-date-start')?.addEventListener('change', () => this._onComparePeriodChange());
        document.getElementById('compare-date-end')?.addEventListener('change', () => this._onComparePeriodChange());
        document.getElementById('compare-date-prev')?.addEventListener('click', () => this._shiftComparePeriod(-1));
        document.getElementById('compare-date-next')?.addEventListener('click', () => this._shiftComparePeriod(1));
        document.querySelectorAll('.date-preset-btn-b').forEach(btn => {
            btn.addEventListener('click', () => this._applyComparePreset(btn.dataset.presetB));
        });

        document.getElementById('btn-funnel-save-state').addEventListener('click', () => this.saveDiagnosisSnapshot());
        document.getElementById('btn-funnel-save-diary').addEventListener('click', () => this.saveToDiary());
        document.getElementById('funnel-date-start').value = todayISO();
        document.getElementById('funnel-date-end').value = todayISO();

        const csvBtn = document.getElementById('btn-fb-upload-csv');
        const csvInput = document.getElementById('fb-csv-input');
        if (csvBtn && csvInput) {
            csvBtn.addEventListener('click', () => csvInput.click());
            csvInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) {
                    await this.loadFromFacebookReportFile(file);
                }
                e.target.value = '';
            });
        }

        // Currency selector — full re-render to update labels
        document.getElementById('funnel-currency').addEventListener('change', (e) => {
            const prevCurrency = this.state.actual.ticketCurrency || e.target.value;
            const nextCurrency = e.target.value;
            if (prevCurrency !== nextCurrency) {
                this.state.actual.cpc = convertCurrency(
                    this.state.actual.cpc || 0,
                    this.state.actual.cpcCurrency || prevCurrency,
                    nextCurrency
                );
                this.state.benchmark.cpc = convertCurrency(
                    this.state.benchmark.cpc || 0,
                    prevCurrency,
                    nextCurrency
                );
            }
            this.state.actual.ticketCurrency = nextCurrency;
            this.state.actual.cpcCurrency = nextCurrency;
            // Convert compare state (Period B) currency too
            if (this._compareState && prevCurrency !== nextCurrency) {
                if (this._compareState.cpc) {
                    this._compareState.cpc = convertCurrency(this._compareState.cpc, this._compareState.cpcCurrency || prevCurrency, nextCurrency);
                }
                if (this._compareState.ticket) {
                    this._compareState.ticket = convertCurrency(this._compareState.ticket, this._compareState.ticketCurrency || prevCurrency, nextCurrency);
                }
                this._compareState.cpcCurrency = nextCurrency;
                this._compareState.ticketCurrency = nextCurrency;
            }
            this.saveDiagnosisSnapshot(false);
            this.render();
        });

        this._initFunnelChart();

        EventBus.on('dataLoaded', () => this.onProductChange());
        EventBus.on('productsChanged', () => this.onProductChange());
        EventBus.on('storeChanged', () => this.onProductChange());
        EventBus.on('tabChanged', (tab) => {
            if (tab === 'diagnostico') this.render();
        });

        // Re-render on resize (debounced) for mobile/desktop switch
        window.addEventListener('resize', () => {
            clearTimeout(this._resizeTimer);
            this._resizeTimer = setTimeout(() => this.render(), 200);
        });
    },

    onProductChange() {
        const productId = document.getElementById('funnel-product').value;
        this.state.productId = productId;
        const product = getProductById(productId);
        this._resetStateForProduct(product);

        if (productId && this.tryAutofillByProductAndPeriod()) {
            this.render();
            if (this._compareMode) this._loadCompareData();
            return;
        }

        this.render();
        if (this._compareMode) this._loadCompareData();
    },

    onPeriodChange() {
        if (!this.state.productId) return;

        if (this.tryAutofillByProductAndPeriod()) {
            this.render();
            if (this._compareMode) this._loadCompareData();
            return;
        }

        const product = getProductById(this.state.productId);
        this._resetStateForProduct(product);
        this.render();
        if (this._compareMode) this._loadCompareData();
    },

    _resetStateForProduct(product) {
        const ticketCurrency = product ? (product.priceCurrency || 'BRL') : 'BRL';
        this.state.actual = {
            cpc: 0,
            cpcCurrency: ticketCurrency,
            ctr: 0,
            viewPageRate: 0,
            atcRate: 0,
            checkoutRate: 0,
            saleRate: 0,
            impressions: 0,
            ticket: product ? (product.price || 0) : 0,
            ticketCurrency: ticketCurrency
        };
        this.state.benchmark = {
            cpc: 0,
            ctr: 0,
            viewPageRate: 0,
            atcRate: 0,
            checkoutRate: 0,
            saleRate: 0
        };
        this.state.simulations = [
            { field: 'ctr', value: 0 },
            { field: 'viewPageRate', value: 0 },
            { field: 'atcRate', value: 0 },
            { field: 'checkoutRate', value: 0 },
            { field: 'saleRate', value: 0 }
        ];
        this._lastFBData = null;

        const currSel = document.getElementById('funnel-currency');
        if (currSel) currSel.value = this.state.actual.ticketCurrency;
    },

    getSelectedPeriod() {
        const startInput = document.getElementById('funnel-date-start');
        const endInput = document.getElementById('funnel-date-end');
        const today = todayISO();

        let startDate = (startInput?.value || '').trim() || today;
        let endDate = (endInput?.value || '').trim() || startDate;

        if (startDate > endDate) {
            [startDate, endDate] = [endDate, startDate];
        }

        if (startInput) startInput.value = startDate;
        if (endInput) endInput.value = endDate;

        return { startDate, endDate };
    },

    getSelectedDate() {
        return this.getSelectedPeriod().endDate;
    },

    getSelectedPeriodLabel() {
        const { startDate, endDate } = this.getSelectedPeriod();
        if (startDate === endDate) return formatDate(startDate);
        return `${formatDate(startDate)} até ${formatDate(endDate)}`;
    },

    _buildSnapshotKey(productId, startDate, endDate) {
        const storeId = getWritableStoreId(productId) || 'default';
        if (startDate === endDate) return `${storeId}::${productId}::${startDate}`;
        return `${storeId}::${productId}::${startDate}__${endDate}`;
    },

    _loadSnapshots() {
        try {
            const raw = localStorage.getItem(this._snapshotStorageKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (err) {
            console.warn('Snapshot storage estava inválido, resetando...', err);
            localStorage.removeItem(this._snapshotStorageKey);
            return {};
        }
    },

    _saveSnapshots(allSnapshots) {
        localStorage.setItem(this._snapshotStorageKey, JSON.stringify(allSnapshots));
    },

    _buildSnapshotPayload() {
        const { startDate, endDate } = this.getSelectedPeriod();
        return {
            productId: this.state.productId,
            date: endDate,
            startDate,
            endDate,
            savedAt: new Date().toISOString(),
            actual: { ...this.state.actual },
            benchmark: { ...this.state.benchmark },
            simulations: this.state.simulations.map(sim => ({ ...sim }))
        };
    },

    _applySnapshot(snapshot) {
        this.state.actual = {
            ...this.state.actual,
            ...snapshot.actual
        };
        this.state.benchmark = {
            ...this.state.benchmark,
            ...snapshot.benchmark
        };
        this.state.actual.cpc = Number(this.state.actual.cpc) || 0;
        this.state.benchmark.cpc = Number(this.state.benchmark.cpc) || 0;
        this.state.actual.cpcCurrency = this.state.actual.cpcCurrency || this.state.actual.ticketCurrency || 'BRL';
        this.state.simulations = snapshot.simulations.map(sim => ({ ...sim }));
        const currSel = document.getElementById('funnel-currency');
        if (currSel) currSel.value = this.state.actual.ticketCurrency || 'BRL';
    },

    _hydrateFromDiaryEntry(entry) {
        const clicks = entry.cpc > 0 ? (entry.budget / entry.cpc) : 0;
        const ctr = entry.impressions > 0 && clicks > 0 ? (clicks / entry.impressions) * 100 : 0;
        const viewPageRate = clicks > 0 && entry.pageViews > 0 ? (entry.pageViews / clicks) * 100 : 0;
        const atcRate = entry.pageViews > 0 ? (entry.addToCart / entry.pageViews) * 100 : 0;
        const checkoutRate = entry.addToCart > 0 ? (entry.checkout / entry.addToCart) * 100 : 0;
        const saleRate = entry.checkout > 0 ? (entry.sales / entry.checkout) * 100 : 0;

        const product = getProductById(entry.productId);
        const ticketBase = entry.sales > 0 ? (entry.revenue / entry.sales) : (product ? product.price : 0);
        const ticket = convertCurrency(ticketBase, entry.revenueCurrency, this.state.actual.ticketCurrency);

        this.state.actual.impressions = entry.impressions || 0;
        this.state.actual.cpc = parseFloat(convertCurrency(
            entry.cpc || 0,
            entry.budgetCurrency || this.state.actual.ticketCurrency,
            this.state.actual.ticketCurrency
        ).toFixed(2)) || 0;
        this.state.actual.cpcCurrency = this.state.actual.ticketCurrency;
        this.state.actual.ctr = parseFloat(ctr.toFixed(2)) || 0;
        this.state.actual.viewPageRate = parseFloat(viewPageRate.toFixed(2)) || 0;
        this.state.actual.atcRate = parseFloat(atcRate.toFixed(2)) || 0;
        this.state.actual.checkoutRate = parseFloat(checkoutRate.toFixed(2)) || 0;
        this.state.actual.saleRate = parseFloat(saleRate.toFixed(2)) || 0;
        this.state.actual.ticket = parseFloat(ticket.toFixed(2)) || 0;

        this.state.simulations = [
            { field: 'ctr', value: this.state.actual.ctr },
            { field: 'viewPageRate', value: this.state.actual.viewPageRate },
            { field: 'atcRate', value: this.state.actual.atcRate },
            { field: 'checkoutRate', value: this.state.actual.checkoutRate },
            { field: 'saleRate', value: this.state.actual.saleRate }
        ];
    },

    _hydrateFromDiaryEntries(entries) {
        if (!entries || entries.length === 0) return false;

        let impressions = 0;
        let clicks = 0;
        let pageViews = 0;
        let addToCart = 0;
        let checkout = 0;
        let sales = 0;
        let totalBudgetInSelected = 0;
        let totalRevenueInSelected = 0;

        entries.forEach(entry => {
            impressions += Number(entry.impressions || 0);
            pageViews += Number(entry.pageViews || 0);
            addToCart += Number(entry.addToCart || 0);
            checkout += Number(entry.checkout || 0);
            sales += Number(entry.sales || 0);

            const budget = Number(entry.budget || 0);
            const budgetCurr = entry.budgetCurrency || this.state.actual.ticketCurrency;
            totalBudgetInSelected += convertCurrency(budget, budgetCurr, this.state.actual.ticketCurrency);

            const revenue = Number(entry.revenue || 0);
            const revenueCurr = entry.revenueCurrency || this.state.actual.ticketCurrency;
            totalRevenueInSelected += convertCurrency(revenue, revenueCurr, this.state.actual.ticketCurrency);

            if (entry.cpc > 0) {
                clicks += budget / entry.cpc;
            }
        });

        const ctr = impressions > 0 && clicks > 0 ? (clicks / impressions) * 100 : 0;
        const viewPageRate = clicks > 0 && pageViews > 0 ? (pageViews / clicks) * 100 : 0;
        const atcRate = pageViews > 0 ? (addToCart / pageViews) * 100 : 0;
        const checkoutRate = addToCart > 0 ? (checkout / addToCart) * 100 : 0;
        const saleRate = checkout > 0 ? (sales / checkout) * 100 : 0;

        const product = getProductById(this.state.productId);
        const defaultTicket = product
            ? convertCurrency(product.price || 0, product.priceCurrency || this.state.actual.ticketCurrency, this.state.actual.ticketCurrency)
            : 0;
        const ticket = sales > 0 ? (totalRevenueInSelected / sales) : defaultTicket;
        const cpc = clicks > 0 ? (totalBudgetInSelected / clicks) : 0;

        this.state.actual.impressions = Math.round(impressions);
        this.state.actual.cpc = parseFloat(cpc.toFixed(2)) || 0;
        this.state.actual.cpcCurrency = this.state.actual.ticketCurrency;
        this.state.actual.ctr = parseFloat(ctr.toFixed(2)) || 0;
        this.state.actual.viewPageRate = parseFloat(viewPageRate.toFixed(2)) || 0;
        this.state.actual.atcRate = parseFloat(atcRate.toFixed(2)) || 0;
        this.state.actual.checkoutRate = parseFloat(checkoutRate.toFixed(2)) || 0;
        this.state.actual.saleRate = parseFloat(saleRate.toFixed(2)) || 0;
        this.state.actual.ticket = parseFloat(ticket.toFixed(2)) || 0;

        this.state.simulations = [
            { field: 'ctr', value: this.state.actual.ctr },
            { field: 'viewPageRate', value: this.state.actual.viewPageRate },
            { field: 'atcRate', value: this.state.actual.atcRate },
            { field: 'checkoutRate', value: this.state.actual.checkoutRate },
            { field: 'saleRate', value: this.state.actual.saleRate }
        ];
        return true;
    },

    _parsePtBrDateToISO(value) {
        const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!match) return '';
        const [, dd, mm, yyyy] = match;
        return `${yyyy}-${mm}-${dd}`;
    },

    _extractPeriodFromNotes(notes) {
        const text = String(notes || '');
        const match = text.match(/Per[ií]odo do diagn[oó]stico:\s*(\d{2}\/\d{2}\/\d{4})\s*at[eé]\s*(\d{2}\/\d{2}\/\d{4})/i);
        if (!match) return null;
        const startDate = this._parsePtBrDateToISO(match[1]);
        const endDate = this._parsePtBrDateToISO(match[2]);
        if (!startDate || !endDate) return null;
        return { startDate, endDate };
    },

    _getDiaryEntryPeriod(entry) {
        const date = String(entry?.date || '').trim();
        const parsed = this._extractPeriodFromNotes(entry?.notes || '');
        let startDate = String(entry?.periodStart || '').trim() || parsed?.startDate || date;
        let endDate = String(entry?.periodEnd || '').trim() || parsed?.endDate || date || startDate;
        if (startDate && endDate && startDate > endDate) {
            [startDate, endDate] = [endDate, startDate];
        }
        return { startDate, endDate };
    },

    _stripRangeNote(notes) {
        const text = String(notes || '').trim();
        if (!text) return '';
        return text
            .replace(/\s*\|\s*Per[ií]odo do diagn[oó]stico:\s*\d{2}\/\d{2}\/\d{4}\s*at[eé]\s*\d{2}\/\d{2}\/\d{4}/ig, '')
            .replace(/Per[ií]odo do diagn[oó]stico:\s*\d{2}\/\d{2}\/\d{4}\s*at[eé]\s*\d{2}\/\d{2}\/\d{4}/ig, '')
            .trim();
    },

    tryAutofillByProductAndPeriod() {
        const productId = this.state.productId;
        const { startDate, endDate } = this.getSelectedPeriod();
        if (!productId || !startDate || !endDate) return false;

        const allSnapshots = this._loadSnapshots();
        const key = this._buildSnapshotKey(productId, startDate, endDate);
        const snapshot = allSnapshots[key];
        if (snapshot) {
            this._applySnapshot(snapshot);
            showToast(`Diagnóstico carregado automaticamente (${this.getSelectedPeriodLabel()})`, 'success');
            return true;
        }

        const exactEntries = AppState.diary
            .filter(d => {
                if (d.productId !== productId) return false;
                const period = this._getDiaryEntryPeriod(d);
                return period.startDate === startDate && period.endDate === endDate;
            })
            .sort((a, b) => b.date.localeCompare(a.date));

        if (exactEntries.length === 1) {
            this._hydrateFromDiaryEntry(exactEntries[0]);
            showToast(`Dados do diário carregados (${this.getSelectedPeriodLabel()})`, 'info');
            return true;
        }

        if (exactEntries.length > 1) {
            this._hydrateFromDiaryEntries(exactEntries);
            showToast(`Dados do diário agregados (${this.getSelectedPeriodLabel()})`, 'info');
            return true;
        }

        const diaryEntries = AppState.diary
            .filter(d => {
                if (d.productId !== productId) return false;
                const period = this._getDiaryEntryPeriod(d);
                if (!period.startDate || !period.endDate) return false;
                // Match entries fully within the range OR whose date falls in the range
                const entryDate = String(d.date || '').trim();
                return (period.startDate >= startDate && period.endDate <= endDate) ||
                       (entryDate >= startDate && entryDate <= endDate);
            })
            .sort((a, b) => b.date.localeCompare(a.date));

        if (diaryEntries.length === 1) {
            this._hydrateFromDiaryEntry(diaryEntries[0]);
            showToast(`Dados do diário carregados (${this.getSelectedPeriodLabel()})`, 'info');
            return true;
        }

        if (diaryEntries.length > 1) {
            this._hydrateFromDiaryEntries(diaryEntries);
            showToast(`Dados do diário agregados (${this.getSelectedPeriodLabel()})`, 'info');
            return true;
        }

        return false;
    },

    saveDiagnosisSnapshot(showFeedback = true) {
        const productId = this.state.productId;
        const { startDate, endDate } = this.getSelectedPeriod();
        if (!productId || !startDate || !endDate) {
            if (showFeedback) showToast('Selecione produto e período para salvar o diagnóstico', 'error');
            return false;
        }

        try {
            const allSnapshots = this._loadSnapshots();
            const key = this._buildSnapshotKey(productId, startDate, endDate);
            allSnapshots[key] = this._buildSnapshotPayload();
            this._saveSnapshots(allSnapshots);
        } catch (err) {
            console.error('Erro ao salvar snapshot de diagnóstico:', err);
            if (showFeedback) showToast('Falha ao salvar diagnóstico localmente', 'error');
            return false;
        }

        if (showFeedback) {
            showToast(`Diagnóstico salvo para ${this.getSelectedPeriodLabel()}`, 'success');
        }
        return true;
    },

    _isMobile() {
        return window.innerWidth <= this.MOBILE_BP;
    },

    // ---- Core Calculation ----
    calculateColumn(impressions, ctr, viewPageRate, atcRate, checkoutRate, saleRate, ticket) {
        const cliques = impressions * (ctr / 100);
        const pageViews = cliques * (viewPageRate / 100);
        const addToCart = pageViews * (atcRate / 100);
        const checkout = addToCart * (checkoutRate / 100);
        const sales = checkout * (saleRate / 100);
        const faturamento = sales * ticket;
        return { cliques, pageViews, addToCart, checkout, sales, faturamento };
    },

    getRealizadoResults() {
        const a = this.state.actual;
        return this.calculateColumn(a.impressions, a.ctr, a.viewPageRate, a.atcRate, a.checkoutRate, a.saleRate, a.ticket);
    },

    getSimulationResults(simIndex) {
        const a = this.state.actual;
        const sim = this.state.simulations[simIndex];
        const rates = {
            ctr: a.ctr, viewPageRate: a.viewPageRate, atcRate: a.atcRate,
            checkoutRate: a.checkoutRate, saleRate: a.saleRate
        };
        rates[sim.field] = sim.value;
        return this.calculateColumn(a.impressions, rates.ctr, rates.viewPageRate, rates.atcRate, rates.checkoutRate, rates.saleRate, a.ticket);
    },

    _getPageConversionRate(result) {
        if (!result || result.pageViews <= 0) return 0;
        return (result.sales / result.pageViews) * 100;
    },

    // ---- Render Dispatcher ----
    render() {
        if (this._isMobile()) {
            this.renderMobile();
        } else {
            this.renderTable();
        }
        this._renderFunnelChart();
    },

    // ===========================
    //  DESKTOP: Table Layout
    // ===========================
    renderTable() {
        const tbody = document.getElementById('funnel-tbody');
        if (!tbody) return;

        const a = this.state.actual;
        const b = this.state.benchmark;
        const real = this.getRealizadoResults();
        const simCount = 5;
        const simResults = [];
        for (let i = 0; i < simCount; i++) simResults.push(this.getSimulationResults(i));

        let html = '';
        const colSpan = 2 + 2 + simCount;

        // === PREMISSAS ===
        html += `<tr class="funnel-section-header"><td colspan="${colSpan}">Premissas</td></tr>`;
        html += '<tr>';
        html += '<td class="funnel-label">(Colocar)</td>';
        html += `<td class="funnel-metric">CPC ${this._tooltipHtml('cpc')}</td>`;
        html += `<td><input type="number" class="funnel-input funnel-input-actual" id="fa-cpc" value="${a.cpc || ''}" step="0.01" data-group="actual" data-field="cpc"></td>`;
        html += `<td><input type="number" class="funnel-input funnel-input-bench" id="fb-cpc" value="${b.cpc || ''}" step="0.01" data-group="bench" data-field="cpc"></td>`;
        for (let simIdx = 0; simIdx < simCount; simIdx++) {
            html += `<td class="funnel-auto" id="sc-cpc-${simIdx}">${this._fmtCurrency(a.cpc, a.ticketCurrency)}</td>`;
        }
        html += '</tr>';
        this._rateFields.forEach((field, rowIdx) => {
            html += '<tr>';
            html += '<td class="funnel-label">(Colocar)</td>';
            html += `<td class="funnel-metric">${this._rateLabels[rowIdx]} ${this._tooltipHtml(field)}</td>`;
            html += `<td><input type="number" class="funnel-input funnel-input-actual" id="fa-${field}" value="${a[field] || ''}" step="any" data-group="actual" data-field="${field}"></td>`;
            html += `<td><input type="number" class="funnel-input funnel-input-bench" id="fb-${field}" value="${b[field] || ''}" step="any" data-group="bench" data-field="${field}"></td>`;
            for (let simIdx = 0; simIdx < simCount; simIdx++) {
                if (simIdx === rowIdx) {
                    html += `<td><input type="number" class="funnel-input funnel-input-sim" id="fs-${simIdx}-${field}" value="${this.state.simulations[simIdx].value || ''}" step="any" data-group="sim" data-sim="${simIdx}" data-field="${field}"></td>`;
                } else {
                    html += `<td class="funnel-auto" id="sc-${simIdx}-${field}">${this._fmtPct(a[this._rateFields[rowIdx]])}</td>`;
                }
            }
            html += '</tr>';
        });

        // === NÚMEROS ===
        html += `<tr class="funnel-section-header"><td colspan="${colSpan}">Números</td></tr>`;
        html += '<tr><td class="funnel-label">(Colocar)</td><td class="funnel-metric"># Impressões</td>';
        html += `<td><input type="number" class="funnel-input funnel-input-actual" id="fa-impressions" value="${a.impressions || ''}" step="1" data-group="actual" data-field="impressions"></td>`;
        html += '<td class="funnel-auto">--</td>';
        for (let i = 0; i < simCount; i++) html += `<td class="funnel-auto" id="sn-${i}-impressions">${this._fmtNum(a.impressions)}</td>`;
        html += '</tr>';
        html += this._numRow('# Cliques', real.cliques, simResults.map(r => r.cliques), 'cliques', simCount);
        html += this._numRow('# View Page', real.pageViews, simResults.map(r => r.pageViews), 'pageViews', simCount);
        html += this._numRow('# Add to Cart', real.addToCart, simResults.map(r => r.addToCart), 'addToCart', simCount);
        html += this._numRow('# Checkout', real.checkout, simResults.map(r => r.checkout), 'checkout', simCount);
        html += this._numRow('# Venda total', real.sales, simResults.map(r => r.sales), 'sales', simCount);
        html += this._pctRow(
            'Conversão da Página',
            this._getPageConversionRate(real),
            simResults.map(r => this._getPageConversionRate(r)),
            'pageConversion',
            simCount
        );

        // === FINANCEIRO ===
        html += `<tr class="funnel-section-header"><td colspan="${colSpan}">Financeiro</td></tr>`;
        html += `<tr><td class="funnel-label">(Colocar)</td><td class="funnel-metric">${this._currencySymbol()} Ticket Principal</td>`;
        html += `<td><input type="number" class="funnel-input funnel-input-actual" id="fa-ticket" value="${a.ticket || ''}" step="0.01" data-group="actual" data-field="ticket"></td>`;
        html += '<td class="funnel-auto">--</td>';
        for (let i = 0; i < simCount; i++) html += `<td class="funnel-auto" id="sf-${i}-ticket">${this._fmtCurrency(a.ticket)}</td>`;
        html += '</tr>';
        html += `<tr><td class="funnel-label">(Automático)</td><td class="funnel-metric">${this._currencySymbol()} Faturamento</td>`;
        html += `<td class="funnel-auto" id="rn-faturamento">${this._fmtCurrency(real.faturamento)}</td>`;
        html += '<td class="funnel-auto">--</td>';
        for (let i = 0; i < simCount; i++) html += `<td class="funnel-auto" id="sf-${i}-faturamento">${this._fmtCurrency(simResults[i].faturamento)}</td>`;
        html += '</tr>';

        tbody.innerHTML = html;
        this._attachInputListeners();
    },

    _numRow(label, realValue, simValues, key, simCount) {
        let html = '<tr><td class="funnel-label">(Automático)</td>';
        html += `<td class="funnel-metric">${label}</td>`;
        html += `<td class="funnel-auto" id="rn-${key}">${this._fmtNum(realValue)}</td>`;
        html += '<td class="funnel-auto">--</td>';
        for (let i = 0; i < simCount; i++) html += `<td class="funnel-auto" id="sn-${i}-${key}">${this._fmtNum(simValues[i])}</td>`;
        html += '</tr>';
        return html;
    },

    _pctRow(label, realValue, simValues, key, simCount) {
        let html = '<tr><td class="funnel-label">(Automático)</td>';
        html += `<td class="funnel-metric">${label}</td>`;
        html += `<td class="funnel-auto" id="rn-${key}">${this._fmtPct(realValue)}</td>`;
        html += '<td class="funnel-auto">--</td>';
        for (let i = 0; i < simCount; i++) html += `<td class="funnel-auto" id="sn-${i}-${key}">${this._fmtPct(simValues[i])}</td>`;
        html += '</tr>';
        return html;
    },

    // ===========================
    //  MOBILE: Cards Layout
    // ===========================
    renderMobile() {
        const container = document.getElementById('funnel-mobile');
        if (!container) return;

        const a = this.state.actual;
        const b = this.state.benchmark;
        const real = this.getRealizadoResults();

        let html = '';

        // --- Card: Realizado ---
        html += this._mobileCard('Realizado', '', false, () => {
            let rows = '';
            rows += this._mobileSectionLabel('Premissas');
            rows += this._mobileInputRow('CPC ' + this._tooltipHtml('cpc'), 'fa-cpc', a.cpc, 'actual', 'cpc', '0.01');
            this._rateFields.forEach(field => {
                rows += this._mobileInputRow(this._rateLabelsShort[this._rateFields.indexOf(field)] + ' ' + this._tooltipHtml(field), `fa-${field}`, a[field], 'actual', field);
            });
            rows += this._mobileSectionLabel('Números');
            rows += this._mobileInputRow('# Impressões', 'fa-impressions', a.impressions, 'actual', 'impressions', '1');
            rows += this._mobileAutoRow('# Cliques', real.cliques, 'rn-cliques');
            rows += this._mobileAutoRow('# View Page', real.pageViews, 'rn-pageViews');
            rows += this._mobileAutoRow('# Add to Cart', real.addToCart, 'rn-addToCart');
            rows += this._mobileAutoRow('# Checkout', real.checkout, 'rn-checkout');
            rows += this._mobileAutoRow('# Venda total', real.sales, 'rn-sales');
            rows += this._mobilePctRow('Conversão da Página', this._getPageConversionRate(real), 'rn-pageConversion');
            rows += this._mobileSectionLabel('Financeiro');
            rows += this._mobileInputRow(`${this._currencySymbol()} Ticket`, 'fa-ticket', a.ticket, 'actual', 'ticket', '0.01');
            rows += this._mobileCurrencyRow(`${this._currencySymbol()} Faturamento`, real.faturamento, 'rn-faturamento');
            return rows;
        });

        // --- Card: Benchmarking ---
        html += this._mobileCard('Benchmarking', 'bench-header', true, () => {
            let rows = '';
            rows += this._mobileInputRow('CPC', 'fb-cpc', b.cpc, 'bench', 'cpc', '0.01', 'funnel-input-bench');
            this._rateFields.forEach(field => {
                rows += this._mobileInputRow(this._rateLabelsShort[this._rateFields.indexOf(field)], `fb-${field}`, b[field], 'bench', field, 'any', 'funnel-input-bench');
            });
            return rows;
        });

        // --- Cards: 5 Simulações ---
        for (let simIdx = 0; simIdx < 5; simIdx++) {
            const simRes = this.getSimulationResults(simIdx);
            const simField = this.state.simulations[simIdx].field;
            const simValue = this.state.simulations[simIdx].value;

            html += this._mobileCard(this._simLabels[simIdx], 'sim-header', true, () => {
                let rows = '';
                rows += this._mobileSectionLabel('Premissas');
                rows += this._mobileCurrencyRow('CPC', a.cpc, `msc-${simIdx}-cpc`, a.ticketCurrency);
                this._rateFields.forEach((field, rIdx) => {
                    if (rIdx === simIdx) {
                        // Editable sim input
                        rows += this._mobileInputRow(this._rateLabelsShort[rIdx], `fs-${simIdx}-${field}`, simValue, 'sim', field, 'any', 'funnel-input-sim', simIdx);
                    } else {
                        // Read-only: show realizado rate
                        rows += this._mobilePctRow(this._rateLabelsShort[rIdx], a[field], `msc-${simIdx}-${field}`);
                    }
                });
                rows += this._mobileSectionLabel('Números');
                rows += this._mobileAutoRow('# Impressões', a.impressions, `msn-${simIdx}-impressions`);
                rows += this._mobileAutoRow('# Cliques', simRes.cliques, `msn-${simIdx}-cliques`);
                rows += this._mobileAutoRow('# View Page', simRes.pageViews, `msn-${simIdx}-pageViews`);
                rows += this._mobileAutoRow('# Add to Cart', simRes.addToCart, `msn-${simIdx}-addToCart`);
                rows += this._mobileAutoRow('# Checkout', simRes.checkout, `msn-${simIdx}-checkout`);
                rows += this._mobileAutoRow('# Venda total', simRes.sales, `msn-${simIdx}-sales`);
                rows += this._mobilePctRow('Conversão da Página', this._getPageConversionRate(simRes), `msn-${simIdx}-pageConversion`);
                rows += this._mobileSectionLabel('Financeiro');
                rows += this._mobileCurrencyRow(`${this._currencySymbol()} Ticket`, a.ticket, `msf-${simIdx}-ticket`);
                rows += this._mobileCurrencyRow(`${this._currencySymbol()} Faturamento`, simRes.faturamento, `msf-${simIdx}-faturamento`);
                return rows;
            });
        }

        container.innerHTML = html;
        this._attachInputListeners();

        // Collapse/expand toggle
        container.querySelectorAll('.funnel-mobile-card-header').forEach(header => {
            header.addEventListener('click', () => {
                header.parentElement.classList.toggle('collapsed');
            });
        });
    },

    _mobileCard(title, headerClass, collapsed, contentFn) {
        return `<div class="funnel-mobile-card${collapsed ? ' collapsed' : ''}">
            <div class="funnel-mobile-card-header ${headerClass || ''}">${title}</div>
            <div class="funnel-mobile-card-body">${contentFn()}</div>
        </div>`;
    },

    _mobileSectionLabel(text) {
        return `<div class="funnel-mobile-section">${text}</div>`;
    },

    _mobileInputRow(label, id, value, group, field, step, extraClass, simIdx) {
        const cls = extraClass || 'funnel-input-actual';
        const simAttr = simIdx != null ? ` data-sim="${simIdx}"` : '';
        return `<div class="funnel-mobile-row">
            <span class="funnel-mobile-row-label">${label}</span>
            <input type="number" class="funnel-input ${cls}" id="${id}" value="${value || ''}" step="${step || 'any'}" data-group="${group}" data-field="${field}"${simAttr}>
        </div>`;
    },

    _mobileAutoRow(label, value, id) {
        return `<div class="funnel-mobile-row">
            <span class="funnel-mobile-row-label">${label}</span>
            <span class="funnel-auto" id="${id}">${this._fmtNum(value)}</span>
        </div>`;
    },

    _mobilePctRow(label, value, id) {
        return `<div class="funnel-mobile-row">
            <span class="funnel-mobile-row-label">${label}</span>
            <span class="funnel-auto" id="${id}">${this._fmtPct(value)}</span>
        </div>`;
    },

    _mobileCurrencyRow(label, value, id, currency) {
        return `<div class="funnel-mobile-row">
            <span class="funnel-mobile-row-label">${label}</span>
            <span class="funnel-auto" id="${id}">${this._fmtCurrency(value, currency)}</span>
        </div>`;
    },

    // ---- Shared Helpers ----
    _fmtNum(v) {
        if (v == null || isNaN(v)) return '--';
        return Math.round(v).toLocaleString('pt-BR');
    },

    _fmtPct(v) {
        if (v == null || isNaN(v) || v === 0) return '--';
        return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
    },

    _fmtCurrency(v, currency) {
        if (v == null || isNaN(v) || v === 0) return '--';
        currency = currency || this.state.actual.ticketCurrency || 'BRL';
        if (currency === 'USD') {
            return '$ ' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    _currencySymbol() {
        return this.state.actual.ticketCurrency === 'USD' ? '$' : 'R$';
    },

    // ---- Shared Input Listener ----
    _attachInputListeners() {
        // Works for both desktop table and mobile cards — same data-* attributes
        const containers = [
            document.getElementById('funnel-tbody'),
            document.getElementById('funnel-mobile')
        ];

        containers.forEach(el => {
            if (!el) return;
            el.querySelectorAll('.funnel-input').forEach(input => {
                input.addEventListener('input', (e) => {
                    const group = e.target.dataset.group;
                    const field = e.target.dataset.field;
                    const val = isNaN(e.target.valueAsNumber) ? 0 : e.target.valueAsNumber;

                    if (group === 'actual') {
                        this.state.actual[field] = val;
                    } else if (group === 'bench') {
                        this.state.benchmark[field] = val;
                        return;
                    } else if (group === 'sim') {
                        const simIdx = parseInt(e.target.dataset.sim);
                        this.state.simulations[simIdx].value = val;
                    }

                    this._recalc();
                });
            });

            // Tooltip click toggle for mobile
            el.querySelectorAll('.metric-info-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const wasActive = btn.classList.contains('active');
                    // Close all other tooltips
                    document.querySelectorAll('.metric-info-btn.active').forEach(b => b.classList.remove('active'));
                    if (!wasActive) btn.classList.add('active');
                });
            });
        });

        // Close tooltips when clicking elsewhere
        document.addEventListener('click', () => {
            document.querySelectorAll('.metric-info-btn.active').forEach(b => b.classList.remove('active'));
        }, { once: false });

    },

    // ---- Recalc: updates both desktop and mobile auto cells ----
    _recalc() {
        const a = this.state.actual;
        const real = this.getRealizadoResults();
        const simCount = 5;
        const simResults = [];
        for (let i = 0; i < simCount; i++) simResults.push(this.getSimulationResults(i));

        // --- Desktop table cells ---
        this._rateFields.forEach((field, rowIdx) => {
            for (let simIdx = 0; simIdx < simCount; simIdx++) {
                if (simIdx !== rowIdx) {
                    this._updateCell(`sc-${simIdx}-${field}`, this._fmtPct(a[this._rateFields[rowIdx]]));
                }
            }
        });
        for (let i = 0; i < simCount; i++) {
            this._updateCell(`sc-cpc-${i}`, this._fmtCurrency(a.cpc, a.ticketCurrency));
        }
        for (let i = 0; i < simCount; i++) this._updateCell(`sn-${i}-impressions`, this._fmtNum(a.impressions));

        const numKeys = ['cliques', 'pageViews', 'addToCart', 'checkout', 'sales'];
        numKeys.forEach(key => {
            this._updateCell(`rn-${key}`, this._fmtNum(real[key]));
            for (let i = 0; i < simCount; i++) this._updateCell(`sn-${i}-${key}`, this._fmtNum(simResults[i][key]));
        });
        this._updateCell('rn-pageConversion', this._fmtPct(this._getPageConversionRate(real)));
        for (let i = 0; i < simCount; i++) {
            this._updateCell(`sn-${i}-pageConversion`, this._fmtPct(this._getPageConversionRate(simResults[i])));
        }

        for (let i = 0; i < simCount; i++) this._updateCell(`sf-${i}-ticket`, this._fmtCurrency(a.ticket));
        this._updateCell('rn-faturamento', this._fmtCurrency(real.faturamento));
        for (let i = 0; i < simCount; i++) this._updateCell(`sf-${i}-faturamento`, this._fmtCurrency(simResults[i].faturamento));

        // --- Mobile card cells ---
        for (let simIdx = 0; simIdx < simCount; simIdx++) {
            const sr = simResults[simIdx];
            // Premissas read-only rates
            this._rateFields.forEach((field, rIdx) => {
                if (rIdx !== simIdx) {
                    this._updateCell(`msc-${simIdx}-${field}`, this._fmtPct(a[field]));
                }
            });
            this._updateCell(`msc-${simIdx}-cpc`, this._fmtCurrency(a.cpc, a.ticketCurrency));
            // Números
            this._updateCell(`msn-${simIdx}-impressions`, this._fmtNum(a.impressions));
            numKeys.forEach(key => this._updateCell(`msn-${simIdx}-${key}`, this._fmtNum(sr[key])));
            this._updateCell(`msn-${simIdx}-pageConversion`, this._fmtPct(this._getPageConversionRate(sr)));
            // Financeiro
            this._updateCell(`msf-${simIdx}-ticket`, this._fmtCurrency(a.ticket));
            this._updateCell(`msf-${simIdx}-faturamento`, this._fmtCurrency(sr.faturamento));
        }

        // Update comparison if active
        if (this._compareMode) this._renderComparison();
    },

    _updateCell(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    },

    // ---- Facebook Import ----
    async loadFromFacebook() {
        if (!this.state.productId) {
            showToast('Selecione um produto primeiro', 'error');
            return;
        }
        if (!FacebookAds.isConnected()) {
            showToast('Configure o Facebook Ads primeiro', 'error');
            return;
        }
        const mapped = FacebookAds.campaignMap[this.state.productId];
        if (!mapped || mapped.length === 0) {
            showToast('Mapeie as campanhas para este produto', 'error');
            return;
        }

        try {
            showToast('Importando dados do Facebook...', 'info');
            const dateRange = this._getSelectedDateRange();
            const data = await FacebookAds.fetchProductInsights(this.state.productId, dateRange);
            this._applyImportedFunnelData(data);
            showToast(`Dados importados: ${data.impressions.toLocaleString('pt-BR')} impressões, ${data.purchase} vendas`, 'success');
        } catch (err) {
            showToast('Erro ao importar: ' + err.message, 'error');
            console.error('FB Import Error:', err);
        }
    },

    async loadFromFacebookReportFile(file) {
        if (!file) return;
        const fileName = (file.name || '').toLowerCase();

        if (fileName.endsWith('.csv')) {
            await this.loadFromFacebookCsv(file);
            return;
        }

        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            await this.loadFromFacebookXlsx(file);
            return;
        }

        showToast('Formato não suportado. Use CSV, XLSX ou XLS.', 'error');
    },

    async extractReportMetricsFromFile(file) {
        if (!file) {
            throw new Error('Arquivo inválido');
        }

        const fileName = String(file.name || '').toLowerCase();
        if (fileName.endsWith('.csv')) {
            const csvText = await file.text();
            const rows = this._parseCsv(csvText);
            return this._extractReportMetricsFromRows(rows);
        }

        if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
            if (typeof XLSX === 'undefined') {
                throw new Error('Biblioteca XLSX não carregada');
            }
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const selected = this._pickWorkbookSheet(workbook);
            if (!selected?.sheet) {
                throw new Error('Aba de dados não encontrada no arquivo');
            }
            const rows = XLSX.utils.sheet_to_json(selected.sheet, {
                header: 1,
                raw: false,
                defval: ''
            });
            return this._extractReportMetricsFromRows(rows);
        }

        throw new Error('Formato não suportado. Use CSV, XLSX ou XLS.');
    },

    _extractReportMetricsFromRows(rows) {
        if (!rows || rows.length < 2) {
            throw new Error('Relatório vazio ou inválido');
        }

        const headerRowIdx = this._findHeaderRowIndex(rows);
        if (headerRowIdx < 0) {
            throw new Error('Cabeçalho não encontrado no relatório');
        }

        const headerMap = this._buildCsvHeaderMap(rows[headerRowIdx]);
        const dataRows = rows
            .slice(headerRowIdx + 1)
            .filter(row => (row || []).some(cell => String(cell || '').trim() !== ''));

        if (dataRows.length === 0) {
            throw new Error('Relatório sem linhas de dados');
        }

        const dailyGroups = this._groupDailyRows(dataRows, headerMap);
        let imported = null;
        let mode = 'single';

        if (dailyGroups.size > 1) {
            const dailyMetricsByDate = {};
            dailyGroups.forEach((dayRows, date) => {
                const metrics = this._pickBestDailyRow(dayRows, headerMap);
                if (metrics) dailyMetricsByDate[date] = metrics;
            });
            const aggregatedDaily = this._aggregateImportedMetricsByDay(dailyMetricsByDate);
            if (aggregatedDaily) {
                imported = aggregatedDaily;
                mode = 'daily_aggregated';
            }
        }

        if (!imported) {
            const totalsRow = this._findTotalsRow(dataRows, headerMap);
            if (totalsRow) {
                imported = this._extractCsvMetricsFromRow(totalsRow, headerMap);
                mode = 'totals_row';
            } else {
                imported = this._aggregateCsvMetrics(dataRows, headerMap);
                mode = 'rows_aggregated';
            }
        }

        const missing = this._listMissingImportedMetrics(imported);
        return {
            imported,
            missing,
            mode,
            dailyDays: dailyGroups.size
        };
    },

    async loadFromFacebookCsv(file) {
        if (!this.state.productId) {
            showToast('Selecione um produto antes de importar CSV', 'error');
            return;
        }

        try {
            showToast('Lendo relatório CSV...', 'info');
            const csvText = await file.text();
            const rows = this._parseCsv(csvText);
            await this._importFacebookReportRows(rows, 'CSV');
        } catch (err) {
            console.error('CSV Import Error:', err);
            showToast(`Erro ao importar CSV: ${err.message}`, 'error');
        }
    },

    async loadFromFacebookXlsx(file) {
        if (!this.state.productId) {
            showToast('Selecione um produto antes de importar XLSX', 'error');
            return;
        }

        try {
            if (typeof XLSX === 'undefined') {
                throw new Error('Biblioteca XLSX não carregada');
            }

            showToast('Lendo relatório Excel...', 'info');
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            const selected = this._pickWorkbookSheet(workbook);
            if (!selected?.sheet) {
                throw new Error('Aba de dados não encontrada no arquivo');
            }

            const rows = XLSX.utils.sheet_to_json(selected.sheet, {
                header: 1,
                raw: false,
                defval: ''
            });

            await this._importFacebookReportRows(rows, 'Excel');
        } catch (err) {
            console.error('XLSX Import Error:', err);
            showToast(`Erro ao importar Excel: ${err.message}`, 'error');
        }
    },

    _pickWorkbookSheet(workbook) {
        const names = workbook?.SheetNames || [];
        if (names.length === 0) return null;

        const candidates = names.map(name => {
            const sheet = workbook.Sheets[name];
            const rows = XLSX.utils.sheet_to_json(sheet, {
                header: 1,
                raw: false,
                defval: ''
            });
            const headerRowIdx = this._findHeaderRowIndex(rows);
            if (headerRowIdx < 0) {
                return {
                    name,
                    sheet,
                    score: -1,
                    dailyQuality: {
                        dailyDays: 0,
                        dailyRows: 0,
                        dailyRowsWithCampaign: 0
                    }
                };
            }

            const headerMap = this._buildCsvHeaderMap(rows[headerRowIdx]);
            const dataRows = rows
                .slice(headerRowIdx + 1)
                .filter(row => (row || []).some(cell => String(cell || '').trim() !== ''));
            const dailyQuality = this._analyzeDailySheetQuality(dataRows, headerMap);
            let score = 0;
            if (this._findHeaderIndex(headerMap, ['impressoes']) >= 0) score += 1;
            if (this._findHeaderIndex(headerMap, ['cliques no link', 'cliques']) >= 0) score += 1;
            if (this._findHeaderIndex(headerMap, ['visualizacoes da pagina de destino']) >= 0) score += 1;
            if (this._findHeaderIndex(headerMap, ['compras', 'resultados']) >= 0) score += 1;
            if (this._findHeaderIndex(headerMap, ['valor usado', 'amount spent']) >= 0) score += 1;
            if (this._findHeaderIndex(headerMap, ['visu pagina add to cart', 'add to cart']) >= 0) score += 2;
            if (this._findHeaderIndex(headerMap, ['carrinho checkout', 'checkout']) >= 0) score += 2;
            if (this._findHeaderIndex(headerMap, ['ic compras', 'purchase checkout']) >= 0) score += 2;

            const n = this._normalizeCsvKey(name);
            if (n.includes('raw data')) score += 0.2;
            if (n.includes('formatted report') || n.includes('relatorio formatado')) score += 0.1;

            if (dailyQuality.dailyDays > 1) {
                score += 1;
                score += Math.min(dailyQuality.dailyDays, 62) * 0.01;
            }
            score += Math.min(dailyQuality.dailyRowsWithCampaign, 200) * 0.01;
            if (dailyQuality.dailyDays > 1 && dailyQuality.dailyRows > 0 && dailyQuality.dailyRowsWithCampaign === 0) {
                score -= 1;
            }

            return { name, sheet, score, dailyQuality };
        });

        const best = candidates.sort((a, b) => {
            const aDays = Number(a?.dailyQuality?.dailyDays || 0);
            const bDays = Number(b?.dailyQuality?.dailyDays || 0);
            if (bDays !== aDays) return bDays - aDays;

            const aCampaignRows = Number(a?.dailyQuality?.dailyRowsWithCampaign || 0);
            const bCampaignRows = Number(b?.dailyQuality?.dailyRowsWithCampaign || 0);
            if (bCampaignRows !== aCampaignRows) return bCampaignRows - aCampaignRows;

            const aRows = Number(a?.dailyQuality?.dailyRows || 0);
            const bRows = Number(b?.dailyQuality?.dailyRows || 0);
            if (bRows !== aRows) return bRows - aRows;

            return (b.score || 0) - (a.score || 0);
        })[0];
        return best || { name: names[0], sheet: workbook.Sheets[names[0]], score: 0 };
    },

    _analyzeDailySheetQuality(dataRows, headerMap) {
        const dailyGroups = this._groupDailyRows(dataRows, headerMap);
        const campaignIdx = this._findHeaderIndex(headerMap, ['nome da campanha', 'campaign name']);
        let dailyRows = 0;
        let dailyRowsWithCampaign = 0;

        dailyGroups.forEach(rows => {
            rows.forEach(row => {
                dailyRows += 1;
                if (campaignIdx < 0) return;
                const campaignName = this._normalizeCsvKey(row?.[campaignIdx] || '');
                if (campaignName) dailyRowsWithCampaign += 1;
            });
        });

        return {
            dailyDays: dailyGroups.size,
            dailyRows,
            dailyRowsWithCampaign
        };
    },

    async _importFacebookReportRows(rows, sourceLabel) {
        if (!rows || rows.length < 2) {
            throw new Error(`${sourceLabel} vazio ou inválido`);
        }

        const headerRowIdx = this._findHeaderRowIndex(rows);
        if (headerRowIdx < 0) {
            throw new Error('Cabeçalho não encontrado no relatório');
        }

        const headerMap = this._buildCsvHeaderMap(rows[headerRowIdx]);
        const dataRows = rows
            .slice(headerRowIdx + 1)
            .filter(row => (row || []).some(cell => String(cell || '').trim() !== ''));

        if (dataRows.length === 0) {
            throw new Error('Relatório sem linhas de dados');
        }

        const dailyGroups = this._groupDailyRows(dataRows, headerMap);
        if (dailyGroups.size > 1) {
            const handled = await this._importFacebookPeriodByDay(dataRows, headerMap, sourceLabel, dailyGroups);
            if (handled) return;
        }
        const totalsRow = this._findTotalsRow(dataRows, headerMap);
        let imported;
        if (totalsRow) {
            imported = this._extractCsvMetricsFromRow(totalsRow, headerMap);
        } else {
            imported = this._aggregateCsvMetrics(dataRows, headerMap);
            showToast('Linha de totais não encontrada, usei agregação das linhas.', 'info');
        }

        this._applyImportedFunnelData(imported, { preserveMissing: true });
        showToast(`${sourceLabel} importado: ${imported.impressions.toLocaleString('pt-BR')} impressões, ${imported.purchase} compras`, 'success');
        const missing = this._listMissingImportedMetrics(imported);
        if (missing.length > 0) {
            showToast(`Importação parcial: não encontrei ${missing.join(', ')} neste relatório.`, 'info');
        }
    },

    _normalizeReportDateValue(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';

        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

        let m = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (m) {
            const a = Number(m[1]);
            const b = Number(m[2]);
            const yyyy = m[3];
            if (a > 12 && b <= 12) return `${yyyy}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
            if (b > 12 && a <= 12) return `${yyyy}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`;
            return `${yyyy}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
        }

        m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
        if (m) {
            const dd = String(m[1]).padStart(2, '0');
            const mm = String(m[2]).padStart(2, '0');
            return `${m[3]}-${mm}-${dd}`;
        }

        if (/^\d+(\.\d+)?$/.test(raw)) {
            const serial = parseFloat(raw);
            if (serial > 1000) {
                const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                const ms = excelEpoch.getTime() + Math.round(serial * 86400000);
                const d = new Date(ms);
                if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
            }
        }

        const parsed = new Date(raw);
        if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
        return '';
    },

    _extractReportDateRangeFromRow(row, headerMap) {
        const startRaw = this._pickCsvValue(row, headerMap, ['inicio dos relatorios', 'reporting starts', 'start date', 'date start']);
        const endRaw = this._pickCsvValue(row, headerMap, ['termino dos relatorios', 'reporting ends', 'end date', 'date end']);
        const startDate = this._normalizeReportDateValue(startRaw);
        let endDate = this._normalizeReportDateValue(endRaw || startRaw);
        if (!startDate || !endDate) return null;
        if (startDate > endDate) {
            return { startDate: endDate, endDate: startDate };
        }
        return { startDate, endDate };
    },

    _isDailyRow(row, headerMap) {
        const range = this._extractReportDateRangeFromRow(row, headerMap);
        return !!range && range.startDate === range.endDate;
    },

    _isTotalLikeRow(row, headerMap) {
        const hasTotalsLabel = (row || []).some(cell => this._normalizeCsvKey(cell).includes('resultados totais'));
        if (hasTotalsLabel) return true;

        const campaignIdx = this._findHeaderIndex(headerMap, ['nome da campanha', 'campaign name']);
        const campaignName = campaignIdx >= 0 ? this._normalizeCsvKey(row[campaignIdx]) : '';
        return !campaignName || campaignName.includes('total') || campaignName.includes('resultado');
    },

    _groupDailyRows(rows, headerMap) {
        const byDay = new Map();
        rows.forEach(row => {
            const range = this._extractReportDateRangeFromRow(row, headerMap);
            if (!range || range.startDate !== range.endDate) return;
            const date = range.startDate;
            if (!byDay.has(date)) byDay.set(date, []);
            byDay.get(date).push(row);
        });
        return byDay;
    },

    _pickBestDailyRow(dayRows, headerMap) {
        const labeled = dayRows.filter(row =>
            (row || []).some(cell => this._normalizeCsvKey(cell).includes('resultados totais'))
        );
        if (labeled.length > 0) {
            return this._extractCsvMetricsFromRow(labeled[labeled.length - 1], headerMap);
        }

        // Separate summary rows (Ad="All" or Level="campaign") from ad-level rows
        // to avoid double-counting when both are present
        const adNameIdx = this._findHeaderIndex(headerMap, ['nome do anuncio', 'ad name']);
        const levelIdx = this._findHeaderIndex(headerMap, ['nivel de veiculacao', 'delivery level']);

        const summaryRows = [];
        const adRows = [];

        dayRows.forEach(row => {
            const adName = adNameIdx >= 0 ? String(row?.[adNameIdx] || '').trim().toLowerCase() : '';
            const level = levelIdx >= 0 ? this._normalizeCsvKey(row?.[levelIdx] || '') : '';

            const isSummary = adName === 'all' || adName === '' || level === 'campaign';
            if (isSummary) {
                summaryRows.push(row);
            } else {
                adRows.push(row);
            }
        });

        // If we have both summary and ad rows, prefer summary rows (they already total the ads)
        const rowsToUse = (summaryRows.length > 0 && adRows.length > 0)
            ? summaryRows
            : dayRows;

        const metricRows = rowsToUse.filter(row => {
            const metrics = this._extractCsvMetricsFromRow(row, headerMap);
            if (!metrics || !metrics.coverage) return false;
            return Object.values(metrics.coverage).some(Boolean);
        });

        if (metricRows.length === 0) return this._aggregateCsvMetrics(rowsToUse, headerMap);
        return this._aggregateCsvMetrics(metricRows, headerMap);
    },

    _inferReportOverallRange(rows, headerMap) {
        let minDate = '';
        let maxDate = '';
        rows.forEach(row => {
            const range = this._extractReportDateRangeFromRow(row, headerMap);
            if (!range) return;
            if (!minDate || range.startDate < minDate) minDate = range.startDate;
            if (!maxDate || range.endDate > maxDate) maxDate = range.endDate;
        });
        if (!minDate || !maxDate) return null;
        return { startDate: minDate, endDate: maxDate };
    },

    _daysBetweenInclusive(startDate, endDate) {
        if (!startDate || !endDate) return 0;
        const start = new Date(`${startDate}T00:00:00Z`);
        const end = new Date(`${endDate}T00:00:00Z`);
        if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
        return Math.floor((end - start) / 86400000) + 1;
    },

    _aggregateImportedMetricsByDay(dailyMetricsByDate) {
        const rows = Object.values(dailyMetricsByDate || {});
        if (rows.length === 0) return null;

        const totals = {
            impressions: 0,
            clicks: 0,
            spend: 0,
            viewContent: 0,
            addToCart: 0,
            checkout: 0,
            purchase: 0,
            purchaseValue: 0,
            valueCurrency: this.state.actual.ticketCurrency || 'BRL',
            rateColumns: { ctr: false, viewPageRate: false, atcRate: false, checkoutRate: false, saleRate: false },
            coverage: {
                impressions: false,
                clicks: false,
                spend: false,
                viewContent: false,
                addToCart: false,
                checkout: false,
                purchase: false,
                purchaseValue: false,
                ctr: false,
                viewPageRate: false,
                atcRate: false,
                checkoutRate: false,
                saleRate: false
            },
            ctrWeightedSum: 0,
            ctrWeight: 0,
            viewPageRateWeightedSum: 0,
            viewPageRateWeight: 0,
            atcRateWeightedSum: 0,
            atcRateWeight: 0,
            checkoutRateWeightedSum: 0,
            checkoutRateWeight: 0,
            saleRateWeightedSum: 0,
            saleRateWeight: 0
        };

        rows.forEach(m => {
            totals.impressions += Number(m.impressions || 0);
            totals.clicks += Number(m.clicks || 0);
            totals.spend += Number(m.spend || 0);
            totals.viewContent += Number(m.viewContent || 0);
            totals.addToCart += Number(m.addToCart || 0);
            totals.checkout += Number(m.checkout || 0);
            totals.purchase += Number(m.purchase || 0);
            totals.purchaseValue += Number(m.purchaseValue || 0);
            if (m.valueCurrency === 'USD') totals.valueCurrency = 'USD';

            {
                const denominator = Number(m.impressions || 0);
                if (m.rateColumns?.ctr) {
                    const weight = denominator > 0 ? denominator : 1;
                    totals.ctrWeightedSum += Number(m.ctr || 0) * weight;
                    totals.ctrWeight += weight;
                } else if (denominator > 0) {
                    totals.ctrWeight += denominator;
                }
            }
            {
                const denominator = Number(m.clicks || 0);
                if (m.rateColumns?.viewPageRate) {
                    const weight = denominator > 0 ? denominator : 1;
                    totals.viewPageRateWeightedSum += Number(m.viewPageRate || 0) * weight;
                    totals.viewPageRateWeight += weight;
                } else if (denominator > 0) {
                    totals.viewPageRateWeight += denominator;
                }
            }
            {
                const denominator = Number(m.viewContent || 0);
                if (m.rateColumns?.atcRate) {
                    const weight = denominator > 0 ? denominator : 1;
                    totals.atcRateWeightedSum += Number(m.atcRate || 0) * weight;
                    totals.atcRateWeight += weight;
                } else if (denominator > 0) {
                    totals.atcRateWeight += denominator;
                }
            }
            {
                const addToCartFromCount = Number(m.addToCart || 0);
                const addToCartFromRates = Number(m.viewContent || 0) > 0
                    ? (Number(m.viewContent || 0) * Number(m.atcRate || 0)) / 100
                    : 0;
                const denominator = addToCartFromCount > 0
                    ? addToCartFromCount
                    : addToCartFromRates;
                if (m.rateColumns?.checkoutRate) {
                    const weight = denominator > 0 ? denominator : (Number(m.checkout || 0) > 0 ? Number(m.checkout || 0) : 1);
                    totals.checkoutRateWeightedSum += Number(m.checkoutRate || 0) * weight;
                    totals.checkoutRateWeight += weight;
                } else if (denominator > 0) {
                    totals.checkoutRateWeight += denominator;
                }
            }
            {
                const denominator = Number(m.checkout || 0);
                if (m.rateColumns?.saleRate) {
                    const weight = denominator > 0 ? denominator : 1;
                    totals.saleRateWeightedSum += Number(m.saleRate || 0) * weight;
                    totals.saleRateWeight += weight;
                } else if (denominator > 0) {
                    // campanha sem % explícito, mas com checkout: entra como 0% na média
                    totals.saleRateWeight += denominator;
                }
            }

            Object.keys(totals.coverage).forEach(key => {
                totals.coverage[key] = totals.coverage[key] || !!m.coverage?.[key];
            });
            Object.keys(totals.rateColumns).forEach(key => {
                totals.rateColumns[key] = totals.rateColumns[key] || !!m.rateColumns?.[key];
            });
        });

        const ctrFromCount = totals.impressions > 0
            ? (totals.clicks / totals.impressions) * 100
            : 0;
        const ctrFromRate = totals.ctrWeight > 0 ? (totals.ctrWeightedSum / totals.ctrWeight) : 0;

        const viewPageRateFromCount = totals.clicks > 0
            ? (totals.viewContent / totals.clicks) * 100
            : 0;
        const viewPageRateFromRate = totals.viewPageRateWeight > 0
            ? (totals.viewPageRateWeightedSum / totals.viewPageRateWeight)
            : 0;

        const atcRateFromCount = totals.viewContent > 0
            ? (totals.addToCart / totals.viewContent) * 100
            : 0;
        const atcRateFromRate = totals.atcRateWeight > 0
            ? (totals.atcRateWeightedSum / totals.atcRateWeight)
            : 0;

        const checkoutRateFromCount = totals.addToCart > 0
            ? (totals.checkout / totals.addToCart) * 100
            : 0;
        const checkoutRateFromRate = totals.checkoutRateWeight > 0
            ? (totals.checkoutRateWeightedSum / totals.checkoutRateWeight)
            : 0;

        const saleRateFromCount = totals.checkout > 0
            ? (totals.purchase / totals.checkout) * 100
            : 0;
        const saleRateFromRate = totals.saleRateWeight > 0
            ? (totals.saleRateWeightedSum / totals.saleRateWeight)
            : 0;

        const ctr = (totals.rateColumns.ctr && totals.ctrWeight > 0)
            ? ctrFromRate
            : (totals.impressions > 0 ? ctrFromCount : ctrFromRate);
        const viewPageRate = (totals.rateColumns.viewPageRate && totals.viewPageRateWeight > 0)
            ? viewPageRateFromRate
            : (totals.clicks > 0 ? viewPageRateFromCount : viewPageRateFromRate);
        const atcRate = (totals.rateColumns.atcRate && totals.atcRateWeight > 0)
            ? atcRateFromRate
            : (totals.viewContent > 0 ? atcRateFromCount : atcRateFromRate);
        const checkoutRate = (totals.rateColumns.checkoutRate && totals.checkoutRateWeight > 0)
            ? checkoutRateFromRate
            : (totals.addToCart > 0 ? checkoutRateFromCount : checkoutRateFromRate);
        const saleRate = (totals.rateColumns.saleRate && totals.saleRateWeight > 0)
            ? saleRateFromRate
            : (totals.checkout > 0 ? saleRateFromCount : saleRateFromRate);

        return {
            impressions: Math.round(totals.impressions),
            clicks: Math.round(totals.clicks),
            spend: parseFloat(totals.spend.toFixed(2)),
            viewContent: Math.round(totals.viewContent),
            addToCart: Math.round(totals.addToCart),
            checkout: Math.round(totals.checkout),
            purchase: Math.round(totals.purchase),
            purchaseValue: parseFloat(totals.purchaseValue.toFixed(2)),
            ctr: parseFloat((ctr || 0).toFixed(4)),
            viewPageRate: parseFloat((viewPageRate || 0).toFixed(4)),
            atcRate: parseFloat((atcRate || 0).toFixed(4)),
            checkoutRate: parseFloat((checkoutRate || 0).toFixed(4)),
            saleRate: parseFloat((saleRate || 0).toFixed(4)),
            valueCurrency: totals.valueCurrency,
            rateColumns: { ...totals.rateColumns },
            coverage: { ...totals.coverage }
        };
    },

    _buildSnapshotPayloadFromImportedMetrics(productId, startDate, endDate, metrics) {
        const product = getProductById(productId);
        const ticketCurrency = product?.priceCurrency || this.state.actual.ticketCurrency || 'BRL';
        const defaultTicket = product
            ? convertCurrency(product.price || 0, product.priceCurrency || ticketCurrency, ticketCurrency)
            : 0;

        const spendCurrency = metrics.valueCurrency || ticketCurrency;
        const cpcSource = (metrics.clicks || 0) > 0 ? ((metrics.spend || 0) / metrics.clicks) : 0;
        const cpc = convertCurrency(cpcSource, spendCurrency, ticketCurrency);

        let ticket = defaultTicket;
        if ((metrics.purchaseValue || 0) > 0 && (metrics.purchase || 0) > 0) {
            ticket = convertCurrency((metrics.purchaseValue / metrics.purchase), spendCurrency, ticketCurrency);
        }

        const actual = {
            impressions: Math.round(metrics.impressions || 0),
            cpc: parseFloat((cpc || 0).toFixed(2)),
            cpcCurrency: ticketCurrency,
            ctr: parseFloat((metrics.ctr || 0).toFixed(2)),
            viewPageRate: parseFloat((metrics.viewPageRate || 0).toFixed(2)),
            atcRate: parseFloat((metrics.atcRate || 0).toFixed(2)),
            checkoutRate: parseFloat((metrics.checkoutRate || 0).toFixed(2)),
            saleRate: parseFloat((metrics.saleRate || 0).toFixed(2)),
            ticket: parseFloat((ticket || 0).toFixed(2)),
            ticketCurrency
        };

        return {
            productId,
            date: endDate,
            startDate,
            endDate,
            savedAt: new Date().toISOString(),
            actual,
            benchmark: {
                cpc: 0,
                ctr: 0,
                viewPageRate: 0,
                atcRate: 0,
                checkoutRate: 0,
                saleRate: 0
            },
            simulations: [
                { field: 'ctr', value: actual.ctr },
                { field: 'viewPageRate', value: actual.viewPageRate },
                { field: 'atcRate', value: actual.atcRate },
                { field: 'checkoutRate', value: actual.checkoutRate },
                { field: 'saleRate', value: actual.saleRate }
            ]
        };
    },

    _saveImportedDaySnapshots(productId, dailyMetricsByDate, snapshots = null) {
        const allSnapshots = snapshots || this._loadSnapshots();
        Object.entries(dailyMetricsByDate).forEach(([date, metrics]) => {
            const key = this._buildSnapshotKey(productId, date, date);
            allSnapshots[key] = this._buildSnapshotPayloadFromImportedMetrics(productId, date, date, metrics);
        });
        return allSnapshots;
    },

    _saveImportedRangeSnapshot(productId, startDate, endDate, metrics, snapshots = null) {
        const allSnapshots = snapshots || this._loadSnapshots();
        const key = this._buildSnapshotKey(productId, startDate, endDate);
        allSnapshots[key] = this._buildSnapshotPayloadFromImportedMetrics(productId, startDate, endDate, metrics);
        return allSnapshots;
    },

    async _upsertDiaryEntryFromImportedDay(productId, storeId, date, importedMetrics, sourceLabel) {
        const spendCurrency = importedMetrics.valueCurrency || this.state.actual.ticketCurrency || 'BRL';
        const existing = AppState.allDiary.find(d => {
            if (d.productId !== productId) return false;
            const period = this._getDiaryEntryPeriod(d);
            return period.startDate === date && period.endDate === date;
        });

        const clicks = Number(importedMetrics.clicks || 0);
        const spend = Number(importedMetrics.spend || 0);
        const sales = Math.round(Number(importedMetrics.purchase || 0));
        const cpc = clicks > 0 ? (spend / clicks) : 0;
        const cpa = sales > 0 ? (spend / sales) : 0;

        // Compute addToCart from rate if no count column exists
        let addToCartCount = Math.round(Number(importedMetrics.addToCart || 0));
        const viewContentCount = Math.round(Number(importedMetrics.viewContent || 0));
        if (addToCartCount === 0 && importedMetrics.atcRate > 0 && viewContentCount > 0) {
            addToCartCount = Math.round(viewContentCount * importedMetrics.atcRate / 100);
        }

        // Compute checkout from rate if count is 0 but we have addToCart and checkoutRate
        let checkoutCount = Math.round(Number(importedMetrics.checkout || 0));
        if (checkoutCount === 0 && importedMetrics.checkoutRate > 0 && addToCartCount > 0) {
            checkoutCount = Math.round(addToCartCount * importedMetrics.checkoutRate / 100);
        }

        const payload = {
            id: existing ? existing.id : generateId('dia'),
            date,
            periodStart: date,
            periodEnd: date,
            productId,
            storeId,
            budget: parseFloat(spend.toFixed(2)),
            budgetCurrency: spendCurrency,
            sales,
            revenue: parseFloat(Number(importedMetrics.purchaseValue || 0).toFixed(2)),
            revenueCurrency: spendCurrency,
            cpa: parseFloat(cpa.toFixed(2)),
            cpc: parseFloat(cpc.toFixed(2)),
            platform: 'Meta Ads',
            notes: `Importado automaticamente via ${sourceLabel} (diagnóstico por período)`,
            productHistory: existing ? (existing.productHistory || '') : '',
            impressions: Math.round(Number(importedMetrics.impressions || 0)),
            pageViews: viewContentCount,
            addToCart: addToCartCount,
            checkout: checkoutCount
        };

        // Auto-assign test info if there's an active test for this product covering this date
        if (!existing || !existing.isTest) {
            const activeTest = AppState.allDiary.find(d =>
                d.isTest === true &&
                d.productId === productId &&
                (!d.testValidation || d.testValidation === 'pendente' || d.testValidation === '') &&
                d.date && d.testEndDate &&
                date >= d.date && date <= d.testEndDate &&
                d.id !== payload.id
            );
            if (activeTest) {
                payload.isTest = true;
                payload.notes = activeTest.notes || payload.notes;
                payload.testEndDate = activeTest.testEndDate;
                payload.testGoal = activeTest.testGoal || '';
                payload.testValidation = 'pendente';
            }
        }

        if (existing) {
            Object.assign(existing, payload);
            // Persist locally first so a Sheets error doesn't lose the data
            if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
            if (AppState.sheetsConnected) {
                try {
                    await SheetsAPI.updateRowById(SheetsAPI.TABS.DIARY, payload.id, SheetsAPI.diaryToRow(payload));
                } catch (sheetsErr) {
                    console.warn('[Diary] Sheets update falhou (entrada salva localmente):', sheetsErr);
                }
            }
            return 'updated';
        }

        AppState.allDiary.push(payload);
        // Persist locally first so a Sheets error doesn't lose the data
        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        if (AppState.sheetsConnected) {
            try {
                await SheetsAPI.appendRow(SheetsAPI.TABS.DIARY, SheetsAPI.diaryToRow(payload));
            } catch (sheetsErr) {
                console.warn('[Diary] Sheets append falhou (entrada salva localmente):', sheetsErr);
            }
        }
        return 'created';
    },

    async _importFacebookPeriodByDay(dataRows, headerMap, sourceLabel, groupedRows = null) {
        const grouped = groupedRows || this._groupDailyRows(dataRows, headerMap);
        if (!grouped || grouped.size <= 1) return false;

        const productId = this.state.productId;
        const storeId = getWritableStoreId(productId);
        if (!storeId) {
            showToast('Selecione uma loja específica para importar o período no diário.', 'error');
            return true;
        }

        const dates = Array.from(grouped.keys()).sort();
        const dailyMetricsByDate = {};
        let created = 0;
        let updated = 0;

        for (const date of dates) {
            const dayRows = grouped.get(date) || [];
            if (dayRows.length === 0) continue;
            const metrics = this._pickBestDailyRow(dayRows, headerMap);
            if (!metrics) continue;

            dailyMetricsByDate[date] = metrics;
            try {
                const status = await this._upsertDiaryEntryFromImportedDay(productId, storeId, date, metrics, sourceLabel);
                if (status === 'created') created++;
                if (status === 'updated') updated++;
            } catch (dayErr) {
                console.warn(`[Import] Erro ao processar dia ${date}:`, dayErr);
            }
        }

        // ── Create campaign/ad sub-entries from ad-level rows ──
        const campaignNameIdx = this._findHeaderIndex(headerMap, ['nome da campanha', 'campaign name']);
        const adNameIdx = this._findHeaderIndex(headerMap, ['nome do anuncio', 'ad name', 'nome do anuncio']);
        const levelIdx = this._findHeaderIndex(headerMap, ['nivel de veiculacao', 'delivery level', 'nivel de veiculacao']);

        console.log('[Import] Campaign columns: campaignIdx=' + campaignNameIdx + ' adIdx=' + adNameIdx + ' levelIdx=' + levelIdx);
        console.log('[Import] HeaderMap keys:', Object.keys(headerMap).join(', '));

        if (adNameIdx >= 0) {
            // First pass: aggregate ad rows by date+campaign+adName
            const adAggregates = {};  // key = "date|campaign|adName" → aggregated metrics
            let totalAdRows = 0;

            for (const date of dates) {
                const dayRows = grouped.get(date) || [];
                for (const row of dayRows) {
                    const levelVal = levelIdx >= 0 ? this._normalizeCsvKey(row?.[levelIdx] || '') : '';
                    const adNameVal = String(row?.[adNameIdx] || '').trim();
                    const campaignVal = campaignNameIdx >= 0 ? String(row?.[campaignNameIdx] || '').trim() : '';

                    // Skip summary rows (ad="All") and non-ad level rows
                    if (levelIdx >= 0 && levelVal !== 'ad') continue;
                    if (!adNameVal || adNameVal.toLowerCase() === 'all') continue;

                    const metrics = this._extractCsvMetricsFromRow(row, headerMap);
                    if (!metrics) continue;
                    totalAdRows++;

                    const key = `${date}|${campaignVal}|${adNameVal}`;
                    if (!adAggregates[key]) {
                        adAggregates[key] = { date, campaignVal, adNameVal, spend: 0, purchase: 0, purchaseValue: 0, impressions: 0, viewContent: 0, addToCart: 0, checkout: 0, clicks: 0, valueCurrency: metrics.valueCurrency || 'BRL' };
                    }
                    const agg = adAggregates[key];
                    agg.spend += Number(metrics.spend || 0);
                    agg.purchase += Number(metrics.purchase || 0);
                    agg.purchaseValue += Number(metrics.purchaseValue || 0);
                    agg.impressions += Number(metrics.impressions || 0);
                    agg.viewContent += Number(metrics.viewContent || 0);
                    agg.addToCart += Number(metrics.addToCart || 0);
                    agg.checkout += Number(metrics.checkout || 0);
                    agg.clicks += Number(metrics.clicks || 0);
                }
            }

            console.log('[Import] Found ' + totalAdRows + ' ad-level rows, aggregated into ' + Object.keys(adAggregates).length + ' entries');

            // Second pass: create sub-entries from aggregated data
            let campaignCreated = 0;
            for (const [key, agg] of Object.entries(adAggregates)) {
                const parentEntry = AppState.allDiary.find(d => d.date === agg.date && d.productId === productId && !d.isCampaign);
                if (!parentEntry) continue;

                const subEntry = {
                    id: generateId('camp'),
                    parentId: parentEntry.id,
                    date: agg.date,
                    periodStart: agg.date,
                    periodEnd: agg.date,
                    productId: productId,
                    storeId: storeId,
                    campaignName: agg.campaignVal,
                    adName: agg.adNameVal,
                    isCampaign: true,
                    budget: parseFloat(agg.spend.toFixed(2)),
                    budgetCurrency: agg.valueCurrency,
                    sales: Math.round(agg.purchase),
                    revenue: parseFloat(agg.purchaseValue.toFixed(2)),
                    revenueCurrency: agg.valueCurrency,
                    impressions: Math.round(agg.impressions),
                    pageViews: Math.round(agg.viewContent),
                    addToCart: Math.round(agg.addToCart),
                    checkout: Math.round(agg.checkout),
                    cpc: agg.clicks > 0 ? parseFloat((agg.spend / agg.clicks).toFixed(2)) : 0,
                    cpa: agg.purchase > 0 ? parseFloat((agg.spend / agg.purchase).toFixed(2)) : 0,
                    platform: 'Meta Ads',
                    notes: '',
                    isTest: false, testEndDate: '', testValidation: '', testGoal: '', creativeId: '',
                };

                // Dedup: check if entry for same parent+ad+campaign+date exists
                const existIdx = AppState.allDiary.findIndex(d =>
                    d.parentId === parentEntry.id && d.adName === agg.adNameVal && d.campaignName === agg.campaignVal && d.date === agg.date
                );
                if (existIdx >= 0) {
                    subEntry.id = AppState.allDiary[existIdx].id;
                    Object.assign(AppState.allDiary[existIdx], subEntry);
                } else {
                    AppState.allDiary.push(subEntry);
                    campaignCreated++;
                }

                // Auto-create creative
                this._autoCreateCreative(agg.adNameVal, agg.campaignVal, productId, storeId);
            }

            console.log('[Import] Created ' + campaignCreated + ' campaign sub-entries');
            if (campaignCreated > 0) {
                showToast(`${campaignCreated} entradas de anúncio criadas`, 'info');
            }
        } else {
            console.warn('[Import] adNameIdx not found — campaign sub-entries NOT created');
        }

        const importedDates = Object.keys(dailyMetricsByDate).sort();
        if (importedDates.length === 0) return false;

        const aggregated = this._aggregateImportedMetricsByDay(dailyMetricsByDate);
        if (!aggregated) return false;

        const importedStart = importedDates[0];
        const importedEnd = importedDates[importedDates.length - 1];
        const overall = this._inferReportOverallRange(dataRows, headerMap);
        const expectedDays = overall ? this._daysBetweenInclusive(overall.startDate, overall.endDate) : importedDates.length;
        const ignoredDays = Math.max(0, expectedDays - importedDates.length);

        let snapshots = this._saveImportedDaySnapshots(productId, dailyMetricsByDate);
        snapshots = this._saveImportedRangeSnapshot(productId, importedStart, importedEnd, aggregated, snapshots);
        this._saveSnapshots(snapshots);

        const startInput = document.getElementById('funnel-date-start');
        const endInput = document.getElementById('funnel-date-end');
        if (startInput) startInput.value = importedStart;
        if (endInput) endInput.value = importedEnd;

        this._applyImportedFunnelData(aggregated, { preserveMissing: true });

        // Update diary period filter to show the imported range
        const diaryPeriodSelect = document.getElementById('diary-period');
        const diaryStartInput = document.getElementById('diary-start');
        const diaryEndInput = document.getElementById('diary-end');
        const diaryCustomRange = document.getElementById('diary-custom-range');
        if (diaryPeriodSelect) {
            diaryPeriodSelect.value = 'custom';
            if (diaryCustomRange) diaryCustomRange.style.display = 'flex';
            if (diaryStartInput) diaryStartInput.value = importedStart;
            if (diaryEndInput) diaryEndInput.value = importedEnd;
        }

        filterDataByStore();
        EventBus.emit('diaryChanged');
        // Force-save diary to localStorage immediately
        if (typeof LocalStore !== 'undefined') {
            LocalStore.save('diary', AppState.allDiary);
        }

        showToast(`${sourceLabel} importado por período: ${importedDates.length} dias (${created} criados, ${updated} atualizados). De ${importedStart} a ${importedEnd}`, 'success');
        if (ignoredDays > 0) showToast(`${ignoredDays} dias ignorados por falta de linha diária explícita.`, 'info');

        const missing = this._listMissingImportedMetrics(aggregated);
        if (missing.length > 0) {
            showToast(`Importação parcial: não encontrei ${missing.join(', ')} neste relatório.`, 'info');
        }
        return true;
    },

    _normalizeImportCoverage(coverage) {
        const keys = [
            'impressions', 'clicks', 'spend', 'viewContent', 'addToCart', 'checkout', 'purchase', 'purchaseValue',
            'ctr', 'viewPageRate', 'atcRate', 'checkoutRate', 'saleRate'
        ];
        const base = Object.fromEntries(keys.map(k => [k, true]));
        if (!coverage || typeof coverage !== 'object') return base;
        keys.forEach(k => {
            if (Object.prototype.hasOwnProperty.call(coverage, k)) {
                base[k] = !!coverage[k];
            }
        });
        return base;
    },

    _listMissingImportedMetrics(imported) {
        const rateColumns = imported?.rateColumns || {};
        const coverage = this._normalizeImportCoverage(imported?.coverage);
        const hasRateColumn = (key) => (
            Object.prototype.hasOwnProperty.call(rateColumns, key)
                ? !!rateColumns[key]
                : !!coverage[key]
        );
        const metricLabels = [
            ['atcRate', 'Taxa de Carrinho'],
            ['checkoutRate', 'Taxa de Checkout'],
            ['saleRate', 'Taxa de Compra']
        ];
        return metricLabels
            .filter(([key]) => !hasRateColumn(key))
            .map(([, label]) => label);
    },

    _applyImportedFunnelData(data, options = {}) {
        const preserveMissing = options.preserveMissing !== false;
        const coverage = this._normalizeImportCoverage(data?.coverage);
        const shouldApply = (key) => !preserveMissing || coverage[key];
        const prevFb = this._lastFBData || {};

        if (shouldApply('impressions')) {
            this.state.actual.impressions = data.impressions || 0;
        }
        const cpcSourceCurrency = data.valueCurrency || this.state.actual.ticketCurrency;
        const importedCpc = (data.clicks || 0) > 0
            ? ((data.spend || 0) / data.clicks)
            : 0;
        if (shouldApply('clicks') && shouldApply('spend')) {
            this.state.actual.cpc = parseFloat(convertCurrency(
                importedCpc,
                cpcSourceCurrency,
                this.state.actual.ticketCurrency
            ).toFixed(2)) || 0;
            this.state.actual.cpcCurrency = this.state.actual.ticketCurrency;
        }
        if (shouldApply('ctr')) {
            this.state.actual.ctr = parseFloat((data.ctr || 0).toFixed(2));
        }
        if (shouldApply('viewPageRate')) {
            this.state.actual.viewPageRate = parseFloat((data.viewPageRate || 0).toFixed(2));
        }
        if (shouldApply('atcRate')) {
            this.state.actual.atcRate = parseFloat((data.atcRate || 0).toFixed(2));
        }
        if (shouldApply('checkoutRate')) {
            this.state.actual.checkoutRate = parseFloat((data.checkoutRate || 0).toFixed(2));
        }
        if (shouldApply('saleRate')) {
            this.state.actual.saleRate = parseFloat((data.saleRate || 0).toFixed(2));
        }

        if (shouldApply('purchaseValue') && shouldApply('purchase') && (data.purchaseValue || 0) > 0 && (data.purchase || 0) > 0) {
            const ticketSource = data.purchaseValue / data.purchase;
            const sourceCurrency = data.valueCurrency || 'USD';
            this.state.actual.ticket = parseFloat(convertCurrency(
                ticketSource,
                sourceCurrency,
                this.state.actual.ticketCurrency
            ).toFixed(2));
        }

        this._lastFBData = {
            impressions: shouldApply('impressions') ? (data.impressions || 0) : (prevFb.impressions || 0),
            clicks: shouldApply('clicks') ? (data.clicks || 0) : (prevFb.clicks || 0),
            spend: shouldApply('spend') ? (data.spend || 0) : (prevFb.spend || 0),
            cpc: this.state.actual.cpc || 0,
            viewContent: shouldApply('viewContent') ? (data.viewContent || 0) : (prevFb.viewContent || 0),
            addToCart: shouldApply('addToCart') ? (data.addToCart || 0) : (prevFb.addToCart || 0),
            checkout: shouldApply('checkout') ? (data.checkout || 0) : (prevFb.checkout || 0),
            purchase: shouldApply('purchase') ? (data.purchase || 0) : (prevFb.purchase || 0),
            purchaseValue: shouldApply('purchaseValue') ? (data.purchaseValue || 0) : (prevFb.purchaseValue || 0),
            ctr: shouldApply('ctr') ? (data.ctr || 0) : (prevFb.ctr || 0),
            viewPageRate: shouldApply('viewPageRate') ? (data.viewPageRate || 0) : (prevFb.viewPageRate || 0),
            atcRate: shouldApply('atcRate') ? (data.atcRate || 0) : (prevFb.atcRate || 0),
            checkoutRate: shouldApply('checkoutRate') ? (data.checkoutRate || 0) : (prevFb.checkoutRate || 0),
            saleRate: shouldApply('saleRate') ? (data.saleRate || 0) : (prevFb.saleRate || 0)
        };

        this.render();
    },

    _parseCsv(text) {
        const clean = text
            .replace(/^\uFEFF/, '')
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n');
        const lines = clean.split('\n').filter(line => line.trim() !== '');
        if (lines.length === 0) return [];

        const first = lines[0];
        const commaCount = (first.match(/,/g) || []).length;
        const semiCount = (first.match(/;/g) || []).length;
        const delimiter = semiCount > commaCount ? ';' : ',';

        return lines.map(line => this._parseCsvLine(line, delimiter));
    },

    _parseCsvLine(line, delimiter) {
        const values = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === delimiter && !inQuotes) {
                values.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        values.push(current.trim());
        return values;
    },

    _normalizeCsvKey(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    },

    _buildCsvHeaderMap(headerRow) {
        const map = {};
        (headerRow || []).forEach((header, idx) => {
            const key = this._normalizeCsvKey(header);
            if (key) map[key] = idx;
        });
        return map;
    },

    _findHeaderRowIndex(rows) {
        const maxScan = Math.min(rows.length, 30);
        for (let i = 0; i < maxScan; i++) {
            const headerMap = this._buildCsvHeaderMap(rows[i] || []);
            const hasImpressions = this._findHeaderIndex(headerMap, ['impressoes']) >= 0;
            const hasCampaign = this._findHeaderIndex(headerMap, ['nome da campanha']) >= 0;
            if (hasImpressions && hasCampaign) {
                return i;
            }
        }
        return -1;
    },

    _findTotalsRow(dataRows, headerMap) {
        const withMetricCount = (row) => {
            const m = this._extractCsvMetricsFromRow(row, headerMap);
            const metricCount = [m.impressions, m.clicks, m.spend, m.viewContent, m.purchase].filter(v => v > 0).length;
            return { m, metricCount };
        };
        const hasAnyData = (row) => (row || []).some(cell => String(cell || '').trim() !== '');

        const byLabel = dataRows.filter(row =>
            (row || []).some(cell => this._normalizeCsvKey(cell).includes('resultados totais'))
        );
        if (byLabel.length > 0) {
            return byLabel[byLabel.length - 1];
        }

        const campaignIdx = this._findHeaderIndex(headerMap, ['nome da campanha']);
        const totalLikeRows = dataRows.filter(row => {
            const campaignName = campaignIdx >= 0 ? this._normalizeCsvKey(row[campaignIdx]) : '';
            const hasTotalHint = !campaignName || campaignName.includes('total') || campaignName.includes('resultado');
            if (!hasTotalHint) return false;
            return withMetricCount(row).metricCount >= 3;
        });
        if (totalLikeRows.length > 0) {
            return totalLikeRows[totalLikeRows.length - 1];
        }

        const fallbackRows = dataRows.filter(row => {
            if (!hasAnyData(row)) return false;
            return withMetricCount(row).metricCount >= 1;
        });
        if (fallbackRows.length > 0) {
            return fallbackRows[fallbackRows.length - 1];
        }
        return null;
    },

    _findHeaderIndex(headerMap, candidates, options = {}) {
        const strict = !!options.strict;
        const keys = Object.keys(headerMap);
        const isLikelyRateSuffix = (suffix) => {
            const s = ` ${suffix} `;
            const hints = [
                ' view page ',
                ' visu pagina ',
                ' visualizacoes da pagina ',
                ' landing page ',
                ' lpv ',
                ' checkout ',
                ' compras ',
                ' carrinho ',
                ' perda de clique ',
                ' ctr ',
                ' roas ',
                ' custo por ',
                ' taxa '
            ];
            return hints.some(h => s.includes(h));
        };
        for (const rawCandidate of candidates) {
            const candidate = this._normalizeCsvKey(rawCandidate);
            const exact = keys.find(k => k === candidate);
            if (exact) return headerMap[exact];
            if (strict) {
                const startsWithCandidate = keys.find(k => {
                    if (!k.startsWith(`${candidate} `)) return false;
                    const suffix = k.slice(candidate.length + 1);
                    return !isLikelyRateSuffix(suffix);
                });
                if (startsWithCandidate) return headerMap[startsWithCandidate];
                continue;
            }
            const fuzzy = keys.find(k => k.includes(candidate) || candidate.includes(k));
            if (fuzzy) return headerMap[fuzzy];
        }
        return -1;
    },

    _pickCsvValue(row, headerMap, candidates, options = {}) {
        const idx = this._findHeaderIndex(headerMap, candidates, options);
        if (idx < 0) return '';
        return row[idx] || '';
    },

    _hasCsvData(row, headerMap, candidates, options = {}) {
        const idx = this._findHeaderIndex(headerMap, candidates, options);
        if (idx < 0) return false;
        const value = row[idx];
        if (value == null) return false;
        const str = String(value).trim();
        return str !== '' && str !== '–' && str !== '-' && str !== '--';
    },

    _toNumber(value) {
        if (value == null) return 0;
        let str = String(value).trim();
        if (!str || str === '–' || str === '-') return 0;
        str = str.replace(/\u00A0/g, '').replace(/\s+/g, '');
        str = str.replace(/[^0-9,.\-]/g, '');
        if (!str) return 0;

        if (str.includes(',') && str.includes('.')) {
            if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
                str = str.replace(/\./g, '').replace(',', '.');
            } else {
                str = str.replace(/,/g, '');
            }
        } else if (str.includes(',')) {
            str = str.replace(',', '.');
        }

        const n = parseFloat(str);
        return isNaN(n) ? 0 : n;
    },

    _normalizeRatePercent(value) {
        const n = this._toNumber(value);
        if (n <= 0) return 0;
        // Facebook CSV sometimes exports rates as ratio (0.77) and sometimes as percent (77.0).
        return n <= 1.5 ? (n * 100) : n;
    },

    _extractCsvMetricsFromRow(row, headerMap) {
        const impressionsCandidates = ['impressoes', 'impressions'];
        const clicksCandidates = ['cliques todos', 'cliques no link', 'link clicks', 'outbound clicks', 'cliques'];
        const spendCandidates = ['valor usado usd', 'valor usado brl', 'valor usado', 'amount spent usd', 'amount spent'];
        const viewContentCandidates = [
            'visualizacoes da pagina de destino do site',
            'visualizacoes da pagina de destino',
            'visualizacoes da pagina',
            'landing page views',
            'view content'
        ];
        const addToCartCandidates = [
            'adicoes ao carrinho',
            'adicoes ao carrinho no site',
            'adicao ao carrinho',
            'adds to cart',
            'add to cart'
        ];
        const checkoutCandidates = [
            'finalizacoes de compra iniciadas',
            'finalizacoes de compra iniciadas no site',
            'checkouts iniciados',
            'initiated checkout'
        ];
        const purchaseCandidates = ['compras no site', 'compras', 'purchases', 'resultados'];
        const purchaseValueCandidates = ['valor de conversao da compra', 'valor de conversao', 'purchase conversion value'];
        const ctrRateCandidates = ['ctr taxa de cliques no link', 'ctr de saida', 'ctr'];
        const viewPageRateCandidates = ['perda de clique', 'view page cliques', 'view page / cliques'];
        const atcRateCandidates = [
            'visu pagina > add to cart',
            'visu pagina add to cart',
            'view page > add to cart',
            'view page add to cart',
            'add to cart / view page',
            'lpv > add to cart',
            'lpv add to cart'
        ];
        const checkoutRateCandidates = [
            'carrinho > checkout',
            'add to cart > checkout',
            'add to cart checkout',
            'checkout / add to cart',
            'atc > ic'
        ];
        const saleRateCandidates = [
            'ic > compras',
            'checkout > compras',
            'venda total / checkout',
            'purchase / checkout'
        ];

        const impressions = this._toNumber(this._pickCsvValue(row, headerMap, impressionsCandidates));
        const clicks = this._toNumber(this._pickCsvValue(row, headerMap, clicksCandidates));
        const spend = this._toNumber(this._pickCsvValue(row, headerMap, spendCandidates));
        const viewContent = this._toNumber(this._pickCsvValue(row, headerMap, viewContentCandidates));
        // Count columns are parsed in strict mode to avoid matching custom ratio metrics
        // such as "Visu. Página > Add To Cart".
        const addToCart = this._toNumber(this._pickCsvValue(row, headerMap, addToCartCandidates, { strict: true }));
        const checkout = this._toNumber(this._pickCsvValue(row, headerMap, checkoutCandidates));
        const purchase = this._toNumber(this._pickCsvValue(row, headerMap, purchaseCandidates));
        const purchaseValue = this._toNumber(this._pickCsvValue(row, headerMap, purchaseValueCandidates));

        const ctrRaw = this._normalizeRatePercent(this._pickCsvValue(row, headerMap, ctrRateCandidates));
        const viewPageRateRaw = this._normalizeRatePercent(this._pickCsvValue(row, headerMap, viewPageRateCandidates));
        const atcRateRaw = this._normalizeRatePercent(this._pickCsvValue(row, headerMap, atcRateCandidates));
        const checkoutRateRaw = this._normalizeRatePercent(this._pickCsvValue(row, headerMap, checkoutRateCandidates));
        const saleRateRaw = this._normalizeRatePercent(this._pickCsvValue(row, headerMap, saleRateCandidates));

        const hasImpressions = this._hasCsvData(row, headerMap, impressionsCandidates);
        const hasClicks = this._hasCsvData(row, headerMap, clicksCandidates);
        const hasSpend = this._hasCsvData(row, headerMap, spendCandidates);
        const hasViewContent = this._hasCsvData(row, headerMap, viewContentCandidates);
        const hasAddToCart = this._hasCsvData(row, headerMap, addToCartCandidates, { strict: true });
        const hasCheckout = this._hasCsvData(row, headerMap, checkoutCandidates);
        const hasPurchase = this._hasCsvData(row, headerMap, purchaseCandidates);
        const hasPurchaseValue = this._hasCsvData(row, headerMap, purchaseValueCandidates);
        const hasCtrRate = this._hasCsvData(row, headerMap, ctrRateCandidates);
        const hasViewPageRate = this._hasCsvData(row, headerMap, viewPageRateCandidates);
        const hasAtcRate = this._hasCsvData(row, headerMap, atcRateCandidates);
        const hasCheckoutRate = this._hasCsvData(row, headerMap, checkoutRateCandidates);
        const hasSaleRate = this._hasCsvData(row, headerMap, saleRateCandidates);

        const ctrCalc = impressions > 0 && clicks > 0 ? (clicks / impressions) * 100 : 0;
        const ctr = hasCtrRate ? ctrRaw : ctrCalc;

        const viewPageRateCalc = clicks > 0 && viewContent > 0 ? (viewContent / clicks) * 100 : 0;
        const viewPageRate = hasViewPageRate
            ? viewPageRateRaw
            : viewPageRateCalc;

        const atcRateCalc = viewContent > 0 && addToCart > 0 ? (addToCart / viewContent) * 100 : 0;
        const atcRate = hasAtcRate
            ? atcRateRaw
            : atcRateCalc;

        const checkoutRateCalc = addToCart > 0 && checkout > 0 ? (checkout / addToCart) * 100 : 0;
        const checkoutRate = hasCheckoutRate
            ? checkoutRateRaw
            : checkoutRateCalc;

        const saleRateCalc = checkout > 0 && purchase > 0 ? (purchase / checkout) * 100 : 0;
        const saleRate = hasSaleRate
            ? saleRateRaw
            : saleRateCalc;

        const spendHeaderIdx = this._findHeaderIndex(headerMap, ['valor usado usd', 'amount spent usd', 'valor usado']);
        const spendHeader = spendHeaderIdx >= 0
            ? this._normalizeCsvKey(Object.keys(headerMap).find(k => headerMap[k] === spendHeaderIdx) || '')
            : '';
        const valueCurrency = spendHeader.includes('usd') ? 'USD'
            : spendHeader.includes('brl') ? 'BRL'
            : (this.state.actual.ticketCurrency || 'BRL');

        return {
            impressions: Math.round(impressions),
            clicks: Math.round(clicks),
            spend: parseFloat(spend.toFixed(2)),
            viewContent: Math.round(viewContent),
            addToCart: Math.round(addToCart),
            checkout: Math.round(checkout),
            purchase: Math.round(purchase),
            purchaseValue: parseFloat(purchaseValue.toFixed(2)),
            ctr: parseFloat((ctr || 0).toFixed(4)),
            viewPageRate: parseFloat((viewPageRate || 0).toFixed(4)),
            atcRate: parseFloat((atcRate || 0).toFixed(4)),
            checkoutRate: parseFloat((checkoutRate || 0).toFixed(4)),
            saleRate: parseFloat((saleRate || 0).toFixed(4)),
            valueCurrency,
            rateColumns: {
                ctr: hasCtrRate,
                viewPageRate: hasViewPageRate,
                atcRate: hasAtcRate,
                checkoutRate: hasCheckoutRate,
                saleRate: hasSaleRate
            },
            coverage: {
                impressions: hasImpressions,
                clicks: hasClicks,
                spend: hasSpend,
                viewContent: hasViewContent,
                addToCart: hasAddToCart,
                checkout: hasCheckout,
                purchase: hasPurchase,
                purchaseValue: hasPurchaseValue,
                ctr: (hasImpressions && hasClicks) || hasCtrRate,
                viewPageRate: (hasClicks && hasViewContent) || hasViewPageRate,
                atcRate: (hasViewContent && hasAddToCart) || hasAtcRate,
                checkoutRate: (hasAddToCart && hasCheckout) || hasCheckoutRate,
                saleRate: (hasCheckout && hasPurchase) || hasSaleRate
            }
        };
    },

    _aggregateCsvMetrics(rows, headerMap) {
        const totals = {
            impressions: 0,
            clicks: 0,
            spend: 0,
            viewContent: 0,
            addToCart: 0,
            checkout: 0,
            purchase: 0,
            purchaseValue: 0,
            ctrWeightedSum: 0,
            ctrWeight: 0,
            viewPageRateWeightedSum: 0,
            viewPageRateWeight: 0,
            atcRateWeightedSum: 0,
            atcRateWeight: 0,
            checkoutRateWeightedSum: 0,
            checkoutRateWeight: 0,
            saleRateWeightedSum: 0,
            saleRateWeight: 0,
            valueCurrency: this.state.actual.ticketCurrency || 'BRL',
            rateColumns: {
                ctr: false,
                viewPageRate: false,
                atcRate: false,
                checkoutRate: false,
                saleRate: false
            },
            coverage: {
                impressions: false,
                clicks: false,
                spend: false,
                viewContent: false,
                addToCart: false,
                checkout: false,
                purchase: false,
                purchaseValue: false,
                ctr: false,
                viewPageRate: false,
                atcRate: false,
                checkoutRate: false,
                saleRate: false
            }
        };

        rows.forEach(row => {
            const m = this._extractCsvMetricsFromRow(row, headerMap);
            totals.impressions += m.impressions;
            totals.clicks += m.clicks;
            totals.spend += m.spend;
            totals.viewContent += m.viewContent;
            totals.addToCart += m.addToCart;
            totals.checkout += m.checkout;
            totals.purchase += m.purchase;
            totals.purchaseValue += m.purchaseValue;
            {
                const denominator = m.impressions > 0 ? m.impressions : 0;
                if (m.rateColumns?.ctr) {
                    const weight = denominator > 0 ? denominator : 1;
                    totals.ctrWeightedSum += (m.ctr * weight);
                    totals.ctrWeight += weight;
                } else if (denominator > 0) {
                    totals.ctrWeight += denominator;
                }
            }
            {
                const denominator = m.clicks > 0 ? m.clicks : 0;
                if (m.rateColumns?.viewPageRate) {
                    const weight = denominator > 0 ? denominator : 1;
                    totals.viewPageRateWeightedSum += (m.viewPageRate * weight);
                    totals.viewPageRateWeight += weight;
                } else if (denominator > 0) {
                    totals.viewPageRateWeight += denominator;
                }
            }
            {
                const denominator = m.viewContent > 0 ? m.viewContent : 0;
                if (m.rateColumns?.atcRate) {
                    const weight = denominator > 0 ? denominator : 1;
                    totals.atcRateWeightedSum += (m.atcRate * weight);
                    totals.atcRateWeight += weight;
                } else if (denominator > 0) {
                    totals.atcRateWeight += denominator;
                }
            }
            {
                const addToCartFromCount = m.addToCart > 0 ? m.addToCart : 0;
                const addToCartFromRates = m.viewContent > 0
                    ? (m.viewContent * (m.atcRate || 0)) / 100
                    : 0;
                const denominator = addToCartFromCount > 0
                    ? addToCartFromCount
                    : addToCartFromRates;
                if (m.rateColumns?.checkoutRate) {
                    const weight = denominator > 0 ? denominator : (m.checkout > 0 ? m.checkout : 1);
                    totals.checkoutRateWeightedSum += (m.checkoutRate * weight);
                    totals.checkoutRateWeight += weight;
                } else if (denominator > 0) {
                    totals.checkoutRateWeight += denominator;
                }
            }
            {
                const denominator = m.checkout > 0 ? m.checkout : 0;
                if (m.rateColumns?.saleRate) {
                    const weight = denominator > 0 ? denominator : 1;
                    totals.saleRateWeightedSum += (m.saleRate * weight);
                    totals.saleRateWeight += weight;
                } else if (denominator > 0) {
                    // campanha sem % explícito, mas com checkout: entra como 0% na média
                    totals.saleRateWeight += denominator;
                }
            }
            Object.keys(totals.coverage).forEach(key => {
                totals.coverage[key] = totals.coverage[key] || !!m.coverage?.[key];
            });
            Object.keys(totals.rateColumns).forEach(key => {
                totals.rateColumns[key] = totals.rateColumns[key] || !!m.rateColumns?.[key];
            });
            if (m.valueCurrency === 'USD') totals.valueCurrency = 'USD';
        });

        const ctrFromCount = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
        const ctrFromRate = totals.ctrWeight > 0 ? (totals.ctrWeightedSum / totals.ctrWeight) : 0;
        const viewPageRateFromCount = totals.clicks > 0 ? (totals.viewContent / totals.clicks) * 100 : 0;
        const viewPageRateFromRate = totals.viewPageRateWeight > 0
            ? (totals.viewPageRateWeightedSum / totals.viewPageRateWeight)
            : 0;
        const atcRateFromCount = totals.viewContent > 0 ? (totals.addToCart / totals.viewContent) * 100 : 0;
        const atcRateFromRate = totals.atcRateWeight > 0
            ? (totals.atcRateWeightedSum / totals.atcRateWeight)
            : 0;
        const checkoutRateFromCount = totals.addToCart > 0 ? (totals.checkout / totals.addToCart) * 100 : 0;
        const checkoutRateFromRate = totals.checkoutRateWeight > 0
            ? (totals.checkoutRateWeightedSum / totals.checkoutRateWeight)
            : 0;
        const saleRateFromCount = totals.checkout > 0 ? (totals.purchase / totals.checkout) * 100 : 0;
        const saleRateFromRate = totals.saleRateWeight > 0
            ? (totals.saleRateWeightedSum / totals.saleRateWeight)
            : 0;

        const ctr = (totals.rateColumns.ctr && totals.ctrWeight > 0)
            ? ctrFromRate
            : (totals.impressions > 0 ? ctrFromCount : ctrFromRate);
        const viewPageRate = (totals.rateColumns.viewPageRate && totals.viewPageRateWeight > 0)
            ? viewPageRateFromRate
            : (totals.clicks > 0 ? viewPageRateFromCount : viewPageRateFromRate);
        const atcRate = (totals.rateColumns.atcRate && totals.atcRateWeight > 0)
            ? atcRateFromRate
            : (totals.viewContent > 0 ? atcRateFromCount : atcRateFromRate);
        const checkoutRate = (totals.rateColumns.checkoutRate && totals.checkoutRateWeight > 0)
            ? checkoutRateFromRate
            : (totals.addToCart > 0 ? checkoutRateFromCount : checkoutRateFromRate);
        const saleRate = (totals.rateColumns.saleRate && totals.saleRateWeight > 0)
            ? saleRateFromRate
            : (totals.checkout > 0 ? saleRateFromCount : saleRateFromRate);

        return {
            ...totals,
            ctr: parseFloat(ctr.toFixed(4)),
            viewPageRate: parseFloat(viewPageRate.toFixed(4)),
            atcRate: parseFloat(atcRate.toFixed(4)),
            checkoutRate: parseFloat(checkoutRate.toFixed(4)),
            saleRate: parseFloat(saleRate.toFixed(4))
        };
    },

    _getSelectedDateRange() {
        const preset = document.getElementById('fb-date-range').value;
        const today = todayISO();
        const d = new Date();
        switch (preset) {
            case 'yesterday':
                d.setDate(d.getDate() - 1);
                return { since: d.toISOString().split('T')[0], until: d.toISOString().split('T')[0] };
            case 'last_3d':
                d.setDate(d.getDate() - 2);
                return { since: d.toISOString().split('T')[0], until: today };
            case 'last_7d':
                d.setDate(d.getDate() - 6);
                return { since: d.toISOString().split('T')[0], until: today };
            case 'last_30d':
                d.setDate(d.getDate() - 29);
                return { since: d.toISOString().split('T')[0], until: today };
            case 'custom': {
                const { startDate, endDate } = this.getSelectedPeriod();
                return { since: startDate, until: endDate };
            }
            default:
                return { since: today, until: today };
        }
    },

    // ---- Save to Diary ----
    async saveToDiary() {
        const productId = this.state.productId;
        if (!productId) {
            showToast('Selecione um produto primeiro', 'error');
            return;
        }

        const a = this.state.actual;
        const real = this.getRealizadoResults();
        const { startDate, endDate } = this.getSelectedPeriod();
        const selectedDate = endDate;
        const isRange = startDate !== endDate;

        const existing = AppState.allDiary.find(d => {
            if (d.productId !== productId) return false;
            const period = this._getDiaryEntryPeriod(d);
            return period.startDate === startDate && period.endDate === endDate;
        });
        const storeId = existing?.storeId || getWritableStoreId(productId);
        if (!storeId) {
            showToast('Selecione uma loja específica para salvar no diário.', 'error');
            return;
        }

        const fb = this._lastFBData;
        const data = {
            id: existing ? existing.id : generateId('dia'),
            date: selectedDate,
            periodStart: startDate,
            periodEnd: endDate,
            productId: productId,
            storeId: storeId,
            budget: fb ? fb.spend : (existing ? existing.budget : 0),
            budgetCurrency: fb ? 'USD' : (existing ? existing.budgetCurrency : (a.cpcCurrency || 'BRL')),
            sales: Math.round(real.sales),
            revenue: parseFloat(real.faturamento.toFixed(2)),
            revenueCurrency: this.state.actual.ticketCurrency,
            cpa: fb && real.sales > 0
                ? parseFloat((fb.spend / real.sales).toFixed(2))
                : (existing ? existing.cpa : 0),
            cpc: fb && fb.clicks > 0
                ? parseFloat((fb.spend / fb.clicks).toFixed(2))
                : (a.cpc > 0 ? parseFloat(a.cpc.toFixed(2)) : (existing ? existing.cpc : 0)),
            platform: fb ? 'Meta Ads' : (existing ? existing.platform : ''),
            notes: existing
                ? existing.notes
                : (fb ? 'Via Facebook Ads + Diagnóstico' : 'Via Diagnóstico de Conversão'),
            productHistory: existing ? (existing.productHistory || '') : '',
            impressions: a.impressions,
            pageViews: Math.round(real.pageViews),
            addToCart: Math.round(real.addToCart),
            checkout: Math.round(real.checkout)
        };

        data.notes = this._stripRangeNote(data.notes);
        if (isRange) {
            const rangeNote = `Período do diagnóstico: ${formatDate(startDate)} até ${formatDate(endDate)}`;
            data.notes = data.notes ? `${data.notes} | ${rangeNote}` : rangeNote;
        }

        if (existing) {
            Object.assign(existing, data);
            if (AppState.sheetsConnected) {
                await SheetsAPI.updateRowById(SheetsAPI.TABS.DIARY, data.id, SheetsAPI.diaryToRow(data));
            }
            showToast('Entrada do diário atualizada!', 'success');
        } else {
            AppState.allDiary.push(data);
            if (AppState.sheetsConnected) {
                await SheetsAPI.appendRow(SheetsAPI.TABS.DIARY, SheetsAPI.diaryToRow(data));
            }
            showToast('Dados salvos no diário!', 'success');
        }

        filterDataByStore();
        this.saveDiagnosisSnapshot(false);
        EventBus.emit('diaryChanged');
    },

    _shiftPeriod(direction) {
        const { startDate, endDate } = this.getSelectedPeriod();
        const days = daysBetween(startDate, endDate);
        const startD = new Date(startDate + 'T00:00:00');
        const endD = new Date(endDate + 'T00:00:00');

        startD.setDate(startD.getDate() + (direction * days));
        endD.setDate(endD.getDate() + (direction * days));

        document.getElementById('funnel-date-start').value = startD.toISOString().split('T')[0];
        document.getElementById('funnel-date-end').value = endD.toISOString().split('T')[0];

        this._clearActivePreset();
        this.onPeriodChange();
    },

    _applyPreset(preset) {
        const today = todayISO();
        const d = new Date();
        let start, end;

        switch (preset) {
            case 'today':
                start = end = today;
                break;
            case 'yesterday':
                d.setDate(d.getDate() - 1);
                start = end = d.toISOString().split('T')[0];
                break;
            case 'last7':
                d.setDate(d.getDate() - 6);
                start = d.toISOString().split('T')[0];
                end = today;
                break;
            case 'last14':
                d.setDate(d.getDate() - 13);
                start = d.toISOString().split('T')[0];
                end = today;
                break;
            case 'last30':
                d.setDate(d.getDate() - 29);
                start = d.toISOString().split('T')[0];
                end = today;
                break;
        }

        document.getElementById('funnel-date-start').value = start;
        document.getElementById('funnel-date-end').value = end;

        document.querySelectorAll('.date-preset-btn').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-preset="${preset}"]`)?.classList.add('active');

        this.onPeriodChange();
    },

    _clearActivePreset() {
        document.querySelectorAll('.date-preset-btn').forEach(b => b.classList.remove('active'));
    },

    // ===========================
    //  COMPARE PERIODS
    // ===========================

    _toggleCompareMode() {
        this._compareMode = !this._compareMode;
        const panel = document.getElementById('compare-period-panel');
        const results = document.getElementById('compare-results');
        const btn = document.getElementById('btn-compare-toggle');

        if (this._compareMode) {
            panel.style.display = '';
            btn.classList.add('btn-compare-active');
            // Default Period B to yesterday
            this._applyComparePreset('yesterday');
        } else {
            panel.style.display = 'none';
            results.style.display = 'none';
            btn.classList.remove('btn-compare-active');
            this._compareState = null;
        }
    },

    _getComparePeriod() {
        const startInput = document.getElementById('compare-date-start');
        const endInput = document.getElementById('compare-date-end');
        const today = todayISO();

        let startDate = (startInput?.value || '').trim() || today;
        let endDate = (endInput?.value || '').trim() || startDate;

        if (startDate > endDate) {
            [startDate, endDate] = [endDate, startDate];
        }

        if (startInput) startInput.value = startDate;
        if (endInput) endInput.value = endDate;

        return { startDate, endDate };
    },

    _getComparePeriodLabel() {
        const { startDate, endDate } = this._getComparePeriod();
        if (startDate === endDate) return formatDate(startDate);
        return `${formatDate(startDate)} até ${formatDate(endDate)}`;
    },

    _onComparePeriodChange() {
        document.querySelectorAll('.date-preset-btn-b').forEach(b => b.classList.remove('active'));
        this._loadCompareData();
    },

    _shiftComparePeriod(direction) {
        const { startDate, endDate } = this._getComparePeriod();
        const days = daysBetween(startDate, endDate);
        const startD = new Date(startDate + 'T00:00:00');
        const endD = new Date(endDate + 'T00:00:00');

        startD.setDate(startD.getDate() + (direction * days));
        endD.setDate(endD.getDate() + (direction * days));

        document.getElementById('compare-date-start').value = startD.toISOString().split('T')[0];
        document.getElementById('compare-date-end').value = endD.toISOString().split('T')[0];

        document.querySelectorAll('.date-preset-btn-b').forEach(b => b.classList.remove('active'));
        this._loadCompareData();
    },

    _applyComparePreset(preset) {
        const today = todayISO();
        const d = new Date();
        let start, end;

        switch (preset) {
            case 'today':
                start = end = today;
                break;
            case 'yesterday':
                d.setDate(d.getDate() - 1);
                start = end = d.toISOString().split('T')[0];
                break;
            case 'last7':
                d.setDate(d.getDate() - 6);
                start = d.toISOString().split('T')[0];
                end = today;
                break;
            case 'last14':
                d.setDate(d.getDate() - 13);
                start = d.toISOString().split('T')[0];
                end = today;
                break;
            case 'last30':
                d.setDate(d.getDate() - 29);
                start = d.toISOString().split('T')[0];
                end = today;
                break;
        }

        document.getElementById('compare-date-start').value = start;
        document.getElementById('compare-date-end').value = end;

        document.querySelectorAll('.date-preset-btn-b').forEach(b => b.classList.remove('active'));
        document.querySelector(`[data-preset-b="${preset}"]`)?.classList.add('active');

        this._loadCompareData();
    },

    _loadCompareData() {
        const productId = this.state.productId;
        if (!productId) {
            this._compareState = null;
            this._renderComparison();
            return;
        }

        const { startDate, endDate } = this._getComparePeriod();
        if (!startDate || !endDate) return;

        // Build a temporary state to hydrate
        const tempActual = {
            cpc: 0, cpcCurrency: this.state.actual.ticketCurrency,
            ctr: 0, viewPageRate: 0, atcRate: 0, checkoutRate: 0, saleRate: 0,
            impressions: 0, ticket: this.state.actual.ticket,
            ticketCurrency: this.state.actual.ticketCurrency
        };

        // Try snapshot first
        const allSnapshots = this._loadSnapshots();
        const key = this._buildSnapshotKey(productId, startDate, endDate);
        const snapshot = allSnapshots[key];

        if (snapshot) {
            Object.assign(tempActual, snapshot.actual || {});
            this._compareState = tempActual;
            this._renderComparison();
            return;
        }

        // Try diary entries
        const exactEntries = AppState.diary
            .filter(d => {
                if (d.productId !== productId) return false;
                const period = this._getDiaryEntryPeriod(d);
                return period.startDate === startDate && period.endDate === endDate;
            });

        let entries = exactEntries;
        if (entries.length === 0) {
            entries = AppState.diary
                .filter(d => {
                    if (d.productId !== productId) return false;
                    const period = this._getDiaryEntryPeriod(d);
                    if (!period.startDate || !period.endDate) return false;
                    const entryDate = String(d.date || '').trim();
                    return (period.startDate >= startDate && period.endDate <= endDate) ||
                           (entryDate >= startDate && entryDate <= endDate);
                });
        }

        if (entries.length > 0) {
            // Aggregate entries into tempActual
            let impressions = 0, clicks = 0, pageViews = 0, addToCart = 0, checkout = 0, sales = 0;
            let totalBudget = 0, totalRevenue = 0;
            const tgtCurrency = tempActual.ticketCurrency;

            entries.forEach(entry => {
                impressions += Number(entry.impressions || 0);
                pageViews += Number(entry.pageViews || 0);
                addToCart += Number(entry.addToCart || 0);
                checkout += Number(entry.checkout || 0);
                sales += Number(entry.sales || 0);
                const budget = Number(entry.budget || 0);
                totalBudget += convertCurrency(budget, entry.budgetCurrency || tgtCurrency, tgtCurrency);
                const revenue = Number(entry.revenue || 0);
                totalRevenue += convertCurrency(revenue, entry.revenueCurrency || tgtCurrency, tgtCurrency);
                if (entry.cpc > 0) clicks += budget / entry.cpc;
            });

            tempActual.impressions = Math.round(impressions);
            tempActual.cpc = clicks > 0 ? parseFloat((totalBudget / clicks).toFixed(2)) : 0;
            tempActual.ctr = impressions > 0 && clicks > 0 ? parseFloat(((clicks / impressions) * 100).toFixed(2)) : 0;
            tempActual.viewPageRate = clicks > 0 && pageViews > 0 ? parseFloat(((pageViews / clicks) * 100).toFixed(2)) : 0;
            tempActual.atcRate = pageViews > 0 ? parseFloat(((addToCart / pageViews) * 100).toFixed(2)) : 0;
            tempActual.checkoutRate = addToCart > 0 ? parseFloat(((checkout / addToCart) * 100).toFixed(2)) : 0;
            tempActual.saleRate = checkout > 0 ? parseFloat(((sales / checkout) * 100).toFixed(2)) : 0;
            tempActual.ticket = sales > 0 ? parseFloat((totalRevenue / sales).toFixed(2)) : tempActual.ticket;

            this._compareState = tempActual;
            this._renderComparison();
            return;
        }

        // No data found
        this._compareState = null;
        this._renderComparison();
    },

    // ===========================
    //  FUNNEL CHART (Daily Breakdown)
    // ===========================
    _funnelChartInstance: null,
    _funnelChartType: 'bar',
    _funnelChartMode: 'faturamento',
    _funnelChartVisibleMetrics: new Set(),

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
            { key: 'viewPageRate', label: 'View Page %',     color: '#06b6d4', compute: (e) => { const cpc = Number(e.cpc||0); const clicks = cpc > 0 ? Number(e.budget||0)/cpc : 0; return clicks > 0 ? (Number(e.pageViews||0)/clicks)*100 : 0; } },
            { key: 'atcRate',      label: 'Add to Cart %',   color: '#f59e0b', compute: (e) => { const pv = Number(e.pageViews||0); return pv > 0 ? (Number(e.addToCart||0)/pv)*100 : 0; } },
            { key: 'checkoutRate', label: 'Checkout %',      color: '#f97316', compute: (e) => { const atc = Number(e.addToCart||0); return atc > 0 ? (Number(e.checkout||0)/atc)*100 : 0; } },
            { key: 'saleRate',     label: 'Venda %',         color: '#10b981', compute: (e) => { const co = Number(e.checkout||0); return co > 0 ? (Number(e.sales||0)/co)*100 : 0; } },
            { key: 'convPage',     label: 'Conv. Página %',  color: '#ec4899', compute: (e) => { const pv = Number(e.pageViews||0); return pv > 0 ? (Number(e.sales||0)/pv)*100 : 0; } },
        ],
        budget: [
            { key: 'budgetVal', label: 'Budget',  color: '#a78bfa', compute: (e) => Number(e.budget || 0) },
            { key: 'cpa',      label: 'CPA',      color: '#ef4444', compute: (e) => { const s = Number(e.sales||0); return s > 0 ? Number(e.budget||0)/s : 0; } },
            { key: 'roas',     label: 'ROAS',     color: '#22c55e', compute: (e) => { const b = Number(e.budget||0); return b > 0 ? Number(e.revenue||0)/b : 0; } },
        ]
    },

    _initFunnelChart() {
        const togglesContainer = document.getElementById('funnel-chart-toggles');
        if (!togglesContainer) return;

        // Toggle metric visibility
        togglesContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.funnel-toggle-btn');
            if (!btn) return;
            const metric = btn.dataset.metric;
            if (this._funnelChartVisibleMetrics.has(metric)) {
                this._funnelChartVisibleMetrics.delete(metric);
                btn.classList.remove('active');
            } else {
                this._funnelChartVisibleMetrics.add(metric);
                btn.classList.add('active');
            }
            this._renderFunnelChart();
        });

        // Chart type toggle (bar / line)
        document.getElementById('funnel-chart-bar-btn')?.addEventListener('click', () => {
            this._funnelChartType = 'bar';
            document.getElementById('funnel-chart-bar-btn').classList.add('active');
            document.getElementById('funnel-chart-line-btn').classList.remove('active');
            this._renderFunnelChart();
        });
        document.getElementById('funnel-chart-line-btn')?.addEventListener('click', () => {
            this._funnelChartType = 'line';
            document.getElementById('funnel-chart-line-btn').classList.add('active');
            document.getElementById('funnel-chart-bar-btn').classList.remove('active');
            this._renderFunnelChart();
        });

        // Metric category selector
        document.getElementById('funnel-chart-metric-select')?.addEventListener('change', (e) => {
            this._funnelChartMode = e.target.value;
            this._rebuildChartToggles();
            this._renderFunnelChart();
        });

        // Init toggles for default mode
        this._rebuildChartToggles();
    },

    _rebuildChartToggles() {
        const container = document.getElementById('funnel-chart-toggles');
        if (!container) return;
        const defs = this._chartMetricDefs[this._funnelChartMode] || [];
        this._funnelChartVisibleMetrics = new Set(defs.map(d => d.key));
        container.innerHTML = defs.map(d =>
            `<button type="button" class="funnel-toggle-btn active" data-metric="${d.key}" style="--toggle-color:${d.color}">${d.label}</button>`
        ).join('');
    },

    _getDailyDataForChart() {
        const productId = this.state.productId;
        const { startDate, endDate } = this.getSelectedPeriod();
        if (!productId || !startDate || !endDate) return { dates: [], entriesByDate: {} };

        // Get diary entries for this product in the period
        const entries = AppState.diary.filter(d => {
            if (d.productId !== productId) return false;
            const entryDate = String(d.date || '').trim();
            return entryDate >= startDate && entryDate <= endDate;
        });

        // Group by date
        const entriesByDate = {};
        entries.forEach(e => {
            const date = String(e.date || '').trim();
            if (!entriesByDate[date]) entriesByDate[date] = [];
            entriesByDate[date].push(e);
        });

        // Generate all dates in range
        const dates = [];
        const d = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');
        while (d <= end) {
            dates.push(d.toISOString().split('T')[0]);
            d.setDate(d.getDate() + 1);
        }

        return { dates, entriesByDate };
    },

    _renderFunnelChart() {
        const canvas = document.getElementById('funnel-chart-canvas');
        if (!canvas) return;

        if (this._funnelChartInstance) {
            this._funnelChartInstance.destroy();
            this._funnelChartInstance = null;
        }

        const { dates, entriesByDate } = this._getDailyDataForChart();
        if (dates.length === 0) return;

        const defs = this._chartMetricDefs[this._funnelChartMode] || [];
        const visibleDefs = defs.filter(d => this._funnelChartVisibleMetrics.has(d.key));
        if (visibleDefs.length === 0) return;

        // Format date labels (DD/MM)
        const labels = dates.map(date => {
            const parts = date.split('-');
            return `${parts[2]}/${parts[1]}`;
        });

        const isBar = this._funnelChartType === 'bar';
        const isStacked = isBar && (this._funnelChartMode === 'faturamento' || this._funnelChartMode === 'funnel');

        // Build datasets
        const datasets = visibleDefs.map(def => {
            const data = dates.map(date => {
                const dayEntries = entriesByDate[date] || [];
                if (dayEntries.length === 0) return 0;
                // Aggregate if multiple entries per day
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

        const isCurrency = this._funnelChartMode === 'faturamento' || this._funnelChartMode === 'budget';
        const isPercent = this._funnelChartMode === 'rates';

        this._funnelChartInstance = new Chart(canvas, {
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
                                if (isCurrency) return `${ctx.dataset.label}: ${this._fmtCurrency(val)}`;
                                if (isPercent) return `${ctx.dataset.label}: ${val.toFixed(2)}%`;
                                if (ctx.dataset.label === 'ROAS') return `ROAS: ${val.toFixed(2)}x`;
                                return `${ctx.dataset.label}: ${this._fmtNum(val)}`;
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
                                if (isCurrency) return this._fmtCurrency(val);
                                if (isPercent) return val.toFixed(1) + '%';
                                return this._fmtNum(val);
                            }
                        }
                    }
                }
            }
        });
    },

    _renderComparison() {
        const container = document.getElementById('compare-results');
        if (!container) return;

        if (!this._compareMode || !this._compareState) {
            container.style.display = 'none';
            container.innerHTML = '';
            if (this._compareMode && !this._compareState && this.state.productId) {
                container.style.display = '';
                container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:1rem;">Sem dados para o Período B selecionado.</p>';
            }
            return;
        }

        const a = this.state.actual;
        const b = this._compareState;
        const realA = this.getRealizadoResults();
        const realB = this.calculateColumn(b.impressions, b.ctr, b.viewPageRate, b.atcRate, b.checkoutRate, b.saleRate, b.ticket);

        const periodALabel = this.getSelectedPeriodLabel();
        const periodBLabel = this._getComparePeriodLabel();

        const deltaCell = (valA, valB, fmt, invertColor) => {
            if (!valB && valB !== 0) return '<td class="compare-delta-neutral">--</td>';
            const diff = valA - valB;
            const pct = valB !== 0 ? ((diff / Math.abs(valB)) * 100) : (valA !== 0 ? 100 : 0);
            let cls = 'compare-delta-neutral';
            let barCls = '';
            if (Math.abs(pct) >= 0.5) {
                const isPositive = invertColor ? diff < 0 : diff > 0;
                cls = isPositive ? 'compare-delta-positive' : 'compare-delta-negative';
                barCls = isPositive ? 'compare-bar-positive' : 'compare-bar-negative';
            }
            const sign = diff > 0 ? '+' : '';
            const barWidth = Math.min(Math.abs(pct), 100) * 0.6;
            const bar = barCls ? `<span class="compare-bar ${barCls}" style="width:${barWidth}px"></span>` : '';
            return `<td class="${cls}">${sign}${pct.toFixed(1)}% ${bar}</td>`;
        };

        const fmtN = (v) => this._fmtNum(v);
        const fmtP = (v) => this._fmtPct(v);
        const fmtC = (v) => this._fmtCurrency(v);

        const row = (label, valA, valB, fmt, invertColor = false) => {
            return `<tr>
                <td>${label}</td>
                <td>${fmt(valA)}</td>
                <td>${fmt(valB)}</td>
                ${deltaCell(valA, valB, fmt, invertColor)}
            </tr>`;
        };

        const sectionRow = (label) => `<tr class="compare-section-header"><td colspan="4">${label}</td></tr>`;

        let html = `<div class="compare-table-wrap">
            <table class="compare-table">
                <thead>
                    <tr>
                        <th>Métrica</th>
                        <th>Período A<br><small style="font-weight:400">${periodALabel}</small></th>
                        <th>Período B<br><small style="font-weight:400">${periodBLabel}</small></th>
                        <th>Variação</th>
                    </tr>
                </thead>
                <tbody>`;

        html += sectionRow('Premissas');
        html += row('CPC ' + this._tooltipHtml('cpc'), a.cpc, b.cpc, fmtC, true);
        html += row('CTR ' + this._tooltipHtml('ctr'), a.ctr, b.ctr, fmtP);
        html += row('Visualização ' + this._tooltipHtml('viewPageRate'), a.viewPageRate, b.viewPageRate, fmtP);
        html += row('Carrinho ' + this._tooltipHtml('atcRate'), a.atcRate, b.atcRate, fmtP);
        html += row('Checkout ' + this._tooltipHtml('checkoutRate'), a.checkoutRate, b.checkoutRate, fmtP);
        html += row('Compra ' + this._tooltipHtml('saleRate'), a.saleRate, b.saleRate, fmtP);

        html += sectionRow('Números');
        html += row('Impressões', a.impressions, b.impressions, fmtN);
        html += row('Cliques', realA.cliques, realB.cliques, fmtN);
        html += row('View Page', realA.pageViews, realB.pageViews, fmtN);
        html += row('Add to Cart', realA.addToCart, realB.addToCart, fmtN);
        html += row('Checkout', realA.checkout, realB.checkout, fmtN);
        html += row('Vendas', realA.sales, realB.sales, fmtN);
        html += row('Conv. Página', this._getPageConversionRate(realA), this._getPageConversionRate(realB), fmtP);

        html += sectionRow('Financeiro');
        html += row('Ticket', a.ticket, b.ticket, fmtC);
        html += row('Faturamento', realA.faturamento, realB.faturamento, fmtC);

        const budgetA = a.cpc * realA.cliques;
        const budgetB = b.cpc * realB.cliques;
        html += row('Gasto (Budget)', budgetA, budgetB, fmtC, true);

        const roasA = budgetA > 0 ? realA.faturamento / budgetA : 0;
        const roasB = budgetB > 0 ? realB.faturamento / budgetB : 0;
        html += row('ROAS', roasA, roasB, (v) => v.toFixed(2) + 'x');

        html += `</tbody></table></div>`;

        container.style.display = '';
        container.innerHTML = html;
    },

    _autoCreateCreative(adName, campaignName, productId, storeId) {
        if (!adName || typeof AppState === 'undefined') return;
        AppState.allCreatives = Array.isArray(AppState.allCreatives) ? AppState.allCreatives : [];

        // Check if creative with this name already exists for this product
        const existing = AppState.allCreatives.find(c =>
            c.name === adName && c.productId === productId
        );
        if (existing) return existing.id;

        const creative = {
            id: generateId('crtv'),
            productId: productId,
            name: adName,
            type: 'Anúncio',
            angle: '',
            hookText: '',
            hookType: '',
            platform: 'Meta Ads',
            status: 'ativo',
            launchDate: todayISO(),
            primaryText: '',
            headline: campaignName || '',
            adDescription: '',
            variations: [],
            storeId: storeId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        AppState.allCreatives.push(creative);
        if (typeof LocalStore !== 'undefined') LocalStore.save('creatives', AppState.allCreatives);
        if (typeof EventBus !== 'undefined') EventBus.emit('creativesChanged');
        return creative.id;
    }
};

document.addEventListener('DOMContentLoaded', () => FunnelModule.init());
