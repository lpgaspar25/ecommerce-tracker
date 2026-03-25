/* ===========================
   swipe.js — Swipe File / Creative References
   Paste TikTok/IG/FB/YouTube links → auto-fetch → transcribe → Hook/Body/CTA → PT translation
   =========================== */

const SwipeModule = {
    _storageKey: 'etracker_swipe',
    _openAIKeyKey: 'swipe_openai_api_key',
    _PROXY_URL: 'https://swipe-media-proxy.lucasmedia.workers.dev',
    _entries: [],
    _filter: { platform: 'all', format: 'all', type: 'all', search: '' },
    _editingId: null,
    _fetchedData: null,

    PLATFORMS: {
        tiktok:    { label: 'TikTok',    color: '#010101', badge: '🎵' },
        instagram: { label: 'Instagram', color: '#e1306c', badge: '📸' },
        facebook:  { label: 'Facebook',  color: '#1877f2', badge: '👍' },
        youtube:   { label: 'YouTube',   color: '#ff0000', badge: '▶️' },
        other:     { label: 'Outro',     color: '#6b7280', badge: '🔗' },
    },

    FORMATS: ['Vídeo', 'Reels', 'Story', 'Carrossel', 'Imagem', 'Live', 'Outro'],
    TYPES:   ['UGC', 'Demonstrativo', 'Depoimento', 'POV', 'Antes/Depois', 'Tutorial', 'Humor/Meme', 'Review', 'Challenge'],

    // ── Init ────────────────────────────────────────────────────────────────
    init() {
        this._load();
        this._bindEvents();
    },

    _bindEvents() {
        document.getElementById('btn-add-swipe')?.addEventListener('click', () => this._openModal());

        // Sub-tab switching
        document.querySelectorAll('.creative-subtabs-row .creative-subtab').forEach(btn => {
            btn.addEventListener('click', () => this._switchSubTab(btn.dataset.subtab));
        });

        // Filter events
        document.getElementById('swipe-search')?.addEventListener('input', (e) => {
            this._filter.search = e.target.value.toLowerCase();
            this._renderGrid();
        });
        ['swipe-filter-platform', 'swipe-filter-format', 'swipe-filter-type'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', (e) => {
                const key = id.replace('swipe-filter-', '');
                this._filter[key] = e.target.value;
                this._renderGrid();
            });
        });

        // Modal: URL fetch
        document.getElementById('swipe-url-fetch-btn')?.addEventListener('click', () => this._fetchURL());
        document.getElementById('swipe-url-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._fetchURL(); }
        });

        // Modal: AI actions
        document.getElementById('swipe-analyze-btn')?.addEventListener('click', () => this._analyzeWithClaude());
        document.getElementById('swipe-transcribe-btn')?.addEventListener('click', () => this._autoTranscribe());

        // Modal: Drive upload + open original
        document.getElementById('swipe-drive-upload-btn')?.addEventListener('click', () => this._uploadVideoToDrive());
        document.getElementById('swipe-open-original-btn')?.addEventListener('click', () => {
            const url = document.getElementById('swipe-url-input')?.value;
            if (url) window.open(url, '_blank', 'noopener');
        });

        // Modal: save + close
        document.getElementById('swipe-form')?.addEventListener('submit', (e) => this._handleSave(e));
        document.getElementById('swipe-modal-close')?.addEventListener('click', () => this._closeModal());
        document.querySelector('#swipe-modal .modal-overlay')?.addEventListener('click', () => this._closeModal());

        // Detail modal
        document.getElementById('swipe-detail-close')?.addEventListener('click', () => this._closeDetail());
        document.querySelector('#swipe-detail-modal .modal-overlay')?.addEventListener('click', () => this._closeDetail());

        // Settings
        document.getElementById('btn-swipe-settings')?.addEventListener('click', () => this._openSettings());
    },

    _switchSubTab(tab) {
        document.querySelectorAll('.creative-subtabs-row .creative-subtab').forEach(b => b.classList.toggle('active', b.dataset.subtab === tab));
        document.getElementById('creatives-sub').style.display = tab === 'creatives' ? '' : 'none';
        document.getElementById('swipe-sub').style.display     = tab === 'swipe'     ? '' : 'none';
        document.getElementById('creatives-actions').style.display = tab === 'creatives' ? '' : 'none';
        document.getElementById('swipe-actions').style.display     = tab === 'swipe'     ? '' : 'none';
        if (tab === 'swipe') this.render();
    },

    // ── Storage ──────────────────────────────────────────────────────────────
    _load() {
        try {
            const raw = localStorage.getItem(this._storageKey);
            this._entries = raw ? JSON.parse(raw) : [];
        } catch { this._entries = []; }
    },

    _persist() {
        localStorage.setItem(this._storageKey, JSON.stringify(this._entries));
    },

    _getClaudeKey()  { return localStorage.getItem('ai_consultant_api_key') || ''; },
    _getOpenAIKey()  { return localStorage.getItem(this._openAIKeyKey) || ''; },

    // ── Render ───────────────────────────────────────────────────────────────
    render() {
        this._load();
        this._renderGrid();
    },

    _renderGrid() {
        const container = document.getElementById('swipe-grid');
        if (!container) return;

        let entries = [...this._entries];
        const { platform, format, type, search } = this._filter;
        if (platform !== 'all') entries = entries.filter(e => e.platform === platform);
        if (format  !== 'all') entries = entries.filter(e => e.format === format);
        if (type    !== 'all') entries = entries.filter(e => e.type === type);
        if (search) entries = entries.filter(e =>
            [e.title, e.author, e.hook_pt, e.hook_orig, e.body_pt, e.notes, ...(e.tags || [])]
                .some(v => (v || '').toLowerCase().includes(search))
        );
        entries.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        if (entries.length === 0) {
            container.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:3rem">
                <p>Nenhuma referência encontrada.<br>Clique em <strong>+ Adicionar Referência</strong> para começar seu Swipe File.</p>
            </div>`;
            return;
        }

        container.innerHTML = entries.map(e => this._renderCard(e)).join('');

        container.querySelectorAll('[data-swipe-view]').forEach(el =>
            el.addEventListener('click', () => this._openDetail(el.dataset.swipeView)));
        container.querySelectorAll('[data-swipe-edit]').forEach(el =>
            el.addEventListener('click', (ev) => { ev.stopPropagation(); this._openModal(el.dataset.swipeEdit); }));
        container.querySelectorAll('[data-swipe-delete]').forEach(el =>
            el.addEventListener('click', (ev) => { ev.stopPropagation(); this._deleteEntry(el.dataset.swipeDelete); }));
    },

    _renderCard(entry) {
        const p = this.PLATFORMS[entry.platform] || this.PLATFORMS.other;
        const hook = entry.hook_pt || entry.hook_orig || entry.transcript_pt || entry.transcript_orig || '';
        const preview = hook.length > 100 ? hook.slice(0, 100) + '…' : hook;
        const date = entry.date ? new Date(entry.date + 'T12:00:00').toLocaleDateString('pt-BR') : '';
        const hasAnalysis = entry.hook_pt || entry.hook_orig;
        const hasPT = entry.hook_pt && entry.hook_pt !== entry.hook_orig;
        const hasVideo = !!(entry.videoUrl || entry.embedHtml || entry.driveVideoUrl);

        return `<div class="swipe-card" data-swipe-view="${entry.id}">
            <div class="swipe-card-thumb" style="${entry.thumbnail ? `background-image:url('${entry.thumbnail}')` : 'background:linear-gradient(135deg,#1e293b,#334155)'}">
                ${!entry.thumbnail ? `<span style="font-size:2.5rem">${p.badge}</span>` : ''}
                ${hasVideo ? '<div class="swipe-play-overlay"><span class="swipe-play-icon">▶</span></div>' : ''}
                <div class="swipe-card-badges">
                    <span class="swipe-platform-chip" style="background:${p.color}">${p.badge} ${p.label}</span>
                    ${entry.format ? `<span class="swipe-format-chip">${entry.format}</span>` : ''}
                    ${entry.driveVideoUrl ? '<span class="swipe-format-chip" style="background:#1a73e8" title="Salvo no Drive">☁️</span>' : ''}
                </div>
                ${hasPT ? '<span class="swipe-pt-chip">🇧🇷</span>' : ''}
            </div>
            <div class="swipe-card-body">
                <div class="swipe-card-tags">
                    ${entry.type ? `<span class="swipe-tag swipe-tag-type">${entry.type}</span>` : ''}
                    ${hasAnalysis ? '<span class="swipe-tag swipe-tag-analyzed">🤖 Analisado</span>' : ''}
                </div>
                ${entry.author ? `<p class="swipe-card-author">@${entry.author}</p>` : ''}
                ${preview ? `<p class="swipe-card-hook">${preview}</p>` : '<p class="swipe-card-hook" style="color:var(--text-muted);font-style:italic">Sem transcrição</p>'}
                <div class="swipe-card-footer">
                    <span class="swipe-card-date">${date}</span>
                    <div class="swipe-card-actions">
                        <button class="swipe-action-btn" data-swipe-edit="${entry.id}" title="Editar">✏️</button>
                        <button class="swipe-action-btn swipe-action-del" data-swipe-delete="${entry.id}" title="Deletar">🗑️</button>
                    </div>
                </div>
            </div>
        </div>`;
    },

    // ── Modal: Add / Edit ────────────────────────────────────────────────────
    _openModal(id = null) {
        this._editingId = id || null;
        this._fetchedData = null;

        const title = document.getElementById('swipe-modal-title');
        if (title) title.textContent = id ? 'Editar Referência' : 'Adicionar Referência';

        this._resetModalForm();
        if (id) {
            const entry = this._entries.find(e => e.id === id);
            if (entry) this._fillModalForm(entry);
        }

        document.getElementById('swipe-modal')?.classList.remove('hidden');
    },

    _closeModal() {
        document.getElementById('swipe-modal')?.classList.add('hidden');
        this._editingId = null;
        this._fetchedData = null;
    },

    _resetModalForm() {
        ['swipe-url-input','swipe-title','swipe-author','swipe-notes','swipe-tags',
         'swipe-transcript-orig','swipe-transcript-pt',
         'swipe-hook-orig','swipe-body-orig','swipe-cta-orig',
         'swipe-hook-pt','swipe-body-pt','swipe-cta-pt'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        ['swipe-platform','swipe-format','swipe-type'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.selectedIndex = 0;
        });
        const dateEl = document.getElementById('swipe-date');
        if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

        const previewEl = document.getElementById('swipe-preview-section');
        if (previewEl) previewEl.style.display = 'none';

        const driveStatus = document.getElementById('swipe-drive-status');
        if (driveStatus) driveStatus.textContent = '';
        const driveUrl = document.getElementById('swipe-drive-video-url');
        if (driveUrl) driveUrl.value = '';
        const driveBtn = document.getElementById('swipe-drive-upload-btn');
        if (driveBtn) driveBtn.style.display = 'none';
        const origBtn = document.getElementById('swipe-open-original-btn');
        if (origBtn) origBtn.style.display = 'none';

        const statusEl = document.getElementById('swipe-fetch-status');
        if (statusEl) { statusEl.textContent = ''; statusEl.className = ''; }
    },

    _fillModalForm(entry) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
        set('swipe-url-input', entry.url);
        set('swipe-title', entry.title);
        set('swipe-author', entry.author);
        set('swipe-notes', entry.notes);
        set('swipe-date', entry.date || '');
        set('swipe-tags', (entry.tags || []).join(', '));
        set('swipe-transcript-orig', entry.transcript_orig);
        set('swipe-transcript-pt',  entry.transcript_pt);
        set('swipe-hook-orig', entry.hook_orig);
        set('swipe-body-orig', entry.body_orig);
        set('swipe-cta-orig',  entry.cta_orig);
        set('swipe-hook-pt',   entry.hook_pt);
        set('swipe-body-pt',   entry.body_pt);
        set('swipe-cta-pt',    entry.cta_pt);

        const setSelect = (id, val) => {
            const el = document.getElementById(id);
            if (!el || !val) return;
            for (let i = 0; i < el.options.length; i++) {
                if (el.options[i].value === val) { el.selectedIndex = i; break; }
            }
        };
        setSelect('swipe-platform', entry.platform);
        setSelect('swipe-format',   entry.format);
        setSelect('swipe-type',     entry.type);

        if (entry.thumbnail || entry.videoUrl || entry.embedHtml) {
            this._fetchedData = { thumbnail: entry.thumbnail, videoUrl: entry.videoUrl, embedHtml: entry.embedHtml };
            this._showPreview(this._fetchedData);
        }

        if (entry.driveVideoUrl) {
            const driveUrlEl = document.getElementById('swipe-drive-video-url');
            if (driveUrlEl) driveUrlEl.value = entry.driveVideoUrl;
            const driveStatus = document.getElementById('swipe-drive-status');
            if (driveStatus) {
                driveStatus.textContent = '✅ Vídeo já salvo no Drive';
                driveStatus.className = 'swipe-status-ok';
            }
        }
    },

    // ── URL Fetching ─────────────────────────────────────────────────────────
    async _fetchURL() {
        const urlEl = document.getElementById('swipe-url-input');
        const url = (urlEl?.value || '').trim();
        if (!url) return;

        const platform = this._detectPlatform(url);
        const statusEl = document.getElementById('swipe-fetch-status');
        const fetchBtn = document.getElementById('swipe-url-fetch-btn');

        if (statusEl) { statusEl.textContent = '⏳ Buscando dados...'; statusEl.className = 'swipe-status-loading'; }
        if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.textContent = '...'; }

        try {
            let data = null;
            if (platform === 'tiktok')    data = await this._fetchTikTokData(url);
            else if (platform === 'youtube')   data = await this._fetchYouTubeData(url);
            else if (platform === 'instagram') data = await this._fetchInstagramData(url);
            else if (platform === 'facebook')  data = await this._fetchFacebookData(url);
            else data = await this._fetchOGTags(url);

            if (data) {
                this._fetchedData = { ...data, platform, url };
                this._applyFetchedData(data);
                this._showPreview(data);

                // Auto-fill transcript if found (e.g. YouTube captions)
                if (data.transcript) {
                    const tEl = document.getElementById('swipe-transcript-orig');
                    if (tEl && !tEl.value) tEl.value = data.transcript;
                    if (statusEl) {
                        statusEl.textContent = '✅ Transcrição encontrada automaticamente! Clique em "🤖 Analisar com IA" para identificar Gancho/Corpo/CTA.';
                        statusEl.className = 'swipe-status-ok';
                    }
                } else {
                    if (statusEl) {
                        const hasVid = !!data.videoUrl;
                        const msgs = {
                            tiktok:    hasVid ? '✅ Vídeo carregado! Use "🎙️ Transcrever com IA" ou "☁️ Salvar no Drive".' : '✅ TikTok carregado!',
                            youtube:   hasVid ? '✅ YouTube com vídeo direto! Pode salvar no Drive.' : '✅ YouTube carregado! Player embed disponível.',
                            instagram: hasVid ? '✅ Instagram carregado com vídeo! Pode salvar no Drive.' : '✅ Instagram carregado!',
                            facebook:  hasVid ? '✅ Facebook carregado com vídeo! Pode salvar no Drive.' : '✅ Facebook carregado!',
                        };
                        statusEl.textContent = msgs[platform] || '✅ Dados carregados!';
                        statusEl.className = 'swipe-status-ok';
                    }
                }
            } else {
                if (statusEl) { statusEl.textContent = '⚠️ Não foi possível buscar dados. Preencha manualmente.'; statusEl.className = 'swipe-status-warn'; }
            }
        } catch (err) {
            console.warn('SwipeModule._fetchURL:', err.message);
            if (statusEl) { statusEl.textContent = '❌ ' + err.message + '. Preencha manualmente.'; statusEl.className = 'swipe-status-error'; }
        } finally {
            if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.textContent = 'Buscar'; }
        }

        // Auto-set platform select
        const pEl = document.getElementById('swipe-platform');
        if (pEl) {
            for (let i = 0; i < pEl.options.length; i++) {
                if (pEl.options[i].value === platform) { pEl.selectedIndex = i; break; }
            }
        }
    },

    _detectPlatform(url) {
        const u = url.toLowerCase();
        if (u.includes('tiktok.com')) return 'tiktok';
        if (u.includes('instagram.com')) return 'instagram';
        if (u.includes('facebook.com') || u.includes('fb.watch')) return 'facebook';
        if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
        return 'other';
    },

    // Fetch with timeout to avoid hanging
    async _fetchT(url, timeout = 10000) {
        const ctrl = new AbortController();
        const id = setTimeout(() => ctrl.abort(), timeout);
        try {
            const r = await fetch(url, { signal: ctrl.signal });
            clearTimeout(id);
            return r;
        } catch(e) { clearTimeout(id); throw e; }
    },

    // ── TikTok via tikwm.com ──────────────────────────────────────────────────
    async _fetchTikTokData(url) {
        const resp = await this._fetchT(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`);
        if (!resp.ok) throw new Error('tikwm API error ' + resp.status);
        const json = await resp.json();
        if (!json.data) throw new Error('Vídeo não encontrado no TikTok');
        const d = json.data;
        return {
            title:     d.title || '',
            thumbnail: d.cover || d.origin_cover || '',
            author:    d.author?.unique_id || d.author?.nickname || '',
            videoUrl:  d.play || d.wmplay || '',
            embedHtml: null,
            transcript: '',
        };
    },

    // ── Multi-proxy extraction: Worker → allorigins → corsproxy ──────────────

    async _fetchViaWorker(url) {
        const resp = await this._fetchT(`${this._PROXY_URL}/?url=${encodeURIComponent(url)}`, 20000);
        if (!resp.ok) return null;
        const data = await resp.json();
        // Consider response valid only if it has title OR thumbnail OR videoUrl
        if (data.title || data.thumbnail || data.videoUrl) return data;
        return null;
    },

    async _fetchViaAllorigins(url) {
        const resp = await this._fetchT(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, 12000);
        if (!resp.ok) return null;
        const data = await resp.json();
        const html = data.contents || '';
        return this._parseOGFromHtml(html, url);
    },

    async _fetchViaCorsproxy(url) {
        const resp = await this._fetchT(`https://corsproxy.io/?${encodeURIComponent(url)}`, 10000);
        if (!resp.ok) return null;
        const html = await resp.text();
        return this._parseOGFromHtml(html, url);
    },

    _parseOGFromHtml(html, url) {
        const getOG = (prop) => {
            const m = html.match(new RegExp(`property=["']og:${prop}["']\\s[^>]*?content="([^"]*)"`, 'i'))
                   || html.match(new RegExp(`content="([^"]*)"\\s[^>]*?property=["']og:${prop}["']`, 'i'));
            return m ? m[1].replace(/&amp;/g, '&') : '';
        };
        const title     = getOG('title') || getOG('description');
        const thumbnail = getOG('image');
        const videoUrl  = getOG('video:secure_url') || getOG('video:url') || getOG('video');
        if (!title && !thumbnail && !videoUrl) return null;
        // Extract author from username pattern
        let author = '';
        const am = html.match(/"username"\s*:\s*"([^"]+)"/);
        if (am) author = am[1];
        return { title, thumbnail, videoUrl, author, embedHtml: null, transcript: '' };
    },

    async _fetchWithFallbacks(url) {
        // Try Worker proxy first (server-side extraction with crawler UA)
        try { const d = await this._fetchViaWorker(url); if (d) return d; } catch(e) {}
        // Try allorigins (different IP pool)
        try { const d = await this._fetchViaAllorigins(url); if (d) return d; } catch(e) {}
        // Try corsproxy (yet another IP)
        try { const d = await this._fetchViaCorsproxy(url); if (d) return d; } catch(e) {}
        return null;
    },

    async _fetchYouTubeData(url) {
        const videoId = this._extractYouTubeId(url);
        let embedHtml = null;
        if (videoId) {
            embedHtml = `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe>`;
        }

        // Try Worker extraction first (gets title, author, captions, maybe video URL)
        let data = null;
        try { data = await this._fetchViaWorker(url); } catch(e) {}

        // If Worker failed for title, try oEmbed (reliable for metadata)
        let title = data?.title || '', author = data?.author || '', thumbnail = data?.thumbnail || '';
        let videoUrl = data?.videoUrl || '', transcript = data?.captions || '';

        if (!title || title.includes('youtube.com')) {
            try {
                const r = await this._fetchT(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
                if (r.ok) {
                    const d = await r.json();
                    title = d.title || title; thumbnail = d.thumbnail_url || thumbnail;
                    author = d.author_name || author;
                    if (d.html) embedHtml = d.html;
                }
            } catch(e) {}
        }

        if (!thumbnail && videoId) thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

        return { title, thumbnail, author, videoUrl, embedHtml, transcript };
    },

    _extractYouTubeId(url) {
        const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
        return m ? m[1] : null;
    },

    async _fetchInstagramData(url) {
        const data = await this._fetchWithFallbacks(url);
        if (data) return data;
        // Minimal fallback
        const sc = url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
        return { title: sc ? `Instagram ${sc[1]}` : 'Instagram', thumbnail: '', author: '', videoUrl: '', embedHtml: null, transcript: '' };
    },

    async _fetchFacebookData(url) {
        const data = await this._fetchWithFallbacks(url);
        if (data) return data;
        const idMatch = url.match(/[?&]id=(\d+)/);
        return { title: idMatch ? `Facebook Ad #${idMatch[1]}` : 'Facebook', thumbnail: '', author: url.includes('ads/library') ? 'Facebook Ads Library' : '', videoUrl: '', embedHtml: null, transcript: '' };
    },

    _applyFetchedData(data) {
        const setIfEmpty = (id, val) => {
            const el = document.getElementById(id);
            if (el && !el.value && val) el.value = val;
        };
        setIfEmpty('swipe-title',  data.title);
        setIfEmpty('swipe-author', data.author);
    },

    // ── Google Drive Upload ───────────────────────────────────────────────────
    _SWIPE_DRIVE_FOLDER_KEY: 'etracker_swipe_drive_folder_id',

    async _ensureSwipeDriveFolder() {
        const cached = localStorage.getItem(this._SWIPE_DRIVE_FOLDER_KEY);
        if (cached) {
            // Verify folder still exists
            try {
                const check = await SheetsAPI._driveRequest(`/drive/v3/files/${encodeURIComponent(cached)}?fields=id,trashed`);
                if (check?.id && !check.trashed) return cached;
            } catch(e) { /* recreate */ }
        }
        // Find or create the folder
        const folderName = 'Swipe File — E-commerce Tracker';
        const q = `name='${folderName.replace(/'/g,"\\'")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const found = await SheetsAPI._driveRequest(`/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=1&fields=files(id,name)`);
        if (found?.files?.[0]?.id) {
            localStorage.setItem(this._SWIPE_DRIVE_FOLDER_KEY, found.files[0].id);
            return found.files[0].id;
        }
        const created = await SheetsAPI._driveRequest('/drive/v3/files?fields=id,name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' })
        });
        if (!created?.id) throw new Error('Não foi possível criar pasta no Drive');
        localStorage.setItem(this._SWIPE_DRIVE_FOLDER_KEY, created.id);
        return created.id;
    },

    async _downloadVideoBlob(videoUrl) {
        // Try direct fetch (works if CDN allows CORS)
        try {
            const resp = await this._fetchT(videoUrl, 30000);
            if (resp.ok) {
                const blob = await resp.blob();
                if (blob.size > 5000) return blob;
            }
        } catch(e) { /* try worker proxy */ }

        // Try via our Cloudflare Worker proxy (server-side, bypasses CORS)
        try {
            const resp = await this._fetchT(`${this._PROXY_URL}/?action=proxy&url=${encodeURIComponent(videoUrl)}`, 60000);
            if (resp.ok) {
                const blob = await resp.blob();
                if (blob.size > 5000) return blob;
            }
        } catch(e) { /* try allorigins */ }

        // Fallback: allorigins raw proxy
        try {
            const resp = await this._fetchT('https://api.allorigins.win/raw?url=' + encodeURIComponent(videoUrl), 30000);
            if (resp.ok) {
                const blob = await resp.blob();
                if (blob.size > 5000) return blob;
            }
        } catch(e) {}

        throw new Error('Não foi possível baixar o vídeo. Tente novamente.');
    },

    async _uploadVideoToDrive() {
        const driveBtn = document.getElementById('swipe-drive-upload-btn');
        const driveStatus = document.getElementById('swipe-drive-status');
        const driveUrlEl = document.getElementById('swipe-drive-video-url');

        const mediaUrl = this._fetchedData?.videoUrl || this._fetchedData?.thumbnail;
        const isVideo = !!this._fetchedData?.videoUrl;

        if (!mediaUrl) {
            if (driveStatus) { driveStatus.textContent = '⚠️ Nenhuma mídia disponível para download.'; driveStatus.className = 'swipe-status-warn'; }
            return;
        }

        // Check Google auth
        if (typeof SheetsAPI === 'undefined' || !SheetsAPI._driveRequest) {
            if (driveStatus) { driveStatus.textContent = '⚠️ Conecte o Google Drive primeiro (aba Metas → Google Sheets).'; driveStatus.className = 'swipe-status-warn'; }
            return;
        }

        if (driveBtn) { driveBtn.disabled = true; driveBtn.textContent = isVideo ? '⏳ Baixando vídeo...' : '⏳ Baixando imagem...'; }
        if (driveStatus) { driveStatus.textContent = isVideo ? '⏳ Baixando vídeo...' : '⏳ Baixando imagem...'; driveStatus.className = 'swipe-status-loading'; }

        try {
            // Download media
            const blob = await this._downloadVideoBlob(mediaUrl);

            if (driveStatus) { driveStatus.textContent = '⏳ Enviando para o Drive...'; }

            // Ensure folder exists
            const folderId = await this._ensureSwipeDriveFolder();

            // Build filename from title
            const title = document.getElementById('swipe-title')?.value || this._fetchedData?.title || 'swipe_video';
            const safeName = title.replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().slice(0, 60) || 'swipe_video';
            const ext = isVideo
                ? (blob.type.includes('mp4') ? '.mp4' : blob.type.includes('webm') ? '.webm' : '.mp4')
                : (blob.type.includes('png') ? '.png' : blob.type.includes('webp') ? '.webp' : '.jpg');
            const fileName = `${safeName}_${Date.now()}${ext}`;

            // Upload via multipart
            const boundary = `swipe_${Date.now()}`;
            const metadata = { name: fileName, parents: [folderId] };
            const multipartBody = new Blob([
                `--${boundary}\r\n`,
                'Content-Type: application/json; charset=UTF-8\r\n\r\n',
                JSON.stringify(metadata),
                '\r\n',
                `--${boundary}\r\n`,
                `Content-Type: ${blob.type || 'video/mp4'}\r\n\r\n`,
                blob,
                '\r\n',
                `--${boundary}--`
            ]);

            const uploaded = await SheetsAPI._driveRequest(
                '/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
                { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipartBody }
            );

            if (!uploaded?.id) throw new Error('Drive não retornou ID do arquivo');

            // Make public for easy playback
            try {
                await SheetsAPI._driveRequest(
                    `/drive/v3/files/${uploaded.id}/permissions?sendNotificationEmail=false`,
                    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'reader', type: 'anyone' }) }
                );
            } catch(e) { /* permission optional */ }

            const viewUrl = uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`;
            const directUrl = `https://drive.google.com/uc?export=download&id=${uploaded.id}`;

            if (driveUrlEl) driveUrlEl.value = viewUrl;
            if (driveStatus) {
                driveStatus.innerHTML = `✅ Salvo no Drive! <a href="${viewUrl}" target="_blank" rel="noopener" style="color:var(--accent)">Abrir no Drive ↗</a>`;
                driveStatus.className = 'swipe-status-ok';
            }
            showToast(isVideo ? 'Vídeo salvo no Drive!' : 'Imagem salva no Drive!', 'success');

        } catch (err) {
            console.warn('Drive upload error:', err.message);
            if (driveStatus) { driveStatus.textContent = '❌ ' + err.message; driveStatus.className = 'swipe-status-error'; }
        } finally {
            if (driveBtn) { driveBtn.disabled = false; driveBtn.textContent = '☁️ Salvar vídeo no Drive'; }
        }
    },

    _showPreview(data) {
        const section = document.getElementById('swipe-preview-section');
        if (!section) return;
        section.style.display = 'block';

        const videoEl   = document.getElementById('swipe-preview-video');
        const embedEl   = document.getElementById('swipe-preview-embed');
        const thumbEl   = document.getElementById('swipe-preview-thumb');

        if (videoEl)  videoEl.style.display  = 'none';
        if (embedEl)  embedEl.style.display  = 'none';
        if (thumbEl)  thumbEl.style.display  = 'none';

        if (data.videoUrl && videoEl) {
            videoEl.style.display = 'block';
            videoEl.src = data.videoUrl;
        } else if (data.embedHtml && embedEl) {
            embedEl.style.display = 'block';
            embedEl.innerHTML = data.embedHtml;
        } else if (data.thumbnail && thumbEl) {
            thumbEl.style.display = 'block';
            thumbEl.src = data.thumbnail;
        }

        // Show Drive upload button if we have a video or image URL to save
        const driveBtn = document.getElementById('swipe-drive-upload-btn');
        if (driveBtn) {
            const hasMedia = data.videoUrl || data.thumbnail;
            driveBtn.style.display = hasMedia ? 'inline-flex' : 'none';
            driveBtn.textContent = data.videoUrl ? '☁️ Salvar vídeo no Drive' : '☁️ Salvar imagem no Drive';
        }

        // Show "open original" button if we have a URL
        const origBtn = document.getElementById('swipe-open-original-btn');
        if (origBtn) {
            const url = document.getElementById('swipe-url-input')?.value;
            origBtn.style.display = url ? 'inline-flex' : 'none';
        }
    },

    // ── Auto-Transcribe with OpenAI Whisper ──────────────────────────────────
    async _autoTranscribe() {
        const btn = document.getElementById('swipe-transcribe-btn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Transcrevendo...'; }

        try {
            let openaiKey = this._getOpenAIKey();
            if (!openaiKey) {
                openaiKey = prompt('Cole sua API key da OpenAI (necessário para transcrição automática com Whisper):');
                if (!openaiKey) return;
                localStorage.setItem(this._openAIKeyKey, openaiKey.trim());
                openaiKey = openaiKey.trim();
            }

            const videoUrl = this._fetchedData?.videoUrl;
            if (!videoUrl) {
                showToast('Primeiro busque um link de TikTok para obter o vídeo automaticamente.', 'warn');
                return;
            }

            showToast('⏳ Baixando áudio do vídeo...', 'info');
            // Use our Worker proxy for reliable download
            let resp;
            try {
                resp = await this._fetchT(`${this._PROXY_URL}/?action=proxy&url=${encodeURIComponent(videoUrl)}`, 60000);
            } catch(e) {
                resp = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(videoUrl)}`);
            }
            if (!resp.ok) throw new Error('Não foi possível baixar o vídeo via proxy');

            const blob = await resp.blob();
            const videoBlob = new Blob([blob], { type: 'video/mp4' });

            showToast('⏳ Transcrevendo com Whisper AI...', 'info');
            const formData = new FormData();
            formData.append('file', videoBlob, 'video.mp4');
            formData.append('model', 'whisper-1');

            const whisperResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${openaiKey}` },
                body: formData,
            });
            if (!whisperResp.ok) throw new Error('OpenAI Whisper error ' + whisperResp.status);

            const result = await whisperResp.json();
            if (result.text) {
                const el = document.getElementById('swipe-transcript-orig');
                if (el) el.value = result.text;
                showToast('✅ Transcrição concluída! Clique em "Analisar com IA" para identificar Gancho/Corpo/CTA.', 'success');
            }
        } catch (err) {
            console.error('SwipeModule._autoTranscribe:', err);
            showToast('Erro na transcrição: ' + err.message + '. Cole o texto manualmente.', 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🎙️ Transcrever com IA'; }
        }
    },

    // ── Claude AI Analysis ────────────────────────────────────────────────────
    async _analyzeWithClaude() {
        const claudeKey = this._getClaudeKey();
        if (!claudeKey) {
            showToast('Configure sua API key do Claude (via ícone ⚙️ no Consultor de IA)', 'error');
            return;
        }

        const transcript = document.getElementById('swipe-transcript-orig')?.value?.trim();
        if (!transcript) {
            showToast('Cole ou escreva a transcrição do vídeo primeiro', 'warn');
            return;
        }

        const btn = document.getElementById('swipe-analyze-btn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Analisando...'; }

        try {
            const prompt = `Você é especialista em copywriting para anúncios de vídeo no e-commerce.

Analise esta transcrição de um criativo de anúncio:

"""
${transcript}
"""

Sua tarefa:
1. Detecte o idioma original
2. Extraia as três partes estruturais do anúncio:
   - GANCHO (Hook): primeiras frases que capturam atenção (geralmente 1-3 frases, primeiros 3-7 segundos)
   - CORPO (Body): argumentação principal, benefícios, prova social
   - CTA: chamada para ação final
3. Se não estiver em português, traduza cada parte para português brasileiro natural

Responda APENAS em JSON válido (sem markdown):
{
  "language": "código ISO (en/es/pt/fr/etc)",
  "hook_orig": "gancho no idioma original",
  "body_orig": "corpo no idioma original",
  "cta_orig": "cta no idioma original",
  "hook_pt": "gancho em português brasileiro",
  "body_pt": "corpo em português brasileiro",
  "cta_pt": "cta em português brasileiro"
}`;

            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': claudeKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify({
                    model: 'claude-haiku-4-5-20251001',
                    max_tokens: 2000,
                    messages: [{ role: 'user', content: prompt }],
                }),
            });

            if (!response.ok) throw new Error('Claude API error ' + response.status);
            const data = await response.json();
            const text = data.content?.[0]?.text || '';
            const match = text.match(/\{[\s\S]*\}/);
            if (!match) throw new Error('Resposta inválida do Claude');

            const result = JSON.parse(match[0]);
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
            set('swipe-hook-orig', result.hook_orig);
            set('swipe-body-orig', result.body_orig);
            set('swipe-cta-orig',  result.cta_orig);
            set('swipe-hook-pt',   result.hook_pt);
            set('swipe-body-pt',   result.body_pt);
            set('swipe-cta-pt',    result.cta_pt);

            // Auto-fill PT transcript from parts
            if (result.language !== 'pt') {
                const ptText = [result.hook_pt, result.body_pt, result.cta_pt].filter(Boolean).join('\n\n');
                const ptEl = document.getElementById('swipe-transcript-pt');
                if (ptEl && !ptEl.value) ptEl.value = ptText;
            }

            showToast('✅ Gancho, Corpo e CTA identificados' + (result.language !== 'pt' ? ' e traduzidos para PT!' : '!'), 'success');
        } catch (err) {
            console.error('SwipeModule._analyzeWithClaude:', err);
            showToast('Erro na análise: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🤖 Analisar com IA'; }
        }
    },

    // ── Save ──────────────────────────────────────────────────────────────────
    _handleSave(e) {
        e.preventDefault();
        const get = (id) => document.getElementById(id)?.value?.trim() || '';

        const existing = this._editingId ? this._entries.find(e => e.id === this._editingId) : null;

        const entry = {
            id: this._editingId || ('swipe_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)),
            url:             get('swipe-url-input'),
            platform:        get('swipe-platform') || this._detectPlatform(get('swipe-url-input')),
            title:           get('swipe-title'),
            author:          get('swipe-author'),
            date:            get('swipe-date') || new Date().toISOString().slice(0, 10),
            format:          get('swipe-format'),
            type:            get('swipe-type'),
            tags:            get('swipe-tags').split(',').map(t => t.trim()).filter(Boolean),
            notes:           get('swipe-notes'),
            transcript_orig: get('swipe-transcript-orig'),
            transcript_pt:   get('swipe-transcript-pt'),
            hook_orig:       get('swipe-hook-orig'),
            body_orig:       get('swipe-body-orig'),
            cta_orig:        get('swipe-cta-orig'),
            hook_pt:         get('swipe-hook-pt'),
            body_pt:         get('swipe-body-pt'),
            cta_pt:          get('swipe-cta-pt'),
            thumbnail:       this._fetchedData?.thumbnail || existing?.thumbnail || '',
            videoUrl:        this._fetchedData?.videoUrl  || existing?.videoUrl  || '',
            embedHtml:       this._fetchedData?.embedHtml || existing?.embedHtml || '',
            driveVideoUrl:   get('swipe-drive-video-url') || existing?.driveVideoUrl || '',
            createdAt:       existing?.createdAt || new Date().toISOString(),
            updatedAt:       new Date().toISOString(),
        };

        if (this._editingId) {
            const idx = this._entries.findIndex(e => e.id === this._editingId);
            if (idx >= 0) this._entries[idx] = entry;
            else this._entries.unshift(entry);
        } else {
            this._entries.unshift(entry);
        }

        this._persist();
        this._closeModal();
        this._renderGrid();
        showToast(this._editingId ? 'Referência atualizada!' : 'Referência salva no Swipe File!', 'success');
    },

    _deleteEntry(id) {
        if (!confirm('Remover esta referência do Swipe File?')) return;
        this._entries = this._entries.filter(e => e.id !== id);
        this._persist();
        this._renderGrid();
        showToast('Referência removida', 'success');
    },

    // ── Detail Modal ──────────────────────────────────────────────────────────
    _openDetail(id) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry) return;
        this._renderDetail(entry, 'pt');
        document.getElementById('swipe-detail-modal')?.classList.remove('hidden');
    },

    _closeDetail() {
        const modal = document.getElementById('swipe-detail-modal');
        if (modal) modal.classList.add('hidden');
        // Stop video if playing
        const video = document.getElementById('swipe-detail-video');
        if (video) { video.pause(); video.src = ''; }
    },

    _renderDetail(entry, lang) {
        const p = this.PLATFORMS[entry.platform] || this.PLATFORMS.other;
        const container = document.getElementById('swipe-detail-content');
        if (!container) return;

        const hasBothLangs = entry.hook_pt && entry.hook_orig && entry.hook_pt !== entry.hook_orig;
        const date = entry.date ? new Date(entry.date + 'T12:00:00').toLocaleDateString('pt-BR') : '';

        const langToggle = hasBothLangs ? `
            <div class="swipe-lang-toggle">
                <button class="swipe-lang-btn ${lang === 'pt' ? 'active' : ''}" onclick="SwipeModule._switchDetailLang('${entry.id}','pt',this)">🇧🇷 Português</button>
                <button class="swipe-lang-btn ${lang === 'orig' ? 'active' : ''}" onclick="SwipeModule._switchDetailLang('${entry.id}','orig',this)">🌐 Original</button>
            </div>` : '';

        let mediaHtml = '';
        if (entry.videoUrl) {
            mediaHtml = `<video id="swipe-detail-video" src="${entry.videoUrl}" controls class="swipe-detail-video" crossorigin="anonymous" playsinline autoplay muted></video>`;
        } else if (entry.driveVideoUrl) {
            // Google Drive video embedded
            const driveId = entry.driveVideoUrl.match(/\/d\/([^/]+)|id=([^&]+)/)?.[1] || entry.driveVideoUrl.match(/\/d\/([^/]+)|id=([^&]+)/)?.[2];
            if (driveId) {
                mediaHtml = `<div class="swipe-detail-embed"><iframe src="https://drive.google.com/file/d/${driveId}/preview" allow="autoplay" allowfullscreen></iframe></div>`;
            } else {
                mediaHtml = `<div style="text-align:center;padding:1rem"><a href="${entry.driveVideoUrl}" target="_blank" class="btn btn-primary">▶ Assistir no Drive</a></div>`;
            }
        } else if (entry.embedHtml) {
            mediaHtml = `<div class="swipe-detail-embed">${entry.embedHtml}</div>`;
        } else if (entry.thumbnail) {
            mediaHtml = `<img src="${entry.thumbnail}" class="swipe-detail-thumb" alt="thumbnail">`;
        }

        container.setAttribute('data-entry-id', entry.id);
        container.innerHTML = `
            <div class="swipe-detail-meta">
                <span class="swipe-platform-chip" style="background:${p.color}">${p.badge} ${p.label}</span>
                ${entry.format ? `<span class="swipe-tag">${entry.format}</span>` : ''}
                ${entry.type   ? `<span class="swipe-tag swipe-tag-type">${entry.type}</span>` : ''}
                ${(entry.tags || []).map(t => `<span class="swipe-tag">${t}</span>`).join('')}
            </div>
            ${entry.title  ? `<h3 class="swipe-detail-title">${entry.title}</h3>` : ''}
            ${entry.author ? `<p class="swipe-detail-author">@${entry.author}${date ? ' · ' + date : ''}</p>` : ''}
            ${mediaHtml}
            ${langToggle}
            <div id="swipe-detail-sections">${this._buildSections(entry, lang)}</div>
            <div class="swipe-detail-links">
                ${entry.driveVideoUrl ? `<a href="${entry.driveVideoUrl}" target="_blank" rel="noopener noreferrer" class="swipe-detail-link-btn swipe-link-drive">☁️ Abrir no Drive</a>` : ''}
                ${entry.url ? `<a href="${entry.url}" target="_blank" rel="noopener noreferrer" class="swipe-detail-link-btn swipe-link-orig">🔗 Ver na plataforma original</a>` : ''}
            </div>
            ${entry.notes ? `<div class="swipe-detail-notes">📝 <strong>Notas:</strong> ${entry.notes}</div>` : ''}
            <div class="swipe-detail-actions">
                <button class="btn btn-secondary btn-sm" onclick="SwipeModule._copyAll('${entry.id}')">📋 Copiar tudo</button>
                <button class="btn btn-primary btn-sm" onclick="SwipeModule._closeDetail(); SwipeModule._openModal('${entry.id}')">✏️ Editar</button>
            </div>
        `;
    },

    _buildSections(entry, lang) {
        const hook = lang === 'pt' ? (entry.hook_pt || entry.hook_orig) : (entry.hook_orig || entry.hook_pt);
        const body = lang === 'pt' ? (entry.body_pt || entry.body_orig) : (entry.body_orig || entry.body_pt);
        const cta  = lang === 'pt' ? (entry.cta_pt  || entry.cta_orig)  : (entry.cta_orig  || entry.cta_pt);
        const transcript = lang === 'pt' ? (entry.transcript_pt || entry.transcript_orig) : (entry.transcript_orig || entry.transcript_pt);

        const copyBtn = (text) =>
            `<button class="swipe-copy-btn" onclick="navigator.clipboard.writeText(decodeURIComponent('${encodeURIComponent(text)}')).then(()=>showToast('Copiado!','success'))">📋 Copiar</button>`;

        if (hook || body || cta) {
            const section = (label, cls, text) => text ? `
                <div class="swipe-section">
                    <div class="swipe-section-label ${cls}">${label}</div>
                    <p class="swipe-section-text">${text}</p>
                    ${copyBtn(text)}
                </div>` : '';
            return section('🎯 Gancho (Hook)', 'swipe-label-hook', hook)
                 + section('📝 Corpo (Body)',  'swipe-label-body', body)
                 + section('🚀 CTA',           'swipe-label-cta',  cta);
        }

        if (transcript) {
            return `<div class="swipe-section">
                <div class="swipe-section-label">📄 Transcrição</div>
                <p class="swipe-section-text">${transcript}</p>
                ${copyBtn(transcript)}
            </div>`;
        }

        return `<p class="swipe-no-transcript">Nenhuma transcrição. <button class="btn btn-secondary btn-sm" onclick="SwipeModule._closeDetail(); SwipeModule._openModal('${entry.id}')">Adicionar agora</button></p>`;
    },

    _switchDetailLang(id, lang, btn) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry) return;
        const s = document.getElementById('swipe-detail-sections');
        if (s) s.innerHTML = this._buildSections(entry, lang);
        btn.closest('.swipe-lang-toggle').querySelectorAll('.swipe-lang-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    },

    _copyAll(id) {
        const entry = this._entries.find(e => e.id === id);
        if (!entry) return;
        const parts = [
            entry.hook_pt ? `🎯 GANCHO:\n${entry.hook_pt}` : '',
            entry.body_pt ? `\n📝 CORPO:\n${entry.body_pt}` : '',
            entry.cta_pt  ? `\n🚀 CTA:\n${entry.cta_pt}`   : '',
            (!entry.hook_pt && entry.transcript_pt) ? entry.transcript_pt : '',
        ].filter(Boolean).join('\n');
        navigator.clipboard.writeText(parts)
            .then(() => showToast('Copiado para a área de transferência!', 'success'));
    },

    // ── Settings ──────────────────────────────────────────────────────────────
    _openSettings() {
        const modal = document.getElementById('swipe-settings-modal');
        if (!modal) return;
        modal.classList.remove('hidden');

        // Fill current values
        const openaiInput = document.getElementById('swipe-cfg-openai-key');
        const claudeInput = document.getElementById('swipe-cfg-claude-key');
        if (openaiInput) openaiInput.value = this._getOpenAIKey() || '';
        if (claudeInput) claudeInput.value = localStorage.getItem('ai_consultant_api_key') || '';

        // Drive status
        const statusEl = document.getElementById('swipe-drive-status-text');
        if (statusEl) {
            const connected = typeof SheetsAPI !== 'undefined' && AppState?.sheetsConnected;
            statusEl.textContent = connected ? '✅ Google Drive conectado' : '❌ Google Drive não conectado';
            statusEl.style.color = connected ? 'var(--success)' : 'var(--danger)';
        }

        // Reconnect button
        const reconnBtn = document.getElementById('btn-swipe-reconnect-google');
        if (reconnBtn) {
            reconnBtn.onclick = () => {
                if (typeof SheetsAPI !== 'undefined') {
                    SheetsAPI.init(true);
                    modal.classList.add('hidden');
                } else {
                    showToast('Google API não carregada. Verifique as configurações.', 'error');
                }
            };
        }

        // Close
        document.getElementById('swipe-settings-close')?.addEventListener('click', () => modal.classList.add('hidden'), { once: true });
        modal.querySelector('.modal-overlay')?.addEventListener('click', () => modal.classList.add('hidden'), { once: true });

        // Save
        document.getElementById('btn-swipe-settings-save')?.addEventListener('click', () => {
            const openaiKey = document.getElementById('swipe-cfg-openai-key')?.value?.trim() || '';
            const claudeKey = document.getElementById('swipe-cfg-claude-key')?.value?.trim() || '';

            if (openaiKey) localStorage.setItem(this._openAIKeyKey, openaiKey);
            else localStorage.removeItem(this._openAIKeyKey);

            if (claudeKey) localStorage.setItem('ai_consultant_api_key', claudeKey);
            else localStorage.removeItem('ai_consultant_api_key');

            showToast('Configurações salvas!', 'success');
            modal.classList.add('hidden');
        }, { once: true });
    },
};
