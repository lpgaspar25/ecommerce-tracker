/* ===========================
   Mining Module — Facebook Ad Library Mining
   Searches, displays, and bulk-saves ads to SwipeModule
   =========================== */

const MiningModule = {
    _PROXY_URL: 'https://swipe-media-proxy.lucasmedia.workers.dev',
    _results: [],
    _selected: new Set(),
    _isMining: false,

    init() {
        this._bindEvents();
    },

    _bindEvents() {
        document.getElementById('btn-mine')?.addEventListener('click', () => this._startMining());
        document.getElementById('mining-select-all')?.addEventListener('change', (e) => this._toggleSelectAll(e.target.checked));
        document.getElementById('btn-mine-save-bulk')?.addEventListener('click', () => this._saveBulkToSwipe());
        document.getElementById('mining-keyword')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._startMining(); });

        // Post-mining filters
        document.getElementById('mining-filter-page')?.addEventListener('change', () => this._applyPostFilters());
        document.getElementById('mining-filter-type')?.addEventListener('change', () => this._applyPostFilters());

        // Mode toggle — show/hide cookie bar
        document.getElementById('mining-mode')?.addEventListener('change', (e) => {
            const bar = document.getElementById('mining-cookie-bar');
            if (bar) bar.style.display = e.target.value === 'scroll' ? 'flex' : 'none';
        });

        // Cookie help
        document.getElementById('mining-cookie-help')?.addEventListener('click', (e) => {
            e.preventDefault();
            alert('Como obter o cookie do Facebook:\n\n1. Abra o Facebook no navegador e faça login\n2. Pressione F12 → aba Application → Cookies → facebook.com\n3. Copie os valores de "c_user" e "xs"\n4. Cole aqui no formato: c_user=VALOR; xs=VALOR\n\nOu use uma extensão como "EditThisCookie" para exportar.');
        });

        // Load saved cookie
        const savedCookie = localStorage.getItem('mining_fb_cookie') || '';
        const cookieInput = document.getElementById('mining-fb-cookie');
        if (cookieInput && savedCookie) cookieInput.value = savedCookie;
    },

    async _startMining() {
        if (this._isMining) return;

        const keyword = document.getElementById('mining-keyword')?.value?.trim();
        if (!keyword) { showToast('Digite uma palavra-chave para minerar.', 'error'); return; }

        const country = document.getElementById('mining-country')?.value || 'BR';
        const language = document.getElementById('mining-language')?.value || '';
        const mediaType = document.getElementById('mining-media-type')?.value || 'all';
        const activeStatus = document.getElementById('mining-status')?.value || 'active';
        const minResults = parseInt(document.getElementById('mining-min-results')?.value) || 20;
        const minSets = parseInt(document.getElementById('mining-min-sets')?.value) || 1;
        const dateFrom = document.getElementById('mining-date-from')?.value || '';
        const dateTo = document.getElementById('mining-date-to')?.value || '';
        const mode = document.getElementById('mining-mode')?.value || 'variations';

        this._isMining = true;
        this._results = [];
        this._allFetched = [];
        this._selected = new Set();
        this._stopRequested = false;
        this._renderGrid();

        const btn = document.getElementById('btn-mine');
        if (btn) { btn.disabled = false; btn.textContent = '⏹️ Parar'; btn.onclick = () => { this._stopRequested = true; }; }

        const seenIds = new Set();
        let totalAvailable = 0;
        let totalBatches = 0;
        let emptyBatches = 0;
        const maxBatches = 100;

        // ── SCROLL MODE: Direct GraphQL from user's browser (uses FB session) ──
        if (mode === 'scroll') {
            // Step 1: Open Facebook Ad Library in a hidden iframe to get session tokens
            this._showStatus('🔄 Conectando ao Facebook... Você precisa estar logado no Facebook neste navegador.', 'loading');

            const GQL_URL = 'https://www.facebook.com/api/graphql/';
            const QUERY_ID = '25788260324159216';
            let fbDtsg = '';
            let nextCursor = null;

            // Try to get fb_dtsg by fetching the ad library page via our proxy
            // (without cookies — the initial page HTML includes a public queryID)
            // The GraphQL endpoint needs fb_dtsg which we get from the initial page
            try {
                const initResp = await fetch(`${this._PROXY_URL}/?action=search&q=${encodeURIComponent(keyword)}&country=${country}&media_type=${mediaType}&active_status=${activeStatus}&batch=0${language ? '&language=' + language : ''}&date_to=${dateTo || ''}`,
                    { signal: AbortSignal.timeout(30000) });
                const initData = await initResp.json();

                // Use the initial search results as page 0
                const rawAds = initData.ads || [];
                for (const ad of rawAds) {
                    if (!seenIds.has(ad.adId)) { seenIds.add(ad.adId); this._allFetched.push(ad); }
                }
                if (initData.total > totalAvailable) totalAvailable = initData.total;
                totalBatches++;

                // Get cursor and tokens from the proxy (ask Worker to return them)
                nextCursor = initData.nextCursor || null;
                fbDtsg = initData.fbDtsg || '';
            } catch (e) {
                console.warn('[Mining] Initial fetch error:', e.message);
            }

            // Step 2: Paginate using cursor via Worker (sends GraphQL from Worker IP)
            // The Worker uses facebookexternalhit UA which doesn't need cookies for page 1
            // but needs cursor for subsequent pages
            while (!this._stopRequested) {
                const filtered = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
                if (filtered.length >= minResults && totalBatches > 0) break;
                if (emptyBatches >= 5) break;

                this._showStatus(`🔄 Scroll página ${totalBatches + 1}... (${this._allFetched.length} analisados, ${filtered.length} encontrados)`, 'loading');

                try {
                    // Use different batch suffixes to get different results
                    const batchIdx = totalBatches;
                    const params = new URLSearchParams({
                        action: 'search', q: keyword, country, media_type: mediaType,
                        active_status: activeStatus, batch: batchIdx,
                    });
                    if (language) params.set('language', language);
                    if (dateTo) params.set('date_to', dateTo);
                    if (dateFrom) params.set('date_from', dateFrom);

                    const resp = await fetch(`${this._PROXY_URL}/?${params}`, { signal: AbortSignal.timeout(30000) });
                    const data = await resp.json();

                    const rawAds = data.ads || [];
                    let addedNew = 0;
                    for (const ad of rawAds) {
                        if (!seenIds.has(ad.adId)) { seenIds.add(ad.adId); this._allFetched.push(ad); addedNew++; }
                    }
                    if (data.total > totalAvailable) totalAvailable = data.total;

                    totalBatches++;

                    // Only count truly empty batches (Worker returned 0 total ads)
                    if (rawAds.length === 0) {
                        emptyBatches++;
                    } else if (addedNew === 0) {
                        emptyBatches += 0.34; // Slow accumulation for duplicate batches
                    } else {
                        emptyBatches = 0;
                    }
                } catch (err) {
                    console.warn(`[Mining] Scroll batch ${totalBatches} error:`, err.message);
                    totalBatches++;
                    emptyBatches++;
                }

                this._results = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
                try { this._renderGrid(); this._updateBulkBar(); } catch {}
                await new Promise(r => setTimeout(r, 100));
            }

            // After exhausting keyword variations, try page-name deep mining
            if (!this._stopRequested) {
                const filtered = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
                if (filtered.length < minResults) {
                    this._showStatus(`🔄 Mineração profunda por anunciante... (${this._allFetched.length} analisados, ${filtered.length} encontrados)`, 'loading');

                    // Collect unique page IDs
                    const pageMap = {};
                    for (const ad of this._allFetched) {
                        if (ad.pageId && !pageMap[ad.pageId]) pageMap[ad.pageId] = ad.pageName || ad.pageId;
                    }
                    const pageIds = Object.keys(pageMap);

                    // Batch page IDs in groups of 3
                    for (let i = 0; i < pageIds.length && !this._stopRequested; i += 3) {
                        const batch = pageIds.slice(i, i + 3);
                        try {
                            const params = new URLSearchParams({
                                action: 'paginate', page_ids: batch.join(','),
                                country, media_type: mediaType, active_status: activeStatus,
                            });
                            const resp = await fetch(`${this._PROXY_URL}/?${params}`, { signal: AbortSignal.timeout(30000) });
                            const data = await resp.json();
                            for (const ad of (data.ads || [])) {
                                if (!seenIds.has(ad.adId)) { seenIds.add(ad.adId); this._allFetched.push(ad); }
                            }
                        } catch {}

                        this._results = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
                        if (this._results.length >= minResults) break;
                        try { this._renderGrid(); this._updateBulkBar(); } catch {}
                        await new Promise(r => setTimeout(r, 50));
                    }
                }
            }

            // Final
            this._results = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
            const setsMsg = minSets > 1 ? ` com ≥ ${minSets}x anúncios por criativo` : '';
            const avMsg = totalAvailable > 0 ? ` (${totalAvailable.toLocaleString('pt-BR')} na biblioteca)` : '';
            if (this._results.length >= minResults) {
                this._showStatus(`✅ ${this._results.length} criativos encontrados! ${this._allFetched.length} analisados em ${totalBatches} lotes${setsMsg}${avMsg}.`, 'ok');
            } else {
                this._showStatus(`⚠️ ${this._results.length} de ${minResults} desejados${setsMsg}. ${this._allFetched.length} analisados em ${totalBatches} lotes${avMsg}.`, 'warn');
            }
            this._renderGrid(); this._updateBulkBar();
            this._isMining = false; this._stopRequested = false;
            if (btn) { btn.disabled = false; btn.textContent = '🔍 Minerar'; btn.onclick = () => this._startMining(); }
            this._updatePostFilters();
            return;
        }

        // ── PAGINATION MODE: fetch by individual page_ids ──
        if (mode === 'pagination') {
            // Step 1: Initial keyword search to discover page_ids
            this._showStatus(`⛏️ Descobrindo anunciantes para "${keyword}"...`, 'loading');
            try {
                const initParams = new URLSearchParams({
                    action: 'search', q: keyword, country, media_type: mediaType,
                    active_status: activeStatus, batch: '0',
                });
                if (language) initParams.set('language', language);
                const initResp = await fetch(`${this._PROXY_URL}/?${initParams}`, { signal: AbortSignal.timeout(45000) });
                const initData = await initResp.json();
                if (initData.error) throw new Error(initData.error);

                // Collect initial ads
                for (const ad of (initData.ads || [])) {
                    if (!seenIds.has(ad.adId)) { seenIds.add(ad.adId); this._allFetched.push(ad); }
                }
                if (initData.totalAvailable > totalAvailable) totalAvailable = initData.totalAvailable;

                // Get unique page_ids
                const allPageIds = [...new Set((initData.pageIds || []).concat(
                    this._allFetched.map(a => a.pageId).filter(Boolean)
                ))];

                this._showStatus(`⛏️ ${allPageIds.length} anunciantes encontrados. Buscando ads de cada um...`, 'loading');
                this._results = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
                this._renderGrid();
                this._updateBulkBar();
                await new Promise(r => setTimeout(r, 50));

                // Step 2: Fetch ads from each page_id in batches of 6
                for (let i = 0; i < allPageIds.length && !this._stopRequested; i += 6) {
                    const batch = allPageIds.slice(i, i + 6);
                    const filtered = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
                    if (filtered.length >= minResults) break;

                    this._showStatus(`⛏️ Paginação ${Math.floor(i/6)+1}/${Math.ceil(allPageIds.length/6)} — ${this._allFetched.length} ads (${filtered.length} encontrados)`, 'loading');

                    try {
                        const pgParams = new URLSearchParams({
                            action: 'paginate', page_ids: batch.join(','),
                            country, media_type: mediaType, active_status: activeStatus,
                        });
                        const pgResp = await fetch(`${this._PROXY_URL}/?${pgParams}`, { signal: AbortSignal.timeout(30000) });
                        const pgData = await pgResp.json();

                        for (const ad of (pgData.ads || [])) {
                            if (!seenIds.has(ad.adId)) { seenIds.add(ad.adId); this._allFetched.push(ad); }
                        }
                    } catch (e) { console.warn('[Mining] Paginate batch error:', e.message); }

                    this._results = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
                    try { this._renderGrid(); this._updateBulkBar(); } catch {}
                    await new Promise(r => setTimeout(r, 50));
                }
            } catch (e) {
                console.error('[Mining] Pagination error:', e.message);
            }

            // Show final results
            this._results = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
            const setsMsg = minSets > 1 ? ` com ≥ ${minSets}x anúncios por criativo` : '';
            const avMsg = totalAvailable > 0 ? ` (${totalAvailable.toLocaleString('pt-BR')} na biblioteca)` : '';
            if (this._results.length >= minResults) {
                this._showStatus(`✅ ${this._results.length} criativos encontrados${setsMsg}! ${this._allFetched.length} analisados via paginação${avMsg}.`, 'ok');
            } else {
                this._showStatus(`⚠️ ${this._results.length} de ${minResults} desejados${setsMsg}. ${this._allFetched.length} analisados via paginação${avMsg}.`, 'warn');
            }
            this._renderGrid();
            this._updateBulkBar();
            this._isMining = false;
            this._stopRequested = false;
            if (btn) { btn.disabled = false; btn.textContent = '🔍 Minerar'; btn.onclick = () => this._startMining(); }
            this._updatePostFilters();
            return;
        }

        // ── VARIATIONS MODE (default) ──
        while (totalBatches < maxBatches) {
            try {
                const filtered = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
                if (this._stopRequested) break;
                if (filtered.length >= minResults && totalBatches > 0) break;
                if (emptyBatches >= 5) break;

                this._showStatus(`⛏️ Minerando "${keyword}" — lote ${totalBatches + 1}... (${this._allFetched.length} analisados, ${filtered.length} encontrados)`, 'loading');

                const params = new URLSearchParams({
                    action: 'search', q: keyword, country, media_type: mediaType,
                    active_status: activeStatus, min_results: String(minResults),
                    batch: String(totalBatches),
                });
                if (dateFrom) params.set('date_from', dateFrom);
                if (dateTo) params.set('date_to', dateTo);
                if (language) params.set('language', language);

                const resp = await fetch(`${this._PROXY_URL}/?${params}`, { signal: AbortSignal.timeout(45000) });
                const data = await resp.json();
                if (data.error) throw new Error(data.error);

                const rawAds = data.ads || [];
                if (data.totalAvailable > totalAvailable) totalAvailable = data.totalAvailable;

                let addedNew = 0;
                for (const ad of rawAds) {
                    if (!seenIds.has(ad.adId)) { seenIds.add(ad.adId); this._allFetched.push(ad); addedNew++; }
                }

                totalBatches++;
                if (rawAds.length === 0 && !nextCursor) emptyBatches++; else emptyBatches = 0;

            } catch (err) {
                console.warn(`[Mining] Page ${totalBatches} error:`, err.message);
                totalBatches++;
                emptyBatches++;
            }

            // Update UI between batches (outside try/catch, errors here won't stop mining)
            try {
                this._results = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
                this._renderGrid();
                this._updateBulkBar();
            } catch(e) { /* ignore render errors */ }

            // Yield to browser
            await new Promise(r => setTimeout(r, 50));
        }

        // Final render
        this._results = this._allFetched.filter(ad => minSets <= 1 || ad.collationCount >= minSets);
        const availableMsg = totalAvailable > 0 ? ` (${totalAvailable.toLocaleString('pt-BR')} na biblioteca)` : '';
        const setsMsg = minSets > 1 ? ` com ≥ ${minSets}x anúncios por criativo` : '';

        if (this._results.length === 0 && this._allFetched.length > 0) {
            this._showStatus(`⚠️ ${this._allFetched.length} criativos analisados em ${totalBatches} lotes${availableMsg}, nenhum${setsMsg}. Reduza o filtro.`, 'warn');
        } else if (this._results.length === 0) {
            this._showStatus('⚠️ Nenhum anúncio encontrado. Tente outra palavra-chave ou país.', 'warn');
        } else if (this._results.length < minResults) {
            this._showStatus(`⚠️ ${this._results.length} de ${minResults} desejados${setsMsg}. ${this._allFetched.length} analisados em ${totalBatches} lotes${availableMsg}.`, 'warn');
        } else {
            this._showStatus(`✅ ${this._results.length} criativos encontrados${setsMsg}! ${this._allFetched.length} analisados em ${totalBatches} lotes${availableMsg}.`, 'ok');
        }

        this._renderGrid();
        this._updateBulkBar();
        this._isMining = false;
        this._stopRequested = false;
        if (btn) { btn.disabled = false; btn.textContent = '🔍 Minerar'; btn.onclick = () => this._startMining(); }
        this._updatePostFilters();
    },

    // ── Post-mining filters ──────────────────────────────────────────────

    _updatePostFilters() {
        const bar = document.getElementById('mining-post-filters');
        const pageSelect = document.getElementById('mining-filter-page');
        if (!bar || !pageSelect) return;

        if (this._results.length === 0) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';

        // Build page options from current results, sorted by count desc
        const pageCounts = {};
        for (const ad of this._results) {
            const key = ad.pageName || 'Desconhecido';
            pageCounts[key] = (pageCounts[key] || 0) + 1;
        }
        const sorted = Object.entries(pageCounts).sort((a, b) => b[1] - a[1]);

        const currentVal = pageSelect.value;
        pageSelect.innerHTML = `<option value="">Todas páginas (${sorted.length})</option>`;
        for (const [name, count] of sorted) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = `${name} (${count})`;
            pageSelect.appendChild(opt);
        }
        pageSelect.value = currentVal;
    },

    _applyPostFilters() {
        const pageFilter = document.getElementById('mining-filter-page')?.value || '';
        const typeFilter = document.getElementById('mining-filter-type')?.value || '';
        const countEl = document.getElementById('mining-filter-count');
        const minSets = parseInt(document.getElementById('mining-min-sets')?.value) || 1;

        // Start from allFetched, apply collation filter, then post-filters
        let filtered = (this._allFetched || []).filter(ad => minSets <= 1 || ad.collationCount >= minSets);

        if (pageFilter) filtered = filtered.filter(ad => ad.pageName === pageFilter);
        if (typeFilter) filtered = filtered.filter(ad => ad.mediaType === typeFilter);

        this._results = filtered;
        this._selected = new Set();
        this._renderGrid();
        this._updateBulkBar();

        if (countEl) countEl.textContent = `${filtered.length} resultados`;
    },

    _showStatus(msg, type) {
        const el = document.getElementById('mining-status-msg');
        if (!el) return;
        el.style.display = 'block';
        el.textContent = msg;
        el.className = 'mining-status-msg mining-status-' + type;
    },

    _renderGrid() {
        const grid = document.getElementById('mining-grid');
        if (!grid) return;

        if (this._results.length === 0) {
            grid.innerHTML = '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;padding:3rem 0">Nenhum resultado. Use os filtros acima para minerar anúncios.</p>';
            return;
        }

        grid.innerHTML = this._results.map((ad, i) => this._renderCard(ad, i)).join('');

        // Bind card events
        grid.querySelectorAll('.mining-card-check').forEach(cb => {
            cb.addEventListener('change', () => this._onCardCheckChange(cb.dataset.idx, cb.checked));
        });
        grid.querySelectorAll('.mining-save-one').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this._saveOneToSwipe(parseInt(btn.dataset.idx)); });
        });
        grid.querySelectorAll('.mining-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.mining-card-check-wrap') || e.target.closest('.mining-save-one')) return;
                const idx = parseInt(card.dataset.idx);
                this._openPreview(idx);
            });
        });
    },

    _renderCard(ad, idx) {
        const thumb = ad.thumbnail || '';
        const pageName = ad.pageName || `Ad #${ad.adId}`;
        const linkTitle = (ad.linkTitles && ad.linkTitles[0]) ? ad.linkTitles[0] : '';
        const body = (ad.bodyTexts && ad.bodyTexts[0]) ? ad.bodyTexts[0] : '';
        const bodySnippet = body.length > 100 ? body.slice(0, 100) + '...' : body;
        const isSelected = this._selected.has(idx);
        const mediaIcon = ad.mediaType === 'video' ? '🎬' : '🖼️';
        const date = ad.startDate || '';
        const alreadySaved = this._isAlreadySaved(ad.adId);

        return `
        <div class="mining-card swipe-card ${isSelected ? 'mining-card-selected' : ''}" data-idx="${idx}">
            <div class="swipe-card-thumb" style="background-image:url('${thumb}');background-color:var(--hover-bg)">
                <div class="mining-card-check-wrap">
                    <input type="checkbox" class="mining-card-check" data-idx="${idx}" ${isSelected ? 'checked' : ''}>
                </div>
                <div class="swipe-card-badges">
                    <span class="swipe-format-chip">${mediaIcon} ${ad.mediaType || '?'}</span>
                    ${ad.isActive ? '<span class="swipe-platform-chip" style="background:#059669">Ativo</span>' : ''}
                    ${ad.collationCount > 1 ? `<span class="swipe-platform-chip" style="background:#7c3aed">${ad.collationCount}x anúncios</span>` : ''}
                </div>
            </div>
            <div class="swipe-card-body">
                <p class="swipe-card-author">${this._esc(pageName)}</p>
                ${linkTitle ? `<p class="mining-card-title">${this._esc(linkTitle)}</p>` : ''}
                ${bodySnippet ? `<p class="swipe-card-hook">${this._esc(bodySnippet)}</p>` : ''}
                <div class="swipe-card-footer">
                    <span class="swipe-card-date">${date || 'Sem data'}</span>
                    <div class="swipe-card-actions">
                        ${alreadySaved
                            ? '<span class="swipe-action-btn" style="border-color:var(--success);color:var(--success)" title="Já salvo">✅</span>'
                            : `<button class="swipe-action-btn mining-save-one" data-idx="${idx}" title="Salvar no Swipe File">💾</button>`
                        }
                    </div>
                </div>
            </div>
        </div>`;
    },

    _isAlreadySaved(adId) {
        if (typeof SwipeModule === 'undefined') return false;
        return SwipeModule._entries.some(e => e.url && e.url.includes(adId));
    },

    _onCardCheckChange(idx, checked) {
        idx = parseInt(idx);
        if (checked) this._selected.add(idx);
        else this._selected.delete(idx);
        this._updateBulkBar();

        // Visual feedback
        const card = document.querySelector(`.mining-card[data-idx="${idx}"]`);
        if (card) card.classList.toggle('mining-card-selected', checked);
    },

    _toggleSelectAll(checked) {
        this._selected.clear();
        if (checked) {
            this._results.forEach((_, i) => this._selected.add(i));
        }
        document.querySelectorAll('.mining-card-check').forEach(cb => { cb.checked = checked; });
        document.querySelectorAll('.mining-card').forEach(card => {
            card.classList.toggle('mining-card-selected', checked);
        });
        this._updateBulkBar();
    },

    _updateBulkBar() {
        const bar = document.getElementById('mining-bulk-bar');
        const countEl = document.getElementById('mining-selected-count');
        const saveBtn = document.getElementById('btn-mine-save-bulk');
        const selectAllCb = document.getElementById('mining-select-all');

        if (bar) bar.style.display = this._results.length > 0 ? 'flex' : 'none';
        if (countEl) countEl.textContent = `${this._selected.size} selecionados`;
        if (saveBtn) {
            saveBtn.disabled = this._selected.size === 0;
            saveBtn.textContent = `💾 Salvar ${this._selected.size} no Swipe`;
        }
        if (selectAllCb) selectAllCb.checked = this._selected.size === this._results.length && this._results.length > 0;
    },

    _saveOneToSwipe(idx) {
        const ad = this._results[idx];
        if (!ad) return;

        this._addToSwipe([ad]);
        showToast(`Salvo: ${ad.pageName || 'Ad #' + ad.adId}`, 'success');

        // Re-render to update saved status
        this._renderGrid();
    },

    _saveBulkToSwipe() {
        if (this._selected.size === 0) return;

        const ads = [...this._selected].map(i => this._results[i]).filter(Boolean);
        this._addToSwipe(ads);

        showToast(`${ads.length} anúncios salvos no Swipe File!`, 'success');
        this._selected.clear();
        document.getElementById('mining-select-all').checked = false;
        this._renderGrid();
        this._updateBulkBar();
    },

    _addToSwipe(ads) {
        if (typeof SwipeModule === 'undefined') {
            showToast('SwipeModule não disponível', 'error');
            return;
        }

        const existing = SwipeModule._entries || [];

        for (const ad of ads) {
            // Skip if already saved
            if (existing.some(e => e.url && e.url.includes(ad.adId))) continue;

            const entry = {
                id: 'swipe_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                url: ad.url || `https://www.facebook.com/ads/library/?id=${ad.adId}`,
                platform: 'facebook',
                title: (ad.linkTitles?.[0]) || (ad.pageName || 'Facebook Ad') + (ad.adId ? ` — Ad #${ad.adId}` : ''),
                author: ad.pageName || 'Facebook Ads Library',
                date: ad.startDate || new Date().toISOString().slice(0, 10),
                format: ad.mediaType === 'video' ? 'video' : 'imagem',
                type: '',
                tags: ['mineracao', 'facebook-ads'],
                notes: (ad.bodyTexts && ad.bodyTexts[0]) || '',
                transcript_orig: '',
                transcript_pt: '',
                hook_orig: '',
                body_orig: (ad.bodyTexts && ad.bodyTexts[0]) || '',
                cta_orig: (ad.linkTitles && ad.linkTitles[0]) || '',
                hook_pt: '',
                body_pt: '',
                cta_pt: '',
                thumbnail: ad.thumbnail || '',
                videoUrl: ad.videoUrl || '',
                embedHtml: '',
                driveVideoUrl: '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            SwipeModule._entries.unshift(entry);
        }

        SwipeModule._persist();

        // Also re-render swipe grid if currently visible
        if (typeof SwipeModule._renderGrid === 'function') {
            try { SwipeModule._renderGrid(); } catch {}
        }
    },

    _openPreview(idx) {
        const ad = this._results[idx];
        if (!ad) return;

        // Remove existing preview modal
        document.getElementById('mining-preview-modal')?.remove();

        const body = (ad.bodyTexts && ad.bodyTexts[0]) || '';
        const linkTitle = (ad.linkTitles && ad.linkTitles[0]) || '';
        const pageName = ad.pageName || `Ad #${ad.adId}`;

        let mediaHtml = '';
        if (ad.videoUrl) {
            mediaHtml = `<video controls autoplay playsinline style="width:100%;max-height:70vh;border-radius:8px;background:#000" src="${ad.videoUrl}"></video>`;
        } else if (ad.thumbnail) {
            mediaHtml = `<img src="${ad.thumbnail}" style="width:100%;border-radius:8px" alt="Ad preview">`;
        }

        const modal = document.createElement('div');
        modal.id = 'mining-preview-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width:600px;max-height:92vh;overflow-y:auto">
                <div class="modal-header">
                    <h3>${this._esc(pageName)}</h3>
                    <button class="btn-close" id="mining-preview-close">&times;</button>
                </div>
                <div style="padding:1rem">
                    ${mediaHtml}
                    ${linkTitle ? `<p style="margin-top:0.75rem;font-weight:700;font-size:0.9rem;color:var(--text-primary)">${this._esc(linkTitle)}</p>` : ''}
                    ${body ? `<p style="margin-top:0.4rem;font-size:0.85rem;color:var(--text-secondary);line-height:1.5;white-space:pre-wrap">${this._esc(body)}</p>` : ''}
                    ${ad.collationCount > 1 ? `<p style="margin-top:0.5rem;font-size:0.78rem;font-weight:600;color:#7c3aed">📊 ${ad.collationCount}x anúncios usam este criativo</p>` : ''}
                    <div style="display:flex;gap:0.5rem;margin-top:1rem;flex-wrap:wrap">
                        <a href="${ad.url}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">🔗 Ver na Biblioteca</a>
                        <button class="btn btn-primary btn-sm" id="mining-preview-save">💾 Salvar no Swipe</button>
                    </div>
                    ${ad.startDate ? `<p style="margin-top:0.5rem;font-size:0.72rem;color:var(--text-muted)">Início: ${ad.startDate} · ${(ad.platforms||[]).join(', ') || 'Facebook'}</p>` : ''}
                </div>
            </div>`;

        document.body.appendChild(modal);

        // Events
        modal.querySelector('#mining-preview-close').addEventListener('click', () => this._closePreview());
        modal.querySelector('.modal-overlay').addEventListener('click', () => this._closePreview());
        modal.querySelector('#mining-preview-save')?.addEventListener('click', () => {
            this._saveOneToSwipe(idx);
            this._closePreview();
        });
    },

    _closePreview() {
        const m = document.getElementById('mining-preview-modal');
        if (m) {
            // Pause video
            m.querySelector('video')?.pause();
            m.remove();
        }
    },

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    },
};
