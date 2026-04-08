/* ===========================
   Usage Panel Module — User stats, token usage, costs
   =========================== */

const UsagePanelModule = {
    _storageKey: 'etracker_usage_data',
    _data: null,

    init() {
        this._load();
        this._trackSession();

        // Open panel from profile dropdown
        document.getElementById('btn-usage-panel')?.addEventListener('click', () => this.openPanel());
        document.getElementById('usage-panel-close')?.addEventListener('click', () => this.closePanel());
        document.getElementById('usage-panel')?.querySelector('.modal-overlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closePanel();
        });

        // Reset button
        document.getElementById('btn-usage-reset')?.addEventListener('click', () => {
            if (confirm('Resetar todas as estatísticas de uso?')) {
                this._data = this._defaultData();
                this._data.firstSeen = new Date().toISOString();
                this._persist();
                this.render();
                showToast('Estatísticas resetadas', 'success');
            }
        });
    },

    _defaultData() {
        return {
            firstSeen: new Date().toISOString(),
            sessions: 0,
            totalTimeMinutes: 0,
            lastSeen: new Date().toISOString(),
            ai: {
                anthropic: { calls: 0, inputTokens: 0, outputTokens: 0 },
                openai: { calls: 0, inputTokens: 0, outputTokens: 0 }
            },
            aiHistory: [], // { date, provider, inputTokens, outputTokens }
        };
    },

    _load() {
        try {
            this._data = JSON.parse(localStorage.getItem(this._storageKey));
            if (!this._data) this._data = this._defaultData();
            // Ensure new fields exist for backward compat
            if (!this._data.ai) this._data.ai = { anthropic: { calls: 0, inputTokens: 0, outputTokens: 0 }, openai: { calls: 0, inputTokens: 0, outputTokens: 0 } };
            if (!this._data.aiHistory) this._data.aiHistory = [];
        } catch {
            this._data = this._defaultData();
        }
    },

    _persist() {
        localStorage.setItem(this._storageKey, JSON.stringify(this._data));
    },

    _trackSession() {
        this._data.sessions++;
        this._data.lastSeen = new Date().toISOString();
        this._sessionStart = Date.now();
        this._persist();

        // Track time spent every 60s
        this._timeInterval = setInterval(() => {
            this._data.totalTimeMinutes++;
            this._data.lastSeen = new Date().toISOString();
            this._persist();
        }, 60000);
    },

    // Called from AI consultant when tokens are used
    trackAIUsage(provider, inputTokens, outputTokens) {
        if (!this._data) this._load();
        const key = provider === 'openai' ? 'openai' : 'anthropic';
        this._data.ai[key].calls++;
        this._data.ai[key].inputTokens += inputTokens;
        this._data.ai[key].outputTokens += outputTokens;

        // Keep daily history (max 90 days)
        const today = new Date().toISOString().slice(0, 10);
        let entry = this._data.aiHistory.find(h => h.date === today && h.provider === key);
        if (!entry) {
            entry = { date: today, provider: key, calls: 0, inputTokens: 0, outputTokens: 0 };
            this._data.aiHistory.push(entry);
        }
        entry.calls++;
        entry.inputTokens += inputTokens;
        entry.outputTokens += outputTokens;

        // Trim old entries
        if (this._data.aiHistory.length > 180) {
            this._data.aiHistory = this._data.aiHistory.slice(-180);
        }

        this._persist();
    },

    // ── Cost Calculation ──────────────────────────────────────────

    _calcCost(provider, inputTokens, outputTokens) {
        // Prices per 1M tokens (as of 2025)
        const prices = {
            anthropic: { input: 3.00, output: 15.00 },  // Claude Sonnet
            openai: { input: 2.50, output: 10.00 }       // GPT-4o
        };
        const p = prices[provider] || prices.anthropic;
        return (inputTokens / 1_000_000 * p.input) + (outputTokens / 1_000_000 * p.output);
    },

    // ── Panel ─────────────────────────────────────────────────────

    openPanel() {
        const modal = document.getElementById('usage-panel');
        if (modal) {
            modal.classList.remove('hidden');
            this.render();
        }
    },

    closePanel() {
        const modal = document.getElementById('usage-panel');
        if (modal) modal.classList.add('hidden');
    },

    render() {
        const container = document.getElementById('usage-panel-content');
        if (!container) return;

        const d = this._data;
        const now = new Date();

        // User info
        const email = document.getElementById('profile-dropdown-email')?.textContent || 'Local';
        const firstSeen = new Date(d.firstSeen);
        const daysSince = Math.max(1, Math.ceil((now - firstSeen) / 86400000));

        // Data counts
        const products = (AppState.allProducts || []).length;
        const activeProducts = (AppState.allProducts || []).filter(p => p.status === 'ativo').length;
        const diaryEntries = (AppState.allDiary || []).length;
        const goals = (AppState.allGoals || []).length;
        const creatives = (AppState.allCreatives || []).length;
        const projects = (AppState.allProjects || []).length;
        const stores = (AppState.stores || []).length;
        const labTests = (() => { try { return LabTestsModule._tests?.length || 0; } catch { return 0; } })();

        // AI stats
        const anthr = d.ai.anthropic;
        const oai = d.ai.openai;
        const totalCalls = anthr.calls + oai.calls;
        const totalInputTokens = anthr.inputTokens + oai.inputTokens;
        const totalOutputTokens = anthr.outputTokens + oai.outputTokens;
        const totalTokens = totalInputTokens + totalOutputTokens;

        const costAnthropic = this._calcCost('anthropic', anthr.inputTokens, anthr.outputTokens);
        const costOpenAI = this._calcCost('openai', oai.inputTokens, oai.outputTokens);
        const totalCost = costAnthropic + costOpenAI;

        // Time
        const hours = Math.floor(d.totalTimeMinutes / 60);
        const mins = d.totalTimeMinutes % 60;
        const timeStr = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

        // Last 7 days AI usage
        const last7 = this._getLast7DaysUsage();

        container.innerHTML = `
            <!-- User Info -->
            <div class="usage-section">
                <div class="usage-section-title">Conta</div>
                <div class="usage-info-grid">
                    <div class="usage-info-item">
                        <span class="usage-info-label">Email</span>
                        <span class="usage-info-value">${this._esc(email)}</span>
                    </div>
                    <div class="usage-info-item">
                        <span class="usage-info-label">Membro desde</span>
                        <span class="usage-info-value">${firstSeen.toLocaleDateString('pt-BR')}</span>
                    </div>
                    <div class="usage-info-item">
                        <span class="usage-info-label">Dias de uso</span>
                        <span class="usage-info-value">${daysSince} dias</span>
                    </div>
                    <div class="usage-info-item">
                        <span class="usage-info-label">Sessões</span>
                        <span class="usage-info-value">${d.sessions}</span>
                    </div>
                    <div class="usage-info-item">
                        <span class="usage-info-label">Tempo total</span>
                        <span class="usage-info-value">${timeStr}</span>
                    </div>
                    <div class="usage-info-item">
                        <span class="usage-info-label">Lojas</span>
                        <span class="usage-info-value">${stores}</span>
                    </div>
                </div>
            </div>

            <!-- Data Summary -->
            <div class="usage-section">
                <div class="usage-section-title">Dados Salvos</div>
                <div class="usage-stats-grid">
                    <div class="usage-stat-card">
                        <div class="usage-stat-icon">📦</div>
                        <div class="usage-stat-val">${products}</div>
                        <div class="usage-stat-lbl">Produtos</div>
                        <div class="usage-stat-sub">${activeProducts} ativos</div>
                    </div>
                    <div class="usage-stat-card">
                        <div class="usage-stat-icon">📓</div>
                        <div class="usage-stat-val">${diaryEntries}</div>
                        <div class="usage-stat-lbl">Entradas Diário</div>
                    </div>
                    <div class="usage-stat-card">
                        <div class="usage-stat-icon">🎯</div>
                        <div class="usage-stat-val">${goals}</div>
                        <div class="usage-stat-lbl">Metas</div>
                    </div>
                    <div class="usage-stat-card">
                        <div class="usage-stat-icon">🎬</div>
                        <div class="usage-stat-val">${creatives}</div>
                        <div class="usage-stat-lbl">Criativos</div>
                    </div>
                    <div class="usage-stat-card">
                        <div class="usage-stat-icon">📋</div>
                        <div class="usage-stat-val">${projects}</div>
                        <div class="usage-stat-lbl">Projetos</div>
                    </div>
                    <div class="usage-stat-card">
                        <div class="usage-stat-icon">🧪</div>
                        <div class="usage-stat-val">${labTests}</div>
                        <div class="usage-stat-lbl">Testes</div>
                    </div>
                </div>
            </div>

            <!-- AI Usage -->
            <div class="usage-section">
                <div class="usage-section-title">IA Consultor — Uso de Tokens</div>
                <div class="usage-ai-summary">
                    <div class="usage-ai-total">
                        <div class="usage-ai-total-cost">$${totalCost.toFixed(4)}</div>
                        <div class="usage-ai-total-label">Custo total estimado</div>
                    </div>
                    <div class="usage-ai-total">
                        <div class="usage-ai-total-cost">${this._fmtTokens(totalTokens)}</div>
                        <div class="usage-ai-total-label">Tokens usados</div>
                    </div>
                    <div class="usage-ai-total">
                        <div class="usage-ai-total-cost">${totalCalls}</div>
                        <div class="usage-ai-total-label">Consultas</div>
                    </div>
                </div>

                ${totalCalls > 0 ? `
                <table class="usage-table">
                    <thead>
                        <tr>
                            <th>Provedor</th>
                            <th>Consultas</th>
                            <th>Tokens Input</th>
                            <th>Tokens Output</th>
                            <th>Total Tokens</th>
                            <th>Custo</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${anthr.calls > 0 ? `<tr>
                            <td><span class="usage-provider-badge usage-badge-anthropic">Claude</span></td>
                            <td>${anthr.calls}</td>
                            <td>${this._fmtTokens(anthr.inputTokens)}</td>
                            <td>${this._fmtTokens(anthr.outputTokens)}</td>
                            <td>${this._fmtTokens(anthr.inputTokens + anthr.outputTokens)}</td>
                            <td>$${costAnthropic.toFixed(4)}</td>
                        </tr>` : ''}
                        ${oai.calls > 0 ? `<tr>
                            <td><span class="usage-provider-badge usage-badge-openai">GPT-4o</span></td>
                            <td>${oai.calls}</td>
                            <td>${this._fmtTokens(oai.inputTokens)}</td>
                            <td>${this._fmtTokens(oai.outputTokens)}</td>
                            <td>${this._fmtTokens(oai.inputTokens + oai.outputTokens)}</td>
                            <td>$${costOpenAI.toFixed(4)}</td>
                        </tr>` : ''}
                    </tbody>
                </table>` : '<p style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:1rem 0">Nenhuma consulta IA realizada ainda.</p>'}

                ${last7.length > 0 ? `
                <div class="usage-subsection-title">Últimos 7 dias</div>
                <div class="usage-daily-bars">
                    ${last7.map(day => {
                        const maxTokens = Math.max(...last7.map(d => d.tokens)) || 1;
                        const pct = Math.max(2, Math.round((day.tokens / maxTokens) * 100));
                        return `<div class="usage-daily-bar-wrap">
                            <div class="usage-daily-bar" style="height:${pct}%;background:${day.provider === 'openai' ? '#10a37f' : '#e07a2f'}"></div>
                            <div class="usage-daily-label">${day.dateShort}</div>
                            <div class="usage-daily-value">${this._fmtTokens(day.tokens)}</div>
                        </div>`;
                    }).join('')}
                </div>` : ''}
            </div>

            <!-- Storage -->
            <div class="usage-section">
                <div class="usage-section-title">Armazenamento Local</div>
                <div class="usage-storage-info">
                    ${this._getStorageInfo()}
                </div>
            </div>
        `;
    },

    _getLast7DaysUsage() {
        const days = [];
        const now = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(now);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().slice(0, 10);
            const entries = this._data.aiHistory.filter(h => h.date === dateStr);
            const tokens = entries.reduce((acc, e) => acc + e.inputTokens + e.outputTokens, 0);
            const calls = entries.reduce((acc, e) => acc + e.calls, 0);
            const provider = entries.length > 0 ? entries[entries.length - 1].provider : 'anthropic';
            if (tokens > 0) {
                days.push({
                    date: dateStr,
                    dateShort: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
                    tokens,
                    calls,
                    provider
                });
            }
        }
        return days;
    },

    _getStorageInfo() {
        const keys = [
            { key: 'etracker_stores', label: 'Lojas' },
            { key: 'etracker_usage_data', label: 'Uso & Estatísticas' },
            { key: 'lab_tests', label: 'Testes' },
            { key: 'pipeline_cards', label: 'Pipeline' },
            { key: 'ai_consultant_api_key', label: 'API Key (Anthropic)' },
            { key: 'ai_consultant_openai_key', label: 'API Key (OpenAI)' },
        ];

        let totalBytes = 0;
        const rows = keys.map(k => {
            const val = localStorage.getItem(k.key);
            const bytes = val ? new Blob([val]).size : 0;
            totalBytes += bytes;
            return { label: k.label, bytes, exists: !!val };
        }).filter(r => r.exists);

        // Also scan all etracker_ keys
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!keys.find(k => k.key === key)) {
                const val = localStorage.getItem(key);
                totalBytes += val ? new Blob([val]).size : 0;
            }
        }

        const fmtSize = (b) => b > 1024 ? (b / 1024).toFixed(1) + ' KB' : b + ' B';

        let html = '<div class="usage-storage-rows">';
        rows.forEach(r => {
            html += `<div class="usage-storage-row">
                <span>${r.label}</span>
                <span>${fmtSize(r.bytes)}</span>
            </div>`;
        });
        html += `<div class="usage-storage-row usage-storage-total">
            <span><strong>Total localStorage</strong></span>
            <span><strong>${fmtSize(totalBytes)}</strong></span>
        </div>`;
        html += '</div>';
        return html;
    },

    _fmtTokens(n) {
        if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M';
        if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
        return String(n);
    },

    _esc(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};

document.addEventListener('DOMContentLoaded', () => UsagePanelModule.init());
