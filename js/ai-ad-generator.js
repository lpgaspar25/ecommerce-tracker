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
        document.getElementById('aiad-config')?.addEventListener('click', () => this.openConfig());
        document.getElementById('btn-aiad-config')?.addEventListener('click', () => this.openConfig());
        document.getElementById('aiad-prompt-templates')?.addEventListener('click', () => this.showTemplates());
        document.getElementById('btn-aigen-clear')?.addEventListener('click', () => this.clearAllGenerations());

        // Sidebar API Keys button
        document.getElementById('sidebar-ai-key-btn')?.addEventListener('click', () => this.openConfig());

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
            const label = (provider === 'google' || provider === 'google-imagen2') ? 'Configurar Google AI' : 'Configurar OpenAI';
            configBtn.innerHTML = `<i data-lucide="key-round" style="width:14px;height:14px;vertical-align:-2px"></i> ${label}`;
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch(e) {}
        }
    },

    // ── Provider ─────────────────────────────────────────────────────
    _getProvider() {
        const sel = document.getElementById('aiad-provider');
        return (sel ? sel.value : null) || localStorage.getItem('aiad_provider') || 'gpt-image-2';
    },

    // ── OpenAI key ───────────────────────────────────────────────────
    _getOpenAIKey() {
        return localStorage.getItem('openai_api_key') || '';
    },
    _setOpenAIKey(key) {
        if (key) localStorage.setItem('openai_api_key', key);
        else localStorage.removeItem('openai_api_key');
    },

    // ── Google AI key ────────────────────────────────────────────────
    _getGoogleKey() {
        return localStorage.getItem('google_ai_api_key') || '';
    },
    _setGoogleKey(key) {
        if (key) localStorage.setItem('google_ai_api_key', key);
        else localStorage.removeItem('google_ai_api_key');
    },

    // ── Config dialogs ───────────────────────────────────────────────
    openConfig() {
        if (this._getProvider() === 'google') {
            this._configGoogle();
        } else {
            this._configOpenAI();
        }
    },

    _configOpenAI() {
        const current = this._getOpenAIKey();
        const masked = current ? `${current.slice(0, 7)}…${current.slice(-4)}` : '(vazio)';
        const newKey = prompt(
            `Cole sua chave OpenAI (sk-...).\n\nUsada para DALL-E 3 (imagens) + GPT-4o-mini (copies).\nObtenha em: https://platform.openai.com/api-keys\n\nAtual: ${masked}\n\nDeixe vazio + OK para remover.`,
            current
        );
        if (newKey === null) return;
        const trimmed = newKey.trim();
        if (trimmed && !trimmed.startsWith('sk-')) {
            if (typeof showToast === 'function') showToast('Chave inválida — deve começar com "sk-"', 'error');
            return;
        }
        this._setOpenAIKey(trimmed);
        if (typeof showToast === 'function') showToast(trimmed ? 'Chave OpenAI salva ✓' : 'Chave OpenAI removida', 'success');
    },

    _configGoogle() {
        const current = this._getGoogleKey();
        const masked = current ? `${current.slice(0, 6)}…${current.slice(-4)}` : '(vazio)';
        const newKey = prompt(
            `Cole sua chave Google AI Studio (AIza...).\n\nUsada para Google Imagen 3.\nObtenha em: https://aistudio.google.com/app/apikey\n\nAtual: ${masked}\n\nDeixe vazio + OK para remover.`,
            current
        );
        if (newKey === null) return;
        const trimmed = newKey.trim();
        this._setGoogleKey(trimmed);
        if (typeof showToast === 'function') showToast(trimmed ? 'Chave Google AI salva ✓' : 'Chave Google AI removida', 'success');
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

            this._saveGenerations(compressed);
            this._renderResults(compressed);
            if (onProgress) onProgress('done', { items: compressed });
            if (typeof EventBus !== 'undefined') EventBus.emit('aigenChanged');
            this.renderGenerationsGallery();
            if (typeof showToast === 'function') showToast(`${compressed.length} imagem(ns) gerada(s) ✓`, 'success');

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

    // ── Render results ────────────────────────────────────────────────
    _renderResults(items) {
        const results = document.getElementById('aiad-results');
        if (!results) return;

        results.innerHTML = items.map(item => `
            <div class="aiad-result-item" data-id="${item.id}">
                <img src="${item.dataUrl}" alt="${this._esc(item.prompt.slice(0, 60))}" loading="lazy">
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

    _handleAction(action, id, items) {
        const item = items.find(i => i.id === id);
        if (!item) return;

        if (action === 'download') {
            const ext = item.dataUrl.startsWith('data:image/webp') ? 'webp' : 'png';
            const a = document.createElement('a');
            a.href = item.dataUrl;
            a.download = `ai-ad-${id}.${ext}`;
            a.click();
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
    _saveGenerations(items) {
        const all = this._getAllGenerations();
        all.unshift(...items);
        // Cap progressivo para evitar QuotaExceeded — começa em 50, reduz se falhar
        const tryCaps = [50, 25, 10, 5, items.length];
        for (const cap of tryCaps) {
            try {
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all.slice(0, cap)));
                if (cap < 50) {
                    if (typeof showToast === 'function') {
                        showToast(`Armazenamento cheio — mantendo só as ${cap} mais recentes. Clique "Limpar" para liberar espaço.`, 'warning');
                    }
                }
                return;
            } catch (e) {
                console.warn(`[AIAdGenerator] save failed at cap=${cap}:`, e?.name || e?.message);
            }
        }
        // Falhou em todos os caps
        if (typeof showToast === 'function') {
            showToast('Erro: localStorage cheio. Vá em AI Generations → botão "Limpar" para apagar gerações antigas.', 'error');
        }
        throw new Error('localStorage cheio — não consegui salvar a geração');
    },

    _getAllGenerations() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
        } catch { return []; }
    },

    // ── Gallery (Minhas Gerações tab) ──────────────────────────────────
    renderGenerationsGallery() {
        const grid = document.getElementById('aigen-grid');
        if (!grid) return;
        const all = this._getAllGenerations();
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
                    <img src="${item.dataUrl}" alt="${this._esc(item.prompt.slice(0, 60))}" loading="lazy">
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
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const item = all.find(i => i.id === id);
                if (!item) return;
                const action = btn.dataset.action;
                if (action === 'dl') {
                    const ext = item.dataUrl.startsWith('data:image/webp') ? 'webp' : 'png';
                    const a = document.createElement('a');
                    a.href = item.dataUrl;
                    a.download = `ai-ad-${id}.${ext}`;
                    a.click();
                } else if (action === 'cp') {
                    navigator.clipboard.writeText(item.revisedPrompt || item.prompt);
                    if (typeof showToast === 'function') showToast('Prompt copiado', 'success');
                } else if (action === 'del') {
                    const remaining = all.filter(i => i.id !== id);
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(remaining));
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
        const defaultName = (item.prompt || '').slice(0, 60).trim() || 'AI Creative';
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
        document.getElementById('sc-save-btn')?.addEventListener('click', () => {
            const productId = document.getElementById('sc-product-select')?.value;
            const name = document.getElementById('sc-name-input')?.value.trim() || defaultName;
            if (!productId) { if (typeof showToast === 'function') showToast('Selecione um produto', 'error'); return; }

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
                imageUrl: item.dataUrl,
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

    clearAllGenerations() {
        if (!confirm('Apagar TODAS as gerações? Não dá pra recuperar.')) return;
        localStorage.removeItem(this.STORAGE_KEY);
        this.renderGenerationsGallery();
        if (typeof showToast === 'function') showToast('Galeria limpa', 'success');
    },

    _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
};

window.AIAdGenerator = AIAdGenerator;
AIAdGenerator.init();
