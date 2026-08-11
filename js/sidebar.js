/* ===========================
   Sidebar Module
   - Gerencia colapsar/expandir grupos
   - Sincroniza estado ativo com tab-btn (event bus)
   - Persiste estado em localStorage
   =========================== */

const Sidebar = {
    STORAGE_KEY: 'sidebar_state_v1',

    init() {
        if (document.readyState !== 'loading') this._setup();
        else document.addEventListener('DOMContentLoaded', () => this._setup());
    },

    _setup() {
        // Restaura estado (collapsed groups, sidebar collapsed)
        this._restoreState();

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
    }
};

Sidebar.init();
