/* ==============================================================
   E-commerce Tracker UX Shell v2
   - Navigation architecture by business workflow
   - Global command palette and quick actions
   - Dynamic page context and executive dashboard introduction
   ============================================================== */

const UXShell = {
    STORAGE_KEY: 'ect_ux_shell_v2',
    RECENTS_KEY: 'ect_ux_recent_search_v1',
    MAX_RECENTS: 6,
    _commandItems: [],
    _commandIndex: 0,

    pages: {
        dashboard: {
            label: 'Central da operação',
            shortLabel: 'Visão geral',
            group: 'Início',
            icon: 'layout-dashboard',
            description: 'Prioridades, desempenho e próximas decisões do e-commerce.'
        },
        vendas: {
            label: 'Vendas',
            group: 'Comercial',
            icon: 'chart-no-axes-combined',
            description: 'Receita, pedidos e comportamento de vendas em tempo real.'
        },
        products: {
            label: 'Produtos',
            group: 'Comercial',
            icon: 'package',
            description: 'Catálogo, custos, margem e desempenho por produto.'
        },
        importador: {
            label: 'Importador',
            group: 'Comercial',
            icon: 'package-plus',
            description: 'Importe e organize novos produtos para a operação.'
        },
        'ad-library': {
            label: 'Biblioteca de anúncios',
            group: 'Marketing & criação',
            icon: 'library',
            description: 'Explore referências e encontre novos ângulos criativos.'
        },
        'ai-generations': {
            label: 'Gerador com IA',
            group: 'Marketing & criação',
            icon: 'wand-sparkles',
            description: 'Gere variações de criativos prontas para testar.'
        },
        studio: {
            label: 'Estúdio de produto',
            group: 'Marketing & criação',
            icon: 'palette',
            description: 'Produza e refine imagens de produto em um único fluxo.'
        },
        'gerar-modelo': {
            label: 'Gerar Modelo',
            shortLabel: 'Modelos',
            group: 'Marketing & criação',
            icon: 'user-round-search',
            description: 'Envie fotos de um modelo e gere a mesma pessoa em vários ângulos e zooms.'
        },
        creatives: {
            label: 'Meus criativos',
            group: 'Marketing & criação',
            icon: 'images',
            description: 'Organize ativos e acompanhe a produção criativa.'
        },
        'creative-insights': {
            label: 'Insights criativos',
            group: 'Marketing & criação',
            icon: 'scan-eye',
            description: 'Entenda quais criativos vencem e o que produzir depois.'
        },
        brands: {
            label: 'Marcas',
            group: 'Marketing & criação',
            icon: 'badge-check',
            description: 'Identidade, ativos e regras visuais das suas marcas.'
        },
        'recent-edits': {
            label: 'Edições recentes',
            group: 'Marketing & criação',
            icon: 'history',
            description: 'Retome rapidamente os trabalhos criativos recentes.'
        },
        'saved-inspirations': {
            label: 'Inspirações salvas',
            group: 'Marketing & criação',
            icon: 'bookmark',
            description: 'Boards e referências para alimentar novos testes.'
        },
        'analisador-criativos': {
            label: 'Analisador de Criativos',
            shortLabel: 'Analisador',
            group: 'Mídia paga',
            icon: 'scan-search',
            description: 'Escale os criativos certos: ROAS, CPA, países e métricas de vídeo por criativo.'
        },
        'ad-launcher': {
            label: 'Lançar anúncios',
            group: 'Mídia paga',
            icon: 'rocket',
            description: 'Monte e publique campanhas sem alternar entre ferramentas.'
        },
        'ads-manager': {
            label: 'Gerenciador de anúncios',
            group: 'Mídia paga',
            icon: 'panel-top',
            description: 'Monitore campanhas, conjuntos e anúncios no mesmo lugar.'
        },
        'ad-hierarchy': {
            label: 'Mapa de campanhas',
            group: 'Mídia paga',
            icon: 'git-fork',
            description: 'Visualize a hierarquia e a distribuição dos investimentos.'
        },
        goals: {
            label: 'Metas',
            group: 'Performance',
            icon: 'target',
            description: 'Defina objetivos e acompanhe o ritmo necessário para atingi-los.'
        },
        diary: {
            label: 'Diário de performance',
            group: 'Performance',
            icon: 'book-open',
            description: 'Registre mudanças, aprendizados e resultados da operação.'
        },
        diagnostico: {
            label: 'Diagnóstico',
            group: 'Performance',
            icon: 'activity',
            description: 'Encontre gargalos e oportunidades no funil de conversão.'
        },
        calculator: {
            label: 'Simulador',
            group: 'Performance',
            icon: 'calculator',
            description: 'Simule cenários de custo, margem e aquisição.'
        },
        'scale-sim': {
            label: 'Simulador de escala',
            group: 'Performance',
            icon: 'trending-up',
            description: 'Projete crescimento e investimento com segurança.'
        },
        pipeline: {
            label: 'Pipeline',
            group: 'Operação',
            icon: 'kanban',
            description: 'Acompanhe produtos e iniciativas ao longo da operação.'
        },
        laboratorio: {
            label: 'Laboratório',
            group: 'Operação',
            icon: 'flask-conical',
            description: 'Planeje, execute e valide testes com rastreabilidade.'
        },
        projects: {
            label: 'Projetos',
            group: 'Operação',
            icon: 'clipboard-list',
            description: 'Organize projetos, entregas, orçamentos e prazos.'
        },
        mineracao: {
            label: 'Mineração',
            group: 'Operação',
            icon: 'pickaxe',
            description: 'Pesquise oportunidades e abasteça o pipeline de produtos.'
        },
        fiscal: {
            label: 'Fiscal',
            group: 'Financeiro',
            icon: 'landmark',
            description: 'Acompanhe obrigações, documentos e rotinas fiscais.'
        },
        reconciliation: {
            label: 'Conciliação',
            group: 'Financeiro',
            icon: 'scale',
            description: 'Concilie pedidos, pagamentos e diferenças financeiras.'
        },
        captures: {
            label: 'Capturas',
            group: 'Financeiro',
            icon: 'cloud-download',
            description: 'Centralize arquivos e evidências recebidos das integrações.'
        }
    },

    sections: [
        { id: 'commercial', label: 'Comercial', icon: 'shopping-bag', tabs: ['vendas', 'products', 'importador'] },
        { id: 'creative', label: 'Marketing & criação', icon: 'sparkles', tabs: ['ad-library', 'ai-generations', 'studio', 'gerar-modelo', 'creatives', 'creative-insights', 'brands', 'recent-edits', 'saved-inspirations'] },
        { id: 'paid-media', label: 'Mídia paga', icon: 'megaphone', tabs: ['analisador-criativos', 'ad-launcher', 'ads-manager', 'ad-hierarchy'] },
        { id: 'performance', label: 'Performance', icon: 'gauge', tabs: ['goals', 'diary', 'diagnostico', 'calculator', 'scale-sim'] },
        { id: 'operations', label: 'Operação', icon: 'workflow', tabs: ['pipeline', 'laboratorio', 'projects', 'mineracao'] },
        { id: 'finance', label: 'Financeiro', icon: 'circle-dollar-sign', tabs: ['fiscal', 'reconciliation', 'captures'] }
    ],

    quickActions: [
        { label: 'Adicionar produto', detail: 'Cadastrar um novo produto', icon: 'package-plus', tab: 'products', target: '#btn-add-product' },
        { label: 'Registrar performance', detail: 'Criar uma entrada no diário', icon: 'notebook-pen', tab: 'diary', target: '#btn-add-entry' },
        { label: 'Gerar criativo', detail: 'Abrir o gerador com IA', icon: 'wand-sparkles', tab: 'ai-generations' },
        { label: 'Lançar anúncio', detail: 'Preparar uma nova campanha', icon: 'rocket', tab: 'ad-launcher' },
        { label: 'Criar teste', detail: 'Adicionar experimento ao laboratório', icon: 'flask-conical', tab: 'laboratorio', target: '#btn-add-lab-test' },
        { label: 'Criar projeto', detail: 'Planejar uma nova iniciativa', icon: 'clipboard-plus', tab: 'projects', target: '#btn-add-project' },
        { label: 'Definir meta', detail: 'Criar uma meta de desempenho', icon: 'target', tab: 'goals', target: '#btn-add-goal' }
    ],

    init() {
        if (document.body.classList.contains('ux-v2-ready')) return;
        document.body.classList.add('ux-v2-ready');
        this._buildSidebar();
        this._buildTopbar();
        this._buildCommandPalette();
        this._buildActionMenu();
        this._buildDashboardHero();
        this._buildCreativeHub();
        this._buildCreativeInsightsShell();
        this._buildWorkspaceSwitchers();
        this._bindGlobalEvents();
        this._observeDashboard();
        this._setPage(this._currentTab(), { animate: false });
        this._refreshIcons();
        window.setTimeout(() => {
            if (typeof DashboardModule !== 'undefined' && typeof DashboardModule.refresh === 'function') {
                DashboardModule.refresh();
            }
            this._updateDashboardSummary();
        }, 0);
        window.setTimeout(() => this._syncStoreContext(), 250);
        window.setTimeout(() => this._syncStoreContext(), 1200);
    },

    _state() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}');
        } catch {
            return {};
        }
    },

    _saveState(next) {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ ...this._state(), ...next }));
        } catch {}
    },

    _currentTab() {
        return document.querySelector('.tab-btn.active')?.dataset.tab ||
            document.querySelector('.tab-panel.active')?.id?.replace('tab-', '') ||
            'dashboard';
    },

    // Cada aba nova (tab id) mapeada pro item de TOPO da antiga sidebar
    // (js/sidebar.js — Sidebar._defaultOrder) a que pertencia, pra "Ordem do
    // menu" continuar tendo efeito depois do redesign. As `sections` daqui são
    // uma reorganização por fluxo de trabalho (mesclam/dividem os grupos
    // antigos), então o mapeamento é de MUITOS-pra-um, não 1:1.
    _TAB_GRUPO_ANTIGO: {
        dashboard: 'dashboard', vendas: 'vendas',
        fiscal: 'financeiro', reconciliation: 'financeiro', captures: 'financeiro',
        products: 'produtos', importador: 'produtos',
        goals: 'performance', diary: 'performance', diagnostico: 'performance',
        calculator: 'simulacao', 'scale-sim': 'simulacao',
        'ad-library': 'creative', 'ai-generations': 'creative', studio: 'creative', 'gerar-modelo': 'creative',
        creatives: 'creative', 'recent-edits': 'creative', 'saved-inspirations': 'creative',
        'analisador-criativos': 'launch', 'ad-launcher': 'launch', 'ads-manager': 'launch', 'ad-hierarchy': 'launch', pipeline: 'launch',
        laboratorio: 'execucao', projects: 'execucao', mineracao: 'execucao',
        'loja-codigo': 'loja', 'loja-empresa': 'loja',
    },

    // Reordena as sections pela ordem customizada em "Ordem do menu" — mas só
    // quando o usuário de fato mudou algo. Na ordem PADRÃO, mantém a sequência
    // curada do redesign (Comercial → Marketing → Mídia paga → ...) exatamente
    // como está, pra não regredir a UX default por causa de um mapeamento
    // aproximado. Ranking de cada section = posição mais cedo, na ordem
    // customizada, de qualquer aba dela — empate mantém a ordem original
    // (sort é estável).
    _sectionsOrdenadas() {
        try {
            if (typeof Sidebar === 'undefined' || typeof Sidebar._getOrder !== 'function') return this.sections;
            const ordem = Sidebar._getOrder();
            const padrao = Sidebar._defaultOrder;
            if (!Array.isArray(ordem) || JSON.stringify(ordem) === JSON.stringify(padrao)) return this.sections;
            const posicao = {};
            ordem.forEach((id, i) => { posicao[id] = i; });
            const rank = (section) => {
                let melhor = Infinity;
                section.tabs.forEach(tab => {
                    const grupoAntigo = this._TAB_GRUPO_ANTIGO[tab];
                    if (grupoAntigo && posicao[grupoAntigo] !== undefined) melhor = Math.min(melhor, posicao[grupoAntigo]);
                });
                return melhor;
            };
            return this.sections
                .map((section, i) => ({ section, i, r: rank(section) }))
                .sort((a, b) => (a.r - b.r) || (a.i - b.i))
                .map(x => x.section);
        } catch { return this.sections; }
    },

    // Monta o <nav> (Visão geral + sections). Extraído de _buildSidebar pra
    // poder ser chamado de novo (_refreshNav) quando "Ordem do menu" mudar,
    // sem duplicar o resto da sidebar (marca, botão "Nova ação").
    _renderNav() {
        const nav = document.createElement('nav');
        nav.className = 'ux-sidebar-nav';
        nav.setAttribute('aria-label', 'Navegação principal');

        const overview = document.createElement('div');
        overview.className = 'ux-nav-overview';
        overview.innerHTML = '<span class="ux-nav-eyebrow">Visão geral</span>';
        overview.appendChild(this._makeNavLink('dashboard'));
        nav.appendChild(overview);

        const saved = this._state();
        const openGroups = new Set(Array.isArray(saved.openGroups) ? saved.openGroups : []);
        this._sectionsOrdenadas().forEach(section => {
            const group = document.createElement('section');
            group.className = 'ux-nav-group';
            group.dataset.group = section.id;
            const isOpen = openGroups.has(section.id);
            if (isOpen) group.classList.add('open');

            const header = document.createElement('button');
            header.type = 'button';
            header.className = 'ux-nav-group-button';
            header.setAttribute('aria-expanded', String(isOpen));
            header.innerHTML = `
                <i data-lucide="${section.icon}" class="ux-nav-group-icon"></i>
                <span>${section.label}</span>
                <i data-lucide="chevron-down" class="ux-nav-chevron"></i>`;

            const items = document.createElement('div');
            items.className = 'ux-nav-group-items';
            items.setAttribute('aria-hidden', String(!isOpen));
            items.inert = !isOpen;
            section.tabs.forEach(tab => {
                if (document.getElementById(`tab-${tab}`)) items.appendChild(this._makeNavLink(tab));
            });

            header.addEventListener('click', () => {
                const appBody = document.querySelector('.app-body');
                if (appBody?.classList.contains('sidebar-collapsed') && window.innerWidth > 960) {
                    appBody.classList.remove('sidebar-collapsed');
                }
                group.classList.toggle('open');
                const open = group.classList.contains('open');
                header.setAttribute('aria-expanded', String(open));
                items.setAttribute('aria-hidden', String(!open));
                items.inert = !open;
                const groups = Array.from(nav.querySelectorAll('.ux-nav-group.open')).map(el => el.dataset.group);
                this._saveState({ openGroups: groups });
            });

            group.append(header, items);
            nav.appendChild(group);
        });

        if (typeof lucide !== 'undefined') try { lucide.createIcons({ nodes: [nav] }); } catch {}
        return nav;
    },

    // Reconstrói só o <nav> (mantém marca/ação intactos) — chamado quando
    // "Ordem do menu" salva uma mudança, pra a barra nova refletir na hora.
    _refreshNav() {
        const sidebar = document.getElementById('app-sidebar');
        const navAtual = sidebar?.querySelector('.ux-sidebar-nav');
        if (!navAtual) return;
        navAtual.replaceWith(this._renderNav());
    },

    _buildSidebar() {
        const sidebar = document.getElementById('app-sidebar');
        const brand = sidebar?.querySelector('.sidebar-brand');
        if (!sidebar || !brand) return;

        brand.setAttribute('aria-label', 'Voltar para a Central da operação');
        brand.innerHTML = `
            <span class="ux-brand-mark"><i data-lucide="blocks"></i></span>
            <span class="ux-brand-copy">
                <strong>Tracker</strong>
                <small>commerce OS</small>
            </span>`;

        const actionButton = document.createElement('button');
        actionButton.type = 'button';
        actionButton.className = 'ux-sidebar-action';
        actionButton.id = 'ux-sidebar-action';
        actionButton.innerHTML = `
            <i data-lucide="plus"></i>
            <span>Nova ação</span>
            <kbd>⌘ K</kbd>`;

        brand.after(actionButton, this._renderNav());
        actionButton.addEventListener('click', () => this.openCommand('', 'actions'));

        const collapseButton = sidebar.querySelector('#sidebar-collapse-btn');
        collapseButton?.setAttribute('aria-label', 'Recolher ou expandir navegação');
    },

    _makeNavLink(tab) {
        const page = this.pages[tab];
        const link = document.createElement('a');
        link.href = '#';
        link.className = 'ux-nav-link';
        link.dataset.tab = tab;
        link.title = page?.label || tab;
        link.innerHTML = `
            <i data-lucide="${page?.icon || 'circle'}"></i>
            <span>${page?.shortLabel || page?.label || tab}</span>`;
        link.addEventListener('click', event => {
            event.preventDefault();
            this.navigate(tab);
        });
        return link;
    },

    _buildTopbar() {
        const main = document.querySelector('.tab-content');
        if (!main) return;

        const topbar = document.createElement('header');
        topbar.className = 'ux-topbar';
        topbar.innerHTML = `
            <div class="ux-topbar-context">
                <button class="ux-mobile-menu" id="ux-mobile-menu" type="button" aria-label="Abrir menu">
                    <i data-lucide="menu"></i>
                </button>
                <div class="ux-breadcrumb">
                    <span>Tracker</span><i data-lucide="chevron-right"></i>
                    <strong id="ux-page-group">Início</strong>
                </div>
                <div class="ux-page-context">
                    <strong id="ux-page-title">Central da operação</strong>
                    <span id="ux-page-description">Prioridades, desempenho e próximas decisões.</span>
                </div>
            </div>
            <div class="ux-topbar-tools">
                <button class="ux-search-trigger" id="ux-search-trigger" type="button">
                    <i data-lucide="search"></i>
                    <span>Buscar ou ir para...</span>
                    <kbd>⌘ K</kbd>
                </button>
                <div class="ux-store-control" id="ux-store-control">
                    <span class="ux-store-avatar" id="ux-store-avatar">LO</span>
                    <span class="ux-store-label">Loja ativa</span>
                </div>
                <div class="ux-topbar-native" id="ux-topbar-native"></div>
            </div>`;

        main.insertBefore(topbar, main.firstChild);

        const storeControl = topbar.querySelector('#ux-store-control');
        const originalStore = document.getElementById('store-selector');
        const manageStores = document.getElementById('btn-manage-stores');
        if (originalStore) {
            originalStore.classList.add('ux-store-select');
            storeControl.appendChild(originalStore);
            originalStore.addEventListener('change', () => this._syncStoreContext());
            const observer = new MutationObserver(() => this._syncStoreContext());
            observer.observe(originalStore, { childList: true, subtree: true, attributes: true });
        }
        if (manageStores) {
            manageStores.classList.add('ux-topbar-icon-button');
            storeControl.appendChild(manageStores);
        }
        // "Ordem do menu" (js/sidebar.js) ficava dentro da .sidebar-store
        // antiga, que o CSS do redesign esconde por completo — sem mover pra
        // cá o botão fica inalcançável na UI nova.
        const menuOrderBtn = document.getElementById('btn-sidebar-settings');
        if (menuOrderBtn) {
            menuOrderBtn.classList.add('ux-topbar-icon-button');
            storeControl.appendChild(menuOrderBtn);
        }

        const nativeTools = topbar.querySelector('#ux-topbar-native');
        const notificationButton = document.getElementById('btn-notifications');
        const notificationsPanel = document.getElementById('notifications-panel');
        if (notificationButton) {
            const wrap = document.createElement('div');
            wrap.className = 'ux-native-tool ux-notification-tool';
            notificationButton.classList.add('ux-topbar-icon-button');
            wrap.appendChild(notificationButton);
            if (notificationsPanel) wrap.appendChild(notificationsPanel);
            nativeTools.appendChild(wrap);
        }

        const themeButton = document.getElementById('btn-theme-toggle');
        if (themeButton) {
            themeButton.classList.add('ux-topbar-icon-button');
            nativeTools.appendChild(themeButton);
        }

        const overlay = document.createElement('button');
        overlay.type = 'button';
        overlay.className = 'ux-mobile-overlay';
        overlay.setAttribute('aria-label', 'Fechar menu');
        document.body.appendChild(overlay);

        topbar.querySelector('#ux-search-trigger')?.addEventListener('click', () => this.openCommand());
        topbar.querySelector('#ux-mobile-menu')?.addEventListener('click', () => this._toggleMobileNav(true));
        overlay.addEventListener('click', () => this._toggleMobileNav(false));
        this._syncStoreContext();
    },

    _buildCommandPalette() {
        const palette = document.createElement('div');
        palette.className = 'ux-command-layer';
        palette.id = 'ux-command-layer';
        palette.setAttribute('aria-hidden', 'true');
        palette.innerHTML = `
            <button class="ux-command-backdrop" type="button" aria-label="Fechar busca"></button>
            <section class="ux-command" role="dialog" aria-modal="true" aria-label="Busca e ações rápidas">
                <div class="ux-command-input-wrap">
                    <i data-lucide="search"></i>
                    <input id="ux-command-input" type="search" autocomplete="off" placeholder="Busque uma tela ou ação...">
                    <kbd>ESC</kbd>
                </div>
                <div class="ux-command-hint" id="ux-command-hint">
                    <span>Resultados</span>
                    <small><kbd>↑</kbd><kbd>↓</kbd> navegar <kbd>↵</kbd> abrir</small>
                </div>
                <div class="ux-command-results" id="ux-command-results"></div>
            </section>`;
        document.body.appendChild(palette);
        palette.querySelector('.ux-command-backdrop')?.addEventListener('click', () => this.closeCommand());
        const input = palette.querySelector('#ux-command-input');
        input?.addEventListener('input', () => this._renderCommandResults(input.value));
        input?.addEventListener('keydown', event => this._onCommandKeydown(event));
    },

    _buildActionMenu() {
        const menu = document.createElement('div');
        menu.className = 'ux-action-menu';
        menu.id = 'ux-action-menu';
        menu.setAttribute('aria-hidden', 'true');
        menu.innerHTML = `
            <div class="ux-action-menu-head">
                <span>Começar agora</span>
                <small>Ações frequentes</small>
            </div>
            <div class="ux-action-menu-grid">
                ${this.quickActions.map((action, index) => `
                    <button type="button" data-action-index="${index}">
                        <span class="ux-action-icon"><i data-lucide="${action.icon}"></i></span>
                        <span><strong>${action.label}</strong><small>${action.detail}</small></span>
                        <i data-lucide="arrow-up-right" class="ux-action-arrow"></i>
                    </button>`).join('')}
            </div>`;
        document.body.appendChild(menu);
        menu.querySelectorAll('[data-action-index]').forEach(button => {
            button.addEventListener('click', () => {
                this._runAction(this.quickActions[Number(button.dataset.actionIndex)]);
                this.closeActionMenu();
            });
        });
    },

    _buildDashboardHero() {
        const dashboard = document.getElementById('tab-dashboard');
        const header = dashboard?.querySelector(':scope > .section-header');
        if (!dashboard || !header) return;
        header.classList.add('ux-dashboard-controls');

        const intro = document.createElement('div');
        intro.className = 'ux-dashboard-intro';
        intro.innerHTML = `
            <div class="ux-dashboard-title-row">
                <div>
                    <span class="ux-eyebrow"><i data-lucide="radio"></i> Central da operação</span>
                    <h1>Decida o próximo movimento<br><em>sem caçar números.</em></h1>
                    <p>Uma leitura executiva da loja, conectando lucro, mídia, produtos e execução.</p>
                </div>
                <div class="ux-dashboard-status">
                    <span><i></i> Visão operacional ativa</span>
                    <small id="ux-dashboard-date"></small>
                </div>
            </div>
            <section class="ux-operations-hero" aria-label="Agora na operação">
                <div class="ux-operations-message">
                    <span>Agora na operação</span>
                    <strong id="ux-operations-title">Prioridades da <span id="ux-hero-store">loja</span></strong>
                    <p>Comece pelo que afeta margem, ritmo de testes ou crescimento.</p>
                    <button type="button" id="ux-open-actions">
                        Nova ação <i data-lucide="arrow-right"></i>
                    </button>
                </div>
                <div class="ux-operations-summary">
                    <button type="button" data-tab="diagnostico">
                        <span><i class="ux-priority-dot danger"></i>Ações necessárias</span>
                        <strong id="ux-summary-actions">—</strong>
                        <small>Centro de decisão</small>
                        <i data-lucide="chevron-right"></i>
                    </button>
                    <button type="button" data-tab="products">
                        <span><i class="ux-priority-dot warning"></i>Produtos em risco</span>
                        <strong id="ux-summary-risks">—</strong>
                        <small>Margem e performance</small>
                        <i data-lucide="chevron-right"></i>
                    </button>
                    <button type="button" data-tab="laboratorio">
                        <span><i class="ux-priority-dot info"></i>Testes pendentes</span>
                        <strong id="ux-summary-tests">—</strong>
                        <small>Ritmo de aprendizado</small>
                        <i data-lucide="chevron-right"></i>
                    </button>
                    <button type="button" data-tab="projects">
                        <span><i class="ux-priority-dot accent"></i>Projetos com prazo</span>
                        <strong id="ux-summary-projects">—</strong>
                        <small>Execução da equipe</small>
                        <i data-lucide="chevron-right"></i>
                    </button>
                </div>
            </section>`;

        dashboard.insertBefore(intro, header);
        intro.querySelector('#ux-open-actions')?.addEventListener('click', () => this.openActionMenu());
        intro.querySelectorAll('[data-tab]').forEach(button => {
            button.addEventListener('click', () => this.navigate(button.dataset.tab));
        });
        const date = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date());
        const dateLabel = intro.querySelector('#ux-dashboard-date');
        if (dateLabel) dateLabel.textContent = date.charAt(0).toUpperCase() + date.slice(1);
        this._setupGlobalFiltersToggle();
    },

    // Barra de filtros globais (moeda/produto/período) recolhível num ícone
    // discreto: por padrão fica fechada, mostrando só o ícone + um resumo do que
    // está selecionado; clicar abre a barra completa. Estado é lembrado.
    _setupGlobalFiltersToggle() {
        const controls = document.querySelector('.ux-dashboard-controls');
        const bar = controls?.querySelector('.dash-date-controls');
        if (!bar || bar.querySelector('.ux-filters-toggle')) return;

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'ux-filters-toggle';
        toggle.setAttribute('aria-label', 'Filtros globais');
        toggle.innerHTML = '<i data-lucide="sliders-horizontal"></i><span class="ux-filters-summary"></span>';
        bar.insertBefore(toggle, bar.firstChild);

        const updateSummary = () => {
            const cur = document.getElementById('dash-currency');
            const prod = document.getElementById('dash-product-filter');
            const dLabel = document.getElementById('dash-date-label');
            const curTxt = cur ? (cur.options[cur.selectedIndex]?.text || '') : '';
            const prodTxt = prod ? (prod.options[prod.selectedIndex]?.text || '') : '';
            const dateTxt = dLabel?.textContent || '';
            const span = toggle.querySelector('.ux-filters-summary');
            if (span) span.textContent = [curTxt, prodTxt, dateTxt].filter(Boolean).join(' · ');
        };

        // Padrão: recolhido (discreto). Só expande se o usuário já tinha aberto.
        const collapsed = this._state().filtersCollapsed !== false;
        controls.classList.toggle('ux-filters-collapsed', collapsed);
        updateSummary();

        toggle.addEventListener('click', () => {
            const nowCollapsed = !controls.classList.contains('ux-filters-collapsed');
            controls.classList.toggle('ux-filters-collapsed', nowCollapsed);
            this._saveState({ filtersCollapsed: nowCollapsed });
            if (nowCollapsed) updateSummary();
        });

        ['dash-currency', 'dash-product-filter'].forEach(id =>
            document.getElementById(id)?.addEventListener('change', updateSummary));
        const dLabel = document.getElementById('dash-date-label');
        if (dLabel && typeof MutationObserver !== 'undefined') {
            new MutationObserver(updateSummary).observe(dLabel, { childList: true, characterData: true, subtree: true });
        }
        this._refreshIcons();
    },

    _buildCreativeHub() {
        const library = document.getElementById('tab-ad-library');
        if (!library) return;
        library.innerHTML = `
            <section class="ux-library-hero">
                <div class="ux-library-hero-copy">
                    <span class="ux-workspace-kicker"><i data-lucide="sparkles"></i> Creative OS</span>
                    <h2>Da referência ao teste,<br><em>tudo no mesmo fluxo.</em></h2>
                    <p>Organize inspirações, produza variações e transforme seus melhores ativos em novos anúncios.</p>
                    <div class="ux-library-actions">
                        <button type="button" class="btn btn-primary" data-ux-go="creatives">
                            Abrir meus criativos <i data-lucide="arrow-right"></i>
                        </button>
                        <button type="button" class="btn btn-secondary" data-ux-go="saved-inspirations">
                            <i data-lucide="bookmark"></i> Ver inspirações
                        </button>
                    </div>
                </div>
                <div class="ux-library-orbit" aria-hidden="true">
                    <div class="ux-orbit-card ux-orbit-card-main">
                        <span><i data-lucide="scan-eye"></i> Análise visual</span>
                        <strong>Hook · Ângulo · Oferta</strong>
                        <small>Leia o criativo antes de escalar.</small>
                    </div>
                    <div class="ux-orbit-card ux-orbit-card-small top"><i data-lucide="image"></i> Assets</div>
                    <div class="ux-orbit-card ux-orbit-card-small bottom"><i data-lucide="rocket"></i> Launch</div>
                    <span class="ux-orbit-line"></span>
                </div>
            </section>

            <div class="ux-hub-heading">
                <div><span>Biblioteca integrada</span><h3>Escolha onde continuar</h3></div>
                <small>6 ferramentas · 1 fluxo criativo</small>
            </div>
            <section class="ux-creative-hub-grid" aria-label="Ferramentas criativas">
                <button type="button" data-ux-go="creatives" class="featured">
                    <span class="ux-hub-card-icon"><i data-lucide="images"></i></span>
                    <span class="ux-hub-card-type">Biblioteca</span>
                    <strong>Meus criativos</strong>
                    <small>Organize arquivos, aprovações e o swipe de referências.</small>
                    <i data-lucide="arrow-up-right" class="ux-hub-arrow"></i>
                </button>
                <button type="button" data-ux-go="saved-inspirations">
                    <span class="ux-hub-card-icon"><i data-lucide="bookmark"></i></span>
                    <span class="ux-hub-card-type">Boards</span>
                    <strong>Inspirações salvas</strong>
                    <small>Agrupe referências por produto, ângulo ou campanha.</small>
                    <i data-lucide="arrow-up-right" class="ux-hub-arrow"></i>
                </button>
                <button type="button" data-ux-go="brands">
                    <span class="ux-hub-card-icon"><i data-lucide="badge-check"></i></span>
                    <span class="ux-hub-card-type">Pesquisa</span>
                    <strong>Marcas monitoradas</strong>
                    <small>Acompanhe concorrentes e alimente seu repertório.</small>
                    <i data-lucide="arrow-up-right" class="ux-hub-arrow"></i>
                </button>
                <button type="button" data-ux-go="ai-generations">
                    <span class="ux-hub-card-icon"><i data-lucide="wand-sparkles"></i></span>
                    <span class="ux-hub-card-type">Produção</span>
                    <strong>Gerador com IA</strong>
                    <small>Crie variações prontas para entrar em teste.</small>
                    <i data-lucide="arrow-up-right" class="ux-hub-arrow"></i>
                </button>
                <button type="button" data-ux-go="studio">
                    <span class="ux-hub-card-icon"><i data-lucide="palette"></i></span>
                    <span class="ux-hub-card-type">Edição</span>
                    <strong>Estúdio de produto</strong>
                    <small>Refine imagens e prepare assets para cada canal.</small>
                    <i data-lucide="arrow-up-right" class="ux-hub-arrow"></i>
                </button>
                <button type="button" data-ux-go="creative-insights">
                    <span class="ux-hub-card-icon"><i data-lucide="scan-eye"></i></span>
                    <span class="ux-hub-card-type">Performance</span>
                    <strong>Insights criativos</strong>
                    <small>Compare hooks, ângulos, formatos e fadiga criativa.</small>
                    <i data-lucide="arrow-up-right" class="ux-hub-arrow"></i>
                </button>
            </section>

            <section class="ux-creative-flow">
                <div><span>01</span><i data-lucide="search"></i><strong>Descobrir</strong><small>Referências e concorrentes</small></div>
                <i data-lucide="arrow-right"></i>
                <div><span>02</span><i data-lucide="wand-sparkles"></i><strong>Produzir</strong><small>Variações e assets</small></div>
                <i data-lucide="arrow-right"></i>
                <div><span>03</span><i data-lucide="rocket"></i><strong>Testar</strong><small>Lançamento no Meta</small></div>
                <i data-lucide="arrow-right"></i>
                <div><span>04</span><i data-lucide="scan-eye"></i><strong>Aprender</strong><small>Leitura visual e iteração</small></div>
            </section>`;

        library.querySelectorAll('[data-ux-go]').forEach(button => {
            button.addEventListener('click', () => this.navigate(button.dataset.uxGo));
        });
    },

    _buildCreativeInsightsShell() {
        const insights = document.getElementById('tab-creative-insights');
        if (!insights) return;
        insights.innerHTML = `
            <div class="section-header ux-insights-header">
                <div>
                    <span class="ux-workspace-kicker"><i data-lucide="scan-eye"></i> Visual intelligence</span>
                    <h2>Creative Insights</h2>
                    <p class="section-subtitle">Entenda o que está por trás do resultado, não apenas qual anúncio venceu.</p>
                </div>
                <button type="button" class="btn btn-primary" data-ux-go="ads-manager">Abrir campanhas <i data-lucide="arrow-up-right"></i></button>
            </div>
            <section class="ux-insight-preview">
                <div class="ux-insight-canvas">
                    <div class="ux-insight-frame">
                        <span><i data-lucide="image"></i></span>
                        <strong>Selecione um criativo</strong>
                        <small>A análise visual aparecerá aqui.</small>
                    </div>
                    <div class="ux-insight-tags">
                        <span>Hook</span><span>Ângulo</span><span>Oferta</span><span>Formato</span><span>CTA</span>
                    </div>
                </div>
                <div class="ux-insight-report">
                    <span class="ux-insight-label">Leitura do criativo</span>
                    <h3>Conecte criação e performance.</h3>
                    <p>Quando seus criativos e campanhas estiverem vinculados, este painel comparará elementos visuais sem inventar métricas.</p>
                    <div class="ux-insight-rows">
                        <div><span><i data-lucide="mouse-pointer-click"></i> Hook inicial</span><em>Aguardando dados</em></div>
                        <div><span><i data-lucide="message-square-text"></i> Ângulo da mensagem</span><em>Aguardando dados</em></div>
                        <div><span><i data-lucide="badge-percent"></i> Construção da oferta</span><em>Aguardando dados</em></div>
                    </div>
                    <button type="button" class="btn btn-secondary" data-ux-go="creatives"><i data-lucide="images"></i> Organizar criativos</button>
                </div>
            </section>
            <section class="ux-insight-capabilities">
                <article><i data-lucide="split"></i><strong>Compare variações</strong><small>Veja qual mudança de hook, visual ou CTA gerou diferença.</small></article>
                <article><i data-lucide="layers-3"></i><strong>Quebre por elemento</strong><small>Agrupe resultados por formato, ângulo, oferta e estilo.</small></article>
                <article><i data-lucide="battery-low"></i><strong>Antecipe fadiga</strong><small>Identifique sinais de desgaste antes de comprometer a escala.</small></article>
            </section>`;
        insights.querySelectorAll('[data-ux-go]').forEach(button => {
            button.addEventListener('click', () => this.navigate(button.dataset.uxGo));
        });
    },

    _buildWorkspaceSwitchers() {
        const workspaces = [
            {
                label: 'Creative OS', icon: 'sparkles',
                tabs: [
                    ['ad-library', 'Biblioteca', 'library'],
                    ['ai-generations', 'Gerar', 'wand-sparkles'],
                    ['studio', 'Estúdio', 'palette'],
                    ['gerar-modelo', 'Modelos', 'user-round-search'],
                    ['creatives', 'Arquivos', 'images'],
                    ['creative-insights', 'Insights', 'scan-eye']
                ]
            },
            {
                label: 'Paid Media', icon: 'megaphone',
                tabs: [
                    ['ad-launcher', 'Lançar', 'rocket'],
                    ['ads-manager', 'Gerenciar', 'panel-top'],
                    ['ad-hierarchy', 'Mapa', 'git-fork']
                ]
            }
        ];

        workspaces.forEach(workspace => {
            workspace.tabs.forEach(([tab]) => {
                const panel = document.getElementById(`tab-${tab}`);
                if (!panel) return;
                const nav = document.createElement('nav');
                nav.className = 'ux-workspace-bar';
                nav.setAttribute('aria-label', `Navegação ${workspace.label}`);
                nav.innerHTML = `
                    <span class="ux-workspace-name"><i data-lucide="${workspace.icon}"></i>${workspace.label}</span>
                    <div class="ux-workspace-tabs">
                        ${workspace.tabs.map(([target, label, icon]) => `
                            <button type="button" data-ux-workspace-tab="${target}" class="${target === tab ? 'active' : ''}">
                                <i data-lucide="${icon}"></i><span>${label}</span>
                            </button>`).join('')}
                    </div>`;
                panel.insertBefore(nav, panel.firstChild);
                nav.querySelectorAll('[data-ux-workspace-tab]').forEach(button => {
                    button.addEventListener('click', () => this.navigate(button.dataset.uxWorkspaceTab));
                });
            });
        });
    },

    _bindGlobalEvents() {
        document.addEventListener('keydown', event => {
            const shortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
            if (shortcut) {
                event.preventDefault();
                this.openCommand();
                return;
            }
            if (event.key === 'Escape') {
                this.closeCommand();
                this.closeActionMenu();
                this._toggleMobileNav(false);
            }
        });

        document.addEventListener('click', event => {
            if (!event.target.closest('#ux-action-menu, #ux-sidebar-action, #ux-open-actions')) {
                this.closeActionMenu();
            }
        });

        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', tab => this._setPage(tab));
            EventBus.on('storeChanged', () => this._syncStoreContext());
            EventBus.on('themeChanged', () => this._refreshIcons());
        }

        window.addEventListener('resize', () => {
            if (window.innerWidth > 960) this._toggleMobileNav(false);
        });
    },

    _observeDashboard() {
        const ids = ['dash-actions', 'dash-alerts', 'dash-deadlines-tests', 'dash-deadlines-projects'];
        ids.forEach(id => {
            const element = document.getElementById(id);
            if (!element) return;
            new MutationObserver(() => this._updateDashboardSummary()).observe(element, { childList: true, subtree: true });
        });
        this._updateDashboardSummary();
    },

    _updateDashboardSummary() {
        const count = (id, selector) => {
            const root = document.getElementById(id);
            if (!root) return 0;
            return root.querySelectorAll(selector).length;
        };
        const values = {
            'ux-summary-actions': count('dash-actions', '.dash-action-item'),
            'ux-summary-risks': count('dash-alerts', '.dash-alert-item'),
            'ux-summary-tests': count('dash-deadlines-tests', '.dash-deadline-item'),
            'ux-summary-projects': count('dash-deadlines-projects', '.dash-deadline-item')
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = String(value);
        });
    },

    _syncStoreContext() {
        const select = document.getElementById('store-selector');
        if (!select) return;
        const name = select.options[select.selectedIndex]?.textContent?.trim() || 'Todas as lojas';
        const cleanName = name === 'TODAS' ? 'Todas as lojas' : name;
        const initials = cleanName.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'LO';
        const avatar = document.getElementById('ux-store-avatar');
        const heroStore = document.getElementById('ux-hero-store');
        if (avatar) avatar.textContent = initials;
        if (heroStore) heroStore.textContent = cleanName.toLowerCase();
    },

    _setPage(tab, options = {}) {
        const page = this.pages[tab] || { label: tab, group: 'Workspace', description: '' };
        const title = document.getElementById('ux-page-title');
        const group = document.getElementById('ux-page-group');
        const description = document.getElementById('ux-page-description');
        if (title) title.textContent = page.label;
        if (group) group.textContent = page.group;
        if (description) description.textContent = page.description;
        document.title = `${page.label} — E-commerce Tracker`;

        document.querySelectorAll('.ux-nav-link').forEach(link => {
            const active = link.dataset.tab === tab;
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        });

        document.querySelectorAll('[data-ux-workspace-tab]').forEach(button => {
            const active = button.dataset.uxWorkspaceTab === tab;
            button.classList.toggle('active', active);
            if (active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });

        const activeLink = document.querySelector(`.ux-nav-link[data-tab="${tab}"]`);
        const parentGroup = activeLink?.closest('.ux-nav-group');
        if (parentGroup && !parentGroup.classList.contains('open')) {
            parentGroup.classList.add('open');
            parentGroup.querySelector('.ux-nav-group-button')?.setAttribute('aria-expanded', 'true');
            const items = parentGroup.querySelector('.ux-nav-group-items');
            items?.setAttribute('aria-hidden', 'false');
            if (items) items.inert = false;
        }

        if (options.animate !== false) {
            const panel = document.getElementById(`tab-${tab}`);
            if (panel) {
                panel.classList.remove('ux-page-enter');
                requestAnimationFrame(() => panel.classList.add('ux-page-enter'));
                window.setTimeout(() => panel.classList.remove('ux-page-enter'), 520);
            }
            document.querySelector('.tab-content')?.scrollTo?.({ top: 0, behavior: 'smooth' });
        }
        this._toggleMobileNav(false);
        this._refreshIcons();
    },

    navigate(tab) {
        const legacyButton = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
        if (legacyButton) legacyButton.click();

        // The visual shell must not depend exclusively on the legacy click
        // listener. If another module fails during boot, that listener may not
        // be registered and the new navigation would otherwise look clickable
        // while doing nothing. Fall back to the same state transition here.
        const targetPanel = document.getElementById(`tab-${tab}`);
        if (targetPanel && !targetPanel.classList.contains('active')) {
            document.querySelectorAll('.tab-btn').forEach(button => button.classList.remove('active'));
            document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
            legacyButton?.classList.add('active');
            targetPanel.classList.add('active');
            if (typeof EventBus !== 'undefined') EventBus.emit('tabChanged', tab);
        }
        this._setPage(tab);
    },

    openCommand(query = '', mode = 'all') {
        const layer = document.getElementById('ux-command-layer');
        const input = document.getElementById('ux-command-input');
        if (!layer || !input) return;
        layer.classList.add('open');
        layer.setAttribute('aria-hidden', 'false');
        document.body.classList.add('ux-overlay-open');
        input.value = query;
        input.dataset.mode = mode;
        this._renderCommandResults(query, mode);
        window.setTimeout(() => input.focus(), 30);
    },

    closeCommand() {
        const layer = document.getElementById('ux-command-layer');
        if (!layer?.classList.contains('open')) return;
        layer.classList.remove('open');
        layer.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('ux-overlay-open');
    },

    // Chave de identidade estável de um resultado (independe do texto exibido,
    // só a rota/ação real importa) — usada tanto pra gravar quanto pra deduplicar.
    _commandKey(item) {
        return item.type === 'action' ? `action:${item.label}` : `page:${item.tab}`;
    },

    _getRecents() {
        try {
            const raw = JSON.parse(localStorage.getItem(this.RECENTS_KEY) || '[]');
            return Array.isArray(raw) ? raw : [];
        } catch { return []; }
    },

    // Grava o item ativado no topo dos recentes (mais-recente-primeiro), sem
    // duplicar — se já estava na lista, só sobe pro topo.
    _recordRecent(item) {
        if (!item) return;
        const key = this._commandKey(item);
        const entry = item.type === 'action' ? { type: 'action', label: item.label } : { type: 'page', tab: item.tab };
        const rest = this._getRecents().filter(r => this._commandKey(r) !== key);
        const next = [entry, ...rest].slice(0, this.MAX_RECENTS);
        try { localStorage.setItem(this.RECENTS_KEY, JSON.stringify(next)); } catch {}
    },

    // Resolve os recentes salvos (só {type, tab|label}) de volta pros itens
    // completos (ícone, grupo, descrição) a partir de `pages`/`quickActions`
    // atuais — assim a lista nunca fica com dado velho se um rótulo mudar, e
    // itens removidos numa atualização somem sozinhos em vez de dar erro.
    _resolveRecents() {
        const out = [];
        this._getRecents().forEach(r => {
            if (r.type === 'page') {
                const page = this.pages[r.tab];
                if (page && document.getElementById(`tab-${r.tab}`)) out.push({ type: 'page', tab: r.tab, ...page, group: 'Recente' });
            } else if (r.type === 'action') {
                const action = this.quickActions.find(a => a.label === r.label);
                const index = this.quickActions.indexOf(action);
                if (action) out.push({ type: 'action', action, index, label: action.label, group: 'Recente', icon: action.icon, description: action.detail });
            }
        });
        return out;
    },

    _renderCommandResults(query = '', mode) {
        const results = document.getElementById('ux-command-results');
        const input = document.getElementById('ux-command-input');
        if (!results) return;
        const currentMode = mode || input?.dataset.mode || 'all';
        const normalized = query.trim().toLocaleLowerCase('pt-BR');
        const pages = Object.entries(this.pages)
            .filter(([tab]) => document.getElementById(`tab-${tab}`))
            .map(([tab, page]) => ({ type: 'page', tab, ...page }));
        const actions = this.quickActions.map((action, index) => ({ type: 'action', action, index, label: action.label, group: 'Ação rápida', icon: action.icon, description: action.detail }));
        let items = currentMode === 'actions' ? actions : [...actions, ...pages];
        if (normalized) {
            items = items.filter(item => `${item.label} ${item.group} ${item.description || ''}`.toLocaleLowerCase('pt-BR').includes(normalized));
        } else {
            // Campo vazio (busca recém-aberta): recentes primeiro, sem repetir
            // no restante da lista.
            const recents = this._resolveRecents();
            if (recents.length) {
                const recentKeys = new Set(recents.map(r => this._commandKey(r)));
                items = [...recents, ...items.filter(item => !recentKeys.has(this._commandKey(item)))];
            }
        }
        this._commandItems = items.slice(0, 12);
        this._commandIndex = 0;

        if (!this._commandItems.length) {
            results.innerHTML = `
                <div class="ux-command-empty">
                    <i data-lucide="search-x"></i>
                    <strong>Nenhum resultado</strong>
                    <span>Tente buscar por produto, anúncio, meta ou financeiro.</span>
                </div>`;
            this._refreshIcons();
            return;
        }

        results.innerHTML = this._commandItems.map((item, index) => `
            <button type="button" class="ux-command-item ${index === 0 ? 'selected' : ''}" data-command-index="${index}">
                <span class="ux-command-item-icon"><i data-lucide="${item.icon}"></i></span>
                <span class="ux-command-item-copy">
                    <strong>${item.label}</strong>
                    <small>${item.group}${item.description ? ` · ${item.description}` : ''}</small>
                </span>
                <span class="ux-command-item-type">${item.type === 'action' ? 'Criar' : 'Abrir'}</span>
            </button>`).join('');
        results.querySelectorAll('[data-command-index]').forEach(button => {
            button.addEventListener('mouseenter', () => this._selectCommand(Number(button.dataset.commandIndex)));
            button.addEventListener('click', () => this._activateCommand(Number(button.dataset.commandIndex)));
        });
        this._refreshIcons();
    },

    _onCommandKeydown(event) {
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this._selectCommand(Math.min(this._commandItems.length - 1, this._commandIndex + 1));
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            this._selectCommand(Math.max(0, this._commandIndex - 1));
        } else if (event.key === 'Enter') {
            event.preventDefault();
            this._activateCommand(this._commandIndex);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.closeCommand();
        }
    },

    _selectCommand(index) {
        this._commandIndex = index;
        document.querySelectorAll('.ux-command-item').forEach((item, itemIndex) => item.classList.toggle('selected', itemIndex === index));
        document.querySelector(`.ux-command-item[data-command-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
    },

    _activateCommand(index) {
        const item = this._commandItems[index];
        if (!item) return;
        this._recordRecent(item);
        this.closeCommand();
        if (item.type === 'action') this._runAction(item.action);
        else this.navigate(item.tab);
    },

    _runAction(action) {
        if (!action) return;
        this.navigate(action.tab);
        if (action.target) {
            window.setTimeout(() => {
                const target = document.querySelector(action.target);
                if (target && target.offsetParent !== null) target.click();
            }, 120);
        }
    },

    openActionMenu() {
        const menu = document.getElementById('ux-action-menu');
        if (!menu) return;
        menu.classList.add('open');
        menu.setAttribute('aria-hidden', 'false');
        this._refreshIcons();
    },

    closeActionMenu() {
        const menu = document.getElementById('ux-action-menu');
        menu?.classList.remove('open');
        menu?.setAttribute('aria-hidden', 'true');
    },

    _toggleMobileNav(open) {
        const body = document.querySelector('.app-body');
        body?.classList.toggle('ux-mobile-nav-open', Boolean(open));
        document.body.classList.toggle('ux-mobile-nav-visible', Boolean(open));
    },

    _refreshIcons() {
        if (typeof lucide !== 'undefined') window.setTimeout(() => lucide.createIcons(), 0);
    }
};

if (document.readyState !== 'loading') UXShell.init();
else document.addEventListener('DOMContentLoaded', () => UXShell.init());
