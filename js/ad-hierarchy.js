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
            currency: 'USD',    // lida do cabeçalho do CSV, ex.: "Valor usado (GBP)"
            // Cache from FB (if connected)
            fbAdsetsByCamp: {},
            fbAdsByAdset: {},
            filter: { product:'', campaign:'', adset:'', ad:'' },
            // Filtros do Board — só em memória de propósito: recarregar volta a mostrar tudo
            boardFilter: { q:'', running:false, valid:false, metric:'', top:'', compact:false, period:'', grouped:false },
            // Mídia compartilhada por NOME de criativo: uma cópia serve todos os
            // conjuntos que rodam o mesmo criativo (evita 127 cópias no armazenamento)
            creativeMedia: {},
            // Board pan/zoom
            board: { zoom: 1, tx: 0, ty: 0, dragging: false, dragX: 0, dragY: 0 },
            // Collapsed nodes: { "campaign:id": true, "adset:id": true }
            collapsed: {},
            // Edit modal target
            editing: null, // { level, id }
            // ── Canvas livre (funil estilo Miro) ──
            nodePos: {},       // "type:id" -> {x,y} posição customizada (arrasto manual)
            customEdges: [],   // [{id, from:"type:id", to:"type:id"}] conexões manuais
            funnelNodes: [],   // [{id, kind, title, text, color, x, y}] etapas de funil / notas
            connectFrom: null, // "type:id" origem enquanto conecta
            selectedEdgeId: null,
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
                if (data.nodePos && typeof data.nodePos === 'object') this._state.nodePos = data.nodePos;
                if (Array.isArray(data.customEdges)) this._state.customEdges = data.customEdges;
                if (Array.isArray(data.funnelNodes)) this._state.funnelNodes = data.funnelNodes;
                if (data.creativeMedia && typeof data.creativeMedia === 'object') this._state.creativeMedia = data.creativeMedia;
                if (typeof data.currency === 'string') this._state.currency = data.currency;
            } catch (e) { console.warn('[AdHierarchy] load failed:', e); }
        },

        _persist() {
            const payload = JSON.stringify({
                campaigns: this._state.campaigns,
                adsets: this._state.adsets,
                ads: this._state.ads,
                nodePos: this._state.nodePos,
                customEdges: this._state.customEdges,
                funnelNodes: this._state.funnelNodes,
                creativeMedia: this._state.creativeMedia,
                currency: this._state.currency,
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
                        nodePos: this._state.nodePos,
                        customEdges: this._state.customEdges,
                        funnelNodes: this._state.funnelNodes,
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

            // ── Barra de filtros do Board ──
            const reBoard = () => this._renderBoard();
            const chip = (id, campo) => {
                const b = document.getElementById(id);
                b?.addEventListener('click', () => {
                    if (b.disabled) return;
                    this._state.boardFilter[campo] = !this._state.boardFilter[campo];
                    b.setAttribute('aria-pressed', String(this._state.boardFilter[campo]));
                    reBoard();
                });
            };
            chip('adh-f-running', 'running');
            chip('adh-f-valid', 'valid');
            chip('adh-f-compact', 'compact');
            chip('adh-f-grouped', 'grouped');
            document.getElementById('adh-board-top')?.addEventListener('change', (e) => {
                this._state.boardFilter.top = e.target.value;   // '' | 'best' | 'worst'
                reBoard();
            });
            document.getElementById('adh-board-period')?.addEventListener('change', (e) => {
                this._state.boardFilter.period = e.target.value;
                reBoard();
            });
            document.getElementById('adh-board-q')?.addEventListener('input', (e) => {
                // debounce: cada tecla redesenha dezenas de nós com imagem
                clearTimeout(this._boardQTimer);
                const v = e.target.value;
                this._boardQTimer = setTimeout(() => { this._state.boardFilter.q = v; reBoard(); }, 150);
            });
            document.getElementById('adh-board-metric')?.addEventListener('change', (e) => {
                const v = e.target.value;
                this._state.boardFilter.metric = v;
                const topSel = document.getElementById('adh-board-top');
                if (topSel) {
                    topSel.disabled = !v;
                    topSel.title = v ? 'Mostra só os 10 melhores ou os 10 piores pela métrica' : 'Escolha uma métrica para habilitar';
                    if (!v) { this._state.boardFilter.top = ''; topSel.value = ''; }
                }
                reBoard();
            });
            document.getElementById('adh-board-collapse-sets')?.addEventListener('click', () => {
                (this._state.adsets || []).forEach(a => { this._state.collapsed['adset:' + a.id] = true; });
                reBoard();
            });
            document.getElementById('adh-board-expand')?.addEventListener('click', () => {
                this._state.collapsed = {};
                reBoard();
            });
            document.getElementById('adh-board-clear')?.addEventListener('click', () => {
                this._state.boardFilter = { q:'', running:false, valid:false, metric:'', top:'', compact:false, period:'', grouped:false };
                ['adh-f-running','adh-f-valid','adh-f-compact','adh-f-grouped'].forEach(id => {
                    document.getElementById(id)?.setAttribute('aria-pressed', 'false');
                });
                const topSel = document.getElementById('adh-board-top'); if (topSel) { topSel.disabled = true; topSel.value = ''; }
                const q = document.getElementById('adh-board-q'); if (q) q.value = '';
                const m = document.getElementById('adh-board-metric'); if (m) m.value = '';
                const pr = document.getElementById('adh-board-period'); if (pr) pr.value = '';
                reBoard();
            });

            // Funil: dropdown de etapas + auto-layout
            document.getElementById('adh-btn-funnel')?.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('adh-funnel-dropdown')?.classList.toggle('hidden');
            });
            document.querySelectorAll('#adh-funnel-dropdown [data-funnel-kind]').forEach(b => {
                b.addEventListener('click', () => {
                    document.getElementById('adh-funnel-dropdown')?.classList.add('hidden');
                    this._addFunnelNode(b.dataset.funnelKind);
                });
            });
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.adh-funnel-menu')) document.getElementById('adh-funnel-dropdown')?.classList.add('hidden');
            });
            document.getElementById('adh-board-autolayout')?.addEventListener('click', () => {
                // Reorganiza os nós hierárquicos (nós de funil ficam onde você deixou)
                Object.keys(this._state.nodePos).forEach(k => { if (!k.startsWith('funnel:')) delete this._state.nodePos[k]; });
                try { this._persist(); } catch (err) {}
                this._renderBoard();
                if (typeof showToast === 'function') showToast('Auto-layout aplicado', 'info');
            });

            // Board: pan + zoom
            const vp = document.getElementById('adh-board-viewport');
            if (vp) {
                vp.addEventListener('wheel', (e) => {
                    if (e.ctrlKey || e.metaKey) e.preventDefault();
                    const factor = e.deltaY < 0 ? 1.1 : 1/1.1;
                    this._zoomBoardAt(factor, e.clientX, e.clientY);
                }, { passive: false });
                // Interação estilo Miro:
                //   arrasto em nó  → MOVE o nó (posição salva)
                //   arrasto no vazio → PAN do canvas
                //   clique (sem mover) → seleção normal
                let pressed = false, didMove = false, sx=0, sy=0, sTx=0, sTy=0;
                let dragNodeEl = null, dragKey = null, nStartX = 0, nStartY = 0;
                const DRAG_THRESHOLD = 4;

                vp.addEventListener('mousedown', (e) => {
                    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
                    if (e.target.closest('button')) return;
                    pressed = true; didMove = false;
                    sx = e.clientX; sy = e.clientY;
                    const nodeEl = (e.button === 0) ? e.target.closest('.adh-board-node') : null;
                    if (nodeEl) {
                        dragNodeEl = nodeEl;
                        dragKey = nodeEl.dataset.type + ':' + nodeEl.dataset.id;
                        nStartX = parseFloat(nodeEl.style.left) || 0;
                        nStartY = parseFloat(nodeEl.style.top) || 0;
                    } else {
                        dragNodeEl = null; dragKey = null;
                        sTx = this._state.board.tx;
                        sTy = this._state.board.ty;
                    }
                    if (e.button === 1 || e.button === 2) e.preventDefault();
                });

                window.addEventListener('mousemove', (e) => {
                    if (!pressed) return;
                    const dx = e.clientX - sx, dy = e.clientY - sy;
                    if (!didMove && (Math.abs(dx) + Math.abs(dy)) >= DRAG_THRESHOLD) {
                        didMove = true;
                        vp.style.cursor = dragNodeEl ? 'move' : 'grabbing';
                        if (dragNodeEl) dragNodeEl.classList.add('adh-node-dragging');
                    }
                    if (!didMove) return;
                    if (dragNodeEl) {
                        const z = this._state.board.zoom || 1;
                        dragNodeEl.style.left = Math.max(0, nStartX + dx / z) + 'px';
                        dragNodeEl.style.top = Math.max(0, nStartY + dy / z) + 'px';
                        this._drawBoardEdges(); // edges seguem o nó em tempo real
                    } else {
                        this._state.board.tx = sTx + dx;
                        this._state.board.ty = sTy + dy;
                        this._applyBoardTransform();
                    }
                });

                window.addEventListener('mouseup', (e) => {
                    if (!pressed) return;
                    pressed = false;
                    vp.style.cursor = '';
                    if (dragNodeEl) dragNodeEl.classList.remove('adh-node-dragging');
                    if (didMove && dragNodeEl && dragKey) {
                        // Salva a posição customizada do nó
                        this._state.nodePos[dragKey] = {
                            x: parseFloat(dragNodeEl.style.left) || 0,
                            y: parseFloat(dragNodeEl.style.top) || 0,
                        };
                        try { this._persist(); } catch (err) {}
                    }
                    dragNodeEl = null; dragKey = null;
                    if (didMove) {
                        // Suprime o click que segue o arrasto. Se soltar FORA do viewport,
                        // o click não passa por aqui — o timeout remove o supressor pra não
                        // engolir o próximo clique legítimo.
                        let t = null;
                        const suppressOnce = (ev) => {
                            ev.stopPropagation();
                            ev.preventDefault();
                            cleanup();
                        };
                        const cleanup = () => {
                            vp.removeEventListener('click', suppressOnce, true);
                            if (t) clearTimeout(t);
                        };
                        vp.addEventListener('click', suppressOnce, true);
                        t = setTimeout(cleanup, 300);
                    }
                });

                vp.addEventListener('contextmenu', (e) => e.preventDefault());

                // Esc cancela modo conectar / desseleciona edge
                window.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') {
                        if (this._state.connectFrom || this._state.selectedEdgeId) {
                            this._state.connectFrom = null;
                            this._state.selectedEdgeId = null;
                            vp.classList.remove('adh-connecting');
                            this._drawBoardEdges();
                        }
                    }
                    const ae = document.activeElement;
                    if ((e.key === 'Delete' || e.key === 'Backspace') && this._state.selectedEdgeId
                        && document.getElementById('tab-ad-hierarchy')?.classList.contains('active')
                        && !/input|textarea|select/i.test(ae?.tagName || '')
                        && !(ae && ae.isContentEditable)) {
                        this._deleteCustomEdge(this._state.selectedEdgeId);
                    }
                });
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
                // Tags: plataforma de ads (FB/Google) + conta de anúncio + idiomas, e a página que roda o produto
                const metaBadges = (typeof renderProductMetaBadges === 'function') ? renderProductMetaBadges(p) : '';
                const pageLink = p.pageUrl
                    ? `<a class="prod-page-link" href="${this._esc(p.pageUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Abrir a página que roda este produto"><i data-lucide="external-link" style="width:11px;height:11px;vertical-align:-1px"></i> Página</a>`
                    : '';
                const tagsLine = (metaBadges || pageLink) ? `<div class="adh-card-tags">${metaBadges}${pageLink}</div>` : '';
                return `<div class="adh-card ${selected ? 'adh-card-selected' : ''}" data-level="product" data-id="${this._esc(p.id)}">
                    <div class="adh-card-title">${this._esc(p.name)}</div>
                    ${tagsLine}
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
                if (list) list.innerHTML = '<div class="adh-empty">' + window.loadingHTML('Carregando do FB…') + '</div>';
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
                if (list) list.innerHTML = '<div class="adh-empty">' + window.loadingHTML('Carregando do FB…') + '</div>';
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
            const removedKeys = [];
            if (level === 'campaign') {
                this._state.campaigns = this._state.campaigns.filter(c => c.id !== id);
                const adsetIds = this._state.adsets.filter(a => a.campaignId === id).map(a => a.id);
                const adIds = this._state.ads.filter(x => adsetIds.includes(x.adsetId)).map(x => x.id);
                this._state.adsets = this._state.adsets.filter(a => a.campaignId !== id);
                this._state.ads = this._state.ads.filter(x => !adsetIds.includes(x.adsetId));
                removedKeys.push('campaign:' + id, ...adsetIds.map(a => 'adset:' + a), ...adIds.map(a => 'ad:' + a));
                if (this._state.selectedCampaignId === id) this._state.selectedCampaignId = null;
            } else if (level === 'adset') {
                const adIds = this._state.ads.filter(x => x.adsetId === id).map(x => x.id);
                this._state.adsets = this._state.adsets.filter(a => a.id !== id);
                this._state.ads = this._state.ads.filter(x => x.adsetId !== id);
                removedKeys.push('adset:' + id, ...adIds.map(a => 'ad:' + a));
                if (this._state.selectedAdsetId === id) this._state.selectedAdsetId = null;
            } else if (level === 'ad') {
                this._state.ads = this._state.ads.filter(x => x.id !== id);
                removedKeys.push('ad:' + id);
                if (this._state.selectedAdId === id) this._state.selectedAdId = null;
            }
            // Limpa posições e conexões manuais órfãs
            if (removedKeys.length) {
                const gone = new Set(removedKeys);
                removedKeys.forEach(k => delete this._state.nodePos[k]);
                this._state.customEdges = (this._state.customEdges || []).filter(e => !gone.has(e.from) && !gone.has(e.to));
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

        // API pública: alimenta o mapa a partir das linhas de um relatório (usado pelo
        // Diagnóstico, pra que UM upload de CSV monte também a hierarquia de ads).
        // Retorna null quando o relatório não tem colunas de conjunto/criativo.
        importRowsForProduct(rows, productId) {
            if (!Array.isArray(rows) || rows.length < 2 || !productId) return null;
            if (!this._state.campaigns) this._loadFromStorage();
            const headerIdx = this._findHeaderRow(rows);
            if (headerIdx < 0) return null;
            const headers = rows[headerIdx] || [];
            const temConjunto = this._findCol(headers, ['ad set name', 'nome do conjunto de anuncios', 'nome do conjunto', 'adset name']) >= 0;
            const temCriativo = this._findCol(headers, ['ad name', 'nome do anuncio']) >= 0;
            if (!temConjunto && !temCriativo) return null;
            try {
                return this._importRows(rows.slice(headerIdx), productId);
            } catch (e) {
                console.warn('[AdHierarchy] import via relatório falhou:', e);
                return null;
            }
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
            // Sem produto selecionado, tudo entra como "Sem produto vinculado" e
            // some da coluna do produto — avisa antes em vez de deixar o usuario perdido.
            const pidSel = this._state.selectedProductId;
            if (!pidSel || pidSel === '__unassigned__') {
                const seguir = confirm(
                    'Nenhum produto selecionado.\n\n' +
                    'As campanhas do CSV entrariam como "Sem produto vinculado" — e a coluna do produto continuaria vazia.\n\n' +
                    'Recomendado: Cancelar, clicar no produto na coluna "Produtos" e importar de novo.\n\n' +
                    'Importar assim mesmo?'
                );
                if (!seguir) return;
            }
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
                const alvo = (pidSel && pidSel !== '__unassigned__')
                    ? (this._products().find(p => p.id === pidSel)?.name || 'produto selecionado')
                    : 'Sem produto vinculado';
                showToast(`Importado em "${alvo}": ${result.campaigns} camp · ${result.adsets} conj · ${result.ads} criativos`, 'success');
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

        // Uma chave normalizada que representa TAXA (%) ou CUSTO — não contagem.
        _isRateOrCostHeader(h) {
            const k = ` ${String(h || '')} `;
            return [' taxa ', ' custo por ', ' cost per ', ' ctr ', ' cpm ', ' cpc ',
                    ' percentual ', ' percent ', ' roas ', ' rate ', ' classificacao '].some(t => k.includes(t));
        },

        _findCol(headers, candidates) {
            const norm = headers.map(h => this._norm(h));
            for (const cand of candidates) {
                const c = this._norm(cand);
                const exato = norm.findIndex(h => h === c);
                if (exato >= 0) return exato;
                // Sem isto, 'cliques no link' casava por substring com
                // "Taxa de visualizações da página de destino por cliques no link"
                // e a soma de PORCENTAGENS virava o total de cliques (CTR de 87%).
                const candEhTaxa = this._isRateOrCostHeader(c);
                const idx = norm.findIndex(h => h.includes(c) && (candEhTaxa || !this._isRateOrCostHeader(h)));
                if (idx >= 0) return idx;
            }
            return -1;
        },

        _importRows(rows, forcedProductId) {
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
            const idxCpc = this._findCol(headers, ['cpc custo por clique no link', 'custo por clique no link', 'cpc']);
            // Etapas do funil (Site → Carrinho → IC → Compra)
            const idxLpv = this._findCol(headers, ['visualizacoes da pagina de destino do site', 'visualizacoes da pagina de destino', 'landing page views']);
            const idxAtc = this._findCol(headers, ['adicoes ao carrinho', 'adds to cart']);
            const idxIc  = this._findCol(headers, ['finalizacoes de compra iniciadas', 'checkouts iniciados']);
            const idxPur = this._findCol(headers, ['compras', 'purchases']);

            if (idxCampaign < 0) throw new Error('Coluna "Nome da campanha" não encontrada');

            // O Facebook põe a moeda no próprio cabeçalho: "Valor usado (GBP)".
            // Sem isso o app mostraria libra com cifrão de dólar.
            if (idxSpend >= 0) {
                const m = String(headers[idxSpend] || '').match(/\(([A-Z]{3})\)/);
                if (m) this._state.currency = m[1];
            }

            const result = { campaigns: 0, adsets: 0, ads: 0 };
            const productId = forcedProductId
                || (this._state.selectedProductId && this._state.selectedProductId !== '__unassigned__'
                    ? this._state.selectedProductId : null);

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
                    if (!metricsByAd[k]) metricsByAd[k] = { impressions: 0, clicks: 0, spend: 0, lpv: 0, atc: 0, ic: 0, purchases: 0, first: '', last: '', daily: {} };
                    const imp = parseFloat(String(row[idxImpr] || '').replace(/[^0-9.-]/g, '')) || 0;
                    const spd = parseFloat(String(row[idxSpend] || '').replace(/[^0-9.-]/g, '')) || 0;
                    let clk = parseFloat(String(row[idxClicks] || '').replace(/[^0-9.-]/g, '')) || 0;
                    // Relatório sem coluna de cliques: deriva de gasto / CPC (mesma regra do Diagnóstico)
                    if (!clk && idxCpc >= 0 && spd > 0) {
                        const cpcVal = parseFloat(String(row[idxCpc] || '').replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0;
                        if (cpcVal > 0) clk = spd / cpcVal;
                    }
                    const numCol = (i) => i >= 0 ? (parseFloat(String(row[i] || '').replace(/[^0-9.-]/g, '')) || 0) : 0;
                    metricsByAd[k].impressions += imp;
                    metricsByAd[k].clicks += clk;
                    metricsByAd[k].spend += spd;
                    metricsByAd[k].lpv += numCol(idxLpv);
                    metricsByAd[k].atc += numCol(idxAtc);
                    metricsByAd[k].ic  += numCol(idxIc);
                    metricsByAd[k].purchases += numCol(idxPur);
                    // Janela em que o criativo apareceu no relatório (pra "X dias no ar")
                    if (day) {
                        const m = metricsByAd[k];
                        if (!m.first || day < m.first) m.first = day;
                        if (!m.last || day > m.last) m.last = day;
                        // Série diária compacta [imp, cliques, gasto, lpv, atc, ic, compras]
                        // — é o que permite filtrar o board por período.
                        const cur = m.daily[day] || [0,0,0,0,0,0,0];
                        cur[0]+=imp; cur[1]+=clk; cur[2]+=spd;
                        cur[3]+=numCol(idxLpv); cur[4]+=numCol(idxAtc);
                        cur[5]+=numCol(idxIc);  cur[6]+=numCol(idxPur);
                        m.daily[day] = cur;
                    }
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
                    ad.lpv = Math.round(m.lpv);
                    ad.atc = Math.round(m.atc);
                    ad.ic = Math.round(m.ic);
                    ad.purchases = Math.round(m.purchases);
                    if (m.first) ad.firstSeen = m.first;
                    if (m.last) ad.lastSeen = m.last;
                    // Arredonda pra não inflar o localStorage e mantém só os últimos 120 dias
                    const dias = Object.keys(m.daily || {}).sort().slice(-120);
                    if (dias.length) {
                        const comp = {};
                        dias.forEach(d => {
                            const v = m.daily[d];
                            comp[d] = [Math.round(v[0]), Math.round(v[1]), Math.round(v[2]*100)/100,
                                       Math.round(v[3]), Math.round(v[4]), Math.round(v[5]), Math.round(v[6])];
                        });
                        ad.daily = comp;
                    }
                }
            });

            this._rollUpMetrics();
            this._persist();
            // A tela de Criativos precisa enxergar o que acabou de entrar pela planilha.
            try { window.CreativesModule?.syncFromAdMap?.({ silent: true }); }
            catch (e) { console.warn('[AdHierarchy] sync de criativos falhou:', e); }
            return result;
        },

        // Soma as métricas dos criativos nos conjuntos, e dos conjuntos nas campanhas,
        // pra que TODO nível do board mostre o funil.
        _rollUpMetrics() {
            const zero = () => ({ impressions: 0, clicks: 0, spend: 0, lpv: 0, atc: 0, ic: 0, purchases: 0 });
            const soma = (alvo, fonte) => {
                ['impressions', 'clicks', 'spend', 'lpv', 'atc', 'ic', 'purchases'].forEach(k => {
                    alvo[k] = (alvo[k] || 0) + (Number(fonte[k]) || 0);
                });
            };
            (this._state.adsets || []).forEach(as => {
                const acc = zero();
                (this._state.ads || []).filter(a => a.adsetId === as.id).forEach(a => soma(acc, a));
                Object.assign(as, acc);
            });
            (this._state.campaigns || []).forEach(c => {
                const acc = zero();
                (this._state.adsets || []).filter(a => a.campaignId === c.id).forEach(a => soma(acc, a));
                Object.assign(c, acc);
            });
        },

        // Funil derivado de um item (criativo, conjunto ou campanha)
        _funnelOf(item) {
            const n = (v) => Number(v) || 0;
            // Quando há período ativo, usa o recorte; senão os totais do relatório
            const src = (this._periodCache && this._periodCache.get(item.id)) || item;
            const impressions = n(src.impressions), clicks = n(src.clicks), spend = n(src.spend);
            const lpv = n(src.lpv), atc = n(src.atc), ic = n(src.ic), purchases = n(src.purchases);
            const pct = (a, b) => (b > 0 ? (a / b) * 100 : null);
            return {
                impressions, clicks, spend, lpv, atc, ic, purchases,
                ctr: pct(clicks, impressions),          // FB: impressões → cliques
                cpc: clicks > 0 ? spend / clicks : null,
                lpvRate: pct(lpv, clicks),              // clique → site
                atcRate: pct(atc, lpv),                 // site → carrinho
                icRate: pct(ic, atc),                   // carrinho → IC
                purRate: pct(purchases, ic),            // IC → compra
                cpa: purchases > 0 ? spend / purchases : null,
                temDados: impressions > 0 || clicks > 0 || spend > 0,
            };
        },

        _mapStatus(s) {
            // O Facebook manda "not_delivering", "campaign_paused", "in_process"… e o _norm
            // REMOVE o "_", virando "notdelivering" — que não casava com nada e caía no
            // fallback ACTIVE (campanha desativada aparecia como Ativa). Troca "_" por espaço antes.
            const n = this._norm(String(s || '').replace(/[_\-]+/g, ' '));
            if (!n) return 'ACTIVE';
            // Ordem importa: archived antes de active porque "archived" não inclui "active"
            if (n.includes('archiv') || n.includes('arquiv')) return 'ARCHIVED';
            if (n.includes('delet') || n.includes('removid')) return 'DELETED';
            if (n.includes('not delivering') || n.includes('notdelivering')
                || n.includes('nao veiculando') || n.includes('nao esta veiculando')) return 'PAUSED';
            if (n.includes('paus')) return 'PAUSED';
            if (n.includes('inactive') || n.includes('inativ') || n === 'off'
                || n.includes('desativ') || n.includes('disabled') || n.includes('encerrad')
                || n.includes('completed') || n.includes('concluid')) return 'PAUSED';
            if (n.includes('issue') || n.includes('erro') || n.includes('reject') || n.includes('rejeitad')) return 'WITH_ISSUES';
            if (n.includes('pending') || n.includes('processando') || n.includes('in process')
                || n.includes('em analise') || n.includes('review')) return 'IN_PROCESS';
            if (n.includes('active') || n.includes('ativ') || n.includes('veiculando') || n.includes('running')) return 'ACTIVE';
            return 'ACTIVE';
        },

        _fmtDia(iso) {
            if (!iso) return '';
            const [y, m, d] = String(iso).split('-');
            return d && m ? `${d}/${m}` : iso;
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

        // Último dia com dado no relatório (o período é relativo a ELE, não a hoje —
        // senão um CSV de semana passada mostraria zero em "últimos 7 dias").
        _ultimoDiaComDado() {
            let max = '';
            (this._state.ads || []).forEach(a => { if (a.lastSeen && a.lastSeen > max) max = a.lastSeen; });
            return max;
        },

        // Intervalo do período selecionado, ou null quando é "todo o período"
        _periodRange() {
            const dias = parseInt(this._state.boardFilter?.period, 10);
            if (!dias) return null;
            const fim = this._ultimoDiaComDado();
            if (!fim) return null;
            const d = new Date(fim + 'T00:00:00');
            d.setDate(d.getDate() - (dias - 1));
            return { from: d.toISOString().slice(0, 10), to: fim, dias };
        },

        // Métricas de TODOS os itens recortadas pelo período (Map id -> métricas).
        // Criativo soma sua série diária; conjunto/campanha somam os filhos.
        _buildPeriodCache() {
            const range = this._periodRange();
            if (!range) { this._periodCache = null; return; }
            const cache = new Map();
            const zero = () => ({ impressions:0, clicks:0, spend:0, lpv:0, atc:0, ic:0, purchases:0 });
            const somar = (alvo, arr) => {
                alvo.impressions += arr[0] || 0; alvo.clicks += arr[1] || 0; alvo.spend += arr[2] || 0;
                alvo.lpv += arr[3] || 0; alvo.atc += arr[4] || 0; alvo.ic += arr[5] || 0; alvo.purchases += arr[6] || 0;
            };
            const acumular = (alvo, m) => {
                ['impressions','clicks','spend','lpv','atc','ic','purchases'].forEach(k => { alvo[k] += m[k] || 0; });
            };
            (this._state.ads || []).forEach(ad => {
                const m = zero();
                Object.entries(ad.daily || {}).forEach(([d, arr]) => {
                    if (d >= range.from && d <= range.to) somar(m, arr);
                });
                cache.set(ad.id, m);
            });
            (this._state.adsets || []).forEach(as => {
                const m = zero();
                (this._state.ads || []).forEach(a => { if (a.adsetId === as.id) acumular(m, cache.get(a.id) || zero()); });
                cache.set(as.id, m);
            });
            (this._state.campaigns || []).forEach(c => {
                const m = zero();
                (this._state.adsets || []).forEach(a => { if (a.campaignId === c.id) acumular(m, cache.get(a.id) || zero()); });
                cache.set(c.id, m);
            });
            this._periodCache = cache;
        },

        // ── Filtro do Board: decide quais ids ficam visíveis ──────────────
        // Poda de baixo pra cima: pai só aparece se tiver filho visível.
        // Retorna null quando não há filtro (caminho rápido = mostra tudo).
        _computeBoardScope(adGate) {
            const f = this._state.boardFilter || {};
            const q = String(f.q || '').trim().toLowerCase();
            if (!q && !f.running && !f.valid && !adGate) return null;

            const pass = (o) => (!f.running || o.status === 'ACTIVE') && (!f.valid || !!o.validated);
            const hit  = (o) => !q || String(o.name || '').toLowerCase().includes(q);

            // Indexa uma vez só (evita filter dentro de laço)
            const adsBy = new Map(), setsBy = new Map();
            (this._state.ads || []).forEach(a => {
                if (!adsBy.has(a.adsetId)) adsBy.set(a.adsetId, []);
                adsBy.get(a.adsetId).push(a);
            });
            (this._state.adsets || []).forEach(a => {
                if (!setsBy.has(a.campaignId)) setsBy.set(a.campaignId, []);
                setsBy.get(a.campaignId).push(a);
            });

            const keep = { product: new Set(), campaign: new Set(), adset: new Set(), ad: new Set() };
            (this._products() || []).forEach(prod => {
                const prodHit = hit(prod);
                let prodTemFilho = false;
                this._campaignsForProduct(prod.id).forEach(camp => {
                    const campHit = prodHit || hit(camp);
                    let campTemFilho = false;
                    (setsBy.get(camp.id) || []).forEach(as => {
                        const setHit = campHit || hit(as);
                        let setTemFilho = false;
                        (adsBy.get(as.id) || []).forEach(ad => {
                            if (!pass(ad)) return;
                            if (!(setHit || hit(ad))) return;
                            if (adGate && !adGate(ad)) return;
                            keep.ad.add(ad.id); setTemFilho = true;
                        });
                        const semFilhos = !(adsBy.get(as.id) || []).length;
                        if (setTemFilho || (semFilhos && pass(as) && setHit)) {
                            keep.adset.add(as.id); campTemFilho = true;
                        }
                    });
                    const semSets = !(setsBy.get(camp.id) || []).length;
                    if (campTemFilho || (semSets && pass(camp) && campHit)) {
                        keep.campaign.add(camp.id); prodTemFilho = true;
                    }
                });
                if (prodTemFilho || (prodHit && !this._campaignsForProduct(prod.id).length)) keep.product.add(prod.id);
            });
            return keep;
        },

        // Valor de uma métrica pra ordenar — reaproveita _funnelOf. null = sem dado.
        _metricValue(item, metric) {
            const f = this._funnelOf(item);
            switch (metric) {
                case 'spend':     return f.spend > 0 ? f.spend : null;
                case 'clicks':    return f.clicks > 0 ? f.clicks : null;
                case 'purchases': return f.purchases > 0 ? f.purchases : null;
                case 'ctr':       return f.impressions > 0 ? f.ctr : null;
                case 'cpc':       return f.cpc;
                case 'cpa':       return f.cpa;
                default:          return null;
            }
        },

        // Ordena uma CÓPIA. Em CPC/CPA menor é melhor. Sem dado vai sempre pro fim.
        _sortByMetric(list, metric) {
            const menorMelhor = (metric === 'cpc' || metric === 'cpa');
            return [...list].sort((a, b) => {
                const va = this._metricValue(a, metric), vb = this._metricValue(b, metric);
                if (va == null && vb == null) return 0;
                if (va == null) return 1;
                if (vb == null) return -1;
                return menorMelhor ? va - vb : vb - va;
            });
        },

        // "X dias no ar" a partir da janela vista no relatório
        _diasNoAr(item) {
            if (!item || !item.firstSeen) return null;
            const ini = new Date(item.firstSeen + 'T00:00:00');
            const fim = new Date((item.lastSeen || item.firstSeen) + 'T00:00:00');
            if (isNaN(ini) || isNaN(fim)) return null;
            const dias = Math.round((fim - ini) / 86400000) + 1;
            const hoje = new Date(); hoje.setHours(0,0,0,0);
            const paradoHa = Math.round((hoje - fim) / 86400000);
            return { dias, paradoHa: paradoHa > 1 ? paradoHa : 0, ate: item.lastSeen || item.firstSeen };
        },

        // ============= BOARD VIEW (estilo Miro) =============
        _renderBoard() {
            const wrap = document.getElementById('adh-board-wrap');
            const nodesEl = document.getElementById('adh-board-nodes');
            const svg = document.getElementById('adh-board-svg');
            if (!wrap || !nodesEl || !svg) return;

            // Layout: 4 columns × N rows, each node 220×85 with 40px gap
            const NODE_W = 250, NODE_H = 190, COL_GAP = 80, ROW_GAP = 20;  // 190 = altura real do nó com a faixa de funil
            const f = this._state.boardFilter || {};
            this._buildPeriodCache();          // recorta métricas pelo período antes de tudo
            let keep = this._computeBoardScope();
            let AD_NODE_H = f.compact ? 175 : 350;   // compacto: thumb menor + funil oculto
            let AD_NODE_W = f.compact ? 170 : NODE_W;
            const perRow = f.compact ? 2 : 1;        // compacto: 2 criativos por linha
            const GX = 12, GY = 12;
            const COL_X = (i) => i * (NODE_W + COL_GAP) + 40;

            const productId = this._state.selectedProductId;
            const products = this._products().filter(p => productId ? p.id === productId : true);

            // If nothing selected, show all products that have campaigns
            let visibleProducts = productId
                ? products
                : this._products().filter(p => this._campaignsForProduct(p.id).length > 0);
            if (keep) visibleProducts = visibleProducts.filter(p => keep.product.has(p.id));

            // Ranking dos 10 melhores criativos (precisa vir ANTES do layout por causa do "Só top 10")
            this._boardTopRank = new Map();
            if (f.metric) {
                const idsProd = new Set(visibleProducts.map(p => p.id));
                const campsOk = new Set((this._state.campaigns || []).filter(c => idsProd.has(c.productId)).map(c => c.id));
                const setsOk = new Set((this._state.adsets || []).filter(a => campsOk.has(a.campaignId)).map(a => a.id));
                let cands = (this._state.ads || []).filter(a => setsOk.has(a.adsetId));
                if (keep) cands = cands.filter(a => keep.ad.has(a.id));
                const ordenados = this._sortByMetric(cands, f.metric)
                    .filter(a => this._metricValue(a, f.metric) != null);
                // f.top: '' = nenhum · 'best' = 10 melhores · 'worst' = 10 piores
                this._boardRankDir = f.top || (f.metric ? 'best' : '');
                const lista = this._boardRankDir === 'worst'
                    ? ordenados.slice(-10).reverse()   // piores primeiro
                    : ordenados.slice(0, 10);
                lista.forEach((a, i) => this._boardTopRank.set(a.id, i + 1));
                if (f.top) {
                    keep = this._computeBoardScope(ad => this._boardTopRank.has(ad.id));
                    if (keep) visibleProducts = visibleProducts.filter(p => keep.product.has(p.id));
                }
            }

            const nodes = [];
            const lines = [];
            let curY = 40;

            // ── Modo AGRUPADO: Produto → um cartão por criativo (soma dos conjuntos) ──
            if (f.grouped) {
                for (const prod of visibleProducts) {
                    const campIds = new Set(this._campaignsForProduct(prod.id).map(c => c.id));
                    const setIds = new Set((this._state.adsets || []).filter(a => campIds.has(a.campaignId)).map(a => a.id));
                    let adsProd = (this._state.ads || []).filter(a => setIds.has(a.adsetId));
                    if (keep) adsProd = adsProd.filter(a => keep.ad.has(a.id));
                    let grupos = this._criativosAgrupados(adsProd);
                    if (f.metric) grupos = this._sortByMetric(grupos, f.metric);
                    if (!grupos.length) continue;
                    // métricas já somadas no objeto: o cache de período não deve reinterpretá-las
                    grupos.forEach(g => { if (this._periodCache) this._periodCache.set(g.id, g); });
                    const inicio = curY;
                    grupos.forEach((g, i) => {
                        nodes.push({
                            x: COL_X(1) + (i % perRow) * (AD_NODE_W + GX),
                            y: inicio + Math.floor(i / perRow) * (AD_NODE_H + GY),
                            type: 'ad', item: g,
                        });
                    });
                    const laneH = Math.ceil(grupos.length / perRow) * (AD_NODE_H + GY) - GY;
                    const faixa = Math.max(laneH, NODE_H);
                    nodes.push({ x: COL_X(0), y: inicio + (faixa - NODE_H) / 2, type: 'product', item: prod });
                    curY = inicio + faixa + ROW_GAP * 2;
                }
            } else {

            const isCollapsed = (type, id) => !!this._state.collapsed[type + ':' + id];

            for (const prod of visibleProducts) {
                let campaigns = this._campaignsForProduct(prod.id);
                if (keep) campaigns = campaigns.filter(c => keep.campaign.has(c.id));
                if (f.metric) campaigns = this._sortByMetric(campaigns, f.metric);
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
                    let adsets = campCollapsed ? [] : this._state.adsets.filter(a => a.campaignId === camp.id);
                    if (keep) adsets = adsets.filter(a => keep.adset.has(a.id));
                    if (f.metric) adsets = this._sortByMetric(adsets, f.metric);
                    const campStart = curY;

                    if (adsets.length === 0) {
                        // No adsets to render — single row for the campaign
                        nodes.push({ x: COL_X(1), y: curY, type: 'campaign', item: camp });
                        curY += NODE_H + ROW_GAP;
                    } else {
                        for (let ai = 0; ai < adsets.length; ai++) {
                            const adset = adsets[ai];
                            const adsetCollapsed = isCollapsed('adset', adset.id);
                            let ads = adsetCollapsed ? [] : this._state.ads.filter(x => x.adsetId === adset.id);
                            if (keep) ads = ads.filter(x => keep.ad.has(x.id));
                            if (f.metric) ads = this._sortByMetric(ads, f.metric);
                            const adsetStart = curY;

                            if (ads.length === 0) {
                                nodes.push({ x: COL_X(2), y: curY, type: 'adset', item: adset });
                                curY += NODE_H + ROW_GAP;
                            } else {
                                ads.forEach((ad, i) => {
                                    nodes.push({
                                        x: COL_X(3) + (i % perRow) * (AD_NODE_W + GX),
                                        y: adsetStart + Math.floor(i / perRow) * (AD_NODE_H + GY),
                                        type: 'ad', item: ad,
                                    });
                                });
                                const laneH = Math.ceil(ads.length / perRow) * (AD_NODE_H + GY) - GY;
                                const faixa = Math.max(laneH, NODE_H);
                                curY = adsetStart + faixa + ROW_GAP;
                                const adsetY = adsetStart + (faixa - NODE_H) / 2;
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

            }

            // ── Posições customizadas (arrasto) sobrescrevem o auto-layout ──
            nodes.forEach(n => {
                const pos = this._state.nodePos[n.type + ':' + n.item.id];
                if (pos) { n.x = pos.x; n.y = pos.y; }
            });

            // ── Nós de funil / notas (canvas livre) ──
            let fy = 40;
            (this._state.funnelNodes || []).forEach(f => {
                const key = 'funnel:' + f.id;
                const pos = this._state.nodePos[key];
                const x = pos ? pos.x : COL_X(4) + 40;
                const y = pos ? pos.y : (fy += NODE_H + ROW_GAP, fy - NODE_H - ROW_GAP + 40);
                nodes.push({ x, y, type: 'funnel', item: f });
            });

            // Render nodes
            nodesEl.classList.toggle('adh-compact', !!f.compact);
            nodesEl.innerHTML = nodes.map(n =>
                this._renderBoardNode(n, n.type === 'ad' ? AD_NODE_W : NODE_W, n.type === 'ad' ? AD_NODE_H : NODE_H)
            ).join('');

            // ── Arestas montadas a partir dos nós REALMENTE desenhados ──
            // (varrer o estado inteiro criaria arestas apontando pra nós filtrados)
            const presentes = new Set(nodes.map(n => n.type + ':' + n.item.id));
            const hier = [];
            const par = (from, to) => { if (presentes.has(from) && presentes.has(to)) hier.push({ from, to }); };
            nodes.forEach(n => {
                if (n.type === 'campaign' && n.item.productId) par('product:' + n.item.productId, 'campaign:' + n.item.id);
                else if (n.type === 'adset' && n.item.campaignId) par('campaign:' + n.item.campaignId, 'adset:' + n.item.id);
                else if (n.type === 'ad' && n.item.adsetId) par('adset:' + n.item.adsetId, 'ad:' + n.item.id);
            });
            this._boardHierEdges = hier;
            this._deoverlapNodes(nodesEl);

            // Contador "N de M nós" + botão de limpar
            const totalGeral = (this._state.campaigns || []).length + (this._state.adsets || []).length + (this._state.ads || []).length;
            const mostrados = nodes.filter(n => n.type !== 'funnel' && n.type !== 'product').length;
            const cnt = document.getElementById('adh-board-count');
            const rangeAtivo = this._periodRange();
            if (cnt) cnt.textContent = `${mostrados} de ${totalGeral} nós`
                + (rangeAtivo ? ` · ${this._fmtDia(rangeAtivo.from)}–${this._fmtDia(rangeAtivo.to)}` : '');
            const temFiltro = !!(f.q || f.running || f.valid || f.metric || f.top || f.compact || f.period || f.grouped);
            document.getElementById('adh-board-clear')?.classList.toggle('hidden', !temFiltro);
            this._boardNodeSize = { w: NODE_W, h: NODE_H };
            this._drawBoardEdges();

            // Bind clicks
            const vp = document.getElementById('adh-board-viewport');
            nodesEl.querySelectorAll('.adh-board-node').forEach(el => {
                el.addEventListener('click', () => {
                    const lvl = el.dataset.type, id = el.dataset.id;
                    const key = lvl + ':' + id;
                    // Modo conectar: 2º clique fecha a conexão
                    if (this._state.connectFrom) {
                        if (this._state.connectFrom !== key) this._addCustomEdge(this._state.connectFrom, key);
                        this._state.connectFrom = null;
                        vp?.classList.remove('adh-connecting');
                        this._drawBoardEdges();
                        return;
                    }
                    if (lvl === 'product') this._selectProduct(id);
                    else if (lvl === 'campaign') this._selectCampaign(id);
                    else if (lvl === 'adset') this._selectAdset(id);
                    else if (lvl === 'ad') this._selectAd(id);
                    if (lvl !== 'funnel') this._renderBoard();
                });
                el.addEventListener('dblclick', () => {
                    if (el.dataset.type === 'funnel') this._editFunnelNode(el.dataset.id);
                    else this._openEditModal(el.dataset.type, el.dataset.id);
                });
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
                // Porta de conexão (⊕): inicia o modo conectar
                const portBtn = el.querySelector('.adh-node-port');
                if (portBtn) portBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const key = el.dataset.type + ':' + el.dataset.id;
                    // Já conectando e clicou no ⊕ do destino? Fecha a conexão aqui mesmo.
                    if (this._state.connectFrom && this._state.connectFrom !== key) {
                        this._addCustomEdge(this._state.connectFrom, key);
                        this._state.connectFrom = null;
                        vp?.classList.remove('adh-connecting');
                        this._drawBoardEdges();
                        return;
                    }
                    this._state.connectFrom = key;
                    this._state.selectedEdgeId = null;
                    vp?.classList.add('adh-connecting');
                    if (typeof showToast === 'function') showToast('Clique em outro nó pra conectar (Esc cancela)', 'info');
                });
                // Deletar nó de funil
                const fnDel = el.querySelector('.adh-funnel-del');
                if (fnDel) fnDel.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._deleteFunnelNode(el.dataset.id);
                });
                // Chips de navegação cruzada (Lista / Pipeline / Criativos / Launcher / Ads Manager)
                el.querySelectorAll('[data-golink]').forEach(chip => {
                    chip.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this._followLink(chip.dataset.golink, el.dataset.type, el.dataset.id);
                    });
                });
            });
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            this._applyBoardTransform();
        },

        // Agrupa os criativos por NOME, somando as métricas de todos os conjuntos.
        // 127 nós repetidos viram 4 cartões — um por criativo real.
        _criativosAgrupados(adsVisiveis) {
            const porNome = new Map();
            (adsVisiveis || []).forEach(ad => {
                const chave = this._creativeKey(ad.name);
                if (!chave) return;
                if (!porNome.has(chave)) {
                    porNome.set(chave, {
                        id: 'grp_' + chave.replace(/[^a-z0-9]/g, '_'),
                        name: ad.name, status: ad.status, validated: !!ad.validated,
                        region: ad.region, thumbnail: '', _grupo: true, _conjuntos: 0, _ids: [],
                        impressions: 0, clicks: 0, spend: 0, lpv: 0, atc: 0, ic: 0, purchases: 0,
                        firstSeen: ad.firstSeen, lastSeen: ad.lastSeen,
                    });
                }
                const g = porNome.get(chave);
                const m = (this._periodCache && this._periodCache.get(ad.id)) || ad;
                ['impressions','clicks','spend','lpv','atc','ic','purchases'].forEach(k => {
                    g[k] += Number(m[k]) || 0;
                });
                g._conjuntos++; g._ids.push(ad.id);
                if (ad.status === 'ACTIVE') g.status = 'ACTIVE';
                if (ad.validated) g.validated = true;
                if (ad.firstSeen && (!g.firstSeen || ad.firstSeen < g.firstSeen)) g.firstSeen = ad.firstSeen;
                if (ad.lastSeen && (!g.lastSeen || ad.lastSeen > g.lastSeen)) g.lastSeen = ad.lastSeen;
            });
            return [...porNome.values()];
        },

        _creativeKey(nome) {
            return String(nome || '').trim().toLowerCase();
        },

        // Imagem do criativo: a própria do nó, ou a compartilhada pelo nome
        _mediaForCreative(item) {
            if (item.thumbnail) return item.thumbnail;
            return (this._state.creativeMedia || {})[this._creativeKey(item.name)] || '';
        },

        // Aplica imagem/validado a TODOS os nós com o mesmo nome de criativo
        _propagarCriativo(item, { imagem, validado }) {
            const chave = this._creativeKey(item.name);
            if (!chave) return 0;
            if (imagem !== undefined) {
                if (!this._state.creativeMedia) this._state.creativeMedia = {};
                if (imagem) this._state.creativeMedia[chave] = imagem;
                else delete this._state.creativeMedia[chave];
                // guarda só na tabela compartilhada — sem cópia por nó
                (this._state.ads || []).forEach(a => {
                    if (this._creativeKey(a.name) === chave) a.thumbnail = '';
                });
            }
            let n = 0;
            (this._state.ads || []).forEach(a => {
                if (this._creativeKey(a.name) !== chave) return;
                if (validado !== undefined) a.validated = validado;
                n++;
            });
            return n;
        },

        // Rede de segurança: depois de renderizar, mede a altura REAL de cada nó e
        // empurra pra baixo qualquer um que esteja encavalando o de cima na mesma coluna.
        // Nós arrastados pelo usuário não são movidos (mas contam como obstáculo).
        _deoverlapNodes(nodesEl) {
            if (!nodesEl) return;
            const GAP = 14;
            const cols = new Map();
            nodesEl.querySelectorAll('.adh-board-node').forEach(el => {
                if (el.dataset.type === 'funnel') return;          // nó de funil é livre
                const col = Math.round(el.offsetLeft / 40) * 40;   // tolera pequenas diferenças
                if (!cols.has(col)) cols.set(col, []);
                cols.get(col).push(el);
            });
            cols.forEach(lista => {
                lista.sort((a, b) => a.offsetTop - b.offsetTop);
                let fimAnterior = -Infinity;
                lista.forEach(el => {
                    const fixo = !!(this._state.nodePos || {})[el.dataset.type + ':' + el.dataset.id];
                    let top = el.offsetTop;
                    if (!fixo && top < fimAnterior + GAP) {
                        top = fimAnterior + GAP;
                        el.style.top = top + 'px';
                    }
                    fimAnterior = Math.max(fimAnterior, top + el.offsetHeight);
                });
            });
        },

        // Desenha TODAS as arestas lendo posição real dos nós no DOM.
        // Chamado no render e a cada frame de arrasto — precisa ser barato.
        _drawBoardEdges() {
            const svg = document.getElementById('adh-board-svg');
            const nodesEl = document.getElementById('adh-board-nodes');
            const canvas = document.getElementById('adh-board-canvas');
            if (!svg || !nodesEl) return;
            const { w: NODE_W, h: NODE_H } = this._boardNodeSize || { w: 220, h: 90 };

            const elFor = (key) => {
                const i = key.indexOf(':');
                return nodesEl.querySelector(`.adh-board-node[data-type="${key.slice(0, i)}"][data-id="${this._cssEsc(key.slice(i + 1))}"]`);
            };
            const rectFor = (key) => {
                const el = elFor(key);
                if (!el) return null;
                return { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth || NODE_W, h: el.offsetHeight || NODE_H };
            };

            let maxX = 0, maxY = 0;
            const parts = [];

            const bezier = (a, b) => {
                // Sai do lado mais próximo (direita→esquerda ou vice-versa)
                const aRight = a.x + a.w <= b.x;
                const x1 = aRight ? a.x + a.w : a.x;
                const x2 = aRight ? b.x : b.x + b.w;
                const y1 = a.y + a.h / 2, y2 = b.y + b.h / 2;
                const mx = (x1 + x2) / 2;
                maxX = Math.max(maxX, a.x + a.w, b.x + b.w);
                maxY = Math.max(maxY, a.y + a.h, b.y + b.h);
                return { d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`, midX: (x1 + x2) / 2, midY: (y1 + y2) / 2 };
            };

            // Cotovelo (padrão de árvore): sai do pai, desce/sobe num TRONCO vertical
            // logo à direita dele e entra no filho na horizontal. Irmãos compartilham o
            // mesmo tronco, então as linhas não se cruzam em diagonal.
            const elbow = (a, b) => {
                const aRight = a.x + a.w <= b.x;
                const x1 = aRight ? a.x + a.w : a.x;
                const x2 = aRight ? b.x : b.x + b.w;
                const y1 = a.y + a.h / 2, y2 = b.y + b.h / 2;
                maxX = Math.max(maxX, a.x + a.w, b.x + b.w);
                maxY = Math.max(maxY, a.y + a.h, b.y + b.h);
                // tronco a 34px do pai (mesmo valor pra todos os filhos dele)
                const bus = aRight ? x1 + 34 : x1 - 34;
                const R = 10;                                  // raio do canto arredondado
                const desce = y2 > y1;
                const dy = Math.abs(y2 - y1);
                if (dy < 2) {
                    return { d: `M ${x1} ${y1} L ${x2} ${y2}`, midX: (x1 + x2) / 2, midY: y1 };
                }
                const r = Math.min(R, dy / 2, Math.abs(bus - x1), Math.abs(x2 - bus));
                const sgn = desce ? 1 : -1;
                const dir = aRight ? 1 : -1;
                const d = [
                    `M ${x1} ${y1}`,
                    `L ${bus - dir * r} ${y1}`,
                    `Q ${bus} ${y1} ${bus} ${y1 + sgn * r}`,      // curva pro tronco
                    `L ${bus} ${y2 - sgn * r}`,                   // tronco vertical
                    `Q ${bus} ${y2} ${bus + dir * r} ${y2}`,      // curva pro filho
                    `L ${x2} ${y2}`,
                ].join(' ');
                return { d, midX: bus, midY: (y1 + y2) / 2 };
            };

            // Arestas hierárquicas (produto→campanha→conjunto→criativo)
            (this._boardHierEdges || []).forEach(e => {
                const a = rectFor(e.from), b = rectFor(e.to);
                if (!a || !b) return;
                const p = elbow(a, b);
                parts.push(`<path d="${p.d}" stroke="#8b5cf6" stroke-width="1.5" fill="none" opacity="0.45"/>`);
            });

            // Arestas manuais (funil) — clicáveis, deletáveis
            (this._state.customEdges || []).forEach(e => {
                const a = rectFor(e.from), b = rectFor(e.to);
                if (!a || !b) return;
                const p = bezier(a, b);
                const sel = e.id === this._state.selectedEdgeId;
                parts.push(`<path d="${p.d}" stroke="${sel ? '#ef4444' : '#f59e0b'}" stroke-width="${sel ? 3 : 2}" stroke-dasharray="7 5" fill="none" opacity="0.9" pointer-events="none"/>`);
                // pointer-events explícito: o svg pai tem pointer-events:none (herdado) — sem isso o clique atravessa
                parts.push(`<path d="${p.d}" stroke="transparent" stroke-width="14" fill="none" data-edge-id="${e.id}" pointer-events="stroke" style="cursor:pointer"/>`);
                if (sel) {
                    parts.push(`<g data-edge-del="${e.id}" pointer-events="auto" style="cursor:pointer">
                        <circle cx="${p.midX}" cy="${p.midY}" r="11" fill="#ef4444"/>
                        <text x="${p.midX}" y="${p.midY + 4.5}" text-anchor="middle" fill="#fff" font-size="14" font-weight="700">×</text>
                    </g>`);
                }
            });

            const totalW = Math.max(maxX + 60, 900);
            const totalH = Math.max(maxY + 60, 500);
            if (canvas) { canvas.style.width = totalW + 'px'; canvas.style.height = totalH + 'px'; }
            svg.setAttribute('width', totalW);
            svg.setAttribute('height', totalH);
            svg.innerHTML = parts.join('');

            svg.querySelectorAll('[data-edge-id]').forEach(pathEl => {
                pathEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._state.selectedEdgeId = pathEl.dataset.edgeId;
                    this._drawBoardEdges();
                });
            });
            svg.querySelectorAll('[data-edge-del]').forEach(g => {
                g.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._deleteCustomEdge(g.dataset.edgeDel);
                });
            });
        },

        _addCustomEdge(from, to) {
            const dup = (this._state.customEdges || []).some(e =>
                (e.from === from && e.to === to) || (e.from === to && e.to === from));
            if (dup) { if (typeof showToast === 'function') showToast('Esses nós já estão conectados', 'info'); return; }
            this._state.customEdges.push({ id: this._genId('edge'), from, to });
            try { this._persist(); } catch (err) {}
            if (typeof showToast === 'function') showToast('<i data-lucide="check" style="width:13px;height:13px;vertical-align:-2px"></i> Conexão criada', 'success');
        },

        _deleteCustomEdge(id) {
            this._state.customEdges = (this._state.customEdges || []).filter(e => e.id !== id);
            if (this._state.selectedEdgeId === id) this._state.selectedEdgeId = null;
            try { this._persist(); } catch (err) {}
            this._drawBoardEdges();
        },

        // ── Nós de funil (etapas/notas soltas no canvas) ──
        FUNNEL_KINDS: {
            topo:     { label: 'Topo de Funil',  icon: 'flame',        color: '#8b5cf6' },
            meio:     { label: 'Meio de Funil',  icon: 'filter',       color: '#6366f1' },
            fundo:    { label: 'Fundo de Funil', icon: 'crosshair',    color: '#3b82f6' },
            pagina:   { label: 'Página / LP',    icon: 'panel-top',    color: '#10b981' },
            checkout: { label: 'Checkout',       icon: 'credit-card',  color: '#f59e0b' },
            upsell:   { label: 'Upsell',         icon: 'trending-up',  color: '#ec4899' },
            nota:     { label: 'Nota',           icon: 'sticky-note',  color: '#eab308' },
        },

        _addFunnelNode(kind) {
            const k = this.FUNNEL_KINDS[kind] || this.FUNNEL_KINDS.nota;
            const id = this._genId('fn');
            const f = { id, kind, title: k.label, text: '' };
            this._state.funnelNodes.push(f);
            // Solta o nó no centro visível do viewport (compensa pan/zoom)
            const vp = document.getElementById('adh-board-viewport');
            const { zoom, tx, ty } = this._state.board;
            const cx = vp ? ((vp.clientWidth / 2 - tx) / zoom) : 300;
            const cy = vp ? ((vp.clientHeight / 2 - ty) / zoom) : 200;
            const jitter = (this._state.funnelNodes.length % 6) * 30;
            this._state.nodePos['funnel:' + id] = { x: Math.max(0, cx - 110 + jitter), y: Math.max(0, cy - 45 + jitter) };
            try { this._persist(); } catch (err) {}
            this._renderBoard();
            if (typeof showToast === 'function') showToast(`Nó "${k.label}" adicionado — arraste pra posicionar e use ⊕ pra conectar`, 'success');
        },

        _editFunnelNode(id) {
            const f = (this._state.funnelNodes || []).find(x => x.id === id);
            if (!f) return;
            const title = prompt('Título do nó:', f.title || '');
            if (title === null) return;
            const text = prompt('Descrição (opcional):', f.text || '');
            f.title = (title || '').trim() || f.title;
            if (text !== null) f.text = text.trim();
            try { this._persist(); } catch (err) {}
            this._renderBoard();
        },

        _deleteFunnelNode(id) {
            if (!confirm('Remover este nó do funil? (as conexões dele também somem)')) return;
            this._state.funnelNodes = (this._state.funnelNodes || []).filter(f => f.id !== id);
            const key = 'funnel:' + id;
            this._state.customEdges = (this._state.customEdges || []).filter(e => e.from !== key && e.to !== key);
            delete this._state.nodePos[key];
            try { this._persist(); } catch (err) {}
            this._renderBoard();
        },

        // ── Navegação cruzada: pula pro módulo certo já focado no item ──
        _goTab(tab, fn) {
            // Sair do mapa cancela modo conectar / seleção de aresta
            this._state.connectFrom = null;
            this._state.selectedEdgeId = null;
            document.getElementById('adh-board-viewport')?.classList.remove('adh-connecting');
            document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
            if (fn) setTimeout(fn, 320);
        },

        _followLink(link, type, id) {
            if (link === 'lista') {
                const prod = this._products().find(p => p.id === id);
                this._goTab('products', () => {
                    if (prod && typeof ProductsModule !== 'undefined' && ProductsModule.openForm) ProductsModule.openForm(prod);
                });
            } else if (link === 'pipeline') {
                const card = (typeof PipelineModule !== 'undefined' && PipelineModule.cards || []).find(c => c.productId === id);
                this._goTab('pipeline', () => {
                    if (card && PipelineModule.openModal) PipelineModule.openModal(card.columnId, card.id);
                });
            } else if (link === 'creatives') {
                this._goTab('creatives');
            } else if (link === 'launcher') {
                this._goTab('ad-launcher');
            } else if (link === 'adsmanager') {
                this._goTab('ads-manager');
            }
        },

        _renderBoardNode(n, w, h) {
            const item = n.item;
            const port = `<button class="adh-node-port" title="Conectar este nó a outro (funil)">⊕</button>`;

            // ── Nó de funil / nota (canvas livre) ──
            if (n.type === 'funnel') {
                const k = this.FUNNEL_KINDS[item.kind] || this.FUNNEL_KINDS.nota;
                return `<div class="adh-board-node adh-board-node-funnel"
                    data-type="funnel" data-id="${this._esc(item.id)}"
                    style="left:${n.x}px;top:${n.y}px;width:${w}px;min-height:${h}px;border-left:4px solid ${k.color}">
                    <div class="adh-board-node-hdr">
                        <i data-lucide="${k.icon}" style="width:12px;height:12px;color:${k.color}"></i>
                        <span class="adh-board-node-type" style="color:${k.color}">${k.label}</span>
                        <div class="adh-board-node-actions">
                            <button class="adh-funnel-del" title="Remover nó">×</button>
                        </div>
                    </div>
                    <div class="adh-board-node-body">
                        <div style="flex:1;min-width:0">
                            <div class="adh-board-node-title">${this._esc(item.title)}</div>
                            ${item.text ? `<div class="adh-board-node-meta adh-funnel-text">${this._esc(item.text)}</div>` : '<div class="adh-board-node-meta" style="opacity:.55">2× clique pra editar</div>'}
                        </div>
                    </div>
                    ${port}
                </div>`;
            }

            const selected = (n.type === 'product' && item.id === this._state.selectedProductId)
                || (n.type === 'campaign' && item.id === this._state.selectedCampaignId)
                || (n.type === 'adset' && item.id === this._state.selectedAdsetId)
                || (n.type === 'ad' && item.id === this._state.selectedAdId);
            const icons = { product:'package', campaign:'megaphone', adset:'target', ad:'image' };
            const labels = { product:'Produto', campaign:'Campanha', adset:'Conjunto', ad:'Criativo' };
            let status = (n.type === 'product') ? '' : (this._statusBadge(item.status) + (item.region ? this._regionBadge(item.region) : ''));
            if (n.type === 'ad') {
                if (item.status === 'ACTIVE' && !Number(item.impressions)) {
                    status += ' <span class="adh-status-badge adh-st-issues" title="Marcado como ativo, mas sem nenhuma impressão no relatório importado — pode ser rejeitado, em aprendizado ou com orçamento zerado">sem entrega</span>';
                }
                if (item._grupo && item._conjuntos > 1) {
                    status += ` <span class="adh-grp-badge" title="Este criativo roda em ${item._conjuntos} conjuntos — métricas somadas">${item._conjuntos} conjuntos</span>`;
                }
                const t = this._diasNoAr(item);
                if (t) {
                    status += ` <span class="adh-days-badge${t.paradoHa ? ' adh-days-stale' : ''}" title="Apareceu no relatório de ${this._fmtDia(item.firstSeen)} a ${this._fmtDia(t.ate)}${t.paradoHa ? ` — sem dados há ${t.paradoHa} dia(s)` : ''}">${t.dias}d no ar${t.paradoHa ? ` · parou há ${t.paradoHa}d` : ''}</span>`;
                }
            }
            const valid = item.validated ? '<i data-lucide="check-circle-2" style="width:13px;height:13px;color:#10b981" title="Validado"></i>' : '';
            const rank = (n.type === 'ad' && this._boardTopRank) ? this._boardTopRank.get(item.id) : null;
            const pior = this._boardRankDir === 'worst';
            const rankBadge = rank
                ? `<span class="adh-rank-badge${pior ? ' adh-rank-worst' : ''}" title="${rank}º ${pior ? 'PIOR' : 'melhor'} pela métrica selecionada">${rank}º${pior ? ' pior' : ''}</span>`
                : '';
            // Criativo expandido: imagem grande (ou placeholder)
            const midia = n.type === 'ad' ? this._mediaForCreative(item) : '';
            const adImage = n.type === 'ad'
                ? (midia
                    ? `<img class="adh-board-ad-img" src="${this._esc(midia)}" alt="">`
                    : `<div class="adh-board-ad-img adh-board-ad-noimg"><i data-lucide="image" style="width:32px;height:32px"></i></div>`)
                : '';

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

            // ── Chips de navegação cruzada (conecta com o resto da ferramenta) ──
            let links = '';
            if (n.type === 'product') {
                const nCreat = (typeof AppState !== 'undefined' && AppState.allCreatives || []).filter(c => c.productId === item.id).length;
                const hasPipe = !!((typeof PipelineModule !== 'undefined' && PipelineModule.cards || []).find(c => c.productId === item.id));
                links = `<div class="adh-node-links">
                    <button data-golink="lista" title="Abrir na Lista de produtos"><i data-lucide="list" style="width:11px;height:11px"></i></button>
                    ${hasPipe ? `<button data-golink="pipeline" title="Abrir card no Pipeline"><i data-lucide="git-branch" style="width:11px;height:11px"></i></button>` : ''}
                    <button data-golink="creatives" title="My Creatives (${nCreat} criativo${nCreat !== 1 ? 's' : ''} deste produto)"><i data-lucide="images" style="width:11px;height:11px"></i>${nCreat ? `<span class="adh-link-count">${nCreat}</span>` : ''}</button>
                    <button data-golink="launcher" title="Lançar ads (Ad Launcher)"><i data-lucide="rocket" style="width:11px;height:11px"></i></button>
                </div>`;
            } else if (n.type === 'campaign') {
                links = `<div class="adh-node-links">
                    <button data-golink="adsmanager" title="Ver métricas no Ads Manager"><i data-lucide="bar-chart-3" style="width:11px;height:11px"></i></button>
                </div>`;
            } else if (n.type === 'ad') {
                links = `<div class="adh-node-links">
                    <button data-golink="launcher" title="Lançar no Ad Launcher"><i data-lucide="rocket" style="width:11px;height:11px"></i></button>
                </div>`;
            }

            return `<div class="adh-board-node ${selected ? 'adh-board-node-selected' : ''} ${item.validated ? 'adh-board-node-validated' : ''} ${rank ? (pior ? 'adh-board-node-worst' : 'adh-board-node-top') : ''} adh-board-node-${n.type}"
                data-type="${n.type}" data-id="${this._esc(item.id)}"
                style="left:${n.x}px;top:${n.y}px;width:${w}px;min-height:${h}px">
                <div class="adh-board-node-hdr">
                    <i data-lucide="${icons[n.type]}" style="width:12px;height:12px"></i>
                    <span class="adh-board-node-type">${labels[n.type]}</span>
                    ${rankBadge}${valid}
                    <div class="adh-board-node-actions">
                        ${n.type !== 'product' ? `<button class="adh-board-validate" title="Marcar como validado">
                            <i data-lucide="${item.validated ? 'check-square' : 'square'}" style="width:13px;height:13px"></i>
                        </button>` : ''}
                        ${collapseBtn}
                    </div>
                </div>
                ${adImage}
                <div class="adh-board-node-body">
                    <div style="flex:1;min-width:0">
                        <div class="adh-board-node-title">${this._esc(item.name)}</div>
                        <div class="adh-board-node-meta">${status}</div>
                    </div>
                </div>
                ${this._funnelStripHtml(item)}
                ${links}
                ${port}
            </div>`;
        },

        // Faixa compacta do funil dentro do nó:  FB → Site → Carrinho → IC → Compra
        _funnelStripHtml(item) {
            const f = this._funnelOf(item);
            if (!f.temDados) return '';
            const money = (v, d = 2) => v == null ? '—' : (v < 1 ? v.toFixed(d) : v.toFixed(2));
            const pc = (v) => v == null ? '—' : (v >= 10 ? v.toFixed(0) : v.toFixed(1)) + '%';
            const num = (v) => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k' : String(Math.round(v));
            // etapa: rótulo curto, taxa e volume absoluto
            const etapa = (rot, taxa, vol, dica) =>
                `<div class="adh-fn-step" title="${this._esc(dica)}">
                    <span class="adh-fn-lbl">${rot}</span>
                    <span class="adh-fn-val">${taxa}</span>
                    <span class="adh-fn-vol">${vol}</span>
                </div>`;
            return `<div class="adh-fn-strip">
                <div class="adh-fn-head">
                    <span class="adh-fn-chip" title="Gasto no período">${money(f.spend)}</span>
                    <span class="adh-fn-chip" title="Custo por clique">CPC ${f.cpc == null ? '—' : money(f.cpc)}</span>
                    ${f.cpa != null ? `<span class="adh-fn-chip adh-fn-chip-cpa" title="Custo por compra">CPA ${money(f.cpa)}</span>` : ''}
                </div>
                <div class="adh-fn-row">
                    ${etapa('FB', pc(f.ctr), num(f.clicks), `CTR ${pc(f.ctr)} — ${num(f.impressions)} impressões geraram ${num(f.clicks)} cliques`)}
                    ${etapa('Site', pc(f.lpvRate), num(f.lpv), `${pc(f.lpvRate)} dos cliques viraram visita — ${num(f.lpv)} visitas`)}
                    ${etapa('Carr', pc(f.atcRate), num(f.atc), `${pc(f.atcRate)} das visitas adicionaram ao carrinho — ${num(f.atc)}`)}
                    ${etapa('IC', pc(f.icRate), num(f.ic), `${pc(f.icRate)} dos carrinhos iniciaram checkout — ${num(f.ic)}`)}
                    ${etapa('Compra', pc(f.purRate), num(f.purchases), `${pc(f.purRate)} dos checkouts viraram compra — ${num(f.purchases)} compras`)}
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
            // "Ajustar" = enquadrar o board inteiro na viewport (antes só zerava o zoom)
            const vp = document.getElementById('adh-board-viewport');
            const canvas = document.getElementById('adh-board-canvas');
            const cw = canvas ? parseFloat(canvas.style.width) || canvas.scrollWidth : 0;
            const ch = canvas ? parseFloat(canvas.style.height) || canvas.scrollHeight : 0;
            if (!vp || !cw || !ch) {
                this._state.board.zoom = 1; this._state.board.tx = 0; this._state.board.ty = 0;
                this._applyBoardTransform();
                return;
            }
            // O board é VERTICAL: enquadrar a altura toda daria 20% (ilegível).
            // Enquadra pela LARGURA e nunca abaixo de 45% — o resto se navega rolando/arrastando.
            const cabeTudo = Math.min(vp.clientWidth / cw, vp.clientHeight / ch) * 0.95;
            const z = cabeTudo >= 0.45
                ? Math.min(1, cabeTudo)
                : Math.max(0.45, Math.min(1, (vp.clientWidth / cw) * 0.95));
            this._state.board.zoom = z;
            this._state.board.tx = Math.max(0, (vp.clientWidth - cw * z) / 2);
            this._state.board.ty = 20;   // encosta no topo: o board é vertical
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
            let propagados = 0;
            if (level === 'ad') {
                // Imagem e "validado" valem pro CRIATIVO (nome), não só pra este nó
                propagados = this._propagarCriativo(item, {
                    imagem: this._editingImage !== null ? this._editingImage : undefined,
                    validado: item.validated,
                });
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
            if (typeof showToast === 'function') {
                showToast(propagados > 1
                    ? `Salvo e aplicado em ${propagados} conjuntos que rodam "${item.name}"`
                    : 'Item salvo', 'success');
            }
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
            // Atalhos pros outros módulos (mesmos chips do board)
            let links = '';
            if (selectedProductId && selectedProductId !== '__unassigned__') {
                const nCreat = (typeof AppState !== 'undefined' && AppState.allCreatives || []).filter(c => c.productId === selectedProductId).length;
                const hasPipe = !!((typeof PipelineModule !== 'undefined' && PipelineModule.cards || []).find(c => c.productId === selectedProductId));
                links = `<div class="adh-node-links" style="margin-left:auto">
                    <button data-golink="lista" title="Abrir na Lista"><i data-lucide="list" style="width:11px;height:11px"></i> Lista</button>
                    ${hasPipe ? `<button data-golink="pipeline" title="Card no Pipeline"><i data-lucide="git-branch" style="width:11px;height:11px"></i> Pipeline</button>` : ''}
                    <button data-golink="creatives" title="My Creatives"><i data-lucide="images" style="width:11px;height:11px"></i> Criativos${nCreat ? ` (${nCreat})` : ''}</button>
                    <button data-golink="launcher" title="Ad Launcher"><i data-lucide="rocket" style="width:11px;height:11px"></i> Lançar</button>
                    <button data-golink="adsmanager" title="Ads Manager"><i data-lucide="bar-chart-3" style="width:11px;height:11px"></i> Ads Manager</button>
                </div>`;
            }
            panel.style.display = '';
            panel.innerHTML = `<div class="adh-breadcrumbs" style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap">${parts.join('<i data-lucide="chevron-right" style="width:12px;height:12px;opacity:0.5"></i>')}${links}</div>`;
            panel.querySelectorAll('[data-golink]').forEach(chip => {
                chip.addEventListener('click', () => this._followLink(chip.dataset.golink, 'product', selectedProductId));
            });
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
