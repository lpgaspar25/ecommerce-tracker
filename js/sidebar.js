/* ===========================
   Sidebar Module
   - Gerencia colapsar/expandir grupos
   - Sincroniza estado ativo com tab-btn (event bus)
   - Persiste estado em localStorage
   =========================== */

const Sidebar = {
    STORAGE_KEY: 'sidebar_state_v1',
    ORDER_KEY: 'sidebar_order_v1',

    // Itens de topo-nível na ordem padrão (2 links soltos + 8 grupos).
    // Sublinks (dentro de cada grupo) não entram aqui — reordenar só o
    // nível principal já cobre a dor relatada, com bem menos risco.
    _defaultOrder: ['dashboard', 'vendas', 'financeiro', 'produtos', 'performance', 'simulacao', 'creative', 'launch', 'execucao', 'loja'],
    _labels: {
        dashboard: 'Dashboard', vendas: 'Vendas', financeiro: 'Financeiro', produtos: 'Produtos',
        performance: 'Performance', simulacao: 'Simulação', creative: 'AI Ad Hub', launch: 'Lançamento',
        execucao: 'Execução', loja: 'Loja',
    },

    init() {
        if (document.readyState !== 'loading') this._setup();
        else document.addEventListener('DOMContentLoaded', () => this._setup());
    },

    _setup() {
        // Restaura estado (collapsed groups, sidebar collapsed)
        this._restoreState();
        this._applyOrder();
        this._wireSettingsModal();

        // Sidebar links → proxy pra tab-btn correspondente
        document.querySelectorAll('.app-sidebar .sidebar-link[data-tab]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = link.dataset.tab;
                if (!tab) return;
                // Trigger no tab-btn legado (mantém event bus + lógica existente)
                const btn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
                if (btn) btn.click();
                this.setActive(tab);
            });
        });

        // Group headers → toggle collapse
        document.querySelectorAll('.app-sidebar .sidebar-group-header').forEach(hdr => {
            hdr.addEventListener('click', () => {
                const group = hdr.closest('.sidebar-group');
                if (!group) return;
                group.classList.toggle('sidebar-group-collapsed');
                this._saveState();
            });
        });

        // Sidebar collapse button
        const collapseBtn = document.getElementById('sidebar-collapse-btn');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', () => {
                document.querySelector('.app-body')?.classList.toggle('sidebar-collapsed');
                this._saveState();
            });
        }

        // Sincroniza com event bus quando tab muda (via outro caminho que não seja sidebar)
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (tab) => this.setActive(tab));
        }

        // Garante grupo ativo expandido (se a tab inicial estiver dentro de um grupo colapsado)
        const activeTab = document.querySelector('.tab-btn.active')?.dataset.tab;
        if (activeTab) this.setActive(activeTab);
    },

    setActive(tab) {
        document.querySelectorAll('.app-sidebar .sidebar-link').forEach(l => l.classList.remove('active'));
        const link = document.querySelector(`.app-sidebar .sidebar-link[data-tab="${tab}"]`);
        if (link) {
            link.classList.add('active');
            // Garante que o grupo pai está expandido
            const group = link.closest('.sidebar-group');
            if (group) group.classList.remove('sidebar-group-collapsed');
        }
    },

    _saveState() {
        const state = {
            sidebarCollapsed: document.querySelector('.app-body')?.classList.contains('sidebar-collapsed') || false,
            collapsedGroups: Array.from(document.querySelectorAll('.sidebar-group.sidebar-group-collapsed'))
                .map(g => g.querySelector('.sidebar-group-header')?.dataset.group)
                .filter(Boolean)
        };
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
    },

    _restoreState() {
        try {
            const state = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
            if (state.sidebarCollapsed) {
                document.querySelector('.app-body')?.classList.add('sidebar-collapsed');
            }
            if (Array.isArray(state.collapsedGroups)) {
                state.collapsedGroups.forEach(name => {
                    const grp = document.querySelector(`.sidebar-group-header[data-group="${name}"]`)?.closest('.sidebar-group');
                    if (grp) grp.classList.add('sidebar-group-collapsed');
                });
            }
        } catch {}
    },

    // ── Ordem do menu (NAV-01) ───────────────────────────────────────────
    // Os 2 links soltos (Dashboard/Vendas) e os 8 grupos são todos irmãos
    // diretos dentro de .app-sidebar — dá pra mover qualquer um deles com
    // appendChild sem precisar entender a estrutura interna de cada um.
    _topLevelNode(id) {
        if (id === 'dashboard' || id === 'vendas') {
            return document.querySelector(`.app-sidebar > .sidebar-link[data-tab="${id}"]`);
        }
        const header = document.querySelector(`.sidebar-group-header[data-group="${id}"]`);
        return header ? header.closest('.sidebar-group') : null;
    },

    _getOrder() {
        // Cache em memória: se localStorage.setItem falhar (modo privado do
        // Safari, extensão bloqueando storage etc), _saveOrder ainda guarda
        // aqui — sem isso, o clique reordenava na hora e "voltava sozinho"
        // porque _applyOrder/_renderSettingsList reliam do valor antigo salvo.
        if (Array.isArray(this._orderCache)) return [...this._orderCache];
        try {
            const saved = JSON.parse(localStorage.getItem(this.ORDER_KEY) || 'null');
            if (Array.isArray(saved) && saved.length) {
                // Item novo que não existia quando a ordem foi salva entra no fim.
                const faltando = this._defaultOrder.filter(id => !saved.includes(id));
                return [...saved.filter(id => this._defaultOrder.includes(id)), ...faltando];
            }
        } catch {}
        return [...this._defaultOrder];
    },

    _saveOrder(order) {
        this._orderCache = order;
        try { localStorage.setItem(this.ORDER_KEY, JSON.stringify(order)); } catch {}
    },

    _applyOrder(order) {
        const parent = document.querySelector('.app-sidebar');
        if (!parent) return;
        const spacer = parent.querySelector('.sidebar-spacer');
        (order || this._getOrder()).forEach(id => {
            const node = this._topLevelNode(id);
            // insertBefore o spacer — sem isso os itens reordenados
            // acabariam depois dele (o spacer é appendChild'd só uma vez,
            // no fim, e ficaria "preso" no meio conforme reordena).
            if (node) parent.insertBefore(node, spacer || null);
        });
    },

    _wireSettingsModal() {
        document.getElementById('btn-sidebar-settings')?.addEventListener('click', () => this._openSettingsModal());
        document.getElementById('sidebar-settings-close')?.addEventListener('click', () => this._closeSettingsModal());
        document.querySelector('#modal-sidebar-settings .modal-overlay')?.addEventListener('click', () => this._closeSettingsModal());
        document.getElementById('sidebar-order-reset')?.addEventListener('click', () => {
            const order = [...this._defaultOrder];
            this._saveOrder(order);
            this._applyOrder(order);
            this._renderSettingsList(order);
        });
    },

    _openSettingsModal() {
        this._renderSettingsList();
        document.getElementById('modal-sidebar-settings')?.classList.remove('hidden');
    },

    _closeSettingsModal() {
        document.getElementById('modal-sidebar-settings')?.classList.add('hidden');
    },

    _renderSettingsList(order) {
        const box = document.getElementById('sidebar-order-list');
        if (!box) return;
        order = order || this._getOrder();
        box.innerHTML = order.map((id, i) => `
            <div class="sidebar-order-item">
                <span>${this._labels[id] || id}</span>
                <div class="sidebar-order-acoes">
                    <button type="button" class="btn-icon" data-mover-cima="${id}" ${i === 0 ? 'disabled' : ''} title="Mover pra cima"><i data-lucide="chevron-up" style="width:14px;height:14px"></i></button>
                    <button type="button" class="btn-icon" data-mover-baixo="${id}" ${i === order.length - 1 ? 'disabled' : ''} title="Mover pra baixo"><i data-lucide="chevron-down" style="width:14px;height:14px"></i></button>
                </div>
            </div>`).join('');

        box.querySelectorAll('[data-mover-cima]').forEach(btn => {
            btn.addEventListener('click', () => this._moverItem(btn.dataset.moverCima, -1));
        });
        box.querySelectorAll('[data-mover-baixo]').forEach(btn => {
            btn.addEventListener('click', () => this._moverItem(btn.dataset.moverBaixo, 1));
        });
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    },

    _moverItem(id, direcao) {
        const order = this._getOrder();
        const idx = order.indexOf(id);
        const novoIdx = idx + direcao;
        if (idx < 0 || novoIdx < 0 || novoIdx >= order.length) return;
        [order[idx], order[novoIdx]] = [order[novoIdx], order[idx]];
        this._saveOrder(order);
        this._applyOrder(order);
        this._renderSettingsList(order);
    },
};

Sidebar.init();
