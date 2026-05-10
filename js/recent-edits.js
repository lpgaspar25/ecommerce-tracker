/* ===========================
   Recent Edits — histórico de gerações AI
   =========================== */
(function () {
    const RecentEdits = {
        STORAGE_KEY: 'etracker_recent_edits',
        _filter: '',

        init() {
            if (document.readyState !== 'loading') this._setup();
            else document.addEventListener('DOMContentLoaded', () => this._setup());
        },

        _setup() {
            if (typeof EventBus !== 'undefined') {
                EventBus.on('recentEditsChanged', () => this._render());
                EventBus.on('tabChanged', (tab) => { if (tab === 'recent-edits') this._render(); });
            }

            document.getElementById('re-search')?.addEventListener('input', (e) => {
                this._filter = e.target.value.toLowerCase();
                this._render();
            });

            document.getElementById('re-clear-all')?.addEventListener('click', () => {
                if (!confirm('Limpar todo o histórico de edições?')) return;
                localStorage.removeItem(this.STORAGE_KEY);
                this._render();
                if (typeof showToast === 'function') showToast('Histórico limpo', 'success');
            });
        },

        _load() {
            try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]'); }
            catch { return []; }
        },

        _render() {
            const el = document.getElementById('recent-edits-content');
            if (!el) return;

            let items = this._load();
            if (this._filter) {
                items = items.filter(i => (i.prompt || '').toLowerCase().includes(this._filter));
            }

            if (!items.length) {
                el.innerHTML = `<div class="adhub-empty" style="padding:4rem 0">
                    <i data-lucide="history" style="width:48px;height:48px;color:var(--text-muted)"></i>
                    <h3>${this._filter ? 'Nenhum resultado' : 'Histórico vazio'}</h3>
                    <p>${this._filter ? 'Tente outro termo.' : 'Suas gerações de IA aparecerão aqui.'}</p>
                </div>`;
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch (e) {}
                return;
            }

            const groups = this._groupByDate(items);
            el.innerHTML = groups.map(g => `
                <div class="re-group">
                    <div class="re-group-label">${this._esc(g.label)}</div>
                    <div class="re-grid">${g.items.map(i => this._cardHtml(i)).join('')}</div>
                </div>
            `).join('');

            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch (e) {}

            el.querySelectorAll('[data-re-use]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const item = items.find(i => i.id === btn.dataset.reUse);
                    if (item) this._useAgain(item);
                });
            });
            el.querySelectorAll('[data-re-delete]').forEach(btn => {
                btn.addEventListener('click', () => this._delete(btn.dataset.reDelete));
            });
        },

        _cardHtml(item) {
            const prompt = (item.prompt || '').length > 120
                ? item.prompt.slice(0, 120) + '…'
                : (item.prompt || '');
            const refTag = item.refImage ? `<span class="re-tag"><i data-lucide="image" style="width:10px;height:10px"></i> ref</span>` : '';
            return `<div class="re-card">
                <div class="re-card-prompt">${this._esc(prompt)}</div>
                <div class="re-card-footer">
                    <div class="re-card-tags">
                        <span class="re-tag">${this._esc(item.aspect || 'Square')}</span>
                        <span class="re-tag">${item.outputs || 1} img</span>
                        ${refTag}
                    </div>
                    <span class="re-card-time">${this._esc(this._timeAgo(item.createdAt))}</span>
                </div>
                <div class="re-card-actions">
                    <button class="btn btn-sm btn-primary" data-re-use="${this._esc(item.id)}">
                        <i data-lucide="refresh-cw" style="width:11px;height:11px"></i> Usar
                    </button>
                    <button class="btn btn-sm btn-secondary" data-re-delete="${this._esc(item.id)}" title="Remover">
                        <i data-lucide="trash-2" style="width:11px;height:11px"></i>
                    </button>
                </div>
            </div>`;
        },

        _useAgain(item) {
            const ta = document.getElementById('adhub-prompt-text');
            if (ta) {
                ta.value = item.prompt || '';
                ta.dispatchEvent(new Event('input'));
            }
            const link = document.querySelector('[data-tab="ai-generations"]');
            if (link) link.click();
            if (typeof showToast === 'function') showToast('Prompt carregado!', 'success');
        },

        _delete(id) {
            let items = this._load();
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(items.filter(i => i.id !== id)));
            this._render();
        },

        _groupByDate(items) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
            const groups = [
                { label: 'Hoje', items: [] },
                { label: 'Esta semana', items: [] },
                { label: 'Mais antigas', items: [] },
            ];
            items.forEach(item => {
                const d = new Date(item.createdAt);
                if (d >= today) groups[0].items.push(item);
                else if (d >= weekAgo) groups[1].items.push(item);
                else groups[2].items.push(item);
            });
            return groups.filter(g => g.items.length > 0);
        },

        _timeAgo(iso) {
            if (!iso) return '';
            const diff = (Date.now() - new Date(iso).getTime()) / 1000;
            if (diff < 60) return 'agora';
            if (diff < 3600) return Math.floor(diff / 60) + 'm atrás';
            if (diff < 86400) return Math.floor(diff / 3600) + 'h atrás';
            return Math.floor(diff / 86400) + 'd atrás';
        },

        _esc(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.RecentEdits = RecentEdits;
    RecentEdits.init();
})();
