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

    // ── Number formatting (pt-BR) ─────────────────────────────────
    _fmtBR(n) {
        const num = Number(n) || 0;
        return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    _parseBR(str) {
        if (typeof str === 'number') return str;
        if (!str) return 0;
        const s = String(str).trim().replace(/\./g, '').replace(',', '.');
        const n = parseFloat(s);
        return isNaN(n) ? 0 : n;
    },
    // Live-format an input on input event (text input). Keeps cursor position roughly stable.
    _liveFormatInput(input) {
        const raw = String(input.value || '').replace(/[^\d,]/g, '');
        // Keep only the first comma
        const firstComma = raw.indexOf(',');
        let cleaned = firstComma === -1 ? raw : (raw.slice(0, firstComma + 1) + raw.slice(firstComma + 1).replace(/,/g, ''));
        // Cap decimals to 2
        if (cleaned.includes(',')) {
            const [intPart, decPart] = cleaned.split(',');
            cleaned = intPart + ',' + decPart.slice(0, 2);
        }
        // Format integer part with thousand separators
        const [intPart, decPart] = cleaned.split(',');
        const intDigits = intPart.replace(/^0+(?=\d)/, '');
        const intFormatted = intDigits ? Number(intDigits).toLocaleString('pt-BR') : '';
        const formatted = decPart !== undefined ? `${intFormatted || '0'},${decPart}` : intFormatted;
        if (input.value !== formatted) input.value = formatted;
    },
    _attachMoneyInput(input) {
        if (!input || input._moneyBound) return;
        input._moneyBound = true;
        input.addEventListener('input', () => this._liveFormatInput(input));
    },

    // ── Budget / Return line-item helpers ────────────────────────
    _ensureBudgetItems(p) {
        if (!p) return;
        if (!Array.isArray(p.budgetItems)) {
            // Migrate old single validationBudget into one item
            const legacy = Number(p.validationBudget) || 0;
            p.budgetItems = legacy > 0
                ? [{ id: this._genId('bud'), label: 'Budget', amount: legacy, months: 1 }]
                : [];
        }
        if (!Array.isArray(p.returnItems)) p.returnItems = [];
    },
    _sumItems(items) {
        return (items || []).reduce((s, it) => s + (Number(it.amount) || 0), 0);
    },

    // ── Date helpers (project / task scheduling) ──────────────────
    _today() {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    },
    _parseISODate(s) {
        if (!s) return null;
        // Accept YYYY-MM-DD or full ISO
        const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (!m) return null;
        return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    },
    _daysFromToday(dateStr) {
        const d = this._parseISODate(dateStr);
        if (!d) return null;
        const ms = d.getTime() - this._today().getTime();
        return Math.round(ms / (1000 * 60 * 60 * 24));
    },
    _formatRelDays(days) {
        if (days === null || isNaN(days)) return '';
        if (days === 0) return 'hoje';
        if (days === 1) return 'amanhã';
        if (days === -1) return 'ontem';
        if (days > 0) return `em ${days}d`;
        return `${Math.abs(days)}d atrás`;
    },
    // ── Note rendering: detect URLs / emails / passwords / codes ──
    _detectNoteActionables(text) {
        if (!text) return [];
        const found = [];
        const URL_RE = /(https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+)/gi;
        const EMAIL_RE = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
        const SECRET_RE = /\b(senha|password|pwd|pass|c[oó]digo|code|key|token|api[\s_-]?key|otp|pin|chave)\s*[:=]\s*([^\s,;]+)/gi;
        let m;
        while ((m = URL_RE.exec(text)) !== null) {
            const u = m[0];
            const display = u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
            found.push({ kind: 'url', value: u, display: display.slice(0, 50) + (display.length > 50 ? '…' : ''), idx: m.index });
        }
        while ((m = EMAIL_RE.exec(text)) !== null) {
            found.push({ kind: 'email', value: m[0], display: m[0], idx: m.index });
        }
        while ((m = SECRET_RE.exec(text)) !== null) {
            const label = m[1].toLowerCase();
            const val = m[2];
            const isPassword = /senha|password|pwd|pass|chave/.test(label);
            found.push({ kind: isPassword ? 'password' : 'code', label: m[1], value: val, idx: m.index });
        }
        // Sort by position
        found.sort((a, b) => a.idx - b.idx);
        return found;
    },

    _renderActionableChip(item, projId, noteId, chipIdx) {
        const valEsc = this._esc(item.value);
        const valData = encodeURIComponent(item.value);
        const id = `${projId}-${noteId}-${chipIdx}`;
        if (item.kind === 'url') {
            return `<span class="proj-note-chip proj-note-chip-url" title="${valEsc}">
                <i data-lucide="link" style="width:11px;height:11px"></i>
                <span class="proj-note-chip-text">${this._esc(item.display)}</span>
                <a class="proj-note-chip-btn" href="${valEsc}" target="_blank" rel="noopener" title="Abrir"><i data-lucide="external-link" style="width:11px;height:11px"></i></a>
                <button class="proj-note-chip-btn proj-note-copy" data-copy="${valData}" title="Copiar"><i data-lucide="copy" style="width:11px;height:11px"></i></button>
            </span>`;
        }
        if (item.kind === 'email') {
            return `<span class="proj-note-chip proj-note-chip-email" title="${valEsc}">
                <i data-lucide="mail" style="width:11px;height:11px"></i>
                <span class="proj-note-chip-text">${this._esc(item.display)}</span>
                <a class="proj-note-chip-btn" href="mailto:${valEsc}" title="Enviar email"><i data-lucide="external-link" style="width:11px;height:11px"></i></a>
                <button class="proj-note-chip-btn proj-note-copy" data-copy="${valData}" title="Copiar"><i data-lucide="copy" style="width:11px;height:11px"></i></button>
            </span>`;
        }
        // password / code
        const isPwd = item.kind === 'password';
        return `<span class="proj-note-chip ${isPwd ? 'proj-note-chip-pwd' : 'proj-note-chip-code'}" data-id="${id}">
            <i data-lucide="${isPwd ? 'lock' : 'hash'}" style="width:11px;height:11px"></i>
            <span class="proj-note-chip-label">${this._esc(item.label)}:</span>
            <span class="proj-note-chip-text proj-note-secret ${isPwd ? 'proj-note-secret-hidden' : ''}" data-val="${valEsc}">${isPwd ? '••••••' : this._esc(item.value)}</span>
            ${isPwd ? `<button class="proj-note-chip-btn proj-note-reveal" data-id="${id}" title="Mostrar/ocultar"><i data-lucide="eye" style="width:11px;height:11px"></i></button>` : ''}
            <button class="proj-note-chip-btn proj-note-copy" data-copy="${valData}" title="Copiar"><i data-lucide="copy" style="width:11px;height:11px"></i></button>
        </span>`;
    },

    _renderNoteSummary(text) {
        if (!text) return '';
        const oneLine = text.split(/\r?\n/)[0] || '';
        const trimmed = oneLine.length > 100 ? oneLine.slice(0, 100) + '…' : oneLine;
        return this._esc(trimmed);
    },

    _nextScheduledTask(p) {
        const tasks = p.tasks || [];
        let best = null;
        for (const t of tasks) {
            if (t.done) continue;
            if (!t.dueDate) continue;
            if (!best || t.dueDate < best.dueDate) best = t;
        }
        return best;
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
        list.querySelectorAll('.btn-toggle-timing').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleTaskTiming(btn.dataset.proj, btn.dataset.task); });
        });
        // Task due-date inline edit
        list.querySelectorAll('.proj-task-due-input').forEach(inp => {
            inp.addEventListener('click', (e) => e.stopPropagation());
            inp.addEventListener('change', (e) => {
                e.stopPropagation();
                this.setTaskDueDate(inp.dataset.proj, inp.dataset.task, inp.value);
            });
        });
        // Project drag-to-reorder
        list.querySelectorAll('.proj-card').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                if (e.target.closest('.proj-task-item, .proj-subtask-item')) return; // don't hijack task drag
                this._projDragId = card.dataset.pid;
                card.classList.add('proj-dragging');
                if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', card.dataset.pid); }
            });
            card.addEventListener('dragend', () => { card.classList.remove('proj-dragging'); this._clearProjDropMarkers(list); this._projDragId = null; });
            card.addEventListener('dragover', (e) => {
                if (!this._projDragId || this._projDragId === card.dataset.pid) return;
                if (e.target.closest('.proj-task-item, .proj-subtask-item')) return;
                e.preventDefault(); e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                const rect = card.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                this._clearProjDropMarkers(list);
                card.classList.add(before ? 'proj-card-drop-before' : 'proj-card-drop-after');
            });
            card.addEventListener('drop', (e) => {
                if (!this._projDragId || this._projDragId === card.dataset.pid) return;
                if (e.target.closest('.proj-task-item, .proj-subtask-item')) return;
                e.preventDefault(); e.stopPropagation();
                const rect = card.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                this.reorderProject(this._projDragId, card.dataset.pid, before);
                this._clearProjDropMarkers(list);
            });
        });
        list.querySelectorAll('.btn-del-subtask').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); this.deleteSubtask(btn.dataset.proj, btn.dataset.task, btn.dataset.sub); });
        });
        // Drag & drop reorder — tasks
        list.querySelectorAll('.proj-task-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                if (e.target.closest('.proj-subtask-item')) return;
                e.stopPropagation();
                this._dragCtx = { kind: 'task', projId: item.dataset.proj, taskId: item.dataset.task };
                item.classList.add('proj-dragging');
                if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.dataset.task); }
            });
            item.addEventListener('dragend', () => { item.classList.remove('proj-dragging'); this._clearDropMarkers(list); this._dragCtx = null; });
            item.addEventListener('dragover', (e) => {
                if (!this._dragCtx || this._dragCtx.kind !== 'task' || this._dragCtx.projId !== item.dataset.proj) return;
                if (this._dragCtx.taskId === item.dataset.task) return;
                e.preventDefault(); e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                const rect = item.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                this._clearDropMarkers(list);
                item.classList.add(before ? 'proj-drop-before' : 'proj-drop-after');
            });
            item.addEventListener('drop', (e) => {
                if (!this._dragCtx || this._dragCtx.kind !== 'task' || this._dragCtx.projId !== item.dataset.proj) return;
                if (this._dragCtx.taskId === item.dataset.task) return;
                e.preventDefault(); e.stopPropagation();
                const rect = item.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                this.reorderTask(item.dataset.proj, this._dragCtx.taskId, item.dataset.task, before);
                this._clearDropMarkers(list);
            });
        });
        // Drag & drop reorder — subtasks
        list.querySelectorAll('.proj-subtask-item').forEach(item => {
            item.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                this._dragCtx = { kind: 'sub', projId: item.dataset.proj, taskId: item.dataset.task, subId: item.dataset.sub };
                item.classList.add('proj-dragging');
                if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', item.dataset.sub); }
            });
            item.addEventListener('dragend', () => { item.classList.remove('proj-dragging'); this._clearDropMarkers(list); this._dragCtx = null; });
            item.addEventListener('dragover', (e) => {
                if (!this._dragCtx || this._dragCtx.kind !== 'sub') return;
                if (this._dragCtx.projId !== item.dataset.proj || this._dragCtx.taskId !== item.dataset.task) return;
                if (this._dragCtx.subId === item.dataset.sub) return;
                e.preventDefault(); e.stopPropagation();
                if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
                const rect = item.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                this._clearDropMarkers(list);
                item.classList.add(before ? 'proj-drop-before' : 'proj-drop-after');
            });
            item.addEventListener('drop', (e) => {
                if (!this._dragCtx || this._dragCtx.kind !== 'sub') return;
                if (this._dragCtx.projId !== item.dataset.proj || this._dragCtx.taskId !== item.dataset.task) return;
                if (this._dragCtx.subId === item.dataset.sub) return;
                e.preventDefault(); e.stopPropagation();
                const rect = item.getBoundingClientRect();
                const before = (e.clientY - rect.top) < rect.height / 2;
                this.reorderSubtask(item.dataset.proj, item.dataset.task, this._dragCtx.subId, item.dataset.sub, before);
                this._clearDropMarkers(list);
            });
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
        // Copy full note text
        list.querySelectorAll('.proj-note-copy-all').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const proj = (AppState.allProjects || []).find(p => p.id === btn.dataset.proj);
                const note = proj?.notes?.find(n => n.id === btn.dataset.note);
                const text = note?.text || '';
                if (!text) return;
                try {
                    await navigator.clipboard.writeText(text);
                    if (typeof showToast === 'function') showToast('Nota copiada!', 'success');
                    btn.classList.add('proj-note-copied');
                    setTimeout(() => btn.classList.remove('proj-note-copied'), 800);
                } catch (err) {
                    if (typeof showToast === 'function') showToast('Falha ao copiar: ' + err.message, 'error');
                }
            });
        });
        // Note expand toggle
        list.querySelectorAll('.proj-note-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!this._openNotes) this._openNotes = new Set();
                const id = btn.dataset.note;
                if (this._openNotes.has(id)) this._openNotes.delete(id); else this._openNotes.add(id);
                this._syncAndRerenderCard(btn.dataset.proj);
            });
        });
        // Click on summary also toggles
        list.querySelectorAll('.proj-note-summary').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const entry = el.closest('.proj-note-entry');
                const tog = entry?.querySelector('.proj-note-toggle');
                if (tog) tog.click();
            });
        });
        // Copy buttons
        list.querySelectorAll('.proj-note-copy').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const val = decodeURIComponent(btn.dataset.copy || '');
                if (!val) return;
                try {
                    await navigator.clipboard.writeText(val);
                    if (typeof showToast === 'function') showToast('Copiado!', 'success');
                    btn.classList.add('proj-note-copied');
                    setTimeout(() => btn.classList.remove('proj-note-copied'), 800);
                } catch (err) {
                    if (typeof showToast === 'function') showToast('Falha ao copiar: ' + err.message, 'error');
                }
            });
        });
        // Password reveal toggle
        list.querySelectorAll('.proj-note-reveal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const chip = btn.closest('.proj-note-chip');
                const secret = chip?.querySelector('.proj-note-secret');
                if (!secret) return;
                const hidden = secret.classList.toggle('proj-note-secret-hidden');
                secret.textContent = hidden ? '••••••' : secret.dataset.val;
            });
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

    // ── Icon library (lucide names) ──────────────────────────────
    _ICON_LIST: [
        'store','shopping-bag','shopping-cart','package','package-2','gift','tag','tags',
        'bot','brain','code','terminal','monitor','laptop','smartphone','globe',
        'book','book-open','graduation-cap','award','target','trophy',
        'dollar-sign','banknote','coins','credit-card','wallet','piggy-bank','receipt',
        'briefcase','building','building-2','factory','warehouse',
        'truck','plane','ship','bike','car','map-pin','navigation',
        'megaphone','mail','phone','video','speaker','radio',
        'glasses','watch','shirt','footprints','crown',
        'camera','image','palette','brush','scissors','wrench','hammer',
        'bar-chart-3','line-chart','pie-chart','trending-up','activity',
        'rocket','zap','flame','star','heart','sparkles','sun','moon','cloud',
        'users','user','baby','smile','user-plus',
        'key','lock','shield','fingerprint',
        'calendar','clock','timer','alarm-clock','hourglass',
        'file-text','clipboard-list','list-checks','folder','folder-open','archive',
        'search','filter','settings','sliders','wrench',
        'bell','flag','bookmark','pin','paperclip',
        'leaf','tree','flower','dog','cat','fish',
        'pizza','coffee','wine','utensils','chef-hat',
        'puzzle','dices','gamepad-2','music',
    ],

    _renderProjectIcon(p) {
        if (p.iconPhoto) {
            return `<img class="proj-type-photo" src="${p.iconPhoto}" alt="">`;
        }
        const name = p.iconName || ({ loja:'store', saas:'bot', estudo:'book', financeiro:'dollar-sign', outro:'package' })[p.type] || 'package';
        return `<i data-lucide="${this._esc(name)}" style="width:14px;height:14px;vertical-align:-2px"></i>`;
    },

    _modalIconState: { iconName: '', iconPhoto: '' },

    _renderIconGrid(filter = '') {
        const grid = document.getElementById('proj-icon-grid');
        if (!grid) return;
        const f = (filter || '').trim().toLowerCase();
        const list = f ? this._ICON_LIST.filter(n => n.includes(f)) : this._ICON_LIST;
        grid.innerHTML = list.map(name => {
            const sel = name === this._modalIconState.iconName && !this._modalIconState.iconPhoto;
            return `<button type="button" class="proj-icon-cell ${sel ? 'selected' : ''}" data-icon="${name}" title="${name}">
                <i data-lucide="${name}" style="width:18px;height:18px"></i>
            </button>`;
        }).join('');
        if (window.lucide?.createIcons) lucide.createIcons();
    },

    _refreshModalIconPreview() {
        const prev = document.getElementById('proj-icon-preview');
        if (!prev) return;
        if (this._modalIconState.iconPhoto) {
            prev.innerHTML = `<img src="${this._modalIconState.iconPhoto}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:6px">`;
        } else if (this._modalIconState.iconName) {
            prev.innerHTML = `<i data-lucide="${this._modalIconState.iconName}" style="width:24px;height:24px"></i>`;
        } else {
            // fallback to type
            const form = document.getElementById('form-project');
            const t = form?.elements?.type?.value || 'outro';
            const name = ({ loja:'store', saas:'bot', estudo:'book', financeiro:'dollar-sign', outro:'package' })[t] || 'package';
            prev.innerHTML = `<i data-lucide="${name}" style="width:24px;height:24px"></i>`;
        }
        const hName = document.getElementById('proj-icon-name-hidden');
        const hPhoto = document.getElementById('proj-icon-photo-hidden');
        if (hName) hName.value = this._modalIconState.iconName || '';
        if (hPhoto) hPhoto.value = this._modalIconState.iconPhoto || '';
        if (window.lucide?.createIcons) lucide.createIcons();
    },

    async _resizePhotoToDataUrl(file, maxDim = 192, quality = 0.86) {
        const blobUrl = URL.createObjectURL(file);
        try {
            const img = await new Promise((res, rej) => {
                const i = new Image();
                i.onload = () => res(i);
                i.onerror = (e) => rej(new Error('Imagem inválida'));
                i.src = blobUrl;
            });
            const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
            const w = Math.round(img.naturalWidth * ratio);
            const h = Math.round(img.naturalHeight * ratio);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            return canvas.toDataURL('image/jpeg', quality);
        } finally {
            URL.revokeObjectURL(blobUrl);
        }
    },

    _bindIconPicker() {
        if (this._iconPickerBound) return;
        this._iconPickerBound = true;
        const pickBtn = document.getElementById('btn-proj-icon-pick');
        const gridWrap = document.getElementById('proj-icon-grid-wrap');
        const search = document.getElementById('proj-icon-search');
        const photoInput = document.getElementById('proj-icon-photo-input');
        const resetBtn = document.getElementById('btn-proj-icon-reset');
        const grid = document.getElementById('proj-icon-grid');
        const form = document.getElementById('form-project');

        pickBtn?.addEventListener('click', () => {
            const open = gridWrap.style.display !== 'none';
            gridWrap.style.display = open ? 'none' : '';
            if (!open) { this._renderIconGrid(search?.value || ''); search?.focus(); }
        });
        search?.addEventListener('input', () => this._renderIconGrid(search.value));
        grid?.addEventListener('click', (e) => {
            const cell = e.target.closest('.proj-icon-cell');
            if (!cell) return;
            this._modalIconState.iconName = cell.dataset.icon;
            this._modalIconState.iconPhoto = '';
            this._renderIconGrid(search?.value || '');
            this._refreshModalIconPreview();
        });
        photoInput?.addEventListener('change', async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
                const dataUrl = await this._resizePhotoToDataUrl(f, 192);
                this._modalIconState.iconPhoto = dataUrl;
                this._modalIconState.iconName = '';
                this._refreshModalIconPreview();
                if (typeof showToast === 'function') showToast('Foto carregada', 'success');
            } catch (err) {
                if (typeof showToast === 'function') showToast('Falha: ' + err.message, 'error');
            }
            photoInput.value = '';
        });
        resetBtn?.addEventListener('click', () => {
            this._modalIconState.iconName = '';
            this._modalIconState.iconPhoto = '';
            this._refreshModalIconPreview();
            this._renderIconGrid(search?.value || '');
        });
        // Type changes update fallback preview
        form?.elements?.type?.addEventListener('change', () => {
            if (!this._modalIconState.iconName && !this._modalIconState.iconPhoto) this._refreshModalIconPreview();
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

    _timingBadge(timing, projId, taskId) {
        const t = timing === 'futura' ? 'futura' : 'imediata';
        const map = {
            imediata: ['Imediata', '#0369a1', '#e0f2fe', 'zap'],
            futura:   ['Futura',   '#7c3aed', '#ede9fe', 'clock'],
        };
        const [label, color, bg, icon] = map[t];
        return `<button type="button" class="proj-timing-badge btn-toggle-timing" data-proj="${projId}" data-task="${taskId}" style="color:${color};background:${bg}" title="Clique para alternar (Imediata = fazer agora · Futura = adiantar para o projeto futuro)">
            <i data-lucide="${icon}" style="width:10px;height:10px;vertical-align:-1px"></i>
            ${label}
        </button>`;
    },

    _renderCard(p) {
        this._ensureBudgetItems(p);
        const tasks = p.tasks || [];
        const progress = this._calcProgress(tasks);
        const notes = [...(p.notes || [])].reverse();
        const history = [...(p.history || [])].reverse();
        const isOpen = this._openCards && this._openCards.has(p.id);
        const goalStr = p.goalAmount ? `${currencySymbol(p.goalCurrency || 'BRL')} ${this._fmtBR(p.goalAmount)}/${p.goalPeriod || 'mês'} ${p.goalLabel || ''}` : '';

        const sym = currencySymbol(p.validationBudgetCurrency || 'BRL');
        const totalBudget = this._sumItems(p.budgetItems);
        const totalReturn = this._sumItems(p.returnItems);

        const budgetBar = (totalBudget > 0) ? (() => {
            const pct = Math.min(100, Math.round((p.validationSpent || 0) / totalBudget * 100));
            const spentFmt = `${sym} ${this._fmtBR(p.validationSpent || 0)}`;
            const totalFmt = `${sym} ${this._fmtBR(totalBudget)}`;
            const itemsList = (p.budgetItems || []).map(it => `<li><span>${this._esc(it.label || '—')}${it.months > 1 ? ` <small style="color:var(--text-muted)">· ${it.months} meses</small>` : ''}</span><strong>${sym} ${this._fmtBR(it.amount)}</strong></li>`).join('');
            return `<div class="proj-budget-wrap">
                <div class="proj-budget-label">Budget validação: ${spentFmt} / ${totalFmt} (${pct}%)</div>
                <div class="proj-budget-bar"><div class="proj-budget-fill" style="width:${pct}%;background:${pct >= 100 ? '#dc2626' : '#059669'}"></div></div>
                ${itemsList ? `<ul class="proj-budget-items">${itemsList}</ul>` : ''}
            </div>`;
        })() : '';

        const returnBlock = (totalReturn > 0) ? (() => {
            const itemsList = (p.returnItems || []).map(it => `<li><span>${this._esc(it.label || '—')}${it.months > 1 ? ` <small style="color:var(--text-muted)">· ${it.months} meses</small>` : ''}</span><strong>${sym} ${this._fmtBR(it.amount)}</strong></li>`).join('');
            return `<div class="proj-budget-wrap">
                <div class="proj-budget-label">Retorno previsto: <strong>${sym} ${this._fmtBR(totalReturn)}</strong></div>
                ${itemsList ? `<ul class="proj-budget-items">${itemsList}</ul>` : ''}
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
                <div class="proj-subtask-item" draggable="true" data-proj="${p.id}" data-task="${task.id}" data-sub="${sub.id}">
                    <span class="proj-drag-handle" title="Arraste para reordenar"><i data-lucide="grip-vertical" style="width:12px;height:12px;vertical-align:-2px"></i></span>
                    <input type="checkbox" class="proj-task-check" data-proj="${p.id}" data-task="${task.id}" data-sub="${sub.id}" ${sub.done ? 'checked' : ''}>
                    <span class="${sub.done ? 'proj-done' : ''}" style="flex:1">${this._esc(sub.text)}</span>
                    <button class="btn-del-subtask proj-icon-btn proj-del-btn" data-proj="${p.id}" data-task="${task.id}" data-sub="${sub.id}" title="Excluir">×</button>
                </div>`).join('');

            const dueDays = task.dueDate ? this._daysFromToday(task.dueDate) : null;
            const dueChip = task.dueDate
                ? `<span class="proj-task-due ${dueDays != null && dueDays < 0 && !task.done ? 'proj-task-due-overdue' : (dueDays != null && dueDays <= 2 && !task.done ? 'proj-task-due-soon' : '')}" title="${this._esc(task.dueDate)}">
                     <i data-lucide="calendar-clock" style="width:12px;height:12px;vertical-align:-2px"></i>
                     ${this._formatRelDays(dueDays)}
                   </span>`
                : '';

            return `<div class="proj-task-item" draggable="true" data-proj="${p.id}" data-task="${task.id}">
                <div class="proj-task-row">
                    <span class="proj-drag-handle" title="Arraste para reordenar"><i data-lucide="grip-vertical" style="width:14px;height:14px;vertical-align:-2px"></i></span>
                    <input type="checkbox" class="proj-task-check" data-proj="${p.id}" data-task="${task.id}" ${task.done ? 'checked' : ''}>
                    <span class="${task.done ? 'proj-done' : ''}" style="flex:1">${this._esc(task.text)}</span>
                    ${dueChip}
                    ${subProgressTxt}
                    ${this._timingBadge(task.timing, p.id, task.id)}
                    ${this._priorityBadge(task.priority)}
                    <input type="date" class="input input-sm proj-task-due-input" data-proj="${p.id}" data-task="${task.id}" value="${task.dueDate || ''}" title="Agendar tarefa">
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
        const notesHtml = notes.map(n => {
            const actionables = this._detectNoteActionables(n.text || '');
            const chipsHtml = actionables.map((item, ci) => this._renderActionableChip(item, p.id, n.id, ci)).join('');
            const summary = this._renderNoteSummary(n.text);
            const lines = (n.text || '').split(/\r?\n/);
            const isMultiline = lines.length > 1 || (n.text || '').length > 100;
            const isOpen = this._openNotes && this._openNotes.has(n.id);
            return `<div class="proj-note-entry ${isOpen ? 'proj-note-open' : ''}" data-note-id="${n.id}">
                <div class="proj-note-row">
                    <span class="proj-note-date">${n.date || ''}</span>
                    <div class="proj-note-main">
                        <div class="proj-note-summary">${summary || '<em style="color:var(--text-muted)">(vazio)</em>'}</div>
                        ${chipsHtml ? `<div class="proj-note-chips">${chipsHtml}</div>` : ''}
                        ${isOpen ? `<pre class="proj-note-full">${this._esc(n.text)}</pre>` : ''}
                    </div>
                    <button class="proj-note-copy-all proj-icon-btn" data-proj="${p.id}" data-note="${n.id}" title="Copiar nota inteira"><i data-lucide="copy" style="width:14px;height:14px;vertical-align:-2px"></i></button>
                    ${isMultiline ? `<button class="proj-note-toggle proj-icon-btn" data-proj="${p.id}" data-note="${n.id}" title="${isOpen ? 'Recolher' : 'Expandir'}">${isOpen ? '▲' : '▼'}</button>` : ''}
                    <button class="btn-del-note proj-icon-btn proj-del-btn" data-proj="${p.id}" data-note="${n.id}" title="Excluir nota">×</button>
                </div>
            </div>`;
        }).join('');

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

        // Next scheduled task + due-date / target-date chips
        const nextTask = this._nextScheduledTask(p);
        const nextDueDays = nextTask ? this._daysFromToday(nextTask.dueDate) : null;
        const targetDays = p.targetDate ? this._daysFromToday(p.targetDate) : null;
        const startDays = p.startDate ? this._daysFromToday(p.startDate) : null;

        const taskCountChip = progress.total > 0
            ? `<span class="proj-chip proj-chip-tasks">${progress.done}/${progress.total} tarefas</span>`
            : `<span class="proj-chip proj-chip-empty">sem tarefas</span>`;

        const futurasPendentes = tasks.filter(t => !t.done && t.timing === 'futura').length;
        const futuraChip = futurasPendentes > 0
            ? `<span class="proj-chip proj-chip-futura" title="Tarefas que você pode adiantar antes do projeto começar">
                 <i data-lucide="clock" style="width:12px;height:12px;vertical-align:-2px"></i>
                 ${futurasPendentes} futura${futurasPendentes > 1 ? 's' : ''}
               </span>`
            : '';

        const nextTaskChip = nextTask
            ? `<span class="proj-chip proj-chip-next ${nextDueDays != null && nextDueDays < 0 ? 'proj-chip-overdue' : ''}" title="Próxima tarefa agendada">
                 <i data-lucide="alarm-clock" style="width:12px;height:12px;vertical-align:-2px"></i>
                 ${this._esc(nextTask.text).slice(0, 40)}${nextTask.text.length > 40 ? '…' : ''}
                 ${nextDueDays != null ? ` · ${this._formatRelDays(nextDueDays)}` : ''}
               </span>`
            : '';

        const targetChip = targetDays != null
            ? `<span class="proj-chip ${targetDays < 0 ? 'proj-chip-overdue' : (targetDays <= 7 ? 'proj-chip-soon' : '')}" title="Prazo final">
                 <i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i>
                 prazo ${this._formatRelDays(targetDays)}
               </span>`
            : '';

        const goalChip = goalStr
            ? `<span class="proj-chip proj-chip-goal" title="Meta financeira"><i data-lucide="target" style="width:12px;height:12px;vertical-align:-2px"></i> ${goalStr}</span>`
            : '';

        const budgetChip = totalBudget > 0
            ? `<span class="proj-chip proj-chip-budget" title="Budget de validação"><i data-lucide="banknote" style="width:12px;height:12px;vertical-align:-2px"></i> ${sym} ${this._fmtBR(totalBudget)}</span>`
            : '';

        return `
        <div class="proj-card" id="projcard-${p.id}" draggable="true" data-pid="${p.id}">
            <div class="proj-card-header" data-id="${p.id}">
                <span class="proj-card-grip" title="Arraste para reordenar"><i data-lucide="grip-vertical" style="width:14px;height:14px;vertical-align:-2px"></i></span>
                <span class="proj-type-icon">${this._renderProjectIcon(p)}</span>
                <div class="proj-card-header-info">
                    <div class="proj-card-name-row">
                        <span class="proj-card-name">${this._esc(p.name)}</span>
                        ${this._statusBadge(p.status)}
                    </div>
                    <div class="proj-card-meta-row">
                        ${taskCountChip}
                        ${futuraChip}
                        ${nextTaskChip}
                        ${targetChip}
                        ${goalChip}
                        ${budgetChip}
                    </div>
                    ${progressBar}
                </div>
                <div class="proj-card-actions">
                    <button class="btn-proj-edit proj-icon-btn" data-id="${p.id}" title="Editar"><i data-lucide="pencil" style="width:16px;height:16px;vertical-align:-2px"></i></button>
                    <button class="btn-proj-delete proj-icon-btn proj-del-btn" data-id="${p.id}" title="Excluir"><i data-lucide="trash-2" style="width:16px;height:16px;vertical-align:-2px"></i></button>
                    <span class="proj-toggle-arrow">${isOpen ? '▲' : '▼'}</span>
                </div>
            </div>
            <div class="proj-card-body" id="projbody-${p.id}" style="display:${isOpen ? '' : 'none'}">
                ${p.description ? `<p class="proj-description">${this._esc(p.description)}</p>` : ''}
                ${budgetBar}
                ${returnBlock}
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
                            <select class="input input-sm proj-priority-select" id="new-task-priority-${p.id}" title="Prioridade">
                                <option value="media">Média</option>
                                <option value="alta">Alta</option>
                                <option value="baixa">Baixa</option>
                            </select>
                            <select class="input input-sm proj-timing-select" id="new-task-timing-${p.id}" title="Quando: Imediata = fazer agora; Futura = adiantar para projeto futuro">
                                <option value="imediata">Imediata</option>
                                <option value="futura">Futura</option>
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
        const timingSelect = document.getElementById('new-task-timing-' + projId);
        const text = input?.value?.trim();
        if (!text) return;

        const priority = prioritySelect?.value || 'media';
        const timing = timingSelect?.value || 'imediata';
        this.addTask(projId, text, priority, timing);
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

        // Reset line-item draft state
        this._modalDraft = { budgetItems: [], returnItems: [] };
        // Reset icon picker state
        this._modalIconState = { iconName: '', iconPhoto: '' };
        const gridWrap = document.getElementById('proj-icon-grid-wrap');
        if (gridWrap) gridWrap.style.display = 'none';

        if (id) {
            const p = (AppState.allProjects || []).find(x => x.id === id);
            if (p) {
                const set = (name, val) => { const el = form.elements[name]; if (el) el.value = val ?? ''; };
                set('name', p.name);
                set('type', p.type);
                set('status', p.status);
                set('description', p.description);
                set('goalAmount', this._fmtBRForInput(p.goalAmount));
                set('goalCurrency', p.goalCurrency || 'BRL');
                set('goalPeriod', p.goalPeriod || 'mes');
                set('goalLabel', p.goalLabel || 'lucro líquido');
                set('validationBudgetCurrency', p.validationBudgetCurrency || 'BRL');
                set('validationSpent', this._fmtBRForInput(p.validationSpent));
                set('startDate', p.startDate);
                set('targetDate', p.targetDate);

                this._ensureBudgetItems(p);
                this._modalDraft.budgetItems = (p.budgetItems || []).map(it => ({ ...it }));
                this._modalDraft.returnItems = (p.returnItems || []).map(it => ({ ...it }));
                this._modalIconState.iconName = p.iconName || '';
                this._modalIconState.iconPhoto = p.iconPhoto || '';
            }
        }

        // Wire up money inputs and line-item lists
        form.querySelectorAll('.proj-money-input').forEach(inp => this._attachMoneyInput(inp));
        this._renderModalLineList('budget');
        this._renderModalLineList('return');
        this._bindModalLineControls();
        this._bindIconPicker();
        this._refreshModalIconPreview();

        modal.classList.remove('hidden');
    },

    _fmtBRForInput(n) {
        const num = Number(n) || 0;
        return num === 0 ? '' : num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    _renderModalLineList(kind) {
        const wrap = document.getElementById(kind === 'budget' ? 'proj-budget-list' : 'proj-return-list');
        if (!wrap) return;
        const items = this._modalDraft?.[kind === 'budget' ? 'budgetItems' : 'returnItems'] || [];
        if (!items.length) {
            wrap.innerHTML = '<div class="proj-line-empty">Nenhum item. Clique em "+ Adicionar item".</div>';
        } else {
            wrap.innerHTML = items.map((it, idx) => `
                <div class="proj-line-row" data-idx="${idx}">
                    <input type="text" class="input input-sm proj-line-label" placeholder="Descrição (ex: tráfego)" value="${this._esc(it.label || '')}">
                    <input type="text" class="input input-sm proj-line-amount proj-money-input" inputmode="decimal" placeholder="0,00" value="${this._fmtBRForInput(it.amount)}">
                    <input type="number" class="input input-sm proj-line-months" min="1" step="1" placeholder="meses" value="${Number(it.months) || 1}">
                    <button type="button" class="btn btn-secondary btn-sm proj-line-del" title="Remover">×</button>
                </div>`).join('');
        }
        wrap.querySelectorAll('.proj-money-input').forEach(inp => this._attachMoneyInput(inp));
        this._refreshModalTotal(kind);
    },

    _refreshModalTotal(kind) {
        const items = this._modalDraft?.[kind === 'budget' ? 'budgetItems' : 'returnItems'] || [];
        const total = this._sumItems(items);
        const el = document.getElementById(kind === 'budget' ? 'proj-budget-total' : 'proj-return-total');
        if (el) el.textContent = this._fmtBR(total);
    },

    _bindModalLineControls() {
        if (this._modalLineBound) return;
        this._modalLineBound = true;
        document.querySelectorAll('.proj-line-add').forEach(btn => {
            btn.addEventListener('click', () => {
                const kind = btn.dataset.kind;
                const arr = this._modalDraft[kind === 'budget' ? 'budgetItems' : 'returnItems'];
                arr.push({ id: this._genId(kind === 'budget' ? 'bud' : 'ret'), label: '', amount: 0, months: 1 });
                this._renderModalLineList(kind);
            });
        });
        ['proj-budget-list', 'proj-return-list'].forEach(listId => {
            const wrap = document.getElementById(listId);
            if (!wrap) return;
            const kind = wrap.dataset.kind;
            const arrKey = kind === 'budget' ? 'budgetItems' : 'returnItems';
            wrap.addEventListener('input', (e) => {
                const row = e.target.closest('.proj-line-row');
                if (!row) return;
                const idx = Number(row.dataset.idx);
                const arr = this._modalDraft[arrKey];
                if (!arr || !arr[idx]) return;
                if (e.target.classList.contains('proj-line-label')) arr[idx].label = e.target.value;
                else if (e.target.classList.contains('proj-line-amount')) arr[idx].amount = this._parseBR(e.target.value);
                else if (e.target.classList.contains('proj-line-months')) arr[idx].months = Math.max(1, parseInt(e.target.value, 10) || 1);
                this._refreshModalTotal(kind);
            });
            wrap.addEventListener('click', (e) => {
                const del = e.target.closest('.proj-line-del');
                if (!del) return;
                const row = del.closest('.proj-line-row');
                if (!row) return;
                const idx = Number(row.dataset.idx);
                this._modalDraft[arrKey].splice(idx, 1);
                this._renderModalLineList(kind);
            });
        });
    },

    save(formData) {
        const name = (formData.name || '').trim();
        if (!name) { showToast('Preencha o nome do projeto', 'error'); return; }

        const form = document.getElementById('form-project');
        const editId = form?.dataset.editId || '';

        const now = new Date().toISOString();
        if (!AppState.allProjects) AppState.allProjects = [];

        const draftBudget = (this._modalDraft?.budgetItems || []).map(it => ({
            id: it.id || this._genId('bud'),
            label: (it.label || '').trim(),
            amount: Number(it.amount) || 0,
            months: Math.max(1, parseInt(it.months, 10) || 1),
        })).filter(it => it.label || it.amount > 0);
        const draftReturn = (this._modalDraft?.returnItems || []).map(it => ({
            id: it.id || this._genId('ret'),
            label: (it.label || '').trim(),
            amount: Number(it.amount) || 0,
            months: Math.max(1, parseInt(it.months, 10) || 1),
        })).filter(it => it.label || it.amount > 0);
        const totalBudget = this._sumItems(draftBudget);

        if (editId) {
            const idx = AppState.allProjects.findIndex(p => p.id === editId);
            if (idx >= 0) {
                const oldStatus = AppState.allProjects[idx].status;
                AppState.allProjects[idx] = {
                    ...AppState.allProjects[idx],
                    name,
                    type: formData.type || 'outro',
                    iconName: this._modalIconState.iconName || '',
                    iconPhoto: this._modalIconState.iconPhoto || '',
                    status: formData.status || 'ativo',
                    description: formData.description || '',
                    goalAmount: this._parseBR(formData.goalAmount),
                    goalCurrency: formData.goalCurrency || 'BRL',
                    goalPeriod: formData.goalPeriod || 'mes',
                    goalLabel: formData.goalLabel || 'lucro líquido',
                    budgetItems: draftBudget,
                    returnItems: draftReturn,
                    validationBudget: totalBudget,
                    validationBudgetCurrency: formData.validationBudgetCurrency || 'BRL',
                    validationSpent: this._parseBR(formData.validationSpent),
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
                iconName: this._modalIconState.iconName || '',
                iconPhoto: this._modalIconState.iconPhoto || '',
                status: formData.status || 'ativo',
                description: formData.description || '',
                goalAmount: this._parseBR(formData.goalAmount),
                goalCurrency: formData.goalCurrency || 'BRL',
                goalPeriod: formData.goalPeriod || 'mes',
                goalLabel: formData.goalLabel || 'lucro líquido',
                budgetItems: draftBudget,
                returnItems: draftReturn,
                validationBudget: totalBudget,
                validationBudgetCurrency: formData.validationBudgetCurrency || 'BRL',
                validationSpent: this._parseBR(formData.validationSpent),
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

    addTask(projId, text, priority, timing) {
        const proj = (AppState.allProjects || []).find(p => p.id === projId);
        if (!proj) return;
        if (!proj.tasks) proj.tasks = [];
        const t = ['imediata','futura'].includes(timing) ? timing : 'imediata';
        proj.tasks.push({
            id: this._genId('task'),
            text,
            done: false,
            priority: ['alta','media','baixa'].includes(priority) ? priority : 'media',
            timing: t,
            subitems: []
        });
        proj.updatedAt = new Date().toISOString();
        this._addAutoHistory(proj, `Tarefa adicionada: "${text}"${t === 'futura' ? ' · futura' : ''}`);
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projId);
    },

    toggleTaskTiming(projId, taskId) {
        const proj = (AppState.allProjects || []).find(p => p.id === projId);
        if (!proj) return;
        const task = (proj.tasks || []).find(t => t.id === taskId);
        if (!task) return;
        const cur = task.timing === 'futura' ? 'futura' : 'imediata';
        task.timing = cur === 'imediata' ? 'futura' : 'imediata';
        proj.updatedAt = new Date().toISOString();
        this._addAutoHistory(proj, `Tarefa "${task.text}" marcada como ${task.timing === 'futura' ? 'futura (adiantar)' : 'imediata'}`);
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

    setTaskDueDate(projId, taskId, dueDate) {
        const proj = (AppState.allProjects || []).find(p => p.id === projId);
        if (!proj) return;
        const task = (proj.tasks || []).find(t => t.id === taskId);
        if (!task) return;
        const old = task.dueDate || '';
        task.dueDate = dueDate || '';
        proj.updatedAt = new Date().toISOString();
        if (old !== task.dueDate) {
            this._addAutoHistory(proj, dueDate
                ? `Tarefa "${task.text}" agendada para ${dueDate}`
                : `Agendamento removido de "${task.text}"`);
        }
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projId);
    },

    reorderProject(fromId, toId, before) {
        if (!AppState.allProjects) return;
        const fromIdx = AppState.allProjects.findIndex(p => p.id === fromId);
        const toIdx = AppState.allProjects.findIndex(p => p.id === toId);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        const [moved] = AppState.allProjects.splice(fromIdx, 1);
        let insertIdx = AppState.allProjects.findIndex(p => p.id === toId);
        if (!before) insertIdx += 1;
        AppState.allProjects.splice(insertIdx, 0, moved);
        EventBus.emit('projectsChanged');
        this._syncAndRender();
    },

    _clearProjDropMarkers(list) {
        list.querySelectorAll('.proj-card-drop-before, .proj-card-drop-after').forEach(el => {
            el.classList.remove('proj-card-drop-before', 'proj-card-drop-after');
        });
    },

    reorderTask(projId, fromId, toId, before) {
        const proj = (AppState.allProjects || []).find(p => p.id === projId);
        if (!proj || !proj.tasks) return;
        const fromIdx = proj.tasks.findIndex(t => t.id === fromId);
        const toIdx = proj.tasks.findIndex(t => t.id === toId);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        const [moved] = proj.tasks.splice(fromIdx, 1);
        let insertIdx = proj.tasks.findIndex(t => t.id === toId);
        if (!before) insertIdx += 1;
        proj.tasks.splice(insertIdx, 0, moved);
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projId);
    },

    reorderSubtask(projId, taskId, fromId, toId, before) {
        const proj = (AppState.allProjects || []).find(p => p.id === projId);
        if (!proj) return;
        const task = (proj.tasks || []).find(t => t.id === taskId);
        if (!task || !task.subitems) return;
        const fromIdx = task.subitems.findIndex(s => s.id === fromId);
        const toIdx = task.subitems.findIndex(s => s.id === toId);
        if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
        const [moved] = task.subitems.splice(fromIdx, 1);
        let insertIdx = task.subitems.findIndex(s => s.id === toId);
        if (!before) insertIdx += 1;
        task.subitems.splice(insertIdx, 0, moved);
        proj.updatedAt = new Date().toISOString();
        EventBus.emit('projectsChanged');
        this._syncAndRerenderCard(projId);
    },

    _clearDropMarkers(list) {
        list.querySelectorAll('.proj-drop-before, .proj-drop-after').forEach(el => {
            el.classList.remove('proj-drop-before', 'proj-drop-after');
        });
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
