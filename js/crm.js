/* ===========================
   CRM Module — Chargeback & Atendimento
   =========================== */

const CRMModule = {
    _storageKey: 'etracker_crm_data',
    _data: [],

    init() {
        this._load();
        this._bindEvents();
        this.render();
    },

    _load() {
        try { this._data = JSON.parse(localStorage.getItem(this._storageKey)) || []; }
        catch { this._data = []; }
    },

    _persist() {
        localStorage.setItem(this._storageKey, JSON.stringify(this._data));
    },

    _bindEvents() {
        document.getElementById('btn-crm-new-month')?.addEventListener('click', () => this._openModal());
        document.getElementById('btn-save-crm-entry')?.addEventListener('click', () => this._handleSave());
        document.getElementById('crm-modal-close')?.addEventListener('click', () => this._closeModal());
        document.getElementById('crm-modal-cancel')?.addEventListener('click', () => this._closeModal());
        document.getElementById('crm-modal')?.querySelector('.modal-overlay')?.addEventListener('click', () => this._closeModal());
        document.getElementById('btn-crm-projection')?.addEventListener('click', () => this._calcProjection());

        // Auto-calc chargeback pct
        ['crm-revenue','crm-chargeback-amount'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => this._autoCalcPct());
        });
    },

    _autoCalcPct() {
        const rev = parseFloat(document.getElementById('crm-revenue')?.value) || 0;
        const cb = parseFloat(document.getElementById('crm-chargeback-amount')?.value) || 0;
        const pctEl = document.getElementById('crm-chargeback-pct');
        if (pctEl) pctEl.value = rev > 0 ? (cb / rev * 100).toFixed(2) : '0';
    },

    render() {
        const panel = document.getElementById('crm-panel-content');
        if (!panel) return;

        const data = [...this._data].sort((a, b) => b.month.localeCompare(a.month));

        // Summary stats
        const avgCbPct = data.length > 0
            ? (data.reduce((s, d) => s + (d.chargebackPct || 0), 0) / data.length).toFixed(2)
            : 0;
        const avgTickets = data.length > 0
            ? Math.round(data.reduce((s, d) => s + (d.supportTickets || 0), 0) / data.length)
            : 0;
        const avgResolution = data.length > 0
            ? (data.reduce((s, d) => s + (d.resolutionRate || 0), 0) / data.length).toFixed(1)
            : 0;

        panel.innerHTML = `
            <div class="crm-stats-row">
                <div class="crm-stat-card">
                    <span class="crm-stat-val" style="color:${parseFloat(avgCbPct) > 2 ? '#dc2626' : '#059669'}">${avgCbPct}%</span>
                    <span class="crm-stat-lbl">Chargeback Médio</span>
                </div>
                <div class="crm-stat-card">
                    <span class="crm-stat-val">${avgTickets}</span>
                    <span class="crm-stat-lbl">Tickets/Mês (média)</span>
                </div>
                <div class="crm-stat-card">
                    <span class="crm-stat-val" style="color:#059669">${avgResolution}%</span>
                    <span class="crm-stat-lbl">Taxa Resolução Média</span>
                </div>
                <div class="crm-stat-card">
                    <span class="crm-stat-val">${data.length}</span>
                    <span class="crm-stat-lbl">Meses Registrados</span>
                </div>
            </div>

            <div class="crm-table-wrap">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Mês</th>
                            <th>Receita</th>
                            <th>Chargeback R$</th>
                            <th>Chargeback %</th>
                            <th>Tickets</th>
                            <th>T. Resp. (h)</th>
                            <th>Resolução %</th>
                            <th>Notas</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.length === 0 ? '<tr><td colspan="9" style="text-align:center;color:var(--text-muted);padding:1.5rem">Nenhum dado registrado ainda.</td></tr>' : data.map(d => this._renderRow(d)).join('')}
                    </tbody>
                </table>
            </div>

            <div class="crm-projection-section">
                <div class="crm-section-label">📈 Simulador de Impacto</div>
                <div class="crm-projection-row">
                    <div class="form-group" style="flex:1">
                        <label>Se vendas crescerem (%)</label>
                        <input type="number" id="crm-growth-input" class="input" placeholder="Ex: 20" min="0" step="1">
                    </div>
                    <div class="form-group" style="flex:1">
                        <label>Taxa de crescimento chargeback (%)</label>
                        <input type="number" id="crm-cb-growth-input" class="input" placeholder="Ex: 50" min="0" step="1">
                    </div>
                    <button id="btn-crm-projection" class="btn btn-secondary" style="align-self:flex-end">Calcular</button>
                </div>
                <div id="crm-projection-result" class="crm-projection-result"></div>
            </div>
        `;

        // Re-bind delete buttons
        panel.querySelectorAll('.btn-crm-del').forEach(btn => {
            btn.addEventListener('click', () => {
                if (confirm('Excluir este registro?')) {
                    this._data = this._data.filter(d => d.id !== btn.dataset.id);
                    this._persist();
                    this.render();
                }
            });
        });

        panel.querySelectorAll('.btn-crm-edit').forEach(btn => {
            btn.addEventListener('click', () => this._openModal(btn.dataset.id));
        });

        document.getElementById('btn-crm-projection')?.addEventListener('click', () => this._calcProjection());
    },

    _renderRow(d) {
        const cbColor = (d.chargebackPct || 0) > 2 ? 'color:#dc2626;font-weight:600' : '';
        return `<tr>
            <td>${d.month}</td>
            <td>${d.revenueCurrency === 'USD' ? 'U$' : 'R$'}${Number(d.revenue || 0).toLocaleString('pt-BR')}</td>
            <td>${d.chargebackCurrency === 'USD' ? 'U$' : 'R$'}${Number(d.chargebackAmount || 0).toLocaleString('pt-BR')}</td>
            <td style="${cbColor}">${(d.chargebackPct || 0).toFixed(2)}%</td>
            <td>${d.supportTickets || 0}</td>
            <td>${d.avgResponseTimeHours || '-'}</td>
            <td>${(d.resolutionRate || 0).toFixed(1)}%</td>
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${this._esc(d.notes || '')}">${this._esc(d.notes || '')}</td>
            <td>
                <button class="btn-crm-edit btn-icon" data-id="${d.id}" title="Editar">✏️</button>
                <button class="btn-crm-del btn-icon" data-id="${d.id}" title="Excluir" style="color:var(--red)">×</button>
            </td>
        </tr>`;
    },

    _calcProjection() {
        const resultEl = document.getElementById('crm-projection-result');
        if (!resultEl) return;

        const salesGrowth = parseFloat(document.getElementById('crm-growth-input')?.value) || 0;
        const cbGrowth = parseFloat(document.getElementById('crm-cb-growth-input')?.value) || 50;

        const data = [...this._data].sort((a, b) => b.month.localeCompare(a.month));
        if (data.length === 0) {
            resultEl.innerHTML = '<p style="color:var(--text-muted)">Nenhum dado disponível para projeção.</p>';
            return;
        }

        const latest = data[0];
        const newRevenue = (latest.revenue || 0) * (1 + salesGrowth / 100);
        const newCbAmount = (latest.chargebackAmount || 0) * (1 + (salesGrowth * cbGrowth / 100) / 100);
        const newCbPct = newRevenue > 0 ? (newCbAmount / newRevenue * 100) : 0;
        const newTickets = Math.round((latest.supportTickets || 0) * (1 + salesGrowth / 100));

        const cbColor = newCbPct > 2 ? '#dc2626' : '#059669';
        resultEl.innerHTML = `
            <div class="crm-proj-result-grid">
                <div class="crm-proj-item">
                    <span class="crm-proj-label">Receita projetada</span>
                    <span class="crm-proj-val">${latest.revenueCurrency === 'USD' ? 'U$' : 'R$'}${newRevenue.toLocaleString('pt-BR', {maximumFractionDigits:0})}</span>
                </div>
                <div class="crm-proj-item">
                    <span class="crm-proj-label">Chargeback projetado</span>
                    <span class="crm-proj-val" style="color:${cbColor}">${latest.chargebackCurrency === 'USD' ? 'U$' : 'R$'}${newCbAmount.toLocaleString('pt-BR', {maximumFractionDigits:0})} (${newCbPct.toFixed(2)}%)</span>
                </div>
                <div class="crm-proj-item">
                    <span class="crm-proj-label">Tickets estimados</span>
                    <span class="crm-proj-val">${newTickets}</span>
                </div>
            </div>
            <p style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem">
                Baseado em ${latest.month}. Crescimento de vendas: +${salesGrowth}%, chargeback proporcional a ${cbGrowth}% do crescimento.
            </p>
        `;
    },

    _openModal(id = null) {
        const modal = document.getElementById('crm-modal');
        if (!modal) return;

        const titleEl = document.getElementById('crm-modal-title');
        if (titleEl) titleEl.textContent = id ? 'Editar Registro CRM' : 'Novo Mês CRM';

        const form = document.getElementById('crm-form');
        if (form) {
            form.reset();
            form.dataset.editId = id || '';
        }

        if (id) {
            const entry = this._data.find(d => d.id === id);
            if (entry) {
                const set = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val ?? ''; };
                set('crm-month', entry.month);
                set('crm-revenue', entry.revenue);
                set('crm-revenue-currency', entry.revenueCurrency || 'BRL');
                set('crm-chargeback-amount', entry.chargebackAmount);
                set('crm-chargeback-currency', entry.chargebackCurrency || 'BRL');
                set('crm-chargeback-pct', entry.chargebackPct);
                set('crm-support-tickets', entry.supportTickets);
                set('crm-avg-response', entry.avgResponseTimeHours);
                set('crm-resolution-rate', entry.resolutionRate);
                set('crm-notes', entry.notes);
            }
        } else {
            const monthEl = document.getElementById('crm-month');
            if (monthEl) monthEl.value = new Date().toISOString().slice(0, 7);
        }

        modal.classList.remove('hidden');
    },

    _closeModal() {
        const modal = document.getElementById('crm-modal');
        if (modal) modal.classList.add('hidden');
    },

    _handleSave() {
        const get = (id) => document.getElementById(id)?.value?.trim() || '';
        const month = get('crm-month');
        if (!month) { showToast('Selecione o mês', 'error'); return; }

        const form = document.getElementById('crm-form');
        const editId = form?.dataset.editId || '';
        const revenue = parseFloat(get('crm-revenue')) || 0;
        const chargebackAmount = parseFloat(get('crm-chargeback-amount')) || 0;
        const chargebackPct = revenue > 0 ? chargebackAmount / revenue * 100 : parseFloat(get('crm-chargeback-pct')) || 0;

        const entry = {
            month,
            storeId: getCurrentStoreId(),
            revenue,
            revenueCurrency: get('crm-revenue-currency') || 'BRL',
            chargebackAmount,
            chargebackCurrency: get('crm-chargeback-currency') || 'BRL',
            chargebackPct,
            supportTickets: parseInt(get('crm-support-tickets')) || 0,
            avgResponseTimeHours: parseFloat(get('crm-avg-response')) || 0,
            resolutionRate: parseFloat(get('crm-resolution-rate')) || 0,
            notes: get('crm-notes'),
        };

        if (editId) {
            const idx = this._data.findIndex(d => d.id === editId);
            if (idx >= 0) {
                this._data[idx] = { ...this._data[idx], ...entry };
                showToast('Registro atualizado!', 'success');
            }
        } else {
            entry.id = 'crm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
            this._data.push(entry);
            showToast('Registro salvo!', 'success');
        }

        this._persist();
        this._closeModal();
        this.render();
    },

    _esc(str) {
        return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    },
};
