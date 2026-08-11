/* ===========================
   Dashboard.js — Comprehensive Analytics Dashboard
   =========================== */

const DashboardModule = {
    _chartInstance: null,
    _topMode: 'profit',
    // Métrica do Calendário — persiste entre reloads (antes resetava pra 'cpa'
    // toda vez, o que confundia). A chave interna continua a mesma (cpa,
    // cpaReal, conversion, conversionCombined, ...) pra não mexer no cálculo.
    _calMetric: (() => { try { return localStorage.getItem('etracker_cal_metric') || 'cpa'; } catch { return 'cpa'; } })(),
    _calYear: new Date().getFullYear(),
    _calMonth: new Date().getMonth(), // 0-based
    _calProduct: 'todos',
    _calRegion: '',

    // Métricas-base do Calendário. As 3 primeiras têm versão "Real" (Shopify);
    // o resto só tem a estimativa do Facebook. O menu mostra a métrica-base +
    // um toggle Facebook/Real, em vez de 11 abas planas (3 delas duplicadas).
    _METRIC_BASES: [
        { base: 'cpa',        label: 'CPA',       real: 'cpaReal' },
        { base: 'conversion', label: 'Conversão', real: 'conversionCombined' },
        { base: 'sales',      label: 'Vendas',    real: 'salesReal' },
        { base: 'profit',     label: 'Lucro',     real: null },
        { base: 'revenue',    label: 'Receita',   real: null },
        { base: 'budget',     label: 'Gastos',    real: null },
        { base: 'cpm',        label: 'CPM',       real: null },
        { base: 'cpc',        label: 'CPC Médio', real: null },
    ],
    // De uma chave interna (ex.: 'cpaReal') → { baseDef, isReal }.
    _metricBaseReal(key) {
        for (const b of this._METRIC_BASES) {
            if (b.base === key) return { baseDef: b, isReal: false };
            if (b.real === key) return { baseDef: b, isReal: true };
        }
        return { baseDef: this._METRIC_BASES[0], isReal: false };
    },
    _setCalMetric(key) {
        this._calMetric = key;
        try { localStorage.setItem('etracker_cal_metric', key); } catch {}
    },

    // Rankings de funil (checkout/conversão) — dimensão e métrica escolhidas
    _funilDim: 'produto',      // 'produto' | 'regiao'
    _funilMode: 'piorCheckout',
    // Volume mínimo pra entrar num ranking de TAXA: sem isso um produto com
    // 1 ATC e 0 checkout aparece como "0% — pior checkout da loja", que é
    // ruído, não sinal.
    _MIN_ATC_FUNIL: 10,
    _MIN_VIEWS_FUNIL: 50,
    _viewsErro: '',
    _funilLojaPais: null,
    _funilLojaPaisKey: '',

    // Shopify real-sales cache (keyed by "start|end")
    _realSalesMap: null,
    _realSalesPrevMap: null,
    _realSalesCacheKey: '',
    _realSalesPrevCacheKey: '',

    // Shopify product-views cache (DASH-02 — denominador da Conversão Real)
    _viewsMap: null,
    _viewsCacheKey: '',
    // Visitas por PAÍS (denominador da Conversão Real quando um país está
    // selecionado) — cache separado do _viewsMap sem filtro, keyed por
    // "start|end|countryCode".
    _viewsMapPorPais: null,
    _viewsMapPorPaisKey: '',
    // Vendas reais filtradas por país (DASH-02) — cache SEPARADO do
    // _realSalesMap principal, só usado quando um país válido está
    // selecionado, pra nunca contaminar o cache que CPA Real/Vendas
    // Real/Top Produtos esperam sem filtro de país.
    _realSalesMapPorPais: null,
    _realSalesMapPorPaisKey: '',

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
            if (dd.style.display !== 'none') {
                this._initRangeCalendar('dash-date', 'dash-date-start', 'dash-date-end', 'dash-date-apply');
                this._syncRangeCalendar('dash-date');
            }
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
            if (dd.style.display !== 'none') {
                this._initRangeCalendar('dash-compare', 'dash-compare-start', 'dash-compare-end', 'dash-compare-apply');
                this._syncRangeCalendar('dash-compare');
            }
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

        // Rankings de funil — classes próprias (não .dash-tab): o handler
        // acima é global por classe e passaria a sobrescrever _topMode se
        // estes botões compartilhassem a mesma classe.
        document.querySelectorAll('.dash-funil-dim').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dash-funil-dim').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._funilDim = btn.dataset.dim;
                this._renderFunilRanking();
            });
        });
        document.querySelectorAll('.dash-funil-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dash-funil-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._funilMode = btn.dataset.funil;
                this._renderFunilRanking();
            });
        });
        document.querySelectorAll('.dash-funil-pais').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.dash-funil-pais').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this._funilPaisModo = btn.dataset.pmodo;
                this._renderVendasPorPais();
            });
        });

        EventBus.on('dataLoaded', () => this.refresh());
        // Ao trocar de loja, os mapas da Shopify (vendas reais, visitas, funil)
        // são de OUTRA loja agora — descarta antes do refresh, senão o mesmo
        // período mostraria os números da loja anterior sem erro nenhum.
        EventBus.on('storeChanged', () => { this._descartarCachesShopify(); this.refresh(); });
        EventBus.on('diaryChanged', () => this.refresh());
        EventBus.on('productsChanged', () => this.refresh());
        EventBus.on('goalsChanged', () => this.refresh());
        EventBus.on('tabChanged', (tab) => { if (tab === 'dashboard') this.refresh(); });

        // Primeira pintura dos cards de funil. O Dashboard já é a aba ativa no
        // load, então 'tabChanged' não dispara pra ele, e sem nenhum evento de
        // dados esses dois containers ficariam literalmente vazios — sem nem a
        // mensagem explicando o porquê, que é pior que qualquer estado vazio.
        this._renderFunilRanking();
        this._renderVendasPorPais();

        // "Ver Tudo" button on Madgicx-style ranking → toggle expand inline
        document.getElementById('btn-mdgx-ranking-all')?.addEventListener('click', () => {
            this._mdgxShowAll = !this._mdgxShowAll;
            this._renderMdgxRanking();
        });
        EventBus.on('labTestsChanged', () => { this._renderDeadlines(); });
        EventBus.on('projectsChanged', () => { this._renderDeadlines(); });

        document.getElementById('btn-dash-open-lab')?.addEventListener('click', () => {
            document.querySelector('[data-tab="laboratorio"]')?.click();
        });
        document.getElementById('btn-dash-open-projects')?.addEventListener('click', () => {
            document.querySelector('[data-tab="projects"]')?.click();
        });

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // ── Range-picker calendar state (one per calendar instance) ──
    _rangeCalState: {
        'dash-date':    { viewYear: 0, viewMonth: 0, start: '', end: '', initialized: false },
        'dash-compare': { viewYear: 0, viewMonth: 0, start: '', end: '', initialized: false },
    },

    _initRangeCalendar(prefix, hiddenStartId, hiddenEndId, applyBtnId) {
        const grid = document.getElementById(prefix + '-cal-grid');
        if (!grid) return;
        const state = this._rangeCalState[prefix];
        if (state.initialized) return;
        state.initialized = true;

        // Seed view from existing hidden inputs or today
        const seedStart = document.getElementById(hiddenStartId)?.value || '';
        const seedEnd = document.getElementById(hiddenEndId)?.value || '';
        state.start = seedStart;
        state.end = seedEnd;
        const seed = seedEnd || seedStart || new Date().toISOString().slice(0, 10);
        const [sy, sm] = seed.split('-').map(Number);
        state.viewYear = sy || new Date().getFullYear();
        state.viewMonth = (sm || new Date().getMonth() + 1) - 1;

        document.getElementById(prefix + '-cal-prev')?.addEventListener('click', (e) => {
            e.stopPropagation();
            state.viewMonth--;
            if (state.viewMonth < 0) { state.viewMonth = 11; state.viewYear--; }
            this._renderRangeCalendar(prefix);
        });
        document.getElementById(prefix + '-cal-next')?.addEventListener('click', (e) => {
            e.stopPropagation();
            state.viewMonth++;
            if (state.viewMonth > 11) { state.viewMonth = 0; state.viewYear++; }
            this._renderRangeCalendar(prefix);
        });

        this._renderRangeCalendar(prefix);
    },

    _renderRangeCalendar(prefix) {
        const state = this._rangeCalState[prefix];
        const grid = document.getElementById(prefix + '-cal-grid');
        const title = document.getElementById(prefix + '-cal-title');
        const summary = document.getElementById(prefix + '-cal-summary');
        if (!grid) return;

        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        if (title) title.textContent = `${monthNames[state.viewMonth]} ${state.viewYear}`;

        const firstDay = new Date(state.viewYear, state.viewMonth, 1);
        const lastDay = new Date(state.viewYear, state.viewMonth + 1, 0);
        const startDow = firstDay.getDay(); // 0 = Sunday
        const daysInMonth = lastDay.getDate();
        const todayStr = new Date().toISOString().slice(0, 10);

        let html = '';
        // Leading blanks
        for (let i = 0; i < startDow; i++) html += '<span class="dash-range-cal-day dash-range-cal-empty"></span>';
        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${state.viewYear}-${String(state.viewMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const classes = ['dash-range-cal-day'];
            if (state.start && ds === state.start) classes.push('dash-range-cal-start');
            if (state.end && ds === state.end) classes.push('dash-range-cal-end');
            if (state.start && state.end && ds > state.start && ds < state.end) classes.push('dash-range-cal-inrange');
            if (ds === todayStr) classes.push('dash-range-cal-today');
            html += `<button type="button" class="${classes.join(' ')}" data-date="${ds}">${d}</button>`;
        }
        grid.innerHTML = html;

        // Summary
        if (summary) {
            if (state.start && state.end) {
                const days = Math.round((new Date(state.end) - new Date(state.start)) / 86400000) + 1;
                summary.innerHTML = `${this._formatBr(state.start)} <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> ${this._formatBr(state.end)} · ${days} dia${days > 1 ? 's' : ''}`;
            } else if (state.start) {
                summary.textContent = `Início: ${this._formatBr(state.start)} · clique outra data para fim`;
            } else {
                summary.textContent = 'Clique uma data para começar.';
            }
        }

        // Bind day clicks
        grid.querySelectorAll('.dash-range-cal-day[data-date]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const ds = btn.dataset.date;
                if (!state.start || (state.start && state.end)) {
                    // Start new selection
                    state.start = ds;
                    state.end = '';
                } else {
                    // Completing range
                    if (ds < state.start) {
                        state.end = state.start;
                        state.start = ds;
                    } else if (ds === state.start) {
                        state.end = ds; // single-day range
                    } else {
                        state.end = ds;
                    }
                }
                // Sync hidden inputs for the rest of the app
                const hiddenStartId = prefix === 'dash-date' ? 'dash-date-start' : 'dash-compare-start';
                const hiddenEndId = prefix === 'dash-date' ? 'dash-date-end' : 'dash-compare-end';
                const sEl = document.getElementById(hiddenStartId);
                const eEl = document.getElementById(hiddenEndId);
                if (sEl) sEl.value = state.start;
                if (eEl) eEl.value = state.end || state.start;
                this._renderRangeCalendar(prefix);
            });
        });
    },

    // Sync calendar state when presets change dates from outside
    _syncRangeCalendar(prefix) {
        const state = this._rangeCalState[prefix];
        if (!state.initialized) return;
        const hiddenStartId = prefix === 'dash-date' ? 'dash-date-start' : 'dash-compare-start';
        const hiddenEndId = prefix === 'dash-date' ? 'dash-date-end' : 'dash-compare-end';
        const newStart = document.getElementById(hiddenStartId)?.value || '';
        const newEnd = document.getElementById(hiddenEndId)?.value || '';
        if (newStart === state.start && newEnd === state.end) return;
        state.start = newStart;
        state.end = newEnd;
        if (newStart) {
            const [y, m] = newStart.split('-').map(Number);
            state.viewYear = y;
            state.viewMonth = m - 1;
        }
        this._renderRangeCalendar(prefix);
    },

    _formatBr(iso) {
        if (!iso) return '';
        const [y, m, d] = iso.split('-');
        return `${d}/${m}/${y}`;
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

        // Keep range-calendar in sync with preset changes
        this._syncRangeCalendar('dash-date');

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

    // Zera os mapas que vêm da Shopify (chaveados só por período/país, nunca
    // por loja) — chamado ao TROCAR de loja, senão sobrevivem com dados da
    // loja anterior enquanto o período não muda.
    _descartarCachesShopify() {
        this._realSalesMap = null; this._realSalesCacheKey = '';
        this._realSalesPrevMap = null; this._realSalesPrevCacheKey = '';
        this._viewsMap = null; this._viewsCacheKey = '';
        this._viewsMapPorPais = null; this._viewsMapPorPaisKey = '';
        this._viewsErro = '';
        this._realSalesMapPorPais = null; this._realSalesMapPorPaisKey = '';
        this._funilLojaPais = null; this._funilLojaPaisKey = '';
    },

    refresh() {
        // Invalidate real-sales cache when period or compare changes
        const curKey = `${this._startDate}|${this._endDate}`;
        const prevKey = `${this._compareStart}|${this._compareEnd}`;
        if (this._realSalesCacheKey && this._realSalesCacheKey !== curKey) {
            this._realSalesMap = null;
            this._realSalesCacheKey = '';
        }
        if (this._realSalesPrevCacheKey && this._realSalesPrevCacheKey !== prevKey) {
            this._realSalesPrevMap = null;
            this._realSalesPrevCacheKey = '';
        }

        this._populateProductFilter();
        this._renderKPIs();
        this._renderActions();
        this._renderAlerts();
        this._renderGoals();
        this._renderFunnelDiagnosis();
        this._renderChart();
        this._renderTopProducts();
        this._renderFunilRanking();
        this._renderVendasPorPais();
        this._renderMdgxRanking();
        this._renderMetricsCalendar();
        this._renderEcommerceDates();
        this._renderOpportunities();
        this._renderPortfolio();
        this._renderPipeline();
        this._renderScores();
        this._renderStoresRanking();
        this._renderWidgets();
        this._renderDeadlines();
        this._renderCalendar();
        this._renderBudgetByProduct();

        // Keep the Shopify widget in sync with the dashboard's current period.
        // renderDashboardWidget() reads #dash-date-start / #dash-date-end when called
        // without arguments, so passing the current values is explicit and safe.
        if (typeof ShopifyModule !== 'undefined' && typeof ShopifyModule.renderDashboardWidget === 'function') {
            try { ShopifyModule.renderDashboardWidget(this._startDate, this._endDate); } catch (e) {}
        }
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
            const deltaIcon = k.delta > 0 ? '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i>' : k.delta < 0 ? '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i>' : '';
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

        // Tests to validate — agrupa por produto (evita repetir o mesmo)
        const pendingTests = new Map();
        (AppState.diary || []).forEach(e => {
            if (e.isTest && e.testEndDate && e.testEndDate <= today && (!e.testValidation || e.testValidation === 'pendente')) {
                const cur = pendingTests.get(e.productId) || { count: 0 };
                cur.count++;
                pendingTests.set(e.productId, cur);
            }
        });
        pendingTests.forEach((info, productId) => {
            const suffix = info.count > 1 ? ` (${info.count})` : '';
            actions.push({ icon: 'flask-conical', text: `Validar teste: ${getProductName(productId)}${suffix}`, type: 'warning' });
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
            const totalEntries = entries.length;
            const totalBudget = entries.reduce((s, e) => s + (parseFloat(e.budget) || 0), 0);
            let why;
            if (totalEntries === 0) {
                why = 'Sem entradas no Diário neste período. <a href="#" data-tab="diary" style="color:#8b5cf6">Adicionar entradas →</a>';
            } else if (totalBudget === 0) {
                why = 'Entradas sem budget — preencha o gasto em ads no Diário para detectar produtos em risco.';
            } else {
                why = '<i data-lucide="check" style="width:13px;height:13px;vertical-align:-2px"></i> Nenhum produto em risco — tudo dentro dos limites configurados.';
            }
            container.innerHTML = `<div class="dash-empty">${why}</div>`;
            container.querySelectorAll('[data-tab]').forEach(a => {
                a.addEventListener('click', (e) => { e.preventDefault(); document.querySelectorAll('[data-tab="' + a.dataset.tab + '"]').forEach(b => b.click()); });
            });
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

    // ── Shopify real-sales loaders (cache per period + compare period) ──
    async _loadRealSalesMaps() {
        const hasShopify = typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured && ShopifyModule.isConfigured();
        if (!hasShopify) {
            this._realSalesMap = {};
            this._realSalesPrevMap = {};
            return;
        }
        const curKey = `${this._startDate}|${this._endDate}`;
        if (this._realSalesCacheKey !== curKey) {
            try {
                this._realSalesMap = await ShopifyModule.getRealSalesMapByDate(this._startDate, this._endDate);
                this._realSalesCacheKey = curKey;
            } catch (e) {
                console.warn('[Dashboard] Shopify real sales fetch failed:', e);
                this._realSalesMap = {};
            }
        }
        if (this._compareMode !== 'none' && this._compareStart && this._compareEnd) {
            const prevKey = `${this._compareStart}|${this._compareEnd}`;
            if (this._realSalesPrevCacheKey !== prevKey) {
                try {
                    this._realSalesPrevMap = await ShopifyModule.getRealSalesMapByDate(this._compareStart, this._compareEnd);
                    this._realSalesPrevCacheKey = prevKey;
                } catch (e) {
                    console.warn('[Dashboard] Shopify prev sales fetch failed:', e);
                    this._realSalesPrevMap = {};
                }
            }
        } else {
            this._realSalesPrevMap = {};
        }
    },

    // Sum real sales from a realSalesMap for a given productId (or all if pid='todos')
    // across a date range [start, end].
    _sumRealSales(realMap, pid, start, end) {
        if (!realMap) return { sales: 0, revenue: 0 };
        let sales = 0, revenue = 0;
        for (const [key, data] of Object.entries(realMap)) {
            const [date, productId] = key.split('|');
            if (date < start || date > end) continue;
            if (pid && pid !== 'todos' && productId !== pid) continue;
            sales += Number(data.sales || 0);
            revenue += Number(data.revenue || 0);
        }
        return { sales, revenue };
    },

    // ── Shopify product-views loader (DASH-02 — denominador da Conversão Real) ──
    async _loadViewsMap() {
        const hasShopify = typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured && ShopifyModule.isConfigured();
        if (!hasShopify) { this._viewsMap = {}; return; }
        const curKey = `${this._startDate}|${this._endDate}`;
        if (this._viewsCacheKey !== curKey) {
            try {
                this._viewsMap = await ShopifyModule.fetchProductViewsByDate(this._startDate, this._endDate);
                this._viewsCacheKey = curKey;
            } catch (e) {
                console.warn('[Dashboard] Shopify views fetch failed:', e);
                this._viewsMap = {};
                // Guarda o motivo: sem isso o ranking caía num "Sem dados"
                // mudo e não havia como o usuário saber que o problema é a
                // fonte de visitas, não a ausência de vendas.
                this._viewsErro = String(e.message || e).slice(0, 220);
                // Causa mais provável e de longe a mais acionável: o token da
                // sessão foi emitido antes de read_reports entrar na lista de
                // escopos, então a query de visitas é recusada. Confirma no
                // próprio token em vez de adivinhar pela mensagem de erro.
                this._viewsPrecisaReconectar = false;
                try {
                    if (await ShopifyModule.tokenTemEscopoDeVisitas() === false) this._viewsPrecisaReconectar = true;
                } catch {}
            }
            if (this._viewsMap && Object.keys(this._viewsMap).length) this._viewsErro = '';
        }
    },

    // "Sem dados" não diz NADA — os modos que dependem da Shopify podem
    // esvaziar por 4 motivos bem diferentes, e o usuário não tem como
    // distinguir. Cada um tem uma ação concreta associada.
    _porqueRankingVazio(mode) {
        const entradas = this._getPeriodEntries();
        if (!entradas.length) {
            return this._productFilter !== 'todos'
                ? 'Sem entradas no Diário pra este produto no período — troque o filtro de produto ou o período.'
                : 'Sem entradas no Diário neste período.';
        }
        const precisaShopify = ['salesReal', 'cpaReal', 'conversionReal'].includes(mode);
        if (precisaShopify) {
            if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
                return 'Conecte a Shopify (Configurações → Integrações) — este modo usa dados reais da loja.';
            }
            const semVinculo = !(AppState.allProducts || []).some(p => ShopifyModule.getLink && ShopifyModule.getLink(p.id));
            if (semVinculo) {
                return 'Nenhum produto está vinculado a um produto da Shopify. Vincule em Produtos → Shopify pra cruzar vendas reais com os lançamentos do Diário.';
            }
            if (mode === 'conversionReal' && this._viewsPrecisaReconectar) {
                return 'A Conversão Real precisa das visitas da Shopify, e a permissão de relatórios (<code>read_reports</code>) não estava na conexão atual — ela foi adicionada agora, mas só vale num token novo. <button type="button" class="btn btn-primary btn-sm" id="dash-reconectar-shopify" style="margin-top:0.5rem">Reconectar Shopify</button>';
            }
            if (mode === 'conversionReal' && this._viewsErro) {
                return `Visitas por produto indisponíveis: ${escapeHtml(this._viewsErro)}`;
            }
            if (mode === 'conversionReal') {
                return 'Sem visitas por produto no período — a Conversão Real precisa do número de visitantes que a Shopify reporta por produto.';
            }
            return 'Sem vendas reais da Shopify no período pros produtos vinculados.';
        }
        return 'Sem dados neste período.';
    },

    // Sum Shopify product views from a viewsMap ("date|shopifyProductId": views)
    // for a given LOCAL productId (or all linked products if pid='todos'),
    // across a date range [start, end]. Chaves vêm em id da Shopify, não o
    // local — precisa converter via ShopifyModule.getLink antes de comparar.
    _sumViews(viewsMap, pid, start, end) {
        if (!viewsMap) return 0;
        const shopifyIdFiltro = (pid && pid !== 'todos' && typeof ShopifyModule !== 'undefined' && ShopifyModule.getLink)
            ? String(ShopifyModule.getLink(pid) || '') : '';
        let total = 0;
        for (const [key, views] of Object.entries(viewsMap)) {
            const [date, shopifyProductId] = key.split('|');
            if (date < start || date > end) continue;
            if (shopifyIdFiltro && shopifyProductId !== shopifyIdFiltro) continue;
            total += Number(views || 0);
        }
        return total;
    },

    // Vendas reais filtradas por país — mapa separado, só carregado quando
    // um país válido (código ISO de 2 letras) está selecionado.
    async _loadRealSalesMapPorPais(countryCode) {
        if (!countryCode) { this._realSalesMapPorPais = null; return; }
        const key = `${this._startDate}|${this._endDate}|${countryCode}`;
        const hasShopify = typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured && ShopifyModule.isConfigured();
        // grava a chave mesmo sem Shopify, senão o render re-dispara sempre (loop de "Carregando")
        if (!hasShopify) { this._realSalesMapPorPais = {}; this._realSalesMapPorPaisKey = key; return; }
        if (this._realSalesMapPorPaisKey !== key) {
            try {
                this._realSalesMapPorPais = await ShopifyModule.getRealSalesMapByDate(this._startDate, this._endDate, { countryCode });
                this._realSalesMapPorPaisKey = key;
            } catch (e) {
                console.warn('[Dashboard] Shopify sales by country fetch failed:', e);
                this._realSalesMapPorPais = {};
            }
        }
    },

    // Visitas por país (denominador da Conversão Real por país). Cache próprio
    // keyed por período + país, pra não misturar com o _viewsMap sem filtro.
    async _loadViewsMapPorPais(countryCode) {
        if (!countryCode) { this._viewsMapPorPais = null; this._viewsMapPorPaisKey = ''; return; }
        const key = `${this._startDate}|${this._endDate}|${countryCode}`;
        const hasShopify = typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured && ShopifyModule.isConfigured();
        // grava a chave mesmo sem Shopify, senão o render re-dispara sempre (loop de "Carregando")
        if (!hasShopify) { this._viewsMapPorPais = {}; this._viewsMapPorPaisKey = key; return; }
        if (this._viewsMapPorPaisKey !== key) {
            try {
                this._viewsMapPorPais = await ShopifyModule.getViewsMapPorPais(this._startDate, this._endDate, countryCode);
                this._viewsMapPorPaisKey = key;
            } catch (e) {
                console.warn('[Dashboard] Shopify views by country failed:', e);
                this._viewsMapPorPais = {};
            }
        }
    },

    // A tag de país do calendário (_calRegion) vem de campanhas do Facebook
    // e nem sempre é um código ISO de país só (js/region-tags.js: "EN" =
    // UK+IE+AU, "EUA" em vez de "US", "EU+" = grupo). Só filtra o lado
    // Shopify (dados reais, que usam country_code de verdade) quando a tag
    // já é um código de país único — "EN" parece um código de 2 letras mas
    // NÃO é (é a única composta de 2 letras nesse app), por isso a exclusão
    // explícita antes do regex.
    _regionParaCountryCode(region) {
        if (region === 'EN') return null;
        if (region && /^[A-Z]{2}$/.test(region)) return region;
        return null;
    },

    // Format period-over-period delta as "±X%" (or absolute for integer metrics)
    _fmtDelta(curr, prev, { percent = true, inverse = false, currency = false } = {}) {
        if (this._compareMode === 'none' || !prev) return '';
        if (!isFinite(curr) || !isFinite(prev)) return '';
        if (prev === 0 && curr === 0) return '';
        let text, cls;
        if (percent) {
            if (prev === 0) { text = '—'; cls = 'dash-delta-muted'; }
            else {
                const pct = ((curr - prev) / Math.abs(prev)) * 100;
                const sign = pct > 0 ? '+' : '';
                text = `${sign}${pct.toFixed(0)}%`;
                const good = inverse ? pct < 0 : pct > 0;
                cls = Math.abs(pct) < 0.5 ? 'dash-delta-muted' : (good ? 'dash-delta-up' : 'dash-delta-down');
            }
        } else {
            const diff = curr - prev;
            const sign = diff > 0 ? '+' : '';
            text = currency ? `${sign}${this._fmtCurrency(diff)}` : `${sign}${diff}`;
            const good = inverse ? diff < 0 : diff > 0;
            cls = diff === 0 ? 'dash-delta-muted' : (good ? 'dash-delta-up' : 'dash-delta-down');
        }
        return `<span class="dash-delta ${cls}">${text}</span>`;
    },

    // Row 3 Right: Top 5 products
    async _renderMdgxRanking() {
        const container = document.getElementById('dash-mdgx-ranking-list');
        const totalEl = document.getElementById('dash-mdgx-ranking-total');
        if (!container) return;

        const hasShopify = typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured?.();
        const products = (AppState.allProducts || AppState.products || []);
        const shopifyProds = (hasShopify && ShopifyModule.getShopifyProducts) ? ShopifyModule.getShopifyProducts() : [];

        // Pre-fetch Shopify products list (needed for thumbnails — even when ranking uses orders directly)
        if (hasShopify && !shopifyProds.length && !this._mdgxFetchingShopify) {
            this._mdgxFetchingShopify = true;
            ShopifyModule.fetchShopifyProducts?.().then(() => {
                this._mdgxFetchingShopify = false;
                this._renderMdgxRanking();
            }).catch(() => { this._mdgxFetchingShopify = false; });
        }

        // ── Primary source: Shopify orders (works even if local products aren't linked) ──
        let salesByShopifyPid = {}; // { shopify_pid: { sales, revenue, title, currency } }
        this._mdgxDaily = {};       // { productId: { 'YYYY-MM-DD': { sales, revenue } } } — pro modal de detalhe
        const _shopTz = ShopifyModule?.getConfig?.()?.shopTimezone;
        const _orderDate = (createdAt) => {
            if (_shopTz) { try { return new Intl.DateTimeFormat('en-CA', { timeZone: _shopTz, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(createdAt)); } catch {} }
            return String(createdAt || '').slice(0, 10);
        };
        const _addDaily = (id, date, sales, revenue) => {
            if (!id || !date) return;
            if (!this._mdgxDaily[id]) this._mdgxDaily[id] = {};
            if (!this._mdgxDaily[id][date]) this._mdgxDaily[id][date] = { sales: 0, revenue: 0 };
            this._mdgxDaily[id][date].sales += sales;
            this._mdgxDaily[id][date].revenue += revenue;
        };
        // Mesmo loop de pedidos, agora acumulando também por PAÍS DE ENTREGA —
        // o pedido já traz shipping_address, então isto não custa request novo.
        this._mdgxPorPais = {};     // { productId: { 'País': { sales, revenue } } }
        const _addPais = (id, pais, sales, revenue) => {
            if (!id) return;
            const chave = pais || 'Sem país no pedido';
            if (!this._mdgxPorPais[id]) this._mdgxPorPais[id] = {};
            if (!this._mdgxPorPais[id][chave]) this._mdgxPorPais[id][chave] = { sales: 0, revenue: 0 };
            this._mdgxPorPais[id][chave].sales += sales;
            this._mdgxPorPais[id][chave].revenue += revenue;
        };
        if (hasShopify && this._startDate && this._endDate) {
            container.innerHTML = container.innerHTML || '<div class="mdgx-ranking-empty">Carregando vendas...</div>';
            try {
                const orders = await ShopifyModule.fetchOrders(this._startDate, this._endDate, { silent: true });
                for (const o of (orders || [])) {
                    const cur = o.currency || ShopifyModule.getConfig?.()?.shopCurrency || 'BRL';
                    const oDate = _orderDate(o.created_at);
                    const oPais = o.shipping_address?.country || o.shipping_address?.country_code || '';
                    for (const li of (o.line_items || [])) {
                        const pid = String(li.product_id || '');
                        if (!pid) continue;
                        const qty = li.quantity || 0;
                        const unitPrice = parseFloat(li.price) || 0;
                        if (!salesByShopifyPid[pid]) salesByShopifyPid[pid] = { sales: 0, revenue: 0, title: li.title || pid, currency: cur };
                        salesByShopifyPid[pid].sales += qty;
                        salesByShopifyPid[pid].revenue += unitPrice * qty;
                        _addDaily(pid, oDate, qty, unitPrice * qty);
                        _addPais(pid, oPais, qty, unitPrice * qty);
                    }
                }
            } catch (e) {
                console.warn('[Dashboard mdgx ranking] fetchOrders failed:', e);
            }
        }

        // ── Fallback: Diary entries grouped by local product ──
        const entries = this._getPeriodEntries();
        const byLocalProduct = this._groupByProduct(entries);

        // Map Shopify pid → local product (when linked)
        const localFromShopify = (shopifyPid) => {
            if (typeof ShopifyModule === 'undefined' || !ShopifyModule.getLink) return null;
            for (const p of products) {
                if (String(ShopifyModule.getLink(p.id)) === String(shopifyPid)) return p;
            }
            return null;
        };

        // Build ranked items
        const items = [];
        const seenShopify = new Set();

        // 1) From Shopify orders (preferred — has thumbs + real prices)
        for (const [pid, info] of Object.entries(salesByShopifyPid)) {
            if (info.sales <= 0) continue;
            seenShopify.add(pid);
            const localProd = localFromShopify(pid);
            const sp = shopifyProds.find(p => String(p.id) === String(pid));
            items.push({
                id: pid,
                name: localProd?.name || sp?.title || info.title,
                sales: info.sales,
                price: info.sales > 0 ? info.revenue / info.sales : 0,
                currency: info.currency,
                thumb: sp?.image || (localProd && Array.isArray(localProd.images) && localProd.images[0]?.src) || '',
            });
        }

        // 2) From diary (for products without Shopify orders, OR if Shopify not connected)
        for (const p of products) {
            const linkedShopifyPid = ShopifyModule?.getLink?.(p.id);
            if (linkedShopifyPid && seenShopify.has(String(linkedShopifyPid))) continue;
            const dEntries = byLocalProduct[p.id] || [];
            const diarySales = dEntries.reduce((s, e) => s + (parseFloat(e.sales) || 0), 0);
            if (diarySales <= 0) continue;
            dEntries.forEach(e => { if (e.date) _addDaily(p.id, e.date, parseFloat(e.sales) || 0, parseFloat(e.revenue) || 0); });
            const sp = linkedShopifyPid ? shopifyProds.find(x => String(x.id) === String(linkedShopifyPid)) : null;
            items.push({
                id: p.id,
                name: p.name || p.id,
                sales: diarySales,
                price: parseFloat(p.price || 0),
                currency: p.priceCurrency || 'BRL',
                thumb: sp?.image || (Array.isArray(p.images) && p.images[0]?.src) || '',
            });
        }

        const ranked = items.sort((a, b) => b.sales - a.sales);

        // Total sales sum (the big number)
        const totalSales = ranked.reduce((s, p) => s + p.sales, 0);
        if (totalEl) totalEl.textContent = totalSales.toLocaleString('pt-BR');

        const total = ranked.length;
        if (total === 0) {
            container.innerHTML = '<div class="mdgx-ranking-empty">Sem vendas no período. Conecte o Shopify ou registre vendas no Diário.</div>';
            return;
        }
        const visibleCount = this._mdgxShowAll ? total : Math.min(4, total);
        const top4 = ranked.slice(0, visibleCount);

        const fmtMoney = (v, cur) => {
            const sym = { BRL:'R$', USD:'$', EUR:'€', GBP:'£' }[cur] || (cur + ' ');
            return `${sym} ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        // Helper: find local product for badge lookup
        const localProductFor = (id) => {
            // Try local product by id, then via Shopify link
            let lp = products.find(x => x.id === id);
            if (lp) return lp;
            if (typeof ShopifyModule !== 'undefined' && ShopifyModule.getLink) {
                lp = products.find(x => String(ShopifyModule.getLink(x.id)) === String(id));
                if (lp) return lp;
            }
            return null;
        };

        container.innerHTML = top4.map(p => {
            const lp = localProductFor(p.id);
            const badges = (lp && typeof renderProductMetaBadges === 'function') ? renderProductMetaBadges(lp) : '';
            return `
            <div class="mdgx-ranking-item" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}" data-currency="${escapeHtml(p.currency || 'BRL')}" title="Ver vendas por dia">
                ${p.thumb
                    ? `<img class="mdgx-ranking-thumb" src="${escapeHtml(p.thumb)}" alt="">`
                    : '<div class="mdgx-ranking-thumb-empty"><i data-lucide="package" style="width:22px;height:22px"></i></div>'
                }
                <div class="mdgx-ranking-info">
                    <div class="mdgx-ranking-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}${badges}</div>
                    <div class="mdgx-ranking-meta">
                        <span class="mdgx-ranking-price">${fmtMoney(p.price, p.currency)}</span>
                        <span class="mdgx-ranking-sold">${p.sales} Vendido${p.sales !== 1 ? 's' : ''}</span>
                    </div>
                </div>
                <span class="mdgx-ranking-daybtn" title="Ver vendas por dia"><i data-lucide="calendar-days" style="width:16px;height:16px"></i></span>
            </div>`;
        }).join('');

        // Inline expand/collapse footer (no page leave)
        if (total > 4) {
            const expandBtn = document.createElement('button');
            expandBtn.type = 'button';
            expandBtn.className = 'mdgx-ranking-expand';
            if (this._mdgxShowAll) {
                expandBtn.innerHTML = '<i data-lucide="chevron-up" style="width:13px;height:13px"></i> Mostrar menos';
                expandBtn.addEventListener('click', () => {
                    this._mdgxShowAll = false;
                    this._renderMdgxRanking();
                    container.scrollIntoView({ behavior:'smooth', block:'center' });
                });
            } else {
                const hidden = total - visibleCount;
                expandBtn.innerHTML = `<i data-lucide="chevron-down" style="width:13px;height:13px"></i> Ver mais ${hidden} produto${hidden !== 1 ? 's' : ''}`;
                expandBtn.addEventListener('click', () => {
                    this._mdgxShowAll = true;
                    this._renderMdgxRanking();
                });
            }
            container.appendChild(expandBtn);
        }

        // Click item → abre modal de vendas por dia (Lista / Calendário)
        container.querySelectorAll('.mdgx-ranking-item').forEach(el => {
            el.addEventListener('click', (e) => {
                if (e.target.closest('a, button')) return; // não intercepta badges/links do produto
                this._openProductDailyModal(el.dataset.id, el.dataset.name, el.dataset.currency);
            });
        });

        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    },

    // Modal: vendas por dia de um produto — visão Lista + Calendário
    _openProductDailyModal(id, name, currency) {
        const daily = (this._mdgxDaily && this._mdgxDaily[id]) || {};
        const dates = Object.keys(daily).sort();
        const sym = { BRL:'R$', USD:'$', EUR:'€', GBP:'£' }[currency] || ((currency || '') + ' ');
        const money = (v) => `${sym} ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const totalSales = dates.reduce((s, d) => s + daily[d].sales, 0);
        const totalRev = dates.reduce((s, d) => s + daily[d].revenue, 0);
        const fmtDate = (ds) => { const [y, m, dd] = ds.split('-'); return `${dd}/${m}/${y}`; };
        const WEEK = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
        const MES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

        document.getElementById('mdgx-daily-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'mdgx-daily-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content mdgx-daily-content">
                <div class="modal-header">
                    <h3 title="${escapeHtml(name)}">${escapeHtml(name)}</h3>
                    <button class="btn-close" id="mdgx-daily-close">&times;</button>
                </div>
                <div class="mdgx-daily-summary">
                    <div class="mdgx-daily-stat"><span class="mdgx-daily-stat-num">${totalSales}</span><span class="mdgx-daily-stat-lbl">vendas</span></div>
                    <div class="mdgx-daily-stat"><span class="mdgx-daily-stat-num">${money(totalRev)}</span><span class="mdgx-daily-stat-lbl">receita</span></div>
                    <div class="mdgx-daily-stat"><span class="mdgx-daily-stat-num">${dates.length}</span><span class="mdgx-daily-stat-lbl">dia(s) com venda</span></div>
                </div>
                <div class="mdgx-daily-tabs">
                    <button class="mdgx-daily-tab active" data-view="lista"><i data-lucide="list" style="width:14px;height:14px;vertical-align:-2px"></i> Lista</button>
                    <button class="mdgx-daily-tab" data-view="cal"><i data-lucide="calendar-days" style="width:14px;height:14px;vertical-align:-2px"></i> Calendário</button>
                    <button class="mdgx-daily-tab" data-view="pais"><i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i> Países</button>
                </div>
                <div id="mdgx-daily-body"></div>
            </div>`;
        document.body.appendChild(modal);
        const body = modal.querySelector('#mdgx-daily-body');

        const renderList = () => {
            if (!dates.length) { body.innerHTML = '<div class="mdgx-daily-empty">Sem vendas no período.</div>'; return; }
            body.innerHTML = `<table class="mdgx-daily-table">
                <thead><tr><th>Dia</th><th class="num">Vendas</th><th class="num">Receita</th></tr></thead>
                <tbody>${dates.slice().reverse().map(d =>
                    `<tr><td>${fmtDate(d)}</td><td class="num"><strong>${daily[d].sales}</strong></td><td class="num">${money(daily[d].revenue)}</td></tr>`
                ).join('')}</tbody></table>`;
        };
        const renderCal = () => {
            const months = [...new Set(dates.map(d => d.slice(0, 7)))].sort();
            if (!months.length) { body.innerHTML = '<div class="mdgx-daily-empty">Sem vendas no período.</div>'; return; }
            const maxDay = Math.max(1, ...dates.map(d => daily[d].sales));
            body.innerHTML = months.map(ym => {
                const [y, m] = ym.split('-').map(Number);
                const startWd = new Date(y, m - 1, 1).getDay();
                const days = new Date(y, m, 0).getDate();
                let cells = '';
                for (let i = 0; i < startWd; i++) cells += '<div class="mdgx-cal-cell mdgx-cal-empty"></div>';
                for (let d = 1; d <= days; d++) {
                    const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    const info = daily[ds];
                    const intensity = info ? (0.15 + 0.85 * (info.sales / maxDay)) : 0;
                    const bg = info ? `style="background:rgba(139,92,246,${intensity.toFixed(2)})"` : '';
                    cells += `<div class="mdgx-cal-cell${info ? ' mdgx-cal-has' : ''}" ${bg} ${info ? `title="${fmtDate(ds)}: ${info.sales} venda(s) · ${money(info.revenue)}"` : ''}>
                        <span class="mdgx-cal-num">${d}</span>${info ? `<span class="mdgx-cal-sales">${info.sales}</span>` : ''}</div>`;
                }
                return `<div class="mdgx-cal-month">
                    <div class="mdgx-cal-title">${MES[m - 1]} ${y}</div>
                    <div class="mdgx-cal-grid">${WEEK.map(w => `<div class="mdgx-cal-wd">${w}</div>`).join('')}${cells}</div>
                </div>`;
            }).join('');
        };
        // Vendas por PAÍS DE ENTREGA deste produto — vem do mesmo lote de
        // pedidos do ranking (nenhum request extra), então respeita o período
        // selecionado igual às outras duas abas.
        const renderPais = () => {
            const porPais = (this._mdgxPorPais && this._mdgxPorPais[id]) || {};
            const linhas = Object.entries(porPais)
                .map(([pais, v]) => ({ pais, ...v }))
                .sort((a, b) => b.sales - a.sales);
            if (!linhas.length) { body.innerHTML = '<div class="mdgx-daily-empty">Sem vendas no período.</div>'; return; }
            const total = linhas.reduce((s, l) => s + l.sales, 0);
            body.innerHTML = `<table class="mdgx-daily-table">
                <thead><tr><th>País</th><th class="num">Vendas</th><th class="num">%</th><th class="num">Receita</th></tr></thead>
                <tbody>${linhas.map(l => `<tr>
                    <td>${escapeHtml(l.pais)}</td>
                    <td class="num"><strong>${l.sales}</strong></td>
                    <td class="num">${total > 0 ? ((l.sales / total) * 100).toFixed(0) : 0}%</td>
                    <td class="num">${money(l.revenue)}</td>
                </tr>`).join('')}</tbody></table>`;
        };

        renderList();
        modal.querySelectorAll('.mdgx-daily-tab').forEach(t => t.addEventListener('click', () => {
            modal.querySelectorAll('.mdgx-daily-tab').forEach(x => x.classList.toggle('active', x === t));
            const v = t.dataset.view;
            if (v === 'cal') renderCal(); else if (v === 'pais') renderPais(); else renderList();
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        }));
        const close = () => modal.remove();
        modal.querySelector('#mdgx-daily-close').addEventListener('click', close);
        modal.querySelector('.modal-overlay').addEventListener('click', close);
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    },

    _renderTopProducts() {
        const container = document.getElementById('dash-top-products');
        if (!container) return;

        const needsReal = this._topMode === 'cpaReal' || this._topMode === 'salesReal' || this._topMode === 'conversionReal';
        const needsViews = this._topMode === 'conversionReal';
        const pendencias = [];
        if (needsReal && this._realSalesMap === null) pendencias.push(this._loadRealSalesMaps());
        if (needsViews && this._viewsMap === null) pendencias.push(this._loadViewsMap());
        if (pendencias.length) {
            container.innerHTML = '<div class="dash-empty">Carregando vendas Shopify...</div>';
            Promise.all(pendencias).then(() => this._renderTopProducts());
            return;
        }

        const entries = this._getPeriodEntries();
        const prevEntries = this._getPrevPeriodEntries();
        const byProduct = this._groupByProduct(entries);
        const byProductPrev = this._groupByProduct(prevEntries);

        let ranked = Object.entries(byProduct).map(([pid, pEntries]) => {
            const agg = this._aggregate(pEntries);
            const prevAgg = this._aggregate(byProductPrev[pid] || []);
            const real = this._sumRealSales(this._realSalesMap, pid, this._startDate, this._endDate);
            const realPrev = this._sumRealSales(this._realSalesPrevMap, pid, this._compareStart, this._compareEnd);
            const cpaReal = real.sales > 0 ? agg.budget / real.sales : 0;
            const cpaRealBRL = real.sales > 0 ? agg.budgetBRL / real.sales : 0;
            const cpaRealPrev = realPrev.sales > 0 ? prevAgg.budget / realPrev.sales : 0;
            // Conversão Real (DASH-03) — mesma fórmula do Calendário de
            // Métricas: vendas reais da Shopify ÷ visitas reais do produto
            // na Shopify. Sem filtro de país aqui (Top Produtos não tem
            // esse seletor) — visitas por país por produto não existem na
            // Shopify de qualquer forma, então não perde nada.
            const views = this._sumViews(this._viewsMap, pid, this._startDate, this._endDate);
            const viewsPrev = this._sumViews(this._viewsMap, pid, this._compareStart, this._compareEnd);
            const convReal = views > 0 ? (real.sales / views) * 100 : 0;
            const convRealPrev = viewsPrev > 0 ? (realPrev.sales / viewsPrev) * 100 : 0;
            return {
                pid, name: getProductName(pid),
                ...agg,
                prevAgg,
                realSales: real.sales,
                realSalesPrev: realPrev.sales,
                cpaReal, cpaRealBRL, cpaRealPrev,
                convReal, convRealPrev, views,
            };
        });

        // Sort by selected mode
        const mode = this._topMode;
        if (mode === 'profit') ranked.sort((a, b) => b.profit - a.profit);
        else if (mode === 'roas') ranked.sort((a, b) => b.roas - a.roas);
        else if (mode === 'cpa') ranked = ranked.filter(p => p.cpa > 0).sort((a, b) => a.cpa - b.cpa);
        else if (mode === 'cpaReal') ranked = ranked.filter(p => p.cpaReal > 0).sort((a, b) => a.cpaReal - b.cpaReal);
        else if (mode === 'salesReal') ranked.sort((a, b) => b.realSales - a.realSales);
        else if (mode === 'conversionReal') ranked = ranked.filter(p => p.convReal > 0).sort((a, b) => b.convReal - a.convReal);
        else if (mode === 'budget') ranked.sort((a, b) => b.budget - a.budget);
        else ranked.sort((a, b) => b.revenue - a.revenue);

        ranked = ranked.slice(0, 5);

        if (ranked.length === 0) {
            container.innerHTML = `<div class="dash-empty">${this._porqueRankingVazio(mode)}</div>`;
            container.querySelector('#dash-reconectar-shopify')?.addEventListener('click', () => {
                // Reabre o modal de configuração da Shopify, onde o usuário
                // confirma o domínio e dispara o OAuth com os escopos novos.
                if (ShopifyModule.openConfigModal) ShopifyModule.openConfigModal();
            });
            return;
        }

        container.innerHTML = ranked.map((p, i) => {
            let mainVal, delta = '';
            if (mode === 'profit') {
                mainVal = this._fmtCurrency(p.profit);
                delta = this._fmtDelta(p.profit, p.prevAgg.profit);
            } else if (mode === 'roas') {
                mainVal = p.roas.toFixed(2) + 'x';
                delta = this._fmtDelta(p.roas, p.prevAgg.roas);
            } else if (mode === 'cpa') {
                mainVal = this._fmtCurrency(p.cpa);
                delta = this._fmtDelta(p.cpa, p.prevAgg.cpa, { inverse: true });
            } else if (mode === 'cpaReal') {
                mainVal = this._fmtCurrency(p.cpaReal);
                delta = this._fmtDelta(p.cpaReal, p.cpaRealPrev, { inverse: true });
            } else if (mode === 'salesReal') {
                mainVal = p.realSales + (p.realSales === 1 ? ' venda' : ' vendas');
                delta = this._fmtDelta(p.realSales, p.realSalesPrev, { percent: false });
            } else if (mode === 'conversionReal') {
                mainVal = p.convReal.toFixed(2) + '%';
                delta = this._fmtDelta(p.convReal, p.convRealPrev, { percent: false });
            } else if (mode === 'budget') {
                mainVal = this._fmtCurrency(p.budget);
                delta = this._fmtDelta(p.budget, p.prevAgg.budget);
            } else {
                mainVal = this._fmtCurrency(p.revenue);
                delta = this._fmtDelta(p.revenue, p.prevAgg.revenue);
            }
            const profitColor = p.profit >= 0 ? 'var(--green)' : 'var(--red)';
            return `<div class="dash-rank-item">
                <span class="dash-rank-pos">${i + 1}</span>
                <span class="dash-rank-name">${escapeHtml(p.name)}</span>
                <span class="dash-rank-value" style="color:${mode === 'profit' ? profitColor : ''}">${mainVal}${delta}</span>
            </div>`;
        }).join('') + (mode === 'conversionReal' ? this._rodapeConversaoReal() : '');
    },

    // A Conversão Real usa como denominador as sessões que ENTRARAM pela
    // página do produto (landing page) — a Shopify não expõe visualização de
    // produto nesta loja. Duas ressalvas que mudam a leitura do número e por
    // isso não podem ficar só no código:
    //  • quem entra pela home e navega até o produto não é contado;
    //  • em loja multi-idioma, sessão que entra pelo handle traduzido não casa
    //    com o produto e sai do denominador — o que INFLA a conversão.
    _rodapeConversaoReal() {
        const cob = typeof ShopifyModule !== 'undefined' && ShopifyModule.getCoberturaViews
            ? ShopifyModule.getCoberturaViews() : null;
        let aviso = 'Base: sessões que entraram pela página do produto.';
        if (cob && cob.orfas > 0 && cob.pct < 95) {
            aviso += ` ${cob.pct.toFixed(0)}% das sessões de produto casaram com um produto do catálogo — ${cob.orfas.toLocaleString('pt-BR')} ficaram de fora (handle traduzido), então a taxa real é um pouco menor.`;
        }
        return `<div class="dash-conv-rodape">${escapeHtml(aviso)}</div>`;
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
                const storeEntries = (AppState.allDiary || AppState.diary || []).filter(e => {
                    if (e.isCampaign || e.parentId) return false;
                    return e.storeId === s.id;
                });
                const d = new Date();
                const periodDays = Number(this._period) > 0 ? Number(this._period) : 30;
                d.setDate(d.getDate() - (periodDays - 1));
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
        }).join('<div class="dash-funnel-arrow"><i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i></div>');

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
            { cc:'global', flag:'<i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i>', name:"Ano Novo",           date: fixed(1,1) },
            { cc:'global', flag:'<i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i>', name:"Dia dos Namorados",  date: fixed(2,14) },
            { cc:'global', flag:'<i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i>', name:"Páscoa",             date: easterDate },
            { cc:'global', flag:'<i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i>', name:"Dia das Mães",       date: nth(year,5,0,2) },
            { cc:'global', flag:'<i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i>', name:"Singles' Day",       date: fixed(11,11) },
            { cc:'global', flag:'<i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i>', name:"Black Friday",       date: add(thanksgiving, 1) },
            { cc:'global', flag:'<i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i>', name:"Cyber Monday",       date: add(thanksgiving, 4) },
            { cc:'global', flag:'<i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i>', name:"Natal",              date: fixed(12,25) },
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
            { key: 'global', label: '<i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i> Global' },
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
    // ══════════════════════════════════════════════════════════════
    //  Rankings de funil — checkout / conversão por produto ou país
    //
    //  "Checkout" aqui é o evento InitiateCheckout do pixel do Facebook
    //  (campo `checkout` do Diário), NÃO o funil de checkout da Shopify —
    //  a Shopify não expõe isso. Por isso a dimensão "país" é a TAG DE
    //  REGIÃO DA CAMPANHA (segmentação do anúncio), a única que carrega
    //  esse evento. O país real de entrega dos pedidos vive noutro card,
    //  separado de propósito: são dimensões diferentes e misturar as duas
    //  numa taxa só daria um número com numerador e denominador de escopos
    //  diferentes (o mesmo erro que já corrigimos na Conversão Real).
    // ══════════════════════════════════════════════════════════════

    // Entradas de CAMPANHA (as únicas com `region`) no intervalo pedido.
    // _getPeriodEntries exclui campanha de propósito — daí a versão própria.
    _entradasCampanha(inicio, fim) {
        return (AppState.diary || []).filter(e => {
            if (!e.isCampaign || !e.region) return false;
            if (!e.date || e.date < inicio || e.date > fim) return false;
            if (this._productFilter !== 'todos' && e.productId !== this._productFilter) return false;
            return true;
        });
    },

    _agruparPorRegiao(entries) {
        const map = {};
        entries.forEach(e => {
            if (!map[e.region]) map[e.region] = [];
            map[e.region].push(e);
        });
        return map;
    },

    // Devolve [{ chave, nome, agg }] já agregado, na dimensão pedida.
    // Reusa _aggregate() nas duas dimensões pra taxa/moeda saírem idênticas.
    _linhasFunil(dim, anterior = false) {
        if (dim === 'regiao') {
            const inicio = anterior ? this._compareStart : this._startDate;
            const fim = anterior ? this._compareEnd : this._endDate;
            if (!inicio || !fim) return [];
            const grupos = this._agruparPorRegiao(this._entradasCampanha(inicio, fim));
            return Object.entries(grupos).map(([regiao, entries]) => ({
                chave: regiao,
                nome: (typeof RegionTags !== 'undefined' && RegionTags.labelPlain) ? RegionTags.labelPlain(regiao) : regiao,
                agg: this._aggregate(entries),
            }));
        }
        const entries = anterior ? this._getPrevPeriodEntries() : this._getPeriodEntries();
        const grupos = this._groupByProduct(entries);
        return Object.entries(grupos).map(([pid, pEntries]) => ({
            chave: pid,
            nome: getProductName(pid),
            agg: this._aggregate(pEntries),
        }));
    },

    _taxaCheckout(agg) {
        return agg.addToCart > 0 ? (agg.checkout / agg.addToCart) * 100 : 0;
    },

    // Delta entre duas TAXAS, em pontos percentuais. Não dá pra usar
    // _fmtDelta({percent:false}) aqui: aquele ramo formata `${diff}` cru,
    // pensado pra contagens inteiras (vendas) — com taxa vira "−40.2439...".
    // E "+10" sem unidade leria como "10 vendas", não "10 pontos".
    _deltaPP(atual, anterior) {
        if (this._compareMode === 'none') return '';
        if (!isFinite(atual) || !isFinite(anterior)) return '';
        const diff = atual - anterior;
        if (Math.abs(diff) < 0.05) return '';
        const sign = diff > 0 ? '+' : '−';
        const cls = diff > 0 ? 'dash-delta-up' : 'dash-delta-down';
        return `<span class="dash-delta ${cls}">${sign}${Math.abs(diff).toFixed(1)}pp</span>`;
    },

    _renderFunilRanking() {
        const container = document.getElementById('dash-funil-lista');
        if (!container) return;
        const dim = this._funilDim;
        const modo = this._funilMode;
        const linhas = this._linhasFunil(dim);
        const rotuloDim = dim === 'regiao' ? 'país' : 'produto';
        const elRotulo = document.getElementById('dash-funil-rotulo');
        if (elRotulo) elRotulo.textContent = rotuloDim;

        if (!linhas.length) {
            container.innerHTML = `<div class="dash-empty">${dim === 'regiao'
                ? 'Sem campanhas com tag de país no período. As tags saem do nome da campanha no Facebook (ex.: "EUA", "BR", "EN").'
                : 'Sem entradas no Diário neste período.'}</div>`;
            return;
        }

        // Mapa do período anterior pra calcular variação por chave.
        const antMapa = {};
        if (this._compareMode !== 'none') {
            this._linhasFunil(dim, true).forEach(l => { antMapa[l.chave] = l.agg; });
        }

        let ranked = [];
        let renderValor = () => '';
        let vazio = '';

        if (modo === 'piorCheckout' || modo === 'melhorCheckout') {
            const pior = modo === 'piorCheckout';
            ranked = linhas
                .filter(l => l.agg.addToCart >= this._MIN_ATC_FUNIL)
                .map(l => ({ ...l, taxa: this._taxaCheckout(l.agg) }))
                .sort((a, b) => pior ? a.taxa - b.taxa : b.taxa - a.taxa);
            renderValor = (l) => {
                const ant = antMapa[l.chave];
                const delta = ant ? this._deltaPP(l.taxa, this._taxaCheckout(ant)) : '';
                return `${l.taxa.toFixed(1)}%${delta}`;
            };
            vazio = `Nenhum ${rotuloDim} com pelo menos ${this._MIN_ATC_FUNIL} adições ao carrinho no período — sem volume, a taxa de checkout é ruído.`;

        } else if (modo === 'melhorConv') {
            ranked = linhas
                .filter(l => l.agg.pageViews >= this._MIN_VIEWS_FUNIL)
                .map(l => ({ ...l, taxa: l.agg.convPage }))
                .sort((a, b) => b.taxa - a.taxa);
            renderValor = (l) => {
                const ant = antMapa[l.chave];
                const delta = ant ? this._deltaPP(l.taxa, ant.convPage) : '';
                return `${l.taxa.toFixed(2)}%${delta}`;
            };
            vazio = `Nenhum ${rotuloDim} com pelo menos ${this._MIN_VIEWS_FUNIL} visitantes no período.`;

        } else if (modo === 'oportunidades') {
            // Quanto checkout a mais sairia se a taxa subisse até a MEDIANA
            // do próprio conjunto. Alvo mediana (não o melhor) de propósito:
            // é uma meta que metade dos itens já bate, não um teto irreal.
            const comVolume = linhas.filter(l => l.agg.addToCart >= this._MIN_ATC_FUNIL);
            const taxas = comVolume.map(l => this._taxaCheckout(l.agg)).sort((a, b) => a - b);
            const mediana = taxas.length ? taxas[Math.floor(taxas.length / 2)] : 0;
            ranked = comVolume
                .map(l => {
                    const taxa = this._taxaCheckout(l.agg);
                    return { ...l, taxa, ganho: Math.round(l.agg.addToCart * Math.max(0, mediana - taxa) / 100) };
                })
                .filter(l => l.ganho >= 1)
                .sort((a, b) => b.ganho - a.ganho);
            renderValor = (l) => `+${l.ganho} checkout${l.ganho === 1 ? '' : 's'} <span class="dash-funil-sub">${l.taxa.toFixed(1)}% → ${mediana.toFixed(1)}%</span>`;
            vazio = taxas.length
                ? `Nenhum ${rotuloDim} abaixo da mediana de checkout (${mediana.toFixed(1)}%) com volume suficiente — o funil está equilibrado.`
                : `Nenhum ${rotuloDim} com pelo menos ${this._MIN_ATC_FUNIL} adições ao carrinho no período.`;

        } else if (modo === 'quedas') {
            if (this._compareMode === 'none') {
                container.innerHTML = `<div class="dash-empty">Escolha um período de comparação acima pra ver tendências — sem período anterior não há do que cair.</div>`;
                return;
            }
            ranked = linhas
                .filter(l => l.agg.addToCart >= this._MIN_ATC_FUNIL && antMapa[l.chave])
                .map(l => {
                    const taxa = this._taxaCheckout(l.agg);
                    const taxaAnt = this._taxaCheckout(antMapa[l.chave]);
                    return { ...l, taxa, taxaAnt, queda: taxaAnt - taxa };
                })
                .filter(l => l.queda > 0.5)   // ignora oscilação irrelevante
                .sort((a, b) => b.queda - a.queda);
            renderValor = (l) => `−${l.queda.toFixed(1)}pp <span class="dash-funil-sub">${l.taxaAnt.toFixed(1)}% → ${l.taxa.toFixed(1)}%</span>`;
            vazio = `Nenhum ${rotuloDim} com queda relevante na taxa de checkout — nada piorou de forma significativa.`;
        }

        if (!ranked.length) {
            container.innerHTML = `<div class="dash-empty">${vazio}</div>`;
            return;
        }

        container.innerHTML = ranked.slice(0, 6).map((l, i) => `
            <div class="dash-rank-item">
                <span class="dash-rank-pos">${i + 1}</span>
                <span class="dash-rank-name">${escapeHtml(l.nome)}</span>
                <span class="dash-rank-value">${renderValor(l)}</span>
            </div>`).join('');
    },

    // Funil REAL da Shopify por país — sessões → carrinho → checkout → compra,
    // direto do ShopifyQL. É a conversão REAL de verdade (visitante da loja
    // que comprou), não a estimativa do pixel do Facebook do card ao lado.
    // A Shopify NÃO expõe esse funil por produto (as colunas de produto não
    // existem no dataset `sessions`), só por país e no total — por isso este
    // card é por país e o Top Produtos explica a limitação em vez de fingir.
    async _renderVendasPorPais() {
        const container = document.getElementById('dash-vendas-pais');
        if (!container) return;
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
            container.innerHTML = '<div class="dash-empty">Conecte a Shopify pra ver o funil real por país.</div>';
            return;
        }
        const chave = `${this._startDate}|${this._endDate}`;
        if (this._funilLojaPaisKey !== chave) {
            container.innerHTML = '<div class="dash-empty">Carregando funil por país…</div>';
            try {
                this._funilLojaPais = await ShopifyModule.fetchFunilLoja(this._startDate, this._endDate, { porPais: true });
                this._funilLojaPaisKey = chave;
            } catch (e) {
                container.innerHTML = `<div class="dash-empty">Funil indisponível: ${escapeHtml(String(e.message).slice(0, 160))}</div>`;
                return;
            }
        }
        const linhas = (this._funilLojaPais || []).filter(l => l.sessoes > 0);
        if (!linhas.length) {
            container.innerHTML = '<div class="dash-empty">Sem sessões na Shopify neste período.</div>';
            return;
        }
        const modo = this._funilPaisModo || 'conversao';
        const taxa = (l) => modo === 'checkout'
            ? (l.carrinho > 0 ? (l.checkout / l.carrinho) * 100 : 0)
            : (l.sessoes > 0 ? (l.compras / l.sessoes) * 100 : 0);
        // Piso de volume pelo mesmo motivo do card ao lado: sem volume a taxa
        // é ruído. Pisos diferentes por métrica de propósito — o denominador
        // da conversão (sessões) é uma ordem de grandeza maior que o do
        // checkout (carrinhos), então um piso único deixaria passar país com
        // 40 sessões e 0 compra ocupando o ranking com "0,00%".
        const piso = modo === 'checkout' ? 30 : 200;
        const comVolume = linhas.filter(l => (modo === 'checkout' ? l.carrinho : l.sessoes) >= piso);
        if (!comVolume.length) {
            container.innerHTML = '<div class="dash-empty">Nenhum país com volume suficiente no período.</div>';
            return;
        }
        const ordenadas = [...comVolume].sort((a, b) => taxa(b) - taxa(a));
        container.innerHTML = ordenadas.slice(0, 6).map((l, i) => `
            <div class="dash-rank-item">
                <span class="dash-rank-pos">${i + 1}</span>
                <span class="dash-rank-name">${escapeHtml(l.chave)}</span>
                <span class="dash-rank-value">${taxa(l).toFixed(2)}% <span class="dash-funil-sub">${modo === 'checkout' ? `${l.checkout}/${l.carrinho} carrinhos` : `${l.compras}/${l.sessoes} sessões`}</span></span>
            </div>`).join('');
    },

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

        if (opps.length > 0) {
            container.innerHTML = opps.slice(0, 6).map(o => `<div class="dash-opp-item"><i data-lucide="lightbulb" style="width:13px;height:13px;color:var(--yellow)"></i> ${o.text}</div>`).join('');
        } else {
            // Detect why it's empty
            const totalEntries = entries.length;
            const totalImpressions = entries.reduce((s, e) => s + (parseFloat(e.impressions) || 0), 0);
            const totalPageViews = entries.reduce((s, e) => s + (parseFloat(e.pageViews) || 0), 0);
            let why = '';
            if (totalEntries === 0) {
                why = 'Sem entradas no Diário neste período. <a href="#" data-tab="diary" style="color:#8b5cf6">Adicionar entradas →</a>';
            } else if (totalImpressions === 0 && totalPageViews === 0) {
                why = 'Entradas do Diário sem impressões/pageviews — importe do Facebook ou preencha manualmente para detectar gargalos.';
            } else {
                why = 'Tudo dentro do esperado — nenhum gargalo detectado.';
            }
            container.innerHTML = `<div class="dash-empty">${why}</div>`;
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
        // Wire links
        container.querySelectorAll('[data-tab]').forEach(a => {
            a.addEventListener('click', (e) => { e.preventDefault(); document.querySelectorAll('[data-tab="' + a.dataset.tab + '"]').forEach(b => b.click()); });
        });
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

    // Deadlines from Lab Tests + Projects
    _renderDeadlines() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const fmtRel = (dateStr) => {
            if (!dateStr) return '';
            const d = new Date(dateStr + 'T00:00:00');
            const diff = Math.round((d - today) / 86400000);
            if (diff < 0) return { label: `${Math.abs(diff)}d atrasado`, cls: 'overdue' };
            if (diff === 0) return { label: 'Hoje', cls: 'soon' };
            if (diff === 1) return { label: 'Amanhã', cls: 'soon' };
            if (diff <= 2) return { label: `${diff}d`, cls: 'soon' };
            if (diff <= 7) return { label: `${diff}d`, cls: 'upcoming' };
            return { label: dateStr, cls: 'far' };
        };

        const esc = (s) => String(s || '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

        // ── Lab Tests ──
        const testsContainer = document.getElementById('dash-deadlines-tests');
        if (testsContainer) {
            const labTests = (typeof LabTestsModule !== 'undefined') ? (LabTestsModule._tests || []) : [];
            const items = [];
            labTests.forEach(t => {
                if (t.status !== 'ativo') return;
                if (t.dateEnd) {
                    const rel = fmtRel(t.dateEnd);
                    items.push({
                        date: t.dateEnd,
                        rel,
                        text: t.title || 'Teste sem título',
                        sub: 'Encerramento do teste',
                        icon: 'flask-conical',
                        testId: t.id,
                        kind: 'test-end'
                    });
                }
                (t.tasks || []).forEach(task => {
                    if (task.done || !task.dueDate) return;
                    const rel = fmtRel(task.dueDate);
                    items.push({
                        date: task.dueDate,
                        rel,
                        text: task.text,
                        sub: `Tarefa de "${t.title}"`,
                        icon: 'check-square',
                        testId: t.id,
                        kind: 'test-task'
                    });
                });
            });
            items.sort((a, b) => a.date.localeCompare(b.date));
            const top = items.slice(0, 8);
            if (!top.length) {
                testsContainer.innerHTML = '<p class="dash-empty">Nenhum prazo de teste ativo. <a href="#" class="dash-link" id="dash-deadlines-tests-empty-link">Criar teste no Laboratório →</a></p>';
                document.getElementById('dash-deadlines-tests-empty-link')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    document.querySelector('[data-tab="laboratorio"]')?.click();
                });
            } else {
                testsContainer.innerHTML = top.map(it => `
                    <div class="dash-deadline-item dash-deadline-${it.rel.cls}" data-test-id="${it.testId}">
                        <div class="dash-deadline-icon"><i data-lucide="${it.icon}" style="width:14px;height:14px"></i></div>
                        <div class="dash-deadline-body">
                            <div class="dash-deadline-text">${esc(it.text)}</div>
                            <div class="dash-deadline-sub">${esc(it.sub)} · ${it.date}</div>
                        </div>
                        <span class="dash-deadline-chip dash-deadline-chip-${it.rel.cls}">${esc(it.rel.label)}</span>
                    </div>
                `).join('');
                testsContainer.querySelectorAll('.dash-deadline-item').forEach(el => {
                    el.addEventListener('click', () => {
                        const id = el.dataset.testId;
                        document.querySelector('[data-tab="laboratorio"]')?.click();
                        setTimeout(() => {
                            if (typeof LabTestsModule !== 'undefined' && id) LabTestsModule._openModal(id);
                        }, 50);
                    });
                });
            }
        }

        // ── Projects ──
        const projContainer = document.getElementById('dash-deadlines-projects');
        if (projContainer) {
            const projects = (typeof AppState !== 'undefined' && AppState.allProjects) ? AppState.allProjects : [];
            const items = [];
            projects.forEach(p => {
                if (p.status === 'concluido') return;
                if (p.targetDate) {
                    const rel = fmtRel(p.targetDate);
                    items.push({
                        date: p.targetDate,
                        rel,
                        text: p.name || p.title || 'Projeto sem título',
                        sub: 'Prazo do projeto',
                        icon: 'rocket',
                        projId: p.id,
                        kind: 'project-target'
                    });
                }
                (p.tasks || []).forEach(task => {
                    if (task.done || !task.dueDate) return;
                    const rel = fmtRel(task.dueDate);
                    items.push({
                        date: task.dueDate,
                        rel,
                        text: task.text,
                        sub: `Tarefa de "${p.name || p.title}"`,
                        icon: 'check-square',
                        projId: p.id,
                        kind: 'project-task'
                    });
                });
            });
            items.sort((a, b) => a.date.localeCompare(b.date));
            const top = items.slice(0, 8);
            if (!top.length) {
                projContainer.innerHTML = '<p class="dash-empty">Nenhum prazo de projeto pendente. <a href="#" class="dash-link" id="dash-deadlines-proj-empty-link">Abrir Projetos →</a></p>';
                document.getElementById('dash-deadlines-proj-empty-link')?.addEventListener('click', (e) => {
                    e.preventDefault();
                    document.querySelector('[data-tab="projects"]')?.click();
                });
            } else {
                projContainer.innerHTML = top.map(it => `
                    <div class="dash-deadline-item dash-deadline-${it.rel.cls}" data-proj-id="${it.projId}">
                        <div class="dash-deadline-icon"><i data-lucide="${it.icon}" style="width:14px;height:14px"></i></div>
                        <div class="dash-deadline-body">
                            <div class="dash-deadline-text">${esc(it.text)}</div>
                            <div class="dash-deadline-sub">${esc(it.sub)} · ${it.date}</div>
                        </div>
                        <span class="dash-deadline-chip dash-deadline-chip-${it.rel.cls}">${esc(it.rel.label)}</span>
                    </div>
                `).join('');
                projContainer.querySelectorAll('.dash-deadline-item').forEach(el => {
                    el.addEventListener('click', () => {
                        document.querySelector('[data-tab="projects"]')?.click();
                    });
                });
            }
        }

        if (typeof lucide !== 'undefined') lucide.createIcons();
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

        if (events.length > 0) {
            container.innerHTML = events.map(e => `<div class="dash-cal-item"><span class="dash-cal-date">${formatDate(e.date)}</span><i data-lucide="${e.icon}" style="width:12px;height:12px;color:${e.color}"></i><span>${e.text}</span></div>`).join('');
        } else {
            const hasTests = (typeof LabTestsModule !== 'undefined' && LabTestsModule._tests?.length > 0);
            const hasProjects = (typeof PipelineModule !== 'undefined' && (PipelineModule.cards || []).length > 0);
            let why;
            if (!hasTests && !hasProjects) {
                why = 'Nenhum teste ou projeto cadastrado. <a href="#" data-tab="laboratorio" style="color:#8b5cf6">Criar teste →</a>';
            } else {
                why = 'Nenhum prazo esta semana. <a href="#" data-tab="laboratorio" style="color:#8b5cf6">Ver Laboratório →</a>';
            }
            container.innerHTML = `<div class="dash-empty">${why}</div>`;
            container.querySelectorAll('[data-tab]').forEach(a => {
                a.addEventListener('click', (e) => { e.preventDefault(); document.querySelectorAll('[data-tab="' + a.dataset.tab + '"]').forEach(b => b.click()); });
            });
        }
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

        if (ranked.length > 0) {
            container.innerHTML = ranked.map((p, i) => `<div class="dash-rank-item"><span class="dash-rank-pos">${i+1}</span><span class="dash-rank-name">${p.name}</span><span class="dash-rank-value">${this._fmtCurrency(p.budget)}</span></div>`).join('');
        } else {
            const totalBudget = entries.reduce((s, e) => s + (parseFloat(e.budget) || 0), 0);
            let why;
            if (entries.length === 0) {
                why = 'Sem entradas no Diário neste período. <a href="#" data-tab="diary" style="color:#8b5cf6">Adicionar entradas →</a>';
            } else if (totalBudget === 0) {
                why = 'Entradas do Diário sem campo "Budget" preenchido. <a href="#" data-tab="diary" style="color:#8b5cf6">Preencher gastos →</a>';
            } else {
                why = 'Sem dados.';
            }
            container.innerHTML = `<div class="dash-empty">${why}</div>`;
            container.querySelectorAll('[data-tab]').forEach(a => {
                a.addEventListener('click', (e) => { e.preventDefault(); document.querySelectorAll('[data-tab="' + a.dataset.tab + '"]').forEach(b => b.click()); });
            });
        }
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
    _getCalendarBaseEntries() {
        const region = this._calRegion;
        const calFilter = this._calProduct;
        const diary = AppState.diary || [];
        if (!region) {
            return diary.filter(e => {
                if (e.isCampaign) return false;
                if (calFilter !== 'todos' && e.productId !== calFilter) return false;
                return true;
            });
        }
        const subs = diary.filter(e => {
            if (!e.isCampaign) return false;
            if (e.region !== region) return false;
            if (calFilter !== 'todos' && e.productId !== calFilter) return false;
            return true;
        });
        const byKey = {};
        subs.forEach(s => {
            const key = `${s.date}|${s.productId}`;
            if (!byKey[key]) {
                byKey[key] = {
                    id: `cal_${key}`, date: s.date, productId: s.productId, storeId: s.storeId || '',
                    budget: 0, budgetConfigured: 0, sales: 0, revenue: 0,
                    impressions: 0, pageViews: 0, addToCart: 0, checkout: 0,
                    budgetCurrency: s.budgetCurrency, revenueCurrency: s.revenueCurrency || s.budgetCurrency,
                    cpcCurrency: s.cpcCurrency || s.budgetCurrency,
                    isCampaign: false, region,
                };
            }
            const a = byKey[key];
            a.budget += Number(s.budget || 0);
            a.budgetConfigured += Number(s.budgetConfigured || 0);
            a.sales += Number(s.sales || 0);
            a.revenue += Number(s.revenue || 0);
            a.impressions += Number(s.impressions || 0);
            a.pageViews += Number(s.pageViews || 0);
            a.addToCart += Number(s.addToCart || 0);
            a.checkout += Number(s.checkout || 0);
        });
        return Object.values(byKey).map(e => ({
            ...e,
            cpa: e.sales > 0 ? e.budget / e.sales : 0,
            cpc: 0,
        }));
    },

    _getCalendarRegionOptions() {
        const set = new Set();
        (AppState.diary || []).forEach(d => {
            if (d.isCampaign && d.region) set.add(d.region);
        });
        return Array.from(set).sort();
    },

    _renderMetricsCalendar() {
        const container = document.getElementById('dash-metrics-calendar');
        if (!container) return;

        // Trigger async Shopify fetch for real-metric tabs
        const needsReal = this._calMetric === 'cpaReal' || this._calMetric === 'salesReal' || this._calMetric === 'conversionCombined';
        const needsViews = this._calMetric === 'conversionCombined';
        const countryCodeReal = needsViews ? this._regionParaCountryCode(this._calRegion) : null;
        const countryKeyAtual = countryCodeReal ? `${this._startDate}|${this._endDate}|${countryCodeReal}` : '';

        const pendencias = [];
        if (needsReal && this._realSalesMap === null) pendencias.push(this._loadRealSalesMaps());
        if (needsViews && this._viewsMap === null) pendencias.push(this._loadViewsMap());
        if (countryCodeReal && this._realSalesMapPorPaisKey !== countryKeyAtual) pendencias.push(this._loadRealSalesMapPorPais(countryCodeReal));
        if (!countryCodeReal && this._realSalesMapPorPais !== null) { this._realSalesMapPorPais = null; this._realSalesMapPorPaisKey = ''; }
        if (countryCodeReal && this._viewsMapPorPaisKey !== countryKeyAtual) pendencias.push(this._loadViewsMapPorPais(countryCodeReal));
        if (!countryCodeReal && this._viewsMapPorPais !== null) { this._viewsMapPorPais = null; this._viewsMapPorPaisKey = ''; }

        if (pendencias.length) {
            container.innerHTML = '<div class="dash-empty">Carregando vendas Shopify...</div>';
            Promise.all(pendencias).then(() => this._renderMetricsCalendar());
            return;
        }

        // Use calendar's own product + region filter
        const calFilter = this._calProduct;
        const allEntries = this._getCalendarBaseEntries();
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

        // Métrica-base ativa + se está no modo Real (Shopify)
        const { baseDef: metricAtual, isReal } = this._metricBaseReal(this._calMetric);

        // Build product options — dropdown customizado (mostra plataforma FB/Google + conta de anúncio, igual ao ranking)
        const products = (AppState.products || []);
        const _badges = (p) => (typeof renderProductMetaBadges === 'function') ? renderProductMetaBadges(p) : '';
        const curProd = calFilter === 'todos' ? null : products.find(p => p.id === calFilter);
        const curLabelHtml = curProd
            ? `<span class="mcal-prod-dd-name">${escapeHtml(curProd.name)}</span>${_badges(curProd)}`
            : '<span class="mcal-prod-dd-name">Todos os Produtos</span>';
        const prodDdOptions =
            `<div class="mcal-prod-dd-opt${calFilter === 'todos' ? ' active' : ''}" data-value="todos"><span class="mcal-prod-dd-name">Todos os Produtos</span></div>` +
            products.map(p =>
                `<div class="mcal-prod-dd-opt${calFilter === p.id ? ' active' : ''}" data-value="${escapeHtml(p.id)}"><span class="mcal-prod-dd-name">${escapeHtml(p.name)}</span>${_badges(p)}</div>`
            ).join('');

        // Build region options from sub-entries that have region tags
        const regions = this._getCalendarRegionOptions();
        const regionLabel = (r) => (typeof RegionTags !== 'undefined' && RegionTags.labelPlain) ? RegionTags.labelPlain(r) : r;
        const regionOptions = regions.map(r =>
            `<option value="${r}"${this._calRegion === r ? ' selected' : ''}>${regionLabel(r)}</option>`
        ).join('');

        const headerHtml = `
        <div class="mcal-header-bar">
            <div class="mcal-tabs">${this._METRIC_BASES.map(b =>
                `<button class="mcal-tab${metricAtual.base === b.base ? ' active' : ''}" data-base="${b.base}">${b.label}</button>`
            ).join('')}</div>
            ${metricAtual.real ? `
            <div class="mcal-src-toggle" role="group" aria-label="Fonte dos dados">
                <button class="mcal-src-btn${!isReal ? ' active' : ''}" data-real="0" title="Vendas estimadas pelo pixel do Facebook">Facebook</button>
                <button class="mcal-src-btn${isReal ? ' active' : ''}" data-real="1" title="Vendas reais da sua loja Shopify">Real (Shopify)</button>
            </div>` : ''}
            <div class="mcal-prod-dd" id="mcal-product-dd">
                <button type="button" class="mcal-product-select mcal-prod-dd-btn" id="mcal-prod-dd-btn">
                    <span class="mcal-prod-dd-cur">${curLabelHtml}</span>
                    <i data-lucide="chevron-down" style="width:14px;height:14px;flex-shrink:0;opacity:.6"></i>
                </button>
                <div class="mcal-prod-dd-panel hidden" id="mcal-prod-dd-panel">
                    <input type="text" class="mcal-prod-dd-search" id="mcal-prod-dd-search" placeholder="Buscar produto...">
                    <div class="mcal-prod-dd-list">${prodDdOptions}</div>
                </div>
            </div>
            <select class="mcal-product-select" id="mcal-region"${regions.length === 0 ? ' disabled title="Sem campanhas com tag de país"' : ''}>
                <option value=""${this._calRegion === '' ? ' selected' : ''}>Todos os países</option>
                ${regionOptions}
            </select>
        </div>
        ${this._calMetric === 'conversionCombined' ? `<p class="mcal-conv-fonte">Real = vendas reais da Shopify ÷ visitas do produto na Shopify (Shopify Analytics). Com um país selecionado, usa as visitas E as vendas <strong>daquele país</strong>. Tags combinadas (ex. "EN" = vários países) não filtram os dados reais.</p>` : ''}`;

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

        // Month summary footer (totals for the selected period + compare delta)
        const summaryHtml = this._renderCalSummary();

        container.innerHTML = headerHtml + navHtml + '<div class="mcal-months-wrapper">' + monthHtml + '</div>' + summaryHtml;

        // Abas de métrica-base — mantém o modo Real se a nova métrica também tiver
        container.querySelectorAll('.mcal-tab').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const def = this._METRIC_BASES.find(b => b.base === btn.dataset.base);
                if (!def) return;
                const { isReal } = this._metricBaseReal(this._calMetric);
                this._setCalMetric((isReal && def.real) ? def.real : def.base);
                this._renderMetricsCalendar();
            });
        });
        // Toggle de fonte (Facebook estimado ⟷ Real da Shopify)
        container.querySelectorAll('.mcal-src-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const { baseDef } = this._metricBaseReal(this._calMetric);
                const querReal = btn.dataset.real === '1';
                this._setCalMetric((querReal && baseDef.real) ? baseDef.real : baseDef.base);
                this._renderMetricsCalendar();
            });
        });

        // Product dropdown customizado (mostra badges de plataforma + conta de anúncio)
        const ddBtn = container.querySelector('#mcal-prod-dd-btn');
        const ddPanel = container.querySelector('#mcal-prod-dd-panel');
        const ddSearch = container.querySelector('#mcal-prod-dd-search');
        ddBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const willOpen = ddPanel.classList.contains('hidden');
            ddPanel.classList.toggle('hidden');
            if (willOpen) setTimeout(() => ddSearch?.focus(), 0);
        });
        container.querySelectorAll('.mcal-prod-dd-opt').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                this._calProduct = opt.dataset.value;
                this._renderMetricsCalendar();
            });
        });
        ddSearch?.addEventListener('click', (e) => e.stopPropagation());
        ddSearch?.addEventListener('input', (e) => {
            const q = (e.target.value || '').toLowerCase();
            container.querySelectorAll('.mcal-prod-dd-opt').forEach(opt => {
                if (opt.dataset.value === 'todos') { opt.style.display = q ? 'none' : ''; return; }
                opt.style.display = opt.textContent.toLowerCase().includes(q) ? '' : 'none';
            });
        });
        // Fecha ao clicar fora (um único listener, substituído a cada render)
        if (this._calDdCloser) document.removeEventListener('click', this._calDdCloser);
        this._calDdCloser = (ev) => {
            if (!ev.target.closest('#mcal-product-dd')) {
                document.getElementById('mcal-prod-dd-panel')?.classList.add('hidden');
            }
        };
        document.addEventListener('click', this._calDdCloser);

        // Region select handler
        container.querySelector('#mcal-region')?.addEventListener('change', (e) => {
            this._calRegion = e.target.value;
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

    // Summary footer for the metrics calendar — shows period total and compare delta
    // for the currently-selected metric, respecting the calendar's product filter.
    _renderCalSummary() {
        const metric = this._calMetric;
        const pid = this._calProduct;
        const entriesAll = this._getCalendarBaseEntries();
        const filterByPid = (arr) => pid === 'todos' ? arr : arr.filter(e => e.productId === pid);
        const inRange = (arr, s, e) => arr.filter(x => x.date >= s && x.date <= e);

        const curEntries = filterByPid(inRange(entriesAll, this._startDate, this._endDate));
        const agg = this._aggregate(curEntries);

        const compareActive = this._compareMode !== 'none' && this._compareStart && this._compareEnd;
        const prevEntries = compareActive ? filterByPid(inRange(entriesAll, this._compareStart, this._compareEnd)) : [];
        const prevAgg = this._aggregate(prevEntries);

        const realCur = this._sumRealSales(this._realSalesMap, pid, this._startDate, this._endDate);
        const realPrev = compareActive ? this._sumRealSales(this._realSalesPrevMap, pid, this._compareStart, this._compareEnd) : { sales: 0, revenue: 0 };

        let label = '', value = '', prevValue = null, inverse = false, percent = true;
        let realConvNumForDelta = 0; // preenchido no case conversionCombined, lido de novo no numericCur abaixo

        const fmtMoney = (v) => (this._currency === 'BRL' ? 'R$' : '$') + this._compactNum(v);

        switch (metric) {
            case 'cpa':
                label = 'CPA médio';
                value = agg.sales > 0 ? fmtMoney(this._currency === 'BRL' ? agg.cpaBRL : agg.cpa) : '--';
                prevValue = prevAgg.sales > 0 ? (this._currency === 'BRL' ? prevAgg.cpaBRL : prevAgg.cpa) : 0;
                inverse = true;
                break;
            case 'cpaReal': {
                label = 'CPA + Real';
                const metaCpa = agg.sales > 0 ? (this._currency === 'BRL' ? agg.cpaBRL : agg.cpa) : 0;
                const cpaR = realCur.sales > 0 ? (this._currency === 'BRL' ? agg.budgetBRL : agg.budget) / realCur.sales : 0;
                const metaTxt = metaCpa > 0 ? fmtMoney(metaCpa) : '--';
                const realTxt = cpaR > 0 ? fmtMoney(cpaR) : '--';
                value = `Meta ${metaTxt} · Real ${realTxt}`;
                prevValue = realPrev.sales > 0 ? (this._currency === 'BRL' ? prevAgg.budgetBRL : prevAgg.budget) / realPrev.sales : 0;
                inverse = true;
                break;
            }
            case 'profit':
                label = 'Lucro do período';
                const profit = this._currency === 'BRL' ? (agg.revenueBRL - agg.budgetBRL) : agg.profit;
                value = (profit < 0 ? '-' : '') + fmtMoney(Math.abs(profit));
                prevValue = this._currency === 'BRL' ? (prevAgg.revenueBRL - prevAgg.budgetBRL) : prevAgg.profit;
                break;
            case 'revenue':
                label = 'Receita total';
                value = fmtMoney(this._currency === 'BRL' ? agg.revenueBRL : agg.revenue);
                prevValue = this._currency === 'BRL' ? prevAgg.revenueBRL : prevAgg.revenue;
                break;
            case 'sales':
                label = 'Vendas (Meta)';
                value = agg.sales + (agg.sales === 1 ? ' venda' : ' vendas');
                prevValue = prevAgg.sales;
                percent = false;
                break;
            case 'salesReal': {
                label = 'Vendas + Real';
                value = `Meta ${agg.sales || 0} · Real ${realCur.sales || 0}`;
                prevValue = realPrev.sales;
                percent = false;
                break;
            }
            case 'conversionCombined': {
                label = 'Conversão + Real';
                // Meta = estimativa do Facebook (visitantes do diário, com o
                // fallback de atc/checkout/sale rate de sempre). Real = vendas
                // reais da Shopify ÷ VISITAS REAIS do produto na Shopify — não
                // mais dividido por agg.pageViews (visitas do Facebook), que
                // era o bug: misturava fonte no denominador da métrica "Real".
                const computeConvMeta = (entries, aggData) => {
                    let pct = aggData.pageViews > 0 ? (aggData.sales / aggData.pageViews) * 100 : 0;
                    if (pct === 0) {
                        let sum = 0, n = 0;
                        entries.forEach(e => {
                            const atc = Number(e.atcRate || 0);
                            const co = Number(e.checkoutRate || 0);
                            const sr = Number(e.saleRate || 0);
                            if (atc > 0 && co > 0 && sr > 0) { sum += (atc * co * sr) / 10000; n++; }
                        });
                        if (n > 0) pct = sum / n;
                    }
                    return pct;
                };
                const metaConv = computeConvMeta(curEntries, agg);
                const metaTxt = metaConv > 0 ? metaConv.toFixed(2) + '%' : '--';

                let realTxt;
                if (this._calRegion) {
                    // Com país: Real = vendas do país ÷ visitas do país (ambos
                    // da Shopify). Tag composta não vira country_code único.
                    const countryCode = this._regionParaCountryCode(this._calRegion);
                    if (!countryCode) {
                        realTxt = `indisponível (país "${this._calRegion}" é tag composta)`;
                    } else {
                        const vendasPais = this._sumRealSales(this._realSalesMapPorPais, pid, this._startDate, this._endDate).sales;
                        const viewsPais = this._sumViews(this._viewsMapPorPais, pid, this._startDate, this._endDate);
                        if (viewsPais === 0) {
                            realTxt = vendasPais > 0 ? `${vendasPais} venda(s) em ${this._calRegion}, sem visitas Shopify` : '--';
                        } else {
                            realConvNumForDelta = (vendasPais / viewsPais) * 100;
                            realTxt = realConvNumForDelta.toFixed(2) + '%';
                        }
                    }
                } else {
                    const viewsCur = this._sumViews(this._viewsMap, pid, this._startDate, this._endDate);
                    if (viewsCur === 0) {
                        realTxt = realCur.sales > 0 ? `${realCur.sales} venda(s), sem visitas Shopify` : '--';
                    } else {
                        realConvNumForDelta = (realCur.sales / viewsCur) * 100;
                        realTxt = realConvNumForDelta.toFixed(2) + '%';
                    }
                }
                value = `Meta ${metaTxt} · Real ${realTxt}`;

                if (compareActive && !this._calRegion) {
                    const viewsPrev = this._sumViews(this._viewsMap, pid, this._compareStart, this._compareEnd);
                    prevValue = viewsPrev > 0 ? (realPrev.sales / viewsPrev) * 100 : 0;
                } else {
                    prevValue = 0;
                }
                percent = false;
                break;
            }
            case 'budget':
                label = 'Gastos';
                value = fmtMoney(this._currency === 'BRL' ? agg.budgetBRL : agg.budget);
                prevValue = this._currency === 'BRL' ? prevAgg.budgetBRL : prevAgg.budget;
                inverse = true;
                break;
            case 'cpm':
                label = 'CPM médio';
                const cpm = agg.impressions > 0 ? ((this._currency === 'BRL' ? agg.budgetBRL : agg.budget) / agg.impressions) * 1000 : 0;
                value = agg.impressions > 0 ? fmtMoney(cpm) : '--';
                prevValue = prevAgg.impressions > 0 ? ((this._currency === 'BRL' ? prevAgg.budgetBRL : prevAgg.budget) / prevAgg.impressions) * 1000 : 0;
                inverse = true;
                break;
            case 'cpc':
                label = 'CPC médio';
                let totBud = 0, totClicks = 0;
                curEntries.forEach(e => { if ((e.cpc || 0) > 0 && e.budget) { totBud += (this._currency === 'BRL' ? (e.budgetCurrency === 'BRL' ? e.budget : convertToBRL(e.budget, e.budgetCurrency)) : convertToUSD(e.budget, e.budgetCurrency)); totClicks += e.budget / e.cpc; } });
                const cpcVal = totClicks > 0 ? totBud / totClicks : 0;
                value = totClicks > 0 ? fmtMoney(cpcVal) : '--';
                let pTotBud = 0, pTotClicks = 0;
                prevEntries.forEach(e => { if ((e.cpc || 0) > 0 && e.budget) { pTotBud += (this._currency === 'BRL' ? (e.budgetCurrency === 'BRL' ? e.budget : convertToBRL(e.budget, e.budgetCurrency)) : convertToUSD(e.budget, e.budgetCurrency)); pTotClicks += e.budget / e.cpc; } });
                prevValue = pTotClicks > 0 ? pTotBud / pTotClicks : 0;
                inverse = true;
                break;
            case 'conversion': {
                label = 'Conversão (Vendas/Visitantes)';
                const computeConv = (entries, aggData) => {
                    let pct = aggData.pageViews > 0 ? (aggData.sales / aggData.pageViews) * 100 : 0;
                    if (pct === 0) {
                        let sum = 0, n = 0;
                        entries.forEach(e => {
                            const atc = Number(e.atcRate || 0);
                            const co = Number(e.checkoutRate || 0);
                            const sr = Number(e.saleRate || 0);
                            if (atc > 0 && co > 0 && sr > 0) { sum += (atc * co * sr) / 10000; n++; }
                        });
                        if (n > 0) pct = sum / n;
                    }
                    return pct;
                };
                const convCur = computeConv(curEntries, agg);
                value = convCur > 0 ? convCur.toFixed(2) + '%' : '--';
                prevValue = compareActive ? computeConv(prevEntries, prevAgg) : 0;
                percent = false; // delta shown as absolute pct points, not percent change
                break;
            }
            default:
                return '';
        }

        let numericCur;
        if (typeof value === 'string' && value !== '--') {
            // For delta we need the numeric value — recompute from prev logic where needed
            numericCur = (() => {
                if (metric === 'profit') return this._currency === 'BRL' ? (agg.revenueBRL - agg.budgetBRL) : agg.profit;
                if (metric === 'revenue') return this._currency === 'BRL' ? agg.revenueBRL : agg.revenue;
                if (metric === 'sales') return agg.sales;
                if (metric === 'salesReal') return realCur.sales;
                if (metric === 'budget') return this._currency === 'BRL' ? agg.budgetBRL : agg.budget;
                if (metric === 'cpa') return agg.sales > 0 ? (this._currency === 'BRL' ? agg.cpaBRL : agg.cpa) : 0;
                if (metric === 'cpaReal') return realCur.sales > 0 ? (this._currency === 'BRL' ? agg.budgetBRL : agg.budget) / realCur.sales : 0;
                if (metric === 'cpm') return agg.impressions > 0 ? ((this._currency === 'BRL' ? agg.budgetBRL : agg.budget) / agg.impressions) * 1000 : 0;
                if (metric === 'cpc') {
                    let b = 0, c = 0;
                    curEntries.forEach(e => { if ((e.cpc || 0) > 0 && e.budget) { b += (this._currency === 'BRL' ? (e.budgetCurrency === 'BRL' ? e.budget : convertToBRL(e.budget, e.budgetCurrency)) : convertToUSD(e.budget, e.budgetCurrency)); c += e.budget / e.cpc; } });
                    return c > 0 ? b / c : 0;
                }
                if (metric === 'conversion') {
                    let pct = agg.pageViews > 0 ? (agg.sales / agg.pageViews) * 100 : 0;
                    if (pct === 0) {
                        let sum = 0, n = 0;
                        curEntries.forEach(e => {
                            const atc = Number(e.atcRate || 0);
                            const co = Number(e.checkoutRate || 0);
                            const sr = Number(e.saleRate || 0);
                            if (atc > 0 && co > 0 && sr > 0) { sum += (atc * co * sr) / 10000; n++; }
                        });
                        if (n > 0) pct = sum / n;
                    }
                    return pct;
                }
                // For combined "Meta + Real" tabs, delta is computed on the Real value
                // (já calculado no case acima, com o denominador certo — visitas
                // reais da Shopify, não agg.pageViews).
                if (metric === 'conversionCombined') {
                    return realConvNumForDelta;
                }
                return 0;
            })();
        }

        const deltaHtml = compareActive ? this._fmtDelta(numericCur || 0, prevValue || 0, { inverse, percent }) : '';
        const compareLabel = compareActive ? `<span class="mcal-summary-compare">vs ${formatDate(this._compareStart)} – ${formatDate(this._compareEnd)}</span>` : '';

        return `<div class="mcal-summary">
            <span class="mcal-summary-label">${label}</span>
            <span class="mcal-summary-value">${value}${deltaHtml}</span>
            ${compareLabel}
        </div>`;
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

        const isRealMetric = this._calMetric === 'cpaReal' || this._calMetric === 'salesReal' || this._calMetric === 'conversionCombined';
        for (let day = 1; day <= totalDays; day++) {
            const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isToday    = ds === todayStr;
            const isFuture   = ds > todayStr;
            const dayEntries = byDate[ds] || [];
            // Dias com venda REAL (Shopify) contam como "tem dado" mesmo sem entrada no Diário (FB/Meta).
            // Sem isto, dias só-Shopify (ex.: FB parou de sincronizar) apareciam em branco no calendário.
            let hasReal = false;
            if (isRealMetric && !isFuture) {
                const r = this._sumRealSales(this._realSalesMap, this._calProduct || 'todos', ds, ds);
                hasReal = (r.sales > 0 || r.revenue > 0);
            }
            const hasData    = !isFuture && (dayEntries.length > 0 || hasReal);

            let numCls  = isFuture ? 'mcal-dim' : '';
            let todayCls = isToday ? ' mcal-today' : '';
            let valHtml = '';

            if (hasData) {
                const mv = this._getDayMetricValue(dayEntries, this._calMetric, isSingleProduct, targetCpaUSD, ds);
                valHtml = `<span class="mcal-day-val ${mv.cls}">${mv.text}</span>`;
            }

            html += `<div class="mcal-day${todayCls}"><span class="mcal-day-num ${numCls}">${day}</span>${valHtml}</div>`;
        }

        html += '</div></div>';
        return html;
    },

    _getDayMetricValue(dayEntries, metric, isSingleProduct, targetCpaUSD, dayStr) {
        const agg = this._aggregate(dayEntries);

        // Combined "Meta + Real" metrics: Real is the headline value, Meta is shown
        // as small reference above. Color of Real = direction vs Meta (green=better,
        // red=worse). Days with no Real fall back to Meta-only (cleaner than showing
        // a "R --" placeholder).
        if (metric === 'cpaReal' || metric === 'salesReal' || metric === 'conversionCombined') {
            const pid = this._calProduct || 'todos';
            let real = this._sumRealSales(this._realSalesMap, pid, dayStr, dayStr);
            // Fallback: if live Shopify map has nothing (products not linked, or not fetched yet),
            // use sales synced into the Diary (salesSource:'shopify' or shopifySales field).
            if (!real || real.sales === 0) {
                const shopEntries = dayEntries.filter(e =>
                    e.salesSource === 'shopify' || (Number(e.shopifySales) || 0) > 0
                );
                if (shopEntries.length) {
                    const s = shopEntries.reduce((a, e) => a + (Number(e.shopifySales ?? e.sales) || 0), 0);
                    const r = shopEntries.reduce((a, e) => {
                        const rev = Number(e.shopifyRevenue ?? e.revenue) || 0;
                        return a + (typeof convertToUSD === 'function' ? convertToUSD(rev, e.shopifyRevenueCurrency || e.revenueCurrency || 'BRL') : rev);
                    }, 0);
                    real = { sales: s, revenue: r };
                }
            }
            const prefix = this._currency === 'BRL' ? 'R$' : '$';

            const renderCombined = (metaVal, realVal, fmt, lowerIsBetter) => {
                const hasMeta = metaVal > 0;
                const hasReal = realVal > 0;
                if (!hasMeta && !hasReal) return { text: '--', cls: 'mcal-val-muted' };

                // Real-only or Meta-only: just show that single value, no comparison line
                if (hasReal && !hasMeta) {
                    return { text: fmt(realVal), cls: 'mcal-val-accent' };
                }
                if (hasMeta && !hasReal) {
                    return {
                        text: `${fmt(metaVal)}<span class="mcal-meta-sub">Sem real</span>`,
                        cls: 'mcal-val-neutral'
                    };
                }

                // Both present: color Real based on whether it beats Meta
                const better = lowerIsBetter ? (realVal <= metaVal) : (realVal >= metaVal);
                const cls = better ? 'mcal-val-green' : 'mcal-val-red';
                return {
                    text: `<span class="mcal-meta-sub">Meta ${fmt(metaVal)}</span>${fmt(realVal)}`,
                    cls
                };
            };

            if (metric === 'cpaReal') {
                const metaCpa = agg.sales > 0 ? (this._currency === 'BRL' ? agg.cpaBRL : agg.cpa) : 0;
                const realCpa = real.sales > 0 ? (this._currency === 'BRL' ? agg.budgetBRL / real.sales : agg.budget / real.sales) : 0;
                return renderCombined(metaCpa, realCpa, (v) => prefix + this._compactNum(v), /*lowerIsBetter*/ true);
            }

            if (metric === 'salesReal') {
                return renderCombined(agg.sales || 0, real.sales || 0, (v) => String(Math.round(v)), /*lowerIsBetter*/ false);
            }

            if (metric === 'conversionCombined') {
                const pv = agg.pageViews;
                // Meta (Conversão) = vendas reportadas pelo FB ÷ visitantes (usa fbSales se houver)
                const fbSalesSum = dayEntries.reduce((a, e) => a + (Number(e.fbSales ?? (e.salesSource === 'shopify' ? 0 : e.sales)) || 0), 0);
                const metaConv = pv > 0 ? (fbSalesSum / pv) * 100 : 0;

                // Com país selecionado: usa vendas E visitas DAQUELE país
                // (mesma fonte real da Shopify nos dois lados). Tag composta
                // (ex.: "EN" = vários países) não vira country_code único,
                // então aí sim não dá pra filtrar os dados reais.
                if (this._calRegion) {
                    const countryCode = this._regionParaCountryCode(this._calRegion);
                    if (!countryCode) {
                        return { text: `${metaConv > 0 ? metaConv.toFixed(2) + '%' : '--'}<span class="mcal-meta-sub">"${escapeHtml(this._calRegion)}" é tag composta — não filtra dados reais</span>`, cls: 'mcal-val-neutral' };
                    }
                    const vendasPais = this._sumRealSales(this._realSalesMapPorPais, pid, dayStr, dayStr).sales;
                    const viewsPais = this._sumViews(this._viewsMapPorPais, pid, dayStr, dayStr);
                    if (viewsPais === 0) {
                        if (vendasPais > 0) return { text: `${vendasPais}<span class="mcal-meta-sub">Sem visitas Shopify em ${escapeHtml(this._calRegion)}</span>`, cls: 'mcal-val-neutral' };
                        return renderCombined(metaConv, 0, (v) => v.toFixed(2) + '%', /*lowerIsBetter*/ false);
                    }
                    const realConvPais = (vendasPais / viewsPais) * 100;
                    return renderCombined(metaConv, realConvPais, (v) => v.toFixed(2) + '%', /*lowerIsBetter*/ false);
                }

                // Real = vendas reais da Shopify ÷ VISITAS REAIS do produto na
                // Shopify (fetchProductViewsByDate) — não mais dividido por pv
                // (visitas do Facebook), que misturava fonte no denominador.
                const views = this._sumViews(this._viewsMap, pid, dayStr, dayStr);
                if (views === 0) {
                    if (real.sales > 0) {
                        return { text: `${real.sales}<span class="mcal-meta-sub">Sem visitas Shopify</span>`, cls: 'mcal-val-neutral' };
                    }
                    return renderCombined(metaConv, 0, (v) => v.toFixed(2) + '%', /*lowerIsBetter*/ false);
                }
                const realConv = (real.sales / views) * 100;
                return renderCombined(metaConv, realConv, (v) => v.toFixed(2) + '%', /*lowerIsBetter*/ false);
            }
        }

        if (metric === 'budget') {
            if (agg.budget === 0) return { text: '--', cls: 'mcal-val-muted' };
            const val = this._currency === 'BRL' ? agg.budgetBRL : agg.budget;
            const prefix = this._currency === 'BRL' ? 'R$' : '$';
            return { text: prefix + this._compactNum(val), cls: 'mcal-val-neutral' };
        }

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

        if (metric === 'conversion') {
            let pct = agg.pageViews > 0 ? (agg.sales / agg.pageViews) * 100 : 0;
            // Fallback: derive from stored rate chain (BM that only exports rates)
            if (pct === 0) {
                let chainSum = 0, chainCount = 0;
                dayEntries.forEach(e => {
                    const atc = Number(e.atcRate || 0);
                    const co = Number(e.checkoutRate || 0);
                    const sr = Number(e.saleRate || 0);
                    if (atc > 0 && co > 0 && sr > 0) {
                        chainSum += (atc * co * sr) / 10000;
                        chainCount++;
                    }
                });
                if (chainCount > 0) pct = chainSum / chainCount;
            }
            if (pct <= 0) return { text: '--', cls: 'mcal-val-muted' };
            const text = pct.toFixed(2) + '%';
            if (pct >= 2) return { text, cls: 'mcal-val-green' };
            if (pct >= 1) return { text, cls: 'mcal-val-yellow' };
            return { text, cls: 'mcal-val-red' };
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
