/* ===========================
   Dashboard Customize Module
   - Mostrar/ocultar blocos
   - Reordenar via drag & drop (no modal e direto na dashboard em modo edição)
   - Persistência em localStorage
   =========================== */

const DashCustomize = {
    STORAGE_KEY: 'dash_layout_v1',
    _editMode: false,

    init() {
        document.addEventListener('DOMContentLoaded', () => this._setup());
        if (document.readyState !== 'loading') this._setup();
    },

    _setup() {
        // Aplica layout salvo na primeira renderização
        this.applyLayout();

        // Botão "Personalizar"
        const btn = document.getElementById('btn-dash-customize');
        if (btn) btn.addEventListener('click', () => this.openModal());

        // Botão "Restaurar padrão"
        const resetBtn = document.getElementById('dash-customize-reset');
        if (resetBtn) resetBtn.addEventListener('click', () => this.resetToDefault());
    },

    // ── Layout: { order: [blockId, ...], hidden: [blockId, ...] } ──
    _readLayout() {
        try {
            const raw = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
            return {
                order: Array.isArray(raw.order) ? raw.order : [],
                hidden: Array.isArray(raw.hidden) ? raw.hidden : []
            };
        } catch { return { order: [], hidden: [] }; }
    },

    _saveLayout(layout) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(layout));
    },

    _getAllBlocks() {
        const dash = document.getElementById('tab-dashboard');
        if (!dash) return [];
        return Array.from(dash.querySelectorAll('.dash-block'));
    },

    _getBlockMeta(el) {
        return {
            id: el.dataset.blockId,
            name: el.dataset.blockName || el.dataset.blockId,
            el
        };
    },

    applyLayout() {
        const layout = this._readLayout();
        const blocks = this._getAllBlocks();
        if (!blocks.length) return;

        // Esconder os marcados como hidden
        const hiddenSet = new Set(layout.hidden);
        blocks.forEach(b => {
            if (hiddenSet.has(b.dataset.blockId)) b.classList.add('dash-block-hidden');
            else b.classList.remove('dash-block-hidden');
        });

        // Reordenar conforme `order` — primeiro os listados, depois os ainda não vistos no fim
        if (layout.order.length === 0) return;
        const dash = document.getElementById('tab-dashboard');
        if (!dash) return;

        const byId = new Map(blocks.map(b => [b.dataset.blockId, b]));
        const seen = new Set();
        layout.order.forEach(id => {
            const el = byId.get(id);
            if (!el) return;
            seen.add(id);
            dash.appendChild(el); // move para o final na ordem do array
        });
        // Os que não estavam no order ficam depois (mantendo ordem original)
        blocks.forEach(b => {
            if (!seen.has(b.dataset.blockId)) dash.appendChild(b);
        });
    },

    openModal() {
        this._renderModalList();
        if (typeof openModal === 'function') openModal('dash-customize-modal');
    },

    _renderModalList() {
        const list = document.getElementById('dash-customize-list');
        if (!list) return;
        const layout = this._readLayout();
        const hiddenSet = new Set(layout.hidden);
        const blocks = this._getAllBlocks().map(b => this._getBlockMeta(b));

        // Ordena conforme layout.order, e depois os não listados
        const ordered = [];
        const seen = new Set();
        layout.order.forEach(id => {
            const m = blocks.find(b => b.id === id);
            if (m) { ordered.push(m); seen.add(id); }
        });
        blocks.forEach(m => { if (!seen.has(m.id)) ordered.push(m); });

        list.innerHTML = ordered.map(b => `
            <div class="dash-customize-item" draggable="true" data-id="${b.id}">
                <span class="dash-customize-grip" title="Arraste para reordenar"><i data-lucide="grip-vertical" style="width:14px;height:14px"></i></span>
                <input type="checkbox" class="dash-customize-toggle" data-id="${b.id}" ${hiddenSet.has(b.id) ? '' : 'checked'}>
                <span class="dash-customize-name">${this._esc(b.name)}</span>
            </div>
        `).join('');

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            try { lucide.createIcons(); } catch {}
        }

        // Toggle visibility
        list.querySelectorAll('.dash-customize-toggle').forEach(cb => {
            cb.addEventListener('change', () => {
                const lay = this._readLayout();
                const hid = new Set(lay.hidden);
                if (cb.checked) hid.delete(cb.dataset.id);
                else hid.add(cb.dataset.id);
                lay.hidden = Array.from(hid);
                this._saveLayout(lay);
                this.applyLayout();
            });
        });

        // Drag and drop reorder
        this._wireDragDrop(list);
    },

    _wireDragDrop(list) {
        let draggedEl = null;

        list.querySelectorAll('.dash-customize-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                draggedEl = item;
                item.classList.add('dash-customize-dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', item.dataset.id);
                }
            });
            item.addEventListener('dragend', () => {
                item.classList.remove('dash-customize-dragging');
                draggedEl = null;
                list.querySelectorAll('.dash-customize-item').forEach(i =>
                    i.classList.remove('dash-customize-drop-before', 'dash-customize-drop-after')
                );
                this._persistOrderFromList(list);
                this.applyLayout();
            });
            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                if (!draggedEl || draggedEl === item) return;
                const rect = item.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                list.querySelectorAll('.dash-customize-item').forEach(i =>
                    i.classList.remove('dash-customize-drop-before', 'dash-customize-drop-after')
                );
                item.classList.add(before ? 'dash-customize-drop-before' : 'dash-customize-drop-after');
            });
            item.addEventListener('drop', (e) => {
                e.preventDefault();
                if (!draggedEl || draggedEl === item) return;
                const rect = item.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                if (before) item.parentNode.insertBefore(draggedEl, item);
                else item.parentNode.insertBefore(draggedEl, item.nextSibling);
            });
        });
    },

    _persistOrderFromList(list) {
        const ids = Array.from(list.querySelectorAll('.dash-customize-item')).map(i => i.dataset.id);
        const lay = this._readLayout();
        lay.order = ids;
        this._saveLayout(lay);
    },

    resetToDefault() {
        localStorage.removeItem(this.STORAGE_KEY);
        // Recarrega ordem original: pra restaurar a ordem do HTML, recarregar página é mais seguro
        if (typeof showToast === 'function') showToast('Layout restaurado — recarregando…', 'success');
        setTimeout(() => window.location.reload(), 600);
    },

    _esc(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
};

DashCustomize.init();
