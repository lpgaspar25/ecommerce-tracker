/* ===========================
   CopyLibrary — Save/reuse ad copies (headlines, primary texts, descriptions)
   - localStorage backed
   - Pickable modal triggered from any copy field
   - AI Variations via Claude
   =========================== */
(function () {
    const STORAGE_KEY = 'etracker_copy_library';

    const CopyLibrary = {
        _items: null,

        init() {
            // Lazy load
            this._load();
            this._bindModal();
        },

        _load() {
            try { this._items = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
            catch { this._items = []; }
        },

        _save() {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._items));
        },

        list(type = null) {
            if (!this._items) this._load();
            return type ? this._items.filter(i => i.type === type) : this._items.slice();
        },

        add(type, content, tags = []) {
            content = (content || '').trim();
            if (!content) return null;
            if (!this._items) this._load();
            // Dedup
            const existing = this._items.find(i => i.type === type && i.content === content);
            if (existing) {
                existing.useCount = (existing.useCount || 0) + 1;
                existing.lastUsed = new Date().toISOString();
                this._save();
                return existing;
            }
            const item = {
                id: 'cp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                type,
                content,
                tags: tags || [],
                useCount: 1,
                createdAt: new Date().toISOString(),
                lastUsed: new Date().toISOString(),
            };
            this._items.unshift(item);
            if (this._items.length > 500) this._items = this._items.slice(0, 500);
            this._save();
            return item;
        },

        markUsed(id) {
            if (!this._items) this._load();
            const item = this._items.find(i => i.id === id);
            if (item) {
                item.useCount = (item.useCount || 0) + 1;
                item.lastUsed = new Date().toISOString();
                this._save();
            }
        },

        remove(id) {
            if (!this._items) this._load();
            this._items = this._items.filter(i => i.id !== id);
            this._save();
        },

        _bindModal() {
            const modal = document.getElementById('copy-lib-modal');
            if (!modal) return;
            modal.querySelectorAll('[data-close-modal]').forEach(b => {
                b.addEventListener('click', () => { modal.style.display = 'none'; });
            });
            document.getElementById('copy-lib-search')?.addEventListener('input', () => this._render());
        },

        openPicker(type, onPick) {
            this._currentType = type;
            this._onPick = onPick;
            const modal = document.getElementById('copy-lib-modal');
            const title = document.getElementById('copy-lib-title');
            if (!modal) return;
            const labels = { primary_text: 'Texto principal', headline: 'Título', description: 'Descrição' };
            if (title) title.textContent = `Biblioteca de ${labels[type] || 'cópias'}`;
            modal.style.display = 'flex';
            this._render();
            const search = document.getElementById('copy-lib-search');
            if (search) { search.value = ''; setTimeout(() => search.focus(), 50); }
        },

        _render() {
            const list = document.getElementById('copy-lib-list');
            if (!list) return;
            const q = (document.getElementById('copy-lib-search')?.value || '').toLowerCase();
            let items = this.list(this._currentType);
            if (q) items = items.filter(i => i.content.toLowerCase().includes(q));
            items.sort((a, b) => (b.useCount || 0) - (a.useCount || 0) || (b.lastUsed || '').localeCompare(a.lastUsed || ''));
            if (items.length === 0) {
                list.innerHTML = `<div class="copy-lib-empty">
                    <i data-lucide="bookmark" style="width:32px;height:32px;color:var(--text-muted)"></i>
                    <p>Nenhuma cópia salva${q ? ' para "' + this._esc(q) + '"' : ''}.</p>
                    <p style="font-size:0.75rem;opacity:0.7">Use o botão <i data-lucide="save" style="width:12px;height:12px;vertical-align:-2px"></i> ao lado de cada campo no Ad Launcher para salvar.</p>
                </div>`;
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                return;
            }
            list.innerHTML = items.map(it => `
                <div class="copy-lib-row" data-id="${this._esc(it.id)}">
                    <div class="copy-lib-row-content">${this._esc(it.content)}</div>
                    <div class="copy-lib-row-meta">
                        <span title="Vezes usada">${it.useCount || 0}× ${(it.useCount || 0) > 5 ? '<i data-lucide="flame" style="width:13px;height:13px;vertical-align:-2px"></i>' : ''}</span>
                        <button class="copy-lib-row-del" data-id="${this._esc(it.id)}" title="Remover">&times;</button>
                    </div>
                </div>
            `).join('');
            list.querySelectorAll('.copy-lib-row-del').forEach(b => {
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.remove(b.dataset.id);
                    this._render();
                });
            });
            list.querySelectorAll('.copy-lib-row').forEach(row => {
                row.addEventListener('click', () => {
                    const id = row.dataset.id;
                    const item = items.find(i => i.id === id);
                    if (item) {
                        this.markUsed(id);
                        if (this._onPick) this._onPick(item.content);
                    }
                    document.getElementById('copy-lib-modal').style.display = 'none';
                });
            });
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
        },

        // ===== AI Variations via Claude =====
        async generateVariations(type, current, count = 3) {
            const key = localStorage.getItem('anthropic_api_key') || '';
            if (!key) throw new Error('Configure a chave Anthropic em localStorage.anthropic_api_key');
            const labelMap = {
                primary_text: 'primary text (ad body, 1-3 sentences, conversational)',
                headline: 'headline (max 40 chars, punchy, benefit-driven)',
                description: 'description (max 30 chars, supporting line)',
            };
            const label = labelMap[type] || 'ad copy';
            const systemPrompt = `You are an expert direct-response copywriter for Meta/Facebook ads. Generate exactly ${count} alternative variations of the given ${label}. Each should test a different angle (urgency, social proof, benefit, FOMO, etc.). Output ONLY a JSON array of strings, no markdown, no preamble. Example: ["Variation 1", "Variation 2", "Variation 3"]. Match the source language.`;
            const res = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-api-key': key,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true',
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 800,
                    system: systemPrompt,
                    messages: [{ role: 'user', content: `Source ${label}:\n"""\n${current}\n"""` }],
                }),
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            const text = (data.content?.[0]?.text || '').trim();
            // Tenta parsear JSON array
            try {
                const cleaned = text.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
                const arr = JSON.parse(cleaned);
                if (Array.isArray(arr)) return arr.slice(0, count);
            } catch {}
            // Fallback: split por linhas
            return text.split('\n').map(l => l.replace(/^[\d.\-*"\s]+|[\s"]+$/g, '').trim()).filter(Boolean).slice(0, count);
        },

        async openVariationsModal(type, current) {
            const modal = document.getElementById('copy-variations-modal');
            const list = document.getElementById('copy-variations-list');
            const labels = { primary_text: 'Texto principal', headline: 'Título', description: 'Descrição' };
            const title = document.getElementById('copy-variations-title');
            if (!modal) return;
            if (title) title.textContent = `${labels[type] || 'Cópia'} — Variações IA`;
            list.innerHTML = '<div class="copy-lib-empty"><i data-lucide="loader-2" style="width:24px;height:24px;animation:spin 1s linear infinite"></i><p>Gerando 3 variações…</p></div>';
            modal.style.display = 'flex';
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}

            // Bind close once
            if (!modal._bound) {
                modal._bound = true;
                modal.querySelectorAll('[data-close-modal]').forEach(b => {
                    b.addEventListener('click', () => { modal.style.display = 'none'; });
                });
            }

            try {
                const variations = await this.generateVariations(type, current, 3);
                this._currentVariations = variations;
                this._currentVariationType = type;
                list.innerHTML = variations.map((v, i) => `
                    <div class="copy-var-row" data-idx="${i}">
                        <div class="copy-var-num">${i + 1}</div>
                        <div class="copy-var-content">${this._esc(v)}</div>
                        <div class="copy-var-actions">
                            <button class="btn btn-sm btn-secondary" data-action="save" data-idx="${i}" title="Salvar na biblioteca"><i data-lucide="bookmark" style="width:13px;height:13px"></i></button>
                            <button class="btn btn-sm btn-primary" data-action="use" data-idx="${i}">Usar</button>
                        </div>
                    </div>
                `).join('');
                list.querySelectorAll('[data-action]').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const idx = parseInt(btn.dataset.idx, 10);
                        const v = variations[idx];
                        if (btn.dataset.action === 'save') {
                            this.add(type, v, ['ai-variation']);
                            if (typeof showToast === 'function') showToast('Salvo na biblioteca', 'success');
                        }
                        if (btn.dataset.action === 'use') {
                            if (this._onVariationPick) this._onVariationPick(v);
                            this.add(type, v, ['ai-variation']);
                            modal.style.display = 'none';
                        }
                    });
                });
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
            } catch (e) {
                list.innerHTML = `<div class="copy-lib-empty"><p style="color:var(--danger)">Erro: ${this._esc(e.message)}</p></div>`;
            }
        },

        openVariations(type, current, onPick) {
            this._onVariationPick = onPick;
            this.openVariationsModal(type, current);
        },

        _esc(s) {
            return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.CopyLibrary = CopyLibrary;
    if (document.readyState !== 'loading') CopyLibrary.init();
    else document.addEventListener('DOMContentLoaded', () => CopyLibrary.init());
})();
