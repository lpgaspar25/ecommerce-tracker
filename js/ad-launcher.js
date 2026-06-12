/* ===========================
   AdLauncher — push criativos como anúncios para o Meta
   - Picker estilo Madgicx (Criativos / AI Generations)
   - Selecionar campanha → ad set
   - Compose copy + CTA + URL
   - Cria adimage → adcreative → ad via Graph API
   =========================== */
(function () {
    const AdLauncher = {
        state: {
            mode: 'single',               // 'single' | 'cluster'
            source: 'creatives',          // 'creatives' | 'generations' | 'used' | 'uploads'
            productFilter: '',
            search: '',
            selectedIds: new Set(),
            campaigns: [],
            adsets: [],
            pages: [],
            instagramAccounts: [],
            launching: false,
            cluster: {
                primary_text: [],          // [{id, content}]
                headline: [],
                description: [],
            },
        },

        init() {
            if (document.readyState !== 'loading') this._setup();
            else document.addEventListener('DOMContentLoaded', () => this._setup());
        },

        _setup() {
            this._bindUI();
            if (typeof EventBus !== 'undefined') {
                EventBus.on('tabChanged', (tab) => {
                    if (tab === 'ad-launcher') this.refresh();
                });
                EventBus.on('creativesChanged', () => { if (this._isActive()) this._renderPicker(); });
                EventBus.on('aigenChanged', () => { if (this._isActive() && this.state.source === 'generations') this._renderPicker(); });
            }
            // se a aba já está ativa no carregamento
            if (this._isActive()) setTimeout(() => this.refresh(), 50);
        },

        _isActive() {
            return document.getElementById('tab-ad-launcher')?.classList.contains('active');
        },

        _bindUI() {
            // tabs do picker
            document.querySelectorAll('[data-adl-source]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this.state.source = btn.dataset.adlSource;
                    document.querySelectorAll('[data-adl-source]').forEach(b => b.classList.toggle('adl-picker-tab-active', b === btn));
                    this.state.selectedIds.clear();
                    if (this.state.source === 'used' && !this.state.usedImages) this._loadUsedImages();
                    this._renderPicker();
                    this._renderSelected();
                });
            });

            // Library buttons (primary_text / headline / description) — performance based
            document.querySelectorAll('[data-adl-library]').forEach(btn => {
                btn.addEventListener('click', () => this._openLibrary(btn.dataset.adlLibrary));
            });

            // Saved Copy Library
            document.querySelectorAll('[data-adl-saved]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const type = btn.dataset.adlSaved;
                    const fieldId = { primary_text: 'adl-primary-text', headline: 'adl-headline', description: 'adl-description' }[type];
                    if (!window.CopyLibrary) return;
                    CopyLibrary.openPicker(type, (content) => {
                        const el = document.getElementById(fieldId);
                        if (el) { el.value = content; el.dispatchEvent(new Event('input')); }
                    });
                });
            });

            // AI Variations (Claude)
            document.querySelectorAll('[data-adl-ai-variations]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const type = btn.dataset.adlAiVariations;
                    const fieldId = { primary_text: 'adl-primary-text', headline: 'adl-headline', description: 'adl-description' }[type];
                    const el = document.getElementById(fieldId);
                    const current = (el?.value || '').trim();
                    if (!current) {
                        if (typeof showToast === 'function') showToast('Escreva algo antes de gerar variações', 'error');
                        return;
                    }
                    if (!window.CopyLibrary) return;
                    CopyLibrary.openVariations(type, current, (variation) => {
                        if (el) { el.value = variation; el.dispatchEvent(new Event('input')); }
                    });
                });
            });

            // Save Copy to library
            document.querySelectorAll('[data-adl-save-copy]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const type = btn.dataset.adlSaveCopy;
                    const fieldId = { primary_text: 'adl-primary-text', headline: 'adl-headline', description: 'adl-description' }[type];
                    const el = document.getElementById(fieldId);
                    const content = (el?.value || '').trim();
                    if (!content) { if (typeof showToast === 'function') showToast('Vazio', 'error'); return; }
                    if (window.CopyLibrary) {
                        CopyLibrary.add(type, content);
                        if (typeof showToast === 'function') showToast('Salvo na biblioteca', 'success');
                    }
                });
            });

            // Collapsible numbered sections
            document.querySelectorAll('[data-adl-section-toggle]').forEach(header => {
                header.addEventListener('click', () => {
                    const wrap = header.closest('.adl-section');
                    if (wrap) wrap.classList.toggle('adl-section-open');
                });
            });

            // Live preview: update on any copy/url/cta/page change
            ['adl-primary-text', 'adl-headline', 'adl-description', 'adl-link-url', 'adl-display-link', 'adl-cta', 'adl-page']
                .forEach(id => {
                    const el = document.getElementById(id);
                    if (!el) return;
                    el.addEventListener('input', () => this._renderAdPreview());
                    el.addEventListener('change', () => this._renderAdPreview());
                });

            // Mode tabs (Single / Cluster)
            document.querySelectorAll('[data-adl-mode]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const mode = btn.dataset.adlMode;
                    this.state.mode = mode;
                    document.querySelectorAll('[data-adl-mode]').forEach(b => b.classList.toggle('adl-mode-tab-active', b === btn));
                    document.getElementById('adl-cluster-panel').style.display = mode === 'cluster' ? '' : 'none';
                    this._updateClusterCount();
                    this._updateLaunchButton();
                });
            });

            // Cluster add buttons
            document.querySelectorAll('[data-adl-cluster-add]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const type = btn.dataset.adlClusterAdd;
                    this._addClusterItem(type, '');
                });
            });
            document.getElementById('adl-library-search')?.addEventListener('input', () => this._renderLibrary());
            document.getElementById('adl-library-sort')?.addEventListener('change', () => this._renderLibrary());
            document.querySelectorAll('#adl-library-modal [data-close-modal]').forEach(b => {
                b.addEventListener('click', () => {
                    document.getElementById('adl-library-modal').style.display = 'none';
                });
            });

            // Empty state config button
            document.getElementById('adl-empty-config')?.addEventListener('click', () => {
                if (typeof FacebookAds !== 'undefined' && FacebookAds._openConfigModal) {
                    FacebookAds._openConfigModal();
                }
            });

            // Importar interesses de campanhas
            document.getElementById('adl-import-interests-btn')?.addEventListener('click', () => this._openImportInterests());

            // Upload
            const uploadBtn = document.getElementById('adl-upload-btn');
            const uploadInput = document.getElementById('adl-upload-input');
            if (uploadBtn && uploadInput) {
                uploadBtn.addEventListener('click', () => uploadInput.click());
                uploadInput.addEventListener('change', (e) => {
                    this._handleUpload(e.target.files);
                    e.target.value = '';
                });
            }

            document.getElementById('adl-filter-product')?.addEventListener('change', (e) => {
                this.state.productFilter = e.target.value;
                this._renderPicker();
            });
            document.getElementById('adl-filter-search')?.addEventListener('input', (e) => {
                this.state.search = e.target.value.toLowerCase();
                this._renderPicker();
            });

            document.getElementById('adl-account')?.addEventListener('change', (e) => {
                if (typeof FacebookAds === 'undefined') return;
                FacebookAds.config.activeAdAccountId = e.target.value;
                FacebookAds.saveConfig();
                this._loadCampaigns();
            });

            document.getElementById('adl-campaign')?.addEventListener('change', () => this._loadAdsets());

            // Adset select: toggle inline form quando "__new__"
            document.getElementById('adl-adset')?.addEventListener('change', (e) => {
                this._toggleNewAdsetForm(e.target.value === '__new__');
                this._updateLaunchButton();
            });

            // Campaign budget mode toggle
            document.getElementById('adl-new-campaign-budget-mode')?.addEventListener('change', (e) => {
                const wrap = document.getElementById('adl-new-campaign-budget-wrap');
                if (wrap) wrap.style.display = e.target.value === 'adset' ? 'none' : '';
            });
            document.getElementById('adl-refresh-campaigns')?.addEventListener('click', () => this._loadCampaigns(true));
            document.getElementById('adl-refresh-pages')?.addEventListener('click', () => this._loadPages(true));

            document.getElementById('adl-page')?.addEventListener('change', () => this._loadInstagramAccounts());

            // Validação contínua para habilitar o Launch
            ['adl-campaign', 'adl-adset', 'adl-page', 'adl-link-url', 'adl-primary-text', 'adl-headline',
             'adl-new-campaign-name', 'adl-new-adset-name']
                .forEach(id => document.getElementById(id)?.addEventListener('input', () => this._updateLaunchButton()));
            ['adl-campaign', 'adl-adset', 'adl-page'].forEach(id =>
                document.getElementById(id)?.addEventListener('change', () => this._updateLaunchButton()));

            document.getElementById('adl-btn-launch')?.addEventListener('click', () => {
                const reason = this._launchBlockReason();
                if (reason) {
                    if (typeof showToast === 'function') showToast(reason, 'warning');
                    return;
                }
                this._handleLaunch();
            });

            // Close modal
            document.querySelectorAll('#adl-result-modal [data-close-modal]').forEach(b => {
                b.addEventListener('click', () => {
                    document.getElementById('adl-result-modal').style.display = 'none';
                });
            });
        },

        refresh() {
            const connected = typeof FacebookAds !== 'undefined' && FacebookAds.isConnected();
            const workspace = document.getElementById('adl-workspace');
            const empty = document.getElementById('adl-empty-state');
            if (!connected) {
                if (workspace) workspace.style.display = 'none';
                if (empty) {
                    empty.style.display = '';
                    const t = document.getElementById('adl-empty-title');
                    const d = document.getElementById('adl-empty-desc');
                    if (t) t.textContent = 'Conecte o Facebook Ads para começar';
                    if (d) d.textContent = 'Configure a conta de anúncios acima. Depois selecione criativos e lance direto para um conjunto de anúncios.';
                }
                return;
            }
            if (empty) empty.style.display = 'none';
            if (workspace) workspace.style.display = '';

            this._populateAccounts();
            this._populateProductFilter();
            this._renderPicker();
            this._renderSelected();
            this._loadCampaigns();
            this._loadPages();
            // Pre-load used images em background (não bloqueia render)
            this._loadUsedImages();
            this._updateLaunchButton();
        },

        _populateAccounts() {
            const sel = document.getElementById('adl-account');
            if (!sel) return;
            const accs = FacebookAds.config.adAccounts || [];
            sel.innerHTML = accs.map(a => `<option value="${a.id}">${this._esc(a.name)} (act_${a.id})</option>`).join('');
            sel.value = FacebookAds.config.activeAdAccountId || (accs[0]?.id || '');
        },

        _populateProductFilter() {
            const sel = document.getElementById('adl-filter-product');
            if (!sel) return;
            const products = (typeof AppState !== 'undefined' && Array.isArray(AppState.allProducts)) ? AppState.allProducts : [];
            sel.innerHTML = '<option value="">Todos os produtos</option>' +
                products.map(p => `<option value="${p.id}">${this._esc(p.name || p.id)}</option>`).join('');
            sel.value = this.state.productFilter;
        },

        _getItems() {
            if (this.state.source === 'creatives') {
                return (AppState.allCreatives || [])
                    .filter(c => c.imageUrl)
                    .map(c => ({
                        id: c.id,
                        title: c.name || 'Sem nome',
                        subtitle: this._productName(c.productId),
                        imageUrl: c.imageUrl,
                        productId: c.productId,
                        primaryText: c.primaryText || '',
                        headline: c.headline || '',
                        description: c.adDescription || '',
                        source: 'creative',
                    }));
            }
            if (this.state.source === 'generations') {
                let list = [];
                try { list = JSON.parse(localStorage.getItem('etracker_ai_generations') || '[]') || []; } catch { list = []; }
                return list
                    .filter(g => g.imageUrl || g.url || g.dataUrl)
                    .map(g => ({
                        id: g.id,
                        title: (g.prompt || '').slice(0, 60) || 'AI Generation',
                        subtitle: g.size || g.aspect || '',
                        imageUrl: g.imageUrl || g.url || g.dataUrl,
                        productId: g.productId || '',
                        primaryText: g.prompt || '',
                        headline: '',
                        description: '',
                        source: 'generation',
                    }));
            }
            if (this.state.source === 'used') {
                // Imagens que já foram usadas em anúncios (cache de _loadUsedImages)
                return (this.state.usedImages || []).map(u => ({
                    id: u.id,
                    title: u.name || 'Ad ativo',
                    subtitle: u.campaignName || u.adsetName || '',
                    imageUrl: u.imageUrl,
                    productId: '',
                    primaryText: u.primaryText || '',
                    headline: u.headline || '',
                    description: u.description || '',
                    metrics: u.metrics,
                    source: 'used',
                }));
            }
            if (this.state.source === 'uploads') {
                let list = [];
                try { list = JSON.parse(localStorage.getItem('etracker_adl_uploads') || '[]') || []; } catch { list = []; }
                return list.map(u => ({
                    id: u.id,
                    title: u.name || 'Upload',
                    subtitle: u.size || '',
                    imageUrl: u.dataUrl,
                    productId: '',
                    primaryText: '',
                    headline: '',
                    description: '',
                    source: 'upload',
                }));
            }
            return [];
        },

        async _loadUsedImages() {
            if (!FacebookAds.isConnected()) return;
            const accountId = FacebookAds.config.activeAdAccountId;
            try {
                // 1) Busca os ads ativos
                const params = new URLSearchParams({
                    access_token: FacebookAds.config.accessToken,
                    fields: 'id,name,creative{thumbnail_url,image_url,object_story_spec},adset{name},campaign{name}',
                    limit: '50',
                    filtering: '[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]',
                });
                const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/act_${accountId}/ads?${params}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                const ads = (data.data || []).filter(ad => ad.creative?.image_url || ad.creative?.thumbnail_url);

                // 2) Busca insights (últimos 7 dias) por ad — em paralelo
                const since = this._daysAgo(7);
                const until = this._daysAgo(0);
                const insParams = new URLSearchParams({
                    access_token: FacebookAds.config.accessToken,
                    fields: 'ad_id,spend,impressions,clicks,inline_link_clicks,ctr,action_values,actions',
                    level: 'ad',
                    time_range: JSON.stringify({ since, until }),
                    limit: '500',
                });
                const insUrl = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/act_${accountId}/insights?${insParams}`;
                let insByAd = {};
                try {
                    const insRes = await fetch(insUrl);
                    const insData = await insRes.json();
                    if (!insData.error) {
                        (insData.data || []).forEach(i => {
                            const spend = parseFloat(i.spend || 0);
                            const pv = parseFloat((i.action_values || []).find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value || 0);
                            insByAd[i.ad_id] = {
                                spend,
                                impressions: parseInt(i.impressions || 0, 10),
                                clicks: parseInt(i.inline_link_clicks || i.clicks || 0, 10),
                                ctr: parseFloat(i.ctr || 0),
                                purchaseValue: pv,
                                roas: spend > 0 ? pv / spend : 0,
                            };
                        });
                    }
                } catch (e) { console.warn('[AdLauncher] insights fetch failed:', e); }

                const currency = (FacebookAds.activeAccountCurrency && FacebookAds.activeAccountCurrency()) || 'USD';

                this.state.usedImages = ads.map(ad => {
                    const linkData = ad.creative?.object_story_spec?.link_data || {};
                    const m = insByAd[ad.id] || {};
                    return {
                        id: ad.id,
                        name: ad.name,
                        imageUrl: ad.creative.image_url || ad.creative.thumbnail_url,
                        primaryText: linkData.message || '',
                        headline: linkData.name || '',
                        description: linkData.description || '',
                        campaignName: ad.campaign?.name || '',
                        adsetName: ad.adset?.name || '',
                        metrics: { ...m, currency },
                    };
                });
                if (this.state.source === 'used') this._renderPicker();
            } catch (e) {
                console.warn('[AdLauncher] _loadUsedImages:', e);
            }
        },

        async _loadElementsPerformance(field) {
            // Pega histórico de copy/headline/description performance dos ads ativos
            if (!FacebookAds.isConnected()) return [];
            const accountId = FacebookAds.config.activeAdAccountId;
            const cacheKey = `perf_${field}`;
            if (this.state._perfCache && this.state._perfCache[cacheKey] && Date.now() - this.state._perfCache[cacheKey].ts < 120_000) {
                return this.state._perfCache[cacheKey].data;
            }
            const params = new URLSearchParams({
                access_token: FacebookAds.config.accessToken,
                fields: 'id,name,creative{object_story_spec,thumbnail_url}',
                limit: '200',
                filtering: '[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]',
            });
            const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/act_${accountId}/ads?${params}`;
            const adsRes = await fetch(url);
            const adsData = await adsRes.json();
            if (adsData.error) throw new Error(adsData.error.message);

            // Insights agrupados por ad
            const insParams = new URLSearchParams({
                access_token: FacebookAds.config.accessToken,
                fields: 'ad_id,spend,action_values,actions',
                level: 'ad',
                time_range: JSON.stringify({ since: this._daysAgo(7), until: this._daysAgo(0) }),
                limit: '500',
            });
            const insUrl = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/act_${accountId}/insights?${insParams}`;
            const insRes = await fetch(insUrl);
            const insData = await insRes.json();
            if (insData.error) throw new Error(insData.error.message);
            const insByAd = {};
            (insData.data || []).forEach(i => {
                const spend = parseFloat(i.spend || 0);
                const pv = parseFloat((i.action_values || []).find(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase')?.value || 0);
                insByAd[i.ad_id] = { spend, purchaseValue: pv, roas: spend > 0 ? pv / spend : 0 };
            });

            // Agrupa texto único + soma de gasto
            const map = {};
            (adsData.data || []).forEach(ad => {
                const ld = ad.creative?.object_story_spec?.link_data || {};
                const key = field === 'primary_text' ? ld.message
                          : field === 'headline'     ? ld.name
                          : field === 'description'  ? ld.description
                          : '';
                if (!key) return;
                const ins = insByAd[ad.id] || { spend: 0, roas: 0 };
                if (!map[key]) map[key] = { text: key, spend: 0, value: 0 };
                map[key].spend += ins.spend;
                map[key].value += ins.purchaseValue || 0;
            });
            const arr = Object.values(map).map(x => ({
                ...x,
                roas: x.spend > 0 ? x.value / x.spend : 0,
            }));
            this.state._perfCache = this.state._perfCache || {};
            this.state._perfCache[cacheKey] = { data: arr, ts: Date.now() };
            return arr;
        },

        _daysAgo(n) {
            const d = new Date(); d.setDate(d.getDate() - n);
            return d.toISOString().slice(0, 10);
        },

        async _openLibrary(field) {
            const labelMap = {
                primary_text: 'Textos principais — Últimos 7 dias',
                headline: 'Títulos — Últimos 7 dias',
                description: 'Descrições — Últimos 7 dias',
            };
            const modal = document.getElementById('adl-library-modal');
            const list = document.getElementById('adl-library-list');
            const title = document.getElementById('adl-library-title');
            if (!modal || !list) return;
            if (title) title.textContent = labelMap[field] || 'Biblioteca';
            list.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted)"><i data-lucide="loader-2" style="width:20px;height:20px;animation:spin 1s linear infinite"></i> Carregando…</div>';
            modal.style.display = 'flex';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            try {
                const items = await this._loadElementsPerformance(field);
                this._currentLibraryField = field;
                this._currentLibraryItems = items;
                this._renderLibrary();
            } catch (e) {
                list.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--danger)">Erro: ${this._esc(e.message)}</div>`;
            }
        },

        _renderLibrary() {
            const list = document.getElementById('adl-library-list');
            const searchEl = document.getElementById('adl-library-search');
            const sortEl = document.getElementById('adl-library-sort');
            if (!list) return;
            let items = (this._currentLibraryItems || []).slice();
            const q = (searchEl?.value || '').toLowerCase();
            if (q) items = items.filter(i => i.text.toLowerCase().includes(q));
            const sort = sortEl?.value || 'spend_desc';
            items.sort((a, b) => sort === 'roas_desc' ? b.roas - a.roas : sort === 'recent' ? 0 : b.spend - a.spend);
            if (items.length === 0) {
                list.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted)">Nenhum dado encontrado.<br>Crie anúncios e volte mais tarde.</div>';
                return;
            }
            list.innerHTML = items.map((it, idx) => `
                <div class="adl-library-row" data-idx="${idx}">
                    <div class="adl-library-row-text">${this._esc(it.text)}</div>
                    <div class="adl-library-row-stats">
                        <span class="adl-library-stat"><i data-lucide="dollar-sign" style="width:11px;height:11px"></i> R$ ${it.spend.toFixed(2)}</span>
                        <span class="adl-library-stat ${it.roas >= 2 ? 'adl-stat-good' : it.roas >= 1 ? 'adl-stat-mid' : 'adl-stat-bad'}">${it.roas > 0 ? it.roas.toFixed(2) + 'x' : '-'}</span>
                    </div>
                </div>
            `).join('');
            list.querySelectorAll('.adl-library-row').forEach(row => {
                row.addEventListener('click', () => {
                    const idx = parseInt(row.dataset.idx, 10);
                    const item = items[idx];
                    this._applyLibraryItem(this._currentLibraryField, item.text);
                });
            });
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        _applyLibraryItem(field, text) {
            const map = { primary_text: 'adl-primary-text', headline: 'adl-headline', description: 'adl-description' };
            const id = map[field];
            if (id) {
                const el = document.getElementById(id);
                if (el) {
                    el.value = text;
                    el.dispatchEvent(new Event('input'));
                }
            }
            document.getElementById('adl-library-modal').style.display = 'none';
        },

        _handleUpload(files) {
            if (!files || files.length === 0) return;
            let stored = [];
            try { stored = JSON.parse(localStorage.getItem('etracker_adl_uploads') || '[]') || []; } catch {}
            let pending = files.length;
            Array.from(files).forEach(f => {
                if (!f.type.startsWith('image/')) { pending--; return; }
                const reader = new FileReader();
                reader.onload = () => {
                    stored.unshift({
                        id: 'up_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                        name: f.name,
                        size: `${Math.round(f.size / 1024)} KB`,
                        dataUrl: reader.result,
                        createdAt: new Date().toISOString(),
                    });
                    pending--;
                    if (pending === 0) {
                        if (stored.length > 100) stored = stored.slice(0, 100);
                        localStorage.setItem('etracker_adl_uploads', JSON.stringify(stored));
                        if (typeof showToast === 'function') showToast(`${files.length} imagem(ns) enviada(s)`, 'success');
                        // Switch para tab Uploads
                        this.state.source = 'uploads';
                        document.querySelectorAll('[data-adl-source]').forEach(b => b.classList.toggle('adl-picker-tab-active', b.dataset.adlSource === 'uploads'));
                        this._renderPicker();
                    }
                };
                reader.readAsDataURL(f);
            });
        },

        _renderPicker() {
            const grid = document.getElementById('adl-picker-grid');
            if (!grid) return;
            const items = this._getItems()
                .filter(it => !this.state.productFilter || it.productId === this.state.productFilter)
                .filter(it => !this.state.search || (it.title + ' ' + it.subtitle).toLowerCase().includes(this.state.search));

            if (items.length === 0) {
                grid.innerHTML = `
                    <div class="adl-picker-empty">
                        <i data-lucide="image-off" style="width:32px;height:32px;color:var(--text-muted)"></i>
                        <p>${this.state.source === 'creatives'
                            ? 'Nenhum criativo com imagem encontrado. Gere imagens em AI Generations e salve nos criativos.'
                            : 'Nenhuma geração ainda. Crie em AI Generations.'}</p>
                    </div>`;
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                return;
            }

            const currencySymbols = { BRL: 'R$', USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$' };
            grid.innerHTML = items.map(it => {
                const selected = this.state.selectedIds.has(it.id);
                let metricsHtml = '';
                if (it.metrics && (it.metrics.spend > 0 || it.metrics.impressions > 0)) {
                    const m = it.metrics;
                    const sym = currencySymbols[m.currency] || (m.currency + ' ');
                    const roasCls = m.roas >= 2 ? 'good' : m.roas >= 1 ? '' : 'bad';
                    metricsHtml = `
                        <div class="adl-card-metrics">
                            <div class="adl-card-metric"><span class="adl-card-metric-label">Gasto</span><span class="adl-card-metric-value">${sym} ${(m.spend || 0).toFixed(2)}</span></div>
                            <div class="adl-card-metric"><span class="adl-card-metric-label">ROAS</span><span class="adl-card-metric-value ${roasCls}">${m.roas > 0 ? m.roas.toFixed(2) + 'x' : '—'}</span></div>
                            <div class="adl-card-metric"><span class="adl-card-metric-label">CTR</span><span class="adl-card-metric-value">${m.ctr ? m.ctr.toFixed(2) + '%' : '—'}</span></div>
                            <div class="adl-card-metric"><span class="adl-card-metric-label">Cliques</span><span class="adl-card-metric-value">${(m.clicks || 0).toLocaleString('pt-BR')}</span></div>
                        </div>`;
                }
                return `
                <div class="adl-card ${selected ? 'adl-card-selected' : ''}" data-id="${this._esc(it.id)}">
                    <div class="adl-card-thumb">
                        <img src="${this._esc(it.imageUrl)}" alt="${this._esc(it.title)}" loading="lazy">
                        <div class="adl-card-check">
                            <i data-lucide="${selected ? 'check' : 'plus'}" style="width:16px;height:16px"></i>
                        </div>
                    </div>
                    <div class="adl-card-meta">
                        <div class="adl-card-title">${this._esc(it.title)}</div>
                        ${it.subtitle ? `<div class="adl-card-sub">${this._esc(it.subtitle)}</div>` : ''}
                    </div>
                    ${metricsHtml}
                </div>`;
            }).join('');

            grid.querySelectorAll('.adl-card').forEach(card => {
                card.addEventListener('click', () => {
                    const id = card.dataset.id;
                    if (this.state.selectedIds.has(id)) this.state.selectedIds.delete(id);
                    else this.state.selectedIds.add(id);
                    this._renderPicker();
                    this._renderSelected();
                });
            });

            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        _renderSelected() {
            const list = document.getElementById('adl-selected-list');
            const count = document.getElementById('adl-selection-count');
            if (!list) return;
            const items = this._getItems().filter(it => this.state.selectedIds.has(it.id));
            if (count) count.textContent = `${items.length} selecionado${items.length !== 1 ? 's' : ''}`;

            if (items.length === 0) {
                list.innerHTML = '<div class="adl-selected-empty">Nenhum criativo selecionado</div>';
            } else {
                list.innerHTML = items.map(it => `
                    <div class="adl-selected-chip" data-id="${this._esc(it.id)}">
                        <img src="${this._esc(it.imageUrl)}" alt="">
                        <span class="adl-selected-chip-title">${this._esc(it.title)}</span>
                        <button class="adl-selected-chip-x" title="Remover">&times;</button>
                    </div>
                `).join('');
                list.querySelectorAll('.adl-selected-chip-x').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        const id = e.target.closest('.adl-selected-chip').dataset.id;
                        this.state.selectedIds.delete(id);
                        this._renderPicker();
                        this._renderSelected();
                    });
                });
            }

            // Autofill copy a partir do primeiro selecionado se vazio
            const first = items[0];
            if (first) {
                const pt = document.getElementById('adl-primary-text');
                const hl = document.getElementById('adl-headline');
                const dc = document.getElementById('adl-description');
                if (pt && !pt.value && first.primaryText) pt.value = first.primaryText.slice(0, 500);
                if (hl && !hl.value && first.headline) hl.value = first.headline.slice(0, 40);
                if (dc && !dc.value && first.description) dc.value = first.description.slice(0, 30);
            }

            this._updateLaunchButton();
            this._updateClusterCount();
            this._renderAdPreview();
        },

        async _loadCampaigns(force = false) {
            const sel = document.getElementById('adl-campaign');
            if (!sel) return;
            if (!FacebookAds.isConnected()) return;
            sel.innerHTML = '<option value="">Carregando…</option>';
            sel.disabled = true;
            try {
                const campaigns = await FacebookAds.fetchCampaigns();
                this.state.campaigns = campaigns || [];
                sel.innerHTML = '<option value="">Selecione uma campanha</option>' +
                    '<option value="__new__" style="color:var(--accent);font-weight:600">+ Criar nova campanha…</option>' +
                    this.state.campaigns.map(c => `<option value="${c.id}">${this._esc(c.name)} · ${c.effective_status || c.status}</option>`).join('');
                sel.disabled = false;
            } catch (e) {
                sel.innerHTML = '<option value="">Erro ao carregar</option>';
                if (typeof showToast === 'function') showToast('Erro ao carregar campanhas: ' + e.message, 'error');
            }
        },

        async _loadAdsets() {
            const campaignId = document.getElementById('adl-campaign')?.value;
            const sel = document.getElementById('adl-adset');
            if (!sel) return;
            this._toggleNewCampaignForm(campaignId === '__new__');
            if (!campaignId || campaignId === '__new__') {
                if (campaignId === '__new__') {
                    sel.innerHTML = '<option value="">Selecione conjunto existente ou crie novo</option>' +
                        '<option value="__new__" style="color:var(--accent);font-weight:600">+ Criar novo conjunto…</option>';
                    sel.disabled = false;
                    this._toggleNewAdsetForm(true);
                    sel.value = '__new__';
                    this._updateLaunchButton();
                    return;
                }
                sel.innerHTML = '<option value="">Selecione uma campanha primeiro</option>';
                sel.disabled = true;
                this._toggleNewAdsetForm(false);
                return;
            }
            sel.innerHTML = '<option value="">Carregando…</option>';
            sel.disabled = true;
            try {
                const adsets = await this._graphGet(`${campaignId}/adsets`, {
                    fields: 'id,name,status,effective_status,daily_budget,lifetime_budget,billing_event,optimization_goal,promoted_object',
                    limit: 200,
                });
                this.state.adsets = adsets?.data || [];
                const newOpt = '<option value="__new__" style="color:var(--accent);font-weight:600">+ Criar novo conjunto…</option>';
                if (this.state.adsets.length === 0) {
                    sel.innerHTML = '<option value="">Nenhum conjunto nesta campanha</option>' + newOpt;
                    sel.disabled = false;
                } else {
                    sel.innerHTML = '<option value="">Selecione o conjunto de anúncios</option>' + newOpt +
                        this.state.adsets.map(a => `<option value="${a.id}">${this._esc(a.name)} · ${a.effective_status || a.status}</option>`).join('');
                    sel.disabled = false;
                }
            } catch (e) {
                sel.innerHTML = '<option value="">Erro ao carregar</option>';
                if (typeof showToast === 'function') showToast('Erro ao carregar conjuntos: ' + e.message, 'error');
            }
            this._updateLaunchButton();
        },

        _toggleNewCampaignForm(show) {
            const form = document.getElementById('adl-new-campaign-form');
            if (form) form.style.display = show ? '' : 'none';
        },
        _toggleNewAdsetForm(show) {
            const form = document.getElementById('adl-new-adset-form');
            if (form) form.style.display = show ? '' : 'none';
            if (show && !this._adsetInterestsInit) {
                this._adsetInterestsInit = true;
                this._newAdsetInterests = [];
                this._initLauncherInterestPicker();
            }
            if (show) this._loadPixels();
        },

        async _loadPixels() {
            const sel = document.getElementById('adl-new-adset-pixel');
            if (!sel || !FacebookAds.isConnected()) return;
            if (this._pixelsLoaded) return;
            const accountId = FacebookAds.config.activeAdAccountId;
            try {
                const data = await this._graphGet(`act_${accountId}/adspixels`, {
                    fields: 'id,name,last_fired_time,is_unavailable',
                    limit: 50,
                });
                const pixels = data?.data || [];
                if (pixels.length === 0) {
                    sel.innerHTML = '<option value="">Nenhum pixel encontrado</option>';
                } else {
                    sel.innerHTML = pixels.map(p => {
                        const status = p.is_unavailable ? ' (indisponível)' : '';
                        const lastFired = p.last_fired_time
                            ? ` · disparou ${new Date(p.last_fired_time).toLocaleDateString('pt-BR')}`
                            : '';
                        return `<option value="${p.id}">${this._esc(p.name || p.id)}${status}${lastFired}</option>`;
                    }).join('');
                }
                this._pixelsLoaded = true;
            } catch (e) {
                sel.innerHTML = `<option value="">Erro: ${this._esc(e.message)}</option>`;
            }
        },

        _initLauncherInterestPicker() {
            const inputEl = document.getElementById('adl-new-adset-interest-search');
            const sugEl = document.getElementById('adl-new-adset-interest-sug');
            const chipsEl = document.getElementById('adl-new-adset-interests-chips');
            if (!inputEl || !sugEl || !chipsEl) return;

            const renderChips = () => {
                const arr = this._newAdsetInterests || [];
                chipsEl.innerHTML = arr.length === 0
                    ? '<span class="adm-interest-empty">Nenhum interesse</span>'
                    : arr.map((it, idx) => `<span class="adm-interest-chip">${this._esc(it.name)}<button class="adm-interest-chip-x" data-idx="${idx}">&times;</button></span>`).join('');
            };
            renderChips();
            this._renderNewAdsetChips = renderChips;

            // Event delegation no chips: remove
            if (!chipsEl._bound) {
                chipsEl._bound = true;
                chipsEl.addEventListener('click', (e) => {
                    const btn = e.target.closest('.adm-interest-chip-x');
                    if (!btn) return;
                    e.preventDefault();
                    const idx = parseInt(btn.dataset.idx, 10);
                    if (!isNaN(idx)) {
                        this._newAdsetInterests.splice(idx, 1);
                        renderChips();
                    }
                });
            }

            // Event delegation nas suggestions
            if (!sugEl._bound) {
                sugEl._bound = true;
                sugEl.addEventListener('mousedown', (e) => {
                    // mousedown evita perder o foco antes do click + blur
                    const item = e.target.closest('.adm-interest-sug-item');
                    if (!item) return;
                    e.preventDefault();
                    const idx = parseInt(item.dataset.idx, 10);
                    const it = this._currentSearchItems?.[idx];
                    if (!it) return;
                    if (!this._newAdsetInterests.some(x => x.id === it.id)) {
                        this._newAdsetInterests.push({ id: it.id, name: it.name });
                        renderChips();
                    }
                    inputEl.value = '';
                    sugEl.style.display = 'none';
                    inputEl.focus();
                });
            }

            let timer = null;
            inputEl.addEventListener('input', () => {
                const q = inputEl.value.trim();
                if (timer) clearTimeout(timer);
                if (!q) { sugEl.style.display = 'none'; return; }
                timer = setTimeout(async () => {
                    sugEl.style.display = '';
                    sugEl.innerHTML = '<div class="adm-interest-sug-loading">Buscando…</div>';
                    try {
                        const params = new URLSearchParams({
                            access_token: FacebookAds.config.accessToken,
                            type: 'adinterest', q, locale: 'pt_BR', limit: '20',
                        });
                        const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/search?${params}`;
                        const res = await fetch(url);
                        const data = await res.json();
                        if (data.error) throw new Error(data.error.message);
                        const items = data.data || [];
                        this._currentSearchItems = items;
                        if (items.length === 0) {
                            sugEl.innerHTML = '<div class="adm-interest-sug-empty">Nenhum resultado</div>';
                            return;
                        }
                        sugEl.innerHTML = items.map((it, idx) => {
                            const path = (it.path || []).slice(0, -1).join(' › ');
                            const aud = it.audience_size_lower_bound ? `${this._fmtNumber(it.audience_size_lower_bound)}–${this._fmtNumber(it.audience_size_upper_bound)}` : '';
                            return `<div class="adm-interest-sug-item" data-idx="${idx}"><div class="adm-interest-sug-main"><strong>${this._esc(it.name)}</strong>${path ? `<span class="adm-interest-sug-path">${this._esc(path)}</span>` : ''}</div>${aud ? `<span class="adm-interest-sug-aud">${aud}</span>` : ''}</div>`;
                        }).join('');
                    } catch (e) {
                        sugEl.innerHTML = `<div class="adm-interest-sug-empty">Erro: ${this._esc(e.message)}</div>`;
                    }
                }, 280);
            });
            // Close on outside click
            if (!this._outsideBound) {
                this._outsideBound = true;
                document.addEventListener('click', (e) => {
                    const sug = document.getElementById('adl-new-adset-interest-sug');
                    const inp = document.getElementById('adl-new-adset-interest-search');
                    if (sug && !sug.contains(e.target) && e.target !== inp) sug.style.display = 'none';
                });
            }
        },

        _fmtNumber(n) {
            return (n || 0).toLocaleString('pt-BR');
        },

        async _openImportInterests() {
            const modal = document.getElementById('adl-import-interests-modal');
            const list = document.getElementById('adl-import-interests-list');
            if (!modal || !list) return;
            modal.style.display = 'flex';
            list.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted)"><i data-lucide="loader-2" style="width:20px;height:20px;animation:spin 1s linear infinite"></i> Carregando…</div>';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            // Bind close + add buttons (once)
            if (!modal._bound) {
                modal._bound = true;
                modal.querySelectorAll('[data-close-modal]').forEach(b => {
                    b.addEventListener('click', () => { modal.style.display = 'none'; });
                });
                document.getElementById('adl-import-interests-search')?.addEventListener('input', () => this._renderImportInterests());
                document.getElementById('adl-import-interests-add')?.addEventListener('click', () => this._addImportedInterests());
                document.getElementById('adl-import-interests-list')?.addEventListener('click', (e) => {
                    const row = e.target.closest('.adl-import-row');
                    if (!row) return;
                    const id = row.dataset.id;
                    if (this._importSelected.has(id)) this._importSelected.delete(id);
                    else this._importSelected.add(id);
                    row.classList.toggle('adl-import-row-selected', this._importSelected.has(id));
                    this._updateImportSelectedCount();
                });
            }
            this._importSelected = new Set();

            try {
                if (!FacebookAds.isConnected()) throw new Error('Facebook não conectado');
                const accountId = FacebookAds.config.activeAdAccountId;
                // Busca todos os adsets ATIVOS/PAUSADOS da conta
                const params = new URLSearchParams({
                    access_token: FacebookAds.config.accessToken,
                    fields: 'id,name,targeting,campaign{name}',
                    filtering: '[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]',
                    limit: '500',
                });
                const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/act_${accountId}/adsets?${params}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);

                // Extrai interesses + agrupa por id
                const byId = {};
                (data.data || []).forEach(adset => {
                    const t = adset.targeting || {};
                    const interests = (t.flexible_spec?.[0]?.interests || []).concat(t.interests || []);
                    interests.forEach(it => {
                        if (!byId[it.id]) {
                            byId[it.id] = { id: it.id, name: it.name, count: 0, sources: [] };
                        }
                        byId[it.id].count++;
                        if (byId[it.id].sources.length < 3) {
                            byId[it.id].sources.push(adset.campaign?.name || adset.name);
                        }
                    });
                });
                this._importInterests = Object.values(byId).sort((a, b) => b.count - a.count);
                this._renderImportInterests();
            } catch (e) {
                list.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--danger)">Erro: ${this._esc(e.message)}</div>`;
            }
        },

        _renderImportInterests() {
            const list = document.getElementById('adl-import-interests-list');
            const countEl = document.getElementById('adl-import-interests-count');
            const search = document.getElementById('adl-import-interests-search');
            if (!list) return;
            let items = this._importInterests || [];
            const q = (search?.value || '').toLowerCase();
            if (q) items = items.filter(it => it.name.toLowerCase().includes(q));
            if (countEl) countEl.textContent = `${items.length} únicos`;

            // Filtra os que já estão nos chips
            const already = new Set((this._newAdsetInterests || []).map(x => x.id));

            if (items.length === 0) {
                list.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted)">Nenhum interesse encontrado em campanhas existentes</div>';
                return;
            }
            list.innerHTML = items.map(it => {
                const alreadyAdded = already.has(it.id);
                const selected = this._importSelected.has(it.id);
                return `<div class="adl-import-row ${selected ? 'adl-import-row-selected' : ''} ${alreadyAdded ? 'adl-import-row-disabled' : ''}" data-id="${this._esc(it.id)}">
                    <div class="adl-import-check"><i data-lucide="${selected ? 'check-square' : alreadyAdded ? 'check-circle-2' : 'square'}" style="width:16px;height:16px;${alreadyAdded ? 'color:var(--success)' : ''}"></i></div>
                    <div style="flex:1;min-width:0">
                        <strong style="display:block;font-size:0.88rem;color:var(--text-primary)">${this._esc(it.name)}</strong>
                        <small style="font-size:0.7rem;color:var(--text-muted);display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${this._esc(it.sources.join(' · '))}</small>
                    </div>
                    <span class="adl-import-count">${it.count} ${it.count === 1 ? 'conjunto' : 'conjuntos'}</span>
                </div>`;
            }).join('');
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
            this._updateImportSelectedCount();
        },

        _updateImportSelectedCount() {
            const el = document.getElementById('adl-import-interests-selected');
            if (el) el.textContent = `${this._importSelected.size} selecionado(s)`;
        },

        _addImportedInterests() {
            if (!this._importSelected || this._importSelected.size === 0) return;
            const toAdd = (this._importInterests || []).filter(it => this._importSelected.has(it.id));
            const existing = new Set((this._newAdsetInterests || []).map(x => x.id));
            toAdd.forEach(it => {
                if (!existing.has(it.id)) this._newAdsetInterests.push({ id: it.id, name: it.name });
            });
            if (this._renderNewAdsetChips) this._renderNewAdsetChips();
            document.getElementById('adl-import-interests-modal').style.display = 'none';
            if (typeof showToast === 'function') showToast(`${toAdd.length} interesse(s) adicionado(s)`, 'success');
        },

        async _loadPages(force = false) {
            const sel = document.getElementById('adl-page');
            if (!sel) return;
            sel.innerHTML = '<option value="">Carregando páginas…</option>';
            try {
                const res = await this._graphGet('me/accounts', {
                    fields: 'id,name,access_token,instagram_business_account{id,username}',
                    limit: 100,
                });
                this.state.pages = res?.data || [];
                if (this.state.pages.length === 0) {
                    sel.innerHTML = '<option value="">Nenhuma página encontrada</option>';
                } else {
                    sel.innerHTML = '<option value="">Selecione a página</option>' +
                        this.state.pages.map(p => `<option value="${p.id}">${this._esc(p.name)}</option>`).join('');
                }
                this._loadInstagramAccounts();
            } catch (e) {
                sel.innerHTML = '<option value="">Erro ao carregar</option>';
                if (typeof showToast === 'function') showToast('Erro ao carregar páginas: ' + e.message, 'error');
            }
        },

        _loadInstagramAccounts() {
            const sel = document.getElementById('adl-ig');
            const pageId = document.getElementById('adl-page')?.value;
            if (!sel) return;
            const page = this.state.pages.find(p => p.id === pageId);
            const ig = page?.instagram_business_account;
            if (ig?.id) {
                sel.innerHTML = `<option value="${ig.id}" selected>@${this._esc(ig.username || ig.id)} (vinculado)</option>`;
                this.state.instagramAccounts = [ig];
            } else {
                sel.innerHTML = '<option value="">Nenhum Instagram vinculado</option>';
                this.state.instagramAccounts = [];
            }
        },

        _updateLaunchButton() {
            const btn = document.getElementById('adl-btn-launch');
            if (!btn) return;
            const reason = this._launchBlockReason();
            const ok = !reason && !this.state.launching;
            // NÃO usa btn.disabled (suprime click event) — usa classe + lógica no handler
            btn.disabled = this.state.launching;
            btn.classList.toggle('adl-btn-disabled', !ok);
            btn.dataset.canLaunch = ok ? '1' : '0';
            btn.title = reason || '';
            // Atualiza label
            const campaignVal = document.getElementById('adl-campaign')?.value;
            const adsetVal = document.getElementById('adl-adset')?.value;
            const creatingCampaign = campaignVal === '__new__';
            const creatingAdset = adsetVal === '__new__';
            const label = creatingCampaign ? 'Lançar (cria campanha+conjunto)' : creatingAdset ? 'Lançar (cria conjunto)' : 'Lançar';
            btn.innerHTML = `<i data-lucide="send" style="width:14px;height:14px"></i> ${label}`;
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            // Show inline missing fields hint below button
            this._renderLaunchHint(reason);
        },

        _launchBlockReason() {
            const adsetVal = document.getElementById('adl-adset')?.value;
            const campaignVal = document.getElementById('adl-campaign')?.value;
            const creatingCampaign = campaignVal === '__new__';
            const creatingAdset = adsetVal === '__new__';

            if (this.state.selectedIds.size === 0) return 'Selecione ao menos 1 criativo no painel da esquerda';
            if (!campaignVal) return 'Selecione uma campanha (ou crie nova)';
            if (creatingCampaign && !document.getElementById('adl-new-campaign-name')?.value.trim()) return 'Preencha o nome da nova campanha';
            if (!adsetVal) return 'Selecione um conjunto (ou crie novo)';
            if (creatingAdset && !document.getElementById('adl-new-adset-name')?.value.trim()) return 'Preencha o nome do novo conjunto';
            if (!document.getElementById('adl-page')?.value) return 'Selecione a página do Facebook';
            if (!document.getElementById('adl-primary-text')?.value.trim()) return 'Preencha o texto principal';
            if (!document.getElementById('adl-link-url')?.value.trim()) return 'Preencha a URL de destino';
            return '';
        },

        _renderLaunchHint(reason) {
            let hint = document.getElementById('adl-launch-hint');
            const footer = document.querySelector('.adl-panel-footer');
            if (!footer) return;
            if (!reason) {
                if (hint) hint.remove();
                return;
            }
            if (!hint) {
                hint = document.createElement('div');
                hint.id = 'adl-launch-hint';
                hint.className = 'adl-launch-hint';
                footer.insertBefore(hint, footer.firstChild);
            }
            hint.innerHTML = `<i data-lucide="alert-circle" style="width:13px;height:13px"></i> ${this._esc(reason)}`;
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        _renderAdPreview() {
            const card = document.getElementById('adl-preview-card');
            if (!card) return;
            const items = this._getItems().filter(it => this.state.selectedIds.has(it.id));
            const first = items[0];
            const primary = document.getElementById('adl-primary-text')?.value.trim();
            const headline = document.getElementById('adl-headline')?.value.trim();
            const description = document.getElementById('adl-description')?.value.trim();
            const url = document.getElementById('adl-link-url')?.value.trim();
            const displayLink = document.getElementById('adl-display-link')?.value.trim()
                || (url ? (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })() : '');
            const ctaEl = document.getElementById('adl-cta');
            const ctaLabels = {
                LEARN_MORE: 'Saiba mais', SHOP_NOW: 'Comprar agora', SIGN_UP: 'Cadastre-se',
                SUBSCRIBE: 'Inscrever-se', GET_OFFER: 'Pegar oferta', ORDER_NOW: 'Pedir agora',
                DOWNLOAD: 'Baixar', CONTACT_US: 'Fale conosco', BOOK_TRAVEL: 'Reservar',
                APPLY_NOW: 'Inscrever-se', GET_QUOTE: 'Solicitar cotação', WATCH_MORE: 'Ver mais',
            };
            const ctaLabel = ctaLabels[ctaEl?.value] || 'Saiba mais';
            const pageSel = document.getElementById('adl-page');
            const pageName = pageSel?.options?.[pageSel.selectedIndex]?.text || 'Sua página';
            const firstLetter = (pageName[0] || 'A').toUpperCase();

            if (!first && !primary && !headline) {
                card.innerHTML = '<div class="adl-preview-empty">Selecione um criativo e preencha os textos para visualizar</div>';
                return;
            }

            card.innerHTML = `
                <div class="adl-preview-page">
                    <span class="adl-preview-page-avatar">${this._esc(firstLetter)}</span>
                    <div class="adl-preview-page-info">
                        <strong>${this._esc(pageName.split(' (')[0])}</strong>
                        <span>Patrocinado</span>
                    </div>
                </div>
                ${primary ? `<div class="adl-preview-text">${this._esc(primary)}</div>` : ''}
                ${first?.imageUrl ? `<img class="adl-preview-image" src="${this._esc(first.imageUrl)}" alt="">` : '<div class="adl-preview-image" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.78rem">Sem imagem selecionada</div>'}
                <div class="adl-preview-cta-row">
                    <div class="adl-preview-cta-row-left">
                        ${displayLink ? `<small>${this._esc(displayLink)}</small>` : ''}
                        ${headline ? `<strong>${this._esc(headline)}</strong>` : ''}
                        ${description ? `<em>${this._esc(description)}</em>` : ''}
                    </div>
                    <button class="adl-preview-cta-btn">${this._esc(ctaLabel)}</button>
                </div>
            `;
        },

        // ===== Creative Cluster =====
        _addClusterItem(type, content) {
            const arr = this.state.cluster[type];
            arr.push({ id: 'c_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), content });
            this._renderCluster();
        },

        _removeClusterItem(type, id) {
            this.state.cluster[type] = this.state.cluster[type].filter(it => it.id !== id);
            this._renderCluster();
        },

        _renderCluster() {
            ['primary_text', 'headline', 'description'].forEach(type => {
                const containerId = {
                    primary_text: 'adl-cluster-primary-texts',
                    headline: 'adl-cluster-headlines',
                    description: 'adl-cluster-descriptions',
                }[type];
                const container = document.getElementById(containerId);
                if (!container) return;
                const arr = this.state.cluster[type];
                const inputType = type === 'primary_text' ? 'textarea' : 'input';
                container.innerHTML = arr.length === 0
                    ? '<div class="adl-cluster-empty">Nenhum item ainda</div>'
                    : arr.map((it, idx) => `
                        <div class="adl-cluster-item" data-id="${this._esc(it.id)}" data-type="${type}">
                            ${inputType === 'textarea'
                                ? `<textarea class="input input-sm" rows="2" placeholder="Texto ${idx + 1}">${this._esc(it.content)}</textarea>`
                                : `<input type="text" class="input input-sm" placeholder="Texto ${idx + 1}" value="${this._esc(it.content)}">`}
                            <button type="button" class="adl-cluster-del" title="Remover">&times;</button>
                        </div>
                    `).join('');
                container.querySelectorAll('.adl-cluster-item').forEach(row => {
                    const id = row.dataset.id;
                    const type = row.dataset.type;
                    const inp = row.querySelector('input, textarea');
                    inp.addEventListener('input', () => {
                        const it = this.state.cluster[type].find(x => x.id === id);
                        if (it) it.content = inp.value;
                        this._updateClusterCount();
                    });
                    row.querySelector('.adl-cluster-del').addEventListener('click', () => this._removeClusterItem(type, id));
                });
            });
            this._updateClusterCount();
        },

        _updateClusterCount() {
            const el = document.getElementById('adl-cluster-count');
            if (!el) return;
            const creatives = this.state.selectedIds.size;
            const c = this.state.cluster;
            const filtered = {
                primary_text: c.primary_text.filter(i => i.content.trim()).length || 1,
                headline: c.headline.filter(i => i.content.trim()).length || 1,
                description: c.description.filter(i => i.content.trim()).length || 1,
            };
            const total = creatives * filtered.primary_text * filtered.headline * filtered.description;
            el.textContent = total;
        },

        async _handleLaunch() {
            if (this.state.launching) return;
            const items = this._getItems().filter(it => this.state.selectedIds.has(it.id));
            if (items.length === 0) return;

            const accountId = FacebookAds.config.activeAdAccountId;
            const campaignVal = document.getElementById('adl-campaign').value;
            let adsetId = document.getElementById('adl-adset').value;
            const pageId = document.getElementById('adl-page').value;
            const igId = document.getElementById('adl-ig').value;
            const primaryText = document.getElementById('adl-primary-text').value.trim();
            const headline = document.getElementById('adl-headline').value.trim();
            const description = document.getElementById('adl-description').value.trim();
            const cta = document.getElementById('adl-cta').value;
            const linkUrl = document.getElementById('adl-link-url').value.trim();
            const status = document.getElementById('adl-status').value;
            const adNameBase = document.getElementById('adl-ad-name').value.trim();

            this.state.launching = true;
            this._updateLaunchButton();
            const btn = document.getElementById('adl-btn-launch');
            const origHtml = btn.innerHTML;
            btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i> Lançando…';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            const results = [];
            try {
                // 0a) Cria nova campanha se necessário
                let campaignId = campaignVal !== '__new__' ? campaignVal : null;
                if (campaignVal === '__new__') {
                    btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i> Criando campanha…';
                    campaignId = await this._createCampaign(accountId);
                }

                // 0b) Cria novo conjunto se necessário
                if (adsetId === '__new__') {
                    btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i> Criando conjunto…';
                    adsetId = await this._createAdset(accountId, campaignId, pageId);
                }

                // Em modo cluster, expande em combinações N × M × K
                let combinations = [];
                if (this.state.mode === 'cluster') {
                    const pts = (this.state.cluster.primary_text || []).map(i => i.content.trim()).filter(Boolean);
                    const hls = (this.state.cluster.headline || []).map(i => i.content.trim()).filter(Boolean);
                    const dcs = (this.state.cluster.description || []).map(i => i.content.trim()).filter(Boolean);
                    const ptList = pts.length ? pts : [primaryText];
                    const hlList = hls.length ? hls : [headline];
                    const dcList = dcs.length ? dcs : [description || ''];
                    for (const it of items) {
                        for (let p = 0; p < ptList.length; p++) {
                            for (let h = 0; h < hlList.length; h++) {
                                for (let d = 0; d < dcList.length; d++) {
                                    combinations.push({
                                        item: it,
                                        primaryText: ptList[p],
                                        headline: hlList[h],
                                        description: dcList[d],
                                        variantLabel: ptList.length * hlList.length * dcList.length > 1
                                            ? ` [P${p + 1}H${h + 1}D${d + 1}]` : '',
                                    });
                                }
                            }
                        }
                    }
                } else {
                    combinations = items.map(it => ({ item: it, primaryText, headline, description, variantLabel: '' }));
                }

                let comboIdx = 0;
                for (const combo of combinations) {
                    comboIdx++;
                    btn.innerHTML = `<i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i> Lançando ${comboIdx}/${combinations.length}…`;
                    const it = combo.item;
                    try {
                        const baseLabel = it.title + combo.variantLabel;
                        const adName = adNameBase ? `${adNameBase} — ${baseLabel}` : `[Launcher] ${baseLabel}`;
                        // 1) upload image
                        const imageHash = await this._uploadAdImage(accountId, it.imageUrl);
                        // 2) create creative
                        const creativeId = await this._createAdCreative(accountId, {
                            pageId, igId, imageHash,
                            primaryText: combo.primaryText,
                            headline: combo.headline,
                            description: combo.description,
                            cta, linkUrl,
                            name: baseLabel,
                        });
                        // 3) create ad
                        const ad = await this._createAd(accountId, {
                            name: adName.slice(0, 100),
                            adsetId, creativeId, status,
                        });
                        results.push({ ok: true, title: baseLabel, adId: ad.id });
                        // Salva textos na biblioteca pra reuso futuro
                        if (window.CopyLibrary) {
                            if (combo.primaryText) CopyLibrary.add('primary_text', combo.primaryText);
                            if (combo.headline) CopyLibrary.add('headline', combo.headline);
                            if (combo.description) CopyLibrary.add('description', combo.description);
                        }
                    } catch (e) {
                        results.push({ ok: false, title: it.title + combo.variantLabel, error: e.message });
                    }
                }
            } catch (e) {
                if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
            } finally {
                this.state.launching = false;
                btn.innerHTML = origHtml;
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                this._updateLaunchButton();
            }

            this._showResult(results, accountId);
        },

        _showResult(results, accountId) {
            const okCount = results.filter(r => r.ok).length;
            const failCount = results.length - okCount;
            const modal = document.getElementById('adl-result-modal');
            const body = document.getElementById('adl-result-body');
            if (!modal || !body) return;
            const amUrl = `https://www.facebook.com/adsmanager/manage/ads?act=${accountId}`;
            body.innerHTML = `
                <div style="margin-bottom:1rem">
                    <strong>${okCount}</strong> anúncio${okCount !== 1 ? 's' : ''} criado${okCount !== 1 ? 's' : ''} com sucesso${failCount > 0 ? ` · <span style="color:var(--danger)">${failCount} falha${failCount !== 1 ? 's' : ''}</span>` : ''}.
                </div>
                <div class="adl-result-list">
                    ${results.map(r => `
                        <div class="adl-result-row ${r.ok ? 'adl-result-ok' : 'adl-result-fail'}">
                            <i data-lucide="${r.ok ? 'check-circle-2' : 'x-circle'}" style="width:14px;height:14px;flex-shrink:0"></i>
                            <span style="flex:1">${this._esc(r.title)}</span>
                            ${r.ok ? `<code style="font-size:0.7rem;opacity:0.6">${r.adId}</code>` : `<span style="font-size:0.75rem;color:var(--danger)">${this._esc(r.error)}</span>`}
                        </div>
                    `).join('')}
                </div>
                <p style="margin-top:1rem;font-size:0.85rem;color:var(--text-muted)">
                    <a href="${amUrl}" target="_blank" style="color:var(--accent)">Abrir no Gerenciador de Anúncios →</a>
                </p>
            `;
            modal.style.display = 'flex';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            // Limpa seleção após sucesso parcial/total
            if (okCount > 0) {
                this.state.selectedIds.clear();
                this._renderPicker();
                this._renderSelected();
            }
        },

        // ===== Graph API helpers =====

        async _graphGet(path, params = {}) {
            const qs = new URLSearchParams({ access_token: FacebookAds.config.accessToken, ...params });
            const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/${path}?${qs.toString()}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.error) throw this._graphError(data.error, path);
            return data;
        },

        async _graphPost(path, params = {}) {
            const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/${path}`;
            const body = new URLSearchParams({ access_token: FacebookAds.config.accessToken, ...params });
            const res = await fetch(url, { method: 'POST', body });
            const data = await res.json();
            if (data.error) {
                console.error('[AdLauncher] Graph POST failed:', { path, params, error: data.error });
                throw this._graphError(data.error, path);
            }
            return data;
        },

        _graphError(err, path) {
            // FB retorna error_user_msg muito mais útil que message
            const detail = err.error_user_msg || err.message || 'Erro desconhecido';
            const title = err.error_user_title ? `${err.error_user_title}: ` : '';
            const code = err.code ? ` (${err.code}${err.error_subcode ? '.' + err.error_subcode : ''})` : '';
            return new Error(`${title}${detail}${code}`);
        },

        async _uploadAdImage(accountId, imageUrl) {
            // Aceita URL direta ou data URL — sempre converte pra Blob via fetch e envia como multipart
            const blob = await this._fetchAsBlob(imageUrl);
            const fd = new FormData();
            fd.append('access_token', FacebookAds.config.accessToken);
            // Nome aceito pela API: qualquer string; FB usa como filename
            fd.append('filename', blob, this._suggestFilename(blob.type));
            const url = `${FacebookAds.BASE_URL}/${FacebookAds.API_VERSION}/act_${accountId}/adimages`;
            const res = await fetch(url, { method: 'POST', body: fd });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message || 'Falha no upload de imagem');
            // Resposta: { images: { filename: { hash, url } } }
            const imgs = data.images || {};
            const firstKey = Object.keys(imgs)[0];
            const hash = imgs[firstKey]?.hash;
            if (!hash) throw new Error('Resposta sem image hash');
            return hash;
        },

        async _fetchAsBlob(src) {
            // Se for data URL, converte direto
            if (src.startsWith('data:')) {
                const res = await fetch(src);
                return res.blob();
            }
            // URL remota — pode ter CORS, tenta direto
            const res = await fetch(src, { mode: 'cors' });
            if (!res.ok) throw new Error('Não foi possível baixar a imagem (CORS?)');
            return res.blob();
        },

        _suggestFilename(mime) {
            const ext = (mime || '').split('/')[1] || 'png';
            return `creative_${Date.now()}.${ext.split('+')[0]}`;
        },

        async _createAdCreative(accountId, opts) {
            const linkData = {
                image_hash: opts.imageHash,
                link: opts.linkUrl,
                message: opts.primaryText,
            };
            if (opts.headline) linkData.name = opts.headline;
            if (opts.description) linkData.description = opts.description;
            if (opts.cta) {
                linkData.call_to_action = { type: opts.cta, value: { link: opts.linkUrl } };
            }
            const objectStorySpec = {
                page_id: opts.pageId,
                link_data: linkData,
            };
            if (opts.igId) objectStorySpec.instagram_actor_id = opts.igId;

            const data = await this._graphPost(`act_${accountId}/adcreatives`, {
                name: `[Launcher] ${opts.name}`.slice(0, 100),
                object_story_spec: JSON.stringify(objectStorySpec),
            });
            if (!data.id) throw new Error('Creative sem ID');
            return data.id;
        },

        async _createAd(accountId, opts) {
            const data = await this._graphPost(`act_${accountId}/ads`, {
                name: opts.name,
                adset_id: opts.adsetId,
                creative: JSON.stringify({ creative_id: opts.creativeId }),
                status: opts.status || 'PAUSED',
            });
            if (!data.id) throw new Error('Ad sem ID');
            return data;
        },

        async _createCampaign(accountId) {
            const name = document.getElementById('adl-new-campaign-name').value.trim();
            const objective = document.getElementById('adl-new-campaign-objective').value;
            const budgetMode = document.getElementById('adl-new-campaign-budget-mode').value;
            const budgetReais = parseFloat(document.getElementById('adl-new-campaign-budget').value || 0);
            if (!name) throw new Error('Nome da campanha é obrigatório');

            const params = {
                name,
                objective,
                status: 'PAUSED',
                special_ad_categories: JSON.stringify([]),
                // SEMPRE força LOWEST_COST_WITHOUT_CAP (Maior volume) pra não herdar
                // estratégia CAP da conta (que exigiria bid_amount).
                bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
            };
            if (budgetMode === 'cbo_daily' && budgetReais > 0) {
                params.daily_budget = Math.round(budgetReais * 100);
            } else if (budgetMode === 'cbo_lifetime' && budgetReais > 0) {
                params.lifetime_budget = Math.round(budgetReais * 100);
            }
            const data = await this._graphPost(`act_${accountId}/campaigns`, params);
            if (!data.id) throw new Error('Campanha sem ID');
            return data.id;
        },

        async _createAdset(accountId, campaignId, pageId) {
            const name = document.getElementById('adl-new-adset-name').value.trim();
            const dailyReais = parseFloat(document.getElementById('adl-new-adset-budget').value || 0);
            const optim = document.getElementById('adl-new-adset-optim').value;
            const countriesStr = document.getElementById('adl-new-adset-countries').value.trim();
            const genders = parseInt(document.getElementById('adl-new-adset-genders').value, 10);
            const ageMin = parseInt(document.getElementById('adl-new-adset-age-min').value || 18, 10);
            const ageMax = parseInt(document.getElementById('adl-new-adset-age-max').value || 65, 10);
            const pixelEvent = document.getElementById('adl-new-adset-pixel-event').value;
            const pixelIdSelected = document.getElementById('adl-new-adset-pixel').value;
            if (!name) throw new Error('Nome do conjunto é obrigatório');

            const countries = countriesStr.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
            const targeting = {
                geo_locations: { countries: countries.length ? countries : ['BR'] },
                age_min: Math.max(13, Math.min(65, ageMin)),
                age_max: Math.max(13, Math.min(65, ageMax)),
            };
            if (genders === 1 || genders === 2) targeting.genders = [genders];
            const interests = this._newAdsetInterests || [];
            if (interests.length > 0) {
                targeting.flexible_spec = [{ interests: interests.map(i => ({ id: i.id, name: i.name })) }];
            }

            // Promoted object para conversões — usa pixel selecionado ou auto-detecta
            let promotedObject = null;
            let finalOptim = optim;
            const isConversion = optim === 'OFFSITE_CONVERSIONS' || optim === 'VALUE';
            if (isConversion) {
                const pixelId = pixelIdSelected || await this._fetchDefaultPixelId(accountId);
                if (pixelId) {
                    promotedObject = { pixel_id: pixelId, custom_event_type: pixelEvent || 'PURCHASE' };
                } else {
                    finalOptim = 'LINK_CLICKS';
                    if (typeof showToast === 'function') {
                        showToast('Nenhum pixel encontrado — otimização caiu para Cliques no link', 'warning');
                    }
                }
            }

            // start_time precisa estar no futuro (>= agora)
            const startDate = new Date(Date.now() + 5 * 60 * 1000); // +5min

            const params = {
                name,
                campaign_id: campaignId,
                status: 'PAUSED',
                daily_budget: Math.round((dailyReais || 30) * 100),
                billing_event: 'IMPRESSIONS',
                optimization_goal: finalOptim,
                targeting: JSON.stringify(targeting),
                start_time: startDate.toISOString(),
                // Localização da conversão: SOMENTE site (não site+app)
                destination_type: 'WEBSITE',
            };
            if (promotedObject) params.promoted_object = JSON.stringify(promotedObject);

            const data = await this._graphPost(`act_${accountId}/adsets`, params);
            if (!data.id) throw new Error('Conjunto sem ID');
            return data.id;
        },

        async _fetchDefaultPixelId(accountId) {
            try {
                const data = await this._graphGet(`act_${accountId}/adspixels`, { fields: 'id,name', limit: 1 });
                return data?.data?.[0]?.id || null;
            } catch { return null; }
        },

        _productName(productId) {
            if (!productId) return '';
            const p = (AppState.allProducts || []).find(x => x.id === productId);
            return p?.name || '';
        },

        _esc(s) {
            return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.AdLauncher = AdLauncher;
    AdLauncher.init();
})();
