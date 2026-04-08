/* ===========================
   Products.js — Product management (CRUD + profit calculation)
   =========================== */

const ProductsModule = {
    COUNTRIES: [
        { code: 'GB', label: 'GB — Reino Unido', currency: 'GBP' },
        { code: 'DE', label: 'DE — Alemanha', currency: 'EUR' },
        { code: 'AU', label: 'AU — Austrália', currency: 'USD' },
        { code: 'IE', label: 'IE — Irlanda', currency: 'EUR' },
        { code: 'CA', label: 'CA — Canadá', currency: 'USD' },
        { code: 'AT', label: 'AT — Áustria', currency: 'EUR' },
        { code: 'US', label: 'US — Estados Unidos', currency: 'USD' },
        { code: 'FR', label: 'FR — França', currency: 'EUR' },
        { code: 'IT', label: 'IT — Itália', currency: 'EUR' },
        { code: 'ES', label: 'ES — Espanha', currency: 'EUR' },
        { code: 'NL', label: 'NL — Holanda', currency: 'EUR' },
        { code: 'BE', label: 'BE — Bélgica', currency: 'EUR' },
        { code: 'SE', label: 'SE — Suécia', currency: 'USD' },
        { code: 'NO', label: 'NO — Noruega', currency: 'USD' },
        { code: 'DK', label: 'DK — Dinamarca', currency: 'USD' },
        { code: 'PL', label: 'PL — Polônia', currency: 'USD' },
        { code: 'CZ', label: 'CZ — Rep. Tcheca', currency: 'USD' },
        { code: 'NZ', label: 'NZ — Nova Zelândia', currency: 'USD' },
    ],

    init() {
        document.getElementById('btn-add-product').addEventListener('click', () => this.openForm());
        document.getElementById('product-form').addEventListener('submit', (e) => this.handleSubmit(e));
        document.getElementById('product-cancel').addEventListener('click', () => closeModal('product-modal'));

        // Live profit preview on form changes
        ['product-price', 'product-price-currency', 'product-cost', 'product-cost-currency',
         'product-tax', 'product-variable-costs', 'product-cpa', 'product-cpa-currency'
        ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.updateProfitPreview());
        });

        EventBus.on('dataLoaded', () => this.render());
        EventBus.on('rateUpdated', () => this.render());
    },

    openForm(product = null) {
        const title = document.getElementById('product-modal-title');
        const form = document.getElementById('product-form');
        form.reset();

        // Clear country prices
        document.getElementById('country-prices-list').innerHTML = '';

        if (product) {
            title.textContent = 'Editar Produto';
            document.getElementById('product-id').value = product.id;
            document.getElementById('product-name').value = product.name;
            document.getElementById('product-language').value = product.language || product.country || 'Ingles';
            document.getElementById('product-price').value = product.price;
            document.getElementById('product-price-currency').value = product.priceCurrency;
            document.getElementById('product-cost').value = product.cost;
            document.getElementById('product-cost-currency').value = product.costCurrency;
            document.getElementById('product-tax').value = product.tax;
            document.getElementById('product-variable-costs').value = product.variableCosts;
            document.getElementById('product-cpa').value = product.cpa;
            document.getElementById('product-cpa-currency').value = product.cpaCurrency;

            // Load existing country prices
            if (product.countryPrices && product.countryPrices.length > 0) {
                product.countryPrices.forEach(cp => this.addCountryPriceRow(cp));
            }
        } else {
            title.textContent = 'Adicionar Produto';
            document.getElementById('product-id').value = '';
        }

        this.updateProfitPreview();
        openModal('product-modal');
    },

    addCountryPriceRow(data = null) {
        const list = document.getElementById('country-prices-list');
        const idx = list.children.length;

        const countryOptions = this.COUNTRIES.map(c =>
            `<option value="${c.code}" ${data && data.country === c.code ? 'selected' : ''}>${c.label}</option>`
        ).join('');

        const currencyOptions = ['USD', 'GBP', 'EUR'].map(cur =>
            `<option value="${cur}" ${data && data.currency === cur ? 'selected' : cur === 'USD' && !data ? 'selected' : ''}>${cur}</option>`
        ).join('');

        const row = document.createElement('div');
        row.className = 'country-price-row';
        row.dataset.idx = idx;
        row.innerHTML = `
            <select class="input input-sm cp-country">
                ${countryOptions}
            </select>
            <input type="number" class="input input-sm cp-price" step="0.01" placeholder="0.00" value="${data ? data.price : ''}">
            <select class="input input-sm cp-currency">
                ${currencyOptions}
            </select>
            <button type="button" class="btn btn-danger btn-sm" onclick="this.parentElement.remove()" title="Remover">&times;</button>
        `;

        // Auto-select currency based on country
        const countrySelect = row.querySelector('.cp-country');
        const currencySelect = row.querySelector('.cp-currency');
        countrySelect.addEventListener('change', () => {
            const found = this.COUNTRIES.find(c => c.code === countrySelect.value);
            if (found) currencySelect.value = found.currency;
        });

        list.appendChild(row);
    },

    _getCountryPrices() {
        const rows = document.querySelectorAll('#country-prices-list .country-price-row');
        const result = [];
        rows.forEach(row => {
            const country = row.querySelector('.cp-country').value;
            const price = parseFloat(row.querySelector('.cp-price').value) || 0;
            const currency = row.querySelector('.cp-currency').value;
            if (country && price > 0) {
                result.push({ country, price, currency });
            }
        });
        return result;
    },

    updateProfitPreview() {
        const product = this._getFormData();
        const profitUSD = calculateProfitPerSale(product, product.cpaCurrency, product.cpa);
        const rate = getExchangeRate();

        document.getElementById('preview-profit-usd').textContent =
            formatCurrency(profitUSD, 'USD');
        document.getElementById('preview-profit-brl').textContent =
            rate ? formatCurrency(profitUSD * rate, 'BRL') : '--';
    },

    _getFormData() {
        return {
            id: document.getElementById('product-id').value || generateId('prod'),
            name: document.getElementById('product-name').value.trim(),
            language: document.getElementById('product-language').value || 'Ingles',
            price: parseFloat(document.getElementById('product-price').value) || 0,
            priceCurrency: document.getElementById('product-price-currency').value,
            cost: parseFloat(document.getElementById('product-cost').value) || 0,
            costCurrency: document.getElementById('product-cost-currency').value,
            tax: parseFloat(document.getElementById('product-tax').value) || 0,
            variableCosts: parseFloat(document.getElementById('product-variable-costs').value) || 0,
            cpa: parseFloat(document.getElementById('product-cpa').value) || 0,
            cpaCurrency: document.getElementById('product-cpa-currency').value,
            countryPrices: this._getCountryPrices(),
            status: 'ativo',
            storeId: getWritableStoreId()
        };
    },

    async handleSubmit(e) {
        e.preventDefault();
        const data = this._getFormData();
        const existingIdx = AppState.allProducts.findIndex(p => p.id === data.id);

        if (!data.storeId && existingIdx < 0) {
            showToast('Selecione uma loja específica para criar produto.', 'error');
            return;
        }

        if (existingIdx >= 0) {
            data.storeId = AppState.allProducts[existingIdx].storeId || data.storeId || getWritableStoreId();
            AppState.allProducts[existingIdx] = data;
            if (AppState.sheetsConnected) {
                await SheetsAPI.updateRowById(SheetsAPI.TABS.PRODUCTS, data.id, SheetsAPI.productToRow(data));
            }
            showToast('Produto atualizado!', 'success');
        } else {
            AppState.allProducts.push(data);
            if (AppState.sheetsConnected) {
                await SheetsAPI.appendRow(SheetsAPI.TABS.PRODUCTS, SheetsAPI.productToRow(data));
            }
            showToast('Produto adicionado!', 'success');
        }

        filterDataByStore();
        closeModal('product-modal');
        populateProductDropdowns();
        this.render();
        EventBus.emit('productsChanged');
    },

    async deleteProduct(id) {
        if (!confirm('Tem certeza que deseja excluir este produto?')) return;

        const idx = AppState.allProducts.findIndex(p => p.id === id);
        if (idx >= 0) {
            AppState.allProducts.splice(idx, 1);
            if (AppState.sheetsConnected) {
                await SheetsAPI.deleteRowById(SheetsAPI.TABS.PRODUCTS, id);
            }
            filterDataByStore();
            populateProductDropdowns();
            this.render();
            EventBus.emit('productsChanged');
            showToast('Produto excluído', 'info');
        }
    },

    render() {
        const tbody = document.getElementById('products-tbody');
        const products = AppState.products.filter(p => p.status === 'ativo');

        if (products.length === 0) {
            tbody.innerHTML = '<tr class="empty-row"><td colspan="9">Nenhum produto cadastrado. Clique em "+ Adicionar Produto".</td></tr>';
            return;
        }

        const pipelineCards = typeof PipelineModule !== 'undefined' ? (PipelineModule.cards || []) : [];
        const pipelineCols = typeof PipelineModule !== 'undefined' ? (PipelineModule.FLOW_LABELS || {}) : {};

        tbody.innerHTML = products.map(p => {
            const profitUSD = calculateProfitPerSale(p, p.cpaCurrency, p.cpa);
            const profitClass = profitUSD >= 0 ? 'color: var(--green)' : 'color: var(--red)';

            // Pipeline stage badge
            const pipeCard = pipelineCards.find(c => c.productId === p.id);
            const stageBadge = pipeCard
                ? `<span class="pipeline-stage-badge stage-${pipeCard.columnId}">${pipelineCols[pipeCard.columnId] || pipeCard.columnId}</span>`
                : '<span class="pipeline-stage-badge stage-none">—</span>';

            // Country prices badges
            const countryBadges = (p.countryPrices && p.countryPrices.length > 0)
                ? `<div class="country-prices-badges">${p.countryPrices.map(cp =>
                    `<span class="country-price-badge" title="${cp.country}: ${cp.currency} ${cp.price}">${cp.country} <strong>${cp.currency} ${cp.price}</strong></span>`
                  ).join('')}</div>`
                : '';

            return `<tr>
                <td><strong>${this._escapeHtml(p.name)}</strong><br>${stageBadge}${countryBadges}</td>
                <td>${this._escapeHtml(p.language || p.country || 'Ingles')}</td>
                <td>${formatDualCurrencyHTML(p.price, p.priceCurrency)}</td>
                <td>${formatDualCurrencyHTML(p.cost, p.costCurrency)}</td>
                <td>${p.tax}%</td>
                <td>${p.variableCosts}%</td>
                <td>${formatDualCurrencyHTML(p.cpa, p.cpaCurrency)}</td>
                <td style="${profitClass}; font-weight:700">
                    ${formatDualCurrencyHTML(profitUSD, 'USD')}
                </td>
                <td>
                    <button class="btn btn-secondary btn-sm" onclick="ProductsModule.openForm(AppState.products.find(p=>p.id==='${p.id}'))">Editar</button>
                    <button class="btn btn-danger btn-sm" onclick="ProductsModule.deleteProduct('${p.id}')">Excluir</button>
                </td>
            </tr>`;
        }).join('');
    },

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};

document.addEventListener('DOMContentLoaded', () => ProductsModule.init());
