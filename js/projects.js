/* ===========================
   Projects Module — Planejamento & Projetos
   =========================== */

const ProjectsModule = {

    init() {
        EventBus.on('dataLoaded', () => this.render());
        EventBus.on('storeChanged', () => this.render());

        document.getElementById('btn-add-project')?.addEventListener('click', () => this.openModal());
        document.getElementById('btn-save-project')?.addEventListener('click', () => {
            const form = document.getElementById('form-project');
            if (form) {
                const fd = new FormData(form);
                const data = {};
                fd.forEach((v, k) => { data[k] = v; });
                this.save(data);
            }
        });

        this.render();
    },

    render() {
        const list = document.getElementById('projects-list');
        const stats = document.getElementById('projects-stats');
        if (!list) return;

        const projects = AppState.projects || [];

        // Stats
        if (stats) {
            const total = projects.length;
            const ativos = projects.filter(p => p.status === 'ativo').length;
            const pausados = projects.filter(p => p.status === 'pausado').length;
            const concluidos = projects.filter(p => p.status === 'concluido').length;
            const totalTasks = projects.reduce((acc, p) => acc + (p.tasks || []).length, 0);
            const doneTasks = projects.reduce((acc, p) => acc + (p.tasks || []).filter(t => t.done).length, 0);
            stats.innerHTML = `
                <div class="proj-stat"><span class="proj-stat-val">${total}</span><span class="proj-stat-lbl">Total</span></div>
                <div class="proj-stat"><span class="proj-stat-val" style="color:#059669">${ativos}</span><span class="proj-stat-lbl">Ativos</span></div>
                <div class="proj-stat"><span class="proj-stat-val" style="color:#d97706">${pausados}</span><span class="proj-stat-lbl">Pausados</span></div>
                <div class="proj-stat"><span class="proj-stat-val" style="color:#2563eb">${concluidos}</span><span class="proj-stat-lbl">Concluídos</span></div>
                ${totalTasks > 0 ? `<div class="proj-stat"><span class="proj-stat-val">${doneTasks}/${totalTasks}</span><span class="proj-stat-lbl">Tarefas</span></div>` : ''}
            `;
        }

        if (!projects.length) {
            list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:3rem 0">Nenhum projeto. Clique em "+ Novo Projeto" para começar.</p>';
            return;
        }

        list.innerHTML = projects.map(p => this._renderCard(p)).join('');

        // Bind events
        list.querySelectorAll('.proj-card-header').forEach(hdr => {
            hdr.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                this.toggleCard(hdr.dataset.id);
            });
        });
        list.querySelectorAll('.btn-proj-edit').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.openModal(btn.dataset.id); });
        });
        list.querySelectorAll('.btn-proj-delete').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); if (confirm('Excluir projeto?')) this.deleteProject(btn.dataset.id); });
        });
        list.querySelectorAll('.proj-task-check').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                this.toggleTask(cb.dataset.proj, cb.dataset.task, cb.dataset.sub || null);
            });
        });
        list.querySelectorAll('.btn-add-task').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.addTask(btn.dataset.proj); });
        });
        list.querySelectorAll('.btn-add-subtask').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.addSubtask(btn.dataset.proj, btn.dataset.task); });
        });
        list.querySelectorAll('.btn-del-task').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteTask(btn.dataset.proj, btn.dataset.task); });
        });
        list.querySelectorAll('.btn-save-note').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const ta = document.getElementById('note-ta-' + btn.dataset.proj);
                if (ta && ta.value.trim()) {
                    this.addNote(btn.dataset.proj, ta.value.trim());
                    ta.value = '';
                }
            });
        });
        list.querySelectorAll('.btn-del-note').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteNote(btn.dataset.proj, btn.dataset.note); });
        });
    },

    _typeIcon(type) {
        return { loja: '🏪', saas: '🤖', estudo: '📚', financeiro: '💰', outro: '📦' }[type] || '📦';
    },

    _statusBadge(status) {
        const map = {
            ativo:     ['Ativo',      '#059669', '#d1fae5'],
            pausado:   ['Pausado',    '#d97706', '#fef3c7'],
            concluido: ['Concluído',  '#2563eb', '#dbeafe'],
        };
        const [label, color, bg] = map[status] || map.ativo;
        return `<span class="proj-status-badge" style="color:${color};background:${bg}">${label}</span>`;
    },

    _priorityStyle(priority) {
        return { alta: 'color:#dc2626', media: 'color:#d97706', baixa: 'color:#9ca3af' }[priority] || '';
    },

    _renderCard(p) {
        const tasks = p.tasks || [];
        const doneTasks = tasks.filter(t => t.done).length;
        const totalTasks = tasks.length;
        const notes = [...(p.notes || [])].reverse();
        const isOpen = this._openCards && this._openCards.has(p.id);
        const goalStr = p.goalAmount ? `${p.goalCurrency === 'USD' ? 'U$' : 'R$'}${Number(p.goalAmount).toLocaleString('pt-BR')}/${p.goalPeriod || 'mês'} ${p.goalLabel || ''}` : '';

        const budgetBar = (p.validationBudget > 0) ? (() => {
            const pct = Math.min(100, Math.round((p.validationSpent || 0) / p.validationBudget * 100));
            const spentFmt = `${p.validationBudgetCurrency === 'USD' ? 'U$' : 'R$'}${Number(p.validationSpent || 0).toLocaleString('pt-BR')}`;
            const totalFmt = `${p.validationBudgetCurrency === 'USD' ? 'U$' : 'R$'}${Number(p.validationBudget).toLocaleString('pt-BR')}`;
            return `<div class="proj-budget-wrap">
                <div class="proj-budget-label">Budget validação: ${spentFmt} / ${totalFmt} (${pct}%)</div>
                <div class="proj-budget-bar"><div class="proj-budget-fill" style="width:${pct}%;background:${pct >= 100 ? '#dc2626' : '#059669'}"></div></div>
            </div>`;
        })() : '';

        const tasksHtml = tasks.map(task => {
            const subitems = (task.subitems || []).map(sub => `
                <div class="proj-subtask-item">
                    <input type="checkbox" class="proj-task-check" data-proj="${p.id}" data-task="${task.id}" data-sub="${sub.id}" ${sub.done ? 'checked' : ''}>
                    <span class="${sub.done ? 'proj-done' : ''}">${this._esc(sub.text)}</span>
                </div>`).join('');
            return `<div class="proj-task-item">
                <div class="proj-task-row">
                    <input type="checkbox" class="proj-task-check" data-proj="${p.id}" data-task="${task.id}" ${task.done ? 'checked' : ''}>
                    <span class="${task.done ? 'proj-done' : ''}" style="flex:1">${this._esc(task.text)}</span>
                    <span class="proj-priority-dot" style="${this._priorityStyle(task.priority)}" title="${task.priority || ''}">●</span>
                    <button class="btn-add-subtask proj-icon-btn" data-proj="${p.id}" data-task="${task.id}" title="+ Sub-tarefa">+sub</button>
                    <button class="btn-del-task proj-icon-btn proj-del-btn" data-proj="${p.id}" data-task="${task.id}" title="Excluir tarefa">×</button>
                </div>
                ${subitems ? `<div class="proj-subtask-list">${subitems}</div>` : ''}
            </div>`;
        }).join('');

        const notesHtml = notes.map(n => `
            <div class="proj-note-entry">
                <span class="proj-note-date">${n.date || ''}</span>
                <span class="proj-note-text" style="flex:1">${this._esc(n.text)}</span>
                <button class="btn-del-note proj-icon-btn proj-del-btn" data-proj="${p.id}" data-note="${n.id}" title="Excluir nota">×</button>
            </div>`).join('');

        return `
        <div class="proj-card" id="projcard-${p.id}">
            <div class="proj-card-header" data-id="${p.id}">
                <span class="proj-type-icon">${this._typeIcon(p.type)}</span>
                <div class="proj-card-header-info">
                    <span class="proj-card-name">${this._esc(p.name)}</span>
                    <div class="proj-card-meta-row">
                        ${this._statusBadge(p.status)}
                        ${totalTasks > 0 ? `<span class="proj-task-count">${doneTasks}/${totalTasks} tarefas</span>` : ''}
                        ${goalStr ? `<span class="proj-goal-tag">🎯 ${goalStr}</span>` : ''}
                    </div>
                </div>
                <div class="proj-card-actions">
                    <button class="btn-proj-edit proj-icon-btn" data-id="${p.id}" title="Editar">✏️</button>
                    <button class="btn-proj-delete proj-icon-btn proj-del-btn" data-id="${p.id}" title="Excluir">🗑️</button>
                    <span class="proj-toggle-arrow">${isOpen ? '▲' : '▼'}</span>
                </div>
            </div>
            <div class="proj-card-body" id="projbody-${p.id}" style="display:${isOpen ? '' : 'none'}">
                ${p.description ? `<p class="proj-description">${this._esc(p.description)}</p>` : ''}
                ${budgetBar}
                ${(p.startDate || p.targetDate) ? `<div class="proj-dates">
                    ${p.startDate ? `<span>📅 Início: ${p.startDate}</span>` : ''}
                    ${p.targetDate ? `<span>🏁 Prazo: ${p.targetDate}</span>` : ''}
                </div>` : ''}
                <div class="proj-tasks-section">
                    <div class="proj-section-label">Tarefas</div>
                    ${tasksHtml || '<p style="color:var(--text-muted);font-size:0.8rem">Nenhuma tarefa.</p>'}
                    <button class="btn-add-task btn btn-secondary btn-sm" data-proj="${p.id}" style="margin-top:0.5rem">+ Nova tarefa</button>
                </div>
                <div class="proj-notes-section">
                    <div class="proj-section-label">Notas</div>
                    ${notesHtml || '<p style="color:var(--text-muted);font-size:0.8rem">Nenhuma nota.</p>'}
                    <div class="proj-add-note-row" style="margin-top:0.5rem">
                        <textarea id="note-ta-${p.id}" class="input" rows="2" placeholder="Escreva uma nota..."></textarea>
                        <button class="btn-save-note btn btn-secondary btn-sm" data-proj="${p.id}">Salvar Nota</button>
                    </div>
                </div>
            </div>
        </div>`;
    },

    openModal(id = null) {
        const modal = document.getElementById('modal-project');
        if (!modal) return;

        const title = document.getElementById('modal-project-title');
        if (title) title.textContent = id ? 'Editar Projeto' : 'Novo Projeto';

        const form = document.getElementById('form-project');
        if (!form) return;
        form.reset();
        form.dataset.editId = id || '';

        if (id) {
            const p = (AppState.allProjects || []).find(x => x.id === id);
            if (p) {
                const set = (name, val) => { const el = form.elements[name]; if (el) el.value = val ?? ''; };
                set('name', p.name);
                set('type', p.type);
                set('status', p.status);
                set('description', p.description);
                set('goalAmount', p.goalAmount);
                set('goalCurrency', p.goalCurrency || 'BRL');
                set('goalPeriod', p.goalPeriod || 'mes');
                set('goalLabel', p.goalLabel || 'lucro líquido');
                set('validationBudget', p.validationBudget);
                set('validationBudgetCurrency', p.validationBudgetCurrency || 'BRL');
                set('validationSpent', p.validationSpent);
                set('startDate', p.startDate);
                set('targetDate', p.targetDate);
            }
        }

        modal.classList.remove('hidden');
    },

    save(formData) {
        const name = (formData.name || '').trim();
        if (!name) { showToast('Preencha o nome do projeto', 'error'); return; }

        const form = document.getElementById('form-project');
        const editId = form?.dataset.editId || '';

        const now = new Date().toISOString();
        if (!AppState.allProjects) AppState.allProjects = [];

        if (editId) {
            const idx = AppState.allProjects.findIndex(p => p.id === editId);
            if (idx >= 0) {
                AppState.allProjects[idx] = {
                    ...AppState.allProjects[idx],
                    name,
                    type: formData.type || 'outro',
                    status: formData.status || 'ativo',
                    description: formData.description || '',
                    goalAmount: parseFloat(formData.goalAmount) || 0,
                    goalCurrency: formData.goalCurrency || 'BRL',
                    goalPeriod: formData.goalPeriod || 'mes',
                    goalLabel: formData.goalLabel || 'lucro líquido',
                    validationBudget: parseFloat(formData.validationBudget) || 0,
                    validationBudgetCurrency: formData.validationBudgetCurrency || 'BRL',
                    validationSpent: parseFloat(formData.validationSpent) || 0,
                    startDate: formData.startDate || '',
                    targetDate: formData.targetDate || '',
                    updatedAt: now,
                };
                showToast('Projeto atualizado!', 'success');
            }
        } else {
            const proj = {
                id: this._genId('proj'),
                storeId: getCurrentStoreId(),
                name,
                type: formData.type || 'outro',
                status: formData.status || 'ativo',
                description: formData.description || '',
                goalAmount: parseFloat(formData.goalAmount) || 0,
                goalCurrency: formData.goalCurrency || 'BRL',
                goalPeriod: formData.goalPeriod || 'mes',
                goalLabel: formData.goalLabel || 'lucro líquido',
                validationBudget: parseFloat(formData.validationBudget) || 0,
                validationBudgetCurrency: formData.validationBudgetCurrency || 'BRL',
                validationSpent: 0,
                startDate: formData.startDate || '',
                targetDate: formData.targetDate || '',
                tasks: [],
                notes: [],
                createdAt: now,
                updatedAt: now,
            };
            AppState.allProjects.unshift(proj);
            showToast('Projeto criado!', 'success');
        }

        EventBus.emit('projectsChanged');
        closeModal('modal-project');

        // Re-filter and re-render
        const storeId = AppState.currentStoreId;
        AppState.projects = storeId === STORE_ALL_ID
            ? [...AppState.allProjects]
            : AppState.allProjects.filter(p => p.storeId === storeId);
        this.render();
    },

    deleteProject(id) {
        AppState.allProjects = (AppState.allProjects || []).filter(p => p.id !== id);
        EventBus.emit('projectsChanged');
        const storeId = AppState.currentStoreId;
        AppState.projects = storeId === STORE_ALL_ID
            ? [...AppState.allProjects]
            : AppState.allProjects.filter(p => p.storeId === storeId);
        this.render();
        showToast('Projeto excluído', 'success');
    },

    toggleTask(projectId, taskId, subtaskId = null) {
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        const task = (proj.tasks || []).find(t => t.id === taskId);
        if (!task) return;

        if (subtaskId) {
            const sub = (task.subitems || []).find(s => s.id === subtaskId);
            if (sub) sub.done = !sub.done;
        } else {
            task.done = !task.done;
        }

        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        // Re-render only the card to avoid losing textarea content
        const storeId = AppState.currentStoreId;
        AppState.projects = storeId === STORE_ALL_ID
            ? [...AppState.allProjects]
            : AppState.allProjects.filter(p => p.storeId === storeId);
        this._rerenderCard(projectId);
    },

    addTask(projectId) {
        const text = prompt('Nome da tarefa:');
        if (!text || !text.trim()) return;
        const priorityOpt = prompt('Prioridade (alta / media / baixa):', 'media') || 'media';
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        if (!proj.tasks) proj.tasks = [];
        proj.tasks.push({
            id: this._genId('task'),
            text: text.trim(),
            done: false,
            priority: ['alta','media','baixa'].includes(priorityOpt) ? priorityOpt : 'media',
            subitems: []
        });
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncProjects(projectId);
        this._rerenderCard(projectId);
    },

    addSubtask(projectId, taskId) {
        const text = prompt('Nome da sub-tarefa:');
        if (!text || !text.trim()) return;
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        const task = (proj.tasks || []).find(t => t.id === taskId);
        if (!task) return;
        if (!task.subitems) task.subitems = [];
        task.subitems.push({ id: this._genId('sub'), text: text.trim(), done: false });
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncProjects(projectId);
        this._rerenderCard(projectId);
    },

    deleteTask(projectId, taskId) {
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        proj.tasks = (proj.tasks || []).filter(t => t.id !== taskId);
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncProjects(projectId);
        this._rerenderCard(projectId);
    },

    addNote(projectId, text) {
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        if (!proj.notes) proj.notes = [];
        proj.notes.push({ id: this._genId('note'), date: new Date().toISOString().slice(0, 10), text });
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncProjects(projectId);
        this._rerenderCard(projectId);
        showToast('Nota salva!', 'success');
    },

    deleteNote(projectId, noteId) {
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        proj.notes = (proj.notes || []).filter(n => n.id !== noteId);
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncProjects(projectId);
        this._rerenderCard(projectId);
    },

    toggleCard(id) {
        if (!this._openCards) this._openCards = new Set();
        if (this._openCards.has(id)) {
            this._openCards.delete(id);
        } else {
            this._openCards.add(id);
        }
        const body = document.getElementById('projbody-' + id);
        const arrow = document.querySelector(`[data-id="${id}"] .proj-toggle-arrow`);
        if (body) body.style.display = this._openCards.has(id) ? '' : 'none';
        if (arrow) arrow.textContent = this._openCards.has(id) ? '▲' : '▼';
    },

    _syncProjects(projectId) {
        const storeId = AppState.currentStoreId;
        AppState.projects = storeId === STORE_ALL_ID
            ? [...AppState.allProjects]
            : AppState.allProjects.filter(p => p.storeId === storeId);
    },

    _rerenderCard(projectId) {
        const proj = (AppState.projects || []).find(p => p.id === projectId);
        const el = document.getElementById('projcard-' + projectId);
        if (!proj || !el) { this.render(); return; }
        const isOpen = this._openCards && this._openCards.has(projectId);
        el.outerHTML = this._renderCard(proj);
        // Re-bind events for this card via full re-render of the list
        this.render();
        // Re-open the card if it was open
        if (isOpen) {
            const body = document.getElementById('projbody-' + projectId);
            const arrow = document.querySelector(`[data-id="${projectId}"] .proj-toggle-arrow`);
            if (body) body.style.display = '';
            if (arrow) arrow.textContent = '▲';
        }
    },

    _openCards: null,

    _esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },

    _genId(prefix) {
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    }
};
