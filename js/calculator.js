/* ===========================
   Calculator.js — CPA & Budget Simulator
   With editable Ticket (price) and custom scenario row
   =========================== */

const CalculatorModule = {
    _selectedProduct: null,

    init() {
        // Product selection
        document.getElementById('calc-product').addEventListener('change', () => this.onProductChange());
        document.getElementById('calc-cpa').addEventListener('input', () => this.onCPAChange());
        document.getElementById('calc-ticket').addEventListener('input', () => this.onTicketChange());
        document.getElementById('calc-currency').addEventListener('change', () => this.onCPAChange());

        // Section A — Sales simulation
        document.getElementById('calc-a-sales').addEventListener('input', () => this.calcSectionA());

        // Section B — Profit target → budget
        document.getElementById('calc-b-target').addEventListener('input', () => this.calcSectionB());
        document.getElementById('calc-b-currency').addEventListener('change', () => this.calcSectionB());

        // Section C — Budget → profit prediction
        document.getElementById('calc-c-budget').addEventListener('input', () => this.calcSectionC());
        document.getElementById('calc-c-currency').addEventListener('change', () => this.calcSectionC());

        // Section D — Compare CPAs
        ['calc-d-cpa-target', 'calc-d-cpa-real', 'calc-d-target-profit'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.calcSectionD());
        });
        document.getElementById('calc-d-profit-currency').addEventListener('change', () => this.calcSectionD());

        // Section E — Break-Even
        document.getElementById('calc-e-budget').addEventListener('input', () => this.calcSectionE());
        document.getElementById('calc-e-currency').addEventListener('change', () => this.calcSectionE());

        // Section F — Meta de Margem %
        document.getElementById('calc-f-margin').addEventListener('input', () => this.calcSectionF());

        EventBus.on('dataLoaded', () => this.onProductChange());
        EventBus.on('productsChanged', () => this.onProductChange());
        EventBus.on('rateUpdated', () => {
            this.updateProductInfo();
            this.recalcAll();
        });
    },

    onProductChange() {
        const productId = document.getElementById('calc-product').value;
        const product = getProductById(productId);
        this._selectedProduct = product;

        const infoSection = document.getElementById('calc-product-info');

        if (!product) {
            infoSection.style.display = 'none';
            this.hideAllResults();
            return;
        }

        // Pre-fill Ticket (price) from product
        document.getElementById('calc-ticket').value = product.price;

        // Pre-fill CPA from product
        document.getElementById('calc-cpa').value = product.cpa;
        document.getElementById('calc-currency').value = product.cpaCurrency;

        // Pre-fill Section D target CPA
        document.getElementById('calc-d-cpa-target').value = product.cpa;

        this.updateProductInfo();
        this.recalcAll();
    },

    onCPAChange() {
        this.updateProductInfo();
        this.recalcAll();
    },

    onTicketChange() {
        this.updateProductInfo();
        this.recalcAll();
    },

    // Get the effective price (from ticket input or product default)
    _getEffectivePrice() {
        const product = this._selectedProduct;
        if (!product) return 0;

        const ticketVal = parseFloat(document.getElementById('calc-ticket').value);
        if (ticketVal > 0) return ticketVal;
        return product.price;
    },

    // Calculate profit per sale using the editable ticket price
    _calculateProfitWithTicket(cpaCurrency, cpaValue) {
        const product = this._selectedProduct;
        if (!product) return 0;

        const effectivePrice = this._getEffectivePrice();
        const priceCurrency = product.priceCurrency;

        // Normalize everything to USD
        const priceUSD = convertToUSD(effectivePrice, priceCurrency);
        const costUSD = convertToUSD(product.cost, product.costCurrency);
        const cpaUSD = convertToUSD(cpaValue, cpaCurrency);
        const taxAmount = priceUSD * (product.tax / 100);
        const variableAmount = priceUSD * (product.variableCosts / 100);

        return priceUSD - costUSD - taxAmount - variableAmount - cpaUSD;
    },

    updateProductInfo() {
        const product = this._selectedProduct;
        const infoSection = document.getElementById('calc-product-info');

        if (!product) {
            infoSection.style.display = 'none';
            return;
        }

        infoSection.style.display = 'flex';

        const cpa = parseFloat(document.getElementById('calc-cpa').value) || 0;
        const cpaCurrency = document.getElementById('calc-currency').value;
        const effectivePrice = this._getEffectivePrice();

        document.getElementById('calc-info-price').textContent = formatDualCurrency(effectivePrice, product.priceCurrency);
        document.getElementById('calc-info-cost').textContent = formatDualCurrency(product.cost, product.costCurrency);
        document.getElementById('calc-info-tax').textContent = product.tax + '%';
        document.getElementById('calc-info-variable').textContent = product.variableCosts + '%';

        const profitUSD = this._calculateProfitWithTicket(cpaCurrency, cpa);
        document.getElementById('calc-info-profit').textContent = formatDualCurrency(profitUSD, 'USD');
        document.getElementById('calc-info-profit').style.color = profitUSD >= 0 ? 'var(--green)' : 'var(--red)';
    },

    hideAllResults() {
        ['calc-a-results', 'calc-a-scenarios', 'calc-b-results', 'calc-c-results', 'calc-d-results'].forEach(id => {
            document.getElementById(id).style.display = 'none';
        });
    },

    recalcAll() {
        this.calcSectionA();
        this.calcSectionB();
        this.calcSectionC();
        this.calcSectionE();
        this.calcSectionF();
        this.calcSectionD();
    },

    // Returns gross margin per sale (price - cost - tax - variableCosts), WITHOUT CPA
    _getGrossMarginPerSale() {
        const product = this._selectedProduct;
        if (!product) return 0;
        const priceUSD = convertToUSD(this._getEffectivePrice(), product.priceCurrency);
        const costUSD = convertToUSD(product.cost, product.costCurrency);
        return priceUSD - costUSD - (priceUSD * product.tax / 100) - (priceUSD * product.variableCosts / 100);
    },

    _getCurrentCalcData() {
        const product = this._selectedProduct;
        if (!product) return null;

        const cpa = parseFloat(document.getElementById('calc-cpa').value) || 0;
        const cpaCurrency = document.getElementById('calc-currency').value;
        const effectivePrice = this._getEffectivePrice();

        const profitPerSale = this._calculateProfitWithTicket(cpaCurrency, cpa);
        const cpaUSD = convertToUSD(cpa, cpaCurrency);
        const priceUSD = convertToUSD(effectivePrice, product.priceCurrency);

        return { product, cpa, cpaCurrency, profitPerSale, cpaUSD, priceUSD };
    },

    // ---- Section A: Sales Simulation ----
    calcSectionA() {
        const data = this._getCurrentCalcData();
        const salesInput = parseInt(document.getElementById('calc-a-sales').value) || 0;
        const resultsEl = document.getElementById('calc-a-results');
        const scenariosEl = document.getElementById('calc-a-scenarios');

        if (!data || salesInput <= 0) {
            resultsEl.style.display = 'none';
            scenariosEl.style.display = 'none';
            return;
        }

        resultsEl.style.display = 'grid';
        scenariosEl.style.display = 'block';

        const profit = salesInput * data.profitPerSale;
        const budget = salesInput * data.cpaUSD;
        const revenue = salesInput * data.priceUSD;

        document.getElementById('calc-a-profit').textContent = formatDualCurrency(profit, 'USD');
        document.getElementById('calc-a-profit').style.color = profit >= 0 ? 'var(--green)' : 'var(--red)';
        document.getElementById('calc-a-budget').textContent = formatDualCurrency(budget, 'USD');
        document.getElementById('calc-a-revenue').textContent = formatDualCurrency(revenue, 'USD');

        // Scenarios table: editable custom row FIRST, then fixed rows
        const scenarios = [5, 10, 15, 20, 30, 50];
        const tbody = document.getElementById('calc-a-scenarios-tbody');

        // Custom editable row (FIRST)
        const customQty = parseInt(document.getElementById('calc-a-custom-qty')?.value) || 0;
        const customProfit = customQty > 0 ? customQty * data.profitPerSale : 0;
        const customBudget = customQty > 0 ? customQty * data.cpaUSD : 0;
        const customRevenue = customQty > 0 ? customQty * data.priceUSD : 0;
        const customProfitColor = customProfit >= 0 ? 'var(--green)' : 'var(--red)';

        let html = `<tr class="custom-scenario-row">
            <td><input type="number" id="calc-a-custom-qty" class="input input-sm scenario-input" placeholder="Qtd" step="1" min="1" value="${customQty || ''}"></td>
            <td id="calc-a-custom-profit" style="color:${customProfitColor}">${customQty > 0 ? formatDualCurrency(customProfit, 'USD') : '--'}</td>
            <td id="calc-a-custom-budget">${customQty > 0 ? formatDualCurrency(customBudget, 'USD') : '--'}</td>
            <td id="calc-a-custom-revenue">${customQty > 0 ? formatDualCurrency(customRevenue, 'USD') : '--'}</td>
        </tr>`;

        // Fixed scenario rows
        html += scenarios.map(qty => {
            const sProfit = qty * data.profitPerSale;
            const sBudget = qty * data.cpaUSD;
            const sRevenue = qty * data.priceUSD;
            const profitColor = sProfit >= 0 ? 'var(--green)' : 'var(--red)';

            return `<tr>
                <td><strong>${qty}</strong></td>
                <td style="color:${profitColor}">${formatDualCurrency(sProfit, 'USD')}</td>
                <td>${formatDualCurrency(sBudget, 'USD')}</td>
                <td>${formatDualCurrency(sRevenue, 'USD')}</td>
            </tr>`;
        }).join('');

        tbody.innerHTML = html;

        // Re-attach event listener to the custom qty input
        const customInput = document.getElementById('calc-a-custom-qty');
        if (customInput) {
            customInput.addEventListener('input', () => this._updateCustomScenario());
        }
    },

    // Update only the custom scenario row (without re-rendering the whole table)
    _updateCustomScenario() {
        const data = this._getCurrentCalcData();
        if (!data) return;

        const customQty = parseInt(document.getElementById('calc-a-custom-qty').value) || 0;

        const profitEl = document.getElementById('calc-a-custom-profit');
        const budgetEl = document.getElementById('calc-a-custom-budget');
        const revenueEl = document.getElementById('calc-a-custom-revenue');

        if (customQty > 0) {
            const customProfit = customQty * data.profitPerSale;
            const customBudget = customQty * data.cpaUSD;
            const customRevenue = customQty * data.priceUSD;

            profitEl.textContent = formatDualCurrency(customProfit, 'USD');
            profitEl.style.color = customProfit >= 0 ? 'var(--green)' : 'var(--red)';
            budgetEl.textContent = formatDualCurrency(customBudget, 'USD');
            revenueEl.textContent = formatDualCurrency(customRevenue, 'USD');
        } else {
            profitEl.textContent = '--';
            profitEl.style.color = '';
            budgetEl.textContent = '--';
            revenueEl.textContent = '--';
        }
    },

    // ---- Section B: Profit Target → Budget ----
    calcSectionB() {
        const data = this._getCurrentCalcData();
        const target = parseFloat(document.getElementById('calc-b-target').value) || 0;
        const targetCurrency = document.getElementById('calc-b-currency').value;
        const resultsEl = document.getElementById('calc-b-results');

        if (!data || target <= 0 || data.profitPerSale <= 0) {
            resultsEl.style.display = 'none';
            return;
        }

        resultsEl.style.display = 'grid';

        const targetUSD = convertToUSD(target, targetCurrency);
        const salesNeeded = Math.ceil(targetUSD / data.profitPerSale);
        const budgetNeeded = salesNeeded * data.cpaUSD;
        const revenueExpected = salesNeeded * data.priceUSD;

        document.getElementById('calc-b-sales').textContent = `${salesNeeded} vendas`;
        document.getElementById('calc-b-budget').textContent = formatDualCurrency(budgetNeeded, 'USD');
        document.getElementById('calc-b-revenue').textContent = formatDualCurrency(revenueExpected, 'USD');
    },

    // ---- Section C: Budget → Profit Prediction ----
    calcSectionC() {
        const data = this._getCurrentCalcData();
        const budget = parseFloat(document.getElementById('calc-c-budget').value) || 0;
        const budgetCurrency = document.getElementById('calc-c-currency').value;
        const resultsEl = document.getElementById('calc-c-results');

        if (!data || budget <= 0 || data.cpaUSD <= 0) {
            resultsEl.style.display = 'none';
            return;
        }

        resultsEl.style.display = 'grid';

        const budgetUSD = convertToUSD(budget, budgetCurrency);
        const salesPredicted = Math.floor(budgetUSD / data.cpaUSD);
        const profitPredicted = salesPredicted * data.profitPerSale;
        const revenuePredicted = salesPredicted * data.priceUSD;

        document.getElementById('calc-c-sales').textContent = `${salesPredicted} vendas`;
        document.getElementById('calc-c-profit').textContent = formatDualCurrency(profitPredicted, 'USD');
        document.getElementById('calc-c-profit').style.color = profitPredicted >= 0 ? 'var(--green)' : 'var(--red)';
        document.getElementById('calc-c-revenue').textContent = formatDualCurrency(revenuePredicted, 'USD');
    },

    // ---- Section E: Break-Even por Orçamento ----
    calcSectionE() {
        const data = this._getCurrentCalcData();
        const budget = parseFloat(document.getElementById('calc-e-budget').value) || 0;
        const budgetCurrency = document.getElementById('calc-e-currency').value;
        const resultsEl = document.getElementById('calc-e-results');

        if (!data || budget <= 0) {
            resultsEl.style.display = 'none';
            return;
        }

        const grossMargin = this._getGrossMarginPerSale();

        if (grossMargin <= 0) {
            resultsEl.style.display = 'none';
            return;
        }

        resultsEl.style.display = 'grid';

        const budgetUSD = convertToUSD(budget, budgetCurrency);
        const breakEvenSales = Math.ceil(budgetUSD / grossMargin);
        const breakEvenROAS = data.priceUSD / grossMargin;

        document.getElementById('calc-e-sales').textContent = `${breakEvenSales} vendas`;
        document.getElementById('calc-e-cpa-max').textContent = formatDualCurrency(grossMargin, 'USD');
        document.getElementById('calc-e-roas-min').textContent = breakEvenROAS.toFixed(2) + 'x';
    },

    // ---- Section F: Meta de Margem % ----
    calcSectionF() {
        const data = this._getCurrentCalcData();
        const marginPct = parseFloat(document.getElementById('calc-f-margin').value);
        const resultsEl = document.getElementById('calc-f-results');

        if (!data || isNaN(marginPct) || marginPct < 0) {
            resultsEl.style.display = 'none';
            return;
        }

        const grossMargin = this._getGrossMarginPerSale();
        const targetProfitPerSale = data.priceUSD * (marginPct / 100);
        const maxCPA = grossMargin - targetProfitPerSale;
        const minROAS = maxCPA > 0 ? data.priceUSD / maxCPA : null;
        const cpaDiff = data.cpaUSD - maxCPA;

        resultsEl.style.display = 'grid';

        document.getElementById('calc-f-profit-per-sale').textContent = formatDualCurrency(targetProfitPerSale, 'USD');

        const cpaMaxEl = document.getElementById('calc-f-cpa-max');
        if (maxCPA > 0) {
            cpaMaxEl.textContent = formatDualCurrency(maxCPA, 'USD');
            cpaMaxEl.style.color = '';
        } else {
            cpaMaxEl.textContent = 'Impossível com essa margem';
            cpaMaxEl.style.color = 'var(--red)';
        }

        document.getElementById('calc-f-roas-min').textContent = minROAS ? minROAS.toFixed(2) + 'x' : '--';

        const statusEl = document.getElementById('calc-f-cpa-status');
        if (data.cpaUSD <= 0) {
            statusEl.textContent = '--';
            statusEl.style.color = '';
        } else if (maxCPA > 0 && data.cpaUSD <= maxCPA) {
            statusEl.textContent = `✓ Dentro da meta (CPA ${formatDualCurrency(Math.abs(cpaDiff), 'USD')} abaixo do máximo)`;
            statusEl.style.color = 'var(--green)';
        } else {
            statusEl.textContent = `✗ Fora da meta (CPA ${formatDualCurrency(Math.abs(cpaDiff), 'USD')} acima do máximo)`;
            statusEl.style.color = 'var(--red)';
        }
    },

    // ---- Section D: Compare CPAs ----
    calcSectionD() {
        const product = this._selectedProduct;
        if (!product) {
            document.getElementById('calc-d-results').style.display = 'none';
            return;
        }

        const cpaTarget = parseFloat(document.getElementById('calc-d-cpa-target').value) || 0;
        const cpaReal = parseFloat(document.getElementById('calc-d-cpa-real').value) || 0;
        const targetProfit = parseFloat(document.getElementById('calc-d-target-profit').value) || 0;
        const cpaCurrency = document.getElementById('calc-currency').value;
        const profitCurrency = document.getElementById('calc-d-profit-currency').value;

        if (cpaTarget <= 0 || cpaReal <= 0 || targetProfit <= 0) {
            document.getElementById('calc-d-results').style.display = 'none';
            return;
        }

        document.getElementById('calc-d-results').style.display = 'block';

        // Use editable ticket for Section D too
        const profitTarget = this._calculateProfitWithTicket(cpaCurrency, cpaTarget);
        const profitReal = this._calculateProfitWithTicket(cpaCurrency, cpaReal);

        const cpaTargetUSD = convertToUSD(cpaTarget, cpaCurrency);
        const cpaRealUSD = convertToUSD(cpaReal, cpaCurrency);
        const targetProfitUSD = convertToUSD(targetProfit, profitCurrency);

        const salesTarget = profitTarget > 0 ? Math.ceil(targetProfitUSD / profitTarget) : '--';
        const salesReal = profitReal > 0 ? Math.ceil(targetProfitUSD / profitReal) : '--';

        const budgetTarget = typeof salesTarget === 'number' ? salesTarget * cpaTargetUSD : '--';
        const budgetReal = typeof salesReal === 'number' ? salesReal * cpaRealUSD : '--';

        const rows = [
            {
                metric: 'CPA',
                target: formatDualCurrency(cpaTargetUSD, 'USD'),
                real: formatDualCurrency(cpaRealUSD, 'USD'),
                diff: formatDualCurrency(cpaRealUSD - cpaTargetUSD, 'USD')
            },
            {
                metric: 'Lucro/Venda',
                target: formatDualCurrency(profitTarget, 'USD'),
                real: formatDualCurrency(profitReal, 'USD'),
                diff: formatDualCurrency(profitReal - profitTarget, 'USD')
            },
            {
                metric: 'Vendas Necessárias',
                target: salesTarget,
                real: salesReal,
                diff: typeof salesTarget === 'number' && typeof salesReal === 'number'
                    ? (salesReal - salesTarget) : '--'
            },
            {
                metric: 'Orçamento Necessário',
                target: typeof budgetTarget === 'number' ? formatDualCurrency(budgetTarget, 'USD') : '--',
                real: typeof budgetReal === 'number' ? formatDualCurrency(budgetReal, 'USD') : '--',
                diff: typeof budgetTarget === 'number' && typeof budgetReal === 'number'
                    ? formatDualCurrency(budgetReal - budgetTarget, 'USD') : '--'
            }
        ];

        const tbody = document.getElementById('calc-d-tbody');
        tbody.innerHTML = rows.map(row => {
            return `<tr>
                <td><strong>${row.metric}</strong></td>
                <td>${row.target}</td>
                <td>${row.real}</td>
                <td>${row.diff}</td>
            </tr>`;
        }).join('');
    }
};

document.addEventListener('DOMContentLoaded', () => CalculatorModule.init());
