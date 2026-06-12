/* ===========================
   Creatives.js — Creative management, metrics tracking, fatigue detection
   Ad text variations (headline, description, primary text)
   Test tracking with validation workflow
   =========================== */

const CreativesModule = {
    STORAGE_KEY_CREATIVES: 'etracker_creatives',
    STORAGE_KEY_METRICS: 'etracker_creative_metrics',

    CREATIVE_TYPES: ['UGC', 'Demonstrativo', 'POV', 'Imagem', 'Carrossel', 'Before/After', 'Meme', 'Review'],
    HOOK_TYPES: ['Pergunta', 'Choque', 'Curiosidade', 'POV', 'Antes/Depois', 'Dor', 'Desejo', 'Autoridade'],
    STATUSES: [
        { id: 'ativo', label: 'Ativo', color: 'var(--blue)' },
        { id: 'pausado', label: 'Pausado', color: 'var(--text-muted)' },
        { id: 'winner', label: 'Winner', color: 'var(--green)' },
        { id: 'killed', label: 'Killed', color: 'var(--red)' },
        { id: 'teste', label: 'Em Teste', color: 'var(--orange)' }
    ],

    init() {
        document.getElementById('btn-add-creative')?.addEventListener('click', () => this.openForm());
        document.getElementById('creative-form')?.addEventListener('submit', (e) => this.handleSubmit(e));
        document.getElementById('creative-cancel')?.addEventListener('click', () => closeModal('creative-modal'));
        document.getElementById('metric-form')?.addEventListener('submit', (e) => this.handleMetricSubmit(e));
        document.getElementById('metric-cancel')?.addEventListener('click', () => closeModal('metric-modal'));
        document.getElementById('creative-product-filter')?.addEventListener('change', () => this.render());
        document.getElementById('creative-status-filter')?.addEventListener('change', () => this.render());
        document.getElementById('creative-campaign-filter')?.addEventListener('change', () => this.render());
        document.getElementById('creative-country-filter')?.addEventListener('change', () => this.render());
        document.getElementById('creative-group-by')?.addEventListener('change', () => this.render());

        // Media upload (foto/vídeo) in the creative form
        document.getElementById('creative-media-pick')?.addEventListener('click', () => document.getElementById('creative-media-input')?.click());
        document.getElementById('creative-media-input')?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) this._handleMediaFile(f);
            e.target.value = '';
        });
        // Product change inside the form → refresh campaign suggestions + country guess
        document.getElementById('creative-product')?.addEventListener('change', () => this._refreshFormCampaignList());

        // CSV import
        document.getElementById('btn-import-creatives')?.addEventListener('click', () => document.getElementById('creative-csv-input')?.click());
        document.getElementById('creative-csv-input')?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) this.importCsv(f);
            e.target.value = '';
        });
        document.getElementById('btn-creative-csv-template')?.addEventListener('click', () => this.downloadCsvTemplate());

        // Quick-view lightbox
        document.getElementById('creative-lightbox-close')?.addEventListener('click', () => this.closeLightbox());
        document.getElementById('creative-media-lightbox')?.addEventListener('click', (e) => {
            if (e.target.id === 'creative-media-lightbox') this.closeLightbox();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('creative-media-lightbox')?.style.display === 'flex') this.closeLightbox();
        });

        // Test variation form
        document.getElementById('variation-form')?.addEventListener('submit', (e) => this.handleVariationSubmit(e));
        document.getElementById('variation-cancel')?.addEventListener('click', () => closeModal('variation-modal'));

        // Comparison
        document.getElementById('btn-compare-creatives')?.addEventListener('click', () => this.toggleCompareMode());

        EventBus.on('dataLoaded', () => this.render());
        EventBus.on('creativesChanged', () => this.render());
        EventBus.on('storeChanged', () => this.render());
    },

    // ---- Data Access ----
    getCreatives() {
        return AppState.creatives || [];
    },

    getCreativeMetrics() {
        return AppState.creativeMetrics || [];
    },

    sendToAdLauncher(creativeId) {
        const creative = (AppState.allCreatives || []).find(c => c.id === creativeId);
        if (!creative || !creative.imageUrl) {
            if (typeof showToast === 'function') showToast('Criativo sem imagem', 'error');
            return;
        }
        // Navega para Ad Launcher
        if (typeof EventBus !== 'undefined') EventBus.emit('tabChanged', 'ad-launcher');
        const tabBtn = document.querySelector('[data-tab="ad-launcher"]');
        if (tabBtn && (tabBtn.tagName === 'A' || tabBtn.tagName === 'BUTTON')) tabBtn.click();
        // Pré-seleciona o criativo
        setTimeout(() => {
            if (window.AdLauncher) {
                AdLauncher.state.source = 'creatives';
                document.querySelectorAll('[data-adl-source]').forEach(b =>
                    b.classList.toggle('adl-picker-tab-active', b.dataset.adlSource === 'creatives'));
                AdLauncher.state.selectedIds.clear();
                AdLauncher.state.selectedIds.add(creativeId);
                if (typeof AdLauncher.refresh === 'function') AdLauncher.refresh();
                if (typeof showToast === 'function') showToast(`Criativo "${creative.name}" pré-selecionado no Ad Launcher`, 'success');
            }
        }, 300);
    },

    getCreativeById(id) {
        return (AppState.allCreatives || []).find(c => c.id === id);
    },

    getMetricsForCreative(creativeId) {
        return (AppState.allCreativeMetrics || []).filter(m => m.creativeId === creativeId)
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    // ---- Country / Region helpers (uses the app's RegionTags convention) ----
    _countryOptionsHtml(selected) {
        if (typeof RegionTags === 'undefined' || !Array.isArray(RegionTags.PATTERNS)) return '';
        return RegionTags.PATTERNS.map(p => {
            const name = (typeof RegionTags.labelPlain === 'function') ? RegionTags.labelPlain(p.code) : p.code;
            return `<option value="${p.code}" ${selected === p.code ? 'selected' : ''}>${this._escapeHtml(name)} (${p.code})</option>`;
        }).join('');
    },
    // Country of a creative: explicit field, else auto-extracted from its name (zero-config)
    _creativeCountry(c) {
        if (!c) return '';
        if (c.country) return String(c.country).toUpperCase();
        if (typeof RegionTags !== 'undefined' && typeof RegionTags.extract === 'function') {
            return RegionTags.extract(c.name || '') || '';
        }
        return '';
    },
    _countryLabelPlain(code) {
        if (!code) return 'Sem país';
        if (typeof RegionTags !== 'undefined' && typeof RegionTags.labelPlain === 'function') {
            return RegionTags.labelPlain(code) || code;
        }
        return code;
    },
    _countryBadgeHtml(code) {
        if (!code) return '';
        if (typeof RegionTags !== 'undefined' && typeof RegionTags.label === 'function') {
            return `<span class="creative-chip creative-chip-country">${RegionTags.label(code)}</span>`;
        }
        return `<span class="creative-chip creative-chip-country">${this._escapeHtml(code)}</span>`;
    },

    // ---- Campaign helpers (links to Ad Hierarchy campaigns for the product) ----
    _campaignNamesForProduct(productId) {
        try {
            if (typeof AdHierarchyModule !== 'undefined' && typeof AdHierarchyModule._campaignsForProduct === 'function') {
                return AdHierarchyModule._campaignsForProduct(productId).map(c => c.name).filter(Boolean);
            }
        } catch {}
        return [];
    },
    _creativeCampaign(c) {
        return (c && c.campaign) ? String(c.campaign).trim() : '';
    },
    _refreshFormCampaignList() {
        const productId = document.getElementById('creative-product')?.value || '';
        const dl = document.getElementById('creative-campaign-list');
        if (dl) dl.innerHTML = this._campaignNamesForProduct(productId).map(n => `<option value="${this._escapeHtml(n)}">`).join('');
        // Suggest country from the creative name if the field is still empty
        const ccSel = document.getElementById('creative-country');
        const nameVal = document.getElementById('creative-name')?.value || '';
        if (ccSel && !ccSel.value && typeof RegionTags !== 'undefined') {
            const guess = RegionTags.extract(nameVal);
            if (guess && ccSel.querySelector(`option[value="${guess}"]`)) ccSel.value = guess;
        }
    },

    // ---- Media (foto/vídeo) — blob in IndexedDB, small thumb in localStorage ----
    _formMedia: null,

    async _handleMediaFile(file) {
        if (!file) return;
        const isVideo = (file.type || '').startsWith('video');
        const MAX = 60 * 1024 * 1024; // 60MB guard
        if (file.size > MAX) {
            showToast('Arquivo muito grande (máx. 60MB).', 'error');
            return;
        }
        let thumb = '';
        try {
            thumb = isVideo ? await this._videoThumb(file) : await this._imageThumb(file);
        } catch (e) { console.warn('thumb failed', e); }
        const prev = this._formMedia || {};
        this._formMedia = {
            file,
            mediaType: isVideo ? 'video' : 'image',
            mediaThumb: thumb || '',
            mediaName: file.name || '',
            mediaId: '',
            prevMediaId: prev.prevMediaId || prev.mediaId || '',
            changed: true,
            removed: false,
        };
        this._renderFormMediaPreview();
    },

    _clearFormMedia() {
        const prev = this._formMedia || {};
        this._formMedia = { file: null, mediaType: '', mediaThumb: '', mediaName: '', mediaId: '', prevMediaId: prev.prevMediaId || prev.mediaId || '', changed: true, removed: true };
        this._renderFormMediaPreview();
    },

    _renderFormMediaPreview() {
        const box = document.getElementById('creative-media-preview');
        if (!box) return;
        const m = this._formMedia || {};
        const has = m.mediaThumb || m.mediaId || m.file;
        if (!has) {
            box.classList.add('creative-media-empty');
            box.innerHTML = `<button type="button" id="creative-media-pick" class="btn btn-secondary"><i data-lucide="image-plus" style="width:15px;height:15px;vertical-align:-2px"></i> Subir foto / vídeo</button>
                <span class="creative-media-hint">PNG, JPG, GIF, MP4, MOV… fica salvo no navegador</span>`;
        } else {
            box.classList.remove('creative-media-empty');
            const thumb = m.mediaThumb
                ? `<img src="${m.mediaThumb}" alt="preview">`
                : `<div class="creative-media-noimg"><i data-lucide="${m.mediaType === 'video' ? 'video' : 'image'}" style="width:26px;height:26px"></i></div>`;
            const badge = m.mediaType === 'video' ? '<span class="creative-media-typebadge"><i data-lucide="play" style="width:11px;height:11px;vertical-align:-1px"></i> Vídeo</span>' : '';
            box.innerHTML = `<div class="creative-media-thumbwrap">${thumb}${badge}</div>
                <div class="creative-media-actions">
                    <span class="creative-media-name">${this._escapeHtml(m.mediaName || 'mídia')}</span>
                    <button type="button" id="creative-media-pick" class="btn btn-secondary btn-sm">Trocar</button>
                    <button type="button" id="creative-media-remove" class="btn btn-danger btn-sm">Remover</button>
                </div>`;
        }
        // Re-wire (innerHTML replaced the buttons)
        box.querySelector('#creative-media-pick')?.addEventListener('click', () => document.getElementById('creative-media-input')?.click());
        box.querySelector('#creative-media-remove')?.addEventListener('click', () => this._clearFormMedia());
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    },

    // Downscale an image File to a small base64 thumbnail (WebP).
    _imageThumb(file, maxW = 420, quality = 0.72) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const scale = Math.min(1, maxW / (img.width || maxW));
                        const w = Math.max(1, Math.round((img.width || maxW) * scale));
                        const h = Math.max(1, Math.round((img.height || maxW) * scale));
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        let out;
                        try { out = canvas.toDataURL('image/webp', quality); } catch { out = canvas.toDataURL('image/jpeg', quality); }
                        resolve(out);
                    } catch (e) { resolve(reader.result); }
                };
                img.onerror = () => resolve(reader.result);
                img.src = reader.result;
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    },

    // Capture a poster frame from a video File as a base64 thumbnail.
    _videoThumb(file, maxW = 420) {
        return new Promise((resolve) => {
            try {
                const url = URL.createObjectURL(file);
                const video = document.createElement('video');
                video.muted = true; video.playsInline = true; video.preload = 'metadata';
                let done = false;
                const finish = (val) => { if (done) return; done = true; try { URL.revokeObjectURL(url); } catch {} resolve(val); };
                video.onloadeddata = () => { try { video.currentTime = Math.min(0.15, (video.duration || 1) / 2); } catch { finish(''); } };
                video.onseeked = () => {
                    try {
                        const scale = Math.min(1, maxW / (video.videoWidth || maxW));
                        const w = Math.max(1, Math.round((video.videoWidth || maxW) * scale));
                        const h = Math.max(1, Math.round((video.videoHeight || maxW) * scale));
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(video, 0, 0, w, h);
                        finish(canvas.toDataURL('image/webp', 0.7));
                    } catch { finish(''); }
                };
                video.onerror = () => finish('');
                setTimeout(() => finish(''), 5000); // safety timeout
                video.src = url;
            } catch { resolve(''); }
        });
    },

    // Thumbnail for a saved creative card (base64 thumb, else external URL).
    _thumbForCreative(c) {
        return (c && (c.mediaThumb || c.imageUrl)) || '';
    },

    // ---- Quick-view lightbox ----
    async openLightbox(creativeId) {
        const c = this.getCreativeById(creativeId);
        if (!c) return;
        const box = document.getElementById('creative-media-lightbox');
        const body = document.getElementById('creative-lightbox-body');
        const cap = document.getElementById('creative-lightbox-caption');
        if (!box || !body) return;
        cap && (cap.textContent = c.name || '');
        body.innerHTML = '<div class="creative-lightbox-loading">Carregando…</div>';
        box.style.display = 'flex';
        // Revoke any previous object URL
        if (this._lightboxUrl) { try { URL.revokeObjectURL(this._lightboxUrl); } catch {} this._lightboxUrl = null; }

        let url = '', type = c.mediaType || 'image';
        if (c.mediaId && typeof MediaStore !== 'undefined') {
            url = await MediaStore.getObjectUrl(c.mediaId);
            if (url) this._lightboxUrl = url;
        }
        if (!url && c.imageUrl) { url = c.imageUrl; type = 'image'; }
        if (!url && c.mediaThumb) { url = c.mediaThumb; type = 'image'; }

        if (!url) {
            body.innerHTML = '<div class="creative-lightbox-loading">Sem mídia salva para este criativo.</div>';
            return;
        }
        body.innerHTML = (type === 'video')
            ? `<video src="${url}" controls autoplay playsinline style="max-width:100%;max-height:80vh;border-radius:10px"></video>`
            : `<img src="${url}" alt="${this._escapeHtml(c.name || '')}" style="max-width:100%;max-height:80vh;border-radius:10px">`;
    },

    closeLightbox() {
        const box = document.getElementById('creative-media-lightbox');
        const body = document.getElementById('creative-lightbox-body');
        if (body) body.innerHTML = '';
        if (box) box.style.display = 'none';
        if (this._lightboxUrl) { try { URL.revokeObjectURL(this._lightboxUrl); } catch {} this._lightboxUrl = null; }
    },

    // ---- CRUD Creatives ----
    openForm(creative = null) {
        const title = document.getElementById('creative-modal-title');
        const form = document.getElementById('creative-form');
        if (!form) return;
        form.reset();

        // Populate product dropdown
        const productSelect = document.getElementById('creative-product');
        if (productSelect) {
            while (productSelect.options.length > 1) productSelect.remove(1);
            AppState.products.forEach(p => {
                if (p.status === 'ativo') {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    productSelect.appendChild(opt);
                }
            });
        }

        // Populate País / Mercado options
        const countrySel = document.getElementById('creative-country');
        if (countrySel) countrySel.innerHTML = '<option value="">— Nenhum —</option>' + this._countryOptionsHtml(creative?.country || '');

        if (creative) {
            title.textContent = 'Editar Criativo';
            document.getElementById('creative-id').value = creative.id;
            document.getElementById('creative-name').value = creative.name;
            document.getElementById('creative-product').value = creative.productId;
            document.getElementById('creative-type').value = creative.type;
            document.getElementById('creative-angle').value = creative.angle || '';
            document.getElementById('creative-hook-text').value = creative.hookText || '';
            document.getElementById('creative-hook-type').value = creative.hookType || '';
            document.getElementById('creative-platform').value = creative.platform || 'Meta Ads';
            document.getElementById('creative-status').value = creative.status || 'ativo';
            document.getElementById('creative-launch-date').value = creative.launchDate || '';
            // Ad text fields
            document.getElementById('creative-primary-text').value = creative.primaryText || '';
            document.getElementById('creative-headline').value = creative.headline || '';
            document.getElementById('creative-description').value = creative.adDescription || '';
            // Country / campaign / media
            if (countrySel) countrySel.value = creative.country || '';
            document.getElementById('creative-campaign').value = creative.campaign || '';
            document.getElementById('creative-image-url').value = creative.imageUrl || '';
            this._formMedia = {
                file: null,
                mediaType: creative.mediaType || '',
                mediaThumb: creative.mediaThumb || '',
                mediaName: creative.mediaName || '',
                mediaId: creative.mediaId || '',
                prevMediaId: creative.mediaId || '',
                changed: false,
                removed: false,
            };
        } else {
            title.textContent = 'Novo Criativo';
            document.getElementById('creative-id').value = '';
            document.getElementById('creative-launch-date').value = todayISO();
            document.getElementById('creative-campaign').value = '';
            document.getElementById('creative-image-url').value = '';
            this._formMedia = { file: null, mediaType: '', mediaThumb: '', mediaName: '', mediaId: '', prevMediaId: '', changed: false, removed: false };
        }

        this._refreshFormCampaignList();
        this._renderFormMediaPreview();
        openModal('creative-modal');
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    },

    async handleSubmit(e) {
        e.preventDefault();

        const id = document.getElementById('creative-id').value || generateId('crtv');
        const productId = document.getElementById('creative-product').value;
        if (!productId) {
            showToast('Selecione um produto para o criativo.', 'error');
            return;
        }

        // ---- Resolve media (store blob in IndexedDB, keep only id + thumb) ----
        const m = this._formMedia || {};
        let mediaId = m.mediaId || '', mediaType = m.mediaType || '', mediaThumb = m.mediaThumb || '', mediaName = m.mediaName || '';
        if (m.removed) { mediaId = ''; mediaType = ''; mediaThumb = ''; mediaName = ''; }
        if (m.file && typeof MediaStore !== 'undefined' && MediaStore.isSupported()) {
            const newId = generateId('media');
            try {
                await MediaStore.put(newId, m.file, { type: mediaType, name: mediaName });
                mediaId = newId;
            } catch (err) {
                console.warn('MediaStore put failed', err);
                showToast('Não consegui salvar a mídia (mas o criativo será salvo).', 'warning');
                mediaId = '';
            }
        } else if (m.file) {
            showToast('Mídia não suportada neste navegador; salvando só os dados.', 'warning');
        }

        const data = {
            id,
            productId,
            name: document.getElementById('creative-name').value.trim(),
            type: document.getElementById('creative-type').value,
            angle: document.getElementById('creative-angle').value.trim(),
            hookText: document.getElementById('creative-hook-text').value.trim(),
            hookType: document.getElementById('creative-hook-type').value,
            platform: document.getElementById('creative-platform').value,
            status: document.getElementById('creative-status').value || 'ativo',
            launchDate: document.getElementById('creative-launch-date').value,
            // Ad copy fields
            primaryText: document.getElementById('creative-primary-text').value.trim(),
            headline: document.getElementById('creative-headline').value.trim(),
            adDescription: document.getElementById('creative-description').value.trim(),
            // Country / campaign
            country: (document.getElementById('creative-country')?.value || '').toUpperCase(),
            campaign: (document.getElementById('creative-campaign')?.value || '').trim(),
            // Media
            mediaId, mediaType, mediaThumb, mediaName,
            imageUrl: (document.getElementById('creative-image-url')?.value || '').trim(),
            // Test variations
            variations: [],
            storeId: getWritableStoreId(productId),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        // Delete the previous blob if media was replaced/removed
        if (m.prevMediaId && m.prevMediaId !== mediaId && typeof MediaStore !== 'undefined') {
            MediaStore.del(m.prevMediaId);
        }

        const existingIdx = (AppState.allCreatives || []).findIndex(c => c.id === id);
        if (existingIdx >= 0) {
            data.variations = AppState.allCreatives[existingIdx].variations || [];
            data.createdAt = AppState.allCreatives[existingIdx].createdAt;
            AppState.allCreatives[existingIdx] = data;
            showToast('Criativo atualizado!', 'success');
        } else {
            AppState.allCreatives.push(data);
            showToast('Criativo adicionado!', 'success');
        }

        if (AppState.sheetsConnected && typeof SheetsAPI !== 'undefined' && SheetsAPI.TABS.CREATIVES) {
            try {
                if (existingIdx >= 0) {
                    await SheetsAPI.updateRowById(SheetsAPI.TABS.CREATIVES, data.id, SheetsAPI.creativeToRow(data));
                } else {
                    await SheetsAPI.appendRow(SheetsAPI.TABS.CREATIVES, SheetsAPI.creativeToRow(data));
                }
            } catch (err) { console.error('Sheets sync error:', err); }
        }

        filterDataByStore();
        closeModal('creative-modal');
        LocalStore.save('creatives', AppState.allCreatives);
        EventBus.emit('creativesChanged');
    },

    async deleteCreative(id) {
        if (!confirm('Excluir este criativo e todas suas metricas?')) return;

        const gone = (AppState.allCreatives || []).find(c => c.id === id);
        if (gone && gone.mediaId && typeof MediaStore !== 'undefined') MediaStore.del(gone.mediaId);

        AppState.allCreatives = (AppState.allCreatives || []).filter(c => c.id !== id);
        AppState.allCreativeMetrics = (AppState.allCreativeMetrics || []).filter(m => m.creativeId !== id);

        filterDataByStore();
        LocalStore.save('creatives', AppState.allCreatives);
        LocalStore.save('creative_metrics', AppState.allCreativeMetrics);
        EventBus.emit('creativesChanged');
        showToast('Criativo excluido', 'info');
    },

    // ---- Metric Entry ----
    openMetricForm(creativeId) {
        const creative = this.getCreativeById(creativeId);
        if (!creative) return;

        const form = document.getElementById('metric-form');
        if (!form) return;
        form.reset();

        document.getElementById('metric-creative-id').value = creativeId;
        document.getElementById('metric-creative-name').textContent = creative.name;
        document.getElementById('metric-date').value = todayISO();
        document.getElementById('metric-currency').value = 'USD';

        openModal('metric-modal');
    },

    async handleMetricSubmit(e) {
        e.preventDefault();

        const creativeId = document.getElementById('metric-creative-id').value;
        const spend = parseFloat(document.getElementById('metric-spend').value) || 0;
        const impressions = parseInt(document.getElementById('metric-impressions').value) || 0;
        const clicks = parseInt(document.getElementById('metric-clicks').value) || 0;
        const conversions = parseInt(document.getElementById('metric-conversions').value) || 0;
        const revenue = parseFloat(document.getElementById('metric-revenue').value) || 0;

        const creative = this.getCreativeById(creativeId);
        if (!creative) return;

        const data = {
            id: generateId('cm'),
            creativeId,
            date: document.getElementById('metric-date').value,
            spend,
            impressions,
            clicks,
            ctr: impressions > 0 ? parseFloat((clicks / impressions * 100).toFixed(2)) : 0,
            cpc: clicks > 0 ? parseFloat((spend / clicks).toFixed(2)) : 0,
            cpm: impressions > 0 ? parseFloat((spend / impressions * 1000).toFixed(2)) : 0,
            conversions,
            revenue,
            roas: spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : 0,
            currency: document.getElementById('metric-currency').value,
            storeId: creative.storeId || ''
        };

        AppState.allCreativeMetrics = AppState.allCreativeMetrics || [];
        AppState.allCreativeMetrics.push(data);

        filterDataByStore();
        closeModal('metric-modal');
        LocalStore.save('creative_metrics', AppState.allCreativeMetrics);
        EventBus.emit('creativesChanged');
        showToast('Metrica registrada!', 'success');
    },

    // ---- Test Variations (ad text A/B testing) ----
    openVariationForm(creativeId) {
        const creative = this.getCreativeById(creativeId);
        if (!creative) return;

        const form = document.getElementById('variation-form');
        if (!form) return;
        form.reset();

        document.getElementById('variation-creative-id').value = creativeId;
        document.getElementById('variation-creative-name').textContent = creative.name;
        document.getElementById('variation-start-date').value = todayISO();

        openModal('variation-modal');
    },

    handleVariationSubmit(e) {
        e.preventDefault();

        const creativeId = document.getElementById('variation-creative-id').value;
        const creative = this.getCreativeById(creativeId);
        if (!creative) return;

        const variation = {
            id: generateId('var'),
            name: document.getElementById('variation-name').value.trim(),
            element: document.getElementById('variation-element').value, // primaryText, headline, description
            originalValue: document.getElementById('variation-original').value.trim(),
            testValue: document.getElementById('variation-test').value.trim(),
            startDate: document.getElementById('variation-start-date').value,
            endDate: document.getElementById('variation-end-date').value,
            status: 'pendente', // pendente, validado, nao_validado
            notes: document.getElementById('variation-notes').value.trim()
        };

        creative.variations = creative.variations || [];
        creative.variations.push(variation);
        creative.updatedAt = new Date().toISOString();

        LocalStore.save('creatives', AppState.allCreatives);
        closeModal('variation-modal');
        EventBus.emit('creativesChanged');
        showToast('Variacao de teste adicionada!', 'success');
    },

    validateVariation(creativeId, variationId, result) {
        const creative = this.getCreativeById(creativeId);
        if (!creative) return;

        const variation = (creative.variations || []).find(v => v.id === variationId);
        if (!variation) return;

        variation.status = result; // 'validado' or 'nao_validado'
        variation.validatedAt = new Date().toISOString();
        creative.updatedAt = new Date().toISOString();

        LocalStore.save('creatives', AppState.allCreatives);
        EventBus.emit('creativesChanged');
        showToast(`Variacao ${result === 'validado' ? 'validada' : 'nao validada'}!`, result === 'validado' ? 'success' : 'info');
    },

    // ---- Fatigue Detection ----
    detectFatigue(creativeId) {
        const metrics = this.getMetricsForCreative(creativeId);
        if (metrics.length < 3) return { fatigued: false, reason: '' };

        const recent = metrics.slice(-7);
        if (recent.length < 3) return { fatigued: false, reason: '' };

        // Check CTR declining trend (3+ consecutive days)
        let decliningCTR = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i].ctr < recent[i - 1].ctr) decliningCTR++;
            else decliningCTR = 0;
        }

        // Check CPC rising trend
        let risingCPC = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i].cpc > recent[i - 1].cpc) risingCPC++;
            else risingCPC = 0;
        }

        // Peak CTR comparison
        const peakCTR = Math.max(...metrics.map(m => m.ctr));
        const currentCTR = recent[recent.length - 1].ctr;
        const ctrDrop = peakCTR > 0 ? ((peakCTR - currentCTR) / peakCTR * 100) : 0;

        if (decliningCTR >= 3 && ctrDrop > 30) {
            return { fatigued: true, reason: `CTR caiu ${ctrDrop.toFixed(0)}% do pico (${peakCTR.toFixed(2)}% -> ${currentCTR.toFixed(2)}%)`, severity: 'high' };
        }
        if (risingCPC >= 3) {
            return { fatigued: true, reason: `CPC subindo ha ${risingCPC} dias seguidos`, severity: 'medium' };
        }
        if (ctrDrop > 40) {
            return { fatigued: true, reason: `CTR ${ctrDrop.toFixed(0)}% abaixo do pico`, severity: 'high' };
        }

        return { fatigued: false, reason: '' };
    },

    // Freshness score (days since launch)
    getFreshness(creative) {
        if (!creative.launchDate) return { days: 0, level: 'unknown' };
        const days = Math.floor((new Date() - new Date(creative.launchDate)) / 86400000);
        const level = days <= 5 ? 'fresh' : (days <= 10 ? 'warming' : 'old');
        return { days, level };
    },

    // ---- Aggregate Stats ----
    getCreativeStats(creativeId) {
        const metrics = this.getMetricsForCreative(creativeId);
        if (metrics.length === 0) return null;

        const totalSpend = metrics.reduce((s, m) => s + m.spend, 0);
        const totalClicks = metrics.reduce((s, m) => s + m.clicks, 0);
        const totalImpressions = metrics.reduce((s, m) => s + m.impressions, 0);
        const totalConversions = metrics.reduce((s, m) => s + m.conversions, 0);
        const totalRevenue = metrics.reduce((s, m) => s + m.revenue, 0);

        return {
            totalSpend,
            totalClicks,
            totalImpressions,
            totalConversions,
            totalRevenue,
            avgCTR: totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0,
            avgCPC: totalClicks > 0 ? (totalSpend / totalClicks) : 0,
            avgCPM: totalImpressions > 0 ? (totalSpend / totalImpressions * 1000) : 0,
            roas: totalSpend > 0 ? (totalRevenue / totalSpend) : 0,
            cpa: totalConversions > 0 ? (totalSpend / totalConversions) : 0,
            days: metrics.length
        };
    },

    // ---- Compare Mode ----
    _compareMode: false,
    _selectedForCompare: new Set(),

    toggleCompareMode() {
        this._compareMode = !this._compareMode;
        this._selectedForCompare.clear();
        this.render();
    },

    toggleCompareSelection(creativeId) {
        if (this._selectedForCompare.has(creativeId)) {
            this._selectedForCompare.delete(creativeId);
        } else if (this._selectedForCompare.size < 4) {
            this._selectedForCompare.add(creativeId);
        } else {
            showToast('Maximo 4 criativos para comparar', 'error');
        }
        this.render();
    },

    // ---- Best-creative scoring ----
    _scoreCreative(c) {
        const s = this.getCreativeStats(c.id);
        if (!s) return null;
        return { roas: s.roas || 0, ctr: s.avgCTR || 0, conv: s.totalConversions || 0, spend: s.totalSpend || 0, stats: s };
    },
    // Returns the best creative id in a list (by ROAS, then CTR, then conversions). Null if none have metrics.
    _bestOf(list) {
        let best = null, bestSc = null;
        list.forEach(c => {
            const sc = this._scoreCreative(c);
            if (!sc) return;
            if (!bestSc || sc.roas > bestSc.roas ||
                (sc.roas === bestSc.roas && sc.ctr > bestSc.ctr) ||
                (sc.roas === bestSc.roas && sc.ctr === bestSc.ctr && sc.conv > bestSc.conv)) {
                best = c; bestSc = sc;
            }
        });
        return best ? best.id : null;
    },

    // Populate the Campanha + País filter dropdowns from all creatives
    _populateCreativeFilters() {
        const all = this.getCreatives();
        const campSel = document.getElementById('creative-campaign-filter');
        if (campSel) {
            const cur = campSel.value;
            const camps = [...new Set(all.map(c => this._creativeCampaign(c)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
            campSel.innerHTML = '<option value="todos">Todas</option>' +
                camps.map(n => `<option value="${this._escapeHtml(n)}">${this._escapeHtml(n)}</option>`).join('') +
                '<option value="__none__">Sem campanha</option>';
            if (cur) campSel.value = cur;
        }
        const ccSel = document.getElementById('creative-country-filter');
        if (ccSel) {
            const cur = ccSel.value;
            const codes = [...new Set(all.map(c => this._creativeCountry(c)).filter(Boolean))].sort();
            ccSel.innerHTML = '<option value="todos">Todos</option>' +
                codes.map(code => `<option value="${code}">${this._escapeHtml(this._countryLabelPlain(code))} (${code})</option>`).join('') +
                '<option value="__none__">Sem país</option>';
            if (cur) ccSel.value = cur;
        }
    },

    // ---- Render ----
    render() {
        const container = document.getElementById('creatives-list');
        if (!container) return;

        this._populateCreativeFilters();

        const productFilter = document.getElementById('creative-product-filter')?.value || 'todos';
        const statusFilter = document.getElementById('creative-status-filter')?.value || 'todos';
        const campaignFilter = document.getElementById('creative-campaign-filter')?.value || 'todos';
        const countryFilter = document.getElementById('creative-country-filter')?.value || 'todos';
        const groupBy = document.getElementById('creative-group-by')?.value || 'produto';

        let creatives = this.getCreatives();

        if (productFilter !== 'todos') creatives = creatives.filter(c => c.productId === productFilter);
        if (statusFilter !== 'todos') creatives = creatives.filter(c => c.status === statusFilter);
        if (campaignFilter !== 'todos') {
            creatives = creatives.filter(c => {
                const camp = this._creativeCampaign(c);
                return campaignFilter === '__none__' ? !camp : camp === campaignFilter;
            });
        }
        if (countryFilter !== 'todos') {
            creatives = creatives.filter(c => {
                const cc = this._creativeCountry(c);
                return countryFilter === '__none__' ? !cc : cc === countryFilter;
            });
        }

        if (creatives.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Nenhum criativo encontrado. Ajuste os filtros ou clique em "+ Novo Criativo".</p></div>';
            this.renderBestSummary([]);
            this.renderComparePanel([]);
            this.renderFatigueSummary([]);
            return;
        }

        // Group by the selected dimension
        const grouped = {};
        const keyFor = (c) => {
            if (groupBy === 'campanha') return this._creativeCampaign(c) || '— Sem campanha —';
            if (groupBy === 'pais') { const cc = this._creativeCountry(c); return cc ? `${this._countryLabelPlain(cc)} (${cc})` : '— Sem país —'; }
            return getProductName(c.productId);
        };
        creatives.forEach(c => {
            const k = keyFor(c);
            if (!grouped[k]) grouped[k] = [];
            grouped[k].push(c);
        });

        const groupIcon = groupBy === 'campanha' ? 'megaphone' : (groupBy === 'pais' ? 'globe-2' : 'package');
        container.innerHTML = Object.entries(grouped).map(([groupName, items]) => {
            const bestId = this._bestOf(items);
            const cards = items.map(c => this.renderCreativeCard(c, c.id === bestId)).join('');
            return `<div class="creative-product-group">
                <h3 class="creative-group-title"><i data-lucide="${groupIcon}" style="width:15px;height:15px;vertical-align:-2px"></i> ${this._escapeHtml(groupName)} <span class="creative-group-count">${items.length}</span></h3>
                <div class="creative-cards-grid">${cards}</div>
            </div>`;
        }).join('');

        // Wire thumbnail quick-view (lightbox)
        container.querySelectorAll('[data-lightbox]').forEach(el => {
            el.addEventListener('click', () => this.openLightbox(el.dataset.lightbox));
        });

        this.renderBestSummary(creatives);

        // Render comparison panel if items selected
        if (this._compareMode && this._selectedForCompare.size >= 2) {
            this.renderComparePanel([...this._selectedForCompare]);
        } else {
            this.renderComparePanel([]);
        }

        // Render fatigue summary
        this.renderFatigueSummary(creatives);
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    },

    // ---- Best-creative summary panel ----
    renderBestSummary(creatives) {
        const el = document.getElementById('creative-best-summary');
        if (!el) return;
        const withStats = creatives.map(c => ({ c, sc: this._scoreCreative(c) })).filter(x => x.sc);
        if (withStats.length === 0) {
            el.innerHTML = '';
            return;
        }
        withStats.sort((a, b) =>
            b.sc.roas - a.sc.roas || b.sc.ctr - a.sc.ctr || b.sc.conv - a.sc.conv);
        const top = withStats.slice(0, 3);
        const cards = top.map((x, i) => {
            const c = x.c, s = x.sc.stats;
            const thumb = this._thumbForCreative(c);
            const cc = this._creativeCountry(c);
            const medal = ['🥇', '🥈', '🥉'][i] || '';
            return `<div class="creative-best-card" ${c.mediaId || c.imageUrl || c.mediaThumb ? `data-lightbox="${c.id}"` : ''}>
                <div class="creative-best-rank">${medal}</div>
                ${thumb ? `<div class="creative-best-thumb"><img src="${this._escapeHtml(thumb)}" alt="">${c.mediaType === 'video' ? '<span class="creative-thumb-play"><i data-lucide="play" style="width:14px;height:14px"></i></span>' : ''}</div>` : '<div class="creative-best-thumb creative-best-thumb-empty"><i data-lucide="image" style="width:20px;height:20px"></i></div>'}
                <div class="creative-best-info">
                    <strong>${this._escapeHtml(c.name)}</strong>
                    <div class="creative-best-sub">${getProductName(c.productId)}${cc ? ' · ' + this._escapeHtml(cc) : ''}${this._creativeCampaign(c) ? ' · ' + this._escapeHtml(this._creativeCampaign(c)) : ''}</div>
                    <div class="creative-best-stats">
                        <span title="ROAS"><b>${s.roas.toFixed(2)}x</b> ROAS</span>
                        <span title="CTR">${s.avgCTR.toFixed(2)}% CTR</span>
                        <span title="Conversões">${s.totalConversions} conv.</span>
                    </div>
                </div>
            </div>`;
        }).join('');
        el.innerHTML = `<div class="creative-best-panel">
            <div class="creative-best-title"><i data-lucide="trophy" style="width:15px;height:15px;vertical-align:-2px"></i> Melhores criativos <span class="creative-best-hint">por ROAS · com métricas registradas</span></div>
            <div class="creative-best-grid">${cards}</div>
        </div>`;
        // wire lightbox on best cards
        el.querySelectorAll('[data-lightbox]').forEach(card => {
            card.addEventListener('click', () => this.openLightbox(card.dataset.lightbox));
        });
    },

    renderCreativeCard(creative, isBest = false) {
        const stats = this.getCreativeStats(creative.id);
        const fatigue = this.detectFatigue(creative.id);
        const freshness = this.getFreshness(creative);
        const statusObj = this.STATUSES.find(s => s.id === creative.status) || this.STATUSES[0];
        const variations = creative.variations || [];
        const activeTests = variations.filter(v => v.status === 'pendente');
        const winners = variations.filter(v => v.status === 'validado');

        const compareCheckbox = this._compareMode
            ? `<label class="compare-checkbox"><input type="checkbox" ${this._selectedForCompare.has(creative.id) ? 'checked' : ''} onchange="CreativesModule.toggleCompareSelection('${creative.id}')"> Comparar</label>`
            : '';

        const freshnessClass = freshness.level === 'fresh' ? 'freshness-fresh' : (freshness.level === 'warming' ? 'freshness-warming' : 'freshness-old');

        // Media-first thumbnail (click → quick view). Falls back to a placeholder.
        const thumb = this._thumbForCreative(creative);
        const hasMedia = !!(creative.mediaId || creative.imageUrl || creative.mediaThumb);
        const isVideo = creative.mediaType === 'video';
        const thumbHtml = `<div class="creative-card-thumb ${hasMedia ? 'creative-card-thumb-clickable' : 'creative-card-thumb-placeholder'}" ${hasMedia ? `data-lightbox="${creative.id}"` : ''}>
            ${thumb ? `<img src="${this._escapeHtml(thumb)}" alt="${this._escapeHtml(creative.name)}" loading="lazy">` : '<div class="creative-thumb-empty"><i data-lucide="image" style="width:30px;height:30px"></i></div>'}
            ${isVideo ? '<span class="creative-thumb-play"><i data-lucide="play" style="width:20px;height:20px"></i></span>' : ''}
            ${hasMedia ? '<span class="creative-thumb-zoom"><i data-lucide="maximize-2" style="width:13px;height:13px"></i></span>' : ''}
        </div>`;

        // Chips: country, campaign, type, angle
        const cc = this._creativeCountry(creative);
        const camp = this._creativeCampaign(creative);
        const chips = `<div class="creative-chips">
            ${cc ? this._countryBadgeHtml(cc) : ''}
            ${camp ? `<span class="creative-chip creative-chip-camp" title="Campanha"><i data-lucide="megaphone" style="width:11px;height:11px;vertical-align:-1px"></i> ${this._escapeHtml(camp)}</span>` : ''}
            ${creative.type ? `<span class="creative-chip">${this._escapeHtml(creative.type)}</span>` : ''}
            ${creative.angle ? `<span class="creative-chip creative-chip-angle">${this._escapeHtml(creative.angle)}</span>` : ''}
        </div>`;

        return `<div class="creative-card ${fatigue.fatigued ? 'creative-fatigued' : ''} ${creative.status === 'winner' ? 'creative-winner' : ''} ${isBest ? 'creative-best' : ''}">
            ${thumbHtml}
            <div class="creative-card-header">
                <div>
                    <strong class="creative-card-name">${isBest ? '<span class="creative-best-flag" title="Melhor desempenho neste grupo">🏆</span> ' : ''}${this._escapeHtml(creative.name)}</strong>
                </div>
                <div class="creative-card-badges">
                    <span class="creative-status-badge" style="background:${statusObj.color}">${statusObj.label}</span>
                    ${fatigue.fatigued ? `<span class="creative-fatigue-badge" title="${this._escapeHtml(fatigue.reason)}"><i data-lucide="flame" style="width:14px;height:14px;vertical-align:-2px"></i> Fadiga</span>` : ''}
                    <span class="creative-freshness-badge ${freshnessClass}">${freshness.days}d</span>
                    ${activeTests.length > 0 ? `<span class="creative-test-badge"><i data-lucide="flask-conical" style="width:14px;height:14px;vertical-align:-2px"></i> ${activeTests.length} teste(s)</span>` : ''}
                    ${winners.length > 0 ? `<span class="creative-winner-badge"><i data-lucide="trophy" style="width:14px;height:14px;vertical-align:-2px"></i> ${winners.length} validado(s)</span>` : ''}
                    ${compareCheckbox}
                </div>
            </div>

            ${chips}

            ${creative.hookText ? `<div class="creative-hook"><strong>Hook:</strong> ${this._escapeHtml(creative.hookText)}</div>` : ''}

            ${(creative.primaryText || creative.headline || creative.adDescription) ? `
            <details class="creative-ad-copy-details">
                <summary>Textos do anúncio</summary>
                <div class="creative-ad-copy">
                    ${creative.headline ? `<div class="ad-copy-field"><label>Titulo:</label> <span>${this._escapeHtml(creative.headline)}</span></div>` : ''}
                    ${creative.primaryText ? `<div class="ad-copy-field"><label>Texto Principal:</label> <span>${this._escapeHtml(creative.primaryText).substring(0, 120)}${creative.primaryText.length > 120 ? '...' : ''}</span></div>` : ''}
                    ${creative.adDescription ? `<div class="ad-copy-field"><label>Descricao:</label> <span>${this._escapeHtml(creative.adDescription)}</span></div>` : ''}
                </div>
            </details>` : ''}

            ${stats ? `
            <div class="creative-metrics-grid">
                <div class="creative-metric"><label>Gasto</label><strong>${formatCurrency(stats.totalSpend, 'USD')}</strong></div>
                <div class="creative-metric"><label>CTR</label><strong>${stats.avgCTR.toFixed(2)}%</strong></div>
                <div class="creative-metric"><label>CPC</label><strong>${formatCurrency(stats.avgCPC, 'USD')}</strong></div>
                <div class="creative-metric"><label>CPM</label><strong>${formatCurrency(stats.avgCPM, 'USD')}</strong></div>
                <div class="creative-metric"><label>Conv.</label><strong>${stats.totalConversions}</strong></div>
                <div class="creative-metric"><label>ROAS</label><strong>${stats.roas.toFixed(2)}x</strong></div>
            </div>` : '<div class="creative-no-metrics">Sem metricas registradas</div>'}

            ${variations.length > 0 ? this.renderVariations(creative.id, variations) : ''}

            <div class="creative-card-actions">
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.openForm(CreativesModule.getCreativeById('${creative.id}'))">Editar</button>
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.openMetricForm('${creative.id}')">+ Metrica</button>
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.openVariationForm('${creative.id}')"><i data-lucide="flask-conical" style="width:14px;height:14px;vertical-align:-2px"></i> Testar Variacao</button>
                ${creative.imageUrl ? `<button class="btn btn-primary btn-sm" onclick="CreativesModule.sendToAdLauncher('${creative.id}')"><i data-lucide="send" style="width:14px;height:14px;vertical-align:-2px"></i> Lançar Anúncio</button>` : ''}
                <button class="btn btn-danger btn-sm" onclick="CreativesModule.deleteCreative('${creative.id}')">Excluir</button>
            </div>
        </div>`;
    },

    renderVariations(creativeId, variations) {
        const elementLabels = { primaryText: 'Texto Principal', headline: 'Titulo', description: 'Descricao' };

        const rows = variations.map(v => {
            const statusClass = v.status === 'validado' ? 'var-validated' : (v.status === 'nao_validado' ? 'var-rejected' : 'var-pending');
            const statusLabel = v.status === 'validado' ? '<i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Validado' : (v.status === 'nao_validado' ? '<i data-lucide="x-circle" style="width:14px;height:14px;vertical-align:-2px"></i> Nao validado' : '<i data-lucide="hourglass" style="width:14px;height:14px;vertical-align:-2px"></i> Pendente');

            return `<div class="variation-row ${statusClass}">
                <div class="variation-info">
                    <strong>${this._escapeHtml(v.name || 'Teste')}</strong>
                    <span class="variation-element">${elementLabels[v.element] || v.element}</span>
                    <span class="variation-dates">${v.startDate ? formatDate(v.startDate) : ''} ${v.endDate ? '<i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> ' + formatDate(v.endDate) : ''}</span>
                </div>
                <div class="variation-values">
                    <div class="variation-original" title="Original">${this._escapeHtml((v.originalValue || '').substring(0, 50))}</div>
                    <span class="variation-vs">vs</span>
                    <div class="variation-test" title="Teste">${this._escapeHtml((v.testValue || '').substring(0, 50))}</div>
                </div>
                <div class="variation-status">
                    <span class="${statusClass}">${statusLabel}</span>
                    ${v.status === 'pendente' ? `
                        <button class="btn btn-sm" style="background:var(--green);color:#fff" onclick="CreativesModule.validateVariation('${creativeId}','${v.id}','validado')"><i data-lucide="check" style="width:14px;height:14px;vertical-align:-2px"></i></button>
                        <button class="btn btn-sm" style="background:var(--red);color:#fff" onclick="CreativesModule.validateVariation('${creativeId}','${v.id}','nao_validado')"><i data-lucide="x" style="width:14px;height:14px;vertical-align:-2px"></i></button>
                    ` : ''}
                </div>
            </div>`;
        }).join('');

        return `<div class="creative-variations">
            <div class="variations-title"><i data-lucide="flask-conical" style="width:14px;height:14px;vertical-align:-2px"></i> Testes de Variacao (${variations.length})</div>
            ${rows}
        </div>`;
    },

    renderComparePanel(creativeIds) {
        const panel = document.getElementById('compare-panel');
        if (!panel) return;

        if (creativeIds.length < 2) {
            panel.innerHTML = '';
            panel.style.display = 'none';
            return;
        }

        const data = creativeIds.map(id => {
            const c = this.getCreativeById(id);
            const s = this.getCreativeStats(id);
            const f = this.detectFatigue(id);
            return { creative: c, stats: s, fatigue: f };
        }).filter(d => d.creative);

        const headers = ['Metrica', ...data.map(d => d.creative.name)];
        const metricsRows = [
            ['Gasto', ...data.map(d => d.stats ? formatCurrency(d.stats.totalSpend, 'USD') : '--')],
            ['CTR', ...data.map(d => d.stats ? d.stats.avgCTR.toFixed(2) + '%' : '--')],
            ['CPC', ...data.map(d => d.stats ? formatCurrency(d.stats.avgCPC, 'USD') : '--')],
            ['CPM', ...data.map(d => d.stats ? formatCurrency(d.stats.avgCPM, 'USD') : '--')],
            ['Conv.', ...data.map(d => d.stats ? String(d.stats.totalConversions) : '--')],
            ['ROAS', ...data.map(d => d.stats ? d.stats.roas.toFixed(2) + 'x' : '--')],
            ['CPA', ...data.map(d => d.stats ? formatCurrency(d.stats.cpa, 'USD') : '--')],
            ['Fadiga', ...data.map(d => d.fatigue.fatigued ? '<i data-lucide="flame" style="width:14px;height:14px;vertical-align:-2px"></i> ' + d.fatigue.reason : '<i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> OK')],
        ];

        // Highlight best value per row
        const bestIdx = metricsRows.map((row, ri) => {
            if (ri === 7) return -1; // fatigue row
            const nums = row.slice(1).map(v => parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0);
            if (ri === 0 || ri === 2 || ri === 3 || ri === 6) {
                // Lower is better for spend, CPC, CPM, CPA
                return nums.indexOf(Math.min(...nums));
            }
            // Higher is better for CTR, Conv, ROAS
            return nums.indexOf(Math.max(...nums));
        });

        panel.style.display = 'block';
        panel.innerHTML = `<h4>Comparacao de Criativos</h4>
            <table class="compare-table">
                <thead><tr>${headers.map(h => `<th>${this._escapeHtml(h)}</th>`).join('')}</tr></thead>
                <tbody>${metricsRows.map((row, ri) => `<tr>${row.map((cell, ci) =>
                    `<td ${ci > 0 && bestIdx[ri] === ci - 1 ? 'class="compare-best"' : ''}>${cell}</td>`
                ).join('')}</tr>`).join('')}</tbody>
            </table>
            <button class="btn btn-secondary btn-sm" onclick="CreativesModule.toggleCompareMode()" style="margin-top:0.5rem">Fechar Comparacao</button>`;
    },

    renderFatigueSummary(creatives) {
        const summaryEl = document.getElementById('creative-fatigue-summary');
        if (!summaryEl) return;

        const fatigued = creatives.filter(c => {
            if (c.status === 'killed' || c.status === 'pausado') return false;
            return this.detectFatigue(c.id).fatigued;
        });

        if (fatigued.length === 0) {
            summaryEl.innerHTML = '';
            return;
        }

        summaryEl.innerHTML = `<div class="fatigue-alert">
            <strong><i data-lucide="alert-triangle" style="width:14px;height:14px;vertical-align:-2px"></i>️ ${fatigued.length} criativo(s) com fadiga detectada:</strong>
            <ul>${fatigued.map(c => {
                const f = this.detectFatigue(c.id);
                return `<li><strong>${this._escapeHtml(c.name)}</strong>: ${this._escapeHtml(f.reason)}</li>`;
            }).join('')}</ul>
        </div>`;
    },

    // ---- CSV import (planilha) ----
    // Robust single-pass parser: quoted fields (with embedded newlines/commas),
    // escaped doubled quotes, BOM, CRLF, and comma/semicolon/tab auto-detect.
    _parseDelimited(text) {
        if (text == null) return [];
        if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
        // detect delimiter from first (unquoted) line
        let firstLine = text, q = false;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === '"') q = !q;
            else if ((c === '\n' || c === '\r') && !q) { firstLine = text.slice(0, i); break; }
        }
        const countOutside = (ch) => { let n = 0, qq = false; for (let i = 0; i < firstLine.length; i++) { const c = firstLine[i]; if (c === '"') qq = !qq; else if (c === ch && !qq) n++; } return n; };
        const cand = [[',', countOutside(',')], [';', countOutside(';')], ['\t', countOutside('\t')]].sort((a, b) => b[1] - a[1]);
        const delim = cand[0][1] > 0 ? cand[0][0] : ',';

        const rows = []; let row = [], field = '', inQ = false;
        const pushF = () => { row.push(field); field = ''; };
        const pushR = () => { pushF(); rows.push(row); row = []; };
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (inQ) {
                if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
                else field += c;
                continue;
            }
            if (c === '"') inQ = true;
            else if (c === delim) pushF();
            else if (c === '\r') { /* swallow */ }
            else if (c === '\n') pushR();
            else field += c;
        }
        if (field.length || row.length) pushR();
        return rows.filter(r => r.some(cell => (cell || '').trim() !== ''));
    },

    _normHeader(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    },
    _findCol(headers, candidates) {
        const norm = headers.map(h => this._normHeader(h));
        for (const cand of candidates) {
            const cn = this._normHeader(cand);
            let idx = norm.indexOf(cn);
            if (idx >= 0) return idx;
            idx = norm.findIndex(h => h.includes(cn) && cn.length >= 3);
            if (idx >= 0) return idx;
        }
        return -1;
    },

    async importCsv(file) {
        try {
            const text = await file.text();
            const rows = this._parseDelimited(text);
            if (rows.length < 2) { showToast('Planilha vazia ou sem linhas de dados.', 'error'); return; }
            const headers = rows[0];
            const col = {
                name: this._findCol(headers, ['nome', 'nome do criativo', 'name', 'creative']),
                product: this._findCol(headers, ['produto', 'product']),
                type: this._findCol(headers, ['tipo', 'type']),
                angle: this._findCol(headers, ['angulo', 'angle']),
                hookType: this._findCol(headers, ['tipo de hook', 'hook tipo', 'hook type']),
                hookText: this._findCol(headers, ['texto do hook', 'hook texto', 'hook', 'hook text']),
                platform: this._findCol(headers, ['plataforma', 'platform']),
                status: this._findCol(headers, ['status', 'situacao']),
                launchDate: this._findCol(headers, ['lancamento', 'data de lancamento', 'launch', 'launch date', 'data']),
                primaryText: this._findCol(headers, ['texto principal', 'primary text', 'primary']),
                headline: this._findCol(headers, ['titulo', 'headline']),
                desc: this._findCol(headers, ['descricao', 'description']),
                country: this._findCol(headers, ['pais', 'mercado', 'country', 'region']),
                campaign: this._findCol(headers, ['campanha', 'campaign']),
                imageUrl: this._findCol(headers, ['imagem url', 'imagem', 'image url', 'image', 'url da imagem']),
            };
            if (col.name < 0 || col.product < 0) {
                showToast('A planilha precisa ter ao menos as colunas "nome" e "produto".', 'error');
                return;
            }

            const products = AppState.products || [];
            const normName = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            const findProduct = (name) => products.find(p => normName(p.name) === normName(name));
            const mapStatus = (raw) => {
                const s = this._normHeader(raw);
                if (/winner|vencedor/.test(s)) return 'winner';
                if (/kill|morto|descart/.test(s)) return 'killed';
                if (/paus/.test(s)) return 'pausado';
                if (/teste|test/.test(s)) return 'teste';
                return 'ativo';
            };
            const cell = (r, i) => (i >= 0 && i < r.length ? String(r[i] || '').trim() : '');

            let created = 0, skipped = 0; const skippedNames = [];
            for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                const name = cell(r, col.name);
                if (!name) { continue; }
                const prod = findProduct(cell(r, col.product));
                if (!prod) { skipped++; if (skippedNames.length < 5) skippedNames.push(cell(r, col.product) || name); continue; }
                const country = cell(r, col.country).toUpperCase();
                const data = {
                    id: generateId('crtv'),
                    productId: prod.id,
                    name,
                    type: cell(r, col.type) || 'UGC',
                    angle: cell(r, col.angle),
                    hookText: cell(r, col.hookText),
                    hookType: cell(r, col.hookType),
                    platform: cell(r, col.platform) || 'Meta Ads',
                    status: mapStatus(cell(r, col.status)),
                    launchDate: cell(r, col.launchDate) || todayISO(),
                    primaryText: cell(r, col.primaryText),
                    headline: cell(r, col.headline),
                    adDescription: cell(r, col.desc),
                    country,
                    campaign: cell(r, col.campaign),
                    imageUrl: cell(r, col.imageUrl),
                    mediaId: '', mediaType: '', mediaThumb: '', mediaName: '',
                    variations: [],
                    storeId: getWritableStoreId(prod.id),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };
                AppState.allCreatives = AppState.allCreatives || [];
                AppState.allCreatives.push(data);
                created++;
            }

            if (created > 0) {
                filterDataByStore();
                LocalStore.save('creatives', AppState.allCreatives);
                EventBus.emit('creativesChanged');
            }
            let msg = `${created} criativo(s) importado(s).`;
            if (skipped > 0) msg += ` ${skipped} ignorado(s) (produto não encontrado: ${skippedNames.join(', ')}${skipped > skippedNames.length ? '…' : ''}).`;
            showToast(msg, created > 0 ? 'success' : 'error');
        } catch (e) {
            console.error('importCsv failed', e);
            showToast('Erro ao importar a planilha. Verifique o formato.', 'error');
        }
    },

    downloadCsvTemplate() {
        const headers = ['nome', 'produto', 'tipo', 'angulo', 'hook_tipo', 'hook_texto', 'plataforma', 'status', 'lancamento', 'texto_principal', 'titulo', 'descricao', 'pais', 'campanha', 'imagem_url'];
        const example = ['UGC Hook Dor - Video 1', 'MB GT Line Sunglasses', 'UGC', 'Dor nas costas', 'Dor', 'Voce sabia que 80% das pessoas...', 'Meta Ads', 'ativo', todayISO(), 'Texto principal do anuncio', 'Titulo do anuncio', 'Descricao curta', 'DE', 'OCULOS GT', 'https://exemplo.com/imagem.jpg'];
        const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
        const csv = headers.join(',') + '\n' + example.map(esc).join(',') + '\n';
        const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'modelo-criativos.csv';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Modelo CSV baixado. Preencha e use "Importar planilha".', 'info');
    },

    _escapeHtml(raw) {
        return String(raw || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};

// Global helper for diary to look up creative names
function getCreativeName(id) {
    const c = (AppState.allCreatives || []).find(cr => cr.id === id);
    return c ? c.name : '';
}

document.addEventListener('DOMContentLoaded', () => CreativesModule.init());
