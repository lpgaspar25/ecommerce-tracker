/* ===========================
   ScaleSim.js — Simulador de Escala
   Decide: escalar, manter, otimizar ou pausar campanha em andamento.
   =========================== */

const ScaleSimModule = {

    // ── Init ──
    init() {
        this._populateProducts();

        const ids = [
            'sim-product', 'sim-spend', 'sim-sales', 'sim-target-margin',
            'sim-new-budget', 'sim-factor-realistic', 'sim-factor-pessimist',
            'sim-elasticity'
        ];
        ids.forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            const ev = (el.tagName === 'SELECT') ? 'change' : 'input';
            el.addEventListener(ev, () => this._recompute());
        });

        // Product change also triggers diary prefill
        document.getElementById('sim-product')?.addEventListener('change', () => {
            this._prefillFromDiary();
            this._recompute();
        });

        if (typeof EventBus !== 'undefined') {
            EventBus.on?.('dataLoaded', () => {
                this._populateProducts();
                this._recompute();
            });
        }

        // Re-render on currency selector change (dashboard selector)
        document.getElementById('dash-currency')?.addEventListener('change', () => this._recompute());
    },

    // ── Helpers ──
    _displayCurrency() {
        return (typeof DashboardModule !== 'undefined' && DashboardModule._currency)
            || 'BRL';
    },

    _currencySymbol() {
        const c = this._displayCurrency();
        return c === 'BRL' ? 'R$'
            : c === 'USD' ? 'US$'
            : c === 'EUR' ? '€'
            : c === 'GBP' ? '£'
            : c;
    },

    _fmtMoney(v) {
        const n = Number(v);
        const sym = this._currencySymbol();
        if (!isFinite(n)) return `${sym} 0,00`;
        return `${sym} ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },

    _convToDisplay(value, fromCurrency) {
        if (typeof convertCurrency !== 'function') return Number(value) || 0;
        return convertCurrency(Number(value) || 0, fromCurrency || this._displayCurrency(), this._displayCurrency());
    },

    _populateProducts() {
        const select = document.getElementById('sim-product');
        if (!select) return;
        const products = (typeof AppState !== 'undefined') ? (AppState.allProducts || AppState.products || []) : [];
        const current = select.value;
        select.innerHTML = '<option value="">Selecione um produto</option>' +
            products.map(p => `<option value="${p.id}">${this._esc(p.name)}</option>`).join('');
        if (current && products.some(p => String(p.id) === String(current))) select.value = current;
    },

    _getProduct(id) {
        if (typeof AppState === 'undefined') return null;
        const products = AppState.allProducts || AppState.products || [];
        return products.find(p => String(p.id) === String(id)) || null;
    },

    // Profit per unit in the display currency, net of tax% and variableCosts%
    _profitPerUnit(product) {
        if (!product) return 0;
        const display = this._displayCurrency();
        const price = this._convToDisplay(product.price, product.priceCurrency || display);
        const cost  = this._convToDisplay(product.cost,  product.costCurrency  || display);
        const taxPct = Number(product.tax) || 0;
        const varPct = Number(product.variableCosts) || 0;
        return price - cost - (price * taxPct / 100) - (price * varPct / 100);
    },

    _priceDisplay(product) {
        if (!product) return 0;
        return this._convToDisplay(product.price, product.priceCurrency || this._displayCurrency());
    },

    _prefillFromDiary() {
        const pid = document.getElementById('sim-product')?.value;
        if (!pid) return;
        if (typeof AppState === 'undefined') return;

        const diary = AppState.allDiary || AppState.diary || [];
        const entries = diary
            .filter(e => String(e.productId) === String(pid) && !e.isTest)
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const last = entries[0];
        if (!last) return;

        const display = this._displayCurrency();
        const budget = this._convToDisplay(Number(last.budget) || 0, last.budgetCurrency || display);
        const sales  = Number(last.sales) || 0;

        const spendEl = document.getElementById('sim-spend');
        const salesEl = document.getElementById('sim-sales');
        if (spendEl) spendEl.value = budget ? budget.toFixed(2) : '';
        if (salesEl) salesEl.value = sales || '';
    },

    // ── Core compute + render ──
    _recompute() {
        const pid = document.getElementById('sim-product')?.value;
        const product = this._getProduct(pid);
        const spend = parseFloat(document.getElementById('sim-spend')?.value) || 0;
        const sales = parseFloat(document.getElementById('sim-sales')?.value) || 0;
        const targetMarginPct = parseFloat(document.getElementById('sim-target-margin')?.value);
        const newBudget = parseFloat(document.getElementById('sim-new-budget')?.value) || 0;
        const factorR = parseFloat(document.getElementById('sim-factor-realistic')?.value);
        const factorP = parseFloat(document.getElementById('sim-factor-pessimist')?.value);

        const diag = document.getElementById('sim-diagnostic-results');
        const scenWrap = document.getElementById('sim-scenarios-wrap');
        const rec = document.getElementById('sim-recommendation');

        if (!product || spend <= 0 || sales <= 0) {
            if (diag) diag.style.display = 'none';
            if (scenWrap) scenWrap.style.display = 'none';
            if (rec) rec.innerHTML = `
                <p style="color:var(--text-muted);font-size:0.85rem;margin:0">
                    Preencha produto, gasto e vendas para ver a recomendação.
                </p>`;
            return;
        }

        const lucroUnit = this._profitPerUnit(product);
        const cpaAtual = spend / sales;
        const cpaBreak = lucroUnit;
        const metaPct  = (isNaN(targetMarginPct) ? 50 : targetMarginPct);
        const cpaAlvo  = Math.max(0, lucroUnit * (1 - metaPct / 100));
        const lucroAcum = sales * (lucroUnit - cpaAtual);

        // Status semáforo
        let statusHtml = '';
        if (cpaAtual <= cpaAlvo)      statusHtml = '<span style="color:var(--success, #16a34a)"><i data-lucide="circle" style="width:10px;height:10px;fill:#10b981;color:#10b981"></i> Acima da meta</span>';
        else if (cpaAtual <= cpaBreak) statusHtml = '<span style="color:#d97706"><i data-lucide="circle" style="width:10px;height:10px;fill:#f59e0b;color:#f59e0b"></i> Entre alvo e breakeven</span>';
        else                            statusHtml = '<span style="color:var(--red, #dc2626)"><i data-lucide="circle" style="width:10px;height:10px;fill:#ef4444;color:#ef4444"></i> Acima do breakeven</span>';

        // Render diagnostic
        if (diag) diag.style.display = '';
        this._setText('sim-profit-unit',  this._fmtMoney(lucroUnit));
        this._setText('sim-cpa-current',  this._fmtMoney(cpaAtual));
        this._setText('sim-cpa-target',   this._fmtMoney(cpaAlvo));
        this._setText('sim-cpa-break',    this._fmtMoney(cpaBreak));
        this._setText('sim-profit-accum', this._fmtMoney(lucroAcum));
        const statusEl = document.getElementById('sim-status');
        if (statusEl) statusEl.innerHTML = statusHtml;

        // Scenarios
        const fR = isNaN(factorR) ? 30 : factorR;
        const fP = isNaN(factorP) ? 100 : factorP;
        if (newBudget > 0 && lucroUnit > 0) {
            const scenarios = [
                { key: 'O', label: '<i data-lucide="circle" style="width:10px;height:10px;fill:#10b981;color:#10b981"></i> Otimista (CPA mantém)', factorPct: 0  },
                { key: 'R', label: `<i data-lucide="circle" style="width:10px;height:10px;fill:#f59e0b;color:#f59e0b"></i> Realista (+${fR}%)`,    factorPct: fR },
                { key: 'P', label: `<i data-lucide="circle" style="width:10px;height:10px;fill:#ef4444;color:#ef4444"></i> Pessimista (+${fP}%)`,  factorPct: fP },
            ].map(s => {
                const cpa = cpaAtual * (1 + s.factorPct / 100);
                const vendas = cpa > 0 ? newBudget / cpa : 0;
                const receita = vendas * this._priceDisplay(product);
                const lucro = vendas * (lucroUnit - cpa);
                const margem = lucroUnit > 0 ? ((lucroUnit - cpa) / lucroUnit) * 100 : 0;
                return { ...s, cpa, vendas, receita, lucro, margem };
            });

            const rowsEl = document.getElementById('sim-scenarios-rows');
            if (rowsEl) {
                rowsEl.innerHTML = scenarios.map(s => `
                    <div class="shopify-products-table-row" style="grid-template-columns:1.3fr 1fr 1fr 1.2fr 1.2fr 0.9fr">
                        <span class="shopify-product-name">${s.label}</span>
                        <span class="shopify-product-num">${this._fmtMoney(s.cpa)}</span>
                        <span class="shopify-product-num">${s.vendas.toFixed(1)}</span>
                        <span class="shopify-product-num">${this._fmtMoney(s.receita)}</span>
                        <span class="shopify-product-num" style="color:${s.lucro >= 0 ? 'var(--success, #16a34a)' : 'var(--red, #dc2626)'}">${this._fmtMoney(s.lucro)}</span>
                        <span class="shopify-product-num">${s.margem.toFixed(1)}%</span>
                    </div>`).join('');
            }
            if (scenWrap) scenWrap.style.display = '';
        } else if (scenWrap) {
            scenWrap.style.display = 'none';
        }

        // Scale limits (Bloco 4)
        this._renderLimits({ cpaAtual, cpaBreak, lucroUnit, spend, sales, product });

        // Recommendation
        if (rec) rec.innerHTML = this._buildRecommendation({
            cpaAtual, cpaAlvo, cpaBreak, lucroUnit, spend, sales
        });
    },

    // ── Bloco 4: Limite da escala ──
    // Modelo: CPA(B) = cpa0 × (1 + (Z/100) × (B/B0 − 1))   para B ≥ B0
    //         onde Z = elasticidade (% de piora do CPA ao dobrar o orçamento)
    // Varre B numericamente, encontra B ótimo (lucro máx) e B breakeven (lucro = 0).
    _renderLimits({ cpaAtual, cpaBreak, lucroUnit, spend, sales, product }) {
        const resEl  = document.getElementById('sim-limit-results');
        const scanEl = document.getElementById('sim-scan-wrap');
        const rowsEl = document.getElementById('sim-scan-rows');

        const Zraw = parseFloat(document.getElementById('sim-elasticity')?.value);
        const Z = isNaN(Zraw) ? 30 : Math.max(0, Zraw);

        if (lucroUnit <= 0 || cpaAtual <= 0 || spend <= 0 || sales <= 0) {
            if (resEl)  resEl.style.display = 'none';
            if (scanEl) scanEl.style.display = 'none';
            return;
        }

        const B0 = spend;
        const cpaOf = (B) => (B <= B0) ? cpaAtual : cpaAtual * (1 + (Z / 100) * (B / B0 - 1));
        const profitOf = (B) => {
            const c = cpaOf(B);
            if (c <= 0) return 0;
            const v = B / c;
            return v * (lucroUnit - c);
        };

        // Breakeven analítico: CPA(B) = lucroUnit
        //   cpa0 × (1 + (Z/100) × (B/B0 − 1)) = lucroUnit
        //   B/B0 = 1 + ((lucroUnit/cpa0) − 1) × 100/Z
        let Bbe;
        if (cpaAtual >= lucroUnit) {
            Bbe = B0; // já está no limite
        } else if (Z <= 0) {
            Bbe = Infinity; // CPA nunca piora → sem teto teórico
        } else {
            Bbe = B0 * (1 + ((lucroUnit / cpaAtual) - 1) * 100 / Z);
        }

        // Orçamento ótimo: varredura numérica entre B0 e Bbe (ou 10×B0 se infinito)
        const Bmax = isFinite(Bbe) ? Bbe : (B0 * 20);
        const steps = 400;
        let Bopt = B0, lucroOpt = profitOf(B0);
        for (let i = 1; i <= steps; i++) {
            const B = B0 + (Bmax - B0) * (i / steps);
            const L = profitOf(B);
            if (L > lucroOpt) { lucroOpt = L; Bopt = B; }
        }
        const cpaOpt = cpaOf(Bopt);
        const vendasOpt = Bopt / cpaOpt;
        const lucroKeep = sales * (lucroUnit - cpaAtual);

        // Render cards
        if (resEl) resEl.style.display = '';
        this._setText('sim-keep-profit', this._fmtMoney(lucroKeep));
        this._setText('sim-keep-detail', `gasto ${this._fmtMoney(B0)} · ${sales} vendas · CPA ${this._fmtMoney(cpaAtual)}`);

        this._setText('sim-opt-budget', this._fmtMoney(Bopt));
        const deltaOpt = lucroOpt - lucroKeep;
        this._setText('sim-opt-detail',
            `lucro ${this._fmtMoney(lucroOpt)} (+${this._fmtMoney(deltaOpt)}) · ${vendasOpt.toFixed(1)} vendas · CPA ${this._fmtMoney(cpaOpt)}`);

        this._setText('sim-be-budget', isFinite(Bbe) ? this._fmtMoney(Bbe) : '∞');
        this._setText('sim-be-detail',
            isFinite(Bbe)
                ? `acima disso, lucro vira prejuízo (CPA projetado = ${this._fmtMoney(lucroUnit)})`
                : `CPA não piora (elasticidade 0) — sem teto teórico`);

        this._setText('sim-cpa-limit', this._fmtMoney(cpaBreak));

        // Scan table: B0, ~1.5×, 2×, Bopt, midpoint, Bbe
        const scanBudgets = [];
        const pushUnique = (B, label) => {
            if (!isFinite(B) || B <= 0) return;
            if (!scanBudgets.some(x => Math.abs(x.B - B) / B < 0.02)) {
                scanBudgets.push({ B, label });
            }
        };
        pushUnique(B0, 'atual');
        pushUnique(B0 * 1.5, '+50%');
        pushUnique(B0 * 2,   '+100%');
        pushUnique(Bopt, '<i data-lucide="target" style="width:14px;height:14px;vertical-align:-2px"></i> ótimo');
        if (isFinite(Bbe)) {
            pushUnique((Bopt + Bbe) / 2, 'entre ótimo e teto');
            pushUnique(Bbe, '<i data-lucide="alert-triangle" style="width:14px;height:14px;vertical-align:-2px"></i>️ breakeven');
        } else {
            pushUnique(B0 * 5,  '+400%');
            pushUnique(B0 * 10, '+900%');
        }
        scanBudgets.sort((a, b) => a.B - b.B);

        if (rowsEl) {
            rowsEl.innerHTML = scanBudgets.map(({ B, label }) => {
                const c = cpaOf(B);
                const v = B / c;
                const L = v * (lucroUnit - c);
                const delta = L - lucroKeep;
                const deltaColor = delta >= 0 ? 'var(--success, #16a34a)' : 'var(--red, #dc2626)';
                const lucroColor = L >= 0 ? 'var(--success, #16a34a)' : 'var(--red, #dc2626)';
                const deltaSign = delta >= 0 ? '+' : '';
                return `
                    <div class="shopify-products-table-row" style="grid-template-columns:1.2fr 1fr 1fr 1.2fr 1.2fr">
                        <span class="shopify-product-name">${this._fmtMoney(B)} <small style="opacity:0.6">(${this._esc(label)})</small></span>
                        <span class="shopify-product-num">${this._fmtMoney(c)}</span>
                        <span class="shopify-product-num">${v.toFixed(1)}</span>
                        <span class="shopify-product-num" style="color:${lucroColor}">${this._fmtMoney(L)}</span>
                        <span class="shopify-product-num" style="color:${deltaColor}">${deltaSign}${this._fmtMoney(delta)}</span>
                    </div>`;
            }).join('');
        }
        if (scanEl) scanEl.style.display = '';
    },

    _buildRecommendation({ cpaAtual, cpaAlvo, cpaBreak, lucroUnit, spend, sales }) {
        let title, color, body, suggested;
        const ratio = cpaAlvo > 0 ? cpaAtual / cpaAlvo : Infinity;

        if (cpaAtual >= cpaBreak) {
            title = '<i data-lucide="circle" style="width:10px;height:10px;fill:#ef4444;color:#ef4444"></i> PAUSAR ou refatorar';
            color = 'var(--red, #dc2626)';
            body = `Seu CPA (${this._fmtMoney(cpaAtual)}) atingiu ou ultrapassou o breakeven (${this._fmtMoney(cpaBreak)}). Cada venda está no prejuízo. Pause a campanha, revise oferta/funil/criativo antes de subir orçamento.`;
        } else if (cpaAtual > cpaAlvo) {
            title = '<i data-lucide="circle" style="width:10px;height:10px;fill:#f59e0b;color:#f59e0b"></i> OTIMIZAR antes de escalar';
            color = '#d97706';
            body = `CPA atual (${this._fmtMoney(cpaAtual)}) está entre o alvo (${this._fmtMoney(cpaAlvo)}) e o breakeven (${this._fmtMoney(cpaBreak)}). Você ainda lucra, mas não no nível da meta. Teste novo criativo ou público antes de injetar mais orçamento.`;
        } else if (ratio > 0.5) {
            title = '<i data-lucide="circle" style="width:10px;height:10px;fill:#10b981;color:#10b981"></i> MANTER e observar';
            color = 'var(--success, #16a34a)';
            body = `CPA atual (${this._fmtMoney(cpaAtual)}) está dentro da meta (${this._fmtMoney(cpaAlvo)}), mas próximo. Mantenha o orçamento atual e observe estabilidade por mais 24-48h antes de escalar.`;
        } else {
            const bump = 0.25; // 25%
            suggested = spend * (1 + bump);
            title = '<i data-lucide="circle" style="width:10px;height:10px;fill:#10b981;color:#10b981"></i> ESCALAR';
            color = 'var(--success, #16a34a)';
            body = `CPA atual (${this._fmtMoney(cpaAtual)}) está bem abaixo do alvo (${this._fmtMoney(cpaAlvo)}). Escale em passos para não quebrar o aprendizado do algoritmo. Sugestão: subir o orçamento em +25% <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> <strong>${this._fmtMoney(suggested)}</strong>.`;
        }

        return `
            <div style="border-left:3px solid ${color};padding:0.4rem 0.9rem">
                <strong style="color:${color};font-size:0.95rem">${title}</strong>
                <p style="margin:0.4rem 0 0;font-size:0.85rem;line-height:1.5">${body}</p>
            </div>`;
    },

    _setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    },

    _esc(s) {
        const el = document.createElement('span');
        el.textContent = s || '';
        return el.innerHTML;
    },
};
