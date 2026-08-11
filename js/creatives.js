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

        // Traz o que entrou pela planilha no Mapa de Ads
        document.getElementById('btn-sync-admap-creatives')?.addEventListener('click', () => {
            this.syncFromAdMap();
            this.render();
        });

        // Bulk upload (multiple files at once)
        document.getElementById('btn-bulk-upload-creatives')?.addEventListener('click', () => this.openBulkModal());
        document.getElementById('creative-bulk-input')?.addEventListener('change', (e) => {
            const files = Array.from(e.target.files || []);
            if (files.length) this._bulkAddFiles(files);
            e.target.value = ''; // allow picking the same file again later
        });
        document.getElementById('creative-bulk-form')?.addEventListener('submit', (e) => this.handleBulkSubmit(e));
        document.getElementById('bulk-product')?.addEventListener('change', () => this._bulkRefreshCampaignList());

        // Dropzone: click anywhere + keyboard + drag & drop
        const dz = document.getElementById('bulk-dropzone');
        const fileInput = document.getElementById('creative-bulk-input');
        if (dz && fileInput) {
            const openPicker = (e) => {
                // ignore clicks on the X buttons or "add more" (they have their own handlers)
                if (e.target.closest('.bulk-file-x') || e.target.closest('.bulk-add-more')) return;
                fileInput.click();
            };
            dz.addEventListener('click', openPicker);
            dz.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
            });
            ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => {
                e.preventDefault(); e.stopPropagation();
                dz.classList.add('bulk-dropzone-hover');
            }));
            ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => {
                e.preventDefault(); e.stopPropagation();
                if (ev === 'dragleave' && dz.contains(e.relatedTarget)) return;
                dz.classList.remove('bulk-dropzone-hover');
            }));
            dz.addEventListener('drop', (e) => {
                const files = Array.from(e.dataTransfer?.files || []);
                if (files.length) this._bulkAddFiles(files);
            });
        }
        // Prevent the browser from navigating away if the user drops a file outside the dropzone
        ['dragover', 'drop'].forEach(ev => window.addEventListener(ev, (e) => {
            // only prevent default while bulk modal is open
            const modal = document.getElementById('creative-bulk-modal');
            if (modal && !modal.classList.contains('hidden')) e.preventDefault();
        }));

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
        // A imagem pode estar no IndexedDB (mediaId) em vez de embutida em imageUrl.
        if (!creative || !(creative.imageUrl || creative.mediaId || creative.mediaThumb)) {
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

    // ---- Nome automático do criativo ----
    // Arquivo "IMG_1234.mp4", hash de export de IA ou screenshot não diz nada
    // — nesses casos cai pro nome montado a partir do formulário.
    _ARQUIVO_SEM_NOME_UTIL: /^(img|imagem|image|dsc|dscn|vid|video|mov|movie|whatsapp[\s_-]?(image|video)|screenshot|captura([\s_-]?de[\s_-]?tela)?|print|download|arquivo|file|export|output|untitled|sem[\s_-]?t[ií]tulo|new[\s_-]?(image|video)|photo|foto|clipboard)([\s_-].*)?$/i,

    _nomeDoArquivoUtil(fileName) {
        if (!fileName) return '';
        let base = String(fileName).replace(/\.[^./\\]+$/, '').trim();
        if (!base) return '';
        // UUID ou hash puro (nome de export automático) não é nome nenhum
        if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(base)) return '';
        if (/^[0-9a-f]{10,}$/i.test(base)) return '';
        if (this._ARQUIVO_SEM_NOME_UTIL.test(base)) return '';
        base = base.replace(/[_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
        if (!base) return '';
        return (base[0].toUpperCase() + base.slice(1)).slice(0, 80);
    },

    // Nome automático do criativo. Prioriza o nome do arquivo quando ele diz
    // algo de útil; sem isso, monta a partir do que já foi preenchido no
    // formulário (produto, tipo, ângulo/hook), com contador pra não colidir
    // com um criativo existente do mesmo produto com o mesmo rótulo.
    _gerarNomeAutomatico({ fileName, productId, type, angle, hookType } = {}) {
        const doArquivo = this._nomeDoArquivoUtil(fileName);
        if (doArquivo) return doArquivo;

        const p = productId ? (AppState.allProducts || AppState.products || []).find(x => x.id === productId) : null;
        const partes = [p?.name, type, String(angle || hookType || '').trim()].filter(Boolean);
        const rotulo = partes.length ? partes.join(' — ') : 'Criativo';
        if (!productId) return rotulo;
        const existentes = (AppState.allCreatives || []).filter(c =>
            c.productId === productId && (c.name || '').startsWith(rotulo)).length;
        return existentes ? `${rotulo} #${existentes + 1}` : rotulo;
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

        // Imagem: comprime pra JPEG (lado maior até 1500px, nunca aumenta) antes
        // de guardar — os criativos que sobem costumam ser PNG de vários MB, e
        // isso pesa tanto no IndexedDB quanto no upload do formulário.
        let arquivoFinal = file;
        if (!isVideo) {
            try {
                const { blob, comprimiu } = await comprimirImagem(file);
                if (comprimiu) {
                    const base = (file.name || 'imagem').replace(/\.[^.]+$/, '');
                    arquivoFinal = new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
                }
            } catch (e) { console.warn('compressão falhou, usando arquivo original', e); }
        }

        let thumb = '';
        try {
            thumb = isVideo ? await this._videoThumb(arquivoFinal) : await this._imageThumb(arquivoFinal);
        } catch (e) { console.warn('thumb failed', e); }
        const prev = this._formMedia || {};
        this._formMedia = {
            file: arquivoFinal,
            mediaType: isVideo ? 'video' : 'image',
            mediaThumb: thumb || '',
            mediaName: arquivoFinal.name || '',
            mediaId: '',
            prevMediaId: prev.prevMediaId || prev.mediaId || '',
            changed: true,
            removed: false,
        };
        this._renderFormMediaPreview();

        // Sugere o nome a partir do arquivo — só se o usuário ainda não
        // escreveu nada, pra nunca sobrescrever o que ele já digitou.
        const nameInput = document.getElementById('creative-name');
        if (nameInput && !nameInput.value.trim()) {
            nameInput.value = this._gerarNomeAutomatico({
                fileName: file.name,
                productId: document.getElementById('creative-product')?.value || '',
                type: document.getElementById('creative-type')?.value || '',
            });
        }
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
        body.innerHTML = '<div class="creative-lightbox-loading">' + window.loadingHTML('Carregando…') + '</div>';
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
            const pgIn = document.getElementById('creative-page-url'); if (pgIn) pgIn.value = creative.pageUrl || '';
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

        const typeVal = document.getElementById('creative-type').value;
        const angleVal = document.getElementById('creative-angle').value.trim();
        const hookTypeVal = document.getElementById('creative-hook-type').value;
        // Sem arquivo (ex.: só colou uma URL de imagem) e sem nome digitado —
        // o nome nunca fica vazio, mas também nunca sobrescreve o que o
        // usuário escreveu.
        const nameVal = document.getElementById('creative-name').value.trim()
            || this._gerarNomeAutomatico({ productId, type: typeVal, angle: angleVal, hookType: hookTypeVal });

        const data = {
            id,
            productId,
            name: nameVal,
            type: typeVal,
            angle: angleVal,
            hookText: document.getElementById('creative-hook-text').value.trim(),
            hookType: hookTypeVal,
            platform: document.getElementById('creative-platform').value,
            status: document.getElementById('creative-status').value || 'ativo',
            launchDate: document.getElementById('creative-launch-date').value,
            pageUrl: (document.getElementById('creative-page-url')?.value || '').trim(),
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

    // ============================================================
    //  BULK UPLOAD — sobe vários arquivos de uma vez
    // ============================================================
    _bulkFiles: [],

    openBulkModal() {
        this._bulkFiles = [];
        const modal = document.getElementById('creative-bulk-modal');
        if (!modal) return;

        // Populate product dropdown
        const prodSel = document.getElementById('bulk-product');
        if (prodSel) {
            prodSel.innerHTML = '<option value="">— Selecione um produto —</option>';
            (AppState.products || []).forEach(p => {
                if (p.status === 'ativo') {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    prodSel.appendChild(opt);
                }
            });
        }

        // Populate country dropdown
        const cSel = document.getElementById('bulk-country');
        if (cSel) cSel.innerHTML = '<option value="">— (sem país) —</option>' + this._countryOptionsHtml('');

        // Reset form fields
        document.getElementById('creative-bulk-form')?.reset();
        this._renderBulkFilesPreview(); // resets to empty state
        const progress = document.getElementById('bulk-progress');
        if (progress) progress.style.display = 'none';
        const submit = document.getElementById('bulk-submit-btn');
        if (submit) { submit.disabled = true; submit.textContent = 'Subir 0 criativos'; }

        modal.classList.remove('hidden');
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    },

    closeBulkModal() {
        const modal = document.getElementById('creative-bulk-modal');
        if (modal) modal.classList.add('hidden');
        this._bulkFiles = [];
        const inp = document.getElementById('creative-bulk-input');
        if (inp) inp.value = '';
    },

    _bulkRefreshCampaignList() {
        const prodSel = document.getElementById('bulk-product');
        const dl = document.getElementById('bulk-campaign-list');
        if (!prodSel || !dl) return;
        const names = this._campaignNamesForProduct(prodSel.value);
        dl.innerHTML = names.map(n => `<option value="${this._escapeHtml(n)}">`).join('');
    },

    _bulkAddFiles(files) {
        const MAX = 60 * 1024 * 1024; // 60MB per file
        const accepted = [];
        let skipped = 0;
        for (const f of files) {
            if (!f) continue;
            if (f.size > MAX) { skipped++; continue; }
            const type = (f.type || '').toLowerCase();
            if (!type.startsWith('image') && !type.startsWith('video')) { skipped++; continue; }
            accepted.push(f);
        }
        this._bulkFiles = this._bulkFiles.concat(accepted);
        if (skipped > 0) showToast(`${skipped} arquivo(s) ignorados (formato ou > 60MB).`, 'warning');
        this._renderBulkFilesPreview();
    },

    _bulkRemoveFile(idx) {
        this._bulkFiles.splice(idx, 1);
        this._renderBulkFilesPreview();
    },

    _renderBulkFilesPreview() {
        const box = document.getElementById('bulk-files-preview');
        const empty = document.getElementById('bulk-dropzone-empty');
        const more = document.getElementById('bulk-add-more');
        const submit = document.getElementById('bulk-submit-btn');
        const dz = document.getElementById('bulk-dropzone');
        if (!box) return;
        const n = this._bulkFiles.length;

        if (n === 0) {
            if (empty) empty.style.display = '';
            box.style.display = 'none';
            if (more) more.style.display = 'none';
            if (dz) dz.classList.remove('bulk-dropzone-filled');
            if (submit) { submit.disabled = true; submit.textContent = 'Subir 0 criativos'; }
            return;
        }

        if (empty) empty.style.display = 'none';
        box.style.display = '';
        if (more) more.style.display = '';
        if (dz) dz.classList.add('bulk-dropzone-filled');

        const totalMB = (this._bulkFiles.reduce((s, f) => s + (f.size || 0), 0) / 1024 / 1024).toFixed(1);
        const items = this._bulkFiles.map((f, i) => {
            const isVid = (f.type || '').startsWith('video');
            const icon = isVid ? 'video' : 'image';
            const sizeMB = (f.size / 1024 / 1024).toFixed(2);
            return `<div class="bulk-file-item">
                <i data-lucide="${icon}" style="width:14px;height:14px;color:var(--text-muted);flex-shrink:0"></i>
                <span class="bulk-file-name" title="${this._escapeHtml(f.name)}">${this._escapeHtml(f.name)}</span>
                <span class="bulk-file-size">${sizeMB} MB</span>
                <button type="button" class="bulk-file-x" onclick="event.stopPropagation();CreativesModule._bulkRemoveFile(${i})" title="Remover">&times;</button>
            </div>`;
        }).join('');
        box.innerHTML = `<div class="bulk-files-header">${n} arquivo${n > 1 ? 's' : ''} · ${totalMB} MB total</div>${items}`;

        // Re-wire "add more" button (innerHTML didn't replace it but make sure)
        if (more && !more._wired) {
            more.addEventListener('click', (e) => {
                e.stopPropagation();
                document.getElementById('creative-bulk-input')?.click();
            });
            more._wired = true;
        }

        if (submit) { submit.disabled = false; submit.textContent = `Subir ${n} criativo${n > 1 ? 's' : ''}`; }
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    },

    async handleBulkSubmit(e) {
        e.preventDefault();
        const productId = document.getElementById('bulk-product').value;
        if (!productId) { showToast('Selecione um produto.', 'error'); return; }
        if (!this._bulkFiles.length) { showToast('Escolha pelo menos um arquivo.', 'error'); return; }

        const defaults = {
            country: (document.getElementById('bulk-country').value || '').toUpperCase(),
            campaign: (document.getElementById('bulk-campaign').value || '').trim(),
            type: document.getElementById('bulk-type').value || '',
            angle: (document.getElementById('bulk-angle').value || '').trim(),
            platform: document.getElementById('bulk-platform').value || 'Meta Ads',
        };

        const total = this._bulkFiles.length;
        const progress = document.getElementById('bulk-progress');
        const fill = document.getElementById('bulk-progress-fill');
        const text = document.getElementById('bulk-progress-text');
        const submitBtn = document.getElementById('bulk-submit-btn');
        if (progress) progress.style.display = 'block';
        if (submitBtn) submitBtn.disabled = true;

        let ok = 0, fail = 0;
        const createdCreatives = [];

        for (let i = 0; i < total; i++) {
            const arquivoOriginal = this._bulkFiles[i];
            try {
                const isVideo = (arquivoOriginal.type || '').startsWith('video');
                const mediaType = defaults.type || (isVideo ? 'video' : 'imagem');
                const mediaTypeStored = isVideo ? 'video' : 'image';

                // Imagem: comprime pra JPEG (lado maior até 1500px, nunca aumenta)
                // antes de guardar — mesmo motor do formulário único.
                let file = arquivoOriginal;
                if (!isVideo) {
                    try {
                        const { blob, comprimiu } = await comprimirImagem(arquivoOriginal);
                        if (comprimiu) {
                            const base = (arquivoOriginal.name || 'imagem').replace(/\.[^.]+$/, '');
                            file = new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
                        }
                    } catch (err) { console.warn('compressão falhou para', arquivoOriginal.name, err); }
                }

                // Generate thumbnail
                let thumb = '';
                try {
                    thumb = isVideo ? await this._videoThumb(file) : await this._imageThumb(file);
                } catch (err) { console.warn('thumb failed for', file.name, err); }

                // Store blob in IndexedDB
                let mediaId = '';
                if (typeof MediaStore !== 'undefined' && MediaStore.isSupported()) {
                    mediaId = generateId('media');
                    try {
                        await MediaStore.put(mediaId, file, { type: mediaTypeStored, name: file.name });
                    } catch (err) {
                        console.warn('MediaStore put failed', err);
                        mediaId = '';
                    }
                }

                // Nome automático — mesma lógica do formulário único, pra não
                // ter dois jeitos de nomear criativo na ferramenta. Usa o nome
                // ORIGINAL do arquivo (antes da troca de extensão pra .jpg).
                const nameWithoutExt = this._gerarNomeAutomatico({ fileName: arquivoOriginal.name, productId, type: mediaType })
                    || `Criativo ${i + 1}`;

                const data = {
                    id: generateId('crtv'),
                    productId,
                    name: nameWithoutExt,
                    type: mediaType,
                    angle: defaults.angle,
                    hookText: '',
                    hookType: '',
                    platform: defaults.platform,
                    status: 'ativo',
                    launchDate: todayISO(),
                    primaryText: '',
                    headline: '',
                    adDescription: '',
                    country: defaults.country,
                    campaign: defaults.campaign,
                    mediaId,
                    mediaType: mediaTypeStored,
                    mediaThumb: thumb || '',
                    mediaName: file.name || '',
                    imageUrl: '',
                    variations: [],
                    storeId: getWritableStoreId(productId),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                };

                AppState.allCreatives.push(data);
                createdCreatives.push(data);
                ok++;
            } catch (err) {
                console.error('bulk upload error for', file?.name, err);
                fail++;
            }

            // Update progress
            const pct = Math.round(((i + 1) / total) * 100);
            if (fill) fill.style.width = pct + '%';
            if (text) text.textContent = `Processando ${i + 1} de ${total}… (${ok} ok${fail ? ', ' + fail + ' falha' : ''})`;
        }

        // Persist all at once (uses StorageManager auto-reclaim if needed)
        filterDataByStore();
        LocalStore.save('creatives', AppState.allCreatives);

        // Sync to Sheets (optional)
        if (AppState.sheetsConnected && typeof SheetsAPI !== 'undefined' && SheetsAPI.TABS.CREATIVES) {
            for (const c of createdCreatives) {
                try { await SheetsAPI.appendRow(SheetsAPI.TABS.CREATIVES, SheetsAPI.creativeToRow(c)); }
                catch (err) { console.warn('Sheets sync failed for', c.id, err); }
            }
        }

        EventBus.emit('creativesChanged');

        if (text) text.textContent = `Concluído! ${ok} criativo${ok !== 1 ? 's' : ''} adicionado${ok !== 1 ? 's' : ''}${fail ? `, ${fail} falha${fail > 1 ? 's' : ''}` : ''}.`;
        if (fail > 0) showToast(`${ok} criativos adicionados, ${fail} falharam.`, 'warning');
        else showToast(`<i data-lucide="check-circle-2" style="width:13px;height:13px;vertical-align:-2px"></i> ${ok} criativo${ok !== 1 ? 's' : ''} adicionado${ok !== 1 ? 's' : ''} com sucesso!`, 'success');

        // Close modal after a short delay so user sees completion
        setTimeout(() => this.closeBulkModal(), 1200);
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

    // ---- Clonar criativo (nova variação de ângulo/hook) ----
    // Herda produto/país/campanha/plataforma e COPIA a mídia pra um novo id.
    // Copiar é obrigatório: deleteCreative() apaga o blob do MediaStore, então
    // compartilhar mediaId faria excluir o clone destruir a mídia do original.
    async duplicateCreative(creativeId) {
        const src = this.getCreativeById(creativeId);
        if (!src) return;

        const base = String(src.name || 'Criativo').replace(/\s*\(v\d+\)\s*$/i, '');
        const sameBase = (AppState.allCreatives || []).filter(c =>
            String(c.name || '').replace(/\s*\(v\d+\)\s*$/i, '') === base).length;
        const novo = {
            ...src,
            id: generateId('creative'),
            name: `${base} (v${sameBase + 1})`,
            status: 'ativo',
            launchDate: todayISO(),      // conta o tempo no ar a partir de hoje
            variations: [],              // métricas/variações não são herdadas
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            mediaId: null,
        };

        // Copia o blob da mídia pra um id próprio
        if (src.mediaId && typeof MediaStore !== 'undefined' && MediaStore.isSupported?.()) {
            try {
                const rec = await MediaStore.get(src.mediaId);
                if (rec && rec.blob) {
                    const newMediaId = generateId('media');
                    await MediaStore.put(newMediaId, rec.blob, { type: rec.type, name: rec.name });
                    novo.mediaId = newMediaId;
                }
            } catch (err) {
                console.warn('[Creatives] copia de midia falhou, clonando sem midia:', err);
                novo.mediaThumb = '';
            }
        }

        AppState.allCreatives.push(novo);
        LocalStore.save('creatives', AppState.allCreatives);
        if (typeof filterDataByStore === 'function') filterDataByStore();
        EventBus.emit('creativesChanged');
        this.render();
        if (typeof showToast === 'function') showToast(`Variação criada: ${novo.name} — ajuste ângulo/hook`, 'success');
        // Abre já no formulário pra editar ângulo/hook
        setTimeout(() => this.openForm(this.getCreativeById(novo.id)), 250);
    },

    // Atalho: gerar imagem nova por IA a partir deste criativo
    sendToAiGenerator(creativeId) {
        const c = this.getCreativeById(creativeId);
        if (!c) return;
        try {
            const prod = (AppState.allProducts || AppState.products || []).find(p => p.id === c.productId);
            const seed = {
                productId: c.productId,
                productName: prod?.name || '',
                angle: c.angle || '',
                hook: c.hookText || '',
                headline: c.headline || '',
                fromCreativeId: c.id,
            };
            sessionStorage.setItem('etracker_ai_seed', JSON.stringify(seed));
        } catch {}
        document.querySelector('.tab-btn[data-tab="ai-generations"]')?.click();
        if (typeof showToast === 'function') showToast('Abrindo AI Generations com o contexto deste criativo', 'info');
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

    // ============================================================
    //  SINCRONIZAÇÃO COM O MAPA DE ADS
    //  Os criativos que chegam pela planilha (CSV do Facebook) vivem em
    //  AdHierarchyModule. Aqui eles viram criativos de verdade, com as
    //  métricas diárias somadas de TODOS os conjuntos que rodam o mesmo nome.
    // ============================================================

    // Mesmo nome, escrito diferente (acento/caixa/espaço), é o mesmo criativo.
    _syncKey(s) {
        return String(s || '').toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    },

    // Percorre anúncio → conjunto → campanha para descobrir de que produto ele é.
    _adMapGroups() {
        const AH = window.AdHierarchyModule;
        if (!AH || !AH._state) return null;

        const setById = new Map((AH._state.adsets || []).map(a => [a.id, a]));
        const campById = new Map((AH._state.campaigns || []).map(c => [c.id, c]));
        const grupos = new Map();
        let semProduto = 0;

        (AH._state.ads || []).forEach(ad => {
            if (!ad?.name) return;
            const set = setById.get(ad.adsetId);
            const camp = set ? campById.get(set.campaignId) : null;
            const pid = camp?.productId || '';
            // Sem produto vinculado não dá pra saber onde encaixar o criativo.
            if (!pid) { semProduto++; return; }

            const chave = pid + '||' + this._syncKey(ad.name);
            let g = grupos.get(chave);
            if (!g) {
                g = { productId: pid, name: ad.name, ads: [], conjuntos: new Set(),
                      campanhas: new Set(), paises: new Set(), diario: {}, validado: false };
                grupos.set(chave, g);
            }
            g.ads.push(ad);
            if (set?.id) g.conjuntos.add(set.id);   // por id: dois conjuntos podem ter o mesmo nome
            if (camp?.name) g.campanhas.add(camp.name);
            if (ad.region) g.paises.add(ad.region);
            if (ad.validated) g.validado = true;

            // daily = { 'YYYY-MM-DD': [impr, cliques, gasto, lpv, atc, ic, compras] }
            Object.entries(ad.daily || {}).forEach(([dia, v]) => {
                const d = g.diario[dia] || [0, 0, 0, 0, 0, 0, 0];
                for (let i = 0; i < 7; i++) d[i] += Number(v[i]) || 0;
                g.diario[dia] = d;
            });
        });

        return { grupos, semProduto };
    },

    // Receita não vem no CSV do Facebook (só compras). Estimamos pelo preço do
    // produto, convertido pra moeda do gasto — e marcamos como estimada, porque
    // inventar receita sem avisar seria mentir no ROAS.
    _precoEstimado(productId, moedaGasto) {
        const p = (AppState.allProducts || []).find(x => x.id === productId);
        const preco = Number(p?.price) || 0;
        if (!preco) return 0;
        const de = p.priceCurrency || 'USD';
        if (de === moedaGasto) return preco;
        try { return convertCurrency(preco, de, moedaGasto) || 0; } catch { return 0; }
    },

    syncFromAdMap({ silent = false } = {}) {
        const dados = this._adMapGroups();
        if (!dados) {
            if (!silent) showToast('Mapa de Ads indisponível.', 'error');
            return { criados: 0, atualizados: 0, dias: 0, semProduto: 0 };
        }
        const { grupos, semProduto } = dados;
        if (!grupos.size) {
            if (!silent) {
                showToast(semProduto
                    ? `Nenhum criativo sincronizado: ${semProduto} anúncios do mapa não estão vinculados a um produto.`
                    : 'Nenhum criativo no Mapa de Ads ainda. Importe um CSV lá primeiro.', 'warning');
            }
            return { criados: 0, atualizados: 0, dias: 0, semProduto };
        }

        const moeda = (window.AdHierarchyModule?._state?.currency) || 'USD';
        AppState.allCreatives = AppState.allCreatives || [];
        AppState.allCreativeMetrics = AppState.allCreativeMetrics || [];

        let criados = 0, atualizados = 0, dias = 0;
        const idsSincronizados = new Set();

        grupos.forEach(g => {
            const nk = this._syncKey(g.name);
            let cr = AppState.allCreatives.find(c =>
                c.productId === g.productId && this._syncKey(c.name) === nk);

            const datas = Object.keys(g.diario).sort();
            const estreia = datas[0] || g.ads.map(a => a.firstSeen).filter(Boolean).sort()[0] || '';
            // Ativo se qualquer conjunto ainda está rodando esse criativo.
            const rodando = g.ads.some(a => String(a.status || '').toUpperCase() === 'ACTIVE');
            const pais = [...g.paises][0] || '';

            if (!cr) {
                cr = {
                    id: generateId('cr'),
                    productId: g.productId,
                    name: g.name,
                    type: '', angle: '', hookText: '', hookType: '',
                    platform: 'facebook',
                    status: g.validado ? 'winner' : (rodando ? 'ativo' : 'pausado'),
                    launchDate: estreia,
                    pageUrl: '',
                    primaryText: '', headline: '', adDescription: '',
                    country: pais,
                    campaign: [...g.campanhas][0] || '',
                    mediaId: '', mediaType: '', mediaThumb: '', mediaName: '', imageUrl: '',
                    variations: [],
                    storeId: getWritableStoreId(g.productId),
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };
                AppState.allCreatives.push(cr);
                criados++;
            } else {
                // Não sobrescreve o que o usuário escreveu à mão — só preenche buracos.
                if (!cr.launchDate && estreia) cr.launchDate = estreia;
                if (!cr.country && pais) cr.country = pais;
                if (!cr.campaign && g.campanhas.size) cr.campaign = [...g.campanhas][0];
                if (!cr.platform) cr.platform = 'facebook';
                // Status manual ("winner"/"killed") é decisão do usuário; só mexe no automático.
                if (cr.status === 'ativo' || cr.status === 'pausado') {
                    cr.status = rodando ? 'ativo' : 'pausado';
                }
                cr.updatedAt = new Date().toISOString();
                atualizados++;
            }

            // A imagem que o usuário subiu no board vale aqui também.
            const doBoard = window.AdHierarchyModule?._mediaForCreative?.(g.ads[0]);
            if (doBoard && !cr.mediaId && !cr.imageUrl && !cr.mediaThumb) cr.mediaThumb = doBoard;

            cr.adMapSync = {
                conjuntos: g.conjuntos.size,
                campanhas: g.campanhas.size,
                anuncios: g.ads.length,
                em: new Date().toISOString()
            };
            idsSincronizados.add(cr.id);

            const precoUn = this._precoEstimado(g.productId, moeda);

            // Reescreve só as linhas que vieram do mapa; as digitadas à mão ficam.
            AppState.allCreativeMetrics = AppState.allCreativeMetrics.filter(
                m => !(m.creativeId === cr.id && m.source === 'admap'));

            datas.forEach(dia => {
                const [impr, cliques, gasto, lpv, atc, ic, compras] = g.diario[dia];
                if (!impr && !cliques && !gasto && !compras) return;
                const receita = precoUn * compras;
                AppState.allCreativeMetrics.push({
                    id: 'cm_admap_' + cr.id + '_' + dia,
                    creativeId: cr.id,
                    date: dia,
                    spend: Math.round(gasto * 100) / 100,
                    impressions: Math.round(impr),
                    clicks: Math.round(cliques),
                    ctr: impr > 0 ? parseFloat((cliques / impr * 100).toFixed(2)) : 0,
                    cpc: cliques > 0 ? parseFloat((gasto / cliques).toFixed(2)) : 0,
                    cpm: impr > 0 ? parseFloat((gasto / impr * 1000).toFixed(2)) : 0,
                    conversions: Math.round(compras),
                    revenue: Math.round(receita * 100) / 100,
                    roas: gasto > 0 ? parseFloat((receita / gasto).toFixed(2)) : 0,
                    // Funil, pra ranquear onde o criativo perde gente
                    lpv: Math.round(lpv), atc: Math.round(atc), ic: Math.round(ic),
                    currency: moeda,
                    revenueEstimated: receita > 0,
                    source: 'admap',
                    storeId: cr.storeId || ''
                });
                dias++;
            });
        });

        // Criativo apagado do mapa não deixa métrica órfã pra trás.
        AppState.allCreativeMetrics = AppState.allCreativeMetrics.filter(
            m => m.source !== 'admap' || idsSincronizados.has(m.creativeId));

        if (typeof filterDataByStore === 'function') filterDataByStore();
        LocalStore.save('creatives', AppState.allCreatives);
        LocalStore.save('creative_metrics', AppState.allCreativeMetrics);
        EventBus.emit('creativesChanged');

        if (!silent) {
            const partes = [];
            if (criados) partes.push(`${criados} criado(s)`);
            if (atualizados) partes.push(`${atualizados} atualizado(s)`);
            let msg = `Criativos sincronizados: ${partes.join(', ') || 'nada novo'} · ${dias} dias de métricas.`;
            if (semProduto) msg += ` (${semProduto} anúncios ignorados: campanha sem produto vinculado)`;
            showToast(msg, 'success');
        }
        return { criados, atualizados, dias, semProduto };
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
        const totalLpv = metrics.reduce((s, m) => s + (Number(m.lpv) || 0), 0);
        const totalAtc = metrics.reduce((s, m) => s + (Number(m.atc) || 0), 0);
        const totalIc = metrics.reduce((s, m) => s + (Number(m.ic) || 0), 0);
        const doMapa = metrics.filter(m => m.source === 'admap');

        return {
            totalSpend,
            totalClicks,
            totalImpressions,
            totalConversions,
            totalRevenue,
            totalLpv, totalAtc, totalIc,
            // A moeda vem do CSV; sem isso o gasto em libra apareceria como dólar.
            currency: metrics.find(m => m.currency)?.currency || 'USD',
            // ROAS estimado pelo preço do produto — o CSV do Facebook não traz receita.
            revenueEstimated: doMapa.some(m => m.revenueEstimated),
            fromAdMap: doMapa.length > 0,
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
            const medal = ['<i data-lucide="award" style="width:13px;height:13px;vertical-align:-2px"></i>', '<i data-lucide="medal" style="width:13px;height:13px;vertical-align:-2px"></i>', '<i data-lucide="medal" style="width:13px;height:13px;vertical-align:-2px"></i>'][i] || '';
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
            ${creative.pageUrl ? `<a class="creative-chip creative-chip-page" href="${this._escapeHtml(creative.pageUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Abrir a página que roda este criativo: ${this._escapeHtml(creative.pageUrl)}"><i data-lucide="external-link" style="width:11px;height:11px;vertical-align:-1px"></i> Página</a>` : ''}
        </div>`;

        return `<div class="creative-card ${fatigue.fatigued ? 'creative-fatigued' : ''} ${creative.status === 'winner' ? 'creative-winner' : ''} ${isBest ? 'creative-best' : ''}">
            ${thumbHtml}
            <div class="creative-card-header">
                <div>
                    <strong class="creative-card-name">${isBest ? '<span class="creative-best-flag" title="Melhor desempenho neste grupo"><i data-lucide="trophy" style="width:13px;height:13px;vertical-align:-2px"></i></span> ' : ''}${this._escapeHtml(creative.name)}</strong>
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
                <div class="creative-metric"><label>Gasto</label><strong>${formatCurrency(stats.totalSpend, stats.currency)}</strong></div>
                <div class="creative-metric"><label>CTR</label><strong>${stats.avgCTR.toFixed(2)}%</strong></div>
                <div class="creative-metric"><label>CPC</label><strong>${formatCurrency(stats.avgCPC, stats.currency)}</strong></div>
                <div class="creative-metric"><label>CPA</label><strong>${stats.totalConversions > 0 ? formatCurrency(stats.cpa, stats.currency) : '--'}</strong></div>
                <div class="creative-metric"><label>Compras</label><strong>${stats.totalConversions}</strong></div>
                ${stats.revenueEstimated
                    ? `<div class="creative-metric" title="ROAS estimado: o CSV do Facebook não traz receita, então usamos o preço cadastrado do produto × compras."><label>ROAS <span class="creative-metric-est">est.</span></label><strong>${stats.roas.toFixed(2)}x</strong></div>`
                    : `<div class="creative-metric"><label>${stats.totalRevenue > 0 ? 'ROAS' : 'CPM'}</label><strong>${stats.totalRevenue > 0 ? stats.roas.toFixed(2) + 'x' : formatCurrency(stats.avgCPM, stats.currency)}</strong></div>`}
            </div>
            ${stats.fromAdMap && creative.adMapSync ? `<div class="creative-admap-note" title="Métricas somadas de todos os conjuntos que rodam este criativo"><i data-lucide="git-merge" style="width:11px;height:11px;vertical-align:-1px"></i> ${creative.adMapSync.conjuntos} conjunto(s) · ${stats.days} dia(s) de dados — via planilha</div>` : ''}`
            : `<div class="creative-no-metrics">Sem metricas registradas${creative.adMapSync ? '' : ' — importe o CSV no Mapa de Ads ou clique em "+ Metrica"'}</div>`}

            ${variations.length > 0 ? this.renderVariations(creative.id, variations) : ''}

            <div class="creative-card-actions">
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.openForm(CreativesModule.getCreativeById('${creative.id}'))">Editar</button>
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.openMetricForm('${creative.id}')">+ Metrica</button>
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.openVariationForm('${creative.id}')"><i data-lucide="flask-conical" style="width:14px;height:14px;vertical-align:-2px"></i> Testar Variacao</button>
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.duplicateCreative('${creative.id}')" title="Clonar herdando produto/país/campanha — troque ângulo e hook"><i data-lucide="copy-plus" style="width:14px;height:14px;vertical-align:-2px"></i> Nova variação</button>
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.sendToAiGenerator('${creative.id}')" title="Gerar imagem nova por IA a partir deste criativo"><i data-lucide="sparkles" style="width:14px;height:14px;vertical-align:-2px"></i> IA</button>
                ${(creative.imageUrl || creative.mediaId || creative.mediaThumb) ? `<button class="btn btn-primary btn-sm" onclick="CreativesModule.sendToAdLauncher('${creative.id}')"><i data-lucide="send" style="width:14px;height:14px;vertical-align:-2px"></i> Lançar Anúncio</button>` : ''}
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

// `const` nao vira propriedade de window — outros modulos acessam por aqui.
window.CreativesModule = CreativesModule;
document.addEventListener('DOMContentLoaded', () => CreativesModule.init());
