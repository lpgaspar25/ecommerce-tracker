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

        // Botão "Reorganizar" (modo edição)
        const editBtn = document.getElementById('btn-dash-edit-mode');
        if (editBtn) editBtn.addEventListener('click', () => this.toggleEditMode());

        const doneBtn = document.getElementById('dash-edit-done');
        if (doneBtn) doneBtn.addEventListener('click', () => this.toggleEditMode(false));

        const showHiddenBtn = document.getElementById('dash-edit-show-hidden');
        if (showHiddenBtn) showHiddenBtn.addEventListener('click', () => this.showAllHidden());
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

    // ── Modo de edição direto no dashboard ──────────────────────────
    toggleEditMode(force) {
        const turnOn = typeof force === 'boolean' ? force : !this._editMode;
        this._editMode = turnOn;

        const dash = document.getElementById('tab-dashboard');
        const bar = document.getElementById('dash-edit-bar');
        const editBtn = document.getElementById('btn-dash-edit-mode');

        if (!dash) return;

        if (turnOn) {
            dash.classList.add('dash-edit-mode');
            if (bar) bar.style.display = '';
            if (editBtn) {
                editBtn.classList.add('btn-primary');
                editBtn.classList.remove('btn-secondary');
                editBtn.innerHTML = '<i data-lucide="x" style="width:14px;height:14px"></i> Sair da edição';
            }
            this._injectEditControls();
            this._wireBlockDragDrop();
        } else {
            dash.classList.remove('dash-edit-mode');
            if (bar) bar.style.display = 'none';
            if (editBtn) {
                editBtn.classList.remove('btn-primary');
                editBtn.classList.add('btn-secondary');
                editBtn.innerHTML = '<i data-lucide="move" style="width:14px;height:14px"></i> Reorganizar';
            }
            this._removeEditControls();
        }

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            try { lucide.createIcons(); } catch {}
        }
    },

    _injectEditControls() {
        this._getAllBlocks().forEach(block => {
            if (block.querySelector('.dash-block-controls')) return;
            const ctrls = document.createElement('div');
            ctrls.className = 'dash-block-controls';
            ctrls.innerHTML = `
                <button class="dash-block-handle" type="button" title="Arraste para reordenar"><i data-lucide="grip-vertical" style="width:16px;height:16px"></i></button>
                <button class="dash-block-hide" type="button" title="Esconder bloco">×</button>
            `;
            block.appendChild(ctrls);
            // Marca como draggable
            block.setAttribute('draggable', 'true');

            // Handler do botão "esconder"
            ctrls.querySelector('.dash-block-hide').addEventListener('click', (e) => {
                e.stopPropagation();
                this._hideBlock(block.dataset.blockId);
            });
        });
    },

    _removeEditControls() {
        this._getAllBlocks().forEach(block => {
            block.removeAttribute('draggable');
            const ctrls = block.querySelector('.dash-block-controls');
            if (ctrls) ctrls.remove();
            block.classList.remove('dash-block-dragging', 'dash-block-drop-before', 'dash-block-drop-after');
        });
    },

    _wireBlockDragDrop() {
        const dash = document.getElementById('tab-dashboard');
        if (!dash) return;
        let dragged = null;

        this._getAllBlocks().forEach(block => {
            block.addEventListener('dragstart', (e) => {
                if (!this._editMode) return;
                dragged = block;
                block.classList.add('dash-block-dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', block.dataset.blockId);
                }
            });
            block.addEventListener('dragend', () => {
                block.classList.remove('dash-block-dragging');
                dragged = null;
                this._getAllBlocks().forEach(b =>
                    b.classList.remove('dash-block-drop-before', 'dash-block-drop-after')
                );
                this._persistOrderFromDOM();
            });
            block.addEventListener('dragover', (e) => {
                if (!dragged || dragged === block || !this._editMode) return;
                e.preventDefault();
                const rect = block.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                this._getAllBlocks().forEach(b =>
                    b.classList.remove('dash-block-drop-before', 'dash-block-drop-after')
                );
                block.classList.add(before ? 'dash-block-drop-before' : 'dash-block-drop-after');
            });
            block.addEventListener('drop', (e) => {
                if (!dragged || dragged === block || !this._editMode) return;
                e.preventDefault();
                const rect = block.getBoundingClientRect();
                const before = e.clientY < rect.top + rect.height / 2;
                if (before) block.parentNode.insertBefore(dragged, block);
                else block.parentNode.insertBefore(dragged, block.nextSibling);
            });
        });
    },

    _persistOrderFromDOM() {
        const ids = this._getAllBlocks().map(b => b.dataset.blockId);
        const lay = this._readLayout();
        lay.order = ids;
        this._saveLayout(lay);
    },

    _hideBlock(blockId) {
        const lay = this._readLayout();
        const hid = new Set(lay.hidden);
        hid.add(blockId);
        lay.hidden = Array.from(hid);
        this._saveLayout(lay);
        this.applyLayout();
        if (typeof showToast === 'function') showToast('Bloco escondido — use "Mostrar ocultos" para trazer de volta', 'success');
    },

    showAllHidden() {
        const lay = this._readLayout();
        if (!lay.hidden.length) {
            if (typeof showToast === 'function') showToast('Nenhum bloco oculto', 'info');
            return;
        }
        const count = lay.hidden.length;
        lay.hidden = [];
        this._saveLayout(lay);
        this.applyLayout();
        if (typeof showToast === 'function') showToast(`${count} bloco(s) restaurado(s)`, 'success');
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
