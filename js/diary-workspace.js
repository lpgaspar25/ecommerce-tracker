/* ================================================================
   Diary Workspace — performance cockpit
   Demo data is available only with ?diaryPreview=1 and is never persisted.
   ================================================================ */

const DiaryWorkspacePreview = {
    enabled: false,
    previewRequested: false,
    activeView: 'overview',
    usingDemo: false,
    historyMode: 'percent',
    openHistoryRows: new Set(),
    historyColumnsKey: 'etracker_diary_history_columns_v1',
    historyColumns: {},
    historyColumnDefs: [
        { id: 'spend', label: 'Gasto', default: true },
        { id: 'visitors', label: 'Visitantes', default: true },
        { id: 'carts', label: 'Carrinhos / taxa', default: true },
        { id: 'checkout', label: 'Checkouts / taxa', default: true },
        { id: 'sales', label: 'Vendas Shopify', default: true },
        { id: 'conversion', label: 'Conversão', default: true },
        { id: 'realConversion', label: 'Conversão real', default: true },
        { id: 'cpa', label: 'CPA real', default: true },
        { id: 'roas', label: 'ROAS real', default: false },
        { id: 'reading', label: 'Leitura', default: true },
    ],

    init() {
        const params = new URLSearchParams(window.location.search);
        this.previewRequested = params.get('diaryPreview') === '1';
        this.enabled = params.get('legacyDiary') !== '1';
        if (!this.enabled) return;

        const panel = document.getElementById('tab-diary');
        const main = document.getElementById('diary-main-sub');
        const filter = main?.querySelector('.filter-bar');
        if (!panel || !main || !filter) return;

        panel.classList.add('diary-preview-active');
        try { this.historyMode = localStorage.getItem('etracker_diary_history_view') || 'percent'; } catch (_) {}
        if (!['numbers', 'percent', 'both'].includes(this.historyMode)) this.historyMode = 'percent';
        this.historyColumns = this._loadHistoryColumns();
        this._buildShell(main, filter);
        this._renderHistoryColumnsMenu();
        this._bind();

        setTimeout(() => {
            this.refresh();
            if (this.previewRequested) {
                document.querySelector('.sidebar-link[data-tab="diary"]')?.click();
                const requestedView = params.get('view');
                this.setView(['overview', 'history', 'tests', 'funnel', 'creatives', 'compare', 'calendar'].includes(requestedView) ? requestedView : 'overview');
            }
        }, 350);
    },

    _buildShell(main, filter) {
        const header = document.createElement('div');
        header.id = 'diary-workspace-preview';
        header.innerHTML = `
            <header class="dw-hero">
                <div class="dw-hero-copy">
                    <div class="dw-kicker"><span class="dw-live-dot"></span> Sala de performance <b>NOVO WORKSPACE</b></div>
                    <h2>O que mudou — e qual foi o efeito?</h2>
                    <p>Testes, alterações e funil reunidos numa leitura de causa e efeito.</p>
                    <div class="dw-freshness">
                        <span><i data-lucide="shopping-bag"></i> Shopify real</span>
                        <span><i data-lucide="megaphone"></i> Mídia paga</span>
                        <span><i data-lucide="flask-conical"></i> Laboratório conectado</span>
                    </div>
                </div>
                <div class="dw-hero-actions">
                    <button type="button" class="dw-btn dw-btn-quiet" data-dw-action="sync"><i data-lucide="refresh-cw"></i> Sincronizar</button>
                    <button type="button" class="dw-btn dw-btn-primary" data-dw-action="new"><i data-lucide="plus"></i> Nova entrada</button>
                    <div class="dw-tools-wrap">
                        <button type="button" class="dw-icon-btn" data-dw-action="tools" aria-label="Abrir ferramentas" title="Ferramentas"><i data-lucide="ellipsis"></i></button>
                        <div class="dw-tools-menu" id="dw-tools-menu">
                            <div class="dw-tools-title">Ferramentas do Diário</div>
                            <button data-proxy="btn-diary-thresholds"><i data-lucide="target"></i><span>Métricas alvo<small>Defina seus limites de decisão</small></span></button>
                            <button data-proxy="btn-diary-columns"><i data-lucide="columns-3"></i><span>Organizar colunas<small>Escolha o que aparece no histórico</small></span></button>
                            <button data-proxy="btn-diary-group-campaign"><i data-lucide="megaphone"></i><span>Agrupar campanhas<small>Leitura no formato do Meta Ads</small></span></button>
                            <button data-proxy="btn-diary-sync-scroll"><i data-lucide="move-horizontal"></i><span>Rolar tabelas juntas<small>Compare produtos lado a lado</small></span></button>
                            <div class="dw-tools-divider"></div>
                            <button data-proxy="btn-diary-dedup"><i data-lucide="layers"></i><span>Limpar duplicatas</span></button>
                            <button data-proxy="btn-diary-clear-ranges"><i data-lucide="calendar-x"></i><span>Limpar períodos agregados</span></button>
                        </div>
                    </div>
                </div>
            </header>
            <nav class="dw-nav" aria-label="Visões do Diário">
                <button class="active" data-dw-view="overview"><i data-lucide="gauge"></i> Visão geral</button>
                <button data-dw-view="history"><i data-lucide="history"></i> Histórico</button>
                <button data-dw-view="tests"><i data-lucide="flask-conical"></i> Testes <span id="dw-test-count">0</span></button>
                <button data-dw-view="funnel"><i data-lucide="filter"></i> Funil</button>
                <button data-dw-view="creatives"><i data-lucide="clapperboard"></i> Criativos</button>
                <button data-dw-view="compare"><i data-lucide="git-compare-arrows"></i> Comparar</button>
                <button data-dw-view="calendar"><i data-lucide="calendar-days"></i> Calendário</button>
            </nav>`;
        main.insertBefore(header, main.firstChild);

        const workspace = document.createElement('div');
        workspace.id = 'dw-overview';
        workspace.innerHTML = `
            <div class="dw-context-line">
                <div><span class="dw-context-label">Leitura atual</span><strong id="dw-context-title">Todos os produtos</strong></div>
                <div class="dw-source-status" id="dw-source-status"><span></span> Carregando dados…</div>
            </div>
            <section class="dw-kpi-grid" id="dw-kpis"></section>
            <section class="dw-main-grid">
                <article class="dw-card dw-test-card" id="dw-active-test"></article>
                <article class="dw-card dw-decision-card" id="dw-decision"></article>
            </section>
            <section class="dw-lower-grid">
                <article class="dw-card dw-timeline-card">
                    <div class="dw-card-head">
                        <div><span class="dw-eyebrow">LINHA DO TEMPO</span><h3>Alteração → comportamento</h3></div>
                        <span class="dw-muted" id="dw-timeline-range">Período atual</span>
                    </div>
                    <div class="dw-timeline" id="dw-timeline"></div>
                </article>
                <article class="dw-card dw-funnel-card">
                    <div class="dw-card-head">
                        <div><span class="dw-eyebrow">FUNIL REAL</span><h3>Onde o resultado mudou</h3></div>
                        <span class="dw-shopify-pill">Shopify + mídia</span>
                    </div>
                    <div class="dw-funnel" id="dw-funnel"></div>
                    <div class="dw-funnel-note" id="dw-funnel-note"></div>
                </article>
            </section>`;
        filter.insertAdjacentElement('afterend', workspace);
        workspace.insertAdjacentHTML('afterend', `
            <section id="dw-history-view" class="dw-history-view" style="display:none">
                <div class="dw-history-head">
                    <div>
                        <span class="dw-eyebrow" id="dw-history-eyebrow">HISTÓRICO DE PERFORMANCE</span>
                        <h3 id="dw-history-title">Cada alteração, com o resultado ao lado</h3>
                        <p id="dw-history-subtitle">Veja o que estava rodando e como as métricas reagiram em cada dia.</p>
                    </div>
                    <div class="dw-history-actions">
                        <div class="dw-history-mode" role="group" aria-label="Visualização do histórico">
                            <button type="button" data-history-mode="numbers">Números</button>
                            <button type="button" data-history-mode="percent"><i data-lucide="percent"></i> Funil</button>
                            <button type="button" data-history-mode="both">Ambos</button>
                        </div>
                        <div class="dw-history-columns-wrap">
                            <button type="button" class="dw-history-action" data-dw-action="history-columns"><i data-lucide="columns-3"></i> Colunas</button>
                            <div class="dw-history-columns-menu" id="dw-history-columns-menu"></div>
                        </div>
                        <button type="button" class="dw-history-action" data-dw-action="campaigns"><i data-lucide="megaphone"></i> Por campanha</button>
                    </div>
                </div>
                <div class="dw-history-summary" id="dw-history-summary"></div>
                <div class="dw-history-sticky-head" id="dw-history-sticky-head" aria-hidden="true"><div><table><thead></thead></table></div></div>
                <div class="dw-history-table-wrap">
                    <table class="dw-history-table">
                        <thead><tr>
                            <th>Dia / fase</th><th>Produto</th><th class="num hist-number hist-money" data-history-col="spend">Gasto</th><th class="num hist-number hist-funnel-count" data-history-col="visitors">Visitantes</th>
                            <th class="num hist-number hist-funnel-count" data-history-col="carts">Carrinhos</th><th class="num hist-number hist-funnel-count" data-history-col="checkout">Checkouts</th><th class="num hist-number hist-money hist-sales" data-history-col="sales">Vendas Shopify</th>
                            <th class="num hist-percent" data-history-col="carts">Pág. → Carrinho</th><th class="num hist-percent" data-history-col="checkout">Carrinho → Checkout</th><th class="num hist-conversion" data-history-col="conversion">Conversão</th><th class="num hist-real-conversion" data-history-col="realConversion">Conversão real</th>
                            <th class="num hist-combined" data-history-col="visitors">Visitantes</th><th class="num hist-combined" data-history-col="carts">Carrinhos</th><th class="num hist-combined" data-history-col="checkout">Checkouts</th><th class="num hist-combined" data-history-col="sales">Vendas</th>
                            <th class="num" data-history-col="cpa">CPA real</th><th class="num" data-history-col="roas">ROAS real</th><th data-history-col="reading">Leitura</th><th></th>
                        </tr></thead>
                        <tbody id="dw-history-body"></tbody>
                    </table>
                </div>
                <div class="dw-history-footer">
                    <div><i data-lucide="shield-check"></i><span>Dados da Shopify prevalecem sobre a atribuição da mídia.</span></div>
                    <button type="button" data-dw-action="full-table">Abrir tabela completa atual <i data-lucide="arrow-right"></i></button>
                </div>
            </section>`);
        filter.insertAdjacentHTML('beforebegin', '<div class="dw-filter-title"><div><span class="dw-eyebrow">ESCOPO DA ANÁLISE</span><strong>Filtre antes de decidir</strong></div><span>Todos os blocos abaixo acompanham estes filtros</span></div>');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _bind() {
        document.querySelectorAll('[data-dw-view]').forEach(btn => {
            btn.addEventListener('click', () => this.setView(btn.dataset.dwView));
        });
        document.querySelector('[data-dw-action="new"]')?.addEventListener('click', () => document.getElementById('btn-add-entry')?.click());
        document.querySelector('[data-dw-action="sync"]')?.addEventListener('click', () => document.getElementById('btn-diary-sync-shopify')?.click());
        document.querySelector('[data-dw-action="history-columns"]')?.addEventListener('click', event => {
            event.stopPropagation();
            document.getElementById('dw-history-columns-menu')?.classList.toggle('open');
        });
        document.querySelector('[data-dw-action="campaigns"]')?.addEventListener('click', () => document.getElementById('btn-diary-group-campaign')?.click());
        document.querySelector('[data-dw-action="full-table"]')?.addEventListener('click', () => this._toggleFullTable());
        document.querySelectorAll('[data-history-mode]').forEach(btn => btn.addEventListener('click', () => this._setHistoryMode(btn.dataset.historyMode)));
        document.querySelector('[data-dw-action="tools"]')?.addEventListener('click', (event) => {
            event.stopPropagation();
            document.getElementById('dw-tools-menu')?.classList.toggle('open');
        });
        document.querySelectorAll('#dw-tools-menu [data-proxy]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('dw-tools-menu')?.classList.remove('open');
                document.getElementById(btn.dataset.proxy)?.click();
            });
        });
        document.addEventListener('click', event => {
            if (!event.target.closest('.dw-tools-wrap')) document.getElementById('dw-tools-menu')?.classList.remove('open');
            if (!event.target.closest('.dw-history-columns-wrap')) document.getElementById('dw-history-columns-menu')?.classList.remove('open');
        });

        ['diary-platform-filter', 'diary-type-filter', 'diary-region-filter'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => setTimeout(() => this.refresh(), 40));
        });
        document.getElementById('diary-date-apply')?.addEventListener('click', () => setTimeout(() => this.refresh(), 80));
        document.getElementById('diary-product-menu')?.addEventListener('click', () => setTimeout(() => this.refresh(), 80));
        window.addEventListener('resize', () => this._syncHistoryStickyHeader());

        if (typeof EventBus !== 'undefined') {
            EventBus.on('dataLoaded', () => this.refresh());
            EventBus.on('diaryChanged', () => this.refresh());
            EventBus.on('labTestsChanged', () => this.refresh());
            EventBus.on('productsChanged', () => this.refresh());
        }
    },

    setView(view) {
        this.activeView = view;
        document.querySelectorAll('[data-dw-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.dwView === view));
        const overview = document.getElementById('dw-overview');
        const history = document.getElementById('dw-history-view');
        const list = document.getElementById('diary-notion-list');
        const chart = document.querySelector('#diary-main-sub > .diary-chart-section');
        const creatives = document.getElementById('diary-creatives-panel');
        const compare = document.getElementById('diary-compare-panel');

        if (view === 'calendar') {
            document.querySelector('.diary-subtab[data-subtab="calendar"]')?.click();
            return;
        }
        if (view === 'compare') {
            if (!DiaryModule._compareMode) document.getElementById('btn-diary-compare')?.click();
            if (overview) overview.style.display = 'none';
            if (history) history.style.display = 'none';
            if (chart) chart.style.display = 'none';
            return;
        }
        if (DiaryModule._compareMode) document.getElementById('btn-diary-compare-close')?.click();

        if (view === 'overview') {
            DiaryModule._activeView = 'all';
            DiaryModule.render();
            if (overview) overview.style.display = '';
            if (history) history.style.display = 'none';
            if (list) list.style.display = 'none';
            if (chart) chart.style.display = 'none';
            if (creatives) creatives.style.display = 'none';
            if (compare) compare.style.display = 'none';
        } else if (view === 'history' || view === 'tests') {
            DiaryModule._activeView = view === 'tests' ? 'tests' : 'all';
            DiaryModule.render();
            if (overview) overview.style.display = 'none';
            if (history) history.style.display = '';
            if (list) list.style.display = 'none';
            if (chart) chart.style.display = 'none';
            if (creatives) creatives.style.display = 'none';
            this._renderHistory(view === 'tests');
        } else if (view === 'funnel') {
            DiaryModule._activeView = 'all';
            DiaryModule.render();
            if (overview) overview.style.display = 'none';
            if (history) history.style.display = 'none';
            if (list) list.style.display = 'none';
            if (chart) chart.style.display = '';
            if (creatives) creatives.style.display = 'none';
        } else if (view === 'creatives') {
            DiaryModule._activeView = 'creatives';
            DiaryModule.render();
            if (overview) overview.style.display = 'none';
            if (history) history.style.display = 'none';
            if (list) list.style.display = 'none';
            if (chart) chart.style.display = 'none';
            if (creatives) creatives.style.display = '';
        }
        this.refresh();
    },

    refresh() {
        if (!this.enabled || !document.getElementById('dw-overview')) return;
        let entries = [];
        try { entries = DiaryModule.getFilteredEntries() || []; } catch (_) {}
        this.usingDemo = this.previewRequested && entries.length === 0;
        if (this.usingDemo) entries = this._demoEntries();
        const tests = this._getTests(entries);
        const selectedTest = this._selectTest(tests, entries);
        const metrics = this._aggregate(entries);
        const comparison = this._compareTest(selectedTest, entries);

        this._renderContext(entries, tests);
        this._renderKpis(metrics, comparison);
        this._renderTest(selectedTest, comparison);
        this._renderDecision(selectedTest, comparison);
        this._renderTimeline(selectedTest, entries, comparison);
        this._renderFunnel(metrics, comparison);
        this._renderHistory(this.activeView === 'tests', entries, selectedTest);
        document.getElementById('dw-test-count').textContent = String(tests.filter(t => t.status === 'ativo' || t.status === 'active').length || tests.length);
        if (typeof lucide !== 'undefined') lucide.createIcons();
        this._syncVisibility();
    },

    _syncVisibility() {
        const overview = document.getElementById('dw-overview');
        const history = document.getElementById('dw-history-view');
        const list = document.getElementById('diary-notion-list');
        const chart = document.querySelector('#diary-main-sub > .diary-chart-section');
        const creatives = document.getElementById('diary-creatives-panel');
        if (this.activeView === 'overview') {
            if (overview) overview.style.display = '';
            if (history) history.style.display = 'none';
            if (list) list.style.display = 'none';
            if (chart) chart.style.display = 'none';
            if (creatives) creatives.style.display = 'none';
        } else if (this.activeView === 'history' || this.activeView === 'tests') {
            if (overview) overview.style.display = 'none';
            if (history) history.style.display = '';
            if (list) list.style.display = 'none';
            if (chart) chart.style.display = 'none';
            if (creatives) creatives.style.display = 'none';
        } else if (this.activeView === 'funnel') {
            if (overview) overview.style.display = 'none';
            if (history) history.style.display = 'none';
            if (list) list.style.display = 'none';
            if (chart) chart.style.display = '';
            if (creatives) creatives.style.display = 'none';
        }
    },

    _renderContext(entries) {
        const selected = DiaryModule._getProductSelection?.();
        let title = 'Todos os produtos';
        if (selected?.size === 1) {
            const id = [...selected][0];
            title = id === '__STORE__' ? 'Teste de loja' : (window.getProductName?.(id) || 'Produto selecionado');
        } else if (selected?.size > 1) title = `${selected.size} produtos selecionados`;
        document.getElementById('dw-context-title').textContent = title;
        const source = document.getElementById('dw-source-status');
        source.className = `dw-source-status ${this.usingDemo ? 'demo' : 'live'}`;
        source.innerHTML = `<span></span>${this.usingDemo ? 'Dados de demonstração — não são salvos' : `${entries.length} registros atuais analisados`}`;
    },

    _renderKpis(m, comparison) {
        const cards = [
            { label: 'Gasto', value: this._money(m.budget), hint: `${m.days} dias com dados`, icon: 'wallet' },
            { label: 'Vendas Shopify', value: this._number(m.sales), hint: 'Fonte real da loja', icon: 'shopping-bag' },
            { label: 'Receita', value: this._money(m.revenue), hint: 'Receita do período', icon: 'badge-dollar-sign' },
            { label: 'CPA real', value: m.cpa ? this._money(m.cpa, false) : '—', hint: this._deltaHint(comparison?.deltas?.cpa, true), icon: 'crosshair' },
            { label: 'ROAS real', value: m.roas ? `${m.roas.toFixed(2)}x` : '—', hint: this._deltaHint(comparison?.deltas?.roas, false), icon: 'trending-up' },
            { label: 'Conv. da página', value: m.conversion ? `${m.conversion.toFixed(2)}%` : '—', hint: this._deltaHint(comparison?.deltas?.conversion, false), icon: 'mouse-pointer-click' },
        ];
        document.getElementById('dw-kpis').innerHTML = cards.map(card => {
            const cls = card.hint.includes('melhor') ? 'positive' : card.hint.includes('pior') ? 'negative' : '';
            return `<article class="dw-kpi"><div class="dw-kpi-icon"><i data-lucide="${card.icon}"></i></div><div><span>${card.label}</span><strong>${card.value}</strong><small class="${cls}">${card.hint}</small></div></article>`;
        }).join('');
    },

    _renderTest(test, comparison) {
        const root = document.getElementById('dw-active-test');
        if (!test) {
            root.innerHTML = `<div class="dw-empty-test"><div class="dw-empty-icon"><i data-lucide="flask-conical"></i></div><span class="dw-eyebrow">LABORATÓRIO</span><h3>Nenhum teste no escopo</h3><p>Crie um teste para relacionar uma alteração com CPA, ROAS e funil.</p><button class="dw-link-btn" data-open-lab>Abrir Laboratório <i data-lucide="arrow-right"></i></button></div>`;
            this._bindLabButton(root);
            return;
        }
        const product = test.productId ? (test.productName || window.getProductName?.(test.productId) || 'Produto') : 'Loja';
        const metric = this._metricName(test.expectedMetric || test.metric || 'roas');
        const progress = this._testProgress(test);
        const status = this._testStatus(test);
        root.innerHTML = `
            <div class="dw-card-head">
                <div><span class="dw-eyebrow">TESTE EM ANDAMENTO</span><h3>${this._esc(test.title || 'Teste de performance')}</h3></div>
                <span class="dw-status-pill ${status.key}"><span></span>${status.label}</span>
            </div>
            <div class="dw-test-product"><i data-lucide="package"></i><span><small>Produto</small><strong>${this._esc(product)}</strong></span></div>
            <p class="dw-hypothesis">${this._esc(test.hypothesis || test.notes || 'Acompanhar o efeito da alteração nas métricas principais.')}</p>
            <div class="dw-test-meta">
                <div><small>Métrica decisiva</small><strong>${metric}</strong></div>
                <div><small>Período</small><strong>${this._date(test.dateStart)} → ${this._date(test.dateEnd) || 'em aberto'}</strong></div>
                <div><small>Amostra</small><strong>${comparison?.during?.sales || 0} vendas</strong></div>
            </div>
            <div class="dw-progress-label"><span>Progresso do teste</span><strong>${progress}%</strong></div>
            <div class="dw-progress"><span style="width:${progress}%"></span></div>
            <div class="dw-test-actions"><button class="dw-link-btn" data-open-lab>Abrir no Laboratório <i data-lucide="arrow-up-right"></i></button><button class="dw-link-btn muted" data-new-note>Registrar observação</button></div>`;
        this._bindLabButton(root);
        root.querySelector('[data-new-note]')?.addEventListener('click', () => document.getElementById('btn-add-entry')?.click());
    },

    _renderDecision(test, c) {
        const root = document.getElementById('dw-decision');
        if (!test || !c?.hasBaseline) {
            root.innerHTML = `<span class="dw-eyebrow">LEITURA DO TESTE</span><div class="dw-signal-icon neutral"><i data-lucide="hourglass"></i></div><h3>Ainda sem comparação segura</h3><p>Precisamos de dados antes e durante o teste para separar sinal de ruído.</p><div class="dw-evidence-note"><i data-lucide="shield-check"></i> A ferramenta não declara um vencedor sem amostra comparável.</div>`;
            return;
        }
        const signal = this._signal(test, c);
        const deltaItems = [
            ['CPA real', c.deltas.cpa, true],
            ['ROAS real', c.deltas.roas, false],
            ['Conversão', c.deltas.conversion, false],
        ];
        root.innerHTML = `
            <div class="dw-card-head"><span class="dw-eyebrow">LEITURA DO TESTE</span><span class="dw-confidence">${signal.confidence}</span></div>
            <div class="dw-signal-icon ${signal.key}"><i data-lucide="${signal.icon}"></i></div>
            <h3>${signal.title}</h3><p>${signal.copy}</p>
            <div class="dw-delta-list">${deltaItems.map(([name, val, inverse]) => this._deltaRow(name, val, inverse)).join('')}</div>
            <div class="dw-evidence-note"><i data-lucide="info"></i> Comparação entre período-base e período do teste.</div>`;
    },

    _renderTimeline(test, entries, comparison) {
        const dates = entries.map(e => e.date).filter(Boolean).sort();
        const first = dates[0], last = dates[dates.length - 1];
        document.getElementById('dw-timeline-range').textContent = first && last ? `${this._date(first)} — ${this._date(last)}` : 'Período atual';
        const signal = test && comparison?.hasBaseline ? this._signal(test, comparison) : null;
        const events = [
            { type: 'base', icon: 'scan-line', title: 'Linha de base registrada', text: comparison?.hasBaseline ? `${comparison.before.sales} vendas antes da alteração` : 'Aguardando histórico anterior', date: test?.dateStart ? 'Antes de ' + this._date(test.dateStart) : 'Início' },
            { type: 'test', icon: 'flask-conical', title: test?.title || 'Teste de performance', text: test?.hypothesis || 'Alteração conectada ao Laboratório', date: this._date(test?.dateStart) || 'Sem data' },
            { type: 'data', icon: 'refresh-cw', title: 'Dados consolidados', text: `${entries.length} registros · Shopify e mídia`, date: last ? this._date(last) : 'Hoje' },
            { type: signal?.key || 'neutral', icon: signal?.icon || 'hourglass', title: signal?.title || 'Resultado em formação', text: signal?.copy || 'O teste continua acumulando evidências.', date: 'Agora' },
        ];
        document.getElementById('dw-timeline').innerHTML = events.map((event, index) => `<div class="dw-timeline-item ${event.type}"><div class="dw-timeline-marker"><i data-lucide="${event.icon}"></i></div><div><small>${event.date}</small><strong>${this._esc(event.title)}</strong><p>${this._esc(event.text)}</p></div>${index < events.length - 1 ? '<span class="dw-timeline-line"></span>' : ''}</div>`).join('');
    },

    _renderFunnel(m, comparison) {
        const steps = [
            { label: 'Visitantes', value: m.pageViews, rate: 100, color: '#7967ff' },
            { label: 'Carrinhos', value: m.atc, rate: m.pageViews ? m.atc / m.pageViews * 100 : 0, color: '#9b75ff' },
            { label: 'Checkouts', value: m.checkout, rate: m.atc ? m.checkout / m.atc * 100 : 0, color: '#baa1ff' },
            { label: 'Vendas reais', value: m.sales, rate: m.checkout ? m.sales / m.checkout * 100 : 0, color: '#cfff00' },
        ];
        document.getElementById('dw-funnel').innerHTML = steps.map((step, index) => `<div class="dw-funnel-step"><div class="dw-funnel-bar" style="--step-color:${step.color};--step-width:${Math.max(28, 100 - index * 18)}%"><span></span></div><div><span>${step.label}</span><strong>${this._number(step.value)}</strong><small>${index === 0 ? 'entrada do funil' : `${step.rate.toFixed(1).replace('.', ',')}% da etapa anterior`}</small></div></div>`).join('');
        const d = comparison?.deltas?.conversion;
        document.getElementById('dw-funnel-note').innerHTML = d == null
            ? '<i data-lucide="sparkles"></i><span>Selecione um produto com teste para comparar a eficiência do funil.</span>'
            : `<i data-lucide="${d >= 0 ? 'trending-up' : 'trending-down'}"></i><span>A conversão da página ficou <strong>${Math.abs(d).toFixed(1).replace('.', ',')}% ${d >= 0 ? 'melhor' : 'pior'}</strong> durante o teste.</span>`;
    },

    _renderHistory(testOnly = false, suppliedEntries = null, suppliedTest = null) {
        const body = document.getElementById('dw-history-body');
        if (!body) return;
        let entries = suppliedEntries;
        if (!entries) {
            try { entries = DiaryModule.getFilteredEntries() || []; } catch (_) { entries = []; }
            if (!entries.length) entries = this._demoEntries();
        }
        const tests = this._getTests(entries);
        const selectedTest = suppliedTest || this._selectTest(tests, entries);
        const visible = testOnly ? entries.filter(e => e.isTest || e.labTestId) : entries;
        const baselineEntries = selectedTest?.dateStart
            ? entries.filter(e => (!selectedTest.productId || e.productId === selectedTest.productId) && e.date < selectedTest.dateStart)
            : [];
        const baseline = this._aggregate(baselineEntries);
        const historyRoot = document.getElementById('dw-history-view');
        historyRoot.dataset.historyMode = this.historyMode;
        document.querySelectorAll('[data-history-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.historyMode === this.historyMode));
        const title = document.getElementById('dw-history-title');
        const subtitle = document.getElementById('dw-history-subtitle');
        const eyebrow = document.getElementById('dw-history-eyebrow');
        if (testOnly) {
            eyebrow.textContent = 'TESTES NO PERÍODO';
            title.textContent = 'O histórico do teste, dia por dia';
            subtitle.textContent = 'Acompanhe a evolução até haver amostra suficiente para decidir.';
        } else {
            eyebrow.textContent = 'HISTÓRICO DE PERFORMANCE';
            title.textContent = 'Cada alteração, com o resultado ao lado';
            subtitle.textContent = 'Veja o que estava rodando e como as métricas reagiram em cada dia.';
        }

        const testedDays = visible.filter(e => e.isTest || e.labTestId).length;
        const latest = visible.map(e => e.date).filter(Boolean).sort().pop();
        document.getElementById('dw-history-summary').innerHTML = `
            <div><span>Registros visíveis</span><strong>${visible.length}</strong><small>respeitando os filtros</small></div>
            <div><span>Dias sob teste</span><strong>${testedDays}</strong><small>conectados ao Laboratório</small></div>
            <div><span>Última atualização</span><strong>${this._date(latest) || '—'}</strong><small>${this.usingDemo ? 'demonstração local' : 'dados atuais'}</small></div>
            <div><span>Linha de base</span><strong>${baseline.sales || '—'}</strong><small>vendas antes do teste</small></div>`;

        body.innerHTML = visible.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((entry, index) => {
            const isTest = !!(entry.isTest || entry.labTestId);
            const product = entry.productId === 'preview-product' ? 'Sophia Bag — Black' : (window.getProductName?.(entry.productId) || 'Loja');
            const budget = this._usd(entry.budget, entry.budgetCurrency);
            const revenue = this._usd(entry.revenue, entry.revenueCurrency);
            const sales = Number(entry.sales || 0);
            const cpa = sales ? budget / sales : 0;
            const roas = budget ? revenue / budget : 0;
            const baselineCpa = baseline.cpa;
            const baselineRoas = baseline.roas;
            const cpaDelta = baselineCpa ? (cpa - baselineCpa) / baselineCpa * 100 : null;
            const roasDelta = baselineRoas ? (roas - baselineRoas) / baselineRoas * 100 : null;
            const score = (cpaDelta == null ? 0 : -cpaDelta) + (roasDelta == null ? 0 : roasDelta);
            const reading = !isTest ? { key: 'base', label: 'Linha de base', icon: 'minus' }
                : score > 12 ? { key: 'positive', label: 'Melhorou', icon: 'trending-up' }
                : score < -12 ? { key: 'negative', label: 'Piorou', icon: 'trending-down' }
                : { key: 'neutral', label: 'Estável', icon: 'minus' };
            const atcRate = entry.pageViews ? Number(entry.addToCart || 0) / Number(entry.pageViews) * 100 : 0;
            const checkoutRate = entry.addToCart ? Number(entry.checkout || 0) / Number(entry.addToCart) * 100 : 0;
            const mediaSales = Number(entry.fbSales != null ? entry.fbSales : entry.sales || 0);
            const mediaVisits = Number(entry.pageViews || entry.clicks || 0);
            const shopifyVisits = Number(entry.shopifyViews || entry.pageViews || 0);
            const convRate = mediaVisits ? mediaSales / mediaVisits * 100 : 0;
            const realConvRate = shopifyVisits ? sales / shopifyVisits * 100 : 0;
            const detailOpen = this.openHistoryRows.has(String(index));
            return `<tr class="dw-history-row ${isTest ? 'is-test' : 'is-base'}" data-history-row="${index}">
                <td><div class="dw-history-date"><strong>${this._date(entry.date)}</strong><span class="${isTest ? 'test' : 'base'}">${isTest ? '<i data-lucide="flask-conical"></i> Durante o teste' : 'Antes da alteração'}</span></div></td>
                <td><div class="dw-history-product"><span>${this._esc(product)}</span><small>${this._esc(entry.platform || 'Sem plataforma')} ${entry.region ? `· ${this._esc(entry.region)}` : ''}</small></div></td>
                <td class="num hist-number hist-money" data-history-col="spend">${this._money(budget, false)}</td><td class="num hist-number hist-funnel-count" data-history-col="visitors">${this._number(entry.pageViews)}</td>
                <td class="num hist-number hist-funnel-count" data-history-col="carts">${this._number(entry.addToCart)}</td><td class="num hist-number hist-funnel-count" data-history-col="checkout">${this._number(entry.checkout)}</td>
                <td class="num dw-real-sales hist-number hist-money hist-sales" data-history-col="sales"><strong>${this._number(sales)}</strong><small>Shopify</small></td>
                <td class="num hist-percent" data-history-col="carts"><strong class="${this._hc(atcRate, 'atcRate')}">${atcRate.toFixed(1).replace('.', ',')}%</strong><small>Pág. → ATC</small></td>
                <td class="num hist-percent" data-history-col="checkout"><strong class="${this._hc(checkoutRate, 'icRate')}">${checkoutRate.toFixed(1).replace('.', ',')}%</strong><small>ATC → IC</small></td>
                <td class="num hist-conversion" data-history-col="conversion"><strong class="${this._hc(convRate, 'convPage')}">${convRate.toFixed(2).replace('.', ',')}%</strong><small>Mídia</small></td>
                <td class="num hist-real-conversion" data-history-col="realConversion"><strong class="${this._hc(realConvRate, 'convPage')}">${realConvRate.toFixed(2).replace('.', ',')}%</strong><small>Shopify</small></td>
                <td class="num hist-combined" data-history-col="visitors"><div class="dw-stage-combined"><strong>${this._number(entry.pageViews)}</strong><small>entrada</small></div></td>
                <td class="num hist-combined" data-history-col="carts"><div class="dw-stage-combined"><strong>${this._number(entry.addToCart)}</strong><small>${atcRate.toFixed(1).replace('.', ',')}%</small></div></td>
                <td class="num hist-combined" data-history-col="checkout"><div class="dw-stage-combined"><strong>${this._number(entry.checkout)}</strong><small>${checkoutRate.toFixed(1).replace('.', ',')}%</small></div></td>
                <td class="num hist-combined" data-history-col="sales"><div class="dw-stage-combined sales"><strong>${this._number(sales)}</strong><small>Shopify</small></div></td>
                <td class="num" data-history-col="cpa"><strong>${cpa ? this._money(cpa, false) : '—'}</strong>${cpaDelta != null && isTest ? `<small class="${cpaDelta <= 0 ? 'positive' : 'negative'}">${cpaDelta >= 0 ? '+' : ''}${cpaDelta.toFixed(1).replace('.', ',')}%</small>` : ''}</td>
                <td class="num" data-history-col="roas"><strong>${roas ? roas.toFixed(2) + 'x' : '—'}</strong>${roasDelta != null && isTest ? `<small class="${roasDelta >= 0 ? 'positive' : 'negative'}">${roasDelta >= 0 ? '+' : ''}${roasDelta.toFixed(1).replace('.', ',')}%</small>` : ''}</td>
                <td data-history-col="reading"><span class="dw-reading ${reading.key}"><i data-lucide="${reading.icon}"></i>${reading.label}</span></td>
                <td><button class="dw-row-toggle${detailOpen ? ' open' : ''}" aria-label="Ver detalhes" data-history-toggle="${index}"><i data-lucide="chevron-down"></i></button></td>
            </tr>
            <tr class="dw-history-detail" data-history-detail="${index}"${detailOpen ? '' : ' style="display:none"'}><td colspan="19"><div>
                <span><small>Visitante → carrinho</small><strong>${atcRate.toFixed(1).replace('.', ',')}%</strong></span>
                <span><small>Carrinho → checkout</small><strong>${checkoutRate.toFixed(1).replace('.', ',')}%</strong></span>
                <span><small>Conversão da mídia</small><strong>${convRate.toFixed(2).replace('.', ',')}%</strong></span>
                <span><small>Conversão real Shopify</small><strong>${realConvRate.toFixed(2).replace('.', ',')}%</strong></span>
                <span class="dw-detail-note"><small>O que estava rodando</small><strong>${isTest ? this._esc(selectedTest?.title || entry.testGoal || 'Teste do Laboratório') : 'Período usado como referência'}</strong></span>
            </div></td></tr>`;
        }).join('') || `<tr><td colspan="19"><div class="dw-history-empty"><i data-lucide="search-x"></i><strong>Nenhum registro neste recorte</strong><span>Altere os filtros ou amplie o período.</span></div></td></tr>`;

        body.querySelectorAll('[data-history-toggle]').forEach(btn => btn.addEventListener('click', event => {
            event.stopPropagation();
            const detail = body.querySelector(`[data-history-detail="${btn.dataset.historyToggle}"]`);
            const open = detail.style.display === 'none';
            if (open) this.openHistoryRows.add(String(btn.dataset.historyToggle));
            else this.openHistoryRows.delete(String(btn.dataset.historyToggle));
            detail.style.display = open ? '' : 'none';
            btn.classList.toggle('open', open);
        }));
        this._applyHistoryColumnVisibility();
        if (typeof lucide !== 'undefined') lucide.createIcons();
        requestAnimationFrame(() => this._syncHistoryStickyHeader());
    },

    _loadHistoryColumns() {
        const defaults = Object.fromEntries(this.historyColumnDefs.map(column => [column.id, column.default]));
        try {
            const saved = JSON.parse(localStorage.getItem(this.historyColumnsKey) || '{}');
            return { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
        } catch (_) { return defaults; }
    },

    _saveHistoryColumns() {
        try { localStorage.setItem(this.historyColumnsKey, JSON.stringify(this.historyColumns)); } catch (_) {}
    },

    _renderHistoryColumnsMenu() {
        const menu = document.getElementById('dw-history-columns-menu');
        if (!menu) return;
        menu.innerHTML = `<div class="dw-columns-title"><span>Colunas do Histórico</span><small>Data e produto ficam sempre visíveis</small></div>
            <div class="dw-columns-list">${this.historyColumnDefs.map(column => `<label><input type="checkbox" data-history-column-choice="${column.id}" ${this.historyColumns[column.id] ? 'checked' : ''}><span>${column.label}</span>${column.id === 'roas' ? '<small>Oculto no padrão</small>' : ''}</label>`).join('')}</div>
            <button type="button" class="dw-columns-reset" data-history-columns-reset><i data-lucide="rotate-ccw"></i> Restaurar padrão</button>`;
        menu.querySelectorAll('[data-history-column-choice]').forEach(input => input.addEventListener('change', () => {
            this.historyColumns[input.dataset.historyColumnChoice] = input.checked;
            this._saveHistoryColumns();
            this._applyHistoryColumnVisibility();
            this._syncHistoryStickyHeader();
        }));
        menu.querySelector('[data-history-columns-reset]')?.addEventListener('click', () => {
            this.historyColumns = Object.fromEntries(this.historyColumnDefs.map(column => [column.id, column.default]));
            this._saveHistoryColumns();
            this._renderHistoryColumnsMenu();
            this._applyHistoryColumnVisibility();
            this._syncHistoryStickyHeader();
            document.getElementById('dw-history-columns-menu')?.classList.add('open');
            if (typeof lucide !== 'undefined') lucide.createIcons();
        });
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _applyHistoryColumnVisibility() {
        document.querySelectorAll('#dw-history-view [data-history-col]').forEach(cell => {
            cell.classList.toggle('dw-col-user-hidden', this.historyColumns[cell.dataset.historyCol] === false);
        });
    },

    _syncHistoryStickyHeader() {
        const host = document.getElementById('dw-history-sticky-head');
        const wrapper = document.querySelector('#dw-history-view .dw-history-table-wrap');
        const sourceTable = document.querySelector('#dw-history-view .dw-history-table');
        const sourceHead = sourceTable?.querySelector('thead');
        const targetTable = host?.querySelector('table');
        const targetHead = targetTable?.querySelector('thead');
        if (!host || !wrapper || !sourceTable || !sourceHead || !targetTable || !targetHead) return;

        targetHead.innerHTML = sourceHead.innerHTML;
        const sourceCells = [...sourceHead.querySelectorAll('th')];
        const targetCells = [...targetHead.querySelectorAll('th')];
        targetTable.style.width = `${sourceTable.scrollWidth}px`;
        sourceCells.forEach((cell, index) => {
            const width = cell.getBoundingClientRect().width;
            if (!targetCells[index]) return;
            targetCells[index].style.width = `${width}px`;
            targetCells[index].style.minWidth = `${width}px`;
            targetCells[index].style.maxWidth = `${width}px`;
        });
        host.style.width = `${wrapper.clientWidth}px`;
        const syncScroll = () => { targetTable.style.transform = `translateX(${-wrapper.scrollLeft}px)`; };
        wrapper.onscroll = syncScroll;
        syncScroll();
    },

    _setHistoryMode(mode) {
        if (!['numbers', 'percent', 'both'].includes(mode)) return;
        this.historyMode = mode;
        try { localStorage.setItem('etracker_diary_history_view', mode); } catch (_) {}
        this._renderHistory(this.activeView === 'tests');
    },

    _toggleFullTable() {
        const history = document.getElementById('dw-history-view');
        const list = document.getElementById('diary-notion-list');
        if (!history || !list) return;
        const showingLegacy = history.style.display === 'none';
        history.style.display = showingLegacy ? '' : 'none';
        list.style.display = showingLegacy ? 'none' : '';
        if (!showingLegacy && this.usingDemo) {
            history.style.display = '';
            list.style.display = 'none';
            if (typeof showToast === 'function') showToast('A tabela completa usa seus dados reais. Nesta prévia local, mostramos o histórico demonstrativo.', 'info');
        }
    },

    _getTests(entries) {
        const actual = Array.isArray(window.LabTestsModule?._tests) ? LabTestsModule._tests.filter(t => t.status !== 'cancelado') : [];
        if (actual.length) return actual;
        const diaryTests = entries.filter(e => e.isTest);
        if (diaryTests.length && !this.usingDemo) {
            const map = new Map();
            diaryTests.forEach(e => {
                const id = e.labTestId || e.id;
                if (!map.has(id)) map.set(id, { id, productId: e.productId, title: (e.notes || '').replace('[Teste do Pipeline]', '').trim(), hypothesis: e.notes, dateStart: e.date, dateEnd: e.testEndDate, expectedMetric: this._goalToMetric(e.testGoal), status: e.testValidation === 'pendente' ? 'ativo' : 'concluido', result: e.testValidation });
                const t = map.get(id); if (e.date < t.dateStart) t.dateStart = e.date;
            });
            return [...map.values()];
        }
        return this.previewRequested ? [this._demoTest()] : [];
    },

    _selectTest(tests, entries) {
        const productIds = new Set(entries.map(e => e.productId).filter(Boolean));
        return tests.filter(t => !t.productId || productIds.has(t.productId)).sort((a, b) => {
            const activeA = ['ativo', 'active', 'em_andamento'].includes(a.status) ? 1 : 0;
            const activeB = ['ativo', 'active', 'em_andamento'].includes(b.status) ? 1 : 0;
            return activeB - activeA || String(b.dateStart || '').localeCompare(String(a.dateStart || ''));
        })[0] || tests[0] || null;
    },

    _compareTest(test, allEntries) {
        if (!test?.dateStart) return null;
        const duringEntries = allEntries.filter(e => (!test.productId || e.productId === test.productId) && e.date >= test.dateStart && (!test.dateEnd || e.date <= test.dateEnd));
        const start = new Date(test.dateStart + 'T00:00:00');
        const end = new Date((test.dateEnd || allEntries.map(e => e.date).sort().pop() || test.dateStart) + 'T00:00:00');
        const duration = Math.max(1, Math.round((end - start) / 86400000) + 1);
        const beforeEnd = new Date(start); beforeEnd.setDate(beforeEnd.getDate() - 1);
        const beforeStart = new Date(beforeEnd); beforeStart.setDate(beforeStart.getDate() - duration + 1);
        const beforeStartIso = beforeStart.toISOString().slice(0, 10);
        const beforeEndIso = beforeEnd.toISOString().slice(0, 10);
        const beforeEntries = allEntries.filter(e => (!test.productId || e.productId === test.productId) && e.date >= beforeStartIso && e.date <= beforeEndIso);
        const before = this._aggregate(beforeEntries);
        const during = this._aggregate(duringEntries);
        const delta = (current, prior) => prior > 0 ? (current - prior) / prior * 100 : null;
        return { before, during, hasBaseline: beforeEntries.length > 0 && duringEntries.length > 0, deltas: { cpa: delta(during.cpa, before.cpa), roas: delta(during.roas, before.roas), conversion: delta(during.conversion, before.conversion), sales: delta(during.sales, before.sales) } };
    },

    _aggregate(entries) {
        let budget = 0, revenue = 0, sales = 0, pageViews = 0, atc = 0, checkout = 0;
        const days = new Set();
        entries.forEach(e => {
            budget += this._usd(e.budget, e.budgetCurrency);
            revenue += this._usd(e.revenue, e.revenueCurrency);
            sales += Number(e.sales || 0);
            pageViews += Number(e.pageViews || 0);
            atc += Number(e.addToCart || 0);
            checkout += Number(e.checkout || 0);
            if (e.date) days.add(e.date);
        });
        return { budget, revenue, sales, pageViews, atc, checkout, days: days.size, cpa: sales ? budget / sales : 0, roas: budget ? revenue / budget : 0, conversion: pageViews ? sales / pageViews * 100 : 0 };
    },

    _signal(test, comparison) {
        const metric = this._goalToMetric(test.expectedMetric || test.metric || test.testGoal);
        const inverse = metric === 'cpa' || metric === 'cpc';
        const delta = metric === 'conversion' ? comparison.deltas.conversion : comparison.deltas[metric] ?? comparison.deltas.roas;
        const evidence = comparison.during.sales >= 10 ? 'Boa amostra' : comparison.during.sales >= 4 ? 'Amostra parcial' : 'Amostra baixa';
        if (delta == null || Math.abs(delta) < 8) return { key: 'neutral', icon: 'minus', title: 'Sinal ainda inconclusivo', copy: 'A métrica decisiva ainda não se afastou o suficiente da linha de base.', confidence: evidence };
        const improved = inverse ? delta < 0 : delta > 0;
        return improved
            ? { key: 'positive', icon: 'trending-up', title: 'A alteração mostra efeito positivo', copy: `${this._metricName(metric)} melhorou ${Math.abs(delta).toFixed(1).replace('.', ',')}% contra o período-base.`, confidence: evidence }
            : { key: 'negative', icon: 'trending-down', title: 'A alteração mostra efeito negativo', copy: `${this._metricName(metric)} piorou ${Math.abs(delta).toFixed(1).replace('.', ',')}% contra o período-base.`, confidence: evidence };
    },

    _deltaRow(label, value, inverse) {
        if (value == null) return `<div><span>${label}</span><strong class="neutral">Sem base</strong></div>`;
        const good = inverse ? value < 0 : value > 0;
        return `<div><span>${label}</span><strong class="${good ? 'positive' : value === 0 ? 'neutral' : 'negative'}"><i data-lucide="${value >= 0 ? 'arrow-up-right' : 'arrow-down-right'}"></i>${value >= 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}%</strong></div>`;
    },

    _deltaHint(value, inverse) {
        if (value == null) return 'Sem período-base';
        const good = inverse ? value < 0 : value > 0;
        return `${value >= 0 ? '+' : ''}${value.toFixed(1).replace('.', ',')}% · ${good ? 'melhor' : 'pior'} no teste`;
    },

    _bindLabButton(root) {
        root.querySelector('[data-open-lab]')?.addEventListener('click', () => document.querySelector('.sidebar-link[data-tab="laboratorio"], .tab-btn[data-tab="laboratorio"]')?.click());
    },

    _testProgress(test) {
        if (!test.dateStart) return 0;
        const start = new Date(test.dateStart + 'T00:00:00');
        const end = new Date((test.dateEnd || new Date().toISOString().slice(0, 10)) + 'T00:00:00');
        const now = new Date();
        const full = Math.max(1, end - start);
        return Math.max(8, Math.min(100, Math.round((Math.min(now, end) - start) / full * 100)));
    },

    _testStatus(test) {
        if (test.status === 'concluido') return { key: 'done', label: 'Concluído' };
        if (test.status === 'pausado') return { key: 'paused', label: 'Pausado' };
        return { key: 'active', label: 'Rodando' };
    },

    _goalToMetric(value) {
        const text = String(value || '').toLowerCase();
        if (text.includes('cpa')) return 'cpa';
        if (text.includes('cpc')) return 'cpc';
        if (text.includes('conv')) return 'conversion';
        if (text.includes('venda')) return 'sales';
        return 'roas';
    },

    _metricName(metric) {
        return ({ cpa: 'CPA real', cpc: 'CPC', roas: 'ROAS real', conversion: 'Conversão da página', sales: 'Vendas' })[this._goalToMetric(metric)] || 'ROAS real';
    },

    _usd(value, currency) {
        return typeof convertToUSD === 'function' ? convertToUSD(Number(value || 0), currency || 'USD') : Number(value || 0);
    },

    _money(value, dual = true) {
        if (dual && typeof formatDualCurrency === 'function') return formatDualCurrency(Number(value || 0), 'USD');
        if (typeof formatCurrency === 'function') return formatCurrency(Number(value || 0), 'USD');
        return '$ ' + Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    _number(value) { return Math.round(Number(value || 0)).toLocaleString('pt-BR'); },
    // Classe de saúde por etapa do funil (verde/amarelo/vermelho) reaproveitando
    // as "Métricas Alvo" já configuráveis do DiaryModule — o motor de limiares
    // sempre existiu; o cockpit novo só não estava chamando. inverse=true para
    // métricas onde menor é melhor (CPA/CPC/CPM).
    _hc(value, metricKey, inverse = false) {
        if (typeof DiaryModule === 'undefined') return '';
        const fn = inverse ? DiaryModule._metricClassInverse : DiaryModule._metricClass;
        try { return fn ? fn.call(DiaryModule, Number(value) || 0, metricKey) : ''; } catch { return ''; }
    },
    _date(value) { if (!value) return ''; const p = String(value).slice(0, 10).split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : value; },
    _esc(value) { const div = document.createElement('div'); div.textContent = value || ''; return div.innerHTML; },

    _demoTest() {
        return { id: 'preview-test', productId: 'preview-product', productName: 'Sophia Bag — Black', title: 'Nova página + sequência de fotos', hypothesis: 'Uma galeria mais clara deve reduzir dúvida e aumentar a conversão sem elevar o CPA.', dateStart: '2026-08-07', dateEnd: '2026-08-16', expectedMetric: 'roas', status: 'ativo' };
    },

    _demoEntries() {
        const rows = [
            ['2026-08-01', 188, 31, 17, 6, 168, 392], ['2026-08-02', 201, 34, 19, 7, 181, 441],
            ['2026-08-03', 176, 27, 15, 5, 154, 332], ['2026-08-04', 214, 39, 21, 7, 190, 457],
            ['2026-08-05', 198, 35, 18, 6, 177, 396], ['2026-08-06', 223, 41, 22, 7, 201, 466],
            ['2026-08-07', 245, 47, 27, 9, 214, 612], ['2026-08-08', 268, 53, 31, 11, 229, 748],
            ['2026-08-09', 279, 57, 34, 12, 238, 816], ['2026-08-10', 261, 54, 32, 11, 226, 752],
            ['2026-08-11', 292, 62, 38, 14, 247, 948], ['2026-08-12', 305, 66, 40, 15, 255, 1022],
            ['2026-08-13', 318, 70, 43, 16, 264, 1088],
        ];
        return rows.map(([date, pageViews, addToCart, checkout, sales, budget, revenue], index) => ({ id: `preview-${date}`, productId: 'preview-product', date, pageViews, shopifyViews: Math.round(pageViews * .96), addToCart, checkout, sales, fbSales: Math.max(0, sales - (index % 3 === 0 ? 1 : 0)), budget, revenue, budgetCurrency: 'USD', revenueCurrency: 'USD', platform: 'Meta Ads', region: 'US', isTest: date >= '2026-08-07', labTestId: date >= '2026-08-07' ? 'preview-test' : '', testGoal: 'ROAS', testEndDate: '2026-08-16' }));
    },
};

window.DiaryWorkspacePreview = DiaryWorkspacePreview;
document.addEventListener('DOMContentLoaded', () => DiaryWorkspacePreview.init());
