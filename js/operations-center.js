/* ================================================================
   Central de execução — visão integrada sem substituir os módulos.
   Lê as mesmas fontes de Pipeline, Laboratório, Projetos e Aprovações.
   ================================================================ */
const OperationsCenter = (() => {
    const rootId = 'operations-center-root';
    const stageLabels = {
        ideia: 'Ideia', validacao: 'Validação', pesquisa: 'Pesquisa', angulos: 'Ângulos',
        criativos: 'Criativos', pagina: 'Página', teste_ads: 'Teste', otimizacao: 'Otimização',
        escala: 'Escala', kill: 'Kill'
    };

    function esc(value) {
        const el = document.createElement('span');
        el.textContent = value == null ? '' : String(value);
        return el.innerHTML;
    }

    function currentStoreName() {
        const storeId = typeof AppState !== 'undefined' ? AppState.currentStoreId : '';
        const store = typeof AppState !== 'undefined' ? (AppState.stores || []).find(item => item.id === storeId) : null;
        return store?.name || document.querySelector('#store-selector option:checked')?.textContent?.trim() || 'Todas as lojas';
    }

    function pipelineCards() {
        if (typeof PipelineModule !== 'undefined' && Array.isArray(PipelineModule.cards)) return PipelineModule.cards;
        try {
            const raw = JSON.parse(localStorage.getItem('pipeline_cards') || '{}');
            return Array.isArray(raw) ? raw : (Array.isArray(raw.cards) ? raw.cards : []);
        } catch { return []; }
    }

    function projects() {
        return typeof AppState !== 'undefined' && Array.isArray(AppState.projects) ? AppState.projects : [];
    }

    function tests() {
        return typeof LabTestsModule !== 'undefined' && Array.isArray(LabTestsModule._tests) ? LabTestsModule._tests : [];
    }

    function approvals() {
        const badge = document.getElementById('pending-count-badge');
        const count = Number.parseInt(badge?.textContent || '0', 10);
        return Number.isFinite(count) ? count : 0;
    }

    function dueItems() {
        try {
            if (typeof NotificationsModule !== 'undefined' && typeof NotificationsModule._buildItems === 'function') {
                return NotificationsModule._buildItems().slice(0, 5);
            }
        } catch {}
        return [];
    }

    function dateLabel(date) {
        if (!date) return '';
        const parsed = new Date(`${date}T12:00:00`);
        if (Number.isNaN(parsed.getTime())) return date;
        return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(parsed).replace('.', '');
    }

    function operationalData() {
        const cards = pipelineCards();
        const liveCards = cards.filter(card => card.columnId !== 'kill');
        const activeTests = tests().filter(test => test.status === 'ativo');
        const activeProjects = projects().filter(project => project.status === 'ativo');
        const queue = dueItems();
        const urgent = queue.filter(item => Number(item.diffDays) <= 0).length;
        const stages = Object.keys(stageLabels).map(id => ({
            id,
            label: stageLabels[id],
            count: cards.filter(card => card.columnId === id).length
        }));
        return { cards, liveCards, activeTests, activeProjects, queue, urgent, stages, approvals: approvals() };
    }

    function statusTone(data) {
        if (data.urgent > 0) return { tone: 'danger', icon: 'circle-alert', label: `${data.urgent} ${data.urgent === 1 ? 'prazo exige' : 'prazos exigem'} atenção` };
        if (data.queue.length > 0) return { tone: 'warning', icon: 'clock-3', label: `${data.queue.length} próximos compromissos` };
        return { tone: 'ok', icon: 'circle-check', label: 'Operação em dia' };
    }

    function metricCard(icon, label, value, detail, tab, tone = '') {
        return `<button type="button" class="ops-metric-card ${tone}" data-ops-tab="${tab}">
            <span class="ops-metric-icon"><i data-lucide="${icon}"></i></span>
            <span class="ops-metric-copy"><small>${label}</small><strong>${value}</strong><em>${detail}</em></span>
            <i data-lucide="arrow-up-right" class="ops-card-arrow"></i>
        </button>`;
    }

    function renderQueue(items) {
        if (!items.length) {
            return `<div class="ops-empty-state">
                <span><i data-lucide="sparkles"></i></span>
                <div><strong>Nenhum prazo pendente</strong><p>Quando metas, testes ou etapas receberem uma data, elas aparecem aqui.</p></div>
            </div>`;
        }
        return items.map(item => {
            const diff = Number(item.diffDays);
            const timing = diff < 0 ? `${Math.abs(diff)}d atrasado` : diff === 0 ? 'Hoje' : diff === 1 ? 'Amanhã' : `Em ${diff}d`;
            return `<button type="button" class="ops-queue-item ${diff < 0 ? 'overdue' : diff === 0 ? 'today' : ''}" data-ops-tab="${esc(item.tab)}">
                <span class="ops-queue-date"><strong>${dateLabel(item.date)}</strong><small>${timing}</small></span>
                <span class="ops-queue-copy"><strong>${esc(item.title)}</strong><small>${esc(item.subtitle)}</small></span>
                <i data-lucide="chevron-right"></i>
            </button>`;
        }).join('');
    }

    function render() {
        const root = document.getElementById(rootId);
        if (!root) return;
        const data = operationalData();
        const status = statusTone(data);
        const teamCount = typeof TeamModule !== 'undefined' && typeof TeamModule.getMembers === 'function' ? TeamModule.getMembers().length + 1 : 1;
        const syncState = window.CloudBackup?.state;
        const syncLabel = typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn
            ? (syncState?.syncing ? 'Sincronizando agora' : syncState?.error ? 'Sincronização requer atenção' : 'Conta e dados protegidos')
            : 'Entre para sincronizar dispositivos';

        root.innerHTML = `
            <section class="ops-hero">
                <div class="ops-hero-copy">
                    <span class="ops-eyebrow"><i data-lucide="command"></i> Central de execução</span>
                    <h1>O que precisa<br><em>andar hoje.</em></h1>
                    <p>Pipeline, testes, projetos e responsáveis reunidos para decidir e executar sem trocar de contexto.</p>
                    <div class="ops-hero-actions">
                        <button type="button" class="btn btn-primary" data-ops-action="new-project">Criar projeto <i data-lucide="arrow-right"></i></button>
                        <button type="button" class="btn btn-secondary" data-ops-action="new-test"><i data-lucide="flask-conical"></i> Novo teste</button>
                    </div>
                </div>
                <div class="ops-pulse-panel">
                    <div class="ops-pulse-head"><span>Pulso da operação</span><small>${esc(currentStoreName())}</small></div>
                    <div class="ops-pulse-status ${status.tone}"><i data-lucide="${status.icon}"></i><strong>${status.label}</strong></div>
                    <div class="ops-pulse-grid">
                        <span><strong>${data.liveCards.length}</strong><small>itens em fluxo</small></span>
                        <span><strong>${data.activeTests.length}</strong><small>testes ativos</small></span>
                        <span><strong>${data.activeProjects.length}</strong><small>projetos ativos</small></span>
                    </div>
                    <div class="ops-sync-line"><i data-lucide="cloud-check"></i><span>${syncLabel}</span></div>
                </div>
            </section>

            <section class="ops-metrics" aria-label="Resumo operacional">
                ${metricCard('kanban', 'No pipeline', data.liveCards.length, 'produtos e iniciativas', 'pipeline')}
                ${metricCard('flask-conical', 'Testes rodando', data.activeTests.length, 'hipóteses em validação', 'laboratorio', 'violet')}
                ${metricCard('clipboard-check', 'Projetos ativos', data.activeProjects.length, 'entregas coordenadas', 'projects', 'blue')}
                ${metricCard('inbox', 'Para aprovar', data.approvals, 'envios da equipe criativa', 'creatives', data.approvals ? 'warning' : '')}
            </section>

            <div class="ops-main-grid">
                <section class="ops-card ops-priority-card">
                    <header><div><span class="ops-section-kicker">Fila de prioridade</span><h2>Próximos compromissos</h2></div><button type="button" class="ops-text-button" data-ops-tab="dashboard">Ver visão geral <i data-lucide="arrow-right"></i></button></header>
                    <div class="ops-queue">${renderQueue(data.queue)}</div>
                </section>

                <section class="ops-card ops-flow-card">
                    <header><div><span class="ops-section-kicker">Fluxo de produto</span><h2>Distribuição por etapa</h2></div><button type="button" class="ops-icon-button" data-ops-tab="pipeline" aria-label="Abrir pipeline"><i data-lucide="arrow-up-right"></i></button></header>
                    <div class="ops-stage-list">
                        ${data.stages.map((stage, index) => `<button type="button" data-ops-tab="pipeline" class="ops-stage ${stage.count ? 'has-items' : ''}">
                            <span>${String(index + 1).padStart(2, '0')}</span><strong>${stage.label}</strong><em>${stage.count}</em>
                        </button>`).join('')}
                    </div>
                </section>
            </div>

            <section class="ops-connected">
                <header><div><span class="ops-section-kicker">Uma operação, módulos conectados</span><h2>Continue de onde o trabalho acontece</h2></div></header>
                <div class="ops-connected-grid">
                    <button type="button" data-ops-tab="mineracao"><i data-lucide="pickaxe"></i><span><strong>Descobrir</strong><small>Mineração de oportunidades</small></span><i data-lucide="chevron-right"></i></button>
                    <button type="button" data-ops-tab="importador"><i data-lucide="package-plus"></i><span><strong>Preparar</strong><small>Importação e publicação</small></span><i data-lucide="chevron-right"></i></button>
                    <button type="button" data-ops-action="team"><i data-lucide="users"></i><span><strong>Delegar</strong><small>${teamCount} ${teamCount === 1 ? 'pessoa com acesso' : 'pessoas com acesso'}</small></span><i data-lucide="chevron-right"></i></button>
                    <button type="button" data-ops-tab="captures"><i data-lucide="cloud-download"></i><span><strong>Conferir</strong><small>Capturas e evidências</small></span><i data-lucide="chevron-right"></i></button>
                    <button type="button" data-ops-tab="reconciliation"><i data-lucide="scale"></i><span><strong>Fechar</strong><small>Conciliação financeira</small></span><i data-lucide="chevron-right"></i></button>
                </div>
            </section>`;

        root.querySelectorAll('[data-ops-tab]').forEach(button => button.addEventListener('click', () => go(button.dataset.opsTab)));
        root.querySelector('[data-ops-action="new-project"]')?.addEventListener('click', () => goAndClick('projects', '#btn-add-project'));
        root.querySelector('[data-ops-action="new-test"]')?.addEventListener('click', () => goAndClick('laboratorio', '#btn-add-lab-test'));
        root.querySelector('[data-ops-action="team"]')?.addEventListener('click', () => {
            if (typeof TeamModule !== 'undefined') TeamModule.openPanel?.();
        });
        if (typeof lucide !== 'undefined') try { lucide.createIcons({ nodes: [root] }); } catch {}
    }

    function go(tab) {
        if (typeof UXShell !== 'undefined' && typeof UXShell.navigate === 'function') UXShell.navigate(tab);
        else document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
    }

    function goAndClick(tab, selector) {
        go(tab);
        window.setTimeout(() => document.querySelector(selector)?.click(), 60);
    }

    function init() {
        const renderEvents = ['dataLoaded', 'storeChanged', 'pipelineChanged', 'labTestsChanged', 'projectsChanged'];
        if (typeof EventBus !== 'undefined') {
            renderEvents.forEach(event => EventBus.on(event, render));
            EventBus.on('tabChanged', tab => { if (tab === 'operations') render(); });
        }
        render();
        window.setTimeout(render, 500);
        window.setTimeout(render, 1800);
    }

    return { init, render };
})();

if (document.readyState !== 'loading') OperationsCenter.init();
else document.addEventListener('DOMContentLoaded', () => OperationsCenter.init());
