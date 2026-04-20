/* ===========================
   Projects Module — Planejamento & Projetos
   With tasks, subtasks, progress %, and history
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

    // ── Progress Calculation ──────────────────────────────────────
    _calcProgress(tasks) {
        if (!tasks || !tasks.length) return { done: 0, total: 0, pct: 0 };
        let total = 0, done = 0;
        tasks.forEach(t => {
            const subs = t.subitems || [];
            if (subs.length > 0) {
                // If task has subtasks, count subtasks only
                subs.forEach(s => { total++; if (s.done) done++; });
            } else {
                total++;
                if (t.done) done++;
            }
        });
        return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
    },

    _progressColor(pct) {
        if (pct >= 100) return '#059669';
        if (pct >= 60) return '#2563eb';
        if (pct >= 30) return '#d97706';
        return '#dc2626';
    },

    // ── Rendering ─────────────────────────────────────────────────

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

            let allDone = 0, allTotal = 0;
            projects.forEach(p => {
                const prog = this._calcProgress(p.tasks);
                allDone += prog.done;
                allTotal += prog.total;
            });
            const globalPct = allTotal > 0 ? Math.round((allDone / allTotal) * 100) : 0;

            stats.innerHTML = `
                <div class="proj-stat"><span class="proj-stat-val">${total}</span><span class="proj-stat-lbl">Total</span></div>
                <div class="proj-stat"><span class="proj-stat-val" style="color:#059669">${ativos}</span><span class="proj-stat-lbl">Ativos</span></div>
                <div class="proj-stat"><span class="proj-stat-val" style="color:#d97706">${pausados}</span><span class="proj-stat-lbl">Pausados</span></div>
                <div class="proj-stat"><span class="proj-stat-val" style="color:#2563eb">${concluidos}</span><span class="proj-stat-lbl">Concluídos</span></div>
                ${allTotal > 0 ? `<div class="proj-stat"><span class="proj-stat-val">${allDone}/${allTotal}</span><span class="proj-stat-lbl">Tarefas</span></div>` : ''}
                ${allTotal > 0 ? `<div class="proj-stat"><span class="proj-stat-val" style="color:${this._progressColor(globalPct)}">${globalPct}%</span><span class="proj-stat-lbl">Progresso</span></div>` : ''}
            `;
        }

        if (!projects.length) {
            list.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:3rem 0">Nenhum projeto. Clique em "+ Novo Projeto" para começar.</p>';
            return;
        }

        list.innerHTML = projects.map(p => this._renderCard(p)).join('');
        this._bindListEvents(list);
    },

    _bindListEvents(list) {
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
        // Inline add task
        list.querySelectorAll('.btn-add-task').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._showInlineTaskInput(btn.dataset.proj);
            });
        });
        list.querySelectorAll('.btn-confirm-add-task').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._confirmAddTask(btn.dataset.proj);
            });
        });
        list.querySelectorAll('.btn-cancel-add-task').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._cancelAddTask(btn.dataset.proj);
            });
        });
        list.querySelectorAll('.input-new-task').forEach(inp => {
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); this._confirmAddTask(inp.dataset.proj); }
                if (e.key === 'Escape') this._cancelAddTask(inp.dataset.proj);
            });
        });
        // Inline add subtask
        list.querySelectorAll('.btn-add-subtask').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._showInlineSubtaskInput(btn.dataset.proj, btn.dataset.task);
            });
        });
        list.querySelectorAll('.btn-confirm-add-subtask').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._confirmAddSubtask(btn.dataset.proj, btn.dataset.task);
            });
        });
        list.querySelectorAll('.btn-cancel-add-subtask').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._cancelAddSubtask(btn.dataset.proj, btn.dataset.task);
            });
        });
        list.querySelectorAll('.input-new-subtask').forEach(inp => {
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); this._confirmAddSubtask(inp.dataset.proj, inp.dataset.task); }
                if (e.key === 'Escape') this._cancelAddSubtask(inp.dataset.proj, inp.dataset.task);
            });
        });
        list.querySelectorAll('.btn-del-task').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteTask(btn.dataset.proj, btn.dataset.task); });
        });
        list.querySelectorAll('.btn-del-subtask').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteSubtask(btn.dataset.proj, btn.dataset.task, btn.dataset.sub); });
        });
        // Notes
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
        // History
        list.querySelectorAll('.btn-save-history').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const ta = document.getElementById('history-ta-' + btn.dataset.proj);
                if (ta && ta.value.trim()) {
                    this.addHistory(btn.dataset.proj, ta.value.trim());
                    ta.value = '';
                }
            });
        });
        list.querySelectorAll('.btn-del-history').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteHistory(btn.dataset.proj, btn.dataset.history); });
        });
    },

    _typeIcon(type) {
        return { loja: '<i data-lucide="store" style="width:14px;height:14px;vertical-align:-2px"></i>', saas: '<i data-lucide="bot" style="width:14px;height:14px;vertical-align:-2px"></i>', estudo: '<i data-lucide="book" style="width:14px;height:14px;vertical-align:-2px"></i>', financeiro: '<i data-lucide="dollar-sign" style="width:14px;height:14px;vertical-align:-2px"></i>', outro: '<i data-lucide="package" style="width:14px;height:14px;vertical-align:-2px"></i>' }[type] || '<i data-lucide="package" style="width:14px;height:14px;vertical-align:-2px"></i>';
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

    _priorityBadge(priority) {
        const map = {
            alta:  ['Alta',  '#dc2626', '#fecaca'],
            media: ['Média', '#d97706', '#fef3c7'],
            baixa: ['Baixa', '#9ca3af', '#f3f4f6'],
        };
        const [label, color, bg] = map[priority] || map.media;
        return `<span class="proj-priority-badge" style="color:${color};background:${bg}">${label}</span>`;
    },

    _renderCard(p) {
        const tasks = p.tasks || [];
        const progress = this._calcProgress(tasks);
        const notes = [...(p.notes || [])].reverse();
        const history = [...(p.history || [])].reverse();
        const isOpen = this._openCards && this._openCards.has(p.id);
        const goalStr = p.goalAmount ? `${currencySymbol(p.goalCurrency || 'BRL')}${Number(p.goalAmount).toLocaleString('pt-BR')}/${p.goalPeriod || 'mês'} ${p.goalLabel || ''}` : '';

        const budgetBar = (p.validationBudget > 0) ? (() => {
            const pct = Math.min(100, Math.round((p.validationSpent || 0) / p.validationBudget * 100));
            const sym = currencySymbol(p.validationBudgetCurrency || 'BRL');
            const spentFmt = `${sym}${Number(p.validationSpent || 0).toLocaleString('pt-BR')}`;
            const totalFmt = `${sym}${Number(p.validationBudget).toLocaleString('pt-BR')}`;
            return `<div class="proj-budget-wrap">
                <div class="proj-budget-label">Budget validação: ${spentFmt} / ${totalFmt} (${pct}%)</div>
                <div class="proj-budget-bar"><div class="proj-budget-fill" style="width:${pct}%;background:${pct >= 100 ? '#dc2626' : '#059669'}"></div></div>
            </div>`;
        })() : '';

        // Progress bar for header
        const progressBar = progress.total > 0 ? `
            <div class="proj-progress-wrap">
                <div class="proj-progress-bar">
                    <div class="proj-progress-fill" style="width:${progress.pct}%;background:${this._progressColor(progress.pct)}"></div>
                </div>
                <span class="proj-progress-label">${progress.pct}%</span>
            </div>` : '';

        // Tasks HTML
        const tasksHtml = tasks.map(task => {
            const subs = task.subitems || [];
            const subsDone = subs.filter(s => s.done).length;
            const subsTotal = subs.length;
            const subProgressTxt = subsTotal > 0 ? `<span class="proj-sub-progress">${subsDone}/${subsTotal}</span>` : '';

            const subitems = subs.map(sub => `
                <div class="proj-subtask-item">
                    <input type="checkbox" class="proj-task-check" data-proj="${p.id}" data-task="${task.id}" data-sub="${sub.id}" ${sub.done ? 'checked' : ''}>
                    <span class="${sub.done ? 'proj-done' : ''}" style="flex:1">${this._esc(sub.text)}</span>
                    <button class="btn-del-subtask proj-icon-btn proj-del-btn" data-proj="${p.id}" data-task="${task.id}" data-sub="${sub.id}" title="Excluir">×</button>
                </div>`).join('');

            return `<div class="proj-task-item">
                <div class="proj-task-row">
                    <input type="checkbox" class="proj-task-check" data-proj="${p.id}" data-task="${task.id}" ${task.done ? 'checked' : ''}>
                    <span class="${task.done ? 'proj-done' : ''}" style="flex:1">${this._esc(task.text)}</span>
                    ${subProgressTxt}
                    ${this._priorityBadge(task.priority)}
                    <button class="btn-add-subtask proj-icon-btn" data-proj="${p.id}" data-task="${task.id}" title="+ Sub-tarefa">+sub</button>
                    <button class="btn-del-task proj-icon-btn proj-del-btn" data-proj="${p.id}" data-task="${task.id}" title="Excluir tarefa">×</button>
                </div>
                ${subitems ? `<div class="proj-subtask-list">${subitems}</div>` : ''}
                <div class="proj-inline-subtask" id="inline-subtask-${p.id}-${task.id}" style="display:none">
                    <input type="text" class="input input-sm input-new-subtask" data-proj="${p.id}" data-task="${task.id}" placeholder="Nome da sub-tarefa..." style="flex:1">
                    <button class="btn btn-sm btn-primary btn-confirm-add-subtask" data-proj="${p.id}" data-task="${task.id}">+</button>
                    <button class="btn btn-sm btn-secondary btn-cancel-add-subtask" data-proj="${p.id}" data-task="${task.id}">×</button>
                </div>
            </div>`;
        }).join('');

        // Notes HTML
        const notesHtml = notes.map(n => `
            <div class="proj-note-entry">
                <span class="proj-note-date">${n.date || ''}</span>
                <span class="proj-note-text" style="flex:1">${this._esc(n.text)}</span>
                <button class="btn-del-note proj-icon-btn proj-del-btn" data-proj="${p.id}" data-note="${n.id}" title="Excluir nota">×</button>
            </div>`).join('');

        // History HTML (timeline)
        const historyHtml = history.map(h => {
            const icon = h.type === 'auto' ? '<i data-lucide="refresh-cw" style="width:14px;height:14px;vertical-align:-2px"></i>' : '<i data-lucide="file-text" style="width:14px;height:14px;vertical-align:-2px"></i>';
            return `<div class="proj-history-entry ${h.type === 'auto' ? 'proj-history-auto' : ''}">
                <span class="proj-history-icon">${icon}</span>
                <div class="proj-history-content">
                    <span class="proj-history-date">${this._formatDate(h.date)}</span>
                    <span class="proj-history-text">${this._esc(h.text)}</span>
                </div>
                ${h.type !== 'auto' ? `<button class="btn-del-history proj-icon-btn proj-del-btn" data-proj="${p.id}" data-history="${h.id}" title="Excluir">×</button>` : ''}
            </div>`;
        }).join('');

        return `
        <div class="proj-card" id="projcard-${p.id}">
            <div class="proj-card-header" data-id="${p.id}">
                <span class="proj-type-icon">${this._typeIcon(p.type)}</span>
                <div class="proj-card-header-info">
                    <span class="proj-card-name">${this._esc(p.name)}</span>
                    <div class="proj-card-meta-row">
                        ${this._statusBadge(p.status)}
                        ${progress.total > 0 ? `<span class="proj-task-count">${progress.done}/${progress.total} tarefas</span>` : ''}
                        ${goalStr ? `<span class="proj-goal-tag"><i data-lucide="target" style="width:14px;height:14px;vertical-align:-2px"></i> ${goalStr}</span>` : ''}
                    </div>
                    ${progressBar}
                </div>
                <div class="proj-card-actions">
                    <button class="btn-proj-edit proj-icon-btn" data-id="${p.id}" title="Editar"><i data-lucide="pencil" style="width:14px;height:14px;vertical-align:-2px"></i>️</button>
                    <button class="btn-proj-delete proj-icon-btn proj-del-btn" data-id="${p.id}" title="Excluir"><i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:-2px"></i>️</button>
                    <span class="proj-toggle-arrow">${isOpen ? '▲' : '▼'}</span>
                </div>
            </div>
            <div class="proj-card-body" id="projbody-${p.id}" style="display:${isOpen ? '' : 'none'}">
                ${p.description ? `<p class="proj-description">${this._esc(p.description)}</p>` : ''}
                ${budgetBar}
                ${(p.startDate || p.targetDate) ? `<div class="proj-dates">
                    ${p.startDate ? `<span><i data-lucide="calendar" style="width:14px;height:14px;vertical-align:-2px"></i> Início: ${p.startDate}</span>` : ''}
                    ${p.targetDate ? `<span><i data-lucide="flag" style="width:14px;height:14px;vertical-align:-2px"></i> Prazo: ${p.targetDate}</span>` : ''}
                </div>` : ''}

                <!-- Tasks Section -->
                <div class="proj-tasks-section">
                    <div class="proj-section-label">Tarefas ${progress.total > 0 ? `<span style="font-weight:400;color:${this._progressColor(progress.pct)}">(${progress.pct}% concluído)</span>` : ''}</div>
                    ${tasksHtml || '<p style="color:var(--text-muted);font-size:0.8rem">Nenhuma tarefa.</p>'}
                    <div class="proj-inline-task" id="inline-task-${p.id}" style="display:none">
                        <div class="proj-inline-task-row">
                            <input type="text" class="input input-sm input-new-task" data-proj="${p.id}" placeholder="Nome da tarefa...">
                            <select class="input input-sm proj-priority-select" id="new-task-priority-${p.id}">
                                <option value="media">Média</option>
                                <option value="alta">Alta</option>
                                <option value="baixa">Baixa</option>
                            </select>
                            <button class="btn btn-sm btn-primary btn-confirm-add-task" data-proj="${p.id}">Adicionar</button>
                            <button class="btn btn-sm btn-secondary btn-cancel-add-task" data-proj="${p.id}">Cancelar</button>
                        </div>
                    </div>
                    <button class="btn-add-task btn btn-secondary btn-sm" data-proj="${p.id}" style="margin-top:0.5rem">+ Nova tarefa</button>
                </div>

                <!-- Notes Section -->
                <div class="proj-notes-section">
                    <div class="proj-section-label">Notas</div>
                    ${notesHtml || '<p style="color:var(--text-muted);font-size:0.8rem">Nenhuma nota.</p>'}
                    <div class="proj-add-note-row" style="margin-top:0.5rem">
                        <textarea id="note-ta-${p.id}" class="input" rows="2" placeholder="Escreva uma nota..."></textarea>
                        <button class="btn-save-note btn btn-secondary btn-sm" data-proj="${p.id}">Salvar Nota</button>
                    </div>
                </div>

                <!-- History Section -->
                <div class="proj-history-section">
                    <div class="proj-section-label">Histórico</div>
                    ${historyHtml || '<p style="color:var(--text-muted);font-size:0.8rem">Nenhum registro.</p>'}
                    <div class="proj-add-history-row" style="margin-top:0.5rem">
                        <textarea id="history-ta-${p.id}" class="input" rows="2" placeholder="Registrar atualização, decisão, mudança..."></textarea>
                        <button class="btn-save-history btn btn-secondary btn-sm" data-proj="${p.id}">Registrar</button>
                    </div>
                </div>
            </div>
        </div>`;
    },

    _formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        } catch { return dateStr; }
    },

    // ── Inline Task/Subtask Inputs ────────────────────────────────

    _showInlineTaskInput(projId) {
        const el = document.getElementById('inline-task-' + projId);
        if (el) {
            el.style.display = '';
            const input = el.querySelector('.input-new-task');
            if (input) input.focus();
        }
    },

    _cancelAddTask(projId) {
        const el = document.getElementById('inline-task-' + projId);
        if (el) el.style.display = 'none';
    },

    _confirmAddTask(projId) {
        const el = document.getElementById('inline-task-' + projId);
        const input = el?.querySelector('.input-new-task');
        const prioritySelect = document.getElementById('new-task-priority-' + projId);
        const text = input?.value?.trim();
        if (!text) return;

        const priority = prioritySelect?.value || 'media';
        this.addTask(projId, text, priority);
    },

    _showInlineSubtaskInput(projId, taskId) {
        const el = document.getElementById(`inline-subtask-${projId}-${taskId}`);
        if (el) {
            el.style.display = 'flex';
            const input = el.querySelector('.input-new-subtask');
            if (input) input.focus();
        }
    },

    _cancelAddSubtask(projId, taskId) {
        const el = document.getElementById(`inline-subtask-${projId}-${taskId}`);
        if (el) el.style.display = 'none';
    },

    _confirmAddSubtask(projId, taskId) {
        const el = document.getElementById(`inline-subtask-${projId}-${taskId}`);
        const input = el?.querySelector('.input-new-subtask');
        const text = input?.value?.trim();
        if (!text) return;
        this.addSubtask(projId, taskId, text);
    },

    // ── Modal ─────────────────────────────────────────────────────

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
                const oldStatus = AppState.allProjects[idx].status;
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
                // Auto-log status change
                const newStatus = formData.status || 'ativo';
                if (oldStatus !== newStatus) {
                    this._addAutoHistory(AppState.allProjects[idx], `Status alterado: ${oldStatus} <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> ${newStatus}`);
                }
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
                history: [{ id: this._genId('hist'), date: now, text: 'Projeto criado', type: 'auto' }],
                createdAt: now,
                updatedAt: now,
            };
            AppState.allProjects.unshift(proj);
            showToast('Projeto criado!', 'success');
        }

        EventBus.emit('projectsChanged');
        closeModal('modal-project');
        this._syncAndRender();
    },

    deleteProject(id) {
        AppState.allProjects = (AppState.allProjects || []).filter(p => p.id !== id);
        EventBus.emit('projectsChanged');
        this._syncAndRender();
        showToast('Projeto excluído', 'success');
    },

    // ── Task Operations ───────────────────────────────────────────

    toggleTask(projectId, taskId, subtaskId = null) {
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        const task = (proj.tasks || []).find(t => t.id === taskId);
        if (!task) return;

        if (subtaskId) {
            const sub = (task.subitems || []).find(s => s.id === subtaskId);
            if (sub) {
                sub.done = !sub.done;
                this._addAutoHistory(proj, `Sub-tarefa "${sub.text}" ${sub.done ? 'concluída <i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i>' : 'reaberta'}`);
            }
        } else {
            task.done = !task.done;
            this._addAutoHistory(proj, `Tarefa "${task.text}" ${task.done ? 'concluída <i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i>' : 'reaberta'}`);
            // When parent task is done, mark all subtasks done
            if (task.done && task.subitems) {
                task.subitems.forEach(s => s.done = true);
            }
        }

        // Check if all tasks done → auto-conclude
        const progress = this._calcProgress(proj.tasks);
        if (progress.pct === 100 && proj.status === 'ativo') {
            this._addAutoHistory(proj, 'Todas as tarefas concluídas! Projeto 100% completo <i data-lucide="party-popper" style="width:14px;height:14px;vertical-align:-2px"></i>');
        }

        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projectId);
    },

    addTask(projId, text, priority) {
        const proj = (AppState.allProjects || []).find(p => p.id === projId);
        if (!proj) return;
        if (!proj.tasks) proj.tasks = [];
        proj.tasks.push({
            id: this._genId('task'),
            text,
            done: false,
            priority: ['alta','media','baixa'].includes(priority) ? priority : 'media',
            subitems: []
        });
        proj.updatedAt = new Date().toISOString();
        this._addAutoHistory(proj, `Tarefa adicionada: "${text}"`);
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projId);
    },

    addSubtask(projId, taskId, text) {
        const proj = (AppState.allProjects || []).find(p => p.id === projId);
        if (!proj) return;
        const task = (proj.tasks || []).find(t => t.id === taskId);
        if (!task) return;
        if (!task.subitems) task.subitems = [];
        task.subitems.push({ id: this._genId('sub'), text, done: false });
        proj.updatedAt = new Date().toISOString();
        this._addAutoHistory(proj, `Sub-tarefa "${text}" adicionada em "${task.text}"`);
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projId);
    },

    deleteTask(projId, taskId) {
        const proj = (AppState.allProjects || []).find(p => p.id === projId);
        if (!proj) return;
        const task = (proj.tasks || []).find(t => t.id === taskId);
        proj.tasks = (proj.tasks || []).filter(t => t.id !== taskId);
        proj.updatedAt = new Date().toISOString();
        if (task) this._addAutoHistory(proj, `Tarefa removida: "${task.text}"`);
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projId);
    },

    deleteSubtask(projId, taskId, subId) {
        const proj = (AppState.allProjects || []).find(p => p.id === projId);
        if (!proj) return;
        const task = (proj.tasks || []).find(t => t.id === taskId);
        if (!task) return;
        const sub = (task.subitems || []).find(s => s.id === subId);
        task.subitems = (task.subitems || []).filter(s => s.id !== subId);
        proj.updatedAt = new Date().toISOString();
        if (sub) this._addAutoHistory(proj, `Sub-tarefa removida: "${sub.text}"`);
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projId);
    },

    // ── Notes & History ───────────────────────────────────────────

    addNote(projectId, text) {
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        if (!proj.notes) proj.notes = [];
        proj.notes.push({ id: this._genId('note'), date: new Date().toISOString().slice(0, 10), text });
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projectId);
        showToast('Nota salva!', 'success');
    },

    deleteNote(projectId, noteId) {
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        proj.notes = (proj.notes || []).filter(n => n.id !== noteId);
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projectId);
    },

    addHistory(projectId, text) {
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        if (!proj.history) proj.history = [];
        proj.history.push({
            id: this._genId('hist'),
            date: new Date().toISOString(),
            text,
            type: 'manual'
        });
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projectId);
        showToast('Registro salvo!', 'success');
    },

    deleteHistory(projectId, histId) {
        const proj = (AppState.allProjects || []).find(p => p.id === projectId);
        if (!proj) return;
        proj.history = (proj.history || []).filter(h => h.id !== histId);
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projectId);
    },

    _addAutoHistory(proj, text) {
        if (!proj.history) proj.history = [];
        proj.history.push({
            id: this._genId('hist'),
            date: new Date().toISOString(),
            text,
            type: 'auto'
        });
    },

    // ── Card Toggle & Helpers ─────────────────────────────────────

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

    _syncAndRender() {
        const storeId = AppState.currentStoreId;
        AppState.projects = storeId === STORE_ALL_ID
            ? [...AppState.allProjects]
            : AppState.allProjects.filter(p => p.storeId === storeId);
        this.render();
    },

    _syncAndRerenderCard(projectId) {
        const storeId = AppState.currentStoreId;
        AppState.projects = storeId === STORE_ALL_ID
            ? [...AppState.allProjects]
            : AppState.allProjects.filter(p => p.storeId === storeId);
        // Ensure card stays open
        if (!this._openCards) this._openCards = new Set();
        this._openCards.add(projectId);
        this.render();
    },

    _openCards: null,

    _esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },

    _genId(prefix) {
        return prefix + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    }
};
