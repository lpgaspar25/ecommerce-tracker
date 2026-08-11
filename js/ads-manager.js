/* ===========================
   AdsManager — Gerenciador 2.0 estilo Madgicx
   - Tabs: Campanhas | Conjuntos | Anúncios
   - On/Off toggle, edit budget inline
   - Performance: spend, impressions, CPM, CTR, ROAS (purchase value / spend)
   - Filtros: conta, busca, date range
   - Bulk select + activate/pause
   =========================== */
(function () {
    const AdsManager = {
        state: {
            level: 'campaign',
            dateRange: 'last_7d',
            search: '',
            accountId: '',
            rows: [],
            insights: {},
            activities: {},         // { object_id: [{event_type, event_time, object_name}] }
            selected: new Set(),
            sortBy: 'spend',
            sortDir: 'desc',
            loading: false,
            cache: {},
            cacheTTL: 60_000,
            // Drill-down filter (parent constraint when switching levels)
            parentFilter: null,     // { level: 'campaign'|'adset', id, name }
        },

        // Columns definition por level
        columns: {
            campaign: [
                { key: 'select',    label: '',                   width: 36 },
                { key: 'status',    label: 'On/Off',             width: 70 },
                { key: 'name',      label: 'Nome',               sortable: true },
                { key: 'latest_actions', label: 'Ações',         width: 130 },
                { key: 'objective', label: 'Objetivo',           width: 110, sortable: true },
                { key: 'budget',    label: 'Orçamento',          width: 110, align: 'right', sortable: true },
                { key: 'spend',     label: 'Gasto',              width: 110, align: 'right', sortable: true },
                { key: 'impressions', label: 'Impressões',       width: 110, align: 'right', sortable: true },
                { key: 'ctr',       label: 'CTR',                width: 80,  align: 'right', sortable: true },
                { key: 'cpm',       label: 'CPM',                width: 90,  align: 'right', sortable: true },
                { key: 'purchases', label: 'Compras',            width: 90,  align: 'right', sortable: true },
                { key: 'roas',      label: 'ROAS',               width: 90,  align: 'right', sortable: true },
                { key: 'actions',   label: '',                   width: 70 },
            ],
            adset: [
                { key: 'select',    label: '',                   width: 36 },
                { key: 'status',    label: 'On/Off',             width: 70 },
                { key: 'name',      label: 'Nome',               sortable: true },
                { key: 'latest_actions', label: 'Ações',         width: 130 },
                { key: 'campaign',  label: 'Campanha',           width: 160 },
                { key: 'budget',    label: 'Orçamento',          width: 110, align: 'right', sortable: true },
                { key: 'spend',     label: 'Gasto',              width: 110, align: 'right', sortable: true },
                { key: 'impressions', label: 'Impressões',       width: 110, align: 'right', sortable: true },
                { key: 'ctr',       label: 'CTR',                width: 80,  align: 'right', sortable: true },
                { key: 'cpm',       label: 'CPM',                width: 90,  align: 'right', sortable: true },
                { key: 'purchases', label: 'Compras',            width: 90,  align: 'right', sortable: true },
                { key: 'roas',      label: 'ROAS',               width: 90,  align: 'right', sortable: true },
                { key: 'actions',   label: '',                   width: 70 },
            ],
            ad: [
                { key: 'select',    label: '',                   width: 36 },
                { key: 'status',    label: 'On/Off',             width: 70 },
                { key: 'preview',   label: '',                   width: 56 },
                { key: 'name',      label: 'Nome',               sortable: true },
                { key: 'latest_actions', label: 'Ações',         width: 130 },
                { key: 'spend',     label: 'Gasto',              width: 110, align: 'right', sortable: true },
                { key: 'impressions', label: 'Impressões',       width: 110, align: 'right', sortable: true },
                { key: 'ctr',       label: 'CTR',                width: 80,  align: 'right', sortable: true },
                { key: 'cpm',       label: 'CPM',                width: 90,  align: 'right', sortable: true },
                { key: 'purchases', label: 'Compras',            width: 90,  align: 'right', sortable: true },
                { key: 'roas',      label: 'ROAS',               width: 90,  align: 'right', sortable: true },
                { key: 'actions',   label: '',                   width: 70 },
            ],
            audience: [
                { key: 'aud_name',    label: 'Audiência / Quebra', sortable: true },
                { key: 'aud_type',    label: 'Tipo',               width: 110 },
                { key: 'spend',       label: 'Gasto',              width: 110, align: 'right', sortable: true },
                { key: 'impressions', label: 'Impressões',         width: 110, align: 'right', sortable: true },
                { key: 'ctr',         label: 'CTR',                width: 80,  align: 'right', sortable: true },
                { key: 'cpc',         label: 'CPC',                width: 90,  align: 'right', sortable: true },
                { key: 'cpm',         label: 'CPM',                width: 90,  align: 'right', sortable: true },
                { key: 'addtocart',   label: 'Add Cart',           width: 90,  align: 'right', sortable: true },
                { key: 'purchases',   label: 'Compras',            width: 90,  align: 'right', sortable: true },
                { key: 'cpa',         label: 'CPA',                width: 100, align: 'right', sortable: true },
                { key: 'roas',        label: 'ROAS',               width: 90,  align: 'right', sortable: true },
            ],
        },

        init() {
            if (document.readyState !== 'loading') this._setup();
            else document.addEventListener('DOMContentLoaded', () => this._setup());
        },

        _setup() {
            this._bindUI();
            if (typeof EventBus !== 'undefined') {
                EventBus.on('tabChanged', (tab) => {
                    if (tab === 'ads-manager') this.refresh();
                });
            }
            if (this._isActive()) setTimeout(() => this.refresh(), 50);
        },

        _isActive() {
            return document.getElementById('tab-ads-manager')?.classList.contains('active');
        },

        _bindUI() {
            document.querySelectorAll('[data-adm-level]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const newLevel = btn.dataset.admLevel;
                    // Audience é independente — limpa filtros e seleções
                    if (newLevel === 'audience') {
                        this.state.parentFilter = null;
                        this.state.selected.clear();
                        this.state.level = newLevel;
                        document.querySelectorAll('[data-adm-level]').forEach(b => b.classList.toggle('adm-tab-active', b === btn));
                        this._loadRows();
                        return;
                    }
                    // Drill-down: se tem selecionados no nível atual, vira filtro
                    const order = ['campaign', 'adset', 'ad'];
                    const curIdx = order.indexOf(this.state.level);
                    const newIdx = order.indexOf(newLevel);
                    if (newIdx > curIdx && this.state.selected.size > 0) {
                        // descer um nível com filtro
                        const firstId = Array.from(this.state.selected)[0];
                        const row = this.state.rows.find(r => r.id === firstId);
                        this.state.parentFilter = {
                            level: this.state.level,
                            id: firstId,
                            ids: Array.from(this.state.selected),
                            name: row?.name || firstId,
                        };
                    } else if (newIdx <= curIdx) {
                        // subiu ou ficou no mesmo nível — limpa filtro
                        this.state.parentFilter = null;
                    }
                    this.state.level = newLevel;
                    document.querySelectorAll('[data-adm-level]').forEach(b => b.classList.toggle('adm-tab-active', b === btn));
                    this.state.selected.clear();
                    this._loadRows();
                });
            });

            // Clear filter chip
            document.addEventListener('click', (e) => {
                if (e.target.closest('#adm-filter-clear')) {
                    this.state.parentFilter = null;
                    this._loadRows();
                }
            });

            document.getElementById('adm-account-select')?.addEventListener('change', (e) => {
                if (typeof FacebookAds !== 'undefined') {
                    FacebookAds.config.activeAdAccountId = e.target.value;
                    FacebookAds.saveConfig();
                }
                this.state.cache = {};
                this._loadRows();
            });
            document.getElementById('adm-search')?.addEventListener('input', (e) => {
                this.state.search = (e.target.value || '').toLowerCase();
                this._render();
            });
            document.getElementById('adm-date-range')?.addEventListener('change', (e) => {
                this.state.dateRange = e.target.value;
                this.state.cache = {};
                this._loadRows();
            });
            document.getElementById('adm-btn-refresh')?.addEventListener('click', () => {
                this.state.cache = {};
                this._loadRows();
            });
            document.getElementById('adm-btn-config')?.addEventListener('click', () => {
                if (typeof FacebookAds !== 'undefined' && FacebookAds._openConfigModal) {
                    FacebookAds._openConfigModal();
                }
            });

            document.querySelectorAll('[data-adm-bulk]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const action = btn.dataset.admBulk;
                    if (action === 'clear') {
                        this.state.selected.clear();
                        this._render();
                        return;
                    }
                    this._bulkStatus(action === 'activate' ? 'ACTIVE' : 'PAUSED');
                });
            });
        },

        refresh() {
            const connected = typeof FacebookAds !== 'undefined' && FacebookAds.isConnected();
            const fbCard = document.getElementById('adm-fb-card');
            const toolbar = document.getElementById('adm-toolbar');
            const tableWrap = document.getElementById('adm-table-wrap');
            if (!connected) {
                if (fbCard) fbCard.style.display = '';
                if (toolbar) toolbar.style.display = 'none';
                if (tableWrap) tableWrap.style.display = 'none';
                return;
            }
            if (fbCard) fbCard.style.display = 'none';
            if (toolbar) toolbar.style.display = '';
            if (tableWrap) tableWrap.style.display = '';

            this._populateAccounts();
            this._loadRows();
        },

        _populateAccounts() {
            const sel = document.getElementById('adm-account-select');
            if (!sel) return;
            const accs = FacebookAds.config.adAccounts || [];
            sel.innerHTML = accs.map(a => `<option value="${a.id}">${this._esc(a.name)} (act_${a.id})</option>`).join('');
            sel.value = FacebookAds.config.activeAdAccountId || (accs[0]?.id || '');
            this.state.accountId = sel.value;
        },

        _dateRangeObj() {
            const today = new Date();
            const fmt = (d) => d.toISOString().slice(0, 10);
            const sub = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };
            switch (this.state.dateRange) {
                case 'today': return { since: fmt(today), until: fmt(today) };
                case 'yesterday': { const y = sub(1); return { since: fmt(y), until: fmt(y) }; }
                case 'last_3d': return { since: fmt(sub(2)), until: fmt(today) };
                case 'last_7d': return { since: fmt(sub(6)), until: fmt(today) };
                case 'last_14d': return { since: fmt(sub(13)), until: fmt(today) };
                case 'last_30d': return { since: fmt(sub(29)), until: fmt(today) };
                case 'this_month': { const d = new Date(today.getFullYear(), today.getMonth(), 1); return { since: fmt(d), until: fmt(today) }; }
                default: return { since: fmt(sub(6)), until: fmt(today) };
            }
        },

        async _loadRows() {
            if (!FacebookAds.isConnected()) return;
            const accountId = FacebookAds.config.activeAdAccountId;
            this.state.accountId = accountId;

            // Audiência tem fluxo próprio
            if (this.state.level === 'audience') {
                return this._loadAudienceRows(accountId);
            }

            const pfKey = this.state.parentFilter ? `${this.state.parentFilter.level}:${this.state.parentFilter.id}` : 'none';
            const cacheKey = `${this.state.level}|${accountId}|${this.state.dateRange}|${pfKey}`;

            const cached = this.state.cache[cacheKey];
            if (cached && Date.now() - cached.ts < this.state.cacheTTL) {
                this.state.rows = cached.rows;
                this.state.insights = cached.insights;
                this.state.activities = cached.activities || {};
                this._render();
                return;
            }

            this._showLoading(true);
            try {
                const [rows, insightsRaw, activities] = await Promise.all([
                    this._fetchEntities(accountId),
                    this._fetchInsights(accountId),
                    this._fetchActivities(accountId),
                ]);
                const insights = {};
                (insightsRaw || []).forEach(ins => {
                    const idKey = this.state.level === 'campaign' ? ins.campaign_id
                        : this.state.level === 'adset' ? ins.adset_id : ins.ad_id;
                    if (!idKey) return;
                    insights[idKey] = this._parseInsight(ins);
                });
                this.state.rows = rows;
                this.state.insights = insights;
                this.state.activities = activities;
                this.state.cache[cacheKey] = { rows, insights, activities, ts: Date.now() };
                this._render();
            } catch (e) {
                if (typeof showToast === 'function') showToast('Erro ao carregar: ' + e.message, 'error');
                this.state.rows = [];
                this.state.insights = {};
                this.state.activities = {};
                this._render();
            } finally {
                this._showLoading(false);
            }
        },

        async _fetchEntities(accountId) {
            const lvl = this.state.level;
            const pf = this.state.parentFilter;
            let path, fields;
            // Se há parent filter compatível, busca a partir do parent (não da conta)
            if (pf && lvl === 'adset' && pf.level === 'campaign') {
                // Pode ser 1 ou N campanhas selecionadas — para simplificar, usa 1
                path = `${pf.ids[0]}/adsets`;
                fields = 'id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id,campaign{name},targeting,optimization_goal,billing_event';
            } else if (pf && lvl === 'ad' && pf.level === 'adset') {
                path = `${pf.ids[0]}/ads`;
                fields = 'id,name,status,effective_status,adset_id,campaign_id,creative{thumbnail_url,image_url,object_story_spec,effective_object_story_id,object_story_id},adset{name},campaign{name}';
            } else if (pf && lvl === 'ad' && pf.level === 'campaign') {
                path = `${pf.ids[0]}/ads`;
                fields = 'id,name,status,effective_status,adset_id,campaign_id,creative{thumbnail_url,image_url,object_story_spec,effective_object_story_id,object_story_id},adset{name},campaign{name}';
            } else if (lvl === 'campaign') {
                path = `act_${accountId}/campaigns`;
                fields = 'id,name,status,effective_status,objective,daily_budget,lifetime_budget,buying_type,bid_strategy,created_time';
            } else if (lvl === 'adset') {
                path = `act_${accountId}/adsets`;
                fields = 'id,name,status,effective_status,daily_budget,lifetime_budget,campaign_id,campaign{name},targeting,optimization_goal,billing_event';
            } else {
                path = `act_${accountId}/ads`;
                fields = 'id,name,status,effective_status,adset_id,campaign_id,creative{thumbnail_url,image_url,object_story_spec,effective_object_story_id,object_story_id},adset{name},campaign{name}';
            }
            const filtering = lvl === 'campaign'
                ? `[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED","DELETED","ARCHIVED"]}]`
                : `[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED","CAMPAIGN_PAUSED","ADSET_PAUSED","ARCHIVED","DELETED"]}]`;

            const params = new URLSearchParams({
                access_token: FacebookAds.config.accessToken,
                fields,
                filtering,
                limit: '200',
            });
            const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/${path}?${params}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.data || [];
        },

        async _fetchActivities(accountId) {
            const sinceDate = new Date(); sinceDate.setDate(sinceDate.getDate() - 14);
            const params = new URLSearchParams({
                access_token: FacebookAds.config.accessToken,
                fields: 'event_type,event_time,object_id,object_name,object_type,extra_data,date_time_in_timezone,actor_id,actor_name',
                since: sinceDate.toISOString().slice(0, 10),
                limit: '500',
            });
            try {
                const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/act_${accountId}/activities?${params}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.error) return {};
                const map = {};
                (data.data || []).forEach(act => {
                    if (!act.object_id) return;
                    if (!map[act.object_id]) map[act.object_id] = [];
                    if (map[act.object_id].length < 8) map[act.object_id].push(act);
                });
                return map;
            } catch {
                return {};
            }
        },

        async _fetchInsights(accountId) {
            const lvl = this.state.level;
            const { since, until } = this._dateRangeObj();
            const params = new URLSearchParams({
                access_token: FacebookAds.config.accessToken,
                fields: 'campaign_id,adset_id,ad_id,spend,impressions,clicks,ctr,cpm,actions,action_values',
                level: lvl,
                time_range: JSON.stringify({ since, until }),
                limit: '500',
            });
            const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/act_${accountId}/insights?${params}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.data || [];
        },

        _parseInsight(ins) {
            const spend = parseFloat(ins.spend || 0);
            const impressions = parseInt(ins.impressions || 0, 10);
            const clicks = parseInt(ins.clicks || 0, 10);
            const purchases = (ins.actions || []).find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value || 0;
            const purchaseValue = parseFloat((ins.action_values || []).find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value || 0);
            const ctr = parseFloat(ins.ctr || 0);
            const cpm = parseFloat(ins.cpm || 0);
            const roas = spend > 0 ? (purchaseValue / spend) : 0;
            return { spend, impressions, clicks, ctr, cpm, purchases: parseInt(purchases, 10), purchaseValue, roas };
        },

        _showLoading(loading) {
            this.state.loading = loading;
            const el = document.getElementById('adm-loading');
            if (el) el.style.display = loading ? 'flex' : 'none';
            const table = document.getElementById('adm-table');
            if (table) table.style.opacity = loading ? '0.4' : '1';
        },

        _render() {
            this._renderHeader();
            this._renderBody();
            this._renderFooter();
            this._renderBulkBar();
            this._renderFilterChip();
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        _renderFilterChip() {
            const tw = document.getElementById('adm-table-wrap');
            if (!tw) return;
            let chip = document.getElementById('adm-filter-chip');
            if (!this.state.parentFilter) {
                if (chip) chip.remove();
                return;
            }
            const pf = this.state.parentFilter;
            const lvlLabel = { campaign: 'campanha', adset: 'conjunto' }[pf.level] || pf.level;
            const html = `<div id="adm-filter-chip" class="adm-filter-chip">
                <i data-lucide="filter" style="width:13px;height:13px"></i>
                Filtrando por ${lvlLabel}: <strong>${this._esc(pf.name)}</strong>
                <button id="adm-filter-clear" class="adm-filter-clear" title="Limpar filtro">&times;</button>
            </div>`;
            if (chip) chip.outerHTML = html;
            else tw.insertAdjacentHTML('beforebegin', html);
        },

        async _loadAudienceRows(accountId) {
            const cacheKey = `audience|${accountId}|${this.state.dateRange}`;
            const cached = this.state.cache[cacheKey];
            if (cached && Date.now() - cached.ts < this.state.cacheTTL) {
                this.state.rows = cached.rows;
                this.state.insights = {};
                this._render();
                return;
            }
            this._showLoading(true);
            try {
                const { since, until } = this._dateRangeObj();
                // Quebra por idade + gênero (proxy para "audience segments")
                const breakdowns = 'age,gender';
                const params = new URLSearchParams({
                    access_token: FacebookAds.config.accessToken,
                    fields: 'spend,impressions,clicks,ctr,cpc,cpm,actions,action_values',
                    level: 'account',
                    breakdowns,
                    time_range: JSON.stringify({ since, until }),
                    limit: '500',
                });
                const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/act_${accountId}/insights?${params}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);

                // Transforma em rows
                const rows = (data.data || []).map((r, i) => {
                    const ageVal = r.age || '?';
                    const genderVal = r.gender === 'male' ? 'M' : r.gender === 'female' ? 'F' : (r.gender || '');
                    const audName = `${ageVal} · ${genderVal}`;
                    const purchases = parseInt((r.actions || []).find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value || 0, 10);
                    const purchaseValue = parseFloat((r.action_values || []).find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value || 0);
                    const addToCart = parseInt((r.actions || []).find(a => a.action_type === 'add_to_cart' || a.action_type === 'offsite_conversion.fb_pixel_add_to_cart')?.value || 0, 10);
                    const spend = parseFloat(r.spend || 0);
                    return {
                        id: `aud_${i}_${ageVal}_${genderVal}`,
                        aud_name: audName,
                        aud_type: 'demographic',
                        spend,
                        impressions: parseInt(r.impressions || 0, 10),
                        clicks: parseInt(r.clicks || 0, 10),
                        ctr: parseFloat(r.ctr || 0),
                        cpc: parseFloat(r.cpc || 0),
                        cpm: parseFloat(r.cpm || 0),
                        addtocart: addToCart,
                        purchases,
                        purchaseValue,
                        cpa: purchases > 0 ? spend / purchases : 0,
                        roas: spend > 0 ? purchaseValue / spend : 0,
                    };
                });
                this.state.rows = rows;
                this.state.insights = {};
                this.state.activities = {};
                this.state.cache[cacheKey] = { rows, ts: Date.now() };
                this._render();
            } catch (e) {
                if (typeof showToast === 'function') showToast('Erro ao carregar audiências: ' + e.message, 'error');
                this.state.rows = [];
                this._render();
            } finally {
                this._showLoading(false);
            }
        },

        _renderHeader() {
            const thead = document.getElementById('adm-thead');
            if (!thead) return;
            const cols = this.columns[this.state.level];
            thead.innerHTML = '<tr>' + cols.map(c => {
                const align = c.align === 'right' ? 'text-align:right' : '';
                const width = c.width ? `width:${c.width}px;min-width:${c.width}px` : '';
                const style = [align, width].filter(Boolean).join(';');
                const sortIcon = c.sortable
                    ? (c.key === this.state.sortBy
                        ? (this.state.sortDir === 'desc' ? ' ↓' : ' ↑')
                        : '')
                    : '';
                const cls = c.sortable ? 'adm-sortable' : '';
                const dataSort = c.sortable ? `data-adm-sort="${c.key}"` : '';
                if (c.key === 'select') {
                    return `<th style="${style}"><input type="checkbox" id="adm-select-all"></th>`;
                }
                return `<th style="${style}" class="${cls}" ${dataSort}>${this._esc(c.label)}${sortIcon}</th>`;
            }).join('') + '</tr>';

            thead.querySelectorAll('[data-adm-sort]').forEach(th => {
                th.addEventListener('click', () => {
                    const key = th.dataset.admSort;
                    if (this.state.sortBy === key) this.state.sortDir = this.state.sortDir === 'desc' ? 'asc' : 'desc';
                    else { this.state.sortBy = key; this.state.sortDir = 'desc'; }
                    this._render();
                });
            });
            document.getElementById('adm-select-all')?.addEventListener('change', (e) => {
                const visible = this._visibleRows();
                if (e.target.checked) visible.forEach(r => this.state.selected.add(r.id));
                else visible.forEach(r => this.state.selected.delete(r.id));
                this._renderBody();
                this._renderBulkBar();
            });
        },

        _visibleRows() {
            let rows = this.state.rows.slice();
            if (this.state.search) {
                rows = rows.filter(r => (r.name || '').toLowerCase().includes(this.state.search));
            }
            const ins = this.state.insights;
            // sort
            const key = this.state.sortBy;
            const dir = this.state.sortDir === 'desc' ? -1 : 1;
            rows.sort((a, b) => {
                const va = this._sortValue(a, key, ins);
                const vb = this._sortValue(b, key, ins);
                if (va === vb) return 0;
                return va > vb ? dir : -dir;
            });
            return rows;
        },

        _sortValue(row, key, insights) {
            // Para audience, métricas vivem direto na row
            if (this.state.level === 'audience') {
                if (key === 'aud_name') return (row.aud_name || '').toLowerCase();
                return row[key] || 0;
            }
            const i = insights[row.id] || {};
            switch (key) {
                case 'name': return (row.name || '').toLowerCase();
                case 'budget': return parseFloat(row.daily_budget || row.lifetime_budget || 0);
                case 'spend': return i.spend || 0;
                case 'impressions': return i.impressions || 0;
                case 'ctr': return i.ctr || 0;
                case 'cpm': return i.cpm || 0;
                case 'purchases': return i.purchases || 0;
                case 'roas': return i.roas || 0;
                case 'objective': return row.objective || '';
                default: return 0;
            }
        },

        _renderBody() {
            const tbody = document.getElementById('adm-tbody');
            const empty = document.getElementById('adm-empty');
            if (!tbody) return;

            const rows = this._visibleRows();
            if (rows.length === 0 && !this.state.loading) {
                tbody.innerHTML = '';
                if (empty) empty.style.display = 'flex';
                return;
            }
            if (empty) empty.style.display = 'none';

            const cols = this.columns[this.state.level];
            tbody.innerHTML = rows.map(row => {
                const i = this.state.insights[row.id] || {};
                const selected = this.state.selected.has(row.id);
                const isActive = (row.status === 'ACTIVE');
                return `<tr data-id="${this._esc(row.id)}" class="${selected ? 'adm-row-selected' : ''}">` +
                    cols.map(c => this._renderCell(c, row, i, selected, isActive)).join('') +
                    '</tr>';
            }).join('');

            // Bind toggles
            tbody.querySelectorAll('.adm-toggle').forEach(t => {
                t.addEventListener('change', (e) => {
                    const id = e.target.closest('tr').dataset.id;
                    const newStatus = e.target.checked ? 'ACTIVE' : 'PAUSED';
                    this._toggleStatus(id, newStatus, e.target);
                });
            });

            // Bind checkboxes
            tbody.querySelectorAll('.adm-row-select').forEach(cb => {
                cb.addEventListener('change', (e) => {
                    const id = e.target.closest('tr').dataset.id;
                    if (e.target.checked) this.state.selected.add(id);
                    else this.state.selected.delete(id);
                    e.target.closest('tr').classList.toggle('adm-row-selected', e.target.checked);
                    this._renderBulkBar();
                });
            });

            // Bind edit clicks (name link + settings icon)
            tbody.querySelectorAll('[data-edit-id]').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    this._openEditor(el.dataset.editId);
                });
            });

            // Bind budget edit
            tbody.querySelectorAll('.adm-budget-edit').forEach(input => {
                input.addEventListener('blur', (e) => {
                    const id = e.target.closest('tr').dataset.id;
                    const newVal = parseFloat(e.target.value);
                    if (isNaN(newVal) || newVal <= 0) return;
                    this._updateBudget(id, newVal, e.target);
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') e.target.blur();
                    if (e.key === 'Escape') { e.target.value = e.target.dataset.original; e.target.blur(); }
                });
            });
        },

        _renderCell(col, row, insight, selected, isActive) {
            const align = col.align === 'right' ? 'text-align:right' : '';
            const width = col.width ? `width:${col.width}px;min-width:${col.width}px` : '';
            const style = [align, width].filter(Boolean).join(';');

            // Para audience, métricas vivem na própria row
            if (this.state.level === 'audience') {
                switch (col.key) {
                    case 'aud_name':
                        return `<td><strong>${this._esc(row.aud_name)}</strong></td>`;
                    case 'aud_type':
                        return `<td style="${style}"><span class="adm-objective">${this._esc(row.aud_type)}</span></td>`;
                    case 'spend':       return `<td style="${style}">${this._fmtMoney(row.spend)}</td>`;
                    case 'impressions': return `<td style="${style}">${this._fmtNumber(row.impressions)}</td>`;
                    case 'ctr':         return `<td style="${style}">${row.ctr ? row.ctr.toFixed(2) + '%' : '-'}</td>`;
                    case 'cpc':         return `<td style="${style}">${this._fmtMoney(row.cpc)}</td>`;
                    case 'cpm':         return `<td style="${style}">${this._fmtMoney(row.cpm)}</td>`;
                    case 'addtocart':   return `<td style="${style}">${this._fmtNumber(row.addtocart)}</td>`;
                    case 'purchases':   return `<td style="${style}">${this._fmtNumber(row.purchases)}</td>`;
                    case 'cpa':         return `<td style="${style}">${this._fmtMoney(row.cpa)}</td>`;
                    case 'roas': {
                        if (!row.roas) return `<td style="${style}">-</td>`;
                        const cls = row.roas >= 2 ? 'adm-roas-good' : row.roas >= 1 ? 'adm-roas-mid' : 'adm-roas-bad';
                        return `<td style="${style}"><span class="${cls}">${row.roas.toFixed(2)}x</span></td>`;
                    }
                    default: return `<td style="${style}"></td>`;
                }
            }

            switch (col.key) {
                case 'select':
                    return `<td style="${style}"><input type="checkbox" class="adm-row-select" ${selected ? 'checked' : ''}></td>`;
                case 'status':
                    return `<td style="${style}">
                        <label class="adm-switch">
                            <input type="checkbox" class="adm-toggle" ${isActive ? 'checked' : ''}>
                            <span class="adm-switch-slider"></span>
                        </label>
                    </td>`;
                case 'preview': {
                    const thumb = row.creative?.thumbnail_url || row.creative?.image_url || '';
                    return `<td style="${style}">${thumb ? `<img src="${this._esc(thumb)}" class="adm-thumb" loading="lazy">` : '<div class="adm-thumb-placeholder"></div>'}</td>`;
                }
                case 'name': {
                    const statusBadge = this._statusBadge(row);
                    return `<td><div class="adm-name-cell"><a href="#" class="adm-name adm-name-link" data-edit-id="${this._esc(row.id)}">${this._esc(row.name || row.id)}</a>${statusBadge}</div></td>`;
                }
                case 'campaign':
                    return `<td style="${style}">${this._esc(row.campaign?.name || '-')}</td>`;
                case 'objective': {
                    const obj = row.objective ? row.objective.replace(/^OUTCOME_/, '').replace(/_/g, ' ').toLowerCase() : '-';
                    return `<td style="${style}"><span class="adm-objective">${this._esc(obj)}</span></td>`;
                }
                case 'budget': {
                    const cents = parseInt(row.daily_budget || row.lifetime_budget || 0, 10);
                    const isDaily = !!row.daily_budget;
                    const val = cents > 0 ? (cents / 100) : 0;
                    if (this.state.level === 'ad') {
                        return `<td style="${style}">-</td>`;
                    }
                    if (cents === 0) {
                        return `<td style="${style}"><span class="adm-muted">CBO</span></td>`;
                    }
                    return `<td style="${style}">
                        <div class="adm-budget-wrap">
                            <span class="adm-budget-prefix">R$</span>
                            <input type="number" min="1" step="0.01" class="adm-budget-edit" value="${val.toFixed(2)}" data-original="${val.toFixed(2)}" data-daily="${isDaily ? 1 : 0}">
                            <span class="adm-budget-suffix">${isDaily ? '/dia' : 'total'}</span>
                        </div>
                    </td>`;
                }
                case 'spend':
                    return `<td style="${style}">${this._fmtMoney(insight.spend)}</td>`;
                case 'impressions':
                    return `<td style="${style}">${this._fmtNumber(insight.impressions)}</td>`;
                case 'ctr':
                    return `<td style="${style}">${insight.ctr ? insight.ctr.toFixed(2) + '%' : '-'}</td>`;
                case 'cpm':
                    return `<td style="${style}">${this._fmtMoney(insight.cpm)}</td>`;
                case 'purchases':
                    return `<td style="${style}">${this._fmtNumber(insight.purchases)}</td>`;
                case 'roas': {
                    if (!insight.roas) return `<td style="${style}">-</td>`;
                    const cls = insight.roas >= 2 ? 'adm-roas-good' : insight.roas >= 1 ? 'adm-roas-mid' : 'adm-roas-bad';
                    return `<td style="${style}"><span class="${cls}">${insight.roas.toFixed(2)}x</span></td>`;
                }
                case 'latest_actions':
                    return `<td style="${style}">${this._renderLatestActions(row.id)}</td>`;
                case 'actions': {
                    const postUrl = this.state.level === 'ad' ? this._adPublicPostUrl(row) : '';
                    return `<td style="${style}">
                        <button class="adm-action-link" data-edit-id="${this._esc(row.id)}" title="Editar configurações">
                            <i data-lucide="settings" style="width:14px;height:14px"></i>
                        </button>
                        ${postUrl ? `<a class="adm-action-link" href="${this._esc(postUrl)}" target="_blank" title="Ver post no Facebook">
                            <i data-lucide="facebook" style="width:14px;height:14px"></i>
                        </a>` : ''}
                        <a class="adm-action-link" href="${this._adsManagerUrl(row)}" target="_blank" title="Abrir no Gerenciador">
                            <i data-lucide="external-link" style="width:14px;height:14px"></i>
                        </a>
                    </td>`;
                }
                default:
                    return `<td style="${style}"></td>`;
            }
        },

        _renderLatestActions(objectId) {
            const acts = this.state.activities[objectId] || [];
            if (acts.length === 0) return '<span class="adm-actions-empty">—</span>';
            // 5 mais recentes em ordem cronológica (mais antigo → mais novo, esquerda → direita)
            const recent = acts.slice(0, 5).reverse();
            return `<div class="adm-actions-icons">${recent.map(a => {
                const d = this._eventDetail(a);
                return `<span class="adm-action-icon adm-action-${d.kind}" title="${this._esc(d.tooltip)}">
                    <i data-lucide="${d.icon}" style="width:11px;height:11px"></i>
                </span>`;
            }).join('')}</div>`;
        },

        _eventDetail(act) {
            const t = (act.event_type || '').toLowerCase();
            const extra = this._parseExtra(act.extra_data);
            const actor = act.actor_name || '';
            const time = act.event_time
                ? new Date(act.event_time).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
                : '';

            let kind = 'neutral', icon = 'settings', actionVerb = 'alterou';
            let detail = '';

            // Budget
            if (t.includes('budget')) {
                const oldR = parseFloat(extra.old_value || 0) / 100;
                const newR = parseFloat(extra.new_value || 0) / 100;
                const up = newR > oldR;
                kind = up ? 'budget-up' : 'budget-down';
                icon = up ? 'banknote-arrow-up' : 'banknote-arrow-down';
                // Lucide pode não ter banknote-arrow — fallback:
                icon = up ? 'arrow-up-circle' : 'arrow-down-circle';
                actionVerb = up ? 'aumentou o orçamento' : 'diminuiu o orçamento';
                if (oldR && newR) detail = `R$ ${oldR.toFixed(2)} → R$ ${newR.toFixed(2)}`;
            }
            // Status
            else if (t.includes('run_status') || t.endsWith('_status')) {
                const newV = (extra.new_value || '').toString().toUpperCase();
                const oldV = (extra.old_value || '').toString().toUpperCase();
                const isOn = newV.includes('ACTIVE') && !newV.includes('PAUSED');
                kind = isOn ? 'status-on' : 'status-off';
                icon = 'power';
                actionVerb = isOn ? 'ativou' : 'pausou';
                if (oldV && newV) detail = `${this._fmtStatus(oldV)} → ${this._fmtStatus(newV)}`;
            }
            // Targeting / audience
            else if (t.includes('targeting') || t.includes('audience')) {
                kind = 'targeting'; icon = 'users'; actionVerb = 'alterou segmentação';
            }
            // Bid
            else if (t.includes('bid')) {
                kind = 'bid'; icon = 'trending-up'; actionVerb = 'mudou estratégia de lance';
            }
            // Creative
            else if (t.includes('creative')) {
                kind = 'creative'; icon = 'image'; actionVerb = 'trocou criativo';
            }
            // Create
            else if (t.includes('create')) {
                kind = 'created'; icon = 'plus-circle'; actionVerb = 'criou';
            }
            // Delete / archive
            else if (t.includes('delete') || t.includes('archive')) {
                kind = 'deleted'; icon = 'trash-2'; actionVerb = 'arquivou';
            }
            // Schedule
            else if (t.includes('schedule') || t.includes('time')) {
                kind = 'schedule'; icon = 'clock'; actionVerb = 'mudou agendamento';
            }
            // Name
            else if (t.includes('name')) {
                kind = 'edit'; icon = 'edit-2'; actionVerb = 'renomeou';
            }

            const who = actor || 'Alguém';
            const line1 = `${who} ${actionVerb}`;
            const tooltip = [line1, detail, time].filter(Boolean).join('\n');
            return { icon, kind, tooltip };
        },

        _parseExtra(extra) {
            if (!extra) return {};
            if (typeof extra === 'object') return extra;
            try { return JSON.parse(extra); } catch { return {}; }
        },

        _fmtStatus(v) {
            const map = {
                'ACTIVE': 'Ativo', 'PAUSED': 'Pausado', 'ARCHIVED': 'Arquivado',
                'DELETED': 'Excluído', 'CAMPAIGN_PAUSED': 'Campanha pausada',
                'ADSET_PAUSED': 'Conjunto pausado', '0': 'Inativo', '1': 'Ativo',
            };
            return map[v] || v.toLowerCase();
        },

        _eventLabel(type) {
            const map = {
                update_campaign_budget: 'Orçamento de campanha alterado',
                update_adset_budget: 'Orçamento de conjunto alterado',
                update_campaign_run_status: 'Status de campanha alterado',
                update_adset_run_status: 'Status de conjunto alterado',
                update_ad_run_status: 'Status de anúncio alterado',
                update_campaign_name: 'Nome de campanha alterado',
                update_adset_name: 'Nome de conjunto alterado',
                update_ad_name: 'Nome de anúncio alterado',
                update_campaign_bid_strategy: 'Estratégia de lance alterada',
                update_adset_bid_strategy: 'Lance do conjunto alterado',
                update_adset_targeting: 'Segmentação alterada',
                update_adset_audience: 'Público alterado',
                update_adset_optimization_goal: 'Meta de otimização alterada',
                update_adset_bidding: 'Lance alterado',
                update_adset_start_or_end_time: 'Agendamento alterado',
                update_ad_creative: 'Criativo do anúncio alterado',
                create_campaign: 'Campanha criada',
                create_adset: 'Conjunto criado',
                create_ad: 'Anúncio criado',
                ad_account_billing_charge: 'Cobrança',
            };
            return map[type] || (type || '').replace(/_/g, ' ');
        },

        _statusBadge(row) {
            const eff = row.effective_status;
            if (!eff || eff === 'ACTIVE' || eff === 'PAUSED') return '';
            const labels = {
                CAMPAIGN_PAUSED: 'campanha pausada',
                ADSET_PAUSED: 'conjunto pausado',
                ARCHIVED: 'arquivado',
                DELETED: 'excluído',
                IN_PROCESS: 'em revisão',
                WITH_ISSUES: 'com problemas',
                PENDING_REVIEW: 'em revisão',
                DISAPPROVED: 'reprovado',
            };
            const label = labels[eff] || eff.toLowerCase();
            return `<span class="adm-status-pill adm-status-${eff.toLowerCase()}">${this._esc(label)}</span>`;
        },

        _renderFooter() {
            const tfoot = document.getElementById('adm-tfoot');
            if (!tfoot) return;
            const rows = this._visibleRows();
            let totalSpend = 0, totalImps = 0, totalPurchases = 0, totalValue = 0;
            rows.forEach(r => {
                const i = this.state.insights[r.id] || {};
                totalSpend += i.spend || 0;
                totalImps += i.impressions || 0;
                totalPurchases += i.purchases || 0;
                totalValue += i.purchaseValue || 0;
            });
            const cols = this.columns[this.state.level];
            const roasTotal = totalSpend > 0 ? (totalValue / totalSpend) : 0;
            tfoot.innerHTML = '<tr>' + cols.map(c => {
                if (c.key === 'name') return `<td colspan="${this.state.level === 'ad' ? 2 : 1}"><strong>Total · ${rows.length} ${this._levelLabel(rows.length)}</strong></td>`;
                if (c.key === 'spend') return `<td style="text-align:right"><strong>${this._fmtMoney(totalSpend)}</strong></td>`;
                if (c.key === 'impressions') return `<td style="text-align:right"><strong>${this._fmtNumber(totalImps)}</strong></td>`;
                if (c.key === 'purchases') return `<td style="text-align:right"><strong>${this._fmtNumber(totalPurchases)}</strong></td>`;
                if (c.key === 'roas') return `<td style="text-align:right"><strong>${roasTotal > 0 ? roasTotal.toFixed(2) + 'x' : '-'}</strong></td>`;
                if (c.key === 'preview' && this.state.level === 'ad') return '';
                if (c.key === 'select') return '<td></td>';
                return `<td></td>`;
            }).join('') + '</tr>';
        },

        _levelLabel(n) {
            const map = { campaign: 'campanha', adset: 'conjunto', ad: 'anúncio' };
            return map[this.state.level] + (n !== 1 ? 's' : '');
        },

        _renderBulkBar() {
            const bar = document.getElementById('adm-bulk-bar');
            const count = document.getElementById('adm-bulk-count');
            if (!bar) return;
            const n = this.state.selected.size;
            if (n === 0) { bar.style.display = 'none'; return; }
            bar.style.display = '';
            if (count) count.textContent = `${n} selecionado${n !== 1 ? 's' : ''}`;
        },

        async _toggleStatus(id, newStatus, checkbox) {
            checkbox.disabled = true;
            try {
                await this._graphPost(id, { status: newStatus });
                // Atualiza estado local
                const row = this.state.rows.find(r => r.id === id);
                if (row) row.status = newStatus;
                if (typeof showToast === 'function') showToast(`${newStatus === 'ACTIVE' ? 'Ativado' : 'Pausado'}`, 'success');
            } catch (e) {
                checkbox.checked = !checkbox.checked;
                if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
            } finally {
                checkbox.disabled = false;
            }
        },

        async _updateBudget(id, valueReais, input) {
            const cents = Math.round(valueReais * 100);
            const isDaily = input.dataset.daily === '1';
            const params = isDaily ? { daily_budget: cents } : { lifetime_budget: cents };
            input.disabled = true;
            try {
                await this._graphPost(id, params);
                input.dataset.original = valueReais.toFixed(2);
                const row = this.state.rows.find(r => r.id === id);
                if (row) {
                    if (isDaily) row.daily_budget = cents;
                    else row.lifetime_budget = cents;
                }
                if (typeof showToast === 'function') showToast('Orçamento atualizado', 'success');
            } catch (e) {
                input.value = input.dataset.original;
                if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
            } finally {
                input.disabled = false;
            }
        },

        async _bulkStatus(status) {
            const ids = Array.from(this.state.selected);
            if (ids.length === 0) return;
            let ok = 0, fail = 0;
            for (const id of ids) {
                try {
                    await this._graphPost(id, { status });
                    const row = this.state.rows.find(r => r.id === id);
                    if (row) row.status = status;
                    ok++;
                } catch { fail++; }
            }
            if (typeof showToast === 'function') {
                showToast(`${status === 'ACTIVE' ? 'Ativados' : 'Pausados'}: ${ok}${fail > 0 ? ` · ${fail} falhas` : ''}`, fail > 0 ? 'warning' : 'success');
            }
            this.state.selected.clear();
            this._render();
        },

        async _graphPost(path, params = {}) {
            const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/${path}`;
            const body = new URLSearchParams({ access_token: FacebookAds.config.accessToken, ...params });
            const res = await fetch(url, { method: 'POST', body });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message || 'Erro');
            return data;
        },

        // ===== EDITOR =====

        async _openEditor(id) {
            const modal = document.getElementById('adm-edit-modal');
            const body = document.getElementById('adm-edit-body');
            const title = document.getElementById('adm-edit-title');
            const fbLink = document.getElementById('adm-edit-fb-link');
            const saveBtn = document.getElementById('adm-edit-save');
            if (!modal || !body) return;

            const row = this.state.rows.find(r => r.id === id);
            if (!row) return;

            this._editingId = id;
            this._editingLevel = this.state.level;
            const lvlLabel = { campaign: 'Campanha', adset: 'Conjunto de anúncios', ad: 'Anúncio' }[this.state.level];
            if (title) title.textContent = `${lvlLabel}: ${row.name}`;
            if (fbLink) fbLink.href = this._adsManagerUrl(row);

            body.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted)"><i data-lucide="loader-2" style="width:20px;height:20px;animation:spin 1s linear infinite"></i> Carregando configurações…</div>';
            modal.style.display = 'flex';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            // Bind footer once
            if (saveBtn && !saveBtn._bound) {
                saveBtn._bound = true;
                saveBtn.addEventListener('click', () => this._saveEditor());
            }
            modal.querySelectorAll('[data-close-modal]').forEach(b => {
                if (b._bound) return;
                b._bound = true;
                b.addEventListener('click', () => { modal.style.display = 'none'; });
            });

            try {
                // Fetch fresh detailed entity
                const detail = await this._fetchEntityDetail(id, this.state.level);
                this._editingDetail = detail;
                body.innerHTML = this._renderEditorBody(detail, this.state.level);
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                this._bindEditorBody();
            } catch (e) {
                body.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--danger)">Erro ao carregar: ${this._esc(e.message)}</div>`;
            }
        },

        async _fetchEntityDetail(id, level) {
            const fieldsByLevel = {
                campaign: 'id,name,status,objective,daily_budget,lifetime_budget,buying_type,bid_strategy,special_ad_categories,start_time,stop_time,spend_cap',
                adset: 'id,name,status,daily_budget,lifetime_budget,billing_event,optimization_goal,bid_amount,bid_strategy,start_time,end_time,pacing_type,promoted_object,targeting,attribution_spec,destination_type,campaign_id,campaign{name,objective}',
                ad: 'id,name,status,adset_id,adset{name},campaign{name},preview_shareable_link,creative{id,name,thumbnail_url,object_story_spec,effective_object_story_id,object_story_id,object_type}',
            };
            const params = new URLSearchParams({
                access_token: FacebookAds.config.accessToken,
                fields: fieldsByLevel[level],
            });
            const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/${id}?${params}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data;
        },

        _renderEditorBody(d, level) {
            if (level === 'campaign') return this._renderCampaignEditor(d);
            if (level === 'adset')    return this._renderAdsetEditor(d);
            if (level === 'ad')       return this._renderAdEditor(d);
            return '';
        },

        _renderCampaignEditor(d) {
            const dailyR = d.daily_budget ? (parseInt(d.daily_budget, 10) / 100).toFixed(2) : '';
            const lifetimeR = d.lifetime_budget ? (parseInt(d.lifetime_budget, 10) / 100).toFixed(2) : '';
            const spendCapR = d.spend_cap ? (parseInt(d.spend_cap, 10) / 100).toFixed(2) : '';
            const budgetMode = d.daily_budget ? 'daily' : d.lifetime_budget ? 'lifetime' : 'cbo_off';
            return `
                <div class="adm-editor">
                    ${this._editorSection('info', 'Geral')}
                    <div class="adm-editor-grid">
                        <label class="adm-editor-field" style="grid-column:span 2">
                            <span>Nome</span>
                            <input type="text" class="input input-sm" data-edit-key="name" value="${this._esc(d.name)}">
                        </label>
                        <label class="adm-editor-field">
                            <span>Objetivo</span>
                            <input type="text" class="input input-sm" value="${this._esc((d.objective || '').replace(/^OUTCOME_/, ''))}" disabled>
                        </label>
                        <label class="adm-editor-field">
                            <span>Tipo de compra</span>
                            <input type="text" class="input input-sm" value="${this._esc(d.buying_type || 'AUCTION')}" disabled>
                        </label>
                    </div>

                    ${this._editorSection('budget', 'Orçamento (CBO)')}
                    <div class="adm-editor-grid">
                        <label class="adm-editor-field" style="grid-column:span 2">
                            <span>Modo</span>
                            <select class="input input-sm" data-edit-key="budget_mode" id="adm-cmp-budget-mode">
                                <option value="cbo_off" ${budgetMode==='cbo_off'?'selected':''}>Sem CBO (orçamento por conjunto)</option>
                                <option value="daily" ${budgetMode==='daily'?'selected':''}>Diário (CBO)</option>
                                <option value="lifetime" ${budgetMode==='lifetime'?'selected':''}>Total (CBO)</option>
                            </select>
                        </label>
                        <label class="adm-editor-field" id="adm-cmp-daily-wrap" style="${budgetMode==='daily'?'':'display:none'}">
                            <span>Orçamento diário (R$)</span>
                            <input type="number" min="1" step="0.01" class="input input-sm" data-edit-key="daily_budget_reais" value="${dailyR}">
                        </label>
                        <label class="adm-editor-field" id="adm-cmp-lifetime-wrap" style="${budgetMode==='lifetime'?'':'display:none'}">
                            <span>Orçamento total (R$)</span>
                            <input type="number" min="1" step="0.01" class="input input-sm" data-edit-key="lifetime_budget_reais" value="${lifetimeR}">
                        </label>
                        <label class="adm-editor-field">
                            <span>Estratégia de lance</span>
                            <select class="input input-sm" data-edit-key="bid_strategy">
                                <option value="LOWEST_COST_WITHOUT_CAP" ${d.bid_strategy==='LOWEST_COST_WITHOUT_CAP'?'selected':''}>Maior volume</option>
                                <option value="LOWEST_COST_WITH_BID_CAP" ${d.bid_strategy==='LOWEST_COST_WITH_BID_CAP'?'selected':''}>Limite de lance</option>
                                <option value="COST_CAP" ${d.bid_strategy==='COST_CAP'?'selected':''}>Limite de custo</option>
                                <option value="LOWEST_COST_WITH_MIN_ROAS" ${d.bid_strategy==='LOWEST_COST_WITH_MIN_ROAS'?'selected':''}>ROAS mínimo</option>
                            </select>
                        </label>
                        <label class="adm-editor-field">
                            <span>Limite de gasto total (R$, opcional)</span>
                            <input type="number" min="0" step="0.01" class="input input-sm" data-edit-key="spend_cap_reais" value="${spendCapR}" placeholder="0 = sem limite">
                        </label>
                    </div>

                    ${this._editorSection('schedule', 'Agendamento')}
                    <div class="adm-editor-grid">
                        <label class="adm-editor-field">
                            <span>Início</span>
                            <input type="datetime-local" class="input input-sm" data-edit-key="start_time" value="${this._toLocalDT(d.start_time)}">
                        </label>
                        <label class="adm-editor-field">
                            <span>Fim (opcional)</span>
                            <input type="datetime-local" class="input input-sm" data-edit-key="stop_time" value="${this._toLocalDT(d.stop_time)}">
                        </label>
                    </div>

                    ${this._editorSection('status', 'Status')}
                    <div class="adm-editor-grid">
                        <label class="adm-editor-field">
                            <span>Status</span>
                            <select class="input input-sm" data-edit-key="status">
                                <option value="ACTIVE" ${d.status==='ACTIVE'?'selected':''}>Ativo</option>
                                <option value="PAUSED" ${d.status==='PAUSED'?'selected':''}>Pausado</option>
                            </select>
                        </label>
                    </div>
                </div>`;
        },

        _renderAdsetEditor(d) {
            const dailyR = d.daily_budget ? (parseInt(d.daily_budget, 10) / 100).toFixed(2) : '';
            const lifetimeR = d.lifetime_budget ? (parseInt(d.lifetime_budget, 10) / 100).toFixed(2) : '';
            const bidR = d.bid_amount ? (parseInt(d.bid_amount, 10) / 100).toFixed(2) : '';
            const budgetMode = d.daily_budget ? 'daily' : 'lifetime';
            const t = d.targeting || {};
            const geos = (t.geo_locations?.countries || []).join(', ') || (t.geo_locations?.cities || []).map(c => c.name).join(', ') || '-';
            const ages = `${t.age_min || 18}–${t.age_max || 65}`;
            const gender = t.genders?.length === 1 ? (t.genders[0] === 1 ? 'Masculino' : 'Feminino') : 'Todos';
            const interests = (t.flexible_spec?.[0]?.interests || []).map(i => i.name).join(', ') || (t.interests || []).map(i => i.name).join(', ') || '-';
            const placements = (t.publisher_platforms || []).join(', ') || 'Automático';

            return `
                <div class="adm-editor">
                    ${this._editorSection('info', 'Geral')}
                    <div class="adm-editor-grid">
                        <label class="adm-editor-field" style="grid-column:span 2">
                            <span>Nome</span>
                            <input type="text" class="input input-sm" data-edit-key="name" value="${this._esc(d.name)}">
                        </label>
                        <label class="adm-editor-field">
                            <span>Campanha</span>
                            <input type="text" class="input input-sm" value="${this._esc(d.campaign?.name || '-')}" disabled>
                        </label>
                        <label class="adm-editor-field">
                            <span>Status</span>
                            <select class="input input-sm" data-edit-key="status">
                                <option value="ACTIVE" ${d.status==='ACTIVE'?'selected':''}>Ativo</option>
                                <option value="PAUSED" ${d.status==='PAUSED'?'selected':''}>Pausado</option>
                            </select>
                        </label>
                    </div>

                    ${this._editorSection('budget', 'Orçamento & Lance')}
                    <div class="adm-editor-grid">
                        <label class="adm-editor-field">
                            <span>Tipo</span>
                            <select class="input input-sm" data-edit-key="budget_mode" id="adm-as-budget-mode">
                                <option value="daily" ${budgetMode==='daily'?'selected':''}>Diário</option>
                                <option value="lifetime" ${budgetMode==='lifetime'?'selected':''}>Total</option>
                            </select>
                        </label>
                        <label class="adm-editor-field" id="adm-as-daily-wrap" style="${budgetMode==='daily'?'':'display:none'}">
                            <span>Orçamento diário (R$)</span>
                            <input type="number" min="1" step="0.01" class="input input-sm" data-edit-key="daily_budget_reais" value="${dailyR}">
                        </label>
                        <label class="adm-editor-field" id="adm-as-lifetime-wrap" style="${budgetMode==='lifetime'?'':'display:none'}">
                            <span>Orçamento total (R$)</span>
                            <input type="number" min="1" step="0.01" class="input input-sm" data-edit-key="lifetime_budget_reais" value="${lifetimeR}">
                        </label>
                        <label class="adm-editor-field">
                            <span>Estratégia de lance</span>
                            <select class="input input-sm" data-edit-key="bid_strategy">
                                <option value="LOWEST_COST_WITHOUT_CAP" ${d.bid_strategy==='LOWEST_COST_WITHOUT_CAP'?'selected':''}>Maior volume</option>
                                <option value="LOWEST_COST_WITH_BID_CAP" ${d.bid_strategy==='LOWEST_COST_WITH_BID_CAP'?'selected':''}>Limite de lance</option>
                                <option value="COST_CAP" ${d.bid_strategy==='COST_CAP'?'selected':''}>Limite de custo</option>
                                <option value="LOWEST_COST_WITH_MIN_ROAS" ${d.bid_strategy==='LOWEST_COST_WITH_MIN_ROAS'?'selected':''}>ROAS mínimo</option>
                            </select>
                        </label>
                        <label class="adm-editor-field">
                            <span>Valor do lance (R$, opcional)</span>
                            <input type="number" min="0" step="0.01" class="input input-sm" data-edit-key="bid_amount_reais" value="${bidR}" placeholder="Vazio = auto">
                        </label>
                    </div>

                    ${this._editorSection('optim', 'Otimização & Entrega')}
                    <div class="adm-editor-grid">
                        <label class="adm-editor-field">
                            <span>Meta de otimização</span>
                            <select class="input input-sm" data-edit-key="optimization_goal">
                                ${this._optGoalOptions(d.optimization_goal)}
                            </select>
                        </label>
                        <label class="adm-editor-field">
                            <span>Evento de cobrança</span>
                            <select class="input input-sm" data-edit-key="billing_event">
                                <option value="IMPRESSIONS" ${d.billing_event==='IMPRESSIONS'?'selected':''}>Impressões</option>
                                <option value="LINK_CLICKS" ${d.billing_event==='LINK_CLICKS'?'selected':''}>Cliques no link</option>
                                <option value="PAGE_LIKES" ${d.billing_event==='PAGE_LIKES'?'selected':''}>Curtidas</option>
                                <option value="VIDEO_VIEWS" ${d.billing_event==='VIDEO_VIEWS'?'selected':''}>Vídeo</option>
                            </select>
                        </label>
                    </div>

                    ${this._editorSection('schedule', 'Agendamento')}
                    <div class="adm-editor-grid">
                        <label class="adm-editor-field">
                            <span>Início</span>
                            <input type="datetime-local" class="input input-sm" data-edit-key="start_time" value="${this._toLocalDT(d.start_time)}">
                        </label>
                        <label class="adm-editor-field">
                            <span>Fim (opcional)</span>
                            <input type="datetime-local" class="input input-sm" data-edit-key="end_time" value="${this._toLocalDT(d.end_time)}">
                        </label>
                    </div>

                    ${this._editorSection('targeting', 'Segmentação')}
                    <div class="adm-editor-grid">
                        <label class="adm-editor-field">
                            <span>Países</span>
                            <input type="text" class="input input-sm" id="adm-tg-countries" data-edit-key="tg_countries" value="${this._esc((t.geo_locations?.countries || []).join(','))}" placeholder="BR, US, PT — códigos ISO separados por vírgula">
                        </label>
                        <label class="adm-editor-field">
                            <span>Gênero</span>
                            <select class="input input-sm" data-edit-key="tg_genders">
                                <option value="0" ${(!t.genders || t.genders.length !== 1) ? 'selected' : ''}>Todos</option>
                                <option value="1" ${t.genders?.[0] === 1 ? 'selected' : ''}>Masculino</option>
                                <option value="2" ${t.genders?.[0] === 2 ? 'selected' : ''}>Feminino</option>
                            </select>
                        </label>
                        <label class="adm-editor-field">
                            <span>Idade mínima</span>
                            <input type="number" min="13" max="65" class="input input-sm" data-edit-key="tg_age_min" value="${t.age_min || 18}">
                        </label>
                        <label class="adm-editor-field">
                            <span>Idade máxima</span>
                            <input type="number" min="13" max="65" class="input input-sm" data-edit-key="tg_age_max" value="${t.age_max || 65}">
                        </label>
                        <div class="adm-editor-field" style="grid-column:span 2">
                            <span>Interesses</span>
                            <div class="adm-interest-wrap">
                                <div class="adm-interest-chips" id="adm-interest-chips"></div>
                                <div class="adm-interest-search-wrap">
                                    <input type="text" class="input input-sm" id="adm-interest-search" placeholder="Buscar interesse (ex: futebol, beleza, fitness…)" autocomplete="off">
                                    <div class="adm-interest-suggestions" id="adm-interest-suggestions" style="display:none"></div>
                                </div>
                            </div>
                        </div>
                        <label class="adm-editor-field" style="grid-column:span 2">
                            <span>Posicionamentos</span>
                            <div class="adm-checkbox-row">
                                ${['facebook','instagram','audience_network','messenger'].map(p => `
                                    <label class="adm-checkbox-item">
                                        <input type="checkbox" data-edit-key="tg_placement_${p}" ${(!t.publisher_platforms || t.publisher_platforms.includes(p)) ? 'checked' : ''}>
                                        <span>${p === 'audience_network' ? 'Audience Network' : p.charAt(0).toUpperCase() + p.slice(1)}</span>
                                    </label>
                                `).join('')}
                            </div>
                        </label>
                    </div>
                </div>`;
        },

        _renderAdEditor(d) {
            const story = d.creative?.object_story_spec?.link_data || {};
            const postLink = this._adPublicPostUrl(d);
            const previewLink = d.preview_shareable_link || '';
            return `
                <div class="adm-editor">
                    ${this._editorSection('info', 'Geral')}
                    <div class="adm-editor-grid">
                        <label class="adm-editor-field" style="grid-column:span 2">
                            <span>Nome do anúncio</span>
                            <input type="text" class="input input-sm" data-edit-key="name" value="${this._esc(d.name)}">
                        </label>
                        <label class="adm-editor-field">
                            <span>Conjunto</span>
                            <input type="text" class="input input-sm" value="${this._esc(d.adset?.name || '-')}" disabled>
                        </label>
                        <label class="adm-editor-field">
                            <span>Campanha</span>
                            <input type="text" class="input input-sm" value="${this._esc(d.campaign?.name || '-')}" disabled>
                        </label>
                        <label class="adm-editor-field">
                            <span>Status</span>
                            <select class="input input-sm" data-edit-key="status">
                                <option value="ACTIVE" ${d.status==='ACTIVE'?'selected':''}>Ativo</option>
                                <option value="PAUSED" ${d.status==='PAUSED'?'selected':''}>Pausado</option>
                            </select>
                        </label>
                    </div>

                    ${(postLink || previewLink) ? `
                        ${this._editorSection('links', 'Links do anúncio')}
                        <div class="adm-ad-links">
                            ${postLink ? `<a href="${this._esc(postLink)}" target="_blank" class="adm-ad-link adm-ad-link-fb">
                                <i data-lucide="facebook" style="width:14px;height:14px"></i>
                                <div><strong>Ver post público no Facebook</strong><span>O anúncio na timeline</span></div>
                                <i data-lucide="external-link" style="width:13px;height:13px;margin-left:auto"></i>
                            </a>` : ''}
                            ${previewLink ? `<a href="${this._esc(previewLink)}" target="_blank" class="adm-ad-link adm-ad-link-preview">
                                <i data-lucide="eye" style="width:14px;height:14px"></i>
                                <div><strong>Preview compartilhável (Meta)</strong><span>Veja como o anúncio é exibido</span></div>
                                <i data-lucide="external-link" style="width:13px;height:13px;margin-left:auto"></i>
                            </a>` : ''}
                        </div>
                    ` : ''}

                    ${this._editorSection('creative', 'Criativo (somente leitura)')}
                    <div class="adm-editor-targeting">
                        ${d.creative?.thumbnail_url ? `<img src="${this._esc(d.creative.thumbnail_url)}" style="max-width:200px;border-radius:6px;margin-bottom:0.5rem">` : ''}
                        <div class="adm-tg-row"><span class="adm-tg-label">Texto principal</span><span class="adm-tg-val">${this._esc(story.message || '-')}</span></div>
                        <div class="adm-tg-row"><span class="adm-tg-label">Título</span><span class="adm-tg-val">${this._esc(story.name || '-')}</span></div>
                        <div class="adm-tg-row"><span class="adm-tg-label">Descrição</span><span class="adm-tg-val">${this._esc(story.description || '-')}</span></div>
                        <div class="adm-tg-row"><span class="adm-tg-label">URL</span><span class="adm-tg-val">${story.link ? `<a href="${this._esc(story.link)}" target="_blank" style="color:var(--accent)">${this._esc(story.link)} ↗</a>` : '-'}</span></div>
                        <div class="adm-tg-row"><span class="adm-tg-label">CTA</span><span class="adm-tg-val">${this._esc(story.call_to_action?.type || '-')}</span></div>
                        <div class="adm-tg-note">
                            <i data-lucide="info" style="width:12px;height:12px"></i>
                            Para alterar criativo, crie um novo anúncio no Ad Launcher (criativos do Meta são imutáveis).
                        </div>
                    </div>
                </div>`;
        },

        _adPublicPostUrl(d) {
            // object_story_id formato "PAGE_ID_POST_ID"
            const storyId = d.creative?.effective_object_story_id || d.creative?.object_story_id;
            if (!storyId || !storyId.includes('_')) return '';
            const [pageId, postId] = storyId.split('_');
            if (!pageId || !postId) return '';
            return `https://www.facebook.com/${pageId}/posts/${postId}`;
        },

        _editorSection(id, label) {
            return `<div class="adm-editor-section-header"><i data-lucide="chevron-right" style="width:14px;height:14px"></i>${this._esc(label)}</div>`;
        },

        _optGoalOptions(current) {
            const goals = [
                ['OFFSITE_CONVERSIONS', 'Conversões'],
                ['LINK_CLICKS', 'Cliques no link'],
                ['IMPRESSIONS', 'Impressões'],
                ['REACH', 'Alcance'],
                ['LANDING_PAGE_VIEWS', 'Visualizações da landing'],
                ['POST_ENGAGEMENT', 'Engajamento'],
                ['VIDEO_VIEWS', 'Visualizações de vídeo'],
                ['THRUPLAY', 'ThruPlay'],
                ['VALUE', 'Valor'],
                ['LEAD_GENERATION', 'Geração de leads'],
                ['QUALITY_LEAD', 'Lead qualificado'],
                ['APP_INSTALLS', 'Instalações de app'],
            ];
            const has = goals.some(g => g[0] === current);
            return goals.map(g => `<option value="${g[0]}" ${g[0]===current?'selected':''}>${g[1]}</option>`).join('') +
                (!has && current ? `<option value="${current}" selected>${current}</option>` : '');
        },

        _bindEditorBody() {
            // Budget mode toggle (campaign)
            const cmpMode = document.getElementById('adm-cmp-budget-mode');
            if (cmpMode) {
                cmpMode.addEventListener('change', (e) => {
                    document.getElementById('adm-cmp-daily-wrap').style.display = e.target.value === 'daily' ? '' : 'none';
                    document.getElementById('adm-cmp-lifetime-wrap').style.display = e.target.value === 'lifetime' ? '' : 'none';
                });
            }
            // Budget mode toggle (adset)
            const asMode = document.getElementById('adm-as-budget-mode');
            if (asMode) {
                asMode.addEventListener('change', (e) => {
                    document.getElementById('adm-as-daily-wrap').style.display = e.target.value === 'daily' ? '' : 'none';
                    document.getElementById('adm-as-lifetime-wrap').style.display = e.target.value === 'lifetime' ? '' : 'none';
                });
            }

            // Interest search (adset only)
            this._initInterestPicker();
        },

        _initInterestPicker() {
            const chipsEl = document.getElementById('adm-interest-chips');
            const inputEl = document.getElementById('adm-interest-search');
            const sugEl = document.getElementById('adm-interest-suggestions');
            if (!chipsEl || !inputEl || !sugEl) return;

            // Populate chips from current targeting (preserve full interest objects {id, name})
            const t = this._editingDetail?.targeting || {};
            const initial = (t.flexible_spec?.[0]?.interests || []) // newer format
                .concat(t.interests || []); // legacy
            this._editingInterests = initial.map(i => ({ id: i.id, name: i.name }));
            this._renderInterestChips();

            let timer = null;
            inputEl.addEventListener('input', () => {
                const q = inputEl.value.trim();
                if (timer) clearTimeout(timer);
                if (!q) { sugEl.style.display = 'none'; return; }
                timer = setTimeout(() => this._searchInterests(q), 280);
            });
            inputEl.addEventListener('focus', () => {
                if (sugEl.children.length > 0) sugEl.style.display = '';
            });
            // Click outside to close
            document.addEventListener('click', (e) => {
                if (!sugEl.contains(e.target) && e.target !== inputEl) sugEl.style.display = 'none';
            });
        },

        _renderInterestChips() {
            const chipsEl = document.getElementById('adm-interest-chips');
            if (!chipsEl) return;
            const items = this._editingInterests || [];
            if (items.length === 0) {
                chipsEl.innerHTML = '<span class="adm-interest-empty">Nenhum interesse adicionado</span>';
                return;
            }
            chipsEl.innerHTML = items.map((it, idx) => `
                <span class="adm-interest-chip" data-idx="${idx}">
                    ${this._esc(it.name)}
                    <button class="adm-interest-chip-x" data-idx="${idx}" title="Remover">&times;</button>
                </span>
            `).join('');
            chipsEl.querySelectorAll('.adm-interest-chip-x').forEach(b => {
                b.addEventListener('click', (e) => {
                    e.preventDefault();
                    const idx = parseInt(b.dataset.idx, 10);
                    this._editingInterests.splice(idx, 1);
                    this._renderInterestChips();
                });
            });
        },

        async _searchInterests(query) {
            const sugEl = document.getElementById('adm-interest-suggestions');
            if (!sugEl) return;
            sugEl.style.display = '';
            sugEl.innerHTML = '<div class="adm-interest-sug-loading">Buscando…</div>';
            try {
                const params = new URLSearchParams({
                    access_token: FacebookAds.config.accessToken,
                    type: 'adinterest',
                    q: query,
                    locale: 'pt_BR',
                    limit: '20',
                });
                const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/search?${params}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                const items = data.data || [];
                if (items.length === 0) {
                    sugEl.innerHTML = '<div class="adm-interest-sug-empty">Nenhum resultado</div>';
                    return;
                }
                sugEl.innerHTML = items.map((it, idx) => {
                    const aud = it.audience_size_lower_bound
                        ? `${this._fmtNumber(it.audience_size_lower_bound)}–${this._fmtNumber(it.audience_size_upper_bound)}`
                        : (it.audience_size ? this._fmtNumber(it.audience_size) : '');
                    const path = (it.path || []).slice(0, -1).join(' › ');
                    return `<div class="adm-interest-sug-item" data-idx="${idx}">
                        <div class="adm-interest-sug-main">
                            <strong>${this._esc(it.name)}</strong>
                            ${path ? `<span class="adm-interest-sug-path">${this._esc(path)}</span>` : ''}
                        </div>
                        ${aud ? `<span class="adm-interest-sug-aud">${aud}</span>` : ''}
                    </div>`;
                }).join('');
                sugEl.querySelectorAll('.adm-interest-sug-item').forEach(el => {
                    el.addEventListener('click', () => {
                        const idx = parseInt(el.dataset.idx, 10);
                        const item = items[idx];
                        if (!this._editingInterests.some(x => x.id === item.id)) {
                            this._editingInterests.push({ id: item.id, name: item.name });
                            this._renderInterestChips();
                        }
                        document.getElementById('adm-interest-search').value = '';
                        sugEl.style.display = 'none';
                    });
                });
            } catch (e) {
                sugEl.innerHTML = `<div class="adm-interest-sug-empty">Erro: ${this._esc(e.message)}</div>`;
            }
        },

        async _saveEditor() {
            const id = this._editingId;
            const level = this._editingLevel;
            const body = document.getElementById('adm-edit-body');
            const saveBtn = document.getElementById('adm-edit-save');
            if (!id || !body) return;

            const fields = {};
            body.querySelectorAll('[data-edit-key]').forEach(el => {
                fields[el.dataset.editKey] = el.value;
            });

            const params = this._buildSavePayload(fields, level);
            if (Object.keys(params).length === 0) {
                if (typeof showToast === 'function') showToast('Nada para alterar', 'info');
                return;
            }

            const origBtn = saveBtn.innerHTML;
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i> Salvando…';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            try {
                await this._graphPost(id, params);
                if (typeof showToast === 'function') showToast('Configurações salvas', 'success');
                document.getElementById('adm-edit-modal').style.display = 'none';
                // Limpa cache + recarrega lista
                this.state.cache = {};
                this._loadRows();
            } catch (e) {
                if (typeof showToast === 'function') showToast('Erro ao salvar: ' + e.message, 'error');
            } finally {
                saveBtn.disabled = false;
                saveBtn.innerHTML = origBtn;
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
            }
        },

        _buildSavePayload(f, level) {
            const out = {};
            if (f.name !== undefined && f.name !== this._editingDetail?.name) out.name = f.name;
            if (f.status !== undefined && f.status !== this._editingDetail?.status) out.status = f.status;

            // Budget
            const mode = f.budget_mode;
            if (level === 'campaign') {
                if (mode === 'cbo_off') {
                    out.daily_budget = 0;
                    out.lifetime_budget = 0;
                } else if (mode === 'daily' && f.daily_budget_reais) {
                    out.daily_budget = Math.round(parseFloat(f.daily_budget_reais) * 100);
                    out.lifetime_budget = 0;
                } else if (mode === 'lifetime' && f.lifetime_budget_reais) {
                    out.lifetime_budget = Math.round(parseFloat(f.lifetime_budget_reais) * 100);
                    out.daily_budget = 0;
                }
                if (f.bid_strategy && f.bid_strategy !== this._editingDetail?.bid_strategy) {
                    const needsBidAmount = ['LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS'];
                    if (needsBidAmount.includes(f.bid_strategy)) {
                        throw new Error(`Estratégia "${f.bid_strategy}" requer um valor de lance. Edite no Meta Ads Manager.`);
                    }
                    out.bid_strategy = f.bid_strategy;
                }
                if (f.spend_cap_reais) out.spend_cap = Math.round(parseFloat(f.spend_cap_reais) * 100);
                if (f.start_time) out.start_time = this._fromLocalDT(f.start_time);
                if (f.stop_time) out.stop_time = this._fromLocalDT(f.stop_time);
            }
            if (level === 'adset') {
                if (mode === 'daily' && f.daily_budget_reais) {
                    out.daily_budget = Math.round(parseFloat(f.daily_budget_reais) * 100);
                    out.lifetime_budget = 0;
                } else if (mode === 'lifetime' && f.lifetime_budget_reais) {
                    out.lifetime_budget = Math.round(parseFloat(f.lifetime_budget_reais) * 100);
                    out.daily_budget = 0;
                }
                if (f.bid_strategy && f.bid_strategy !== this._editingDetail?.bid_strategy) {
                    const needsBidAmount = ['LOWEST_COST_WITH_BID_CAP', 'COST_CAP', 'LOWEST_COST_WITH_MIN_ROAS'];
                    if (needsBidAmount.includes(f.bid_strategy) && !f.bid_amount_reais) {
                        throw new Error(`Estratégia "${f.bid_strategy}" requer "Valor do lance" preenchido.`);
                    }
                    out.bid_strategy = f.bid_strategy;
                }
                if (f.bid_amount_reais) out.bid_amount = Math.round(parseFloat(f.bid_amount_reais) * 100);
                if (f.optimization_goal && f.optimization_goal !== this._editingDetail?.optimization_goal) out.optimization_goal = f.optimization_goal;
                if (f.billing_event && f.billing_event !== this._editingDetail?.billing_event) out.billing_event = f.billing_event;
                if (f.start_time) out.start_time = this._fromLocalDT(f.start_time);
                if (f.end_time) out.end_time = this._fromLocalDT(f.end_time);

                // Targeting
                const targeting = this._buildTargetingPayload(f);
                if (targeting) out.targeting = JSON.stringify(targeting);
            }
            return out;
        },

        _buildTargetingPayload(f) {
            // Build a new targeting object based on form values, preserving fields we don't expose
            const orig = this._editingDetail?.targeting || {};
            const out = JSON.parse(JSON.stringify(orig)); // clone to preserve untouched fields

            // Geo (países)
            if (f.tg_countries !== undefined) {
                const codes = (f.tg_countries || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
                if (codes.length > 0) {
                    out.geo_locations = { ...(out.geo_locations || {}), countries: codes };
                    delete out.geo_locations.cities;
                    delete out.geo_locations.regions;
                } else if (out.geo_locations) {
                    delete out.geo_locations.countries;
                }
            }

            // Idade
            const ageMin = parseInt(f.tg_age_min, 10);
            const ageMax = parseInt(f.tg_age_max, 10);
            if (!isNaN(ageMin)) out.age_min = Math.max(13, Math.min(65, ageMin));
            if (!isNaN(ageMax)) out.age_max = Math.max(13, Math.min(65, ageMax));

            // Gênero
            const g = parseInt(f.tg_genders, 10);
            if (g === 1 || g === 2) out.genders = [g];
            else delete out.genders;

            // Interesses — sempre escreve o novo array
            const interests = this._editingInterests || [];
            if (interests.length > 0) {
                out.flexible_spec = [{ interests: interests.map(i => ({ id: i.id, name: i.name })) }];
                delete out.interests; // limpa legacy
            } else {
                delete out.flexible_spec;
                delete out.interests;
            }

            // Posicionamentos
            const platforms = ['facebook', 'instagram', 'audience_network', 'messenger']
                .filter(p => f[`tg_placement_${p}`] === 'on' || f[`tg_placement_${p}`] === true);
            // Above won't work because checkbox value is 'on' if checked, but data-edit-key reading uses .value which is 'on'.
            // We actually need to check the DOM:
            const checked = ['facebook', 'instagram', 'audience_network', 'messenger']
                .filter(p => document.querySelector(`[data-edit-key="tg_placement_${p}"]`)?.checked);
            if (checked.length === 0 || checked.length === 4) {
                // Todos selecionados ou nenhum = automático (deixa FB decidir)
                delete out.publisher_platforms;
                delete out.facebook_positions;
                delete out.instagram_positions;
            } else {
                out.publisher_platforms = checked;
            }

            return out;
        },

        _toLocalDT(iso) {
            if (!iso) return '';
            try {
                const d = new Date(iso);
                const pad = (n) => String(n).padStart(2, '0');
                return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
            } catch { return ''; }
        },

        _fromLocalDT(local) {
            if (!local) return '';
            try { return new Date(local).toISOString(); } catch { return local; }
        },

        _adsManagerUrl(row) {
            const acc = this.state.accountId;
            if (this.state.level === 'campaign') {
                return `https://www.facebook.com/adsmanager/manage/campaigns?act=${acc}&selected_campaign_ids=${row.id}`;
            }
            if (this.state.level === 'adset') {
                return `https://www.facebook.com/adsmanager/manage/adsets?act=${acc}&selected_adset_ids=${row.id}`;
            }
            return `https://www.facebook.com/adsmanager/manage/ads?act=${acc}&selected_ad_ids=${row.id}`;
        },

        _fmtMoney(v) {
            if (!v) return '-';
            return 'R$ ' + (v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        },
        _fmtNumber(v) {
            if (!v) return '-';
            return (v).toLocaleString('pt-BR');
        },
        _esc(s) {
            return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.AdsManager = AdsManager;
    AdsManager.init();
})();
