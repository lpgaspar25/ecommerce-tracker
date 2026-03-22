/* ===========================
   AI Consultant — Senior e-commerce ad strategist powered by Claude API
   Analyzes metrics, detects fatigue, suggests budget reallocation
   =========================== */

const AIConsultantModule = {
    _panelOpen: false,
    _loading: false,
    _apiKey: '',
    _history: [],

    SYSTEM_PROMPT: `Voce e um gestor de trafego senior e consultor tecnico que ja rodou mais de 50 milhoes em e-commerce.
Voce analisa metricas de ads com precisao, identifica padroes de fadiga criativa, tendencias de CPC/CPM, e da recomendacoes actionaveis.

Seu estilo:
- Direto e tecnico, sem enrolacao
- Foca em numeros e tendencias
- Sempre da acoes concretas (pausar X, escalar Y, testar Z)
- Identifica sinais de kill/scale rapidamente
- Pensa em termos de unit economics e margem

Formato de resposta:
Use secoes claras com emojis:
📊 DIAGNOSTICO - situacao geral
🔥 FADIGA - criativos cansados e por que
📈 TENDENCIAS - CPC/CPM/CTR subindo ou descendo
⚡ ACOES PRIORITARIAS - o que fazer AGORA
💰 BUDGET - onde realocar investimento
🎯 PROXIMOS PASSOS - testes a rodar

Sempre responda em portugues brasileiro.`,

    init() {
        const btn = document.getElementById('ai-consultant-btn');
        if (btn) btn.addEventListener('click', () => this.togglePanel());

        const sendBtn = document.getElementById('ai-send-btn');
        if (sendBtn) sendBtn.addEventListener('click', () => this.sendMessage());

        const input = document.getElementById('ai-input');
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.sendMessage();
                }
            });
        }

        const closeBtn = document.getElementById('ai-panel-close');
        if (closeBtn) closeBtn.addEventListener('click', () => this.togglePanel());

        const analyzeBtn = document.getElementById('ai-auto-analyze');
        if (analyzeBtn) analyzeBtn.addEventListener('click', () => this.autoAnalyze());

        // Load API key from config
        this._apiKey = localStorage.getItem('ai_consultant_api_key') || '';

        const configBtn = document.getElementById('ai-config-btn');
        if (configBtn) configBtn.addEventListener('click', () => this.configureApiKey());
    },

    togglePanel() {
        this._panelOpen = !this._panelOpen;
        const panel = document.getElementById('ai-consultant-panel');
        if (panel) {
            panel.classList.toggle('ai-panel-open', this._panelOpen);
        }
    },

    configureApiKey() {
        const current = this._apiKey ? '(configurada)' : '(nao configurada)';
        const key = prompt(`API Key da Anthropic ${current}:\n\nCole sua API key aqui:`);
        if (key !== null) {
            this._apiKey = key.trim();
            localStorage.setItem('ai_consultant_api_key', this._apiKey);
            showToast(this._apiKey ? 'API key salva!' : 'API key removida', 'success');
        }
    },

    // Gather context from AppState
    gatherContext() {
        const context = {};

        // Recent diary entries (last 14 days)
        const today = new Date();
        const twoWeeksAgo = new Date(today - 14 * 86400000).toISOString().split('T')[0];
        const recentDiary = (AppState.diary || []).filter(d => d.date >= twoWeeksAgo);

        context.diaryEntries = recentDiary.map(d => ({
            date: d.date,
            product: getProductName(d.productId),
            budget: d.budget,
            sales: d.sales,
            revenue: d.revenue,
            cpa: d.cpa,
            cpc: d.cpc,
            platform: d.platform,
            impressions: d.impressions,
            isTest: d.isTest,
            testValidation: d.testValidation
        }));

        // Products with profit
        context.products = (AppState.products || []).filter(p => p.status === 'ativo').map(p => ({
            name: p.name,
            price: p.price,
            cost: p.cost,
            tax: p.tax,
            variableCosts: p.variableCosts,
            targetCPA: p.cpa
        }));

        // Creatives with stats
        if (typeof CreativesModule !== 'undefined') {
            context.creatives = (AppState.creatives || []).map(c => {
                const stats = CreativesModule.getCreativeStats(c.id);
                const fatigue = CreativesModule.detectFatigue(c.id);
                const freshness = CreativesModule.getFreshness(c);
                return {
                    name: c.name,
                    product: getProductName(c.productId),
                    type: c.type,
                    status: c.status,
                    angle: c.angle,
                    hookType: c.hookType,
                    daysRunning: freshness.days,
                    fatigued: fatigue.fatigued,
                    fatigueReason: fatigue.reason,
                    stats: stats ? {
                        totalSpend: stats.totalSpend,
                        avgCTR: stats.avgCTR,
                        avgCPC: stats.avgCPC,
                        avgCPM: stats.avgCPM,
                        conversions: stats.totalConversions,
                        roas: stats.roas
                    } : null,
                    activeTests: (c.variations || []).filter(v => v.status === 'pendente').length
                };
            });
        }

        // Pipeline summary
        if (typeof PipelineModule !== 'undefined') {
            const cards = PipelineModule.cards || [];
            context.pipeline = {};
            (PipelineModule.COLUMNS || []).forEach(col => {
                const colCards = cards.filter(c => c.columnId === col.id);
                if (colCards.length > 0) {
                    context.pipeline[col.title] = colCards.map(c => c.title);
                }
            });
        }

        return context;
    },

    async autoAnalyze() {
        const context = this.gatherContext();
        const contextStr = JSON.stringify(context, null, 2);

        const prompt = `Analise os dados abaixo do meu e-commerce tracker e me de um diagnostico completo:

${contextStr}

Foque em:
1. Quais criativos estao com fadiga e por que
2. Tendencias de CPC/CPM nos ultimos dias
3. Quais produtos estao performando bem vs mal
4. Onde devo realocar budget
5. Quais testes devo priorizar
6. Sinais de kill/scale em cada produto`;

        await this._sendToAPI(prompt);
    },

    async sendMessage() {
        const input = document.getElementById('ai-input');
        if (!input) return;

        const message = input.value.trim();
        if (!message) return;

        input.value = '';

        // Add context automatically
        const context = this.gatherContext();
        const contextStr = JSON.stringify(context, null, 2);

        const fullPrompt = `Contexto atual do meu e-commerce (dados reais):
${contextStr}

Pergunta do usuario: ${message}`;

        this._addMessage('user', message);
        await this._sendToAPI(fullPrompt);
    },

    async _sendToAPI(prompt) {
        if (!this._apiKey) {
            this._addMessage('assistant', '⚠️ Configure sua API key primeiro clicando no botao de engrenagem (⚙️).');
            return;
        }

        this._loading = true;
        this._updateLoadingState();

        try {
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this._apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 2048,
                    system: this.SYSTEM_PROMPT,
                    messages: [
                        { role: 'user', content: prompt }
                    ]
                })
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error?.message || `HTTP ${response.status}`);
            }

            const data = await response.json();
            const text = data.content?.[0]?.text || 'Sem resposta.';
            this._addMessage('assistant', text);
        } catch (err) {
            this._addMessage('assistant', `❌ Erro: ${err.message}`);
        } finally {
            this._loading = false;
            this._updateLoadingState();
        }
    },

    _addMessage(role, content) {
        this._history.push({ role, content, timestamp: new Date() });
        this._renderMessages();
    },

    _renderMessages() {
        const container = document.getElementById('ai-messages');
        if (!container) return;

        container.innerHTML = this._history.map(msg => {
            const isUser = msg.role === 'user';
            const escapedContent = this._escapeHtml(msg.content)
                .replace(/\n/g, '<br>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/📊|🔥|📈|⚡|💰|🎯|⚠️|❌|✅|🏆|🧪/g, match => `<span style="font-size:1.1em">${match}</span>`);

            return `<div class="ai-message ${isUser ? 'ai-message-user' : 'ai-message-assistant'}">
                <div class="ai-message-content">${escapedContent}</div>
            </div>`;
        }).join('');

        container.scrollTop = container.scrollHeight;
    },

    _updateLoadingState() {
        const btn = document.getElementById('ai-send-btn');
        const loader = document.getElementById('ai-loading');
        if (btn) btn.disabled = this._loading;
        if (loader) loader.style.display = this._loading ? 'block' : 'none';
    },

    _escapeHtml(raw) {
        return String(raw || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
};

document.addEventListener('DOMContentLoaded', () => AIConsultantModule.init());
