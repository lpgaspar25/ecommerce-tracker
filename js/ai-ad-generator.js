/* ===========================
   AI Ad Generator
   - Gera imagens via OpenAI DALL-E 3 OU Google Imagen 3
   - Gera copy via OpenAI GPT-4o-mini
   - Comprime imagens para WebP (canvas) antes de salvar
   - Persiste gerações em localStorage
   =========================== */

const AIAdGenerator = {
    STORAGE_KEY: 'ai_ad_generations_v1',

    init() {
        if (document.readyState !== 'loading') this._setup();
        else document.addEventListener('DOMContentLoaded', () => this._setup());
    },

    _setup() {
        document.getElementById('aiad-generate')?.addEventListener('click', () => this.generateImages());
        document.getElementById('aiad-gen-copy')?.addEventListener('click', () => this.generateCopy());
        document.getElementById('aiad-config')?.addEventListener('click', () => this.openApiKeysModal());
        document.getElementById('btn-aiad-config')?.addEventListener('click', () => this.openApiKeysModal());
        document.getElementById('aiad-prompt-templates')?.addEventListener('click', () => this.showTemplates());
        document.getElementById('btn-aigen-clear')?.addEventListener('click', () => this.clearAllGenerations());

        // Sidebar API Keys button
        document.getElementById('sidebar-ai-key-btn')?.addEventListener('click', () => this.openApiKeysModal());

        // Provider change → update UI
        const providerEl = document.getElementById('aiad-provider');
        if (providerEl) {
            const saved = localStorage.getItem('aiad_provider') || 'gpt-image-2';
            providerEl.value = saved;
            providerEl.addEventListener('change', () => {
                localStorage.setItem('aiad_provider', providerEl.value);
                this._onProviderChange();
            });
        }
        this._onProviderChange();

        // Renderiza histórico ao abrir aba "Minhas Gerações"
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (tab) => {
                if (tab === 'ai-generations') this.renderGenerationsGallery();
            });
        }
    },

    _onProviderChange() {
        const provider = this._getProvider();
        const qualityEl = document.getElementById('aiad-quality');
        if (qualityEl) {
            const isGoogle = provider === 'google' || provider === 'google-imagen2';
            qualityEl.disabled = isGoogle;
            qualityEl.style.opacity = isGoogle ? '0.45' : '';

            if (provider === 'gpt-image-2' || provider === 'gpt-image-1') {
                qualityEl.innerHTML = `
                    <option value="high" selected>Alta qualidade</option>
                    <option value="medium">Média</option>
                    <option value="low">Rascunho</option>`;
                qualityEl.title = `Qualidade para ${provider === 'gpt-image-2' ? 'GPT Image 2' : 'GPT Image 1'}`;
            } else if (provider === 'openai') {
                qualityEl.innerHTML = `
                    <option value="hd">HD</option>
                    <option value="standard">Padrão</option>`;
                qualityEl.title = 'Qualidade para DALL-E 3';
            } else {
                qualityEl.title = 'Qualidade não se aplica ao Google Imagen';
            }
        }
        // Update config button label
        const configBtn = document.getElementById('btn-aiad-config');
        if (configBtn) {
            configBtn.innerHTML = `<i data-lucide="key-round" style="width:14px;height:14px;vertical-align:-2px"></i> Chaves de API`;
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch(e) {}
        }
    },

    // ── Provider ─────────────────────────────────────────────────────
    _getProvider() {
        const sel = document.getElementById('aiad-provider');
        return (sel ? sel.value : null) || localStorage.getItem('aiad_provider') || 'gpt-image-2';
    },

    // Registro dos provedores de IA. Adicionar um novo provedor é só somar um
    // item aqui — a tela e a persistência são genéricas a partir disso.
    _PROVIDERS: [
        {
            id: 'openai', nome: 'OpenAI', storageKey: 'openai_api_key', prefixo: 'sk-',
            uso: 'GPT Image 1/2, DALL-E 3, GPT-4o-mini (copy) e a visão do Estúdio.',
            link: 'https://platform.openai.com/api-keys',
        },
        {
            id: 'google', nome: 'Google AI (Gemini)', storageKey: 'google_ai_api_key', prefixo: 'AIza',
            uso: 'Google Imagen 2/3 e o Gemini Image no Estúdio.',
            link: 'https://aistudio.google.com/app/apikey',
        },
        {
            id: 'grok', nome: 'xAI (Grok)', storageKey: 'grok_api_key', prefixo: 'xai-',
            uso: 'Geração de imagem com os modelos Grok Image.',
            link: 'https://console.x.ai',
        },
    ],

    _getKey(providerId) {
        const p = this._PROVIDERS.find(x => x.id === providerId);
        return (p && localStorage.getItem(p.storageKey)) || '';
    },
    _setKey(providerId, key) {
        const p = this._PROVIDERS.find(x => x.id === providerId);
        if (!p) return;
        if (key) localStorage.setItem(p.storageKey, key);
        else localStorage.removeItem(p.storageKey);
    },

    // Atalhos mantidos por compatibilidade — Studio e outras telas chamam
    // estes dois direto (ex.: window.AIAdGenerator?._getOpenAIKey?.()).
    _getOpenAIKey() { return this._getKey('openai'); },
    _setOpenAIKey(key) { this._setKey('openai', key); },
    _getGoogleKey() { return this._getKey('google'); },
    _setGoogleKey(key) { this._setKey('google', key); },
    _getGrokKey() { return this._getKey('grok'); },
    _setGrokKey(key) { this._setKey('grok', key); },

    // Mantido por retrocompatibilidade — quem chamava openConfig() foca no
    // provedor selecionado, mas agora todos aparecem na mesma tela.
    openConfig() { this.openApiKeysModal(); },
    _configOpenAI() { this.openApiKeysModal(); },
    _configGoogle() { this.openApiKeysModal(); },

    // ── Modal único de chaves de API (OpenAI / Google / Grok / futuros) ──
    openApiKeysModal() {
        this.renderApiKeysModal();
        if (typeof openModal === 'function') openModal('api-keys-modal');
    },

    renderApiKeysModal() {
        const lista = document.getElementById('api-keys-list');
        if (!lista) return;
        lista.innerHTML = this._PROVIDERS.map(p => {
            const atual = this._getKey(p.id);
            const status = atual
                ? `${this._esc(atual.slice(0, atual.startsWith(p.prefixo) ? p.prefixo.length + 4 : 4))}…${this._esc(atual.slice(-4))}`
                : 'nenhuma chave';
            return `
                <div class="apikeys-row" data-provider="${p.id}">
                    <div class="apikeys-row-head">
                        <strong>${this._esc(p.nome)}</strong>
                        <span class="apikeys-status ${atual ? 'is-set' : ''}">${atual ? '<i data-lucide="check-circle-2" style="width:13px;height:13px;vertical-align:-2px"></i> ' : ''}${status}</span>
                    </div>
                    <p class="apikeys-usage">${this._esc(p.uso)}</p>
                    <div class="apikeys-row-input">
                        <input type="password" class="input input-sm" data-key-input placeholder="${this._esc(p.prefixo)}..." autocomplete="off">
                        <button type="button" class="btn btn-secondary btn-sm" data-action="save">Salvar</button>
                        ${atual ? '<button type="button" class="btn btn-secondary btn-sm" data-action="remove">Remover</button>' : ''}
                    </div>
                    <a href="${p.link}" target="_blank" rel="noopener" class="apikeys-link">Obter chave <i data-lucide="external-link" style="width:12px;height:12px;vertical-align:-1px"></i></a>
                </div>`;
        }).join('');

        lista.querySelectorAll('.apikeys-row').forEach(row => {
            const providerId = row.dataset.provider;
            const p = this._PROVIDERS.find(x => x.id === providerId);
            const input = row.querySelector('[data-key-input]');
            row.querySelector('[data-action="save"]')?.addEventListener('click', () => {
                const val = input.value.trim();
                if (!val) { if (typeof showToast === 'function') showToast('Cole uma chave antes de salvar', 'error'); return; }
                // O prefixo é só um alerta de "colou a coisa errada" — nunca um
                // bloqueio. Provedores mudam o formato da chave sem avisar (a
                // Google já tem pelo menos dois formatos válidos de chave), e
                // travar o salvamento nisso deixa o usuário sem conseguir usar
                // uma chave real só porque não bate com o padrão que eu conhecia.
                const foraDoPadrao = p.prefixo && !val.startsWith(p.prefixo);
                this._setKey(providerId, val);
                if (typeof showToast === 'function') {
                    showToast(
                        foraDoPadrao
                            ? `Chave ${p.nome} salva — formato incomum (não começa com "${p.prefixo}"). Se a geração falhar, confira se colou a chave certa.`
                            : `Chave ${p.nome} salva <i data-lucide="check" style="width:13px;height:13px;vertical-align:-2px"></i>`,
                        foraDoPadrao ? 'warning' : 'success'
                    );
                }
                this.renderApiKeysModal();
            });
            row.querySelector('[data-action="remove"]')?.addEventListener('click', () => {
                this._setKey(providerId, '');
                if (typeof showToast === 'function') showToast(`Chave ${p.nome} removida`, 'success');
                this.renderApiKeysModal();
            });
        });
        if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch (e) {}
    },

    // ── Generate images ───────────────────────────────────────────────
    async generateImages(opts) {
        opts = opts || {};
        const prompt = (opts.prompt != null ? opts.prompt : document.getElementById('aiad-prompt')?.value || '').trim();
        if (!prompt) {
            if (typeof showToast === 'function') showToast('Escreva um prompt antes de gerar', 'error');
            return;
        }

        const provider = opts.provider || this._getProvider();
        const size = opts.size || document.getElementById('aiad-size')?.value || '1024x1024';
        const count = parseInt(opts.count || document.getElementById('aiad-count')?.value || '1', 10);
        const quality = opts.quality || document.getElementById('aiad-quality')?.value || 'standard';
        const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

        const providerLabel = { 'google': 'Google Imagen 3', 'google-imagen2': 'Google Imagen 2', 'gpt-image-2': 'GPT Image 2', 'gpt-image-1': 'GPT Image 1', 'openai': 'DALL-E 3' }[provider] || provider;
        const results = document.getElementById('aiad-results');
        if (results) {
            results.innerHTML = `<div class="aiad-loading">Gerando ${count} imagem(ns) com ${providerLabel}…</div>`;
        }
        if (onProgress) onProgress('start', { count, providerLabel });

        try {
            let items;
            if (provider === 'google') {
                items = await this._generateWithGoogle(prompt, size, count);
            } else if (provider === 'google-imagen2') {
                items = await this._generateWithGoogleImagen2(prompt, size, count);
            } else if (provider === 'gpt-image-2') {
                items = await this._generateWithGPTImage(prompt, size, count, quality, 'gpt-image-2');
            } else if (provider === 'gpt-image-1') {
                items = await this._generateWithGPTImage(prompt, size, count, quality, 'gpt-image-1');
            } else {
                items = await this._generateWithOpenAI(prompt, size, count, quality);
            }

            if (!items.length) throw new Error('Nenhuma imagem retornada');

            // Comprimir para WebP antes de salvar
            if (results) results.innerHTML = `<div class="aiad-loading">Comprimindo para WebP…</div>`;
            const compressed = await Promise.all(items.map(async item => ({
                ...item,
                dataUrl: await this._compressToWebP(item.dataUrl)
            })));

            // Salva primeiro (os bytes vão pro IndexedDB) e renderiza o registro
            // leve devolvido, pra tela e armazenamento nunca divergirem.
            const salvos = await this._saveGenerations(compressed);
            await this._renderResults(salvos);
            if (onProgress) onProgress('done', { items: salvos });
            if (typeof EventBus !== 'undefined') EventBus.emit('aigenChanged');
            this.renderGenerationsGallery();
            if (typeof showToast === 'function') showToast(`${compressed.length} imagem(ns) gerada(s) <i data-lucide="check" style="width:13px;height:13px;vertical-align:-2px"></i>`, 'success');

        } catch (err) {
            console.error('[AIAdGenerator]', err);
            if (onProgress) onProgress('error', { error: err });
            if (results) {
                results.innerHTML = `
                    <div class="aiad-empty">
                        <i data-lucide="alert-circle" style="width:32px;height:32px;color:#dc2626"></i>
                        <h3>Falha na geração</h3>
                        <p>${this._esc(err.message || 'Erro desconhecido')}</p>
                    </div>
                `;
                if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch(e) {}
            }
            if (typeof showToast === 'function') showToast('Falha: ' + err.message, 'error');
        }
    },

    // ── OpenAI DALL-E 3 ───────────────────────────────────────────────
    async _generateWithOpenAI(prompt, size, count, quality) {
        const key = this._getOpenAIKey();
        if (!key) {
            this._configOpenAI();
            throw new Error('Chave OpenAI não configurada');
        }

        // DALL-E 3 só suporta n=1 por chamada — paralelizar
        const promises = Array.from({ length: count }, () =>
            fetch('https://api.openai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: 'dall-e-3',
                    prompt,
                    n: 1,
                    size,
                    quality,
                    response_format: 'b64_json'
                })
            }).then(r => r.json())
        );

        const responses = await Promise.all(promises);
        const errors = responses.filter(r => r.error).map(r => r.error.message);
        if (errors.length === responses.length) throw new Error(errors[0] || 'Falha em todas as gerações');

        return responses.flatMap(r => r.data || []).map(d => ({
            id: 'gen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            provider: 'openai',
            prompt,
            size,
            createdAt: new Date().toISOString(),
            dataUrl: `data:image/png;base64,${d.b64_json}`,
            revisedPrompt: d.revised_prompt || null
        }));
    },

    // ── GPT Image 1 / 2 (OpenAI) ─────────────────────────────────────
    async _generateWithGPTImage(prompt, size, count, quality, model) {
        const key = this._getOpenAIKey();
        if (!key) {
            this._configOpenAI();
            throw new Error('Chave OpenAI não configurada');
        }

        const sizeMap = { '1792x1024': '1536x1024', '1024x1792': '1024x1536', '1024x1024': '1024x1024' };
        const mappedSize = sizeMap[size] || '1024x1024';

        const res = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({ model, prompt, n: count, size: mappedSize, quality: quality || 'high' })
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error.message || `Erro ${model}`);
        if (!data.data?.length) throw new Error(`${model} não retornou imagens`);

        return data.data.map(d => ({
            id: 'gen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            provider: model,
            prompt,
            size: mappedSize,
            createdAt: new Date().toISOString(),
            dataUrl: `data:image/png;base64,${d.b64_json}`,
            revisedPrompt: null
        }));
    },

    // ── Google Imagen 3 ────────────────────────────────────────────────
    async _generateWithGoogle(prompt, size, count) {
        const key = this._getGoogleKey();
        if (!key) {
            this._configGoogle();
            throw new Error('Chave Google AI não configurada');
        }

        // Mapa size → aspectRatio
        const aspectMap = {
            '1024x1024': '1:1',
            '1024x1792': '9:16',
            '1792x1024': '16:9'
        };
        const aspectRatio = aspectMap[size] || '1:1';

        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-001:predict?key=${key}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instances: [{ prompt }],
                    parameters: {
                        sampleCount: Math.min(count, 4),
                        aspectRatio,
                        safetyFilterLevel: 'block_some',
                        personGeneration: 'allow_adult'
                    }
                })
            }
        );

        const data = await res.json();
        if (data.error) throw new Error(data.error.message || 'Erro na Google Imagen API');

        const predictions = data.predictions || [];
        if (!predictions.length) throw new Error('Google Imagen não retornou imagens. Verifique sua chave e região.');

        const now = Date.now();
        return predictions.map((p, i) => ({
            id: 'gen_' + (now + i) + '_' + Math.random().toString(36).slice(2, 7),
            provider: 'google',
            prompt,
            size,
            createdAt: new Date().toISOString(),
            dataUrl: `data:${p.mimeType || 'image/png'};base64,${p.bytesBase64Encoded}`
        }));
    },

    // ── Google Imagen 2 ────────────────────────────────────────────────
    async _generateWithGoogleImagen2(prompt, size, count) {
        const key = this._getGoogleKey();
        if (!key) {
            this._configGoogle();
            throw new Error('Chave Google AI não configurada');
        }

        const aspectMap = { '1024x1024': '1:1', '1024x1792': '9:16', '1792x1024': '16:9' };
        const aspectRatio = aspectMap[size] || '1:1';

        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/imagen-2.0-generate-001:predict?key=${key}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instances: [{ prompt }],
                    parameters: {
                        sampleCount: Math.min(count, 4),
                        aspectRatio,
                        safetyFilterLevel: 'block_some',
                        personGeneration: 'allow_adult'
                    }
                })
            }
        );

        const data = await res.json();
        if (data.error) throw new Error(data.error.message || 'Erro Google Imagen 2');
        const predictions = data.predictions || [];
        if (!predictions.length) throw new Error('Google Imagen 2 não retornou imagens. Verifique sua chave e região.');

        const now = Date.now();
        return predictions.map((p, i) => ({
            id: 'gen_' + (now + i) + '_' + Math.random().toString(36).slice(2, 7),
            provider: 'google-imagen2',
            prompt,
            size,
            createdAt: new Date().toISOString(),
            dataUrl: `data:${p.mimeType || 'image/png'};base64,${p.bytesBase64Encoded}`
        }));
    },

    // ── WebP compression via canvas ────────────────────────────────────
    async _compressToWebP(dataUrl, quality = 0.85) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    canvas.toBlob(blob => {
                        if (!blob) { resolve(dataUrl); return; }
                        const reader = new FileReader();
                        reader.onloadend = () => resolve(reader.result || dataUrl);
                        reader.onerror = () => resolve(dataUrl);
                        reader.readAsDataURL(blob);
                    }, 'image/webp', quality);
                } catch {
                    resolve(dataUrl);
                }
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
        });
    },

    // ══════════════════════════════════════════════════════════════════
    //  ARMAZENAMENTO DE MÍDIA
    //  Os bytes da imagem vão para o IndexedDB (MediaStore); no localStorage
    //  fica só um índice leve com uma miniatura de poucos KB. Antes, cada
    //  geração gravava o base64 inteiro no localStorage — a cota estourava
    //  em ~10 imagens e o app APAGAVA as antigas em silêncio pra caber.
    //  Registros antigos (com dataUrl) continuam funcionando e migram sozinhos.
    // ══════════════════════════════════════════════════════════════════

    // Miniatura pequena: aparece na hora na galeria, sem tocar o IndexedDB.
    async _makeThumb(dataUrl, maxDim = 320, quality = 0.6) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                try {
                    const escala = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.max(1, Math.round(img.naturalWidth * escala));
                    canvas.height = Math.max(1, Math.round(img.naturalHeight * escala));
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL('image/webp', quality));
                } catch { resolve(''); }
            };
            img.onerror = () => resolve('');
            img.src = dataUrl;
        });
    },

    async _dataUrlToBlob(dataUrl) {
        try { return await (await fetch(dataUrl)).blob(); } catch { return null; }
    },

    _blobParaDataUrl(blob) {
        return new Promise(resolve => {
            const r = new FileReader();
            r.onloadend = () => resolve(r.result || '');
            r.onerror = () => resolve('');
            r.readAsDataURL(blob);
        });
    },

    _mediaOk() {
        return !!(window.MediaStore && window.MediaStore.isSupported());
    },

    // Guarda os bytes no IndexedDB e devolve o registro leve que vai pro índice.
    async _toLightRecord(item) {
        const thumb = await this._makeThumb(item.dataUrl);
        if (!this._mediaOk()) return { ...item, thumb };   // sem IndexedDB, segue no modo antigo

        const blob = await this._dataUrlToBlob(item.dataUrl);
        if (!blob) return { ...item, thumb };

        const mediaId = 'aigen_' + item.id;
        try {
            await window.MediaStore.put(mediaId, blob, { type: blob.type || 'image/webp', name: `ai-${item.id}.webp` });
            // Só descarta o base64 depois de confirmar que dá pra ler de volta.
            const conferido = await window.MediaStore.get(mediaId);
            if (!conferido || !conferido.blob) return { ...item, thumb };
            const { dataUrl, ...resto } = item;
            return { ...resto, mediaId, mime: blob.type || 'image/webp', thumb };
        } catch (e) {
            console.warn('[AIAdGenerator] MediaStore.put falhou, mantendo base64:', e?.message);
            return { ...item, thumb };
        }
    },

    // Devolve uma URL exibível. Registro novo → objectURL do IndexedDB (o
    // chamador deve revogar). Registro antigo → o próprio dataUrl.
    async _resolveSrc(item) {
        if (!item) return '';
        if (item.mediaId && this._mediaOk()) {
            const url = await window.MediaStore.getObjectUrl(item.mediaId);
            if (url) return url;
        }
        return item.dataUrl || item.thumb || '';
    },

    // Migração preguiçosa: registro antigo vira registro leve na primeira vez
    // que a galeria o exibe. Nunca joga o base64 fora sem confirmar a gravação.
    async _migrarAntigos(lista) {
        if (!this._mediaOk()) return false;
        const pendentes = lista.filter(i => i.dataUrl && !i.mediaId);
        if (!pendentes.length) return false;

        let migrados = 0;
        for (const antigo of pendentes.slice(0, 20)) {   // em lotes, pra não travar a tela
            const novo = await this._toLightRecord(antigo);
            if (novo.mediaId) {
                const idx = lista.findIndex(i => i.id === antigo.id);
                if (idx >= 0) { lista[idx] = novo; migrados++; }
            }
        }
        if (migrados) {
            this._saveIndex(lista);
            console.info(`[AIAdGenerator] ${migrados} geração(ões) movida(s) para o IndexedDB`);
        }
        return migrados > 0;
    },

    // ── Render results ────────────────────────────────────────────────
    async _renderResults(items) {
        const results = document.getElementById('aiad-results');
        if (!results) return;

        // Resolve as URLs antes de montar o HTML (registro novo vive no IndexedDB).
        const srcs = await Promise.all(items.map(i => this._resolveSrc(i)));
        this._revogarUrls(this._urlsResultados);
        this._urlsResultados = srcs.filter(u => u.startsWith('blob:'));

        results.innerHTML = items.map((item, i) => `
            <div class="aiad-result-item" data-id="${item.id}">
                <img src="${srcs[i]}" alt="${this._esc(item.prompt.slice(0, 60))}" loading="lazy">
                <div class="aiad-result-badge ${ (item.provider === 'google' || item.provider === 'google-imagen2') ? 'aiad-badge-google' : 'aiad-badge-openai'}">
                    ${ {'google':'Google Imagen 3','google-imagen2':'Google Imagen 2','gpt-image-2':'GPT Image 2','gpt-image-1':'GPT Image 1','openai':'DALL-E 3'}[item.provider] || item.provider }
                </div>
                <div class="aiad-result-actions">
                    <button class="btn btn-secondary btn-sm" data-action="download" data-id="${item.id}" title="Baixar WebP"><i data-lucide="download" style="width:13px;height:13px"></i></button>
                    <button class="btn btn-secondary btn-sm" data-action="copy-prompt" data-id="${item.id}" title="Copiar prompt"><i data-lucide="copy" style="width:13px;height:13px"></i></button>
                    <button class="btn btn-secondary btn-sm" data-action="regen" data-id="${item.id}" title="Gerar variação"><i data-lucide="refresh-cw" style="width:13px;height:13px"></i></button>
                </div>
            </div>
        `).join('');

        if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch(e) {}

        results.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => this._handleAction(btn.dataset.action, btn.dataset.id, items));
        });
    },

    // Object URLs precisam ser revogados, senão o blob fica preso na memória.
    _urlsResultados: [],
    _urlsGaleria: [],
    _revogarUrls(lista) {
        (lista || []).forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
    },

    // Baixa sempre o arquivo cheio (do IndexedDB), nunca a miniatura.
    async _baixar(item, id) {
        const src = await this._resolveSrc(item);
        if (!src) { if (typeof showToast === 'function') showToast('Imagem não encontrada', 'error'); return; }
        const ext = (item.mime || item.dataUrl || '').includes('webp') ? 'webp' : 'png';
        const a = document.createElement('a');
        a.href = src;
        a.download = `ai-ad-${id}.${ext}`;
        a.click();
        if (src.startsWith('blob:')) setTimeout(() => { try { URL.revokeObjectURL(src); } catch {} }, 10000);
    },

    async _handleAction(action, id, items) {
        const item = items.find(i => i.id === id);
        if (!item) return;

        if (action === 'download') {
            await this._baixar(item, id);
        } else if (action === 'copy-prompt') {
            navigator.clipboard.writeText(item.revisedPrompt || item.prompt).then(() => {
                if (typeof showToast === 'function') showToast('Prompt copiado', 'success');
            });
        } else if (action === 'regen') {
            const promptEl = document.getElementById('aiad-prompt');
            if (promptEl) promptEl.value = item.prompt;
            this.generateImages();
        }
    },

    // ── Generate copy (always OpenAI) ─────────────────────────────────
    async generateCopy() {
        const prompt = document.getElementById('aiad-prompt')?.value.trim();
        if (!prompt) {
            if (typeof showToast === 'function') showToast('Escreva um prompt antes de gerar', 'error');
            return;
        }

        const key = this._getOpenAIKey();
        if (!key) {
            if (typeof showToast === 'function') showToast('Gerar copy requer chave OpenAI', 'error');
            this._configOpenAI();
            return;
        }

        const out = document.getElementById('aiad-copy-output');
        const body = document.getElementById('aiad-copy-body');
        if (out) out.style.display = '';
        if (body) body.innerHTML = `<div class="aiad-loading">Gerando copy…</div>`;

        try {
            const sysPrompt = `Você é um copywriter de e-commerce. Receba a descrição do produto/anúncio e gere copy em português brasileiro: 3 headlines curtas (até 40 chars), 3 descrições (até 125 chars) e 3 CTAs (até 20 chars). Responda APENAS em JSON válido com a estrutura: {"headlines":[],"descriptions":[],"ctas":[]}`;

            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${key}`
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [
                        { role: 'system', content: sysPrompt },
                        { role: 'user', content: prompt }
                    ],
                    response_format: { type: 'json_object' },
                    temperature: 0.8
                })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            const content = data.choices?.[0]?.message?.content || '{}';
            const parsed = JSON.parse(content);
            this._renderCopy(parsed);
        } catch (err) {
            if (body) body.innerHTML = `<p style="color:#dc2626">Erro: ${this._esc(err.message)}</p>`;
        }
    },

    _renderCopy(parsed) {
        const body = document.getElementById('aiad-copy-body');
        if (!body) return;
        const renderList = (label, items) => `
            <div class="aiad-copy-section">
                <h4>${label}</h4>
                <div class="aiad-copy-text-list">
                    ${(items || []).map(t => `
                        <div class="aiad-copy-text" data-copy="${this._esc(t)}">
                            <span>${this._esc(t)}</span>
                            <i data-lucide="copy" style="width:13px;height:13px;color:var(--text-muted)"></i>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        body.innerHTML =
            renderList('Headlines', parsed.headlines) +
            renderList('Descrições', parsed.descriptions) +
            renderList('CTAs', parsed.ctas);
        if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch(e) {}

        body.querySelectorAll('.aiad-copy-text').forEach(el => {
            el.addEventListener('click', () => {
                navigator.clipboard.writeText(el.dataset.copy).then(() => {
                    if (typeof showToast === 'function') showToast('Copiado: ' + el.dataset.copy.slice(0, 40), 'success');
                });
            });
        });
    },

    // ── Templates ─────────────────────────────────────────────────────
    showTemplates() {
        const templates = [
            'Foto profissional de produto: [PRODUTO] em fundo branco minimalista, iluminação suave de estúdio, alta resolução, estilo Apple',
            'Lifestyle: pessoa usando [PRODUTO] em [CENÁRIO], luz natural, hora dourada, fotografia editorial',
            'Comparativo: [PRODUTO] versus alternativa pior, lado-a-lado, anotações destacando vantagens',
            'Antes/Depois: cenário antes sem [PRODUTO], cenário depois com [PRODUTO], transformação visível',
            'Close-up de detalhe: textura/material de [PRODUTO], macro fotografia, mostrando qualidade',
        ];
        const choice = prompt(
            'Templates de prompt (cola e edita):\n\n' +
            templates.map((t, i) => `${i + 1}. ${t}`).join('\n\n') +
            '\n\nDigite o número (1-5):'
        );
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < templates.length) {
            const promptEl = document.getElementById('aiad-prompt');
            if (promptEl) {
                promptEl.value = templates[idx];
                promptEl.focus();
            }
        }
    },

    // ── Persistence ────────────────────────────────────────────────────
    // Teto do índice. Com os bytes fora do localStorage cada registro pesa
    // poucos KB (só a miniatura), então cabe muito mais que os 50 de antes.
    MAX_GERACOES: 300,

    async _saveGenerations(items) {
        const leves = [];
        for (const item of items) leves.push(await this._toLightRecord(item));

        const all = this._getAllGenerations();
        all.unshift(...leves);

        const excedente = all.slice(this.MAX_GERACOES);
        const mantidos = all.slice(0, this.MAX_GERACOES);
        // Quem sai do índice leva o blob junto — senão o IndexedDB vira depósito de órfãos.
        for (const velho of excedente) await this._apagarBlob(velho);

        this._saveIndex(mantidos);
        return leves;
    },

    // Grava o índice. Se ainda assim faltar espaço, usa a recuperação de cota
    // do app antes de desistir (e só então corta os mais antigos).
    _saveIndex(lista) {
        const gravar = () => localStorage.setItem(this.STORAGE_KEY, JSON.stringify(lista));
        try {
            if (window.StorageManager?.withReclaim) StorageManager.withReclaim(gravar);
            else gravar();
            return true;
        } catch (e) {
            console.warn('[AIAdGenerator] índice não coube:', e?.name || e?.message);
            for (const corte of [100, 50, 20]) {
                try {
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(lista.slice(0, corte)));
                    if (typeof showToast === 'function') {
                        showToast(`Armazenamento cheio — mantendo as ${corte} gerações mais recentes.`, 'warning');
                    }
                    return true;
                } catch { /* tenta o corte seguinte */ }
            }
            if (typeof showToast === 'function') {
                showToast('Não consegui salvar a galeria: armazenamento cheio. Use "Limpar" em AI Generations.', 'error');
            }
            return false;
        }
    },

    async _apagarBlob(item) {
        if (item?.mediaId && this._mediaOk()) {
            try { await window.MediaStore.del(item.mediaId); } catch { /* já não existe */ }
        }
    },

    _getAllGenerations() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
        } catch { return []; }
    },

    // ── Gallery (Minhas Gerações tab) ──────────────────────────────────
    async renderGenerationsGallery() {
        const grid = document.getElementById('aigen-grid');
        if (!grid) return;
        const all = this._getAllGenerations();

        // Registros antigos (base64 no localStorage) sobem pro IndexedDB aqui,
        // em lotes, na primeira vez que aparecem. Se algum migrou, redesenha.
        if (await this._migrarAntigos(all)) {
            if (typeof EventBus !== 'undefined') EventBus.emit('aigenChanged');
        }

        if (!all.length) {
            grid.innerHTML = `<div class="adhub-empty" style="padding:4rem 0;grid-column:1/-1">
                <i data-lucide="wand-2" style="width:48px;height:48px;color:var(--text-muted)"></i>
                <h3>Nenhuma geração ainda</h3>
                <p>Use a barra abaixo: descreva uma ideia, escolha o aspecto e gere seu primeiro ad.</p>
            </div>`;
            if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch(e) {}
            return;
        }
        grid.innerHTML = all.map(item => `
            <div class="aigen-card" data-id="${item.id}">
                <div class="aigen-card-thumb">
                    <img src="${item.thumb || item.dataUrl || ''}" alt="${this._esc(item.prompt.slice(0, 60))}" loading="lazy">
                    <div class="aigen-card-overlay">
                        <button class="btn btn-primary btn-sm" data-action="similar" data-id="${item.id}"><i data-lucide="sparkles" style="width:13px;height:13px"></i> Generate Similar</button>
                    </div>
                </div>
                <div class="aigen-card-meta">
                    <span class="aigen-card-prompt" title="${this._esc(item.revisedPrompt || item.prompt)}">${this._esc((item.prompt || '').slice(0, 80))}${(item.prompt || '').length > 80 ? '…' : ''}</span>
                    <div class="aigen-card-actions">
                        <span class="aiad-result-badge ${ (item.provider === 'google' || item.provider === 'google-imagen2') ? 'aiad-badge-google' : 'aiad-badge-openai'}">${ {'google':'Imagen 3','google-imagen2':'Imagen 2','gpt-image-2':'GPT Image 2','gpt-image-1':'GPT Image 1','openai':'DALL-E 3'}[item.provider] || item.provider }</span>
                        <button class="btn-icon" data-action="save-creative" data-id="${item.id}" title="Salvar em Meus Criativos"><i data-lucide="bookmark-plus" style="width:13px;height:13px"></i></button>
                        <button class="btn-icon" data-action="dl" data-id="${item.id}" title="Baixar"><i data-lucide="download" style="width:13px;height:13px"></i></button>
                        <button class="btn-icon" data-action="cp" data-id="${item.id}" title="Copiar prompt"><i data-lucide="copy" style="width:13px;height:13px"></i></button>
                        <button class="btn-icon" data-action="del" data-id="${item.id}" title="Excluir"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                    </div>
                </div>
            </div>
        `).join('');
        if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch(e) {}

        grid.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const item = all.find(i => i.id === id);
                if (!item) return;
                const action = btn.dataset.action;
                if (action === 'dl') {
                    await this._baixar(item, id);
                } else if (action === 'cp') {
                    navigator.clipboard.writeText(item.revisedPrompt || item.prompt);
                    if (typeof showToast === 'function') showToast('Prompt copiado', 'success');
                } else if (action === 'del') {
                    await this._apagarBlob(item);
                    this._saveIndex(all.filter(i => i.id !== id));
                    // O Ad Launcher lê esta mesma lista — sem o evento ele
                    // continuaria oferecendo uma imagem já apagada.
                    if (typeof EventBus !== 'undefined') EventBus.emit('aigenChanged');
                    this.renderGenerationsGallery();
                } else if (action === 'similar') {
                    const promptEl = document.getElementById('adhub-prompt-text');
                    if (promptEl) {
                        promptEl.value = item.prompt || '';
                        promptEl.dispatchEvent(new Event('input'));
                        promptEl.focus();
                    }
                } else if (action === 'save-creative') {
                    this._openSaveCreativeModal(item);
                }
            });
        });
    },

    _openSaveCreativeModal(item) {
        const products = (AppState.allProducts || AppState.products || []).filter(p => p.status !== 'inativo');
        if (!products.length) {
            if (typeof showToast === 'function') showToast('Crie um produto antes de salvar criativos', 'error');
            return;
        }
        // Build modal HTML
        const opts = products.map(p => `<option value="${this._esc(p.id)}">${this._esc(p.name)}</option>`).join('');
        // Mesmo gerador de nome do resto da ferramenta (produto + tipo, com
        // contador) — só cai pro prompt truncado se o CreativesModule não
        // tiver carregado por algum motivo.
        const gerarNome = (productId) => (typeof CreativesModule?._gerarNomeAutomatico === 'function')
            ? CreativesModule._gerarNomeAutomatico({ productId, type: 'Imagem' })
            : ((item.prompt || '').slice(0, 60).trim() || 'AI Creative');
        const defaultName = gerarNome('');
        const modalHtml = `
            <div id="modal-save-creative-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;">
                <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:1.5rem;width:min(420px,90vw);display:flex;flex-direction:column;gap:1rem;">
                    <div style="display:flex;align-items:center;gap:0.75rem;">
                        <img src="${item.dataUrl}" style="width:64px;height:64px;object-fit:cover;border-radius:6px;flex-shrink:0">
                        <div>
                            <strong style="font-size:1rem">Salvar em Criativos</strong>
                            <p style="margin:0.2rem 0 0;font-size:0.8rem;color:var(--text-muted)">Escolha um produto e dê um nome ao criativo.</p>
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.6rem;">
                        <label style="font-size:0.8rem;font-weight:600;color:var(--text-secondary)">Produto *</label>
                        <select id="sc-product-select" class="input" style="width:100%">
                            <option value="">-- Selecione o produto --</option>
                            ${opts}
                        </select>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.6rem;">
                        <label style="font-size:0.8rem;font-weight:600;color:var(--text-secondary)">Nome do criativo</label>
                        <input id="sc-name-input" class="input" type="text" value="${this._esc(defaultName)}" style="width:100%">
                    </div>
                    <div style="display:flex;gap:0.6rem;justify-content:flex-end">
                        <button id="sc-cancel-btn" class="btn btn-secondary btn-sm">Cancelar</button>
                        <button id="sc-save-btn" class="btn btn-primary btn-sm"><i data-lucide="bookmark-plus" style="width:13px;height:13px;vertical-align:-1px"></i> Salvar</button>
                    </div>
                </div>
            </div>`;
        const el = document.createElement('div');
        el.innerHTML = modalHtml;
        document.body.appendChild(el.firstElementChild);
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch(e) {}

        const overlay = document.getElementById('modal-save-creative-overlay');
        const close = () => overlay?.remove();

        document.getElementById('sc-cancel-btn')?.addEventListener('click', close);
        overlay?.addEventListener('click', (e) => { if (e.target === overlay) close(); });

        // Ao escolher o produto, upgrada o nome pra incluir o nome dele —
        // mas só se o usuário ainda não mexeu no campo manualmente.
        const nameInput = document.getElementById('sc-name-input');
        let nomeEditadoManualmente = false;
        nameInput?.addEventListener('input', () => { nomeEditadoManualmente = true; });
        document.getElementById('sc-product-select')?.addEventListener('change', (e) => {
            if (nomeEditadoManualmente || !nameInput) return;
            nameInput.value = gerarNome(e.target.value);
        });

        document.getElementById('sc-save-btn')?.addEventListener('click', async () => {
            const productId = document.getElementById('sc-product-select')?.value;
            const name = document.getElementById('sc-name-input')?.value.trim() || defaultName;
            if (!productId) { if (typeof showToast === 'function') showToast('Selecione um produto', 'error'); return; }

            // O criativo recebe uma CÓPIA do blob: excluir o criativo apaga o
            // mediaId dele (CreativesModule.deleteCreative), e compartilhar o id
            // destruiria a geração original da galeria.
            let mediaId = '', mediaType = '', mediaThumb = item.thumb || '';
            if (this._mediaOk()) {
                try {
                    const src = await this._resolveSrc(item);
                    const blob = src.startsWith('blob:')
                        ? await (await fetch(src)).blob()
                        : await this._dataUrlToBlob(src);
                    if (blob) {
                        mediaId = 'media_ai_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                        await window.MediaStore.put(mediaId, blob, { type: blob.type, name: `${name}.webp` });
                        mediaType = blob.type || 'image/webp';
                        if (!mediaThumb) mediaThumb = await this._makeThumb(await this._blobParaDataUrl(blob));
                    }
                    if (src.startsWith('blob:')) { try { URL.revokeObjectURL(src); } catch {} }
                } catch (e) {
                    console.warn('[AIAdGenerator] cópia da mídia falhou:', e?.message);
                }
            }
            // Sem IndexedDB, cai no modo antigo (base64 direto no criativo).
            const imageUrl = mediaId ? '' : (item.dataUrl || item.thumb || '');

            const product = products.find(p => p.id === productId);
            const creative = {
                id: 'crtv_ai_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
                productId,
                name,
                type: 'Imagem',
                angle: '',
                hookText: (item.prompt || '').slice(0, 120),
                hookType: 'Curiosidade',
                platform: 'Meta Ads',
                status: 'ativo',
                launchDate: (typeof todayISO === 'function' ? todayISO() : new Date().toISOString().slice(0, 10)),
                primaryText: '',
                headline: '',
                adDescription: '',
                imageUrl,
                mediaId, mediaType, mediaThumb, mediaName: mediaId ? `${name}.webp` : '',
                variations: [],
                storeId: product?.storeId || (typeof getWritableStoreId === 'function' ? getWritableStoreId(productId) : ''),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            if (!AppState.allCreatives) AppState.allCreatives = [];
            AppState.allCreatives.push(creative);
            if (typeof filterDataByStore === 'function') filterDataByStore();
            if (typeof LocalStore !== 'undefined') LocalStore.save('creatives', AppState.allCreatives);
            if (typeof EventBus !== 'undefined') EventBus.emit('creativesChanged');
            if (typeof showToast === 'function') showToast(`Criativo salvo em "${name}"`, 'success');
            close();
        });
    },

    async clearAllGenerations() {
        if (!confirm('Apagar TODAS as gerações? Não dá pra recuperar.')) return;
        // Apaga também os blobs do IndexedDB — limpar só o índice deixaria
        // as imagens ocupando espaço para sempre, invisíveis.
        const all = this._getAllGenerations();
        for (const item of all) await this._apagarBlob(item);
        localStorage.removeItem(this.STORAGE_KEY);
        if (typeof EventBus !== 'undefined') EventBus.emit('aigenChanged');
        this.renderGenerationsGallery();
        if (typeof showToast === 'function') showToast('Galeria limpa', 'success');
    },

    _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
};

window.AIAdGenerator = AIAdGenerator;
AIAdGenerator.init();
