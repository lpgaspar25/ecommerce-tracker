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
        document.getElementById('calc-country')?.addEventListener('change', () => this.onCountryChange());

        // Section A — Sales simulation
        document.getElementById('calc-a-sales').addEventListener('input', () => this.calcSectionA());

        // Section B — Profit target → budget
        document.getElementById('calc-b-target').addEventListener('input', () => this.calcSectionB());
        document.getElementById('calc-b-currency').addEventListener('change', () => this.calcSectionB());

        // Section C+E+F — unified budget inputs
        document.getElementById('calc-c-budget').addEventListener('input', () => this.calcSectionCEF());
        document.getElementById('calc-c-currency').addEventListener('change', () => this.calcSectionCEF());
        document.getElementById('calc-f-margin').addEventListener('input', () => this.calcSectionCEF());

        // Section D — Compare CPAs
        ['calc-d-cpa-target', 'calc-d-cpa-real', 'calc-d-target-profit'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.calcSectionD());
        });
        document.getElementById('calc-d-profit-currency').addEventListener('change', () => this.calcSectionD());

        // Section G — CPC Ideal
        ['calc-g-cpa-target', 'calc-g-conv-rate', 'calc-g-ctr'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.calcSectionG());
        });
        document.getElementById('calc-g-currency').addEventListener('change', () => this.calcSectionG());

        // Section H — CPA ↔ Vendas
        ['calc-h-cpa', 'calc-h-budget', 'calc-h-sales-target'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.calcSectionH());
        });
        document.getElementById('calc-h-currency').addEventListener('change', () => this.calcSectionH());

        // Section I — Campaign P&L
        ['calc-i-sales', 'calc-i-cpa', 'calc-i-budget-spent', 'calc-i-price', 'calc-i-cost', 'calc-i-tax', 'calc-i-variable'].forEach(id => {
            document.getElementById(id).addEventListener('input', () => this.calcSectionI());
        });
        ['calc-i-ads-currency', 'calc-i-price-currency', 'calc-i-cost-currency'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => this.calcSectionI());
        });
        document.getElementById('calc-i-sim-sales').addEventListener('input', () => this.calcSectionISim());

        // Pontuação de milhar ao digitar. Converte os campos para texto —
        // type="number" descarta qualquer separador — e todas as leituras
        // acima já passam por NumFmt.val(), então o valor lido continua limpo.
        if (typeof NumFmt !== 'undefined') {
            NumFmt.attachAll([
                'calc-ticket', 'calc-cpa', 'calc-a-sales', 'calc-b-target',
                'calc-c-budget', 'calc-f-margin',
                'calc-d-cpa-target', 'calc-d-cpa-real', 'calc-d-target-profit',
                'calc-g-cpa-target', 'calc-g-conv-rate', 'calc-g-ctr',
                'calc-h-cpa', 'calc-h-budget', 'calc-h-sales-target',
                'calc-i-sales', 'calc-i-cpa', 'calc-i-budget-spent', 'calc-i-price',
                'calc-i-cost', 'calc-i-tax', 'calc-i-variable', 'calc-i-sim-sales',
            ]);
        }

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
        NumFmt.set('calc-ticket', product.price);

        // Pre-fill CPA from product
        NumFmt.set('calc-cpa', product.cpa);
        document.getElementById('calc-currency').value = product.cpaCurrency;

        // Pre-fill Section D target CPA
        NumFmt.set('calc-d-cpa-target', product.cpa);

        // Pre-fill Section G CPA target
        NumFmt.set('calc-g-cpa-target', product.cpa);
        document.getElementById('calc-g-currency').value = product.cpaCurrency;

        // Pre-fill Section I from product
        NumFmt.set('calc-i-price', product.price);
        document.getElementById('calc-i-price-currency').value = product.priceCurrency;
        NumFmt.set('calc-i-cost', product.cost);
        document.getElementById('calc-i-cost-currency').value = product.costCurrency;
        NumFmt.set('calc-i-tax', product.tax);
        NumFmt.set('calc-i-variable', product.variableCosts);
        document.getElementById('calc-i-ads-currency').value = product.cpaCurrency;
        document.getElementById('calc-i-autofill-hint').style.display = 'block';

        this._fillCountrySelect();
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

        const ticketVal = NumFmt.val('calc-ticket');
        if (ticketVal > 0) return ticketVal;
        return product.price;
    },

    // ── País selecionado: preço e custo mudam por destino ──
    // Retorna a entrada de countryPrices do país escolhido, ou null.
    _getCountryEntry() {
        const product = this._selectedProduct;
        const cc = document.getElementById('calc-country')?.value || '';
        if (!product || !cc || !Array.isArray(product.countryPrices)) return null;
        return product.countryPrices.find(cp => cp.country === cc) || null;
    },

    // Custo efetivo: o do país quando cadastrado, senão o padrão do produto.
    // Devolve {value, currency, fonte} para a interface poder explicar de onde veio.
    _getEffectiveCost() {
        const product = this._selectedProduct;
        if (!product) return { value: 0, currency: 'USD', fonte: 'nenhum' };
        const cp = this._getCountryEntry();
        if (cp && cp.cost != null && cp.cost !== '') {
            return { value: Number(cp.cost) || 0, currency: cp.currency || product.costCurrency, fonte: 'pais' };
        }
        return { value: product.cost, currency: product.costCurrency, fonte: 'padrao' };
    },

    // Preenche o seletor de país com os países cadastrados no produto.
    _fillCountrySelect() {
        const sel = document.getElementById('calc-country');
        if (!sel) return;
        const product = this._selectedProduct;
        const anterior = sel.value;
        const lista = (product?.countryPrices || []).filter(cp => cp && cp.country);
        sel.innerHTML = '<option value="">Padrão do produto</option>' + lista.map(cp => {
            const temCusto = cp.cost != null && cp.cost !== '';
            const preco = cp.tiers?.[0]?.price || cp.price || 0;
            const detalhe = [preco ? `${cp.currency} ${preco}` : '', temCusto ? `custo ${cp.currency} ${cp.cost}` : ''].filter(Boolean).join(' · ');
            return `<option value="${cp.country}">${cp.country}${detalhe ? ' — ' + detalhe : ''}</option>`;
        }).join('');
        // Preserva a escolha do usuário se o país ainda existir
        if (anterior && lista.some(cp => cp.country === anterior)) sel.value = anterior;
        sel.disabled = lista.length === 0;
    },

    onCountryChange() {
        const cp = this._getCountryEntry();
        if (cp) {
            const preco = cp.tiers?.[0]?.price || cp.price || 0;
            if (preco > 0) NumFmt.set('calc-ticket', preco);
            if (cp.currency) {
                const selMoeda = document.getElementById('calc-currency');
                if (selMoeda && [...selMoeda.options].some(o => o.value === cp.currency)) selMoeda.value = cp.currency;
            }
        } else if (this._selectedProduct) {
            NumFmt.set('calc-ticket', this._selectedProduct.price);
        }
        // A seção I tem custo próprio editável — reflete o país escolhido
        const custo = this._getEffectiveCost();
        NumFmt.set('calc-i-cost', custo.value);
        const selCusto = document.getElementById('calc-i-cost-currency');
        if (selCusto && [...selCusto.options].some(o => o.value === custo.currency)) selCusto.value = custo.currency;

        this.updateProductInfo();
        this.recalcAll();
    },

    // Calculate profit per sale using the editable ticket price
    _calculateProfitWithTicket(cpaCurrency, cpaValue) {
        const product = this._selectedProduct;
        if (!product) return 0;

        const effectivePrice = this._getEffectivePrice();
        // Preço na moeda do país quando há país selecionado
        const cp = this._getCountryEntry();
        const priceCurrency = (cp && cp.currency) ? cp.currency : product.priceCurrency;
        const custo = this._getEffectiveCost();

        // Normalize everything to USD
        const priceUSD = convertToUSD(effectivePrice, priceCurrency);
        const costUSD = convertToUSD(custo.value, custo.currency);
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

        const cpa = NumFmt.val('calc-cpa') || 0;
        const cpaCurrency = document.getElementById('calc-currency').value;
        const effectivePrice = this._getEffectivePrice();

        const cpSel = this._getCountryEntry();
        const custoEf = this._getEffectiveCost();
        document.getElementById('calc-info-price').textContent = formatDualCurrency(effectivePrice, cpSel?.currency || product.priceCurrency);

        // Deixa explícito quando o custo vem do país — senão o usuário vê um
        // número diferente do cadastro principal e acha que é erro.
        const elCusto = document.getElementById('calc-info-cost');
        elCusto.textContent = formatDualCurrency(custoEf.value, custoEf.currency);
        const chip = elCusto.closest('.info-chip');
        if (chip) {
            const marca = chip.querySelector('.calc-cost-src');
            if (custoEf.fonte === 'pais') {
                if (!marca) elCusto.insertAdjacentHTML('afterend', `<span class="calc-cost-src" title="Custo cadastrado para ${cpSel.country}">${cpSel.country}</span>`);
                else { marca.textContent = cpSel.country; marca.title = `Custo cadastrado para ${cpSel.country}`; }
            } else if (marca) marca.remove();
        }
        document.getElementById('calc-info-tax').textContent = product.tax + '%';
        document.getElementById('calc-info-variable').textContent = product.variableCosts + '%';

        const profitUSD = this._calculateProfitWithTicket(cpaCurrency, cpa);
        document.getElementById('calc-info-profit').textContent = formatDualCurrency(profitUSD, 'USD');
        document.getElementById('calc-info-profit').style.color = profitUSD >= 0 ? 'var(--green)' : 'var(--red)';
    },

    hideAllResults() {
        ['calc-a-results', 'calc-a-scenarios', 'calc-b-results', 'calc-c-results', 'calc-d-results',
         'calc-g-results', 'calc-g-scenarios', 'calc-h-results', 'calc-i-results', 'calc-i-simulate'].forEach(id => {
            document.getElementById(id).style.display = 'none';
        });
    },

    recalcAll() {
        this.calcSectionA();
        this.calcSectionB();
        this.calcSectionCEF();
        this.calcSectionD();
        this.calcSectionG();
        this.calcSectionH();
        this.calcSectionI();
    },

    // Returns gross margin per sale (price - cost - tax - variableCosts), WITHOUT CPA
    _getGrossMarginPerSale() {
        const product = this._selectedProduct;
        if (!product) return 0;
        const cp = this._getCountryEntry();
        const priceCurrency = (cp && cp.currency) ? cp.currency : product.priceCurrency;
        const custo = this._getEffectiveCost();
        const priceUSD = convertToUSD(this._getEffectivePrice(), priceCurrency);
        const costUSD = convertToUSD(custo.value, custo.currency);
        return priceUSD - costUSD - (priceUSD * product.tax / 100) - (priceUSD * product.variableCosts / 100);
    },

    _getCurrentCalcData() {
        const product = this._selectedProduct;
        if (!product) return null;

        const cpa = NumFmt.val('calc-cpa') || 0;
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
        const salesInput = Math.trunc(NumFmt.val('calc-a-sales')) || 0;
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
        const customQty = Math.trunc(NumFmt.val('calc-a-custom-qty')) || 0;
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

        const customQty = Math.trunc(NumFmt.val('calc-a-custom-qty')) || 0;

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
        const target = NumFmt.val('calc-b-target') || 0;
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

    // ---- Section C+E+F: Orçamento → Previsão + Break-Even + Margem ----
    calcSectionCEF() {
        const data = this._getCurrentCalcData();
        const budget = NumFmt.val('calc-c-budget') || 0;
        const budgetCurrency = document.getElementById('calc-c-currency').value;
        const resultsEl = document.getElementById('calc-c-results');

        if (!data || budget <= 0 || data.cpaUSD <= 0) {
            resultsEl.style.display = 'none';
            return;
        }

        resultsEl.style.display = 'grid';

        const budgetUSD = convertToUSD(budget, budgetCurrency);
        const grossMargin = this._getGrossMarginPerSale();

        // — Part C: previsão com CPA atual —
        const salesPredicted = Math.floor(budgetUSD / data.cpaUSD);
        const profitPredicted = salesPredicted * data.profitPerSale;
        const revenuePredicted = salesPredicted * data.priceUSD;

        document.getElementById('calc-c-sales').textContent = `${salesPredicted} vendas`;
        document.getElementById('calc-c-profit').textContent = formatDualCurrency(profitPredicted, 'USD');
        document.getElementById('calc-c-profit').style.color = profitPredicted >= 0 ? 'var(--green)' : 'var(--red)';
        document.getElementById('calc-c-revenue').textContent = formatDualCurrency(revenuePredicted, 'USD');

        // — Part E: break-even —
        if (grossMargin > 0) {
            const breakEvenSales = Math.ceil(budgetUSD / grossMargin);
            const breakEvenROAS = data.priceUSD / grossMargin;
            document.getElementById('calc-e-sales').textContent = `${breakEvenSales} vendas`;
            document.getElementById('calc-e-cpa-max').textContent = formatDualCurrency(grossMargin, 'USD');
            document.getElementById('calc-e-roas-min').textContent = breakEvenROAS.toFixed(2) + 'x';
        }

        // — Part F: meta de margem % —
        const marginPct = NumFmt.val('calc-f-margin');
        const fRows = ['calc-f-results-row', 'calc-f-cpa-row', 'calc-f-roas-row', 'calc-f-status-row'];
        const hasMargin = !isNaN(marginPct) && marginPct >= 0 && grossMargin > 0;

        fRows.forEach(id => {
            document.getElementById(id).style.display = hasMargin ? '' : 'none';
        });

        if (hasMargin) {
            const targetProfitPerSale = data.priceUSD * (marginPct / 100);
            const maxCPA = grossMargin - targetProfitPerSale;
            const minROAS = maxCPA > 0 ? data.priceUSD / maxCPA : null;
            const cpaDiff = data.cpaUSD - maxCPA;

            document.getElementById('calc-f-margin-label').textContent = marginPct;
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
                statusEl.innerHTML = `<i data-lucide="check" style="width:14px;height:14px;vertical-align:-2px"></i> Dentro da meta (CPA ${formatDualCurrency(Math.abs(cpaDiff), 'USD')} abaixo do máximo)`;
                statusEl.style.color = 'var(--green)';
            } else {
                statusEl.innerHTML = `<i data-lucide="x" style="width:14px;height:14px;vertical-align:-2px"></i> Fora da meta (CPA ${formatDualCurrency(Math.abs(cpaDiff), 'USD')} acima do máximo)`;
                statusEl.style.color = 'var(--red)';
            }
        }
    },

    // ---- Section G: CPC Ideal ----
    calcSectionG() {
        const cpaTarget = NumFmt.val('calc-g-cpa-target') || 0;
        const currency = document.getElementById('calc-g-currency').value;
        const convRate = NumFmt.val('calc-g-conv-rate') || 0;
        const ctr = NumFmt.val('calc-g-ctr') || 0;
        const resultsEl = document.getElementById('calc-g-results');
        const scenariosEl = document.getElementById('calc-g-scenarios');

        if (cpaTarget <= 0 || convRate <= 0) {
            resultsEl.style.display = 'none';
            scenariosEl.style.display = 'none';
            return;
        }

        resultsEl.style.display = 'grid';

        const cpaUSD = convertToUSD(cpaTarget, currency);
        // CPC max = CPA * conversion rate (as decimal)
        const convDecimal = convRate / 100;
        const cpcMaxUSD = cpaUSD * convDecimal;
        const clicksPerSale = Math.ceil(1 / convDecimal);

        document.getElementById('calc-g-cpc-max').textContent = formatDualCurrency(cpcMaxUSD, 'USD');
        document.getElementById('calc-g-clicks-per-sale').textContent = clicksPerSale;

        if (ctr > 0) {
            const ctrDecimal = ctr / 100;
            const cpmMaxUSD = cpcMaxUSD * ctrDecimal * 1000;
            const impressionsPerSale = Math.ceil(clicksPerSale / ctrDecimal);
            document.getElementById('calc-g-cpm-max').textContent = formatDualCurrency(cpmMaxUSD, 'USD');
            document.getElementById('calc-g-impressions-per-sale').textContent = impressionsPerSale.toLocaleString();
        } else {
            document.getElementById('calc-g-cpm-max').textContent = 'Informe o CTR';
            document.getElementById('calc-g-impressions-per-sale').textContent = 'Informe o CTR';
        }

        // Scenarios: different CPC values and their resulting CPA
        scenariosEl.style.display = 'block';
        const cpcValues = [0.10, 0.20, 0.30, 0.50, 0.75, 1.00, 1.50, 2.00, 3.00, 5.00];
        const data = this._getCurrentCalcData();

        const tbody = document.getElementById('calc-g-scenarios-tbody');
        tbody.innerHTML = cpcValues.map(cpc => {
            const resultingCPA = cpc / convDecimal;
            const withinTarget = resultingCPA <= cpaUSD;
            const statusIcon = withinTarget ? '<i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i>' : '<i data-lucide="x-circle" style="width:14px;height:14px;vertical-align:-2px"></i>';
            const statusColor = withinTarget ? 'var(--green)' : 'var(--red)';

            let profitText = '--';
            if (data) {
                const profitPerSale = this._calculateProfitWithTicket(currency, convertCurrency(resultingCPA, 'USD', currency));
                profitText = formatDualCurrency(profitPerSale, 'USD');
            }

            return `<tr>
                <td>${formatDualCurrency(cpc, 'USD')}</td>
                <td>${formatDualCurrency(resultingCPA, 'USD')}</td>
                <td style="color:${statusColor}">${statusIcon} ${withinTarget ? 'Dentro' : 'Acima'}</td>
                <td>${profitText}</td>
            </tr>`;
        }).join('');
    },

    // ---- Section H: CPA Desejado / Vendas ----
    calcSectionH() {
        const cpa = NumFmt.val('calc-h-cpa') || 0;
        const currency = document.getElementById('calc-h-currency').value;
        const budget = NumFmt.val('calc-h-budget') || 0;
        const salesTarget = Math.trunc(NumFmt.val('calc-h-sales-target')) || 0;
        const resultsEl = document.getElementById('calc-h-results');

        if (cpa <= 0 || (budget <= 0 && salesTarget <= 0)) {
            resultsEl.style.display = 'none';
            return;
        }

        resultsEl.style.display = 'grid';

        const cpaUSD = convertToUSD(cpa, currency);
        const data = this._getCurrentCalcData();
        const priceUSD = data ? data.priceUSD : 0;

        let salesPredicted, budgetNeeded;

        if (budget > 0) {
            const budgetUSD = convertToUSD(budget, currency);
            salesPredicted = Math.floor(budgetUSD / cpaUSD);
            budgetNeeded = budgetUSD;
        } else {
            salesPredicted = salesTarget;
            budgetNeeded = salesTarget * cpaUSD;
        }

        // Profit per sale using the desired CPA
        let profitPerSale = 0;
        if (data) {
            profitPerSale = this._calculateProfitWithTicket(currency, cpa);
        }

        const totalProfit = salesPredicted * profitPerSale;
        const totalRevenue = salesPredicted * priceUSD;
        const roas = budgetNeeded > 0 ? totalRevenue / budgetNeeded : 0;

        document.getElementById('calc-h-sales-predicted').textContent = salesPredicted + ' vendas';
        document.getElementById('calc-h-budget-needed').textContent = formatDualCurrency(budgetNeeded, 'USD');

        const profitEl = document.getElementById('calc-h-profit-per-sale');
        profitEl.textContent = formatDualCurrency(profitPerSale, 'USD');
        profitEl.style.color = profitPerSale >= 0 ? 'var(--green)' : 'var(--red)';

        const totalProfitEl = document.getElementById('calc-h-total-profit');
        totalProfitEl.textContent = formatDualCurrency(totalProfit, 'USD');
        totalProfitEl.style.color = totalProfit >= 0 ? 'var(--green)' : 'var(--red)';

        document.getElementById('calc-h-total-revenue').textContent = priceUSD > 0 ? formatDualCurrency(totalRevenue, 'USD') : 'Selecione um produto';
        document.getElementById('calc-h-roas').textContent = roas > 0 ? roas.toFixed(2) + 'x' : '--';
    },

    // ---- Section I: Campaign P&L ----
    calcSectionI() {
        const sales = Math.trunc(NumFmt.val('calc-i-sales')) || 0;
        const cpa = NumFmt.val('calc-i-cpa') || 0;
        const adsCurrency = document.getElementById('calc-i-ads-currency').value;
        const budgetSpent = NumFmt.val('calc-i-budget-spent') || 0;
        const price = NumFmt.val('calc-i-price') || 0;
        const priceCurrency = document.getElementById('calc-i-price-currency').value;
        const cost = NumFmt.val('calc-i-cost') || 0;
        const costCurrency = document.getElementById('calc-i-cost-currency').value;
        const taxPct = NumFmt.val('calc-i-tax') || 0;
        const variablePct = NumFmt.val('calc-i-variable') || 0;
        const resultsEl = document.getElementById('calc-i-results');
        const simulateEl = document.getElementById('calc-i-simulate');

        if (sales <= 0 || price <= 0) {
            resultsEl.style.display = 'none';
            simulateEl.style.display = 'none';
            return;
        }

        // Calculate ad spend: either from budget input or CPA * sales
        let adSpendUSD;
        if (budgetSpent > 0) {
            adSpendUSD = convertToUSD(budgetSpent, adsCurrency);
        } else if (cpa > 0) {
            adSpendUSD = convertToUSD(cpa, adsCurrency) * sales;
        } else {
            resultsEl.style.display = 'none';
            simulateEl.style.display = 'none';
            return;
        }

        resultsEl.style.display = 'grid';
        simulateEl.style.display = 'block';

        const priceUSD = convertToUSD(price, priceCurrency);
        const costUSD = convertToUSD(cost, costCurrency);

        const revenuePerSale = priceUSD;
        const totalRevenue = revenuePerSale * sales;
        const totalCost = costUSD * sales;
        const totalTax = totalRevenue * (taxPct / 100);
        const totalVariable = totalRevenue * (variablePct / 100);
        const netProfit = totalRevenue - totalCost - totalTax - totalVariable - adSpendUSD;
        const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0;
        const roas = adSpendUSD > 0 ? totalRevenue / adSpendUSD : 0;
        const roi = adSpendUSD > 0 ? (netProfit / adSpendUSD) * 100 : 0;

        // Build P&L table
        const adSpendPerSale = adSpendUSD / sales;
        const rows = [
            { item: '<i data-lucide="dollar-sign" style="width:14px;height:14px;vertical-align:-2px"></i> Receita', perSale: revenuePerSale, total: totalRevenue, pct: 100, color: '' },
            { item: '<i data-lucide="package" style="width:14px;height:14px;vertical-align:-2px"></i> Custo do Produto', perSale: -costUSD, total: -totalCost, pct: totalRevenue > 0 ? -(totalCost / totalRevenue) * 100 : 0, color: 'var(--red)' },
            { item: '<i data-lucide="landmark" style="width:14px;height:14px;vertical-align:-2px"></i>️ Impostos / Taxas (' + taxPct + '%)', perSale: -(revenuePerSale * taxPct / 100), total: -totalTax, pct: -taxPct, color: 'var(--red)' },
            { item: '<i data-lucide="bar-chart-3" style="width:14px;height:14px;vertical-align:-2px"></i> Custos Variáveis (' + variablePct + '%)', perSale: -(revenuePerSale * variablePct / 100), total: -totalVariable, pct: -variablePct, color: 'var(--red)' },
            { item: '<i data-lucide="megaphone" style="width:14px;height:14px;vertical-align:-2px"></i> Ads (Investimento)', perSale: -adSpendPerSale, total: -adSpendUSD, pct: totalRevenue > 0 ? -(adSpendUSD / totalRevenue) * 100 : 0, color: 'var(--red)' },
            { item: '<strong><i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Lucro Líquido</strong>', perSale: netProfit / sales, total: netProfit, pct: netMargin, color: netProfit >= 0 ? 'var(--green)' : 'var(--red)', bold: true }
        ];

        const tbody = document.getElementById('calc-i-tbody');
        tbody.innerHTML = rows.map(row => {
            const style = row.color ? `style="color:${row.color}"` : '';
            const borderStyle = row.bold ? 'style="border-top:2px solid var(--border); font-weight:bold"' : '';
            return `<tr ${borderStyle}>
                <td>${row.item}</td>
                <td ${style}>${formatDualCurrency(Math.abs(row.perSale), 'USD')}${row.perSale < 0 ? ' (-)' : ''}</td>
                <td ${style}>${formatDualCurrency(Math.abs(row.total), 'USD')}${row.total < 0 ? ' (-)' : ''}</td>
                <td ${style}>${Math.abs(row.pct).toFixed(1)}%</td>
            </tr>`;
        }).join('');

        // Summary cards
        const profitEl = document.getElementById('calc-i-net-profit');
        profitEl.textContent = formatDualCurrency(netProfit, 'USD');
        profitEl.style.color = netProfit >= 0 ? 'var(--green)' : 'var(--red)';

        const marginEl = document.getElementById('calc-i-net-margin');
        marginEl.textContent = netMargin.toFixed(1) + '%';
        marginEl.style.color = netMargin >= 0 ? 'var(--green)' : 'var(--red)';

        document.getElementById('calc-i-roas').textContent = roas.toFixed(2) + 'x';

        const roiEl = document.getElementById('calc-i-roi');
        roiEl.textContent = roi.toFixed(1) + '%';
        roiEl.style.color = roi >= 0 ? 'var(--green)' : 'var(--red)';

        // Store for simulation
        this._sectionIData = { cpa, adsCurrency, priceUSD, costUSD, taxPct, variablePct, adSpendUSD, sales, budgetSpent };
        this.calcSectionISim();
    },

    calcSectionISim() {
        const d = this._sectionIData;
        if (!d) return;

        const simSales = Math.trunc(NumFmt.val('calc-i-sim-sales')) || 0;
        const simResults = document.getElementById('calc-i-sim-results');

        if (simSales <= 0) {
            simResults.style.display = 'none';
            return;
        }

        simResults.style.display = 'grid';

        const cpaUSD = d.adSpendUSD / d.sales; // actual CPA from the campaign
        const simBudget = simSales * cpaUSD;
        const simRevenue = simSales * d.priceUSD;
        const simCost = simSales * d.costUSD;
        const simTax = simRevenue * (d.taxPct / 100);
        const simVariable = simRevenue * (d.variablePct / 100);
        const simProfit = simRevenue - simCost - simTax - simVariable - simBudget;

        document.getElementById('calc-i-sim-budget').textContent = formatDualCurrency(simBudget, 'USD');

        const profitEl = document.getElementById('calc-i-sim-profit');
        profitEl.textContent = formatDualCurrency(simProfit, 'USD');
        profitEl.style.color = simProfit >= 0 ? 'var(--green)' : 'var(--red)';

        document.getElementById('calc-i-sim-revenue').textContent = formatDualCurrency(simRevenue, 'USD');
    },

    // ---- Section D: Compare CPAs ----
    calcSectionD() {
        const product = this._selectedProduct;
        if (!product) {
            document.getElementById('calc-d-results').style.display = 'none';
            return;
        }

        const cpaTarget = NumFmt.val('calc-d-cpa-target') || 0;
        const cpaReal = NumFmt.val('calc-d-cpa-real') || 0;
        const targetProfit = NumFmt.val('calc-d-target-profit') || 0;
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
