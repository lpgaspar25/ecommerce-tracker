/* ===========================
   Lab Test AI — Cria testes do Pipeline a partir de descrição livre (texto/áudio)
   Reusa as chaves de API do AI Consultant (anthropic/openai) em localStorage.
   =========================== */

const LabTestAI = {
    _drafts: [],            // testes propostos pela IA, aguardando confirmação
    _recognition: null,     // SpeechRecognition instance
    _recording: false,
    _loading: false,

    init() {
        // Inject the "+ IA" button next to "+ Novo Teste"
        const newTestBtn = document.getElementById('btn-add-lab-test');
        if (newTestBtn && !document.getElementById('btn-lab-ai')) {
            const aiBtn = document.createElement('button');
            aiBtn.id = 'btn-lab-ai';
            aiBtn.className = 'btn btn-secondary';
            aiBtn.style.marginRight = '0.5rem';
            aiBtn.innerHTML = '<i data-lucide="sparkles" style="width:14px;height:14px;vertical-align:-2px"></i> Criar com IA';
            newTestBtn.parentNode.insertBefore(aiBtn, newTestBtn);
            aiBtn.addEventListener('click', () => this._openModal());
        }

        // Inject modal once
        if (!document.getElementById('lab-ai-modal')) this._injectModal();
    },

    _injectModal() {
        const modal = document.createElement('div');
        modal.id = 'lab-ai-modal';
        modal.className = 'modal hidden';
        modal.innerHTML = `
            <div class="modal-overlay" data-close></div>
            <div class="modal-content" style="max-width:640px">
                <div class="modal-header">
                    <h3><i data-lucide="sparkles" style="width:16px;height:16px;vertical-align:-3px"></i> Criar Teste com IA</h3>
                    <button class="modal-close" data-close>&times;</button>
                </div>
                <div class="modal-body">
                    <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:0.75rem">
                        Descreva o teste em texto ou áudio: produto, hipótese, datas (de/até), orçamento, métrica alvo.
                        A IA vai propor os cards — você confirma antes de criar.
                    </p>
                    <div style="position:relative">
                        <textarea id="lab-ai-input" rows="5" placeholder="Ex: estou rodando um teste no aviator desde ontem até dia 30 trocando a foto principal e a descrição. Meta: subir CPA pra abaixo de 50. Orçamento 80 USD/dia."
                            style="width:100%;padding:0.75rem;padding-right:3rem;border-radius:8px;border:1px solid var(--border);background:var(--bg-input);color:var(--text);font-size:0.9rem;resize:vertical;font-family:inherit"></textarea>
                        <button id="lab-ai-mic" type="button" title="Ditar por áudio"
                            style="position:absolute;right:0.5rem;bottom:0.5rem;background:var(--accent);color:#fff;border:none;width:36px;height:36px;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center">
                            <i data-lucide="mic" style="width:16px;height:16px"></i>
                        </button>
                    </div>
                    <div id="lab-ai-mic-status" style="font-size:0.75rem;color:var(--text-muted);margin-top:0.4rem;min-height:1em"></div>

                    <div id="lab-ai-preview" style="margin-top:1rem;display:none">
                        <h4 style="font-size:0.9rem;margin-bottom:0.5rem">Testes propostos pela IA</h4>
                        <div id="lab-ai-cards" style="display:flex;flex-direction:column;gap:0.6rem"></div>
                    </div>

                    <div id="lab-ai-error" style="display:none;margin-top:0.75rem;padding:0.6rem;border-radius:6px;background:#fee2e2;color:#991b1b;font-size:0.85rem"></div>
                </div>
                <div class="modal-footer" style="display:flex;justify-content:flex-end;gap:0.5rem">
                    <button id="lab-ai-cancel" class="btn btn-secondary" data-close>Cancelar</button>
                    <button id="lab-ai-submit" class="btn btn-primary">Analisar com IA</button>
                    <button id="lab-ai-confirm" class="btn btn-primary" style="display:none;background:#059669">Criar testes</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        modal.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', () => this._closeModal()));
        document.getElementById('lab-ai-submit').addEventListener('click', () => this._analyze());
        document.getElementById('lab-ai-confirm').addEventListener('click', () => this._createAll());
        document.getElementById('lab-ai-mic').addEventListener('click', () => this._toggleMic());

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _openModal() {
        const modal = document.getElementById('lab-ai-modal');
        if (!modal) return;
        document.getElementById('lab-ai-input').value = '';
        document.getElementById('lab-ai-preview').style.display = 'none';
        document.getElementById('lab-ai-cards').innerHTML = '';
        document.getElementById('lab-ai-error').style.display = 'none';
        document.getElementById('lab-ai-confirm').style.display = 'none';
        document.getElementById('lab-ai-submit').style.display = '';
        document.getElementById('lab-ai-mic-status').textContent = '';
        this._drafts = [];
        modal.classList.remove('hidden');
    },

    _closeModal() {
        if (this._recording) this._toggleMic();
        document.getElementById('lab-ai-modal')?.classList.add('hidden');
    },

    _toggleMic() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const status = document.getElementById('lab-ai-mic-status');
        const micBtn = document.getElementById('lab-ai-mic');
        if (!SR) {
            status.textContent = 'Áudio não suportado neste navegador. Use Chrome/Edge/Safari.';
            return;
        }
        if (this._recording) {
            this._recognition?.stop();
            return;
        }
        const rec = new SR();
        rec.lang = 'pt-BR';
        rec.continuous = true;
        rec.interimResults = true;

        const input = document.getElementById('lab-ai-input');
        const baseText = input.value;
        let finalChunk = '';

        rec.onstart = () => {
            this._recording = true;
            micBtn.style.background = '#dc2626';
            status.textContent = '🔴 Gravando... clique no microfone para parar.';
        };
        rec.onresult = (e) => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const transcript = e.results[i][0].transcript;
                if (e.results[i].isFinal) finalChunk += transcript + ' ';
                else interim += transcript;
            }
            input.value = (baseText ? baseText + ' ' : '') + finalChunk + interim;
        };
        rec.onerror = (e) => {
            status.textContent = 'Erro no áudio: ' + e.error;
        };
        rec.onend = () => {
            this._recording = false;
            micBtn.style.background = 'var(--accent)';
            status.textContent = '';
        };

        this._recognition = rec;
        rec.start();
    },

    async _analyze() {
        const input = document.getElementById('lab-ai-input').value.trim();
        if (!input) { this._showError('Descreva o teste antes de analisar.'); return; }
        if (this._loading) return;

        const provider = localStorage.getItem('ai_consultant_provider') || 'anthropic';
        const apiKey = provider === 'anthropic'
            ? localStorage.getItem('ai_consultant_api_key')
            : localStorage.getItem('ai_consultant_openai_key');
        if (!apiKey) {
            this._showError('Configure a chave de API em Diário → IA Consultor primeiro.');
            return;
        }

        this._loading = true;
        const submitBtn = document.getElementById('lab-ai-submit');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Analisando...';
        submitBtn.disabled = true;
        this._hideError();

        try {
            const products = (AppState.allProducts || AppState.products || [])
                .filter(p => p.status === 'ativo')
                .map(p => ({ id: p.id, name: p.name, storeId: p.storeId }));

            const today = new Date().toISOString().slice(0, 10);
            const systemPrompt = this._buildSystemPrompt(products, today);

            const responseText = provider === 'anthropic'
                ? await this._callAnthropic(systemPrompt, input, apiKey)
                : await this._callOpenAI(systemPrompt, input, apiKey);

            const parsed = this._parseAIResponse(responseText);
            if (!parsed.tests?.length) {
                this._showError(parsed.message || 'IA não conseguiu extrair testes. Reformule a descrição.');
                return;
            }

            this._drafts = parsed.tests;
            this._renderPreview();
        } catch (err) {
            this._showError(`Erro: ${err.message}`);
        } finally {
            this._loading = false;
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    },

    _buildSystemPrompt(products, today) {
        return `Você é um assistente que extrai testes de e-commerce a partir de descrições do usuário (texto livre ou transcrição de áudio em português).

Hoje é ${today}.

Produtos disponíveis (use o id exato):
${products.map(p => `- ${p.id}: ${p.name}`).join('\n') || '(nenhum produto cadastrado)'}

Categorias válidas: loja, redes_sociais, trafego, criativo, oferta, outro
Métricas válidas: vendas, cpa, cpc, conv_page, atc_rate, roas, validar_criativo, outro

Para cada teste mencionado pelo usuário, extraia:
- title: 3-10 palavras, ação concreta. Ex: "Troca de foto principal + descrição"
- hypothesis: 1-2 frases descrevendo o que esperam validar
- productId: id da lista acima (escolha o que melhor casa com o produto mencionado)
- category: melhor encaixe (foto/descrição → criativo, preço → oferta, etc.)
- expectedMetric: métrica que o usuário quer melhorar
- baselineValue: valor alvo da métrica (string), vazio se não mencionado
- dateStart: YYYY-MM-DD. "ontem" = ${this._daysAgo(1, today)}, "hoje" = ${today}, "anteontem" = ${this._daysAgo(2, today)}.
- dateEnd: YYYY-MM-DD. "até dia X" = use o próximo dia X a partir de hoje (mesmo mês ou próximo).
- budget: número se mencionado (orçamento diário em qualquer moeda), senão vazio
- budgetCurrency: BRL, USD, EUR, GBP — inferir; default USD

Resposta: APENAS um objeto JSON puro, SEM marcação de código, SEM explicação:
{"tests":[{...}]}

Se não houver dados suficientes (sem produto, sem datas), retorne:
{"tests":[],"message":"Faltam dados: ..."}`;
    },

    _daysAgo(n, todayStr) {
        const d = new Date(todayStr + 'T00:00:00');
        d.setDate(d.getDate() - n);
        return d.toISOString().slice(0, 10);
    },

    async _callAnthropic(systemPrompt, userPrompt, apiKey) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2048,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }]
            })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        if (typeof UsagePanelModule !== 'undefined' && data.usage) {
            try { UsagePanelModule.trackAIUsage('anthropic', data.usage.input_tokens || 0, data.usage.output_tokens || 0); } catch {}
        }
        return data.content?.[0]?.text || '';
    },

    async _callOpenAI(systemPrompt, userPrompt, apiKey) {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 2048,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' }
            })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${response.status}`);
        }
        const data = await response.json();
        if (typeof UsagePanelModule !== 'undefined' && data.usage) {
            try { UsagePanelModule.trackAIUsage('openai', data.usage.prompt_tokens || 0, data.usage.completion_tokens || 0); } catch {}
        }
        return data.choices?.[0]?.message?.content || '';
    },

    _parseAIResponse(text) {
        // Try direct parse first; else extract first {...} block
        const trimmed = (text || '').trim();
        try { return JSON.parse(trimmed); } catch {}
        const match = trimmed.match(/\{[\s\S]*\}/);
        if (match) { try { return JSON.parse(match[0]); } catch {} }
        return { tests: [], message: 'IA retornou resposta inválida.' };
    },

    _renderPreview() {
        const container = document.getElementById('lab-ai-cards');
        const productNameById = {};
        (AppState.allProducts || AppState.products || []).forEach(p => productNameById[p.id] = p.name);

        container.innerHTML = this._drafts.map((t, i) => {
            const productLabel = productNameById[t.productId] || `<span style="color:var(--red)">⚠ Produto não encontrado (${this._esc(t.productId)})</span>`;
            const dateRange = t.dateStart && t.dateEnd ? `${t.dateStart} → ${t.dateEnd}` : '<span style="color:var(--red)">⚠ Datas faltando</span>';
            const budget = t.budget ? `${t.budget} ${t.budgetCurrency || 'USD'}/dia` : '—';
            return `<div class="lab-ai-draft" style="border:1px solid var(--border);border-radius:8px;padding:0.75rem;background:var(--bg-card)">
                <div style="display:flex;justify-content:space-between;gap:0.5rem;align-items:flex-start">
                    <strong style="font-size:0.9rem">${this._esc(t.title || 'Sem título')}</strong>
                    <button class="lab-ai-remove" data-idx="${i}" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.1rem;line-height:1">&times;</button>
                </div>
                <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.3rem">${this._esc(t.hypothesis || '')}</div>
                <div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.5rem;font-size:0.75rem">
                    <span style="background:var(--bg-input);padding:0.15rem 0.4rem;border-radius:4px">📦 ${productLabel}</span>
                    <span style="background:var(--bg-input);padding:0.15rem 0.4rem;border-radius:4px">📅 ${dateRange}</span>
                    <span style="background:var(--bg-input);padding:0.15rem 0.4rem;border-radius:4px">🏷 ${this._esc(t.category || 'outro')}</span>
                    <span style="background:var(--bg-input);padding:0.15rem 0.4rem;border-radius:4px">🎯 ${this._esc(t.expectedMetric || '')}${t.baselineValue ? ': ' + this._esc(t.baselineValue) : ''}</span>
                    <span style="background:var(--bg-input);padding:0.15rem 0.4rem;border-radius:4px">💰 ${budget}</span>
                </div>
            </div>`;
        }).join('');

        container.querySelectorAll('.lab-ai-remove').forEach(b => {
            b.addEventListener('click', (e) => {
                const idx = parseInt(e.currentTarget.dataset.idx);
                this._drafts.splice(idx, 1);
                if (this._drafts.length === 0) {
                    document.getElementById('lab-ai-preview').style.display = 'none';
                    document.getElementById('lab-ai-confirm').style.display = 'none';
                    document.getElementById('lab-ai-submit').style.display = '';
                } else this._renderPreview();
            });
        });

        document.getElementById('lab-ai-preview').style.display = '';
        document.getElementById('lab-ai-confirm').style.display = '';
        document.getElementById('lab-ai-submit').style.display = 'none';
    },

    _createAll() {
        if (typeof LabTestsModule === 'undefined') return;
        const products = AppState.allProducts || AppState.products || [];
        let created = 0;
        let skipped = 0;
        this._drafts.forEach(d => {
            // Validate product exists
            if (!products.find(p => p.id === d.productId)) { skipped++; return; }
            if (!d.dateStart) { skipped++; return; }

            const newTest = {
                id: 'lab_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
                title: d.title || 'Teste sem título',
                hypothesis: d.hypothesis || '',
                productId: d.productId,
                category: ['loja','redes_sociais','trafego','criativo','oferta','outro'].includes(d.category) ? d.category : 'outro',
                expectedMetric: ['vendas','cpa','cpc','conv_page','atc_rate','roas','validar_criativo','outro'].includes(d.expectedMetric) ? d.expectedMetric : 'outro',
                baselineValue: d.baselineValue ? String(d.baselineValue) : '',
                dateStart: d.dateStart,
                dateEnd: d.dateEnd || d.dateStart,
                status: 'ativo',
                budget: d.budget || null,
                budgetCurrency: d.budgetCurrency || 'USD',
                observations: [],
                stages: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
            LabTestsModule._tests.unshift(newTest);
            created++;
            // Mirror to diary
            try { LabTestsModule._syncTestToDiary(newTest); } catch (e) { console.warn('Sync to diary failed', e); }
        });
        LabTestsModule._persist();
        LabTestsModule._renderCards();

        const msg = created
            ? `${created} teste(s) criado(s)${skipped ? ` · ${skipped} pulado(s) (faltava produto/datas)` : ''}`
            : 'Nenhum teste criado — faltou produto válido ou datas.';
        if (typeof showToast === 'function') showToast(msg, created ? 'success' : 'error');
        if (created) this._closeModal();
    },

    _showError(msg) {
        const el = document.getElementById('lab-ai-error');
        if (!el) return;
        el.textContent = msg;
        el.style.display = '';
    },

    _hideError() {
        const el = document.getElementById('lab-ai-error');
        if (el) el.style.display = 'none';
    },

    _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
};

document.addEventListener('DOMContentLoaded', () => LabTestAI.init());
