/* ===========================
   AI Ad Generator
   - Gera imagens via OpenAI Images API (DALL-E 3)
   - Gera copy via Anthropic ou OpenAI (reusa AI Consultant key se houver)
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

        // Renderiza histórico ao abrir aba "Minhas Gerações"
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (tab) => {
                if (tab === 'ai-generations') this.renderGenerationsGallery();
            });
        }
    },

    _getOpenAIKey() {
        return localStorage.getItem('openai_api_key') || '';
    },

    _setOpenAIKey(key) {
        if (key) localStorage.setItem('openai_api_key', key);
        else localStorage.removeItem('openai_api_key');
    },

    openConfig() {
        const current = this._getOpenAIKey();
        const masked = current ? `${current.slice(0, 7)}…${current.slice(-4)}` : '(vazio)';
        const newKey = prompt(
            `Cole sua chave OpenAI (sk-...).\n\nUsada para gerar imagens via DALL-E.\nObtenha em: https://platform.openai.com/api-keys\n\nAtual: ${masked}\n\nDeixe vazio + OK para remover.`,
            current
        );
        if (newKey === null) return; // cancelou
        const trimmed = newKey.trim();
        if (trimmed && !trimmed.startsWith('sk-')) {
            if (typeof showToast === 'function') showToast('Chave inválida — deve começar com "sk-"', 'error');
            return;
        }
        this._setOpenAIKey(trimmed);
        if (typeof showToast === 'function') {
            showToast(trimmed ? 'Chave OpenAI salva' : 'Chave OpenAI removida', 'success');
        }
    },

    async generateImages() {
        const key = this._getOpenAIKey();
        if (!key) {
            if (typeof showToast === 'function') showToast('Configure sua chave OpenAI primeiro', 'error');
            this.openConfig();
            return;
        }

        const prompt = document.getElementById('aiad-prompt')?.value.trim();
        if (!prompt) {
            if (typeof showToast === 'function') showToast('Escreva um prompt antes de gerar', 'error');
            return;
        }

        const size = document.getElementById('aiad-size')?.value || '1024x1024';
        const count = parseInt(document.getElementById('aiad-count')?.value || '1', 10);
        const quality = document.getElementById('aiad-quality')?.value || 'standard';

        const results = document.getElementById('aiad-results');
        if (results) {
            results.innerHTML = `<div class="aiad-loading">Gerando ${count} imagem(ns)…</div>`;
        }

        try {
            // DALL-E 3 só gera 1 por chamada — fazer N chamadas em paralelo
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

            // Verificar erros
            const errors = responses.filter(r => r.error).map(r => r.error.message);
            if (errors.length === responses.length) {
                throw new Error(errors[0] || 'Falha em todas as gerações');
            }

            const items = responses.flatMap(r => r.data || []).map(d => ({
                id: 'gen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
                prompt,
                size,
                createdAt: new Date().toISOString(),
                dataUrl: `data:image/png;base64,${d.b64_json}`,
                revisedPrompt: d.revised_prompt
            }));

            if (!items.length) throw new Error('Nenhuma imagem retornada');

            // Persistir no histórico
            this._saveGenerations(items);

            // Renderizar
            this._renderResults(items);

            if (typeof showToast === 'function') showToast(`${items.length} imagem(ns) gerada(s)`, 'success');
        } catch (err) {
            console.error(err);
            if (results) {
                results.innerHTML = `
                    <div class="aiad-empty">
                        <i data-lucide="alert-circle" style="width:32px;height:32px;color:#dc2626"></i>
                        <h3>Falha na geração</h3>
                        <p>${this._esc(err.message || 'Erro desconhecido')}</p>
                    </div>
                `;
                if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch {}
            }
            if (typeof showToast === 'function') showToast('Falha: ' + err.message, 'error');
        }
    },

    _renderResults(items) {
        const results = document.getElementById('aiad-results');
        if (!results) return;
        results.innerHTML = items.map(item => `
            <div class="aiad-result-item" data-id="${item.id}">
                <img src="${item.dataUrl}" alt="${this._esc(item.prompt.slice(0, 60))}" loading="lazy">
                <div class="aiad-result-actions">
                    <button class="btn btn-secondary btn-sm" data-action="download" data-id="${item.id}" title="Baixar"><i data-lucide="download" style="width:13px;height:13px"></i></button>
                    <button class="btn btn-secondary btn-sm" data-action="copy-prompt" data-id="${item.id}" title="Copiar prompt"><i data-lucide="copy" style="width:13px;height:13px"></i></button>
                    <button class="btn btn-secondary btn-sm" data-action="regen" data-id="${item.id}" title="Gerar variação"><i data-lucide="refresh-cw" style="width:13px;height:13px"></i></button>
                </div>
            </div>
        `).join('');
        if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch {}

        // Bind de actions
        results.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => this._handleAction(btn.dataset.action, btn.dataset.id, items));
        });
    },

    _handleAction(action, id, items) {
        const item = items.find(i => i.id === id);
        if (!item) return;
        if (action === 'download') {
            const a = document.createElement('a');
            a.href = item.dataUrl;
            a.download = `ai-ad-${id}.png`;
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

    async generateCopy() {
        const prompt = document.getElementById('aiad-prompt')?.value.trim();
        if (!prompt) {
            if (typeof showToast === 'function') showToast('Escreva um prompt antes de gerar', 'error');
            return;
        }

        const key = this._getOpenAIKey();
        if (!key) {
            if (typeof showToast === 'function') showToast('Configure a chave OpenAI primeiro', 'error');
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
        if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch {}

        // Click pra copiar
        body.querySelectorAll('.aiad-copy-text').forEach(el => {
            el.addEventListener('click', () => {
                navigator.clipboard.writeText(el.dataset.copy).then(() => {
                    if (typeof showToast === 'function') showToast('Copiado: ' + el.dataset.copy.slice(0, 40), 'success');
                });
            });
        });
    },

    showTemplates() {
        const templates = [
            'Foto profissional de produto: [PRODUTO] em fundo branco minimalista, iluminação suave de estúdio, alta resolução, estilo Apple',
            'Lifestyle: pessoa usando [PRODUTO] em [CENÁRIO], luz natural, hora dourada, fotografia editorial',
            'Comparativo: [PRODUTO] versus alternativa pior, lado-a-lado, anotações destacando vantagens',
            'Antes/Depois: cenário antes sem [PRODUTO], cenário depois com [PRODUTO], transformação visível',
            'Close-up de detalhe: textura/material de [PRODUTO], macro fotografia, mostrando qualidade',
        ];
        const choice = prompt('Templates de prompt (cola e edita):\n\n' + templates.map((t,i) => `${i+1}. ${t}`).join('\n\n') + '\n\nDigite o número (1-5):');
        const idx = parseInt(choice, 10) - 1;
        if (idx >= 0 && idx < templates.length) {
            const promptEl = document.getElementById('aiad-prompt');
            if (promptEl) {
                promptEl.value = templates[idx];
                promptEl.focus();
            }
        }
    },

    _saveGenerations(items) {
        const all = this._getAllGenerations();
        all.unshift(...items);
        // Limita a 50 mais recentes (b64 ocupa espaço)
        const trimmed = all.slice(0, 50);
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(trimmed));
        } catch (e) {
            // QuotaExceededError: manda menos
            try {
                localStorage.setItem(this.STORAGE_KEY, JSON.stringify(all.slice(0, 10)));
            } catch {}
        }
    },

    _getAllGenerations() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
        } catch { return []; }
    },

    renderGenerationsGallery() {
        const grid = document.getElementById('aigen-grid');
        if (!grid) return;
        const all = this._getAllGenerations();
        if (!all.length) {
            grid.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:3rem 0;grid-column:1/-1">Suas gerações vão aparecer aqui depois de usar o AI Ad Generator.</p>`;
            return;
        }
        grid.innerHTML = all.map(item => `
            <div class="aiad-result-item" data-id="${item.id}">
                <img src="${item.dataUrl}" alt="${this._esc(item.prompt.slice(0,60))}" loading="lazy">
                <div class="aiad-result-actions">
                    <button class="btn btn-secondary btn-sm" data-action="dl" data-id="${item.id}" title="Baixar"><i data-lucide="download" style="width:13px;height:13px"></i></button>
                    <button class="btn btn-secondary btn-sm" data-action="cp" data-id="${item.id}" title="Copiar prompt"><i data-lucide="copy" style="width:13px;height:13px"></i></button>
                    <button class="btn btn-secondary btn-sm" data-action="del" data-id="${item.id}" title="Excluir"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                </div>
            </div>
        `).join('');
        if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch {}

        grid.querySelectorAll('button[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const item = all.find(i => i.id === id);
                if (!item) return;
                if (btn.dataset.action === 'dl') {
                    const a = document.createElement('a'); a.href = item.dataUrl; a.download = `ai-ad-${id}.png`; a.click();
                } else if (btn.dataset.action === 'cp') {
                    navigator.clipboard.writeText(item.revisedPrompt || item.prompt);
                    if (typeof showToast === 'function') showToast('Prompt copiado', 'success');
                } else if (btn.dataset.action === 'del') {
                    const remaining = all.filter(i => i.id !== id);
                    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(remaining));
                    this.renderGenerationsGallery();
                }
            });
        });
    },

    clearAllGenerations() {
        if (!confirm('Apagar TODAS as gerações? Não dá pra recuperar.')) return;
        localStorage.removeItem(this.STORAGE_KEY);
        this.renderGenerationsGallery();
        if (typeof showToast === 'function') showToast('Galeria limpa', 'success');
    },

    _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
};

AIAdGenerator.init();
