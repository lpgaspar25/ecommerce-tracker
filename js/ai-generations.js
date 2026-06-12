/* ===========================
   AI Generations — Madgicx-style page
   - Sticky prompt bar at the bottom
   - 2 top tabs (My / Community)
   - Wraps AIAdGenerator.generateImages() with new UI
   =========================== */
(function () {
    const AiGenerations = {
        _aspect: '1024x1024',
        _aspectLabel: 'Square',
        _outputs: 3,
        _refImage: null, // { name, dataUrl }
        _busy: false,

        init() {
            if (document.readyState !== 'loading') this._setup();
            else document.addEventListener('DOMContentLoaded', () => this._setup());
        },

        _setup() {
            this._bindTabs();
            this._bindAspect();
            this._bindOutputs();
            this._bindUpload();
            this._bindTextarea();
            this._bindSend();
            this._bindHeaderActions();

            if (typeof EventBus !== 'undefined') {
                EventBus.on('tabChanged', (tab) => {
                    if (tab === 'ai-generations') this._refreshGallery();
                });
                EventBus.on('aigenChanged', () => this._refreshGallery());
            }

            // Initial render
            setTimeout(() => this._refreshGallery(), 0);
        },

        _refreshGallery() {
            if (window.AIAdGenerator && typeof AIAdGenerator.renderGenerationsGallery === 'function') {
                AIAdGenerator.renderGenerationsGallery();
            }
        },

        _bindTabs() {
            document.querySelectorAll('[data-aigen-tab]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const tab = btn.dataset.aigenTab;
                    document.querySelectorAll('[data-aigen-tab]').forEach(b => b.classList.toggle('adhub-tab-active', b === btn));
                    const grid = document.getElementById('aigen-grid');
                    const community = document.getElementById('aigen-community');
                    if (tab === 'my') {
                        if (grid) grid.style.display = '';
                        if (community) community.style.display = 'none';
                    } else {
                        if (grid) grid.style.display = 'none';
                        if (community) community.style.display = '';
                    }
                });
            });
        },

        _bindAspect() {
            const trigger = document.getElementById('adhub-aspect-trigger');
            const menu = document.getElementById('adhub-aspect-menu');
            const wrap = document.getElementById('adhub-aspect-dropdown');
            if (!trigger || !menu || !wrap) return;
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                wrap.classList.toggle('adhub-dropdown-open');
                this._closeOtherDropdowns(wrap);
            });
            menu.querySelectorAll('[data-aspect]').forEach(item => {
                item.addEventListener('click', () => {
                    this._aspect = item.dataset.aspect;
                    this._aspectLabel = item.dataset.aspectLabel || 'Square';
                    document.getElementById('adhub-aspect-label').textContent = this._aspectLabel;
                    wrap.classList.remove('adhub-dropdown-open');
                });
            });
        },

        _bindOutputs() {
            const trigger = document.getElementById('adhub-outputs-trigger');
            const menu = document.getElementById('adhub-outputs-menu');
            const wrap = document.getElementById('adhub-outputs-dropdown');
            if (!trigger || !menu || !wrap) return;
            trigger.addEventListener('click', (e) => {
                e.stopPropagation();
                wrap.classList.toggle('adhub-dropdown-open');
                this._closeOtherDropdowns(wrap);
            });
            menu.querySelectorAll('[data-outputs]').forEach(item => {
                item.addEventListener('click', () => {
                    this._outputs = parseInt(item.dataset.outputs, 10) || 1;
                    document.getElementById('adhub-outputs-label').textContent = `${this._outputs} output${this._outputs > 1 ? 's' : ''}`;
                    wrap.classList.remove('adhub-dropdown-open');
                });
            });
            // Close dropdowns on outside click
            document.addEventListener('click', () => {
                document.querySelectorAll('.adhub-dropdown.adhub-dropdown-open').forEach(d => d.classList.remove('adhub-dropdown-open'));
            });
        },

        _closeOtherDropdowns(except) {
            document.querySelectorAll('.adhub-dropdown.adhub-dropdown-open').forEach(d => {
                if (d !== except) d.classList.remove('adhub-dropdown-open');
            });
        },

        _bindUpload() {
            const btn = document.getElementById('adhub-prompt-upload');
            const input = document.getElementById('adhub-prompt-file');
            const chip = document.getElementById('adhub-prompt-file-chip');
            if (!btn || !input) return;
            btn.addEventListener('click', () => input.click());
            input.addEventListener('change', () => {
                const f = input.files?.[0];
                if (!f) return;
                if (!f.type.startsWith('image/')) {
                    if (typeof showToast === 'function') showToast('Selecione uma imagem', 'error');
                    return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                    this._refImage = { name: f.name, dataUrl: reader.result };
                    if (chip) {
                        chip.style.display = '';
                        chip.innerHTML = `<i data-lucide="image" style="width:12px;height:12px"></i> ${this._esc(f.name)} <button class="adhub-prompt-chip-x" title="Remover">×</button>`;
                        chip.querySelector('.adhub-prompt-chip-x')?.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this._refImage = null;
                            chip.style.display = 'none';
                            input.value = '';
                        });
                        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch(e) {}
                    }
                };
                reader.readAsDataURL(f);
            });
        },

        _bindTextarea() {
            const ta = document.getElementById('adhub-prompt-text');
            if (!ta) return;
            const autosize = () => {
                ta.style.height = 'auto';
                ta.style.height = Math.min(160, ta.scrollHeight) + 'px';
            };
            ta.addEventListener('input', autosize);
            ta.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this._handleSend();
                }
            });
            autosize();
        },

        _bindSend() {
            document.getElementById('adhub-prompt-send')?.addEventListener('click', () => this._handleSend());
            document.getElementById('adhub-prompt-enhance')?.addEventListener('click', () => this._handleEnhance());
        },

        async _handleEnhance() {
            if (this._enhancing) return;
            const ta = document.getElementById('adhub-prompt-text');
            const original = (ta?.value || '').trim();
            if (!original) {
                if (typeof showToast === 'function') showToast('Escreva algo antes de refinar', 'error');
                ta?.focus();
                return;
            }
            const key = window.AIAdGenerator?._getAnthropicKey?.() || localStorage.getItem('anthropic_api_key') || '';
            if (!key) {
                if (typeof showToast === 'function') showToast('Configure a chave da Anthropic em Config (botão de engrenagem) para usar Enhance', 'error');
                return;
            }
            this._enhancing = true;
            const btn = document.getElementById('adhub-prompt-enhance');
            const origHtml = btn?.innerHTML;
            if (btn) {
                btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i> <span>Refinando…</span>';
                btn.disabled = true;
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
            }
            try {
                const refined = await this._enhancePromptViaClaude(original, key);
                if (refined && refined.length > 10) {
                    ta.value = refined;
                    ta.dispatchEvent(new Event('input'));
                    if (typeof showToast === 'function') showToast('Prompt refinado!', 'success');
                } else {
                    throw new Error('Resposta vazia do Claude');
                }
            } catch (e) {
                if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
            } finally {
                this._enhancing = false;
                if (btn) {
                    btn.innerHTML = origHtml;
                    btn.disabled = false;
                    if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                }
            }
        },

        async _enhancePromptViaClaude(userPrompt, apiKey) {
            const systemPrompt = `You are an expert prompt engineer for image generation models (Flux, DALL-E, GPT Image). Take the user's casual description of an ad creative and rewrite it into a detailed, photorealistic prompt that includes: subject, composition, lighting, color palette, lens/camera angle, mood, and any brand-relevant details. Keep it under 200 words. Output ONLY the rewritten prompt, no preamble, no quotes, no markdown.`;
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 600,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: userPrompt }],
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            return (data.content?.[0]?.text || '').trim();
        },

        _bindHeaderActions() {
            document.getElementById('btn-aigen-config')?.addEventListener('click', () => {
                if (window.AIAdGenerator && typeof AIAdGenerator.openConfig === 'function') {
                    AIAdGenerator.openConfig();
                }
            });
            document.getElementById('btn-aigen-clear')?.addEventListener('click', () => {
                if (window.AIAdGenerator && typeof AIAdGenerator.clearAllGenerations === 'function') {
                    AIAdGenerator.clearAllGenerations();
                }
            });
            // Templates trigger (modal opens via prompt-templates.js)
            document.getElementById('adhub-templates-trigger')?.addEventListener('click', () => {
                if (window.PromptTemplates && typeof PromptTemplates.open === 'function') {
                    PromptTemplates.open();
                } else if (typeof showToast === 'function') {
                    showToast('Módulo de templates carregando…', 'info');
                }
            });
        },

        async _handleSend() {
            if (this._busy) return;
            const ta = document.getElementById('adhub-prompt-text');
            const prompt = (ta?.value || '').trim();
            if (!prompt) {
                if (typeof showToast === 'function') showToast('Descreva sua ideia primeiro', 'error');
                ta?.focus();
                return;
            }
            if (!window.AIAdGenerator) {
                if (typeof showToast === 'function') showToast('Gerador não carregado', 'error');
                return;
            }
            this._busy = true;
            const sendBtn = document.getElementById('adhub-prompt-send');
            if (sendBtn) {
                sendBtn.disabled = true;
                sendBtn.classList.add('adhub-prompt-send-loading');
            }

            // Show loading card at the top of the grid
            const grid = document.getElementById('aigen-grid');
            if (grid) {
                const loader = document.createElement('div');
                loader.className = 'aigen-card aigen-card-loading';
                loader.id = 'aigen-loading-card';
                loader.innerHTML = `<div class="aigen-card-thumb"><div class="aigen-loader"><i data-lucide="loader-2" style="width:32px;height:32px"></i></div></div><div class="aigen-card-meta"><span class="aigen-card-prompt">Gerando ${this._outputs} imagem(ns)…</span></div>`;
                grid.prepend(loader);
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch(e) {}
            }

            try {
                // If a reference image is attached, analyze it with GPT-4o vision
                // and replace [REFERENCE] in the prompt (or append as context)
                let finalPrompt = prompt;
                if (this._refImage) {
                    const loadingCard = document.getElementById('aigen-loading-card');
                    if (loadingCard) {
                        const promptEl = loadingCard.querySelector('.aigen-card-prompt');
                        if (promptEl) promptEl.textContent = 'Analisando imagem de referência…';
                    }
                    try {
                        finalPrompt = await this._enhancePromptWithReference(prompt, this._refImage.dataUrl);
                    } catch (e) {
                        console.warn('[AiGenerations] reference analysis failed:', e);
                        // fallback: strip placeholder and proceed
                        finalPrompt = prompt.replace('[REFERENCE]', '').trim();
                    }
                    if (loadingCard) {
                        const promptEl = loadingCard.querySelector('.aigen-card-prompt');
                        if (promptEl) promptEl.textContent = `Gerando ${this._outputs} imagem(ns)…`;
                    }
                }

                try {
                    await AIAdGenerator.generateImages({
                        prompt: finalPrompt,
                        size: this._aspect,
                        count: this._outputs,
                    });
                    if (ta) {
                        ta.value = '';
                        ta.dispatchEvent(new Event('input'));
                    }
                    // Save to recent edits log
                    this._logRecentEdit({
                        prompt: finalPrompt,
                        aspect: this._aspectLabel,
                        outputs: this._outputs,
                        refImage: this._refImage?.name || null,
                    });
                } catch (genErr) {
                    // Mostra erro persistente no grid em vez de só toast (que some)
                    const grid = document.getElementById('aigen-grid');
                    if (grid) {
                        const errCard = document.createElement('div');
                        errCard.className = 'aigen-card aigen-card-error';
                        errCard.style.cssText = 'border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.06);padding:1rem;border-radius:8px;grid-column:1/-1';
                        errCard.innerHTML = `
                            <div style="display:flex;align-items:flex-start;gap:0.75rem">
                                <i data-lucide="alert-circle" style="width:24px;height:24px;color:var(--danger);flex-shrink:0"></i>
                                <div style="flex:1">
                                    <strong style="color:var(--danger);display:block;margin-bottom:0.25rem">Falha na geração</strong>
                                    <div style="font-size:0.85rem;color:var(--text-primary);line-height:1.4">${this._esc(genErr.message || 'Erro desconhecido')}</div>
                                    <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.5rem">
                                        Possíveis causas: chave API ausente/inválida, créditos da OpenAI/Google esgotados, ou localStorage cheio.
                                        Verifique em <strong>API Keys</strong> (topo da página).
                                    </div>
                                    <button class="btn btn-sm btn-secondary" onclick="this.closest('.aigen-card-error').remove()" style="margin-top:0.6rem">Dispensar</button>
                                </div>
                            </div>
                        `;
                        grid.prepend(errCard);
                        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                    }
                    if (typeof showToast === 'function') showToast('Falha: ' + (genErr.message || 'erro desconhecido'), 'error');
                }
            } finally {
                this._busy = false;
                if (sendBtn) {
                    sendBtn.disabled = false;
                    sendBtn.classList.remove('adhub-prompt-send-loading');
                }
                document.getElementById('aigen-loading-card')?.remove();
            }
        },

        _logRecentEdit(entry) {
            try {
                const KEY = 'etracker_recent_edits';
                let list = [];
                try { list = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch {}
                list.unshift({
                    id: 're_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
                    ...entry,
                    createdAt: new Date().toISOString(),
                });
                if (list.length > 100) list = list.slice(0, 100);
                localStorage.setItem(KEY, JSON.stringify(list));
                if (typeof EventBus !== 'undefined') EventBus.emit('recentEditsChanged');
            } catch (e) {
                console.warn('[AiGenerations] _logRecentEdit failed', e);
            }
        },

        // Uses GPT-4o vision to describe the reference image and inject it into the prompt
        async _enhancePromptWithReference(prompt, imageDataUrl) {
            const key = window.AIAdGenerator?._getOpenAIKey?.() || '';
            if (!key) return prompt.replace('[REFERENCE]', '').trim();

            const base64 = imageDataUrl.includes(',') ? imageDataUrl.split(',')[1] : imageDataUrl;
            const mimeType = imageDataUrl.match(/data:([^;]+)/)?.[1] || 'image/jpeg';

            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Describe this image in detail for use as a reference in an AI image generation prompt. Focus on: composition, colors, lighting, style, mood, product placement, background. Be concise but specific (2-3 sentences max).' },
                            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
                        ]
                    }],
                    max_tokens: 250
                })
            });

            if (!res.ok) throw new Error(`Vision API error ${res.status}`);
            const data = await res.json();
            const description = data.choices?.[0]?.message?.content?.trim() || '';
            if (!description) return prompt.replace('[REFERENCE]', '').trim();

            if (prompt.includes('[REFERENCE]')) {
                return prompt.replace('[REFERENCE]', description);
            }
            return `${prompt}. Reference image: ${description}`;
        },

        _esc(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.AiGenerations = AiGenerations;
    AiGenerations.init();
})();
