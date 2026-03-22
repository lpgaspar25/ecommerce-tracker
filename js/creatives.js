/* ===========================
   Creatives.js — Creative management, metrics tracking, fatigue detection
   Ad text variations (headline, description, primary text)
   Test tracking with validation workflow
   =========================== */

const CreativesModule = {
    STORAGE_KEY_CREATIVES: 'etracker_creatives',
    STORAGE_KEY_METRICS: 'etracker_creative_metrics',

    CREATIVE_TYPES: ['UGC', 'Demonstrativo', 'POV', 'Imagem', 'Carrossel', 'Before/After', 'Meme', 'Review'],
    HOOK_TYPES: ['Pergunta', 'Choque', 'Curiosidade', 'POV', 'Antes/Depois', 'Dor', 'Desejo', 'Autoridade'],
    STATUSES: [
        { id: 'ativo', label: 'Ativo', color: 'var(--blue)' },
        { id: 'pausado', label: 'Pausado', color: 'var(--text-muted)' },
        { id: 'winner', label: 'Winner', color: 'var(--green)' },
        { id: 'killed', label: 'Killed', color: 'var(--red)' },
        { id: 'teste', label: 'Em Teste', color: 'var(--orange)' }
    ],

    init() {
        document.getElementById('btn-add-creative')?.addEventListener('click', () => this.openForm());
        document.getElementById('creative-form')?.addEventListener('submit', (e) => this.handleSubmit(e));
        document.getElementById('creative-cancel')?.addEventListener('click', () => closeModal('creative-modal'));
        document.getElementById('metric-form')?.addEventListener('submit', (e) => this.handleMetricSubmit(e));
        document.getElementById('metric-cancel')?.addEventListener('click', () => closeModal('metric-modal'));
        document.getElementById('creative-product-filter')?.addEventListener('change', () => this.render());
        document.getElementById('creative-status-filter')?.addEventListener('change', () => this.render());

        // Test variation form
        document.getElementById('variation-form')?.addEventListener('submit', (e) => this.handleVariationSubmit(e));
        document.getElementById('variation-cancel')?.addEventListener('click', () => closeModal('variation-modal'));

        // Comparison
        document.getElementById('btn-compare-creatives')?.addEventListener('click', () => this.toggleCompareMode());

        EventBus.on('dataLoaded', () => this.render());
        EventBus.on('creativesChanged', () => this.render());
        EventBus.on('storeChanged', () => this.render());
    },

    // ---- Data Access ----
    getCreatives() {
        return AppState.creatives || [];
    },

    getCreativeMetrics() {
        return AppState.creativeMetrics || [];
    },

    getCreativeById(id) {
        return (AppState.allCreatives || []).find(c => c.id === id);
    },

    getMetricsForCreative(creativeId) {
        return (AppState.allCreativeMetrics || []).filter(m => m.creativeId === creativeId)
            .sort((a, b) => a.date.localeCompare(b.date));
    },

    // ---- CRUD Creatives ----
    openForm(creative = null) {
        const title = document.getElementById('creative-modal-title');
        const form = document.getElementById('creative-form');
        if (!form) return;
        form.reset();

        // Populate product dropdown
        const productSelect = document.getElementById('creative-product');
        if (productSelect) {
            while (productSelect.options.length > 1) productSelect.remove(1);
            AppState.products.forEach(p => {
                if (p.status === 'ativo') {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    productSelect.appendChild(opt);
                }
            });
        }

        if (creative) {
            title.textContent = 'Editar Criativo';
            document.getElementById('creative-id').value = creative.id;
            document.getElementById('creative-name').value = creative.name;
            document.getElementById('creative-product').value = creative.productId;
            document.getElementById('creative-type').value = creative.type;
            document.getElementById('creative-angle').value = creative.angle || '';
            document.getElementById('creative-hook-text').value = creative.hookText || '';
            document.getElementById('creative-hook-type').value = creative.hookType || '';
            document.getElementById('creative-platform').value = creative.platform || 'Meta Ads';
            document.getElementById('creative-status').value = creative.status || 'ativo';
            document.getElementById('creative-launch-date').value = creative.launchDate || '';
            // Ad text fields
            document.getElementById('creative-primary-text').value = creative.primaryText || '';
            document.getElementById('creative-headline').value = creative.headline || '';
            document.getElementById('creative-description').value = creative.adDescription || '';
        } else {
            title.textContent = 'Novo Criativo';
            document.getElementById('creative-id').value = '';
            document.getElementById('creative-launch-date').value = todayISO();
        }

        openModal('creative-modal');
    },

    async handleSubmit(e) {
        e.preventDefault();

        const id = document.getElementById('creative-id').value || generateId('crtv');
        const productId = document.getElementById('creative-product').value;
        if (!productId) {
            showToast('Selecione um produto para o criativo.', 'error');
            return;
        }

        const data = {
            id,
            productId,
            name: document.getElementById('creative-name').value.trim(),
            type: document.getElementById('creative-type').value,
            angle: document.getElementById('creative-angle').value.trim(),
            hookText: document.getElementById('creative-hook-text').value.trim(),
            hookType: document.getElementById('creative-hook-type').value,
            platform: document.getElementById('creative-platform').value,
            status: document.getElementById('creative-status').value || 'ativo',
            launchDate: document.getElementById('creative-launch-date').value,
            // Ad copy fields
            primaryText: document.getElementById('creative-primary-text').value.trim(),
            headline: document.getElementById('creative-headline').value.trim(),
            adDescription: document.getElementById('creative-description').value.trim(),
            // Test variations
            variations: [],
            storeId: getWritableStoreId(productId),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const existingIdx = (AppState.allCreatives || []).findIndex(c => c.id === id);
        if (existingIdx >= 0) {
            data.variations = AppState.allCreatives[existingIdx].variations || [];
            data.createdAt = AppState.allCreatives[existingIdx].createdAt;
            AppState.allCreatives[existingIdx] = data;
            showToast('Criativo atualizado!', 'success');
        } else {
            AppState.allCreatives.push(data);
            showToast('Criativo adicionado!', 'success');
        }

        if (AppState.sheetsConnected && typeof SheetsAPI !== 'undefined' && SheetsAPI.TABS.CREATIVES) {
            try {
                if (existingIdx >= 0) {
                    await SheetsAPI.updateRowById(SheetsAPI.TABS.CREATIVES, data.id, SheetsAPI.creativeToRow(data));
                } else {
                    await SheetsAPI.appendRow(SheetsAPI.TABS.CREATIVES, SheetsAPI.creativeToRow(data));
                }
            } catch (err) { console.error('Sheets sync error:', err); }
        }

        filterDataByStore();
        closeModal('creative-modal');
        LocalStore.save('creatives', AppState.allCreatives);
        EventBus.emit('creativesChanged');
    },

    async deleteCreative(id) {
        if (!confirm('Excluir este criativo e todas suas metricas?')) return;

        AppState.allCreatives = (AppState.allCreatives || []).filter(c => c.id !== id);
        AppState.allCreativeMetrics = (AppState.allCreativeMetrics || []).filter(m => m.creativeId !== id);

        filterDataByStore();
        LocalStore.save('creatives', AppState.allCreatives);
        LocalStore.save('creative_metrics', AppState.allCreativeMetrics);
        EventBus.emit('creativesChanged');
        showToast('Criativo excluido', 'info');
    },

    // ---- Metric Entry ----
    openMetricForm(creativeId) {
        const creative = this.getCreativeById(creativeId);
        if (!creative) return;

        const form = document.getElementById('metric-form');
        if (!form) return;
        form.reset();

        document.getElementById('metric-creative-id').value = creativeId;
        document.getElementById('metric-creative-name').textContent = creative.name;
        document.getElementById('metric-date').value = todayISO();
        document.getElementById('metric-currency').value = 'USD';

        openModal('metric-modal');
    },

    async handleMetricSubmit(e) {
        e.preventDefault();

        const creativeId = document.getElementById('metric-creative-id').value;
        const spend = parseFloat(document.getElementById('metric-spend').value) || 0;
        const impressions = parseInt(document.getElementById('metric-impressions').value) || 0;
        const clicks = parseInt(document.getElementById('metric-clicks').value) || 0;
        const conversions = parseInt(document.getElementById('metric-conversions').value) || 0;
        const revenue = parseFloat(document.getElementById('metric-revenue').value) || 0;

        const creative = this.getCreativeById(creativeId);
        if (!creative) return;

        const data = {
            id: generateId('cm'),
            creativeId,
            date: document.getElementById('metric-date').value,
            spend,
            impressions,
            clicks,
            ctr: impressions > 0 ? parseFloat((clicks / impressions * 100).toFixed(2)) : 0,
            cpc: clicks > 0 ? parseFloat((spend / clicks).toFixed(2)) : 0,
            cpm: impressions > 0 ? parseFloat((spend / impressions * 1000).toFixed(2)) : 0,
            conversions,
            revenue,
            roas: spend > 0 ? parseFloat((revenue / spend).toFixed(2)) : 0,
            currency: document.getElementById('metric-currency').value,
            storeId: creative.storeId || ''
        };

        AppState.allCreativeMetrics = AppState.allCreativeMetrics || [];
        AppState.allCreativeMetrics.push(data);

        filterDataByStore();
        closeModal('metric-modal');
        LocalStore.save('creative_metrics', AppState.allCreativeMetrics);
        EventBus.emit('creativesChanged');
        showToast('Metrica registrada!', 'success');
    },

    // ---- Test Variations (ad text A/B testing) ----
    openVariationForm(creativeId) {
        const creative = this.getCreativeById(creativeId);
        if (!creative) return;

        const form = document.getElementById('variation-form');
        if (!form) return;
        form.reset();

        document.getElementById('variation-creative-id').value = creativeId;
        document.getElementById('variation-creative-name').textContent = creative.name;
        document.getElementById('variation-start-date').value = todayISO();

        openModal('variation-modal');
    },

    handleVariationSubmit(e) {
        e.preventDefault();

        const creativeId = document.getElementById('variation-creative-id').value;
        const creative = this.getCreativeById(creativeId);
        if (!creative) return;

        const variation = {
            id: generateId('var'),
            name: document.getElementById('variation-name').value.trim(),
            element: document.getElementById('variation-element').value, // primaryText, headline, description
            originalValue: document.getElementById('variation-original').value.trim(),
            testValue: document.getElementById('variation-test').value.trim(),
            startDate: document.getElementById('variation-start-date').value,
            endDate: document.getElementById('variation-end-date').value,
            status: 'pendente', // pendente, validado, nao_validado
            notes: document.getElementById('variation-notes').value.trim()
        };

        creative.variations = creative.variations || [];
        creative.variations.push(variation);
        creative.updatedAt = new Date().toISOString();

        LocalStore.save('creatives', AppState.allCreatives);
        closeModal('variation-modal');
        EventBus.emit('creativesChanged');
        showToast('Variacao de teste adicionada!', 'success');
    },

    validateVariation(creativeId, variationId, result) {
        const creative = this.getCreativeById(creativeId);
        if (!creative) return;

        const variation = (creative.variations || []).find(v => v.id === variationId);
        if (!variation) return;

        variation.status = result; // 'validado' or 'nao_validado'
        variation.validatedAt = new Date().toISOString();
        creative.updatedAt = new Date().toISOString();

        LocalStore.save('creatives', AppState.allCreatives);
        EventBus.emit('creativesChanged');
        showToast(`Variacao ${result === 'validado' ? 'validada' : 'nao validada'}!`, result === 'validado' ? 'success' : 'info');
    },

    // ---- Fatigue Detection ----
    detectFatigue(creativeId) {
        const metrics = this.getMetricsForCreative(creativeId);
        if (metrics.length < 3) return { fatigued: false, reason: '' };

        const recent = metrics.slice(-7);
        if (recent.length < 3) return { fatigued: false, reason: '' };

        // Check CTR declining trend (3+ consecutive days)
        let decliningCTR = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i].ctr < recent[i - 1].ctr) decliningCTR++;
            else decliningCTR = 0;
        }

        // Check CPC rising trend
        let risingCPC = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i].cpc > recent[i - 1].cpc) risingCPC++;
            else risingCPC = 0;
        }

        // Peak CTR comparison
        const peakCTR = Math.max(...metrics.map(m => m.ctr));
        const currentCTR = recent[recent.length - 1].ctr;
        const ctrDrop = peakCTR > 0 ? ((peakCTR - currentCTR) / peakCTR * 100) : 0;

        if (decliningCTR >= 3 && ctrDrop > 30) {
            return { fatigued: true, reason: `CTR caiu ${ctrDrop.toFixed(0)}% do pico (${peakCTR.toFixed(2)}% -> ${currentCTR.toFixed(2)}%)`, severity: 'high' };
        }
        if (risingCPC >= 3) {
            return { fatigued: true, reason: `CPC subindo ha ${risingCPC} dias seguidos`, severity: 'medium' };
        }
        if (ctrDrop > 40) {
            return { fatigued: true, reason: `CTR ${ctrDrop.toFixed(0)}% abaixo do pico`, severity: 'high' };
        }

        return { fatigued: false, reason: '' };
    },

    // Freshness score (days since launch)
    getFreshness(creative) {
        if (!creative.launchDate) return { days: 0, level: 'unknown' };
        const days = Math.floor((new Date() - new Date(creative.launchDate)) / 86400000);
        const level = days <= 5 ? 'fresh' : (days <= 10 ? 'warming' : 'old');
        return { days, level };
    },

    // ---- Aggregate Stats ----
    getCreativeStats(creativeId) {
        const metrics = this.getMetricsForCreative(creativeId);
        if (metrics.length === 0) return null;

        const totalSpend = metrics.reduce((s, m) => s + m.spend, 0);
        const totalClicks = metrics.reduce((s, m) => s + m.clicks, 0);
        const totalImpressions = metrics.reduce((s, m) => s + m.impressions, 0);
        const totalConversions = metrics.reduce((s, m) => s + m.conversions, 0);
        const totalRevenue = metrics.reduce((s, m) => s + m.revenue, 0);

        return {
            totalSpend,
            totalClicks,
            totalImpressions,
            totalConversions,
            totalRevenue,
            avgCTR: totalImpressions > 0 ? (totalClicks / totalImpressions * 100) : 0,
            avgCPC: totalClicks > 0 ? (totalSpend / totalClicks) : 0,
            avgCPM: totalImpressions > 0 ? (totalSpend / totalImpressions * 1000) : 0,
            roas: totalSpend > 0 ? (totalRevenue / totalSpend) : 0,
            cpa: totalConversions > 0 ? (totalSpend / totalConversions) : 0,
            days: metrics.length
        };
    },

    // ---- Compare Mode ----
    _compareMode: false,
    _selectedForCompare: new Set(),

    toggleCompareMode() {
        this._compareMode = !this._compareMode;
        this._selectedForCompare.clear();
        this.render();
    },

    toggleCompareSelection(creativeId) {
        if (this._selectedForCompare.has(creativeId)) {
            this._selectedForCompare.delete(creativeId);
        } else if (this._selectedForCompare.size < 4) {
            this._selectedForCompare.add(creativeId);
        } else {
            showToast('Maximo 4 criativos para comparar', 'error');
        }
        this.render();
    },

    // ---- Render ----
    render() {
        const container = document.getElementById('creatives-list');
        if (!container) return;

        const productFilter = document.getElementById('creative-product-filter')?.value || 'todos';
        const statusFilter = document.getElementById('creative-status-filter')?.value || 'todos';

        let creatives = this.getCreatives();

        if (productFilter !== 'todos') {
            creatives = creatives.filter(c => c.productId === productFilter);
        }
        if (statusFilter !== 'todos') {
            creatives = creatives.filter(c => c.status === statusFilter);
        }

        if (creatives.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>Nenhum criativo cadastrado. Clique em "+ Novo Criativo".</p></div>';
            this.renderComparePanel([]);
            return;
        }

        // Group by product
        const grouped = {};
        creatives.forEach(c => {
            const pname = getProductName(c.productId);
            if (!grouped[pname]) grouped[pname] = [];
            grouped[pname].push(c);
        });

        container.innerHTML = Object.entries(grouped).map(([productName, items]) => {
            const cards = items.map(c => this.renderCreativeCard(c)).join('');
            return `<div class="creative-product-group">
                <h3 class="creative-group-title">${this._escapeHtml(productName)}</h3>
                <div class="creative-cards-grid">${cards}</div>
            </div>`;
        }).join('');

        // Render comparison panel if items selected
        if (this._compareMode && this._selectedForCompare.size >= 2) {
            this.renderComparePanel([...this._selectedForCompare]);
        } else {
            this.renderComparePanel([]);
        }

        // Render fatigue summary
        this.renderFatigueSummary(creatives);
    },

    renderCreativeCard(creative) {
        const stats = this.getCreativeStats(creative.id);
        const fatigue = this.detectFatigue(creative.id);
        const freshness = this.getFreshness(creative);
        const statusObj = this.STATUSES.find(s => s.id === creative.status) || this.STATUSES[0];
        const variations = creative.variations || [];
        const activeTests = variations.filter(v => v.status === 'pendente');
        const winners = variations.filter(v => v.status === 'validado');

        const compareCheckbox = this._compareMode
            ? `<label class="compare-checkbox"><input type="checkbox" ${this._selectedForCompare.has(creative.id) ? 'checked' : ''} onchange="CreativesModule.toggleCompareSelection('${creative.id}')"> Comparar</label>`
            : '';

        const freshnessClass = freshness.level === 'fresh' ? 'freshness-fresh' : (freshness.level === 'warming' ? 'freshness-warming' : 'freshness-old');

        return `<div class="creative-card ${fatigue.fatigued ? 'creative-fatigued' : ''} ${creative.status === 'winner' ? 'creative-winner' : ''}">
            <div class="creative-card-header">
                <div>
                    <strong class="creative-card-name">${this._escapeHtml(creative.name)}</strong>
                    <div class="creative-card-type">${this._escapeHtml(creative.type || '')} ${creative.angle ? '• ' + this._escapeHtml(creative.angle) : ''}</div>
                </div>
                <div class="creative-card-badges">
                    <span class="creative-status-badge" style="background:${statusObj.color}">${statusObj.label}</span>
                    ${fatigue.fatigued ? `<span class="creative-fatigue-badge" title="${this._escapeHtml(fatigue.reason)}">🔥 Fadiga</span>` : ''}
                    <span class="creative-freshness-badge ${freshnessClass}">${freshness.days}d</span>
                    ${activeTests.length > 0 ? `<span class="creative-test-badge">🧪 ${activeTests.length} teste(s)</span>` : ''}
                    ${winners.length > 0 ? `<span class="creative-winner-badge">🏆 ${winners.length} validado(s)</span>` : ''}
                    ${compareCheckbox}
                </div>
            </div>

            ${creative.hookText ? `<div class="creative-hook"><strong>Hook:</strong> ${this._escapeHtml(creative.hookText)}</div>` : ''}

            ${(creative.primaryText || creative.headline || creative.adDescription) ? `
            <div class="creative-ad-copy">
                ${creative.headline ? `<div class="ad-copy-field"><label>Titulo:</label> <span>${this._escapeHtml(creative.headline)}</span></div>` : ''}
                ${creative.primaryText ? `<div class="ad-copy-field"><label>Texto Principal:</label> <span>${this._escapeHtml(creative.primaryText).substring(0, 80)}${creative.primaryText.length > 80 ? '...' : ''}</span></div>` : ''}
                ${creative.adDescription ? `<div class="ad-copy-field"><label>Descricao:</label> <span>${this._escapeHtml(creative.adDescription)}</span></div>` : ''}
            </div>` : ''}

            ${stats ? `
            <div class="creative-metrics-grid">
                <div class="creative-metric"><label>Gasto</label><strong>${formatCurrency(stats.totalSpend, 'USD')}</strong></div>
                <div class="creative-metric"><label>CTR</label><strong>${stats.avgCTR.toFixed(2)}%</strong></div>
                <div class="creative-metric"><label>CPC</label><strong>${formatCurrency(stats.avgCPC, 'USD')}</strong></div>
                <div class="creative-metric"><label>CPM</label><strong>${formatCurrency(stats.avgCPM, 'USD')}</strong></div>
                <div class="creative-metric"><label>Conv.</label><strong>${stats.totalConversions}</strong></div>
                <div class="creative-metric"><label>ROAS</label><strong>${stats.roas.toFixed(2)}x</strong></div>
            </div>` : '<div class="creative-no-metrics">Sem metricas registradas</div>'}

            ${variations.length > 0 ? this.renderVariations(creative.id, variations) : ''}

            <div class="creative-card-actions">
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.openForm(CreativesModule.getCreativeById('${creative.id}'))">Editar</button>
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.openMetricForm('${creative.id}')">+ Metrica</button>
                <button class="btn btn-secondary btn-sm" onclick="CreativesModule.openVariationForm('${creative.id}')">🧪 Testar Variacao</button>
                <button class="btn btn-danger btn-sm" onclick="CreativesModule.deleteCreative('${creative.id}')">Excluir</button>
            </div>
        </div>`;
    },

    renderVariations(creativeId, variations) {
        const elementLabels = { primaryText: 'Texto Principal', headline: 'Titulo', description: 'Descricao' };

        const rows = variations.map(v => {
            const statusClass = v.status === 'validado' ? 'var-validated' : (v.status === 'nao_validado' ? 'var-rejected' : 'var-pending');
            const statusLabel = v.status === 'validado' ? '✅ Validado' : (v.status === 'nao_validado' ? '❌ Nao validado' : '⏳ Pendente');

            return `<div class="variation-row ${statusClass}">
                <div class="variation-info">
                    <strong>${this._escapeHtml(v.name || 'Teste')}</strong>
                    <span class="variation-element">${elementLabels[v.element] || v.element}</span>
                    <span class="variation-dates">${v.startDate ? formatDate(v.startDate) : ''} ${v.endDate ? '→ ' + formatDate(v.endDate) : ''}</span>
                </div>
                <div class="variation-values">
                    <div class="variation-original" title="Original">${this._escapeHtml((v.originalValue || '').substring(0, 50))}</div>
                    <span class="variation-vs">vs</span>
                    <div class="variation-test" title="Teste">${this._escapeHtml((v.testValue || '').substring(0, 50))}</div>
                </div>
                <div class="variation-status">
                    <span class="${statusClass}">${statusLabel}</span>
                    ${v.status === 'pendente' ? `
                        <button class="btn btn-sm" style="background:var(--green);color:#fff" onclick="CreativesModule.validateVariation('${creativeId}','${v.id}','validado')">✓</button>
                        <button class="btn btn-sm" style="background:var(--red);color:#fff" onclick="CreativesModule.validateVariation('${creativeId}','${v.id}','nao_validado')">✗</button>
                    ` : ''}
                </div>
            </div>`;
        }).join('');

        return `<div class="creative-variations">
            <div class="variations-title">🧪 Testes de Variacao (${variations.length})</div>
            ${rows}
        </div>`;
    },

    renderComparePanel(creativeIds) {
        const panel = document.getElementById('compare-panel');
        if (!panel) return;

        if (creativeIds.length < 2) {
            panel.innerHTML = '';
            panel.style.display = 'none';
            return;
        }

        const data = creativeIds.map(id => {
            const c = this.getCreativeById(id);
            const s = this.getCreativeStats(id);
            const f = this.detectFatigue(id);
            return { creative: c, stats: s, fatigue: f };
        }).filter(d => d.creative);

        const headers = ['Metrica', ...data.map(d => d.creative.name)];
        const metricsRows = [
            ['Gasto', ...data.map(d => d.stats ? formatCurrency(d.stats.totalSpend, 'USD') : '--')],
            ['CTR', ...data.map(d => d.stats ? d.stats.avgCTR.toFixed(2) + '%' : '--')],
            ['CPC', ...data.map(d => d.stats ? formatCurrency(d.stats.avgCPC, 'USD') : '--')],
            ['CPM', ...data.map(d => d.stats ? formatCurrency(d.stats.avgCPM, 'USD') : '--')],
            ['Conv.', ...data.map(d => d.stats ? String(d.stats.totalConversions) : '--')],
            ['ROAS', ...data.map(d => d.stats ? d.stats.roas.toFixed(2) + 'x' : '--')],
            ['CPA', ...data.map(d => d.stats ? formatCurrency(d.stats.cpa, 'USD') : '--')],
            ['Fadiga', ...data.map(d => d.fatigue.fatigued ? '🔥 ' + d.fatigue.reason : '✅ OK')],
        ];

        // Highlight best value per row
        const bestIdx = metricsRows.map((row, ri) => {
            if (ri === 7) return -1; // fatigue row
            const nums = row.slice(1).map(v => parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0);
            if (ri === 0 || ri === 2 || ri === 3 || ri === 6) {
                // Lower is better for spend, CPC, CPM, CPA
                return nums.indexOf(Math.min(...nums));
            }
            // Higher is better for CTR, Conv, ROAS
            return nums.indexOf(Math.max(...nums));
        });

        panel.style.display = 'block';
        panel.innerHTML = `<h4>Comparacao de Criativos</h4>
            <table class="compare-table">
                <thead><tr>${headers.map(h => `<th>${this._escapeHtml(h)}</th>`).join('')}</tr></thead>
                <tbody>${metricsRows.map((row, ri) => `<tr>${row.map((cell, ci) =>
                    `<td ${ci > 0 && bestIdx[ri] === ci - 1 ? 'class="compare-best"' : ''}>${cell}</td>`
                ).join('')}</tr>`).join('')}</tbody>
            </table>
            <button class="btn btn-secondary btn-sm" onclick="CreativesModule.toggleCompareMode()" style="margin-top:0.5rem">Fechar Comparacao</button>`;
    },

    renderFatigueSummary(creatives) {
        const summaryEl = document.getElementById('creative-fatigue-summary');
        if (!summaryEl) return;

        const fatigued = creatives.filter(c => {
            if (c.status === 'killed' || c.status === 'pausado') return false;
            return this.detectFatigue(c.id).fatigued;
        });

        if (fatigued.length === 0) {
            summaryEl.innerHTML = '';
            return;
        }

        summaryEl.innerHTML = `<div class="fatigue-alert">
            <strong>⚠️ ${fatigued.length} criativo(s) com fadiga detectada:</strong>
            <ul>${fatigued.map(c => {
                const f = this.detectFatigue(c.id);
                return `<li><strong>${this._escapeHtml(c.name)}</strong>: ${this._escapeHtml(f.reason)}</li>`;
            }).join('')}</ul>
        </div>`;
    },

    _escapeHtml(raw) {
        return String(raw || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
};

// Global helper for diary to look up creative names
function getCreativeName(id) {
    const c = (AppState.allCreatives || []).find(cr => cr.id === id);
    return c ? c.name : '';
}

document.addEventListener('DOMContentLoaded', () => CreativesModule.init());
