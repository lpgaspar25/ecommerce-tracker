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
                await AIAdGenerator.generateImages({
                    prompt,
                    size: this._aspect,
                    count: this._outputs,
                });
                if (ta) {
                    ta.value = '';
                    ta.dispatchEvent(new Event('input'));
                }
                // Save to recent edits log
                this._logRecentEdit({
                    prompt,
                    aspect: this._aspectLabel,
                    outputs: this._outputs,
                    refImage: this._refImage?.name || null,
                });
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

        _esc(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.AiGenerations = AiGenerations;
    AiGenerations.init();
})();
