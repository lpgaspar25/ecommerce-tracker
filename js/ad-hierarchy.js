// ===========================================
// AdHierarchyModule — Mapa visual estilo Miro
// Produto → Campanhas → Conjuntos → Criativos
// Funciona com:
//   1) Dados locais (manual / CSV)  ← padrão
//   2) Facebook conectado (opcional)
// ===========================================
(function () {
    'use strict';

    const STORAGE_KEY = 'etracker_ad_hierarchy';

    const AdHierarchyModule = {
        _state: {
            view: 'columns', // 'columns' | 'board'
            selectedProductId: null,
            selectedCampaignId: null,
            selectedAdsetId: null,
            selectedAdId: null,
            // Local persisted data
            campaigns: [],      // [{id, name, status, productId, source, validated}]
            adsets: [],         // [{id, name, status, campaignId, daily_budget, source, validated}]
            ads: [],            // [{id, name, status, adsetId, thumbnail, source, validated, impressions, clicks, spend}]
            // Cache from FB (if connected)
            fbAdsetsByCamp: {},
            fbAdsByAdset: {},
            filter: { product:'', campaign:'', adset:'', ad:'' },
            // Board pan/zoom
            board: { zoom: 1, tx: 0, ty: 0, dragging: false, dragX: 0, dragY: 0 },
            // Collapsed nodes: { "campaign:id": true, "adset:id": true }
            collapsed: {},
            // Edit modal target
            editing: null, // { level, id }
        },

        init() {
            this._loadFromStorage();
            this._bindEvents();
            document.querySelectorAll('[data-tab="ad-hierarchy"]').forEach(btn => {
                btn.addEventListener('click', () => setTimeout(() => this.render(), 50));
            });
        },

        _loadFromStorage() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return;
                const data = JSON.parse(raw);
                if (Array.isArray(data.campaigns)) this._state.campaigns = data.campaigns;
                if (Array.isArray(data.adsets)) this._state.adsets = data.adsets;
                if (Array.isArray(data.ads)) this._state.ads = data.ads;
            } catch (e) { console.warn('[AdHierarchy] load failed:', e); }
        },

        _persist() {
            const payload = JSON.stringify({
                campaigns: this._state.campaigns,
                adsets: this._state.adsets,
                ads: this._state.ads,
            });
            try {
                localStorage.setItem(STORAGE_KEY, payload);
            } catch (e) {
                // QuotaExceeded — provavelmente por imagens base64.
                console.warn('[AdHierarchy] persist falhou:', e);
                // 1) Libera caches regeneráveis (pedidos Shopify, backups) e tenta de novo
                if (typeof StorageManager !== 'undefined') {
                    const ok = StorageManager.withReclaim(() => localStorage.setItem(STORAGE_KEY, payload), 'ad_hierarchy');
                    if (ok) return;
                }
                // 2) Tenta sem thumbnails (mantém estrutura, perde imagens)
                try {
                    const lite = {
                        campaigns: this._state.campaigns,
                        adsets: this._state.adsets,
                        ads: this._state.ads.map(a => ({ ...a, thumbnail: a.thumbnail && a.thumbnail.length < 200 ? a.thumbnail : '' })),
                    };
                    const liteStr = JSON.stringify(lite);
                    const okLite = (typeof StorageManager !== 'undefined')
                        ? StorageManager.withReclaim(() => localStorage.setItem(STORAGE_KEY, liteStr), 'ad_hierarchy_lite')
                        : (localStorage.setItem(STORAGE_KEY, liteStr), true);
                    if (!okLite) throw new Error('quota');
                    if (typeof showToast === 'function') {
                        showToast('Armazenamento cheio — imagens grandes foram descartadas. Itens salvos.', 'warning');
                    }
                } catch (e2) {
                    console.error('[AdHierarchy] persist falhou de novo:', e2);
                    if (typeof showToast === 'function') {
                        showToast('Erro ao salvar Mapa de Ads: armazenamento cheio. Use o botão Limpar pra liberar espaço.', 'error');
                    }
                    throw e2;
                }
            }
        },

        _bindEvents() {
            document.getElementById('adh-btn-refresh')?.addEventListener('click', () => this.refresh());
            document.getElementById('adh-btn-import-csv')?.addEventListener('click', () => document.getElementById('adh-csv-input')?.click());
            document.getElementById('adh-csv-input')?.addEventListener('change', (e) => {
                const f = e.target.files?.[0];
                if (f) this.importCsv(f);
                e.target.value = '';
            });
            document.getElementById('adh-btn-add-campaign')?.addEventListener('click', () => this._promptAddCampaign());
            document.getElementById('adh-btn-add-adset')?.addEventListener('click', () => this._promptAddAdset());
            document.getElementById('adh-btn-add-ad')?.addEventListener('click', () => this._promptAddAd());
            document.getElementById('adh-btn-clear')?.addEventListener('click', () => this._clearAll());

            document.querySelectorAll('.adh-filter').forEach(inp => {
                inp.addEventListener('input', (e) => {
                    const lvl = inp.dataset.level;
                    this._state.filter[lvl] = (e.target.value || '').toLowerCase();
                    this._renderColumn(lvl);
                    this._drawConnections();
                });
            });

            window.addEventListener('resize', () => {
                this._drawConnections();
                if (this._state.view === 'board') this._renderBoard();
            });

            // View toggle (Colunas / Board)
            document.querySelectorAll('.adh-view-tab').forEach(btn => {
                btn.addEventListener('click', () => {
                    const v = btn.dataset.view;
                    this._state.view = v;
                    document.querySelectorAll('.adh-view-tab').forEach(b => b.classList.toggle('active', b === btn));
                    const columns = document.querySelector('#tab-ad-hierarchy .adh-canvas-wrap');
                    const board = document.getElementById('adh-board-wrap');
                    if (columns) columns.style.display = v === 'columns' ? '' : 'none';
                    if (board) board.style.display = v === 'board' ? '' : 'none';
                    if (v === 'board') this._renderBoard();
                    else this._drawConnections();
                });
            });

            // Board: zoom controls
            document.getElementById('adh-board-zoom-in')?.addEventListener('click', () => this._zoomBoard(1.2));
            document.getElementById('adh-board-zoom-out')?.addEventListener('click', () => this._zoomBoard(1/1.2));
            document.getElementById('adh-board-reset')?.addEventListener('click', () => this._resetBoard());

            // Board: pan + zoom
            const vp = document.getElementById('adh-board-viewport');
            if (vp) {
                vp.addEventListener('wheel', (e) => {
                    if (e.ctrlKey || e.metaKey) e.preventDefault();
                    const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
                    this._zoomBoardAt(factor, e.clientX, e.clientY);
                }, { passive: false });
                // Drag-to-pan: works from ANY element inside the viewport (including nodes).
                // Threshold distinguishes click vs drag. If user clicks (no move), the node's
                // click handler fires normally. If user drags > 4px, we pan and suppress the click.
                let pressed = false, didMove = false, sx=0, sy=0, sTx=0, sTy=0;
                const DRAG_THRESHOLD = 4;

                vp.addEventListener('mousedown', (e) => {
                    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
                    // Don't initiate pan if user clicked the validate/collapse buttons explicitly
                    if (e.target.closest('button')) return;
                    pressed = true; didMove = false;
                    sx = e.clientX; sy = e.clientY;
                    sTx = this._state.board.tx;
                    sTy = this._state.board.ty;
                    if (e.button === 1 || e.button === 2) e.preventDefault();
                });

                window.addEventListener('mousemove', (e) => {
                    if (!pressed) return;
                    const dx = e.clientX - sx, dy = e.clientY - sy;
                    if (!didMove && (Math.abs(dx) + Math.abs(dy)) >= DRAG_THRESHOLD) {
                        didMove = true;
                        vp.style.cursor = 'grabbing';
                    }
                    if (didMove) {
                        this._state.board.tx = sTx + dx;
                        this._state.board.ty = sTy + dy;
                        this._applyBoardTransform();
                    }
                });

                window.addEventListener('mouseup', (e) => {
                    if (!pressed) return;
                    pressed = false;
                    vp.style.cursor = '';
                    if (didMove) {
                        // suppress the click that follows a drag
                        const suppressOnce = (ev) => {
                            ev.stopPropagation();
                            ev.preventDefault();
                            vp.removeEventListener('click', suppressOnce, true);
                        };
                        vp.addEventListener('click', suppressOnce, true);
                    }
                });

                vp.addEventListener('contextmenu', (e) => e.preventDefault());
            }

            // Edit modal
            document.getElementById('adh-edit-close')?.addEventListener('click', () => this._closeEditModal());
            document.getElementById('adh-edit-cancel')?.addEventListener('click', () => this._closeEditModal());
            document.getElementById('adh-edit-overlay')?.addEventListener('click', () => this._closeEditModal());
            document.getElementById('adh-edit-save')?.addEventListener('click', () => this._saveEditModal());
            document.getElementById('adh-edit-upload')?.addEventListener('click', () => document.getElementById('adh-edit-image')?.click());
            document.getElementById('adh-edit-image')?.addEventListener('change', (e) => this._handleImageUpload(e.target.files?.[0]));
            document.getElementById('adh-edit-clear-img')?.addEventListener('click', () => {
                const t = document.getElementById('adh-edit-thumb');
                if (t) { t.src = ''; t.style.display = 'none'; }
                document.getElementById('adh-edit-clear-img').style.display = 'none';
                this._editingImage = '';
            });
        },

        async refresh() {
            this._state.fbAdsetsByCamp = {};
            this._state.fbAdsByAdset = {};
            // Re-pull campaigns from FB if connected (adds to local)
            if (this._fbConnected()) {
                await this._syncFromFacebook();
            }
            await this.render();
            showToast('Mapa atualizado', 'success');
        },

        _fbConnected() {
            return typeof FacebookAds !== 'undefined' && FacebookAds.isConnected && FacebookAds.isConnected();
        },

        async _syncFromFacebook() {
            try {
                const rawCampaigns = await FacebookAds.fetchCampaigns();
                const map = FacebookAds._accountMap?.() || {};
                const campByProduct = {};
                Object.entries(map).forEach(([pid, ids]) => (ids || []).forEach(cid => { campByProduct[cid] = pid; }));
                rawCampaigns.forEach(c => {
                    const existing = this._state.campaigns.find(x => x.id === c.id);
                    const fbCamp = {
                        id: c.id, name: c.name,
                        status: c.effective_status || c.status,
                        productId: campByProduct[c.id] || existing?.productId || null,
                        source: 'fb',
                    };
                    if (existing) Object.assign(existing, fbCamp);
                    else this._state.campaigns.push(fbCamp);
                });
                this._persist();
            } catch (e) { console.warn('[AdHierarchy] FB sync failed:', e); }
        },

        async render() {
            // Status indicator
            const status = document.getElementById('adh-status');
            if (status) {
                const total = this._state.campaigns.length + this._state.adsets.length + this._state.ads.length;
                const fb = this._fbConnected();
                status.innerHTML = `<i data-lucide="${fb ? 'cloud' : 'database'}" style="width:12px;height:12px;vertical-align:-1px"></i> ${fb ? 'FB conectado' : 'Modo local'} · ${total} item(s)`;
            }

            this._renderAccountSelect();
            this._renderProductColumn();
            this._renderColumn('campaign');
            this._renderColumn('adset');
            this._renderColumn('ad');
            this._drawConnections();
            this._renderDetail();
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        _renderAccountSelect() {
            const sel = document.getElementById('adh-account');
            if (!sel) return;
            const accounts = (typeof FacebookAds !== 'undefined' && FacebookAds.config?.adAccounts) || [];
            if (!accounts.length) {
                sel.innerHTML = '<option value="">Sem contas FB</option>';
                sel.disabled = true;
                return;
            }
            sel.disabled = false;
            const active = FacebookAds.config?.activeAdAccountId || '';
            sel.innerHTML = accounts.map(a => `<option value="${a.id}" ${a.id===active?'selected':''}>${this._esc(a.name || a.id)}</option>`).join('');
        },

        _products() {
            return (typeof AppState !== 'undefined' && (AppState.allProducts || AppState.products)) || [];
        },

        _campaignsForProduct(productId) {
            if (!productId) return [];
            return this._state.campaigns.filter(c => c.productId === productId);
        },

        _campaignsUnassigned() {
            return this._state.campaigns.filter(c => !c.productId);
        },

        _renderProductColumn() {
            const list = document.getElementById('adh-list-product');
            const count = document.getElementById('adh-count-product');
            if (!list) return;
            const filter = this._state.filter.product;
            let allProducts = this._products().filter(p => !filter || (p.name || '').toLowerCase().includes(filter));
            const unassignedCount = this._campaignsUnassigned().length;

            if (count) count.textContent = String(allProducts.length + (unassignedCount > 0 ? 1 : 0));

            // Kick off sales load (Shopify orders) once — re-renders when ready
            this._ensureProductSales();
            const salesMap = this._state.productSales || {};

            // Sort: best-selling first (when sales data available)
            allProducts = allProducts.slice().sort((a, b) => {
                const sa = salesMap[a.id]?.units || 0;
                const sb = salesMap[b.id]?.units || 0;
                return sb - sa;
            });

            const cards = allProducts.map(p => {
                const campCount = this._campaignsForProduct(p.id).length;
                const selected = p.id === this._state.selectedProductId;
                const s = salesMap[p.id];
                const salesLine = s && (s.units > 0 || s.orders > 0)
                    ? `<div class="adh-card-sales">
                          <span class="adh-sales-pill"><i data-lucide="shopping-cart" style="width:10px;height:10px;vertical-align:-1px"></i> ${s.units} vendas</span>
                          <span class="adh-sales-pill"><i data-lucide="package" style="width:10px;height:10px;vertical-align:-1px"></i> ${s.orders} pedido(s)</span>
                       </div>`
                    : '';
                return `<div class="adh-card ${selected ? 'adh-card-selected' : ''}" data-level="product" data-id="${this._esc(p.id)}">
                    <div class="adh-card-title">${this._esc(p.name)}</div>
                    ${salesLine}
                    <div class="adh-card-meta"><i data-lucide="megaphone" style="width:10px;height:10px;vertical-align:-1px"></i> ${campCount} campanha(s)${campCount > 0 ? ' · <span style="color:#8b5cf6">clique p/ ver</span>' : ''}</div>
                </div>`;
            });

            // Pseudo-card: "Sem produto" (unassigned campaigns)
            if (unassignedCount > 0) {
                const selected = this._state.selectedProductId === '__unassigned__';
                cards.push(`<div class="adh-card adh-card-unassigned ${selected ? 'adh-card-selected' : ''}" data-level="product" data-id="__unassigned__">
                    <div class="adh-card-title"><i data-lucide="link-2-off" style="width:11px;height:11px;vertical-align:-1px"></i> Sem produto vinculado</div>
                    <div class="adh-card-meta">${unassignedCount} campanha(s) órfã(s)</div>
                </div>`);
            }

            list.innerHTML = cards.join('') || '<div class="adh-empty">Cadastre produtos em "Produtos → Lista".</div>';
            list.querySelectorAll('.adh-card').forEach(el => {
                el.addEventListener('click', () => this._selectProduct(el.dataset.id));
            });
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        // Aggregate sales (units) + distinct orders per local product from Shopify orders.
        // Falls back to diary shopifySales when Shopify isn't connected. No FB/Google needed.
        async _ensureProductSales(force) {
            if (this._salesLoading) return;
            const periodDays = 30;
            const today = new Date();
            const to = today.toISOString().slice(0, 10);
            const from = new Date(today.getTime() - (periodDays - 1) * 86400000).toISOString().slice(0, 10);
            const cacheKey = `${from}|${to}`;
            if (!force && this._salesCacheKey === cacheKey && this._state.productSales) return;

            const products = this._products();
            const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
            const byShopId = {}, byName = {};
            const getLink = (typeof ShopifyModule !== 'undefined' && ShopifyModule.getLink) ? (id) => ShopifyModule.getLink(id) : () => null;
            products.forEach(lp => {
                const sid = getLink(lp.id);
                if (sid) byShopId[String(sid)] = lp;
                if (lp.name) byName[norm(lp.name)] = lp;
            });
            const matchLocal = (pid, title) => byShopId[String(pid)] || byName[norm(title)] || null;

            const result = {};

            const hasShopify = typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured?.();
            if (hasShopify && ShopifyModule.fetchOrders) {
                this._salesLoading = true;
                try {
                    const orders = await ShopifyModule.fetchOrders(from, to, { silent: true });
                    for (const o of (orders || [])) {
                        const seen = new Set(); // count each order once per product
                        for (const li of (o.line_items || [])) {
                            const lp = matchLocal(li.product_id, li.title);
                            if (!lp) continue;
                            if (!result[lp.id]) result[lp.id] = { units: 0, orders: 0 };
                            result[lp.id].units += li.quantity || 0;
                            if (!seen.has(lp.id)) { result[lp.id].orders += 1; seen.add(lp.id); }
                        }
                    }
                    this._salesCacheKey = cacheKey;
                } catch (e) {
                    console.warn('[AdHierarchy] product sales fetch failed:', e);
                } finally {
                    this._salesLoading = false;
                }
            } else {
                // Fallback: diary shopifySales / sales
                const diary = (typeof AppState !== 'undefined' && AppState.allDiary) || [];
                diary.forEach(d => {
                    if (d.isCampaign || d.parentId) return;
                    if (d.date < from || d.date > to) return;
                    const lp = products.find(p => p.id === d.productId);
                    if (!lp) return;
                    if (!result[lp.id]) result[lp.id] = { units: 0, orders: 0 };
                    const u = Number(d.shopifySales ?? d.sales) || 0;
                    result[lp.id].units += u;
                    if (u > 0) result[lp.id].orders += 1; // 1 diary entry/day ≈ pedido agregado
                });
                this._salesCacheKey = cacheKey;
            }

            this._state.productSales = result;
            this._renderProductColumn();
        },

        // Called from outside (Vendas ranking) to jump straight to a product's campaigns.
        focusProduct(productId) {
            this.render();
            setTimeout(() => {
                this._selectProduct(productId);
                const card = document.querySelector(`#adh-list-product .adh-card[data-id="${String(productId).replace(/"/g, '\\"')}"]`);
                if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 120);
        },

        _selectProduct(productId) {
            this._state.selectedProductId = productId;
            this._state.selectedCampaignId = null;
            this._state.selectedAdsetId = null;
            this._state.selectedAdId = null;
            this._renderProductColumn();
            this._renderColumn('campaign');
            this._renderColumn('adset');
            this._renderColumn('ad');
            this._drawConnections();
            this._renderDetail();
        },

        _renderColumn(level) {
            const list = document.getElementById('adh-list-' + level);
            const count = document.getElementById('adh-count-' + level);
            if (!list) return;
            const filter = this._state.filter[level];

            if (level === 'campaign') {
                if (!this._state.selectedProductId) {
                    list.innerHTML = '<div class="adh-empty">Selecione um produto para ver campanhas.</div>';
                    if (count) count.textContent = '0';
                    return;
                }
                let items = this._state.selectedProductId === '__unassigned__'
                    ? this._campaignsUnassigned()
                    : this._campaignsForProduct(this._state.selectedProductId);
                if (filter) items = items.filter(c => (c.name || '').toLowerCase().includes(filter));
                if (count) count.textContent = String(items.length);
                list.innerHTML = items.map(c => {
                    const selected = c.id === this._state.selectedCampaignId;
                    const adsetCount = this._state.adsets.filter(a => a.campaignId === c.id).length;
                    return `<div class="adh-card ${selected ? 'adh-card-selected' : ''} ${c.validated ? 'adh-card-validated' : ''}" data-level="campaign" data-id="${this._esc(c.id)}">
                        <div class="adh-card-title">${c.validated ? '<i data-lucide="check-circle-2" style="width:11px;height:11px;color:#10b981;vertical-align:-1px"></i> ' : ''}${this._esc(c.name)}</div>
                        <div class="adh-card-meta">
                            ${this._statusBadge(c.status)}
                            ${this._regionBadge(c.region)}
                            ${adsetCount ? `· ${adsetCount} conj.` : ''}
                            ${c.source === 'fb' ? '<i data-lucide="cloud" style="width:10px;height:10px;color:#8b5cf6" title="Do Facebook"></i>' : ''}
                            ${c.source === 'csv' ? '<i data-lucide="file-text" style="width:10px;height:10px;color:#f59e0b" title="Do CSV"></i>' : ''}
                            ${c.source === 'manual' ? '<i data-lucide="pencil" style="width:10px;height:10px;color:#10b981" title="Manual"></i>' : ''}
                        </div>
                        <button class="adh-card-delete" data-del="campaign" data-id="${this._esc(c.id)}" title="Remover">×</button>
                    </div>`;
                }).join('') || '<div class="adh-empty">Sem campanhas. Use "+ Campanha" para adicionar.</div>';
                this._bindCardClicks(list, 'campaign');
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                return;
            }

            if (level === 'adset') {
                if (!this._state.selectedCampaignId) {
                    list.innerHTML = '<div class="adh-empty">Selecione uma campanha.</div>';
                    if (count) count.textContent = '0';
                    return;
                }
                let items = this._state.adsets.filter(a => a.campaignId === this._state.selectedCampaignId);
                if (filter) items = items.filter(a => (a.name || '').toLowerCase().includes(filter));
                if (count) count.textContent = String(items.length);
                list.innerHTML = items.map(a => {
                    const selected = a.id === this._state.selectedAdsetId;
                    const adCount = this._state.ads.filter(x => x.adsetId === a.id).length;
                    const budget = a.daily_budget ? `R$ ${parseFloat(a.daily_budget).toFixed(2)}/d` : '';
                    return `<div class="adh-card ${selected ? 'adh-card-selected' : ''} ${a.validated ? 'adh-card-validated' : ''}" data-level="adset" data-id="${this._esc(a.id)}">
                        <div class="adh-card-title">${a.validated ? '<i data-lucide="check-circle-2" style="width:11px;height:11px;color:#10b981;vertical-align:-1px"></i> ' : ''}${this._esc(a.name)}</div>
                        <div class="adh-card-meta">${this._statusBadge(a.status)}${this._regionBadge(a.region)}${budget ? ' · ' + budget : ''}${adCount ? ' · ' + adCount + ' ads' : ''}</div>
                        <button class="adh-card-delete" data-del="adset" data-id="${this._esc(a.id)}" title="Remover">×</button>
                    </div>`;
                }).join('') || '<div class="adh-empty">Sem conjuntos. Use "+ Conjunto" para adicionar.</div>';
                this._bindCardClicks(list, 'adset');
                return;
            }

            if (level === 'ad') {
                if (!this._state.selectedAdsetId) {
                    list.innerHTML = '<div class="adh-empty">Selecione um conjunto.</div>';
                    if (count) count.textContent = '0';
                    return;
                }
                let items = this._state.ads.filter(x => x.adsetId === this._state.selectedAdsetId);
                if (filter) items = items.filter(x => (x.name || '').toLowerCase().includes(filter));
                if (count) count.textContent = String(items.length);
                list.innerHTML = items.map(a => {
                    const selected = a.id === this._state.selectedAdId;
                    const thumb = a.thumbnail || '';
                    const metricsLine = (a.impressions || a.clicks || a.spend) ? `
                        <div class="adh-card-metrics">
                            ${a.impressions ? `<span>${a.impressions.toLocaleString('pt-BR')} imp</span>` : ''}
                            ${a.clicks ? `<span>${a.clicks} clicks</span>` : ''}
                            ${a.spend ? `<span>R$ ${a.spend.toFixed(2)}</span>` : ''}
                        </div>` : '';
                    return `<div class="adh-card adh-card-ad ${selected ? 'adh-card-selected' : ''} ${a.validated ? 'adh-card-validated' : ''}" data-level="ad" data-id="${this._esc(a.id)}">
                        ${thumb ? `<img class="adh-card-thumb" src="${this._esc(thumb)}" alt="">` : '<div class="adh-card-thumb adh-card-thumb-empty"><i data-lucide="image" style="width:14px;height:14px"></i></div>'}
                        <div class="adh-card-body">
                            <div class="adh-card-title">${a.validated ? '<i data-lucide="check-circle-2" style="width:11px;height:11px;color:#10b981;vertical-align:-1px"></i> ' : ''}${this._esc(a.name)}</div>
                            <div class="adh-card-meta">${this._statusBadge(a.status)}${this._regionBadge(a.region)}</div>
                            ${metricsLine}
                        </div>
                        <button class="adh-card-delete" data-del="ad" data-id="${this._esc(a.id)}" title="Remover">×</button>
                    </div>`;
                }).join('') || '<div class="adh-empty">Sem criativos. Use "+ Criativo" para adicionar.</div>';
                this._bindCardClicks(list, 'ad');
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
            }
        },

        _bindCardClicks(container, level) {
            container.querySelectorAll('.adh-card').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (e.target.closest('[data-del]')) return;
                    const id = el.dataset.id;
                    if (level === 'campaign') this._selectCampaign(id);
                    else if (level === 'adset') this._selectAdset(id);
                    else if (level === 'ad') this._selectAd(id);
                });
                el.addEventListener('dblclick', () => this._openEditModal(level, el.dataset.id));
            });
            container.querySelectorAll('[data-del]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._deleteItem(btn.dataset.del, btn.dataset.id);
                });
            });
        },

        async _selectCampaign(campaignId) {
            this._state.selectedCampaignId = campaignId;
            this._state.selectedAdsetId = null;
            this._state.selectedAdId = null;
            // If FB connected and this campaign came from FB, optionally fetch fresh adsets
            const camp = this._state.campaigns.find(c => c.id === campaignId);
            if (camp?.source === 'fb' && this._fbConnected() && !this._state.fbAdsetsByCamp[campaignId]) {
                const list = document.getElementById('adh-list-adset');
                if (list) list.innerHTML = '<div class="adh-empty">Carregando do FB…</div>';
                try {
                    const data = await FacebookAds.fetchAdsetsForCampaign(campaignId);
                    this._state.fbAdsetsByCamp[campaignId] = data;
                    // Merge into local
                    data.forEach(a => {
                        if (!this._state.adsets.find(x => x.id === a.id)) {
                            this._state.adsets.push({
                                id: a.id, name: a.name,
                                status: a.effective_status || a.status,
                                campaignId,
                                daily_budget: a.daily_budget ? parseFloat(a.daily_budget)/100 : null,
                                source: 'fb',
                            });
                        }
                    });
                    this._persist();
                } catch (e) {}
            }
            this._renderColumn('campaign');
            this._renderColumn('adset');
            this._renderColumn('ad');
            this._drawConnections();
            this._renderDetail();
        },

        async _selectAdset(adsetId) {
            this._state.selectedAdsetId = adsetId;
            this._state.selectedAdId = null;
            const adset = this._state.adsets.find(a => a.id === adsetId);
            if (adset?.source === 'fb' && this._fbConnected() && !this._state.fbAdsByAdset[adsetId]) {
                const list = document.getElementById('adh-list-ad');
                if (list) list.innerHTML = '<div class="adh-empty">Carregando do FB…</div>';
                try {
                    const data = await FacebookAds.fetchAdsForAdset(adsetId);
                    this._state.fbAdsByAdset[adsetId] = data;
                    data.forEach(a => {
                        if (!this._state.ads.find(x => x.id === a.id)) {
                            this._state.ads.push({
                                id: a.id, name: a.name,
                                status: a.effective_status || a.status,
                                adsetId,
                                thumbnail: a.creative?.thumbnail_url || a.creative?.image_url || '',
                                source: 'fb',
                            });
                        }
                    });
                    this._persist();
                } catch (e) {}
            }
            this._renderColumn('adset');
            this._renderColumn('ad');
            this._drawConnections();
            this._renderDetail();
        },

        _selectAd(adId) {
            this._state.selectedAdId = adId;
            this._renderColumn('ad');
            this._drawConnections();
            this._renderDetail();
        },

        _deleteItem(level, id) {
            if (!confirm('Remover este item e seus filhos?')) return;
            if (level === 'campaign') {
                this._state.campaigns = this._state.campaigns.filter(c => c.id !== id);
                const adsetIds = this._state.adsets.filter(a => a.campaignId === id).map(a => a.id);
                this._state.adsets = this._state.adsets.filter(a => a.campaignId !== id);
                this._state.ads = this._state.ads.filter(x => !adsetIds.includes(x.adsetId));
                if (this._state.selectedCampaignId === id) this._state.selectedCampaignId = null;
            } else if (level === 'adset') {
                this._state.adsets = this._state.adsets.filter(a => a.id !== id);
                this._state.ads = this._state.ads.filter(x => x.adsetId !== id);
                if (this._state.selectedAdsetId === id) this._state.selectedAdsetId = null;
            } else if (level === 'ad') {
                this._state.ads = this._state.ads.filter(x => x.id !== id);
                if (this._state.selectedAdId === id) this._state.selectedAdId = null;
            }
            this._persist();
            this.render();
        },

        _genId(prefix) { return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,6); },

        _promptAddCampaign() {
            if (!this._state.selectedProductId || this._state.selectedProductId === '__unassigned__') {
                showToast('Selecione um produto primeiro', 'warning');
                return;
            }
            const name = prompt('Nome da campanha:');
            if (!name) return;
            const status = prompt('Status (ATIVO / PAUSADO):', 'ATIVO');
            this._state.campaigns.push({
                id: this._genId('camp'),
                name: name.trim(),
                status: (status || 'ATIVO').toUpperCase().includes('PAUS') ? 'PAUSED' : 'ACTIVE',
                productId: this._state.selectedProductId,
                source: 'manual',
            });
            this._persist();
            this.render();
        },

        // External API: add a campaign to a specific product (used by Vendas ranking).
        // Returns true if added. Loads persisted state first so it works even if Mapa de Ads
        // tab was never opened.
        addCampaignForProduct(productId, name) {
            if (!productId) return false;
            if (!this._state.campaigns) this._loadFromStorage();
            const campName = (name || '').trim();
            if (!campName) return false;
            this._state.campaigns.push({
                id: this._genId('camp'),
                name: campName,
                status: 'ACTIVE',
                productId,
                source: 'manual',
            });
            this._persist();
            return true;
        },

        // External API: count campaigns for a product
        campaignCountForProduct(productId) {
            if (!this._state.campaigns) { try { this._loadFromStorage(); } catch {} }
            return (this._state.campaigns || []).filter(c => c.productId === productId).length;
        },

        _promptAddAdset() {
            if (!this._state.selectedCampaignId) {
                showToast('Selecione uma campanha primeiro', 'warning');
                return;
            }
            const name = prompt('Nome do conjunto:');
            if (!name) return;
            const budget = prompt('Orçamento diário (R$, opcional):', '');
            this._state.adsets.push({
                id: this._genId('as'),
                name: name.trim(),
                status: 'ACTIVE',
                campaignId: this._state.selectedCampaignId,
                daily_budget: budget ? parseFloat(budget.replace(',', '.')) : null,
                source: 'manual',
            });
            this._persist();
            this.render();
        },

        _promptAddAd() {
            if (!this._state.selectedAdsetId) {
                showToast('Selecione um conjunto primeiro', 'warning');
                return;
            }
            const name = prompt('Nome do criativo:');
            if (!name) return;
            this._state.ads.push({
                id: this._genId('ad'),
                name: name.trim(),
                status: 'ACTIVE',
                adsetId: this._state.selectedAdsetId,
                thumbnail: '',
                source: 'manual',
            });
            this._persist();
            this.render();
        },

        _clearAll() {
            if (!confirm('Apagar TODOS os dados do Mapa de Ads? Esta ação não pode ser desfeita.')) return;
            this._state.campaigns = [];
            this._state.adsets = [];
            this._state.ads = [];
            this._state.selectedCampaignId = null;
            this._state.selectedAdsetId = null;
            this._state.selectedAdId = null;
            this._persist();
            this.render();
            showToast('Mapa limpo', 'info');
        },

        // ---------- CSV Import ----------
        async importCsv(file) {
            try {
                showToast('Lendo arquivo…', 'info');
                let rows;
                const ext = (file.name || '').toLowerCase().split('.').pop();
                if (ext === 'xlsx' || ext === 'xls') {
                    if (typeof XLSX === 'undefined') throw new Error('Biblioteca XLSX não carregada');
                    const buffer = await file.arrayBuffer();
                    const wb = XLSX.read(buffer, { type:'array' });
                    // Preferir "Raw Data Report" se existir, senão a primeira aba
                    const sheetName = wb.SheetNames.find(n => /raw\s*data/i.test(n)) || wb.SheetNames[0];
                    const sheet = wb.Sheets[sheetName];
                    rows = XLSX.utils.sheet_to_json(sheet, { header:1, raw:false, defval:'' });
                } else {
                    const text = await file.text();
                    rows = this._parseCSV(text);
                }
                if (!rows.length) throw new Error('Arquivo vazio');
                // Auto-detect header row (looks for "Nome da campanha" or "Campaign name" in any row)
                const headerRowIdx = this._findHeaderRow(rows);
                if (headerRowIdx < 0) {
                    throw new Error('Cabeçalho não encontrado. O arquivo precisa ter uma coluna "Nome da campanha" ou "Campaign name".');
                }
                // Slice to start at header
                const dataRows = rows.slice(headerRowIdx);
                const result = this._importRows(dataRows);
                showToast(`Importado: ${result.campaigns} camp · ${result.adsets} conj · ${result.ads} criativos`, 'success');
                this.render();
            } catch (e) {
                console.error('[AdHierarchy] import error:', e);
                showToast('Erro ao importar: ' + e.message, 'error');
            }
        },

        _findHeaderRow(rows) {
            const needles = ['nome da campanha', 'campaign name'];
            for (let i = 0; i < Math.min(rows.length, 20); i++) {
                const row = rows[i] || [];
                const txt = row.map(c => this._norm(c)).join('|');
                if (needles.some(n => txt.includes(this._norm(n)))) return i;
            }
            return -1;
        },

        _parseCSV(text) {
            // Simple CSV parser (handles quoted fields, commas, semicolons)
            const sep = (text.split('\n')[0] || '').includes(';') ? ';' : ',';
            const out = [];
            for (const line of text.split(/\r?\n/)) {
                if (!line.trim()) continue;
                const row = [];
                let cur = '', inQ = false;
                for (let i = 0; i < line.length; i++) {
                    const ch = line[i];
                    if (ch === '"') { inQ = !inQ; continue; }
                    if (ch === sep && !inQ) { row.push(cur); cur = ''; continue; }
                    cur += ch;
                }
                row.push(cur);
                out.push(row);
            }
            return out;
        },

        _norm(s) {
            return String(s || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9 ]/g, '').trim();
        },

        _findCol(headers, candidates) {
            const norm = headers.map(h => this._norm(h));
            for (const cand of candidates) {
                const c = this._norm(cand);
                const idx = norm.findIndex(h => h === c || h.includes(c));
                if (idx >= 0) return idx;
            }
            return -1;
        },

        _importRows(rows) {
            const headers = rows[0] || [];
            const idxCampaign = this._findCol(headers, ['campaign name', 'nome da campanha', 'campanha']);
            const idxAdset = this._findCol(headers, ['ad set name', 'nome do conjunto de anuncios', 'nome do conjunto', 'conjunto', 'adset name']);
            const idxAd = this._findCol(headers, ['ad name', 'nome do anuncio', 'anuncio', 'criativo']);
            const idxStatus = this._findCol(headers, ['status de veiculacao', 'delivery status', 'effective status', 'delivery', 'status']);
            const idxBudget = this._findCol(headers, ['ad set budget', 'orcamento do conjunto', 'orcamento', 'budget']);
            const idxDay = this._findCol(headers, ['dia', 'day', 'date', 'data']);
            const idxImpr = this._findCol(headers, ['impressoes', 'impressions']);
            const idxClicks = this._findCol(headers, ['cliques no link', 'link clicks', 'cliques']);
            const idxSpend = this._findCol(headers, ['valor usado', 'amount spent', 'gasto']);

            if (idxCampaign < 0) throw new Error('Coluna "Nome da campanha" não encontrada');

            const result = { campaigns: 0, adsets: 0, ads: 0 };
            const productId = this._state.selectedProductId && this._state.selectedProductId !== '__unassigned__'
                ? this._state.selectedProductId : null;

            // Acumula status mais recente por entidade (data -> status)
            // Chave: campaignName | adsetName | adName
            const latestStatus = {}; // key -> { date, status }
            const latestBudget = {}; // adsetKey -> { date, budget }
            const metricsByAd = {};  // adKey -> { impressions, clicks, spend }

            for (let r = 1; r < rows.length; r++) {
                const row = rows[r] || [];
                const campName = String(row[idxCampaign] || '').trim();
                if (!campName) continue;
                if (this._norm(campName).includes('resultados totais')) continue;

                const adsetName = idxAdset >= 0 ? String(row[idxAdset] || '').trim() : '';
                const adName = idxAd >= 0 ? String(row[idxAd] || '').trim() : '';
                const status = idxStatus >= 0 ? String(row[idxStatus] || '').trim() : '';
                const budget = idxBudget >= 0 ? parseFloat(String(row[idxBudget] || '').replace(/[^0-9.,-]/g,'').replace(',','.')) : null;
                const day = idxDay >= 0 ? String(row[idxDay] || '').trim() : '';

                // Update latest status by date
                const updateLatest = (key) => {
                    const cur = latestStatus[key];
                    if (!cur || day >= cur.date) latestStatus[key] = { date: day, status };
                };
                updateLatest('C:' + campName);
                if (adsetName) updateLatest('AS:' + campName + '|' + adsetName);
                if (adName && adsetName) updateLatest('A:' + campName + '|' + adsetName + '|' + adName);

                if (adsetName && !isNaN(budget)) {
                    const k = 'AS:' + campName + '|' + adsetName;
                    if (!latestBudget[k] || day >= latestBudget[k].date) latestBudget[k] = { date: day, budget };
                }

                // Accumulate metrics per ad
                if (adName && adsetName) {
                    const k = adName + '||' + adsetName + '||' + campName;
                    if (!metricsByAd[k]) metricsByAd[k] = { impressions: 0, clicks: 0, spend: 0 };
                    const imp = parseFloat(String(row[idxImpr] || '').replace(/[^0-9.-]/g, '')) || 0;
                    const clk = parseFloat(String(row[idxClicks] || '').replace(/[^0-9.-]/g, '')) || 0;
                    const spd = parseFloat(String(row[idxSpend] || '').replace(/[^0-9.-]/g, '')) || 0;
                    metricsByAd[k].impressions += imp;
                    metricsByAd[k].clicks += clk;
                    metricsByAd[k].spend += spd;
                }

                // Extract region from names (uses RegionTags if available)
                const extractRegion = (...names) => {
                    if (typeof RegionTags === 'undefined' || !RegionTags.extract) return '';
                    for (const n of names) {
                        const r = RegionTags.extract(n);
                        if (r) return r;
                    }
                    return '';
                };

                let camp = this._state.campaigns.find(c => c.name === campName);
                if (!camp) {
                    camp = {
                        id: this._genId('camp'), name: campName, status: 'ACTIVE',
                        productId, source: 'csv',
                        region: extractRegion(campName, adsetName),
                    };
                    this._state.campaigns.push(camp);
                    result.campaigns++;
                }
                if (!adsetName) continue;

                let adset = this._state.adsets.find(a => a.campaignId === camp.id && a.name === adsetName);
                if (!adset) {
                    adset = {
                        id: this._genId('as'), name: adsetName, status: 'ACTIVE',
                        campaignId: camp.id, daily_budget: null, source: 'csv',
                        region: extractRegion(adsetName, campName),
                    };
                    this._state.adsets.push(adset);
                    result.adsets++;
                }
                if (!adName) continue;

                let ad = this._state.ads.find(x => x.adsetId === adset.id && x.name === adName);
                if (!ad) {
                    ad = {
                        id: this._genId('ad'), name: adName, status: 'ACTIVE',
                        adsetId: adset.id, thumbnail: '', source: 'csv',
                        region: extractRegion(adName, adsetName, campName),
                    };
                    this._state.ads.push(ad);
                    result.ads++;
                }
            }

            // Aplica latest status + budget + metrics
            this._state.campaigns.forEach(c => {
                const ls = latestStatus['C:' + c.name];
                if (ls?.status) c.status = this._mapStatus(ls.status);
            });
            this._state.adsets.forEach(a => {
                const camp = this._state.campaigns.find(c => c.id === a.campaignId);
                if (!camp) return;
                const ls = latestStatus['AS:' + camp.name + '|' + a.name];
                if (ls?.status) a.status = this._mapStatus(ls.status);
                const lb = latestBudget['AS:' + camp.name + '|' + a.name];
                if (lb?.budget) a.daily_budget = lb.budget;
            });
            this._state.ads.forEach(ad => {
                const adset = this._state.adsets.find(a => a.id === ad.adsetId);
                if (!adset) return;
                const camp = this._state.campaigns.find(c => c.id === adset.campaignId);
                if (!camp) return;
                const ls = latestStatus['A:' + camp.name + '|' + adset.name + '|' + ad.name];
                if (ls?.status) ad.status = this._mapStatus(ls.status);
                const m = metricsByAd[ad.name + '||' + adset.name + '||' + camp.name];
                if (m) {
                    ad.impressions = Math.round(m.impressions);
                    ad.clicks = Math.round(m.clicks);
                    ad.spend = m.spend;
                }
            });

            this._persist();
            return result;
        },

        _mapStatus(s) {
            const n = this._norm(s);
            if (!n) return 'ACTIVE';
            // Ordem importa: archived antes de active porque "archived" não inclui "active"
            if (n.includes('archiv') || n.includes('arquiv')) return 'ARCHIVED';
            if (n.includes('delet') || n.includes('removid')) return 'DELETED';
            if (n.includes('not delivering') || n.includes('not_delivering') || n.includes('nao veiculando')) return 'PAUSED';
            if (n.includes('paus')) return 'PAUSED';
            if (n.includes('inactive') || n.includes('inativ') || n === 'off') return 'PAUSED';
            if (n.includes('issue') || n.includes('erro') || n.includes('reject')) return 'WITH_ISSUES';
            if (n.includes('pending') || n.includes('processando')) return 'IN_PROCESS';
            if (n.includes('active') || n.includes('ativ') || n.includes('veiculando') || n.includes('running')) return 'ACTIVE';
            return 'ACTIVE';
        },

        _regionBadge(region) {
            if (!region) return '';
            const label = (typeof RegionTags !== 'undefined' && RegionTags.labelPlain) ? RegionTags.labelPlain(region) : region;
            return ` <span class="adh-region-badge" title="${this._esc(label)}"><i data-lucide="map-pin" style="width:9px;height:9px;vertical-align:-1px"></i> ${this._esc(region)}</span>`;
        },

        _statusBadge(status) {
            const s = (status || '').toUpperCase();
            const map = {
                ACTIVE: { label: 'Ativo', cls: 'adh-st-active' },
                PAUSED: { label: 'Pausado', cls: 'adh-st-paused' },
                ARCHIVED: { label: 'Arquivado', cls: 'adh-st-archived' },
                DELETED: { label: 'Deletado', cls: 'adh-st-deleted' },
                WITH_ISSUES: { label: 'Com erros', cls: 'adh-st-issues' },
                IN_PROCESS: { label: 'Processando', cls: 'adh-st-pending' },
                CAMPAIGN_PAUSED: { label: 'Camp. pausada', cls: 'adh-st-paused' },
                ADSET_PAUSED: { label: 'Conj. pausado', cls: 'adh-st-paused' },
            };
            const m = map[s] || { label: status || '—', cls: 'adh-st-other' };
            return `<span class="adh-status-badge ${m.cls}">${m.label}</span>`;
        },

        _drawConnections() {
            const svg = document.getElementById('adh-svg');
            const wrap = svg?.parentElement;
            if (!svg || !wrap) return;
            const wrect = wrap.getBoundingClientRect();
            svg.setAttribute('width', wrect.width);
            svg.setAttribute('height', wrect.height);
            svg.innerHTML = '';

            const conns = [];
            if (this._state.selectedProductId && this._state.selectedCampaignId) {
                conns.push({ from: `[data-level="product"][data-id="${this._cssEsc(this._state.selectedProductId)}"]`, to: `[data-level="campaign"][data-id="${this._cssEsc(this._state.selectedCampaignId)}"]` });
            }
            if (this._state.selectedCampaignId && this._state.selectedAdsetId) {
                conns.push({ from: `[data-level="campaign"][data-id="${this._cssEsc(this._state.selectedCampaignId)}"]`, to: `[data-level="adset"][data-id="${this._cssEsc(this._state.selectedAdsetId)}"]` });
            }
            if (this._state.selectedAdsetId && this._state.selectedAdId) {
                conns.push({ from: `[data-level="adset"][data-id="${this._cssEsc(this._state.selectedAdsetId)}"]`, to: `[data-level="ad"][data-id="${this._cssEsc(this._state.selectedAdId)}"]` });
            }

            for (const c of conns) {
                const a = wrap.querySelector(c.from);
                const b = wrap.querySelector(c.to);
                if (!a || !b) continue;
                const ar = a.getBoundingClientRect();
                const br = b.getBoundingClientRect();
                const x1 = ar.right - wrect.left;
                const y1 = ar.top + ar.height/2 - wrect.top;
                const x2 = br.left - wrect.left;
                const y2 = br.top + br.height/2 - wrect.top;
                const mx = (x1 + x2) / 2;
                const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                path.setAttribute('d', `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
                path.setAttribute('stroke', '#8b5cf6');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('fill', 'none');
                path.setAttribute('opacity', '0.7');
                svg.appendChild(path);
            }
        },

        _cssEsc(s) { return String(s).replace(/"/g, '\\"'); },

        // ============= BOARD VIEW (estilo Miro) =============
        _renderBoard() {
            const wrap = document.getElementById('adh-board-wrap');
            const nodesEl = document.getElementById('adh-board-nodes');
            const svg = document.getElementById('adh-board-svg');
            if (!wrap || !nodesEl || !svg) return;

            // Layout: 4 columns × N rows, each node 220×85 with 40px gap
            const NODE_W = 220, NODE_H = 90, COL_GAP = 80, ROW_GAP = 20;
            const COL_X = (i) => i * (NODE_W + COL_GAP) + 40;

            const productId = this._state.selectedProductId;
            const products = this._products().filter(p => productId ? p.id === productId : true);

            // If nothing selected, show all products that have campaigns
            const visibleProducts = productId
                ? products
                : this._products().filter(p => this._campaignsForProduct(p.id).length > 0);

            const nodes = [];
            const lines = [];
            let curY = 40;

            const isCollapsed = (type, id) => !!this._state.collapsed[type + ':' + id];

            for (const prod of visibleProducts) {
                const campaigns = this._campaignsForProduct(prod.id);
                if (!campaigns.length) continue;
                const productStart = curY;
                const prodCollapsed = isCollapsed('product', prod.id);

                if (prodCollapsed) {
                    // Just render the product node alone, no children
                    nodes.push({ x: COL_X(0), y: curY, type: 'product', item: prod });
                    curY += NODE_H + ROW_GAP * 2;
                    continue;
                }

                for (let ci = 0; ci < campaigns.length; ci++) {
                    const camp = campaigns[ci];
                    const campCollapsed = isCollapsed('campaign', camp.id);
                    const adsets = campCollapsed ? [] : this._state.adsets.filter(a => a.campaignId === camp.id);
                    const campStart = curY;

                    if (adsets.length === 0) {
                        // No adsets to render — single row for the campaign
                        nodes.push({ x: COL_X(1), y: curY, type: 'campaign', item: camp });
                        curY += NODE_H + ROW_GAP;
                    } else {
                        for (let ai = 0; ai < adsets.length; ai++) {
                            const adset = adsets[ai];
                            const adsetCollapsed = isCollapsed('adset', adset.id);
                            const ads = adsetCollapsed ? [] : this._state.ads.filter(x => x.adsetId === adset.id);
                            const adsetStart = curY;

                            if (ads.length === 0) {
                                nodes.push({ x: COL_X(2), y: curY, type: 'adset', item: adset });
                                curY += NODE_H + ROW_GAP;
                            } else {
                                for (const ad of ads) {
                                    nodes.push({ x: COL_X(3), y: curY, type: 'ad', item: ad });
                                    curY += NODE_H + ROW_GAP;
                                }
                                const adsetY = (adsetStart + curY - ROW_GAP - NODE_H) / 2;
                                nodes.push({ x: COL_X(2), y: adsetY, type: 'adset', item: adset });
                            }
                        }
                        // Campaign node centered relative to its adsets — only here when there were adsets
                        const campY = (campStart + curY - ROW_GAP - NODE_H) / 2;
                        nodes.push({ x: COL_X(1), y: campY, type: 'campaign', item: camp });
                    }
                }

                const prodY = (productStart + curY - ROW_GAP - NODE_H) / 2;
                nodes.push({ x: COL_X(0), y: prodY, type: 'product', item: prod });
                curY += ROW_GAP * 2;
            }

            // Render nodes
            nodesEl.innerHTML = nodes.map(n => this._renderBoardNode(n, NODE_W, NODE_H)).join('');

            // Render lines (use approximate y position; pair by node ids)
            const totalW = COL_X(3) + NODE_W + 40;
            const totalH = curY + 40;
            const canvas = document.getElementById('adh-board-canvas');
            if (canvas) {
                canvas.style.width = totalW + 'px';
                canvas.style.height = totalH + 'px';
            }
            svg.setAttribute('width', totalW);
            svg.setAttribute('height', totalH);

            const allNodes = nodes;
            const findNode = (type, id) => allNodes.find(n => n.type === type && n.item.id === id);
            const connections = [];
            // Only draw lines if BOTH parent and child are present (i.e. not collapsed)
            visibleProducts.forEach(p => {
                if (isCollapsed('product', p.id)) return;
                this._campaignsForProduct(p.id).forEach(c => {
                    const a = findNode('product', p.id), b = findNode('campaign', c.id);
                    if (a && b) connections.push({ a, b });
                });
            });
            this._state.campaigns.forEach(c => {
                if (isCollapsed('campaign', c.id)) return;
                this._state.adsets.filter(a => a.campaignId === c.id).forEach(a => {
                    const x = findNode('campaign', c.id), y = findNode('adset', a.id);
                    if (x && y) connections.push({ a:x, b:y });
                });
            });
            this._state.adsets.forEach(a => {
                if (isCollapsed('adset', a.id)) return;
                this._state.ads.filter(x => x.adsetId === a.id).forEach(x => {
                    const p = findNode('adset', a.id), q = findNode('ad', x.id);
                    if (p && q) connections.push({ a:p, b:q });
                });
            });

            svg.innerHTML = connections.filter(c => c.a && c.b).map(c => {
                const x1 = c.a.x + NODE_W, y1 = c.a.y + NODE_H/2;
                const x2 = c.b.x, y2 = c.b.y + NODE_H/2;
                const mx = (x1 + x2) / 2;
                return `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" stroke="#8b5cf6" stroke-width="1.5" fill="none" opacity="0.45"/>`;
            }).join('');

            // Bind clicks
            nodesEl.querySelectorAll('.adh-board-node').forEach(el => {
                el.addEventListener('click', () => {
                    const lvl = el.dataset.type, id = el.dataset.id;
                    if (lvl === 'product') this._selectProduct(id);
                    else if (lvl === 'campaign') this._selectCampaign(id);
                    else if (lvl === 'adset') this._selectAdset(id);
                    else if (lvl === 'ad') this._selectAd(id);
                    this._renderBoard();
                });
                el.addEventListener('dblclick', () => this._openEditModal(el.dataset.type, el.dataset.id));
                // "Validate" toggle
                const validBtn = el.querySelector('.adh-board-validate');
                if (validBtn) validBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._toggleValidated(el.dataset.type, el.dataset.id);
                });
                // Collapse/expand toggle
                const collapseBtn = el.querySelector('.adh-board-collapse');
                if (collapseBtn) collapseBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._toggleCollapsed(el.dataset.type, el.dataset.id);
                });
            });
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            this._applyBoardTransform();
        },

        _renderBoardNode(n, w, h) {
            const item = n.item;
            const selected = (n.type === 'product' && item.id === this._state.selectedProductId)
                || (n.type === 'campaign' && item.id === this._state.selectedCampaignId)
                || (n.type === 'adset' && item.id === this._state.selectedAdsetId)
                || (n.type === 'ad' && item.id === this._state.selectedAdId);
            const icons = { product:'package', campaign:'megaphone', adset:'target', ad:'image' };
            const labels = { product:'Produto', campaign:'Campanha', adset:'Conjunto', ad:'Criativo' };
            const status = (n.type === 'product') ? '' : (this._statusBadge(item.status) + (item.region ? this._regionBadge(item.region) : ''));
            const valid = item.validated ? '<i data-lucide="check-circle-2" style="width:13px;height:13px;color:#10b981" title="Validado"></i>' : '';
            const thumb = n.type === 'ad' && item.thumbnail ? `<img src="${this._esc(item.thumbnail)}" style="width:34px;height:34px;border-radius:6px;object-fit:cover;flex-shrink:0">` : '';

            // Children count (for collapse badge)
            let childCount = 0;
            if (n.type === 'product') childCount = this._campaignsForProduct(item.id).length;
            else if (n.type === 'campaign') childCount = this._state.adsets.filter(a => a.campaignId === item.id).length;
            else if (n.type === 'adset') childCount = this._state.ads.filter(x => x.adsetId === item.id).length;

            const collapsedKey = n.type + ':' + item.id;
            const isCollapsed = !!this._state.collapsed[collapsedKey];
            const collapseBtn = (n.type !== 'ad' && childCount > 0)
                ? `<button class="adh-board-collapse" title="${isCollapsed ? 'Expandir' : 'Recolher'} (${childCount})">
                    <i data-lucide="${isCollapsed ? 'chevron-right' : 'chevron-down'}" style="width:13px;height:13px"></i>
                    <span class="adh-board-child-count">${childCount}</span>
                </button>` : '';

            return `<div class="adh-board-node ${selected ? 'adh-board-node-selected' : ''} ${item.validated ? 'adh-board-node-validated' : ''} adh-board-node-${n.type}"
                data-type="${n.type}" data-id="${this._esc(item.id)}"
                style="left:${n.x}px;top:${n.y}px;width:${w}px;height:${h}px">
                <div class="adh-board-node-hdr">
                    <i data-lucide="${icons[n.type]}" style="width:12px;height:12px"></i>
                    <span class="adh-board-node-type">${labels[n.type]}</span>
                    ${valid}
                    <div class="adh-board-node-actions">
                        ${n.type !== 'product' ? `<button class="adh-board-validate" title="Marcar como validado">
                            <i data-lucide="${item.validated ? 'check-square' : 'square'}" style="width:13px;height:13px"></i>
                        </button>` : ''}
                        ${collapseBtn}
                    </div>
                </div>
                <div class="adh-board-node-body">
                    ${thumb}
                    <div style="flex:1;min-width:0">
                        <div class="adh-board-node-title">${this._esc(item.name)}</div>
                        <div class="adh-board-node-meta">${status}</div>
                    </div>
                </div>
            </div>`;
        },

        _toggleCollapsed(type, id) {
            const key = type + ':' + id;
            if (this._state.collapsed[key]) delete this._state.collapsed[key];
            else this._state.collapsed[key] = true;
            this._renderBoard();
        },

        _applyBoardTransform() {
            const c = document.getElementById('adh-board-canvas');
            if (!c) return;
            const { zoom, tx, ty } = this._state.board;
            c.style.transform = `translate(${tx}px, ${ty}px) scale(${zoom})`;
            const label = document.getElementById('adh-board-zoom-label');
            if (label) label.textContent = Math.round(zoom * 100) + '%';
        },

        _zoomBoard(factor) {
            this._state.board.zoom = Math.max(0.2, Math.min(2.5, this._state.board.zoom * factor));
            this._applyBoardTransform();
        },

        _zoomBoardAt(factor, clientX, clientY) {
            const vp = document.getElementById('adh-board-viewport');
            if (!vp) return;
            const rect = vp.getBoundingClientRect();
            const cx = clientX - rect.left;
            const cy = clientY - rect.top;
            const newZoom = Math.max(0.2, Math.min(2.5, this._state.board.zoom * factor));
            // Keep cursor anchor
            const ratio = newZoom / this._state.board.zoom;
            this._state.board.tx = cx - (cx - this._state.board.tx) * ratio;
            this._state.board.ty = cy - (cy - this._state.board.ty) * ratio;
            this._state.board.zoom = newZoom;
            this._applyBoardTransform();
        },

        _resetBoard() {
            this._state.board.zoom = 1;
            this._state.board.tx = 0;
            this._state.board.ty = 0;
            this._applyBoardTransform();
        },

        // ============= EDIT MODAL =============
        _openEditModal(level, id) {
            const item = this._findItem(level, id);
            if (!item) return;
            this._state.editing = { level, id };
            this._editingImage = item.thumbnail || '';
            document.getElementById('adh-edit-title').textContent = 'Editar ' + ({product:'produto', campaign:'campanha', adset:'conjunto', ad:'criativo'}[level] || 'item');
            document.getElementById('adh-edit-name').value = item.name || '';
            document.getElementById('adh-edit-name').disabled = level === 'product';
            const statusSel = document.getElementById('adh-edit-status');
            const statusGroup = statusSel?.parentElement;
            if (level === 'product') {
                if (statusGroup) statusGroup.style.display = 'none';
            } else {
                if (statusGroup) statusGroup.style.display = '';
                statusSel.value = item.status || 'ACTIVE';
            }
            document.getElementById('adh-edit-validated').checked = !!item.validated;
            // Image (only for ads)
            const imgGroup = document.getElementById('adh-edit-image-group');
            if (level === 'ad') {
                imgGroup.style.display = '';
                const thumb = document.getElementById('adh-edit-thumb');
                if (item.thumbnail) {
                    thumb.src = item.thumbnail;
                    thumb.style.display = '';
                    document.getElementById('adh-edit-clear-img').style.display = '';
                } else {
                    thumb.style.display = 'none';
                    document.getElementById('adh-edit-clear-img').style.display = 'none';
                }
            } else {
                imgGroup.style.display = 'none';
            }
            document.getElementById('adh-edit-modal')?.classList.remove('hidden');
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        _closeEditModal() {
            document.getElementById('adh-edit-modal')?.classList.add('hidden');
            this._state.editing = null;
            this._editingImage = null;
        },

        _saveEditModal() {
            if (!this._state.editing) return;
            const { level, id } = this._state.editing;
            const item = this._findItem(level, id);
            if (!item) return;
            const newName = document.getElementById('adh-edit-name').value.trim();
            const prevThumb = item.thumbnail;
            if (newName && level !== 'product') item.name = newName;
            if (level !== 'product') {
                item.status = document.getElementById('adh-edit-status').value;
            }
            item.validated = document.getElementById('adh-edit-validated').checked;
            if (level === 'ad' && this._editingImage !== null) {
                item.thumbnail = this._editingImage;
            }
            try {
                this._persist();
            } catch (err) {
                // Reverte mudança da imagem (que provavelmente causou quota)
                if (level === 'ad') item.thumbnail = prevThumb;
                console.error('[AdHierarchy] save failed:', err);
                return;
            }
            this._closeEditModal();
            this.render();
            if (this._state.view === 'board') this._renderBoard();
            if (typeof showToast === 'function') showToast('Item salvo', 'success');
        },

        _handleImageUpload(file) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                // Resize for storage
                const img = new Image();
                img.onload = () => {
                    const maxW = 320;
                    const scale = Math.min(1, maxW / img.width);
                    const cw = Math.round(img.width * scale);
                    const ch = Math.round(img.height * scale);
                    const canvas = document.createElement('canvas');
                    canvas.width = cw; canvas.height = ch;
                    canvas.getContext('2d').drawImage(img, 0, 0, cw, ch);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.78);
                    this._editingImage = dataUrl;
                    const thumb = document.getElementById('adh-edit-thumb');
                    thumb.src = dataUrl;
                    thumb.style.display = '';
                    document.getElementById('adh-edit-clear-img').style.display = '';
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        },

        _findItem(level, id) {
            if (level === 'product') return this._products().find(p => p.id === id);
            if (level === 'campaign') return this._state.campaigns.find(c => c.id === id);
            if (level === 'adset') return this._state.adsets.find(a => a.id === id);
            if (level === 'ad') return this._state.ads.find(x => x.id === id);
            return null;
        },

        _toggleValidated(level, id) {
            const item = this._findItem(level, id);
            if (!item) return;
            // Products are local AppState — don't toggle validated there (per-product validation lives in product itself)
            if (level === 'product') return;
            item.validated = !item.validated;
            this._persist();
            this._renderColumn(level);
            if (this._state.view === 'board') this._renderBoard();
        },

        _renderDetail() {
            const panel = document.getElementById('adh-detail-panel');
            if (!panel) return;
            const { selectedProductId, selectedCampaignId, selectedAdsetId, selectedAdId } = this._state;
            const parts = [];
            const productName = (() => {
                if (!selectedProductId) return null;
                if (selectedProductId === '__unassigned__') return 'Sem produto';
                const p = this._products().find(x => x.id === selectedProductId);
                return p?.name || selectedProductId;
            })();
            const campaign = this._state.campaigns.find(c => c.id === selectedCampaignId);
            const adset = this._state.adsets.find(a => a.id === selectedAdsetId);
            const ad = this._state.ads.find(x => x.id === selectedAdId);

            if (productName) parts.push(`<span class="adh-bc-item"><i data-lucide="package" style="width:11px;height:11px"></i> ${this._esc(productName)}</span>`);
            if (campaign) parts.push(`<span class="adh-bc-item"><i data-lucide="megaphone" style="width:11px;height:11px"></i> ${this._esc(campaign.name)}</span>`);
            if (adset) parts.push(`<span class="adh-bc-item"><i data-lucide="target" style="width:11px;height:11px"></i> ${this._esc(adset.name)}</span>`);
            if (ad) parts.push(`<span class="adh-bc-item"><i data-lucide="image" style="width:11px;height:11px"></i> ${this._esc(ad.name)}</span>`);

            if (parts.length < 2) {
                panel.style.display = 'none';
                panel.innerHTML = '';
                return;
            }
            panel.style.display = '';
            panel.innerHTML = `<div class="adh-breadcrumbs">${parts.join('<i data-lucide="chevron-right" style="width:12px;height:12px;opacity:0.5"></i>')}</div>`;
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        _esc(s) {
            const d = document.createElement('div');
            d.textContent = s == null ? '' : String(s);
            return d.innerHTML;
        },
    };

    if (typeof window !== 'undefined') {
        window.AdHierarchyModule = AdHierarchyModule;
        document.addEventListener('DOMContentLoaded', () => AdHierarchyModule.init());
    }
})();
