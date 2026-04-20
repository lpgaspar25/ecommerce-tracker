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

        // Shopify import
        const importBtn = document.getElementById('btn-import-shopify');
        if (importBtn) importBtn.addEventListener('click', () => this.openShopifyImport());
        const confirmBtn = document.getElementById('btn-shopify-import-confirm');
        if (confirmBtn) confirmBtn.addEventListener('click', () => this._importSelectedShopifyProducts());
        const selectAll = document.getElementById('shopify-import-select-all');
        if (selectAll) selectAll.addEventListener('change', (e) => {
            document.querySelectorAll('#shopify-import-list .shopify-import-cb:not(:disabled)').forEach(cb => { cb.checked = e.target.checked; });
            this._updateShopifyImportUI();
        });
        const searchInput = document.getElementById('shopify-import-search');
        if (searchInput) searchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase();
            document.querySelectorAll('#shopify-import-list .shopify-import-item').forEach(el => {
                const match = (el.dataset.name || '').toLowerCase().includes(q);
                el.style.display = match ? '' : 'none';
            });
        });

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

    // Normalize country-price shape to tiered format.
    // Back-compat: old shape { country, currency, price } becomes { country, currency, tiers: [{qty:1, price}] }
    _normalizeCountryPrice(cp) {
        if (!cp) return null;
        if (Array.isArray(cp.tiers) && cp.tiers.length > 0) {
            return { country: cp.country, currency: cp.currency, tiers: cp.tiers.map(t => ({ qty: Number(t.qty) || 1, price: Number(t.price) || 0 })) };
        }
        if (typeof cp.price === 'number' || typeof cp.price === 'string') {
            const p = Number(cp.price) || 0;
            return { country: cp.country, currency: cp.currency, tiers: p > 0 ? [{ qty: 1, price: p }] : [] };
        }
        return { country: cp.country, currency: cp.currency, tiers: [] };
    },

    addCountryPriceRow(data = null) {
        const list = document.getElementById('country-prices-list');
        const idx = list.children.length;
        const normalized = data ? this._normalizeCountryPrice(data) : { country: '', currency: 'USD', tiers: [{ qty: 1, price: '' }] };

        const countryOptions = this.COUNTRIES.map(c =>
            `<option value="${c.code}" ${normalized.country === c.code ? 'selected' : ''}>${c.label}</option>`
        ).join('');

        const currencyOptions = ['USD', 'GBP', 'EUR', 'BRL'].map(cur =>
            `<option value="${cur}" ${normalized.currency === cur ? 'selected' : ''}>${cur}</option>`
        ).join('');

        const row = document.createElement('div');
        row.className = 'country-price-row country-price-block';
        row.dataset.idx = idx;
        row.innerHTML = `
            <div class="country-price-header">
                <select class="input input-sm cp-country" style="flex:1;min-width:170px">
                    ${countryOptions}
                </select>
                <select class="input input-sm cp-currency" style="width:80px">
                    ${currencyOptions}
                </select>
                <button type="button" class="btn btn-secondary btn-sm cp-add-tier-btn" title="Adicionar quantidade">+ Qty</button>
                <button type="button" class="btn btn-danger btn-sm cp-remove-btn" title="Remover país">&times;</button>
            </div>
            <div class="cp-tiers-list"></div>
        `;

        const tiersList = row.querySelector('.cp-tiers-list');
        (normalized.tiers.length ? normalized.tiers : [{ qty: 1, price: '' }]).forEach(t => this._appendTierRow(tiersList, t));

        // Add tier button
        row.querySelector('.cp-add-tier-btn').addEventListener('click', () => {
            const last = tiersList.querySelector('.cp-tier-row:last-child .cp-tier-qty');
            const nextQty = last ? (parseInt(last.value) || tiersList.children.length) + 1 : 1;
            this._appendTierRow(tiersList, { qty: nextQty, price: '' });
        });

        // Remove country
        row.querySelector('.cp-remove-btn').addEventListener('click', () => row.remove());

        // Auto-select currency based on country
        const countrySelect = row.querySelector('.cp-country');
        const currencySelect = row.querySelector('.cp-currency');
        countrySelect.addEventListener('change', () => {
            const found = this.COUNTRIES.find(c => c.code === countrySelect.value);
            if (found) currencySelect.value = found.currency;
        });

        list.appendChild(row);
    },

    _appendTierRow(container, tier = { qty: 1, price: '' }) {
        const row = document.createElement('div');
        row.className = 'cp-tier-row';
        row.innerHTML = `
            <input type="number" min="1" step="1" class="input input-sm cp-tier-qty" value="${tier.qty || 1}" style="width:60px" title="Quantidade">
            <span class="cp-tier-label">pcs</span>
            <input type="number" min="0" step="0.01" class="input input-sm cp-tier-price" value="${tier.price || ''}" placeholder="0.00" style="flex:1" title="Preço por unidade">
            <button type="button" class="btn btn-danger btn-sm cp-tier-remove" title="Remover quantidade">&times;</button>
        `;
        row.querySelector('.cp-tier-remove').addEventListener('click', () => row.remove());
        container.appendChild(row);
    },

    _getCountryPrices() {
        const rows = document.querySelectorAll('#country-prices-list .country-price-row');
        const result = [];
        rows.forEach(row => {
            const country = row.querySelector('.cp-country').value;
            const currency = row.querySelector('.cp-currency').value;
            if (!country) return;
            const tiers = [];
            row.querySelectorAll('.cp-tier-row').forEach(tr => {
                const qty = parseInt(tr.querySelector('.cp-tier-qty').value) || 0;
                const price = parseFloat(tr.querySelector('.cp-tier-price').value) || 0;
                if (qty > 0 && price > 0) tiers.push({ qty, price });
            });
            if (tiers.length > 0) {
                // Primary price = lowest-qty tier (usually qty=1) for legacy consumers
                tiers.sort((a, b) => a.qty - b.qty);
                result.push({ country, currency, tiers, price: tiers[0].price });
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

        const shopifyShop = (typeof ShopifyModule !== 'undefined' && ShopifyModule.getConfig) ? (ShopifyModule.getConfig().shop || '') : '';

        tbody.innerHTML = products.map(p => {
            const profitUSD = calculateProfitPerSale(p, p.cpaCurrency, p.cpa);
            const profitClass = profitUSD >= 0 ? 'color: var(--green)' : 'color: var(--red)';

            // Pipeline stage badge
            const pipeCard = pipelineCards.find(c => c.productId === p.id);
            const stageBadge = pipeCard
                ? `<span class="pipeline-stage-badge stage-${pipeCard.columnId}">${pipelineCols[pipeCard.columnId] || pipeCard.columnId}</span>`
                : '<span class="pipeline-stage-badge stage-none">—</span>';

            // Country prices badges — show all tiers per country
            const countryBadges = (p.countryPrices && p.countryPrices.length > 0)
                ? `<div class="country-prices-badges">${p.countryPrices.map(rawCp => {
                    const cp = this._normalizeCountryPrice(rawCp);
                    if (!cp || !cp.tiers.length) return '';
                    const tiersStr = cp.tiers.map(t => `${t.qty}pc${t.qty > 1 ? 's' : ''} ${cp.currency} ${Number(t.price).toFixed(2)}`).join(' / ');
                    const tierBadges = cp.tiers.map(t => `<span class="cp-tier-pill">${t.qty}pc ${Number(t.price).toFixed(2)}</span>`).join('');
                    return `<span class="country-price-badge" title="${cp.country}: ${tiersStr}"><strong>${cp.country}</strong> ${cp.currency} ${tierBadges}</span>`;
                  }).join('')}</div>`
                : '';

            // Shopify links (only if product is linked to Shopify)
            let shopifyLinks = '';
            if (shopifyShop && p.shopifyId) {
                const adminUrl = `https://${shopifyShop}/admin/products/${p.shopifyId}`;
                shopifyLinks += `<a href="${adminUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-icon btn-sm" title="Editar na Shopify"><i data-lucide="wrench" style="width:14px;height:14px"></i></a>`;
                if (p.shopifyHandle) {
                    const publicUrl = `https://${shopifyShop.replace(/\.myshopify\.com$/, '.myshopify.com')}/products/${p.shopifyHandle}`;
                    shopifyLinks += `<a href="${publicUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-icon btn-sm" title="Ver página pública"><i data-lucide="globe" style="width:14px;height:14px"></i></a>`;
                }
            }

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
                <td class="products-actions-cell">
                    ${shopifyLinks}
                    <button class="btn btn-secondary btn-sm" onclick="ProductsModule.openForm(AppState.products.find(p=>p.id==='${p.id}'))">Editar</button>
                    <button class="btn btn-danger btn-sm" onclick="ProductsModule.deleteProduct('${p.id}')">Excluir</button>
                </td>
            </tr>`;
        }).join('');

        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    // ── Shopify Import ────────────────────────────────────────────
    async openShopifyImport() {
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured || !ShopifyModule.isConfigured()) {
            if (typeof showToast === 'function') showToast('Conecte a Shopify primeiro (perfil <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> Shopify).', 'error');
            else alert('Conecte a Shopify primeiro (perfil → Shopify).');
            return;
        }

        openModal('shopify-import-modal');
        const status = document.getElementById('shopify-import-status');
        const controls = document.getElementById('shopify-import-controls');
        const list = document.getElementById('shopify-import-list');
        const confirmBtn = document.getElementById('btn-shopify-import-confirm');
        status.textContent = 'Carregando produtos da Shopify...';
        controls.style.display = 'none';
        list.innerHTML = '';
        confirmBtn.disabled = true;

        try {
            const shopifyProducts = await ShopifyModule.fetchShopifyProducts();
            if (!shopifyProducts || shopifyProducts.length === 0) {
                status.textContent = 'Nenhum produto encontrado na Shopify.';
                return;
            }

            const existingShopifyIds = new Set((AppState.allProducts || []).map(p => String(p.shopifyId || '')).filter(Boolean));

            status.style.display = 'none';
            controls.style.display = 'flex';

            list.innerHTML = shopifyProducts.map(sp => {
                const already = existingShopifyIds.has(String(sp.id));
                const imgHtml = sp.image
                    ? `<img src="${sp.image}" alt="" class="shopify-import-thumb">`
                    : `<div class="shopify-import-thumb shopify-import-thumb-empty"><i data-lucide="image" style="width:14px;height:14px"></i></div>`;
                return `
                    <label class="shopify-import-item ${already ? 'shopify-import-item-disabled' : ''}" data-name="${this._escapeHtml(sp.title || '')}">
                        <input type="checkbox" class="shopify-import-cb" value="${sp.id}" ${already ? 'disabled checked' : ''}>
                        ${imgHtml}
                        <div class="shopify-import-info">
                            <div class="shopify-import-title">${this._escapeHtml(sp.title || '(sem título)')}</div>
                            <div class="shopify-import-meta">
                                <span class="shopify-import-price">${sp.currency || ''} ${Number(sp.priceMin || 0).toFixed(2)}${sp.priceMax && sp.priceMax !== sp.priceMin ? ' — ' + Number(sp.priceMax).toFixed(2) : ''}</span>
                                ${sp.status ? `<span class="shopify-import-status-badge">${sp.status}</span>` : ''}
                                ${already ? '<span class="shopify-import-already">já importado</span>' : ''}
                            </div>
                        </div>
                    </label>
                `;
            }).join('');

            if (typeof lucide !== 'undefined') lucide.createIcons();

            list.querySelectorAll('.shopify-import-cb').forEach(cb => {
                cb.addEventListener('change', () => this._updateShopifyImportUI());
            });
            this._updateShopifyImportUI();
        } catch (err) {
            console.error('[ShopifyImport] erro:', err);
            status.textContent = 'Erro ao carregar produtos: ' + (err.message || err);
            status.style.color = 'var(--red)';
        }
    },

    _updateShopifyImportUI() {
        const checked = document.querySelectorAll('#shopify-import-list .shopify-import-cb:checked:not(:disabled)');
        const count = checked.length;
        const countEl = document.getElementById('shopify-import-selected-count');
        const confirmBtn = document.getElementById('btn-shopify-import-confirm');
        if (countEl) countEl.textContent = `${count} selecionados`;
        if (confirmBtn) confirmBtn.disabled = count === 0;
    },

    async _importSelectedShopifyProducts() {
        const checked = Array.from(document.querySelectorAll('#shopify-import-list .shopify-import-cb:checked:not(:disabled)'));
        if (checked.length === 0) return;

        const shopifyProducts = ShopifyModule.getShopifyProducts ? ShopifyModule.getShopifyProducts() : [];
        const confirmBtn = document.getElementById('btn-shopify-import-confirm');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Importando...';

        const storeId = typeof getWritableStoreId === 'function' ? getWritableStoreId() : null;
        const existingShopifyIds = new Set((AppState.allProducts || []).map(p => String(p.shopifyId || '')).filter(Boolean));

        let imported = 0, skipped = 0;
        for (const cb of checked) {
            const sid = cb.value;
            if (existingShopifyIds.has(String(sid))) { skipped++; continue; }
            const sp = shopifyProducts.find(s => String(s.id) === String(sid));
            if (!sp) continue;

            const newProduct = {
                id: generateId('prod'),
                name: sp.title || '(sem título)',
                language: 'Ingles',
                price: Number(sp.priceMin) || 0,
                priceCurrency: sp.currency || 'USD',
                cost: 0,
                costCurrency: 'USD',
                tax: 0,
                variableCosts: 0,
                cpa: 0,
                cpaCurrency: 'USD',
                countryPrices: [],
                status: 'ativo',
                storeId,
                shopifyId: sp.id,
                shopifyHandle: sp.handle || '',
                shopifyImage: sp.image || '',
                shopifyImportedAt: new Date().toISOString(),
            };
            AppState.allProducts.push(newProduct);
            if (AppState.sheetsConnected && typeof SheetsAPI !== 'undefined') {
                try { await SheetsAPI.appendRow(SheetsAPI.TABS.PRODUCTS, SheetsAPI.productToRow(newProduct)); } catch {}
            }
            imported++;
        }

        filterDataByStore();
        populateProductDropdowns();
        this.render();
        EventBus.emit('productsChanged');

        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Importar selecionados';
        closeModal('shopify-import-modal');
        if (typeof showToast === 'function') {
            showToast(`${imported} produto(s) importado(s)${skipped > 0 ? ` (${skipped} já existiam)` : ''}.`, 'success');
        }
    },

    _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
};

document.addEventListener('DOMContentLoaded', () => ProductsModule.init());
