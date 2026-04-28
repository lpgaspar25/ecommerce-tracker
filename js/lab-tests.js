/* ===========================
   Lab Tests Module — Hypothesis/Observation/Conclusion flow
   + Diary Calendar with metrics & test markers
   =========================== */

const LabTestsModule = {
    _storageKey: 'etracker_lab_tests',
    _tests: [],
    _shopifyByDate: {}, // "YYYY-MM-DD" → { sales, revenue, currency }
    _shopifyMonthKey: null,

    CATEGORIES: {
        loja:          { label: 'Loja',          icon: '<i data-lucide="store" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#059669', bg: '#d1fae5' },
        redes_sociais: { label: 'Redes Sociais', icon: '<i data-lucide="smartphone" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#2563eb', bg: '#dbeafe' },
        trafego:       { label: 'Tráfego',       icon: '<i data-lucide="bar-chart-3" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#7c3aed', bg: '#ede9fe' },
        criativo:      { label: 'Criativo',      icon: '<i data-lucide="clapperboard" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#db2777', bg: '#fce7f3' },
        oferta:        { label: 'Oferta',        icon: '<i data-lucide="dollar-sign" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#d97706', bg: '#fef3c7' },
        outro:         { label: 'Outro',         icon: '<i data-lucide="pin" style="width:14px;height:14px;vertical-align:-2px"></i>', color: '#6b7280', bg: '#f3f4f6' },
    },

    METRICS: {
        validar_criativo: { label: '<i data-lucide="target" style="width:14px;height:14px;vertical-align:-2px"></i> Validar Criativo', icon: '<i data-lucide="target" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        vendas:    { label: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i> Vendas',      icon: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        cpa:       { label: '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i> CPA',         icon: '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        cpc:       { label: '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i> CPC',         icon: '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        conv_page: { label: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i> Conv. Página', icon: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        atc_rate:  { label: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i> Add to Cart', icon: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        roas:      { label: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i> ROAS',        icon: '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        outro:     { label: 'Outro',         icon: '<i data-lucide="pin" style="width:14px;height:14px;vertical-align:-2px"></i>' },
    },

    init() {
        this._load();
        this._bindEvents();
        if (typeof EventBus !== 'undefined') {
            EventBus.on('dataLoaded', () => this._backfillDiaryFromTests());
        }
        // Multi-tab safety: when another tab writes to lab tests storage,
        // re-read in this tab to avoid using stale in-memory state on next save.
        window.addEventListener('storage', (e) => {
            if (e.key === this._storageKey) {
                this._load();
                if (document.getElementById('lab-cards-container')) this._renderCards();
            }
        });
    },

    // Sync ALL tests into Diário on every load.
    // Why: ensures old/edited tests stay in sync with their diary entries (status,
    // dates, hypothesis, validation). _syncTestToDiary is idempotent and preserves
    // user-edited metric fields (budget/sales/etc.) via spread.
    _backfillDiaryFromTests() {
        if (!Array.isArray(this._tests) || !this._tests.length) return;
        if (typeof AppState === 'undefined' || !Array.isArray(AppState.allDiary)) return;
        let synced = 0;
        this._tests.forEach(test => {
            if (!test.productId || !test.dateStart) return;
            this._syncTestToDiary(test);
            synced++;
        });
        if (synced > 0) console.log(`[LabTests] Synced ${synced} test(s) into Diário`);
    },

    _load() {
        try { this._tests = JSON.parse(localStorage.getItem(this._storageKey)) || []; }
        catch { this._tests = []; }
    },

    // Multi-tab-safe persist: re-read disk before writing, merge by id (newer
    // updatedAt wins). Prevents an old tab from wiping out tests created in
    // a newer tab. Also writes a daily backup snapshot for recovery.
    _persist() {
        let onDisk = [];
        try { onDisk = JSON.parse(localStorage.getItem(this._storageKey)) || []; } catch {}

        const merged = this._mergeTests(onDisk, this._tests);
        this._tests = merged;
        localStorage.setItem(this._storageKey, JSON.stringify(merged));
        this._writeBackup(merged);
    },

    _mergeTests(a, b) {
        const byId = new Map();
        const ts = (t) => t?.updatedAt ? Date.parse(t.updatedAt) || 0 : 0;
        [...(a || []), ...(b || [])].forEach(t => {
            if (!t || !t.id) return;
            const existing = byId.get(t.id);
            if (!existing || ts(t) >= ts(existing)) byId.set(t.id, t);
        });
        return Array.from(byId.values());
    },

    _writeBackup(tests) {
        try {
            const today = new Date().toISOString().slice(0, 10);
            localStorage.setItem(`${this._storageKey}_backup_${today}`, JSON.stringify(tests));
            // Trim backups older than 7 days
            const cutoff = Date.now() - 7 * 86400000;
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith(`${this._storageKey}_backup_`)) continue;
                const dStr = k.slice(`${this._storageKey}_backup_`.length);
                const d = Date.parse(dStr);
                if (d && d < cutoff) localStorage.removeItem(k);
            }
        } catch {}
    },

    // Returns the most recent backup that contains tests (for recovery UIs).
    _latestBackup() {
        const prefix = `${this._storageKey}_backup_`;
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) keys.push(k);
        }
        keys.sort().reverse();
        for (const k of keys) {
            try {
                const arr = JSON.parse(localStorage.getItem(k) || '[]');
                if (Array.isArray(arr) && arr.length) return { key: k, date: k.slice(prefix.length), tests: arr };
            } catch {}
        }
        return null;
    },

    _bindEvents() {
        // Pipeline sub-tabs
        document.querySelectorAll('.pipeline-subtab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.pipeline-subtab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.subtab;
                const offersEl = document.getElementById('pipeline-offers-sub');
                const labEl = document.getElementById('pipeline-lab-sub');
                if (offersEl) offersEl.style.display = tab === 'offers' ? '' : 'none';
                if (labEl) labEl.style.display = tab === 'lab' ? '' : 'none';
                if (tab === 'lab') this._renderCards();
            });
        });

        // Diary sub-tabs
        document.querySelectorAll('.diary-subtab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.diary-subtab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.subtab;
                const mainEl = document.getElementById('diary-main-sub');
                const calEl = document.getElementById('diary-calendar-sub');
                const aiEl = document.getElementById('diary-ai-sub');
                if (mainEl) mainEl.style.display = tab === 'diary' ? '' : 'none';
                if (calEl) calEl.style.display = tab === 'calendar' ? '' : 'none';
                if (aiEl) aiEl.style.display = tab === 'ai' ? '' : 'none';
                if (tab === 'calendar') this._renderCalendar();
            });
        });

        // Lab buttons
        document.getElementById('btn-add-lab-test')?.addEventListener('click', () => this._openModal());
        document.getElementById('lab-modal-close')?.addEventListener('click', () => this._closeModal());
        document.getElementById('lab-modal')?.querySelector('.modal-overlay')?.addEventListener('click', () => this._closeModal());
        document.getElementById('lab-form')?.addEventListener('submit', (e) => this._handleSave(e));
        document.getElementById('btn-lab-add-obs')?.addEventListener('click', () => this._addObservation());

        // Toggle metrics section
        document.getElementById('btn-lab-toggle-metrics')?.addEventListener('click', () => {
            const section = document.getElementById('lab-metrics-section');
            const btn = document.getElementById('btn-lab-toggle-metrics');
            if (section) {
                const show = section.style.display === 'none';
                section.style.display = show ? '' : 'none';
                if (btn) btn.textContent = show ? '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i> Esconder métricas' : '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i> Adicionar métricas';
            }
        });

        // Stages toggle
        document.getElementById('test-has-stages')?.addEventListener('change', (e) => {
            const container = document.getElementById('test-stages-container');
            if (container) container.style.display = e.target.checked ? '' : 'none';
        });

        document.getElementById('btn-add-stage')?.addEventListener('click', () => {
            const list = document.getElementById('test-stages-list');
            if (list) this._addStageRow(list, null, list.children.length);
        });
    },

    // ── Cards Rendering ──────────────────────────────────────────────

    _renderCards() {
        const container = document.getElementById('lab-cards-container');
        if (!container) return;

        // Auto-conclude overdue tests (past end date)
        const now = new Date();
        now.setHours(0,0,0,0);
        let changed = false;
        this._tests.forEach(t => {
            if (t.status === 'ativo' && t.dateEnd) {
                const end = new Date(t.dateEnd + 'T23:59:59');
                if (now > end) {
                    t.status = 'concluido';
                    if (!t.result) t.result = 'neutro';
                    changed = true;
                }
            }
        });
        if (changed) this._persist();

        const active = this._tests.filter(t => t.status === 'ativo');
        const concluded = this._tests.filter(t => t.status === 'concluido');
        const cancelled = this._tests.filter(t => t.status === 'cancelado');

        let html = '';

        // Stats summary
        const total = this._tests.length;
        const positivos = concluded.filter(t => t.result === 'positivo').length;
        const negativos = concluded.filter(t => t.result === 'negativo').length;
        const neutros = concluded.filter(t => t.result === 'neutro').length;
        const pctPositivo = concluded.length > 0 ? Math.round((positivos / concluded.length) * 100) : 0;
        const pctNegativo = concluded.length > 0 ? Math.round((negativos / concluded.length) * 100) : 0;
        const pctNeutro = concluded.length > 0 ? Math.round((neutros / concluded.length) * 100) : 0;

        if (total > 0) {
            html += `<div class="lab-stats-bar">
                <div class="lab-stat">
                    <span class="lab-stat-value">${total}</span>
                    <span class="lab-stat-label">Total</span>
                </div>
                <div class="lab-stat">
                    <span class="lab-stat-value" style="color:var(--accent)">${active.length}</span>
                    <span class="lab-stat-label">Ativos</span>
                </div>
                <div class="lab-stat">
                    <span class="lab-stat-value" style="color:#059669">${positivos}</span>
                    <span class="lab-stat-label"><i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Validados</span>
                </div>
                <div class="lab-stat">
                    <span class="lab-stat-value" style="color:#dc2626">${negativos}</span>
                    <span class="lab-stat-label"><i data-lucide="x-circle" style="width:14px;height:14px;vertical-align:-2px"></i> Falharam</span>
                </div>
                <div class="lab-stat">
                    <span class="lab-stat-value" style="color:#6b7280">${neutros}</span>
                    <span class="lab-stat-label"><i data-lucide="minus" style="width:14px;height:14px;vertical-align:-2px"></i> Neutros</span>
                </div>
                <div class="lab-stat lab-stat-highlight">
                    <span class="lab-stat-value" style="color:#059669">${pctPositivo}%</span>
                    <span class="lab-stat-label">Taxa de Acerto</span>
                </div>
            </div>`;

            // Progress bar visual
            if (concluded.length > 0) {
                html += `<div class="lab-stats-progress">
                    <div class="lab-stats-progress-bar lab-stats-progress-green" style="width:${pctPositivo}%" title="${positivos} validados (${pctPositivo}%)"></div>
                    <div class="lab-stats-progress-bar lab-stats-progress-gray" style="width:${pctNeutro}%" title="${neutros} neutros (${pctNeutro}%)"></div>
                    <div class="lab-stats-progress-bar lab-stats-progress-red" style="width:${pctNegativo}%" title="${negativos} falharam (${pctNegativo}%)"></div>
                </div>`;
            }
        }

        if (active.length) {
            html += `<h3 class="lab-section-title"><i data-lucide="microscope" style="width:14px;height:14px;vertical-align:-2px"></i> Ativos (${active.length})</h3>`;
            html += `<div class="lab-cards-grid">${active.map(t => this._renderCard(t)).join('')}</div>`;
        }

        if (concluded.length) {
            html += `<h3 class="lab-section-title" style="margin-top:1.5rem"><i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Concluídos (${concluded.length})</h3>`;
            html += `<div class="lab-cards-grid">${concluded.map(t => this._renderCard(t)).join('')}</div>`;
        }

        if (cancelled.length) {
            html += `<details style="margin-top:1rem"><summary class="lab-section-title" style="cursor:pointer"><i data-lucide="ban" style="width:14px;height:14px;vertical-align:-2px"></i> Cancelados (${cancelled.length})</summary>`;
            html += `<div class="lab-cards-grid" style="margin-top:0.5rem">${cancelled.map(t => this._renderCard(t)).join('')}</div></details>`;
        }

        if (!this._tests.length) {
            html = '<p style="text-align:center;color:var(--text-muted);padding:3rem 0">Nenhum teste. Clique em "+ Novo Teste" para começar.</p>';
        }

        container.innerHTML = html;

        // Bind card clicks
        container.querySelectorAll('.lab-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.lab-stage-advance-btn')) return;
                this._openModal(card.dataset.id);
            });
        });

        // Bind stage advance buttons
        container.querySelectorAll('.lab-stage-advance-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._advanceStage(btn.dataset.testId, btn.dataset.stageId);
            });
        });
    },

    _renderCard(test) {
        const cat = this.CATEGORIES[test.category] || this.CATEGORIES.outro;
        const metric = this.METRICS[test.expectedMetric];
        const now = new Date();
        const start = new Date(test.dateStart);
        const end = new Date(test.dateEnd);
        const totalDays = Math.max(1, Math.ceil((end - start) / 86400000));
        const elapsed = Math.min(totalDays, Math.max(0, Math.ceil((now - start) / 86400000)));
        const progress = Math.min(100, Math.round((elapsed / totalDays) * 100));
        const isOverdue = now > end && test.status === 'ativo';

        let resultBadge = '';
        if (test.status === 'concluido') {
            const rc = { positivo: ['<i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Positivo', '#059669', '#d1fae5'], negativo: ['<i data-lucide="x-circle" style="width:14px;height:14px;vertical-align:-2px"></i> Negativo', '#dc2626', '#fee2e2'], neutro: ['<i data-lucide="minus" style="width:14px;height:14px;vertical-align:-2px"></i> Neutro', '#6b7280', '#f3f4f6'] };
            const [label, color, bg] = rc[test.result] || rc.neutro;
            resultBadge = `<span class="lab-result-badge" style="color:${color};background:${bg}">${label}</span>`;
        }

        const obsCount = (test.observations || []).length;

        // Resolve product and creative names
        let productName = '';
        if (test.productId && typeof AppState !== 'undefined') {
            const prod = (AppState.products || []).find(p => p.id === test.productId);
            productName = prod ? prod.name : '';
        }
        let creativeName = '';
        if (test.creativeId) {
            try {
                const c = JSON.parse(localStorage.getItem('etracker_creatives') || '[]').find(c => c.id === test.creativeId);
                creativeName = c ? (c.name || c.hook || '') : '';
            } catch {}
        }

        return `
        <div class="lab-card lab-card-${test.status}" data-id="${test.id}">
            <div class="lab-card-header">
                <span class="lab-category-badge" style="background:${cat.bg};color:${cat.color}">${cat.icon} ${cat.label}</span>
                ${resultBadge}
                ${isOverdue ? '<span class="lab-overdue-badge"><i data-lucide="alarm-clock" style="width:14px;height:14px;vertical-align:-2px"></i> Vencido</span>' : ''}
            </div>
            <h4 class="lab-card-title">${this._esc(test.title)}</h4>
            ${productName || creativeName ? `<p class="lab-card-area">${productName ? `<i data-lucide="tag" style="width:14px;height:14px;vertical-align:-2px"></i>️ ${this._esc(productName)}` : ''}${productName && creativeName ? ' · ' : ''}${creativeName ? `<i data-lucide="clapperboard" style="width:14px;height:14px;vertical-align:-2px"></i> ${this._esc(creativeName)}` : ''}</p>` : ''}
            ${test.area ? `<p class="lab-card-area">${this._esc(test.area)}</p>` : ''}
            <p class="lab-card-hypothesis">${this._esc(test.hypothesis || '')}</p>
            ${test.status === 'ativo' ? `
            <div class="lab-progress-wrap">
                <div class="lab-progress-bar" style="width:${progress}%;background:${isOverdue ? 'var(--red)' : 'var(--accent)'}"></div>
            </div>
            <div class="lab-card-meta">
                <span>Dia ${elapsed}/${totalDays}</span>
                ${metric ? `<span>${metric.icon} ${metric.label}${test.baselineValue ? ': ' + this._esc(test.baselineValue) : ''}</span>` : ''}
                ${obsCount ? `<span><i data-lucide="message-circle" style="width:14px;height:14px;vertical-align:-2px"></i> ${obsCount}</span>` : ''}
            </div>` : ''}
            ${test.status === 'concluido' && test.conclusion ? `<p class="lab-card-conclusion">${this._esc(test.conclusion)}</p>` : ''}
            ${test.stages && test.stages.length > 0 ? this._renderStagesProgress(test) : ''}
            <div class="lab-card-dates">${test.dateStart} <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> ${test.dateEnd}</div>
        </div>`;
    },

    // ── Modal ─────────────────────────────────────────────────────────

    _openModal(id) {
        const modal = document.getElementById('lab-modal');
        if (!modal) return;
        this._editingId = id || null;
        const test = id ? this._tests.find(t => t.id === id) : null;

        // Fill form
        const get = (sel) => document.getElementById(sel);
        get('lab-title').value = test?.title || '';
        get('lab-category').value = test?.category || 'loja';
        get('lab-area').value = test?.area || '';
        get('lab-date-start').value = test?.dateStart || new Date().toISOString().slice(0, 10);
        get('lab-date-end').value = test?.dateEnd || '';
        get('lab-hypothesis').value = test?.hypothesis || '';
        get('lab-expected-metric').value = test?.expectedMetric || 'validar_criativo';
        get('lab-baseline').value = test?.baselineValue || '';
        get('lab-status').value = test?.status || 'ativo';

        // Metrics
        const metrics = test?.metrics || {};
        const hasMetrics = Object.keys(metrics).length > 0;
        for (const key of ['cpc','cpa','ctr','sales','roas','budget']) {
            const bEl = document.getElementById(`lab-m-${key}-before`);
            const aEl = document.getElementById(`lab-m-${key}-after`);
            if (bEl) bEl.value = metrics[`${key}_before`] ?? '';
            if (aEl) aEl.value = metrics[`${key}_after`] ?? '';
        }
        // Show/hide metrics section
        const metricsSection = document.getElementById('lab-metrics-section');
        const metricsBtn = document.getElementById('btn-lab-toggle-metrics');
        if (metricsSection) metricsSection.style.display = hasMetrics ? '' : 'none';
        if (metricsBtn) metricsBtn.textContent = hasMetrics ? '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i> Esconder métricas' : '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i> Adicionar métricas';

        // Populate product dropdown from AppState
        const prodSelect = get('lab-product');
        if (prodSelect) {
            prodSelect.innerHTML = '<option value="">Nenhum produto</option>';
            const products = (typeof AppState !== 'undefined' && AppState.products) ? AppState.products : [];
            for (const p of products) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                prodSelect.appendChild(opt);
            }
            prodSelect.value = test?.productId || '';
        }

        // Populate creative dropdown from creatives
        const creatSelect = get('lab-creative');
        if (creatSelect) {
            creatSelect.innerHTML = '<option value="">Nenhum criativo</option>';
            try {
                const creatives = JSON.parse(localStorage.getItem('etracker_creatives') || '[]');
                for (const c of creatives) {
                    const opt = document.createElement('option');
                    opt.value = c.id;
                    opt.textContent = c.name || c.hook || `Criativo #${c.id?.slice(-4)}`;
                    creatSelect.appendChild(opt);
                }
            } catch {}
            creatSelect.value = test?.creativeId || '';
        }

        // Conclusion fields
        get('lab-conclusion').value = test?.conclusion || '';
        get('lab-result').value = test?.result || 'neutro';
        get('lab-final-value').value = test?.finalValue || '';
        get('lab-keep-change').value = test?.keepChange === false ? 'false' : 'true';
        get('lab-learnings').value = test?.learnings || '';

        // Observations
        this._renderObservations(test?.observations || []);

        // Show/hide conclusion section
        const conclusionSection = document.getElementById('lab-conclusion-section');
        if (conclusionSection) conclusionSection.style.display = test?.status === 'concluido' || test?.status === 'cancelado' ? '' : 'none';

        // Status change shows conclusion
        get('lab-status').onchange = () => {
            const s = get('lab-status').value;
            if (conclusionSection) conclusionSection.style.display = s === 'concluido' || s === 'cancelado' ? '' : 'none';
        };

        // Stages
        const stagesCheckbox = document.getElementById('test-has-stages');
        const stagesContainer = document.getElementById('test-stages-container');
        const stagesList = document.getElementById('test-stages-list');
        const hasStages = test?.stages && test.stages.length > 0;
        if (stagesCheckbox) stagesCheckbox.checked = hasStages;
        if (stagesContainer) stagesContainer.style.display = hasStages ? '' : 'none';
        if (stagesList) {
            stagesList.innerHTML = '';
            if (hasStages) {
                const sorted = [...test.stages].sort((a, b) => a.order - b.order);
                sorted.forEach((s, i) => this._addStageRow(stagesList, s, i));
            }
        }

        // Delete button
        const delBtn = document.getElementById('btn-lab-delete');
        if (delBtn) {
            delBtn.style.display = id ? '' : 'none';
            delBtn.onclick = () => { if (confirm('Excluir teste?')) { this._deleteTest(id); this._closeModal(); } };
        }

        modal.classList.remove('hidden');
    },

    _closeModal() {
        document.getElementById('lab-modal')?.classList.add('hidden');
        this._editingId = null;
    },

    _renderObservations(observations) {
        const container = document.getElementById('lab-observations-list');
        if (!container) return;

        if (!observations.length) {
            container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">Nenhuma observação ainda.</p>';
            return;
        }

        container.innerHTML = observations.map((obs, i) => {
            const sentimentIcon = { positive: '<i data-lucide="circle" style="width:10px;height:10px;fill:#10b981;color:#10b981"></i>', negative: '<i data-lucide="circle" style="width:10px;height:10px;fill:#ef4444;color:#ef4444"></i>', neutral: '<i data-lucide="circle" style="width:10px;height:10px;fill:#f59e0b;color:#f59e0b"></i>' }[obs.sentiment] || '<i data-lucide="circle" style="width:10px;height:10px;fill:#f59e0b;color:#f59e0b"></i>';
            return `<div class="lab-obs-item">
                <span class="lab-obs-date">${obs.date}</span>
                <span class="lab-obs-sentiment">${sentimentIcon}</span>
                <span class="lab-obs-text">${this._esc(obs.text)}</span>
                <button class="lab-obs-del" data-idx="${i}" title="Remover"><i data-lucide="x" style="width:14px;height:14px;vertical-align:-2px"></i></button>
            </div>`;
        }).join('');

        container.querySelectorAll('.lab-obs-del').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt(btn.dataset.idx);
                if (this._editingId) {
                    const test = this._tests.find(t => t.id === this._editingId);
                    if (test) { test.observations.splice(idx, 1); this._persist(); this._renderObservations(test.observations); }
                }
            });
        });
    },

    _addObservation() {
        const text = document.getElementById('lab-obs-text')?.value?.trim();
        if (!text) { showToast('Escreva a observação', 'error'); return; }

        const sentiment = document.getElementById('lab-obs-sentiment')?.value || 'neutral';
        const date = new Date().toISOString().slice(0, 10);

        if (this._editingId) {
            const test = this._tests.find(t => t.id === this._editingId);
            if (test) {
                if (!test.observations) test.observations = [];
                test.observations.push({ date, text, sentiment });
                this._persist();
                this._renderObservations(test.observations);
            }
        } else {
            // Store temporarily for new tests
            if (!this._tempObs) this._tempObs = [];
            this._tempObs.push({ date, text, sentiment });
            this._renderObservations(this._tempObs);
        }

        document.getElementById('lab-obs-text').value = '';
        showToast('Observação adicionada!', 'success');
    },

    _handleSave(e) {
        e.preventDefault();
        const get = (id) => document.getElementById(id)?.value?.trim() || '';

        const data = {
            title: get('lab-title'),
            category: get('lab-category'),
            area: get('lab-area'),
            dateStart: get('lab-date-start'),
            dateEnd: get('lab-date-end'),
            hypothesis: get('lab-hypothesis'),
            expectedMetric: get('lab-expected-metric'),
            baselineValue: get('lab-baseline'),
            productId: get('lab-product'),
            creativeId: get('lab-creative'),
            metrics: (() => {
                const m = {};
                for (const key of ['cpc','cpa','ctr','sales','roas','budget']) {
                    const bv = document.getElementById(`lab-m-${key}-before`)?.value;
                    const av = document.getElementById(`lab-m-${key}-after`)?.value;
                    if (bv) m[`${key}_before`] = parseFloat(bv);
                    if (av) m[`${key}_after`] = parseFloat(av);
                }
                return m;
            })(),
            status: get('lab-status'),
            conclusion: get('lab-conclusion'),
            result: get('lab-result'),
            finalValue: get('lab-final-value'),
            keepChange: get('lab-keep-change') === 'true',
            learnings: get('lab-learnings'),
            stages: (() => {
                const hasStages = document.getElementById('test-has-stages')?.checked;
                if (!hasStages) return [];
                return this._buildStagesFromForm();
            })(),
        };

        if (!data.title) { showToast('Preencha o título', 'error'); return; }

        let savedTest;
        if (this._editingId) {
            const idx = this._tests.findIndex(t => t.id === this._editingId);
            if (idx >= 0) {
                this._tests[idx] = { ...this._tests[idx], ...data, updatedAt: new Date().toISOString() };
                savedTest = this._tests[idx];
            }
        } else {
            const newTest = {
                id: 'lab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
                ...data,
                observations: this._tempObs || [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            this._tests.unshift(newTest);
            this._tempObs = null;
            savedTest = newTest;
        }

        this._persist();
        if (savedTest) this._syncTestToDiary(savedTest);
        this._closeModal();
        this._renderCards();
        showToast(this._editingId ? 'Teste atualizado!' : 'Teste criado!', 'success');
    },

    _deleteTest(id) {
        const test = this._tests.find(t => t.id === id);
        this._tests = this._tests.filter(t => t.id !== id);
        this._persist();
        if (test) this._removeTestFromDiary(test);
        this._renderCards();
        showToast('Teste excluído', 'success');
    },

    // ── Diary integration ────────────────────────────────────────────
    // Mirror each lab test as a diary entry on the test's product so it shows up
    // in the Diário with isTest=true. Linked via labTestId, idempotent.

    _syncTestToDiary(test) {
        if (!test || !test.productId) return;
        if (typeof AppState === 'undefined' || !Array.isArray(AppState.allDiary)) return;
        if (!test.dateStart) return;

        const product = (AppState.allProducts || AppState.products || []).find(p => p.id === test.productId);
        const storeId = product?.storeId
            || (typeof AppState.currentStoreId !== 'undefined' ? AppState.currentStoreId : '');
        if (!storeId) return;

        const validation = (() => {
            if (test.status !== 'concluido') return 'pendente';
            if (test.result === 'positivo') return 'validado';
            if (test.result === 'negativo') return 'nao_validado';
            return 'pendente';
        })();

        const metricLabelHtml = this.METRICS[test.expectedMetric]?.label || '';
        const metricLabelText = metricLabelHtml.replace(/<[^>]*>/g, '').trim();
        const testGoal = test.baselineValue
            ? `${metricLabelText}${metricLabelText ? ': ' : ''}${test.baselineValue}`
            : metricLabelText;

        const noteParts = [`[Teste do Pipeline] ${test.title || ''}`.trim()];
        if (test.hypothesis) noteParts.push(test.hypothesis);
        const notes = noteParts.filter(Boolean).join(' — ');

        // Build the day-by-day list spanning [dateStart, dateEnd]. One diary entry
        // per day so the importer (which upserts by productId+date+single-day period)
        // finds and merges into it instead of creating a parallel row.
        const dates = (() => {
            const arr = [];
            const start = new Date(test.dateStart + 'T00:00:00');
            const end = new Date((test.dateEnd || test.dateStart) + 'T00:00:00');
            if (isNaN(start) || isNaN(end) || end < start) return [test.dateStart];
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                arr.push(d.toISOString().slice(0, 10));
            }
            return arr;
        })();

        // Migrate legacy single-period entry: drop it before creating per-day entries.
        const legacyId = 'dia_lab_' + test.id;
        const legacyIdx = AppState.allDiary.findIndex(d => d.id === legacyId);
        if (legacyIdx >= 0) AppState.allDiary.splice(legacyIdx, 1);

        const currency = product?.priceCurrency || 'BRL';

        dates.forEach(date => {
            const entryId = `dia_lab_${test.id}_${date}`;
            const baseFields = {
                id: entryId,
                productId: test.productId,
                storeId,
                date,
                periodStart: date,
                periodEnd: date,
                testEndDate: test.dateEnd || '',
                isTest: true,
                testType: 'product',
                testValidation: validation,
                testGoal,
                notes,
                creativeId: test.creativeId || '',
                labTestId: test.id,
            };

            // Find ALL candidate rows for this product+date (non-campaign), so we
            // can dedupe orphans left from earlier sync attempts. Skip rows owned
            // by a different test.
            const candidates = [];
            for (let i = 0; i < AppState.allDiary.length; i++) {
                const d = AppState.allDiary[i];
                if (d.id === entryId) { candidates.push(i); continue; }
                if (d.isCampaign || d.parentId) continue;
                if (d.productId !== test.productId) continue;
                if (d.date !== date) continue;
                if (d.labTestId && d.labTestId !== test.id) continue;
                candidates.push(i);
            }

            if (candidates.length === 0) {
                AppState.allDiary.push({
                    budget: 0, budgetCurrency: currency,
                    sales: 0, revenue: 0, revenueCurrency: currency,
                    cpa: 0, cpc: 0,
                    impressions: 0, pageViews: 0, addToCart: 0, checkout: 0,
                    platform: '',
                    ...baseFields,
                });
                return;
            }

            // Pick the keeper: prefer a row that already carries this test's labTestId,
            // else the row with the most data (sum of metrics), else the first.
            const score = (e) => {
                if (e.labTestId === test.id) return 1e9;
                return Number(e.sales || 0) + Number(e.budget || 0) + Number(e.pageViews || 0);
            };
            candidates.sort((a, b) => score(AppState.allDiary[b]) - score(AppState.allDiary[a]));
            const keeperIdx = candidates[0];
            const keeper = AppState.allDiary[keeperIdx];

            // Merge metrics from any duplicate orphans into the keeper before deleting,
            // so we don't lose data the user might have entered.
            const orphans = candidates.slice(1).map(i => AppState.allDiary[i]);
            orphans.forEach(o => {
                ['budget','sales','revenue','impressions','pageViews','addToCart','checkout'].forEach(k => {
                    if (!keeper[k] && o[k]) keeper[k] = o[k];
                });
                ['cpa','cpc','atcRate','checkoutRate','saleRate','viewPageRate'].forEach(k => {
                    if (!keeper[k] && o[k]) keeper[k] = o[k];
                });
            });
            // Apply test fields
            AppState.allDiary[keeperIdx] = { ...keeper, ...baseFields };
            // Drop the orphans (highest indices first to keep positions stable)
            const orphanIdxs = candidates.slice(1).sort((a, b) => b - a);
            orphanIdxs.forEach(i => AppState.allDiary.splice(i, 1));
        });

        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        if (typeof filterDataByStore === 'function') filterDataByStore();
        if (typeof EventBus !== 'undefined') EventBus.emit('diaryChanged');
    },

    _removeTestFromDiary(test) {
        if (!test || typeof AppState === 'undefined' || !Array.isArray(AppState.allDiary)) return;
        const before = AppState.allDiary.length;
        AppState.allDiary = AppState.allDiary.filter(d => d.labTestId !== test.id && d.id !== 'dia_lab_' + test.id);
        if (AppState.allDiary.length === before) return;
        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        if (typeof filterDataByStore === 'function') filterDataByStore();
        if (typeof EventBus !== 'undefined') EventBus.emit('diaryChanged');
    },

    // ── Calendar ──────────────────────────────────────────────────────

    _renderCalendar() {
        const container = document.getElementById('diary-calendar-content');
        if (!container) return;

        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();

        // Get diary entries
        let diaryEntries = [];
        if (typeof DiaryModule !== 'undefined' && DiaryModule._entries) {
            diaryEntries = DiaryModule._entries;
        }

        // Get lab tests
        const labTests = this._tests.filter(t => t.status !== 'cancelado');

        // Get diary test entries (isTest=true)
        const diaryTests = diaryEntries.filter(e => e.isTest);

        // Build calendar
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

        // Group diary by date
        const byDate = {};
        for (const e of diaryEntries) {
            if (!e.date) continue;
            const d = e.date.slice(0, 10);
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(e);
        }

        let html = `
        <div class="cal-header">
            <button class="btn btn-secondary btn-sm" id="cal-prev-month">◀</button>
            <h3 class="cal-month-title">${monthNames[month]} ${year}</h3>
            <button class="btn btn-secondary btn-sm" id="cal-next-month">▶</button>
        </div>
        <div class="cal-weekdays">
            <span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span>
        </div>
        <div class="cal-grid">`;

        // Empty cells before first day
        for (let i = 0; i < firstDay; i++) html += '<div class="cal-day cal-day-empty"></div>';

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const entries = byDate[dateStr] || [];
            const isToday = dateStr === now.toISOString().slice(0, 10);

            // Find active lab tests on this day
            const activeLabTests = labTests.filter(t => t.dateStart <= dateStr && t.dateEnd >= dateStr);

            // Find active diary tests on this day
            const activeDiaryTests = diaryTests.filter(e => e.date?.slice(0, 10) === dateStr);

            // Metrics summary
            let totalSales = 0, totalBudget = 0, totalRevenue = 0;
            for (const e of entries) {
                totalSales += e.sales || 0;
                totalBudget += e.budget || 0;
                totalRevenue += e.revenue || 0;
            }
            const cpa = totalSales > 0 ? (totalBudget / totalSales) : 0;
            // Shopify data for this day (preloaded async)
            const shopifyData = this._shopifyByDate[dateStr] || null;
            const shopifySales = shopifyData ? Number(shopifyData.sales || 0) : 0;
            const realCpa = shopifySales > 0 ? (totalBudget / shopifySales) : 0;

            // Day color based on performance (prefer CPA Real when Shopify data available)
            let dayClass = '';
            if (entries.length > 0) {
                const cpaForColor = shopifySales > 0 ? realCpa : cpa;
                const salesForColor = shopifySales > 0 ? shopifySales : totalSales;
                if (salesForColor > 0 && cpaForColor <= 30) dayClass = 'cal-day-green';
                else if (salesForColor > 0 && cpaForColor <= 60) dayClass = 'cal-day-yellow';
                else if (totalBudget > 0) dayClass = 'cal-day-red';
                else dayClass = 'cal-day-neutral';
            }

            // Test markers
            const markers = activeLabTests.map(t => {
                const cat = this.CATEGORIES[t.category] || this.CATEGORIES.outro;
                return `<span class="cal-marker" style="background:${cat.color}" title="${this._esc(t.title)}"></span>`;
            }).join('');

            const diaryTestMarkers = activeDiaryTests.length > 0
                ? `<span class="cal-marker" style="background:#f59e0b" title="${activeDiaryTests.length} teste(s) de produto"></span>`
                : '';

            const shopifyCell = shopifyData
                ? `<span class="cal-metric-shopify" title="Vendas Shopify: ${shopifySales}${realCpa > 0 ? ' / CPA Real: R$' + realCpa.toFixed(2) : ''}"><i data-lucide="shopping-cart" style="width:14px;height:14px;vertical-align:-2px"></i>${shopifySales}${realCpa > 0 ? ' · R$' + Math.round(realCpa) : ''}</span>`
                : '';

            html += `
            <div class="cal-day ${dayClass} ${isToday ? 'cal-day-today' : ''}" data-date="${dateStr}">
                <span class="cal-day-num">${day}</span>
                ${entries.length > 0 || shopifyData ? `<div class="cal-day-metrics">
                    ${totalSales > 0 ? `<span class="cal-metric-sales" title="Vendas Facebook">${totalSales}v</span>` : ''}
                    ${shopifyCell}
                    ${totalBudget > 0 ? `<span class="cal-metric-budget">R$${Math.round(totalBudget)}</span>` : ''}
                </div>` : ''}
                <div class="cal-markers">${markers}${diaryTestMarkers}</div>
            </div>`;
        }

        html += '</div>';

        // Kick off Shopify preload for this month (re-renders when done)
        this._ensureShopifyMonthData(year, month);

        // Active tests summary
        const activeTests = labTests.filter(t => t.status === 'ativo');
        if (activeTests.length > 0 || diaryTests.length > 0) {
            html += `<div class="cal-tests-summary">
                <h4><i data-lucide="flask-conical" style="width:14px;height:14px;vertical-align:-2px"></i> Testes Ativos</h4>`;

            for (const t of activeTests) {
                const cat = this.CATEGORIES[t.category] || this.CATEGORIES.outro;
                const elapsed = Math.max(0, Math.ceil((now - new Date(t.dateStart)) / 86400000));
                const total = Math.max(1, Math.ceil((new Date(t.dateEnd) - new Date(t.dateStart)) / 86400000));
                html += `<div class="cal-test-item" data-id="${t.id}">
                    <span class="lab-category-badge" style="background:${cat.bg};color:${cat.color}">${cat.icon}</span>
                    <div class="cal-test-info">
                        <strong>${this._esc(t.title)}</strong>
                        <span>${t.dateStart} <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> ${t.dateEnd} (dia ${elapsed}/${total})</span>
                    </div>
                </div>`;
            }

            // Diary test entries
            const uniqueDiaryTests = [...new Set(diaryTests.map(e => e.testGoal || e.testNotes).filter(Boolean))];
            for (const goal of uniqueDiaryTests.slice(0, 5)) {
                html += `<div class="cal-test-item">
                    <span class="lab-category-badge" style="background:#fef3c7;color:#d97706"><i data-lucide="bar-chart-3" style="width:14px;height:14px;vertical-align:-2px"></i></span>
                    <div class="cal-test-info">
                        <strong>${this._esc(goal)}</strong>
                        <span>Teste de produto (diário)</span>
                    </div>
                </div>`;
            }

            html += '</div>';
        }

        container.innerHTML = html;

        // Bind day clicks
        container.querySelectorAll('.cal-day[data-date]').forEach(dayEl => {
            dayEl.addEventListener('click', () => this._showDayPopup(dayEl.dataset.date, byDate, labTests, diaryTests));
        });

        // Bind test item clicks
        container.querySelectorAll('.cal-test-item[data-id]').forEach(el => {
            el.addEventListener('click', () => {
                // Switch to lab tab and open modal
                document.querySelector('.pipeline-subtab[data-subtab="lab"]')?.click();
                this._openModal(el.dataset.id);
            });
        });

        // Month navigation
        document.getElementById('cal-prev-month')?.addEventListener('click', () => this._navigateMonth(-1));
        document.getElementById('cal-next-month')?.addEventListener('click', () => this._navigateMonth(1));

        this._calYear = year;
        this._calMonth = month;
    },

    _navigateMonth(delta) {
        let m = (this._calMonth || new Date().getMonth()) + delta;
        let y = this._calYear || new Date().getFullYear();
        if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
        this._calMonth = m;
        this._calYear = y;

        // Re-render with new month
        const now = new Date(y, m, 15);
        const container = document.getElementById('diary-calendar-content');
        if (!container) return;

        // Temporarily override Date for calendar render
        const origMonth = now.getMonth();
        // Just re-call with stored values
        this._renderCalendarMonth(y, m);
    },

    _renderCalendarMonth(year, month) {
        // Same logic as _renderCalendar but with specific year/month
        const container = document.getElementById('diary-calendar-content');
        if (!container) return;

        const now = new Date();
        let diaryEntries = [];
        if (typeof DiaryModule !== 'undefined' && DiaryModule._entries) diaryEntries = DiaryModule._entries;
        const labTests = this._tests.filter(t => t.status !== 'cancelado');
        const diaryTests = diaryEntries.filter(e => e.isTest);

        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

        const byDate = {};
        for (const e of diaryEntries) {
            if (!e.date) continue;
            const d = e.date.slice(0, 10);
            if (!byDate[d]) byDate[d] = [];
            byDate[d].push(e);
        }

        let html = `
        <div class="cal-header">
            <button class="btn btn-secondary btn-sm" id="cal-prev-month">◀</button>
            <h3 class="cal-month-title">${monthNames[month]} ${year}</h3>
            <button class="btn btn-secondary btn-sm" id="cal-next-month">▶</button>
        </div>
        <div class="cal-weekdays"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div>
        <div class="cal-grid">`;

        for (let i = 0; i < firstDay; i++) html += '<div class="cal-day cal-day-empty"></div>';

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const entries = byDate[dateStr] || [];
            const isToday = dateStr === now.toISOString().slice(0, 10);
            const activeLabTests = labTests.filter(t => t.dateStart <= dateStr && t.dateEnd >= dateStr);
            const activeDiaryTests = diaryTests.filter(e => e.date?.slice(0, 10) === dateStr);

            let totalSales = 0, totalBudget = 0;
            for (const e of entries) { totalSales += e.sales || 0; totalBudget += e.budget || 0; }
            const cpa = totalSales > 0 ? totalBudget / totalSales : 0;
            const shopifyData = this._shopifyByDate[dateStr] || null;
            const shopifySales = shopifyData ? Number(shopifyData.sales || 0) : 0;
            const realCpa = shopifySales > 0 ? (totalBudget / shopifySales) : 0;

            let dayClass = '';
            if (entries.length) {
                const cpaForColor = shopifySales > 0 ? realCpa : cpa;
                const salesForColor = shopifySales > 0 ? shopifySales : totalSales;
                if (salesForColor > 0 && cpaForColor <= 30) dayClass = 'cal-day-green';
                else if (salesForColor > 0 && cpaForColor <= 60) dayClass = 'cal-day-yellow';
                else if (totalBudget > 0) dayClass = 'cal-day-red';
                else dayClass = 'cal-day-neutral';
            }

            const markers = activeLabTests.map(t => {
                const cat = this.CATEGORIES[t.category] || this.CATEGORIES.outro;
                return `<span class="cal-marker" style="background:${cat.color}" title="${this._esc(t.title)}"></span>`;
            }).join('') + (activeDiaryTests.length ? `<span class="cal-marker" style="background:#f59e0b"></span>` : '');

            const shopifyCell = shopifyData
                ? `<span class="cal-metric-shopify" title="Shopify: ${shopifySales}${realCpa > 0 ? ' / CPA Real: R$' + realCpa.toFixed(2) : ''}"><i data-lucide="shopping-cart" style="width:14px;height:14px;vertical-align:-2px"></i>${shopifySales}${realCpa > 0 ? ' · R$' + Math.round(realCpa) : ''}</span>`
                : '';

            html += `<div class="cal-day ${dayClass} ${isToday ? 'cal-day-today' : ''}" data-date="${dateStr}">
                <span class="cal-day-num">${day}</span>
                ${entries.length || shopifyData ? `<div class="cal-day-metrics">${totalSales ? `<span class="cal-metric-sales" title="Vendas Facebook">${totalSales}v</span>` : ''}${shopifyCell}${totalBudget ? `<span class="cal-metric-budget">R$${Math.round(totalBudget)}</span>` : ''}</div>` : ''}
                <div class="cal-markers">${markers}</div>
            </div>`;
        }

        html += '</div>';
        container.innerHTML = html;

        container.querySelectorAll('.cal-day[data-date]').forEach(d => {
            d.addEventListener('click', () => this._showDayPopup(d.dataset.date, byDate, labTests, diaryTests));
        });
        document.getElementById('cal-prev-month')?.addEventListener('click', () => this._navigateMonth(-1));
        document.getElementById('cal-next-month')?.addEventListener('click', () => this._navigateMonth(1));

        // Kick off Shopify preload (re-renders when loaded)
        this._ensureShopifyMonthData(year, month);
    },

    async _ensureShopifyMonthData(year, month) {
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured || !ShopifyModule.isConfigured()) return;
        const key = `${year}-${month}`;
        if (this._shopifyMonthKey === key) return;
        const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const lastDay = new Date(year, month + 1, 0).getDate();
        const last = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        try {
            const map = await ShopifyModule.getSalesMapByDate(first, last);
            this._shopifyByDate = map || {};
            this._shopifyMonthKey = key;
            // Re-render current month (avoid recursive fetch via key guard above)
            if (this._calYear != null && this._calMonth != null) {
                this._renderCalendarMonth(this._calYear, this._calMonth);
            } else {
                this._renderCalendar();
            }
        } catch (err) {
            console.warn('[Calendar] Shopify preload failed:', err);
        }
    },

    _showDayPopup(dateStr, byDate, labTests, diaryTests) {
        document.getElementById('cal-day-popup')?.remove();

        const entries = byDate[dateStr] || [];
        const activeTests = labTests.filter(t => t.dateStart <= dateStr && t.dateEnd >= dateStr);
        const dayDiaryTests = diaryTests.filter(e => e.date?.slice(0, 10) === dateStr);

        let totalSales = 0, totalBudget = 0, totalRevenue = 0, totalImpressions = 0;
        let totalCpc = 0, cpcCount = 0;
        for (const e of entries) {
            totalSales += e.sales || 0;
            totalBudget += e.budget || 0;
            totalRevenue += e.revenue || 0;
            totalImpressions += e.impressions || 0;
            if (e.cpc) { totalCpc += e.cpc; cpcCount++; }
        }
        const cpa = totalSales > 0 ? totalBudget / totalSales : 0;
        const avgCpc = cpcCount > 0 ? totalCpc / cpcCount : 0;
        const shopifyData = this._shopifyByDate[dateStr] || null;
        const shopifySales = shopifyData ? Number(shopifyData.sales || 0) : 0;
        const shopifyRevenue = shopifyData ? Number(shopifyData.revenue || 0) : 0;
        const realCpa = shopifySales > 0 ? totalBudget / shopifySales : 0;
        const diff = shopifyData && totalSales > 0 ? (shopifySales - totalSales) : 0;

        const popup = document.createElement('div');
        popup.id = 'cal-day-popup';
        popup.className = 'cal-popup';
        popup.innerHTML = `
            <div class="cal-popup-header">
                <strong><i data-lucide="calendar" style="width:14px;height:14px;vertical-align:-2px"></i> ${dateStr}</strong>
                <button class="btn-close" onclick="document.getElementById('cal-day-popup').remove()"><i data-lucide="x" style="width:14px;height:14px;vertical-align:-2px"></i></button>
            </div>
            ${entries.length ? `
            <div class="cal-popup-metrics">
                <div class="cal-popup-metric"><span>Vendas FB</span><strong>${totalSales}</strong></div>
                <div class="cal-popup-metric"><span>Vendas Shopify</span><strong>${shopifyData ? shopifySales + (diff !== 0 && totalSales > 0 ? ` <small style="color:${diff > 0 ? 'var(--green)' : 'var(--red)'}">(${diff > 0 ? '+' : ''}${diff})</small>` : '') : '-'}</strong></div>
                <div class="cal-popup-metric"><span>Orçamento</span><strong>R$${totalBudget.toFixed(2)}</strong></div>
                <div class="cal-popup-metric"><span>CPA</span><strong>${cpa > 0 ? 'R$' + cpa.toFixed(2) : '-'}</strong></div>
                <div class="cal-popup-metric"><span>CPA Real</span><strong>${realCpa > 0 ? 'R$' + realCpa.toFixed(2) : '-'}</strong></div>
                <div class="cal-popup-metric"><span>CPC</span><strong>${avgCpc > 0 ? 'R$' + avgCpc.toFixed(2) : '-'}</strong></div>
                ${shopifyRevenue > 0 ? `<div class="cal-popup-metric"><span>Receita Shopify</span><strong>${shopifyData.currency || ''} ${shopifyRevenue.toFixed(2)}</strong></div>` : ''}
            </div>` : (shopifyData ? `<div class="cal-popup-metrics"><div class="cal-popup-metric"><span>Vendas Shopify</span><strong>${shopifySales}</strong></div>${shopifyRevenue > 0 ? `<div class="cal-popup-metric"><span>Receita</span><strong>${shopifyData.currency || ''} ${shopifyRevenue.toFixed(2)}</strong></div>` : ''}</div>` : '<p style="color:var(--text-muted);font-size:0.8rem;margin:0.5rem 0">Sem dados do diário</p>')}
            ${activeTests.length ? `<div class="cal-popup-tests">
                <strong><i data-lucide="flask-conical" style="width:14px;height:14px;vertical-align:-2px"></i> Testes Lab:</strong>
                ${activeTests.map(t => `<div class="cal-popup-test">${this.CATEGORIES[t.category]?.icon || '<i data-lucide="pin" style="width:14px;height:14px;vertical-align:-2px"></i>'} ${this._esc(t.title)}</div>`).join('')}
            </div>` : ''}
            ${dayDiaryTests.length ? `<div class="cal-popup-tests">
                <strong><i data-lucide="bar-chart-3" style="width:14px;height:14px;vertical-align:-2px"></i> Testes Produto:</strong>
                ${dayDiaryTests.map(e => `<div class="cal-popup-test"><i data-lucide="tag" style="width:14px;height:14px;vertical-align:-2px"></i>️ ${this._esc(e.testGoal || e.testNotes || 'Teste')}</div>`).join('')}
            </div>` : ''}
        `;

        document.getElementById('diary-calendar-content')?.appendChild(popup);
    },

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    },

    // ── Multi-Stage support ───────────────────────────────────────────

    _genStageId() {
        return 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    },

    _renderStagesProgress(test) {
        if (!test.stages || !test.stages.length) return '';
        const stages = [...test.stages].sort((a, b) => a.order - b.order);
        const statusIcon = { pendente: '<i data-lucide="hourglass" style="width:14px;height:14px;vertical-align:-2px"></i>', em_andamento: '<i data-lucide="microscope" style="width:14px;height:14px;vertical-align:-2px"></i>', concluido: '<i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i>' };
        const statusColor = { pendente: '#9ca3af', em_andamento: 'var(--accent)', concluido: '#059669' };

        const steps = stages.map((s, i) => {
            const isActive = s.status === 'em_andamento';
            const isDone = s.status === 'concluido';
            return `<div class="lab-stage-step ${isActive ? 'lab-stage-active' : ''} ${isDone ? 'lab-stage-done' : ''}" data-stage-id="${s.id}" data-test-id="${test.id}">
                <div class="lab-stage-circle" style="background:${statusColor[s.status] || '#9ca3af'}" title="${s.status}">${statusIcon[s.status] || '<i data-lucide="hourglass" style="width:14px;height:14px;vertical-align:-2px"></i>'}</div>
                <div class="lab-stage-label">
                    <span>${this._esc(s.name || 'Fase ' + s.order)}</span>
                    ${s.result !== null && s.result !== undefined ? `<small style="color:${s.result === 'positivo' ? '#059669' : s.result === 'negativo' ? '#dc2626' : '#6b7280'}">${s.result}</small>` : ''}
                </div>
                ${i < stages.length - 1 ? '<div class="lab-stage-arrow"><i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i></div>' : ''}
            </div>`;
        }).join('');

        const activeStage = stages.find(s => s.status === 'em_andamento');
        const advanceBtn = activeStage
            ? `<button class="btn btn-secondary btn-sm lab-stage-advance-btn" data-test-id="${test.id}" data-stage-id="${activeStage.id}" style="margin-top:0.5rem;font-size:0.75rem">
                ▶ Avançar Fase: "${this._esc(activeStage.name || 'Fase ' + activeStage.order)}"
               </button>` : '';

        return `<div class="lab-stages-container">
            <div class="lab-stages-track">${steps}</div>
            ${advanceBtn}
            ${activeStage?.observations ? `<p class="lab-stage-obs">${this._esc(activeStage.observations)}</p>` : ''}
        </div>`;
    },

    _advanceStage(testId, stageId) {
        const test = this._tests.find(t => t.id === testId);
        if (!test || !test.stages) return;

        const stages = [...test.stages].sort((a, b) => a.order - b.order);
        const idx = stages.findIndex(s => s.id === stageId);
        if (idx < 0) return;

        const result = prompt('Resultado desta fase (positivo / negativo / neutro):') || 'neutro';
        const obs = prompt('Observações desta fase (opcional):') || '';

        stages[idx].status = 'concluido';
        stages[idx].result = ['positivo','negativo','neutro'].includes(result) ? result : 'neutro';
        stages[idx].observations = obs;

        // Start next stage
        if (idx + 1 < stages.length) {
            stages[idx + 1].status = 'em_andamento';
        }

        test.stages = stages;
        test.updatedAt = new Date().toISOString();
        this._persist();
        this._renderCards();
        showToast('Fase avançada!', 'success');
    },

    _buildStagesFromForm() {
        const rows = document.querySelectorAll('#test-stages-list .lab-stage-row');
        const stages = [];
        rows.forEach((row, i) => {
            const name = row.querySelector('.lab-stage-name')?.value?.trim() || ('Fase ' + (i + 1));
            const status = row.querySelector('.lab-stage-status')?.value || 'pendente';
            const obs = row.querySelector('.lab-stage-obs-input')?.value?.trim() || '';
            stages.push({
                id: row.dataset.stageId || this._genStageId(),
                order: i + 1,
                name,
                status: i === 0 && stages.length === 0 ? 'em_andamento' : status,
                result: null,
                observations: obs,
            });
        });
        return stages;
    },

    _addStageRow(container, stage = null, index = 0) {
        const stageId = stage?.id || this._genStageId();
        const row = document.createElement('div');
        row.className = 'lab-stage-row';
        row.dataset.stageId = stageId;
        row.style.cssText = 'display:flex;gap:0.5rem;align-items:center;margin-bottom:0.35rem';
        row.innerHTML = `
            <span style="color:var(--text-muted);font-size:0.75rem;min-width:50px">Fase ${index + 1}</span>
            <input class="input lab-stage-name" type="text" placeholder="Nome da fase" value="${this._esc(stage?.name || '')}" style="flex:2">
            <select class="input lab-stage-status" style="flex:1">
                <option value="pendente" ${(!stage || stage.status === 'pendente') ? 'selected' : ''}><i data-lucide="hourglass" style="width:14px;height:14px;vertical-align:-2px"></i> Pendente</option>
                <option value="em_andamento" ${stage?.status === 'em_andamento' ? 'selected' : ''}><i data-lucide="microscope" style="width:14px;height:14px;vertical-align:-2px"></i> Em andamento</option>
                <option value="concluido" ${stage?.status === 'concluido' ? 'selected' : ''}><i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Concluído</option>
            </select>
            <input class="input lab-stage-obs-input" type="text" placeholder="Observações" value="${this._esc(stage?.observations || '')}" style="flex:2">
            <button type="button" class="btn-icon lab-stage-del" style="color:var(--red)" title="Remover fase">×</button>
        `;
        row.querySelector('.lab-stage-del')?.addEventListener('click', () => row.remove());
        container.appendChild(row);
    },
};
