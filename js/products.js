/* ===========================
   Products.js — Product management (CRUD + profit calculation)
   =========================== */

const ProductsModule = {
    _images: [],
    // { [codigoIdioma]: { title, descriptionHtml, handle, variants:[{name,values:[]}], traduzidoEm } }
    _translations: {},

    // código interno → nome PT-BR + nome em inglês (prompt da IA) + locale
    // Shopify (para enviar tradução). "Ingles Americano" não tem locale
    // Shopify próprio (a loja usa "en"), então fica sem envio.
    _LANG_INFO: {
        'Ingles': { nome: 'Inglês', en: 'English', locale: 'en' },
        'Ingles Americano': { nome: 'Inglês (EUA)', en: 'American English', locale: '' },
        'Portugues': { nome: 'Português', en: 'Brazilian Portuguese', locale: 'pt-BR' },
        'Espanhol': { nome: 'Espanhol', en: 'Spanish', locale: 'es' },
        'Frances': { nome: 'Francês', en: 'French', locale: 'fr' },
        'Alemao': { nome: 'Alemão', en: 'German', locale: 'de' },
        'Italiano': { nome: 'Italiano', en: 'Italian', locale: 'it' },
        'Holandes': { nome: 'Holandês', en: 'Dutch', locale: 'nl' },
        'Polones': { nome: 'Polonês', en: 'Polish', locale: 'pl' },
        'Checol': { nome: 'Tcheco', en: 'Czech', locale: 'cs' },
        'Dinamarques': { nome: 'Dinamarquês', en: 'Danish', locale: 'da' },
        'Sueco': { nome: 'Sueco', en: 'Swedish', locale: 'sv' },
        'Noruegues': { nome: 'Norueguês', en: 'Norwegian', locale: 'nb' },
    },

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
        document.getElementById('btn-import-shopify-details-bulk')?.addEventListener('click', () => this.importarDetalhesEmMassa());
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

        // Search + filter
        document.getElementById('products-search')?.addEventListener('input', () => this.render());
        document.getElementById('products-status-filter')?.addEventListener('change', () => this.render());

        // Bulk select
        this._selectedIds = new Set();
        document.getElementById('products-select-all')?.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.products-row-cb').forEach(cb => {
                cb.checked = checked;
                const id = cb.dataset.id;
                if (checked) this._selectedIds.add(id);
                else this._selectedIds.delete(id);
                cb.closest('tr')?.classList.toggle('row-selected', checked);
            });
            this._renderBulkBar();
        });
        document.getElementById('products-bulk-clear')?.addEventListener('click', () => {
            this._selectedIds.clear();
            document.querySelectorAll('.products-row-cb').forEach(cb => { cb.checked = false; cb.closest('tr')?.classList.remove('row-selected'); });
            const selectAll = document.getElementById('products-select-all');
            if (selectAll) selectAll.checked = false;
            this._renderBulkBar();
        });
        document.getElementById('products-bulk-delete')?.addEventListener('click', () => {
            this.deleteProductsBulk(Array.from(this._selectedIds));
        });

        // Rich text toolbar (execCommand — simple, no deps)
        document.querySelectorAll('#product-form .prod-rich-btn').forEach(btn => {
            btn.addEventListener('mousedown', (e) => {
                e.preventDefault(); // prevent editor blur
                document.execCommand(btn.dataset.cmd, false, null);
                document.getElementById('product-description')?.focus();
            });
        });

        // AI description button
        document.getElementById('btn-prod-ai-desc')?.addEventListener('click', () => this.generateDescription());
        document.getElementById('btn-prod-ai-desc-imgs')?.addEventListener('click', () => this.melhorarImagensDescricao());

        // IA nas imagens do produto
        document.getElementById('btn-prod-gen-gallery')?.addEventListener('click', () => this.abrirGerarGaleria());

        // Idiomas mudam quais traduções aparecem (o 1º marcado é a origem).
        document.querySelectorAll('#product-languages input[type="checkbox"]').forEach(cb =>
            cb.addEventListener('change', () => this._renderTraducoes()));
        document.getElementById('btn-prod-trad-shopify')?.addEventListener('click', () => this._enviarTraducoesShopify());
        document.getElementById('btn-prod-trad-pull')?.addEventListener('click', () => this._puxarIdiomasDaLoja());
        document.getElementById('btn-prod-gen-cover')?.addEventListener('click', () => this.abrirGerarCapa());
        document.getElementById('btn-prod-gen-scene')?.addEventListener('click', () => this.abrirGerarCenario());
        document.getElementById('btn-prod-enhance-all')?.addEventListener('click', () => this.melhorarTodasImagens());
        document.getElementById('btn-prod-send-shopify')?.addEventListener('click', () => this.abrirEnviarShopify());
        const provSel = document.getElementById('prod-img-provider');
        const modSel = document.getElementById('prod-img-modelo');
        // Em "Automático" não dá pra fixar versão — não se sabe de antemão
        // qual dos dois provedores vai atender. Some as opções e trava o
        // select nesse caso; nos demais, mostra só as versões do provedor.
        const sincronizarModeloImagem = () => {
            if (!modSel) return;
            const prov = provSel?.value;
            const auto = prov === 'auto';
            modSel.disabled = auto;
            [...modSel.querySelectorAll('optgroup')].forEach(g => { g.hidden = auto || g.dataset.provedor !== prov; });
            const opt = modSel.selectedOptions[0];
            if (auto || (opt?.parentElement?.tagName === 'OPTGROUP' && opt.parentElement.hidden)) modSel.value = '';
        };
        if (provSel) {
            provSel.value = localStorage.getItem('studio_img_provider') || 'auto';
            provSel.addEventListener('change', () => {
                localStorage.setItem('studio_img_provider', provSel.value);
                sincronizarModeloImagem();
            });
        }
        if (modSel) {
            modSel.value = localStorage.getItem('studio_img_modelo') || '';
            modSel.addEventListener('change', () => localStorage.setItem('studio_img_modelo', modSel.value));
        }
        sincronizarModeloImagem();

        // Importar preços/custos por país de outro produto
        document.getElementById('btn-import-country-costs')?.addEventListener('click', () => this.openImportCountryCosts());

        // Image upload
        const imgInput = document.getElementById('prod-image-input');
        const imgZone = document.getElementById('prod-image-zone');
        if (imgInput) {
            imgInput.addEventListener('change', (e) => this._handleImageFiles(e.target.files));
        }
        if (imgZone) {
            imgZone.addEventListener('dragover', (e) => { e.preventDefault(); imgZone.classList.add('prod-image-drop-hover'); });
            imgZone.addEventListener('dragleave', () => imgZone.classList.remove('prod-image-drop-hover'));
            imgZone.addEventListener('drop', (e) => {
                e.preventDefault();
                imgZone.classList.remove('prod-image-drop-hover');
                this._handleImageFiles(e.dataTransfer.files);
            });
        }
    },

    openForm(product = null) {
        const title = document.getElementById('product-modal-title');
        const form = document.getElementById('product-form');
        form.reset();

        // Clear country prices
        document.getElementById('country-prices-list').innerHTML = '';

        // Always populate FB accounts (depends on FacebookAds state)
        this._renderFbAccountPicker(product);
        // Inject brand SVG icons into platform chips
        this._injectBrandIconsIntoPlatformChips();

        if (product) {
            title.textContent = 'Editar Produto';
            document.getElementById('product-id').value = product.id;
            document.getElementById('product-name').value = product.name;
            // Languages: support both legacy single (language/country) and new array (languages)
            const langs = Array.isArray(product.languages)
                ? product.languages
                : [(product.language || product.country || 'Ingles')];
            document.querySelectorAll('#product-languages input[type="checkbox"]').forEach(cb => {
                cb.checked = langs.includes(cb.value);
            });
            const hiddenLang = document.getElementById('product-language');
            if (hiddenLang) hiddenLang.value = langs[0] || 'Ingles';
            // Platforms
            const platforms = Array.isArray(product.platforms) ? product.platforms : [];
            document.querySelectorAll('#product-platforms input[type="checkbox"]').forEach(cb => {
                cb.checked = platforms.includes(cb.value);
            });
            // Google Ads account IDs + labels (formatted as "Name=ID")
            const googleIds = Array.isArray(product.googleAdAccountIds) ? product.googleAdAccountIds : [];
            const googleLabels = (product.googleAdAccountLabels && typeof product.googleAdAccountLabels === 'object') ? product.googleAdAccountLabels : {};
            const gIn = document.getElementById('product-google-accounts');
            if (gIn) gIn.value = googleIds.map(id => googleLabels[id] ? `${googleLabels[id]}=${id}` : id).join(', ');
            const cuIn = document.getElementById('product-campaign-url');
            if (cuIn) cuIn.value = product.campaignGroupUrl || '';
            const pgIn = document.getElementById('product-page-url'); if (pgIn) pgIn.value = product.pageUrl || '';
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
            // New fields
            const descEl = document.getElementById('product-description');
            if (descEl) descEl.innerHTML = product.description || '';
            const statusEl = document.getElementById('product-status');
            if (statusEl) statusEl.value = product.status || 'ativo';
            const vendorEl = document.getElementById('product-vendor');
            if (vendorEl) vendorEl.value = product.vendor || '';
            const skuEl = document.getElementById('product-sku');
            if (skuEl) skuEl.value = product.sku || '';
            const tagsEl = document.getElementById('product-tags');
            if (tagsEl) tagsEl.value = (product.tags || []).join(', ');
            this._images = (product.images || []).slice();
            this._translations = JSON.parse(JSON.stringify(product.translations || {}));
            this._renderShopifyVariants(product);
        } else {
            title.textContent = 'Adicionar Produto';
            document.getElementById('product-id').value = '';
            const descEl = document.getElementById('product-description');
            if (descEl) descEl.innerHTML = '';
            const statusEl = document.getElementById('product-status');
            if (statusEl) statusEl.value = 'ativo';
            const vendorEl = document.getElementById('product-vendor');
            if (vendorEl) vendorEl.value = '';
            const skuEl = document.getElementById('product-sku');
            if (skuEl) skuEl.value = '';
            const tagsEl = document.getElementById('product-tags');
            if (tagsEl) tagsEl.value = '';
            // Reset checkboxes for new product
            document.querySelectorAll('#product-platforms input[type="checkbox"]').forEach(cb => cb.checked = false);
            document.querySelectorAll('#product-languages input[type="checkbox"]').forEach(cb => cb.checked = false);
            const hiddenLang = document.getElementById('product-language');
            if (hiddenLang) hiddenLang.value = 'Ingles';
            const gIn = document.getElementById('product-google-accounts');
            if (gIn) gIn.value = '';
            const fbManual = document.getElementById('product-fb-accounts-manual');
            if (fbManual) fbManual.value = '';
            const cuIn = document.getElementById('product-campaign-url');
            if (cuIn) cuIn.value = '';
            // FB accounts: render picker fresh with nothing checked
            this._renderFbAccountPicker(null);
            this._images = [];
            this._translations = {};
        }

        // Reset AI status
        const aiStatus = document.getElementById('prod-ai-desc-status');
        if (aiStatus) { aiStatus.style.display = 'none'; aiStatus.textContent = ''; }

        this._renderProductImages();
        this._renderTraducoes();
        this.updateProfitPreview();
        this._renderShopifySection(product);
        openModal('product-modal');
    },

    async _renderShopifySection(product) {
        const card = document.getElementById('prod-shopify-card');
        const notConnected = document.getElementById('prod-shopify-not-connected');
        const connected = document.getElementById('prod-shopify-connected');
        const sel = document.getElementById('prod-shopify-link');
        const info = document.getElementById('prod-shopify-info');
        if (!card || !sel) return;

        const isConfigured = typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured && ShopifyModule.isConfigured();

        if (!isConfigured) {
            notConnected.style.display = '';
            connected.style.display = 'none';
            return;
        }
        notConnected.style.display = 'none';
        connected.style.display = '';

        // Carrega lista de produtos da Shopify (cache OK)
        let shopifyProducts = [];
        try {
            shopifyProducts = (ShopifyModule.getShopifyProducts() || []);
            if (shopifyProducts.length === 0) {
                sel.innerHTML = '<option value="">Carregando produtos…</option>';
                shopifyProducts = await ShopifyModule.fetchShopifyProducts();
            }
        } catch (e) {
            sel.innerHTML = `<option value="">Erro: ${e.message}</option>`;
            return;
        }

        const currentLink = product?.id ? (ShopifyModule.getLink ? ShopifyModule.getLink(product.id) : null) : null;
        sel.innerHTML = '<option value="">— Não vinculado —</option>' +
            shopifyProducts
                .slice()
                .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
                .map(p => `<option value="${p.id}">${this._esc(p.title || '(sem título)')}</option>`)
                .join('');
        if (currentLink) sel.value = currentLink;

        // Mostra info do produto vinculado
        this._updateShopifyInfo(sel.value, shopifyProducts);
        sel.onchange = () => this._updateShopifyInfo(sel.value, shopifyProducts);

        // Refresh
        const refreshBtn = document.getElementById('btn-prod-shopify-refresh');
        if (refreshBtn && !refreshBtn._bound) {
            refreshBtn._bound = true;
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.disabled = true;
                try {
                    await ShopifyModule.fetchShopifyProducts();
                    await this._renderShopifySection(product);
                } finally { refreshBtn.disabled = false; }
            });
        }
        // Connect button
        const connBtn = document.getElementById('btn-prod-connect-shopify');
        if (connBtn && !connBtn._bound) {
            connBtn._bound = true;
            connBtn.addEventListener('click', () => {
                if (ShopifyModule.openConfigModal) ShopifyModule.openConfigModal();
                else if (typeof showToast === 'function') showToast('Conecte em Configurações → Shopify', 'info');
            });
        }
    },

    _updateShopifyInfo(shopifyId, shopifyProducts) {
        const info = document.getElementById('prod-shopify-info');
        if (!info) return;
        if (!shopifyId) { info.style.display = 'none'; return; }
        const sp = shopifyProducts.find(p => String(p.id) === String(shopifyId));
        if (!sp) { info.style.display = 'none'; return; }
        const variant = sp.variants?.[0];
        const price = variant?.price ? `${variant.price} ${sp.currency || 'USD'}` : '—';
        const stock = variant?.inventory_quantity != null ? variant.inventory_quantity : '?';
        const config = (typeof ShopifyModule !== 'undefined' && ShopifyModule.getConfig) ? ShopifyModule.getConfig() : {};
        const shop = config.shop || '';
        const adminUrl = shop ? `https://${shop}/admin/products/${shopifyId}` : '';
        const publicUrl = (shop && sp.handle) ? `https://${shop}/products/${sp.handle}` : '';

        info.style.display = '';
        info.innerHTML = `
            <strong style="color:#95bf47"><i data-lucide="check" style="width:13px;height:13px;vertical-align:-2px"></i> ${this._esc(sp.title)}</strong><br>
            Preço Shopify: <strong>${this._esc(price)}</strong> · Estoque: <strong>${stock}</strong><br>
            <span style="opacity:0.7">Ao salvar, o preço será sincronizado automaticamente.</span>
            <div class="prod-shopify-links">
                <button type="button" class="prod-shopify-link prod-shopify-import" id="btn-import-shopify-details"
                        title="Trazer descrição, fotos e variantes da Shopify para cá">
                    <i data-lucide="download" style="width:12px;height:12px"></i> Importar descrição, fotos e variantes
                </button>
                ${adminUrl ? `<a href="${this._esc(adminUrl)}" target="_blank" class="prod-shopify-link">
                    <i data-lucide="settings" style="width:12px;height:12px"></i> Editar na Shopify
                </a>` : ''}
                ${publicUrl ? `<a href="${this._esc(publicUrl)}" target="_blank" class="prod-shopify-link">
                    <i data-lucide="external-link" style="width:12px;height:12px"></i> Ver na loja
                </a>` : ''}
            </div>
        `;
        info.querySelector('#btn-import-shopify-details')
            ?.addEventListener('click', () => this.importarDetalhesDoProdutoAberto());
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    },

    _esc(s) {
        return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    },

    // Normalize country-price shape to tiered format.
    // Back-compat: old shape { country, currency, price } becomes { country, currency, tiers: [{qty:1, price}] }
    _normalizeCountryPrice(cp) {
        if (!cp) return null;
        // cost === null significa "sem custo próprio, use o padrão do produto".
        const cost = (cp.cost === null || cp.cost === undefined || cp.cost === '') ? null : Number(cp.cost);
        if (Array.isArray(cp.tiers) && cp.tiers.length > 0) {
            return { country: cp.country, currency: cp.currency, cost, tiers: cp.tiers.map(t => ({ qty: Number(t.qty) || 1, price: Number(t.price) || 0 })) };
        }
        if (typeof cp.price === 'number' || typeof cp.price === 'string') {
            const p = Number(cp.price) || 0;
            return { country: cp.country, currency: cp.currency, cost, tiers: p > 0 ? [{ qty: 1, price: p }] : [] };
        }
        return { country: cp.country, currency: cp.currency, cost, tiers: [] };
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
                <label class="cp-cost-wrap" title="Custo do produto neste país (produto + frete até lá). Deixe vazio para usar o custo padrão do produto.">
                    <span>Custo</span>
                    <input type="number" min="0" step="0.01" class="input input-sm cp-cost"
                           value="${normalized.cost != null && normalized.cost !== '' ? normalized.cost : ''}"
                           placeholder="padrão" style="width:84px">
                </label>
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

    // ══════════════════════════════════════════════════════════════
    //  Importar preços/custos por país de outro produto
    //  Cadastrar 18 países à mão em cada produto novo é o gargalo real;
    //  quase sempre a tabela de frete é a mesma entre produtos parecidos.
    // ══════════════════════════════════════════════════════════════
    openImportCountryCosts() {
        const atualId = document.getElementById('product-id')?.value || '';
        const candidatos = (AppState.allProducts || [])
            .filter(p => p.id !== atualId && Array.isArray(p.countryPrices) && p.countryPrices.length > 0);

        if (!candidatos.length) {
            showToast('Nenhum outro produto tem países cadastrados para copiar.', 'warning');
            return;
        }

        const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
        const opcoes = candidatos.map(p => {
            const nPaises = p.countryPrices.length;
            const nComCusto = p.countryPrices.filter(cp => cp.cost != null && cp.cost !== '').length;
            return `<option value="${esc(p.id)}">${esc(p.name)} — ${nPaises} país(es)${nComCusto ? `, ${nComCusto} com custo` : ''}</option>`;
        }).join('');

        const html = `
            <div id="modal-import-cc-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center">
                <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:1.5rem;width:min(480px,92vw);display:flex;flex-direction:column;gap:1rem">
                    <div>
                        <strong style="font-size:1rem">Importar países de outro produto</strong>
                        <p style="margin:0.25rem 0 0;font-size:0.8rem;color:var(--text-muted)">Copia a lista de países com preços, moeda e custo.</p>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.4rem">
                        <label style="font-size:0.78rem;font-weight:600;color:var(--text-secondary)">Produto de origem</label>
                        <select id="icc-source" class="input" style="width:100%">${opcoes}</select>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.45rem">
                        <label style="font-size:0.78rem;font-weight:600;color:var(--text-secondary)">O que copiar</label>
                        <label style="font-size:0.82rem;display:flex;gap:0.4rem;align-items:center"><input type="checkbox" id="icc-costs" checked> Custos por país</label>
                        <label style="font-size:0.82rem;display:flex;gap:0.4rem;align-items:center"><input type="checkbox" id="icc-prices"> Preços e faixas de quantidade</label>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:0.45rem">
                        <label style="font-size:0.78rem;font-weight:600;color:var(--text-secondary)">Se o país já existir aqui</label>
                        <label style="font-size:0.82rem;display:flex;gap:0.4rem;align-items:center"><input type="radio" name="icc-mode" value="fill" checked> Preencher só o que está vazio</label>
                        <label style="font-size:0.82rem;display:flex;gap:0.4rem;align-items:center"><input type="radio" name="icc-mode" value="overwrite"> Sobrescrever</label>
                    </div>
                    <div style="display:flex;gap:0.6rem;justify-content:flex-end">
                        <button id="icc-cancel" class="btn btn-secondary btn-sm">Cancelar</button>
                        <button id="icc-apply" class="btn btn-primary btn-sm">Importar</button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', html);

        const overlay = document.getElementById('modal-import-cc-overlay');
        const fechar = () => overlay?.remove();
        document.getElementById('icc-cancel')?.addEventListener('click', fechar);
        overlay?.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });

        document.getElementById('icc-apply')?.addEventListener('click', () => {
            const origem = (AppState.allProducts || []).find(p => p.id === document.getElementById('icc-source').value);
            if (!origem) { fechar(); return; }
            const copiarCustos = document.getElementById('icc-costs').checked;
            const copiarPrecos = document.getElementById('icc-prices').checked;
            const modo = document.querySelector('input[name="icc-mode"]:checked')?.value || 'fill';
            if (!copiarCustos && !copiarPrecos) { showToast('Escolha ao menos uma coisa para copiar.', 'error'); return; }

            const n = this._aplicarImportacaoPaises(origem, { copiarCustos, copiarPrecos, modo });
            fechar();
            showToast(`${n} país(es) importado(s) de "${origem.name}". Revise e salve o produto.`, 'success');
        });

        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    },

    _aplicarImportacaoPaises(origem, { copiarCustos, copiarPrecos, modo }) {
        // Lê o que já está na tela para não perder edições não salvas
        const atuais = this._getCountryPrices();
        const porPais = new Map(atuais.map(cp => [cp.country, cp]));
        let tocados = 0;

        (origem.countryPrices || []).forEach(raw => {
            const src = this._normalizeCountryPrice(raw);
            if (!src?.country) return;
            const existente = porPais.get(src.country);

            if (!existente) {
                porPais.set(src.country, {
                    country: src.country,
                    currency: src.currency || 'USD',
                    tiers: copiarPrecos ? (src.tiers || []) : [],
                    price: copiarPrecos ? (src.tiers?.[0]?.price || 0) : 0,
                    cost: copiarCustos ? src.cost : null,
                });
                tocados++;
                return;
            }

            let mudou = false;
            if (copiarCustos && src.cost != null) {
                // "Preencher" só age quando o campo está realmente vazio.
                if (modo === 'overwrite' || existente.cost == null) { existente.cost = src.cost; mudou = true; }
            }
            if (copiarPrecos && src.tiers?.length) {
                if (modo === 'overwrite' || !existente.tiers?.length) {
                    existente.tiers = src.tiers;
                    existente.price = src.tiers[0]?.price || 0;
                    existente.currency = src.currency || existente.currency;
                    mudou = true;
                }
            }
            if (mudou) tocados++;
        });

        // Redesenha a lista inteira com o resultado
        const lista = document.getElementById('country-prices-list');
        if (lista) {
            lista.innerHTML = '';
            [...porPais.values()]
                .sort((a, b) => String(a.country).localeCompare(String(b.country)))
                .forEach(cp => this.addCountryPriceRow(cp));
        }
        return tocados;
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
            // Custo específico deste país (produto + frete até o destino).
            // Vazio significa "usar o custo padrão do produto" — não zero.
            const costRaw = row.querySelector('.cp-cost')?.value ?? '';
            const cost = String(costRaw).trim() === '' ? null : (parseFloat(costRaw) || 0);

            if (tiers.length > 0) {
                // Primary price = lowest-qty tier (usually qty=1) for legacy consumers
                tiers.sort((a, b) => a.qty - b.qty);
                result.push({ country, currency, tiers, price: tiers[0].price, cost });
            } else if (cost != null) {
                // País cadastrado só para registrar o custo, sem tabela de preço
                result.push({ country, currency, tiers: [], price: 0, cost });
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

    _injectBrandIconsIntoPlatformChips() {
        if (typeof BRAND_ICONS === 'undefined') return;
        document.querySelectorAll('#product-platforms .prod-multi-chip[data-brand]').forEach(el => {
            if (el.dataset.iconInjected) return;
            const brand = el.dataset.brand;
            const span = el.querySelector('span');
            if (!span || !BRAND_ICONS[brand]) return;
            span.insertAdjacentHTML('afterbegin', BRAND_ICONS[brand] + ' ');
            el.dataset.iconInjected = '1';
        });
    },

    _renderFbAccountPicker(product) {
        const container = document.getElementById('product-fb-accounts');
        const emptyMsg = document.getElementById('product-fb-accounts-empty');
        const manualInput = document.getElementById('product-fb-accounts-manual');
        if (!container) return;
        const accounts = (typeof FacebookAds !== 'undefined' && FacebookAds.config?.adAccounts) || [];
        const selected = new Set(Array.isArray(product?.fbAdAccountIds) ? product.fbAdAccountIds.map(String) : []);
        const labels = (product?.fbAdAccountLabels && typeof product.fbAdAccountLabels === 'object') ? product.fbAdAccountLabels : {};
        // Picker IDs
        const knownIds = new Set(accounts.map(a => String(a.id)));
        // Manual = saved IDs that aren't in the connected accounts list
        const manualIds = Array.from(selected).filter(id => !knownIds.has(id));
        if (manualInput) {
            manualInput.value = manualIds.map(id => labels[id] ? `${labels[id]}=${id}` : id).join(', ');
        }

        if (!accounts.length) {
            container.innerHTML = '';
            if (emptyMsg) emptyMsg.style.display = '';
            return;
        }
        if (emptyMsg) emptyMsg.style.display = 'none';
        container.innerHTML = accounts.map(a => {
            const id = String(a.id);
            const isSel = selected.has(id);
            const label = a.name ? `${a.name} <small style="opacity:.65">(${id})</small>` : id;
            return `<label class="prod-multi-chip">
                <input type="checkbox" class="prod-fb-acc-cb" value="${id}" ${isSel ? 'checked' : ''}>
                <span><i data-lucide="facebook" style="width:13px;height:13px;color:#1877f2"></i> ${label}</span>
            </label>`;
        }).join('');
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    },

    // Parse "Name=ID, OtherName=ID2, RawID" → { ids: [...], labels: { id: name } }
    _parseAccountEntries(raw) {
        const ids = [];
        const labels = {};
        if (!raw) return { ids, labels };
        const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
        for (const p of parts) {
            const eqIdx = p.indexOf('=');
            if (eqIdx > 0) {
                const name = p.slice(0, eqIdx).trim();
                const id = p.slice(eqIdx + 1).trim();
                if (!id) continue;
                ids.push(id);
                if (name) labels[id] = name;
            } else {
                ids.push(p);
            }
        }
        return { ids, labels };
    },

    _getFormData() {
        // Collect multi-select platforms & languages
        const platforms = Array.from(document.querySelectorAll('#product-platforms input[type="checkbox"]:checked')).map(cb => cb.value);
        const languages = Array.from(document.querySelectorAll('#product-languages input[type="checkbox"]:checked')).map(cb => cb.value);
        // Keep legacy single-language field synced (uses first selected)
        const primaryLang = languages[0] || document.getElementById('product-language')?.value || 'Ingles';
        const hiddenLang = document.getElementById('product-language');
        if (hiddenLang) hiddenLang.value = primaryLang;

        // Ad accounts (parse "Name=ID" syntax for manual entries)
        const fbFromPicker = Array.from(document.querySelectorAll('.prod-fb-acc-cb:checked')).map(cb => cb.value);
        const fbManualRaw = (document.getElementById('product-fb-accounts-manual')?.value || '').trim();
        const fbManualParsed = this._parseAccountEntries(fbManualRaw);
        const fbAdAccountIds = Array.from(new Set([...fbFromPicker, ...fbManualParsed.ids]));

        const googleRaw = (document.getElementById('product-google-accounts')?.value || '').trim();
        const googleParsed = this._parseAccountEntries(googleRaw);
        const googleAdAccountIds = googleParsed.ids;

        return {
            id: document.getElementById('product-id').value || generateId('prod'),
            name: document.getElementById('product-name').value.trim(),
            language: primaryLang,
            languages,
            platforms,
            fbAdAccountIds,
            googleAdAccountIds,
            fbAdAccountLabels: fbManualParsed.labels,
            googleAdAccountLabels: googleParsed.labels,
            campaignGroupUrl: (document.getElementById('product-campaign-url')?.value || '').trim(),
            pageUrl: (document.getElementById('product-page-url')?.value || '').trim(),
            price: parseFloat(document.getElementById('product-price').value) || 0,
            priceCurrency: document.getElementById('product-price-currency').value,
            cost: parseFloat(document.getElementById('product-cost').value) || 0,
            costCurrency: document.getElementById('product-cost-currency').value,
            tax: parseFloat(document.getElementById('product-tax').value) || 0,
            variableCosts: parseFloat(document.getElementById('product-variable-costs').value) || 0,
            cpa: parseFloat(document.getElementById('product-cpa').value) || 0,
            cpaCurrency: document.getElementById('product-cpa-currency').value,
            countryPrices: this._getCountryPrices(),
            description: (document.getElementById('product-description')?.innerHTML || '').trim(),
            status: document.getElementById('product-status')?.value || 'ativo',
            vendor: (document.getElementById('product-vendor')?.value || '').trim(),
            sku: (document.getElementById('product-sku')?.value || '').trim(),
            tags: (document.getElementById('product-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean),
            images: this._images || [],
            translations: this._translations || {},
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
            const prev = AppState.allProducts[existingIdx];
            data.storeId = prev.storeId || data.storeId || getWritableStoreId();
            // Preserve fields not present in the form so they aren't wiped on edit
            if (prev.campaignUrlsByCountry && !data.campaignUrlsByCountry) data.campaignUrlsByCountry = prev.campaignUrlsByCountry;
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

        // Save Shopify link if present
        try {
            const shopifySel = document.getElementById('prod-shopify-link');
            if (shopifySel && typeof ShopifyModule !== 'undefined' && ShopifyModule.linkProduct) {
                const shopifyId = shopifySel.value || null;
                const result = ShopifyModule.linkProduct(data.id, shopifyId);
                if (result?.linked && result?.priceSynced) {
                    showToast('Vinculado e preço sincronizado com Shopify', 'success');
                } else if (result?.linked) {
                    showToast('Produto vinculado à Shopify', 'success');
                }
            }
        } catch (e) { console.warn('Shopify link save failed:', e); }

        filterDataByStore();
        closeModal('product-modal');
        populateProductDropdowns();
        this.render();
        EventBus.emit('productsChanged');
    },

    // ── Tombstones (impede reimportação de produtos deletados) ──
    _TOMBSTONE_KEY: 'etracker_deleted_product_ids',
    _getTombstones() {
        try { return new Set(JSON.parse(localStorage.getItem(this._TOMBSTONE_KEY) || '[]')); }
        catch { return new Set(); }
    },
    _addTombstones(entries) {
        const set = this._getTombstones();
        entries.forEach(e => {
            if (e.localId) set.add(`local:${e.localId}`);
            if (e.shopifyId) set.add(`shopify:${e.shopifyId}`);
        });
        localStorage.setItem(this._TOMBSTONE_KEY, JSON.stringify(Array.from(set)));
    },
    isTombstoned(product) {
        if (!product) return false;
        const set = this._getTombstones();
        return set.has(`local:${product.id}`) ||
               (product.shopifyId && set.has(`shopify:${product.shopifyId}`));
    },
    // Limpa todas as tombstones (caso usuário queira recuperar)
    clearTombstones() {
        localStorage.removeItem(this._TOMBSTONE_KEY);
        if (typeof showToast === 'function') showToast('Tombstones limpas — produtos deletados podem voltar', 'info');
    },

    async deleteProduct(id) {
        if (!confirm('Tem certeza que deseja excluir este produto?')) return;

        const product = AppState.allProducts.find(p => p.id === id);
        const idx = AppState.allProducts.findIndex(p => p.id === id);
        if (idx >= 0) {
            AppState.allProducts.splice(idx, 1);
            // Tombstone para impedir reimportação
            this._addTombstones([{ localId: id, shopifyId: product?.shopifyId }]);
            if (AppState.sheetsConnected) {
                await SheetsAPI.deleteRowById(SheetsAPI.TABS.PRODUCTS, id);
            }
            if (typeof SupabaseSync !== 'undefined') {
                SupabaseSync.deleteProductById(id);
            }
            filterDataByStore();
            populateProductDropdowns();
            this.render();
            EventBus.emit('productsChanged');
            showToast('Produto excluído', 'info');
        }
    },

    async deleteProductsBulk(ids) {
        if (!ids || ids.length === 0) return;
        if (!confirm(`Excluir ${ids.length} produto(s)? Esta ação não pode ser desfeita.`)) return;
        const tombstones = [];
        for (const id of ids) {
            const product = AppState.allProducts.find(p => p.id === id);
            const idx = AppState.allProducts.findIndex(p => p.id === id);
            if (idx >= 0) {
                AppState.allProducts.splice(idx, 1);
                tombstones.push({ localId: id, shopifyId: product?.shopifyId });
                if (AppState.sheetsConnected) {
                    try { await SheetsAPI.deleteRowById(SheetsAPI.TABS.PRODUCTS, id); } catch {}
                }
                if (typeof SupabaseSync !== 'undefined') {
                    try { SupabaseSync.deleteProductById(id); } catch {}
                }
            }
        }
        this._addTombstones(tombstones);
        this._selectedIds = new Set();
        filterDataByStore();
        populateProductDropdowns();
        this.render();
        EventBus.emit('productsChanged');
        showToast(`${ids.length} produto(s) excluído(s)`, 'success');
    },

    async generateDescription() {
        const nameEl = document.getElementById('product-name');
        const name = nameEl?.value.trim();
        if (!name) {
            if (typeof showToast === 'function') showToast('Preencha o título do produto primeiro', 'error');
            return;
        }
        const language = document.getElementById('product-language')?.value || 'Ingles';
        const langMap = {
            'Ingles': 'English', 'Ingles Americano': 'American English',
            'Frances': 'French', 'Espanhol': 'Spanish', 'Holandes': 'Dutch',
            'Alemao': 'German', 'Polones': 'Polish', 'Checol': 'Czech',
            'Dinamarques': 'Danish', 'Sueco': 'Swedish', 'Noruegues': 'Norwegian'
        };
        const lang = langMap[language] || 'English';
        const openAIKey = localStorage.getItem('openai_api_key') || '';
        const googleKey = localStorage.getItem('google_ai_api_key') || '';

        const statusEl = document.getElementById('prod-ai-desc-status');
        const btn = document.getElementById('btn-prod-ai-desc');
        if (statusEl) { statusEl.style.display = ''; statusEl.style.color = ''; statusEl.textContent = 'Gerando descrição…'; }
        if (btn) btn.disabled = true;

        try {
            const sysPrompt = `You are a professional e-commerce copywriter. Write a compelling product description in ${lang}. 2–3 paragraphs, highlight key benefits, persuasive tone. Format as simple HTML using only <p> and <strong> tags. Do NOT include a title or heading — only the body text.`;
            let html = '';

            if (openAIKey) {
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAIKey}` },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: `Product name: ${name}` }],
                        temperature: 0.8
                    })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error.message);
                html = data.choices?.[0]?.message?.content || '';
            } else if (googleKey) {
                const res = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${googleKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            system_instruction: { parts: [{ text: sysPrompt }] },
                            contents: [{ parts: [{ text: `Product name: ${name}` }] }],
                            generationConfig: { temperature: 0.8 }
                        })
                    }
                );
                const data = await res.json();
                if (data.error) throw new Error(data.error.message || 'Google AI error');
                html = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            } else {
                throw new Error('Configure uma chave OpenAI ou Google AI (AI Ad Generator → Configurar IA)');
            }

            if (!html) throw new Error('Resposta vazia da IA');
            const descEl = document.getElementById('product-description');
            if (descEl) descEl.innerHTML = html;
            if (statusEl) { statusEl.textContent = 'Descrição gerada'; statusEl.style.color = 'var(--green, #059669)'; }
            setTimeout(() => { if (statusEl) statusEl.style.display = 'none'; }, 3000);
        } catch (err) {
            console.error('[generateDescription]', err);
            if (statusEl) { statusEl.textContent = '' + err.message; statusEl.style.color = '#dc2626'; }
            if (typeof showToast === 'function') showToast('Erro ao gerar: ' + err.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async _handleImageFiles(files) {
        for (const file of Array.from(files)) {
            if (!file.type.startsWith('image/')) continue;
            if (this._images.length >= 5) break;
            const dataUrl = await this._compressImageToWebP(file, 800, 0.75);
            this._images.push({ dataUrl, name: file.name });
        }
        this._renderProductImages();
        // reset input so same file can be re-selected
        const inp = document.getElementById('prod-image-input');
        if (inp) inp.value = '';
    },

    async _compressImageToWebP(file, maxW = 800, quality = 0.75) {
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    try {
                        const scale = Math.min(1, maxW / img.naturalWidth);
                        const w = Math.round(img.naturalWidth * scale);
                        const h = Math.round(img.naturalHeight * scale);
                        const canvas = document.createElement('canvas');
                        canvas.width = w; canvas.height = h;
                        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
                        canvas.toBlob(blob => {
                            if (!blob) { resolve(ev.target.result); return; }
                            const fr = new FileReader();
                            fr.onloadend = () => resolve(fr.result || ev.target.result);
                            fr.readAsDataURL(blob);
                        }, 'image/webp', quality);
                    } catch { resolve(ev.target.result); }
                };
                img.onerror = () => resolve(ev.target.result);
                img.src = ev.target.result;
            };
            reader.onerror = () => resolve('');
            reader.readAsDataURL(file);
        });
    },

    _renderProductImages() {
        const zone = document.getElementById('prod-image-zone');
        const thumbs = document.getElementById('prod-image-thumbs');
        if (!thumbs) return;
        if (!this._images.length) {
            if (zone) zone.style.display = '';
            thumbs.style.display = 'none';
            thumbs.innerHTML = '';
            return;
        }
        thumbs.style.display = '';
        // Imagem pode vir de upload (dataUrl base64) ou da Shopify (url do CDN).
        // Guardar a URL em vez de baixar em base64 mantém o localStorage leve.
        thumbs.innerHTML = this._images.map((img, i) => `
            <div class="prod-image-thumb" draggable="true" data-pos="${i}" title="Arraste pra reordenar">
                <img src="${img.dataUrl || img.url || ''}" alt="${img.name || img.alt || ''}" loading="lazy" data-ampliar="${i}" style="cursor:zoom-in">
                <button type="button" class="prod-image-remove" data-idx="${i}" title="Remover">×</button>
                <button type="button" class="prod-image-enhance" data-enhance="${i}" title="Melhorar a qualidade desta imagem"><i data-lucide="wand-2" style="width:12px;height:12px"></i></button>
                ${i === 0 ? '<span class="prod-image-cover">Capa</span>' : ''}
                ${img.melhorada ? '<span class="prod-image-ai" title="Versão melhorada por IA">IA</span>' : ''}
                ${img.url && !img.dataUrl ? '<span class="prod-image-src" title="Imagem hospedada na Shopify">Shopify</span>' : ''}
                ${img.enviadaShopify ? '<span class="prod-image-src" title="Já enviada para a Shopify"><i data-lucide="check" style="width:10px;height:10px;vertical-align:-1px"></i> Enviada</span>' : ''}
            </div>
        `).join('');
        thumbs.querySelectorAll('.prod-image-remove').forEach(btn => {
            btn.addEventListener('click', () => {
                this._images.splice(parseInt(btn.dataset.idx), 1);
                this._renderProductImages();
            });
        });
        thumbs.querySelectorAll('[data-enhance]').forEach(btn => {
            btn.addEventListener('click', () => this.melhorarImagem(parseInt(btn.dataset.enhance, 10)));
        });
        // Clicar na miniatura amplia — sem isso não dá pra conferir de verdade
        // se a versão melhorada ficou boa (a miniatura tem ~90px).
        thumbs.querySelectorAll('[data-ampliar]').forEach(el => {
            el.addEventListener('click', () => {
                const im = this._images[parseInt(el.dataset.ampliar, 10)];
                if (!im) return;
                const rotulo = [im.name || im.alt || `Imagem ${Number(el.dataset.ampliar) + 1}`,
                                im.melhorada ? '(melhorada por IA)' : ''].filter(Boolean).join(' ');
                abrirImagemAmpliada(im.dataUrl || im.url, rotulo);
            });
        });
        // Reordenar por arrastar — a 1ª posição sempre vira a capa (mesmo
        // comportamento da galeria da Shopify), sem precisar de botão extra.
        let _arrastandoDe = null;
        thumbs.querySelectorAll('.prod-image-thumb').forEach(el => {
            el.addEventListener('dragstart', (e) => {
                _arrastandoDe = parseInt(el.dataset.pos, 10);
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', String(_arrastandoDe)); } catch {}
                el.classList.add('is-arrastando');
            });
            el.addEventListener('dragend', () => {
                el.classList.remove('is-arrastando');
                thumbs.querySelectorAll('.is-alvo-drop').forEach(t => t.classList.remove('is-alvo-drop'));
                _arrastandoDe = null;
            });
            el.addEventListener('dragover', (e) => {
                if (_arrastandoDe === null) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                el.classList.add('is-alvo-drop');
            });
            el.addEventListener('dragleave', () => el.classList.remove('is-alvo-drop'));
            el.addEventListener('drop', (e) => {
                e.preventDefault();
                el.classList.remove('is-alvo-drop');
                const destino = parseInt(el.dataset.pos, 10);
                if (_arrastandoDe === null || _arrastandoDe === destino) return;
                const [item] = this._images.splice(_arrastandoDe, 1);
                this._images.splice(destino, 0, item);
                this._renderProductImages();
            });
        });
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
        // O teto de 5 vale só para upload (base64, que pesa no armazenamento).
        // Imagens da Shopify são URLs e não contam para esse limite.
        const enviadas = this._images.filter(im => im.dataUrl).length;
        if (zone) zone.style.display = enviadas >= 5 ? 'none' : '';
    },

    // ══════════════════════════════════════════════════════════════
    //  IA nas imagens do produto
    //  Melhorar qualidade, gerar capa a partir de um padrão de criativo
    //  e gerar o produto em uso / sobre uma superfície.
    //
    //  Nota honesta sobre "melhorar qualidade": nenhum dos provedores faz
    //  upscale determinístico com chave de API (o do Google existe só no
    //  Vertex AI, que exige service account). O que acontece aqui é
    //  RE-SÍNTESE guiada — o modelo redesenha a foto tentando preservar
    //  tudo. Por isso a original é sempre guardada em `_original`, e dá
    //  para desfazer imagem por imagem.
    // ══════════════════════════════════════════════════════════════

    // Imagens do produto vivem no localStorage como base64, então não dá pra
    // guardar 4K: 1200px em WebP 0.82 é bem melhor que os 800px/0.75 do
    // upload comum sem estourar a cota.
    _IMG_MAX: 1200,
    _IMG_QUALIDADE: 0.82,

    _provedorImagem() {
        return document.getElementById('prod-img-provider')?.value || 'auto';
    },

    // Versão específica do modelo, se fixada na tela. Vazio = cascata padrão.
    _modeloImagem() {
        return document.getElementById('prod-img-modelo')?.value || '';
    },

    _statusImagem(texto, cor) {
        const el = document.getElementById('prod-img-ai-status');
        if (!el) return;
        if (!texto) { el.style.display = 'none'; el.textContent = ''; return; }
        el.style.display = '';
        el.textContent = texto;
        el.style.color = cor || 'var(--text-muted)';
    },

    // Contexto textual do produto pro prompt — usa o que está no formulário
    // agora (pode ter edição não salva), não o que está no AppState.
    _contextoDoFormulario() {
        const nome = (document.getElementById('product-name')?.value || '').trim();
        const vendor = (document.getElementById('product-vendor')?.value || '').trim();
        const desc = (document.getElementById('product-description')?.innerText || '')
            .replace(/\s+/g, ' ').trim().slice(0, 220);
        return [nome, vendor && `by ${vendor}`, desc].filter(Boolean).join(' — ');
    },

    // Melhora um blob e devolve dataUrl WebP na dimensão pedida.
    async _melhorarBlob(blob, { largura, altura } = {}) {
        const dim = (largura && altura)
            ? { largura, altura }
            : await dimensoesDaImagem(blob);

        const gerado = await ImageAI.editar(blob, ImageAI.promptMelhoria(this._contextoDoFormulario()), {
            provedor: this._provedorImagem(),
            modelo: this._modeloImagem() || undefined,
            largura: dim.largura,
            altura: dim.altura,
            // Pede a render MAIOR que o destino de propósito: reduzir depois
            // no canvas ("supersampling") sai mais nítido do que gerar já no
            // tamanho final. O Gemini ignora e segue a proporção da referência.
            alvoPixels: Math.min(8294400, Math.max(1500000, dim.largura * dim.altura * 4)),
            formato: 'image/webp',
            compressao: 90,
        });

        // Normaliza no canvas: garante as dimensões exatas e converte o JPEG
        // do Gemini (que não tem WebP na saída) para WebP.
        return await comprimirImagemParaDataUrl(gerado, this._IMG_MAX, this._IMG_QUALIDADE, {
            formato: 'image/webp',
            largura: dim.largura,
            altura: dim.altura,
        });
    },

    async melhorarImagem(idx) {
        const img = this._images[idx];
        if (!img) return;
        const origem = img.dataUrl || img.url;
        if (!origem) { showToast('Imagem sem origem', 'error'); return; }

        this._statusImagem('Melhorando a imagem…');
        try {
            const blob = await bytesDaImagem(origem);
            const dim = await dimensoesDaImagem(blob);
            const dataUrl = await this._melhorarBlob(blob, dim);

            // Substitui NA MESMA POSIÇÃO, guardando a original pra desfazer.
            this._images[idx] = {
                ...img,
                dataUrl,
                url: '',                       // agora é local, não mais o CDN
                melhorada: true,
                _original: img._original || { dataUrl: img.dataUrl || '', url: img.url || '' },
                name: (img.name || 'imagem').replace(/\.[^.]+$/, '') + '.webp',
            };
            this._renderProductImages();
            this._statusImagem('');
            showToast(`Imagem ${idx + 1} melhorada (${dim.largura}×${dim.altura}, WebP)`, 'success');
        } catch (e) {
            this._statusImagem('');
            showToast('Falha ao melhorar: ' + String(e.message).slice(0, 140), 'error');
        }
    },

    async melhorarTodasImagens() {
        const alvos = this._images
            .map((im, i) => ({ im, i }))
            .filter(({ im }) => (im.dataUrl || im.url) && !im.melhorada);
        if (!alvos.length) { showToast('Nada para melhorar — todas já foram processadas.', 'info'); return; }
        if (!confirm(`Melhorar ${alvos.length} imagem(ns)? Cada uma é uma chamada paga à IA.`)) return;

        let ok = 0, falhas = 0;
        for (let n = 0; n < alvos.length; n++) {
            const { im, i } = alvos[n];
            this._statusImagem(`Melhorando ${n + 1} de ${alvos.length}…`);
            try {
                const blob = await bytesDaImagem(im.dataUrl || im.url);
                const dim = await dimensoesDaImagem(blob);
                const dataUrl = await this._melhorarBlob(blob, dim);
                this._images[i] = {
                    ...im, dataUrl, url: '', melhorada: true,
                    _original: im._original || { dataUrl: im.dataUrl || '', url: im.url || '' },
                    name: (im.name || 'imagem').replace(/\.[^.]+$/, '') + '.webp',
                };
                ok++;
                this._renderProductImages();
            } catch (e) {
                console.warn('[Produtos] falha ao melhorar imagem', i, e.message);
                falhas++;
            }
        }
        this._statusImagem('');
        showToast(falhas
            ? `${ok} melhorada(s), ${falhas} falharam.`
            : `${ok} imagem(ns) melhorada(s) em WebP.`, falhas ? 'warning' : 'success');
    },

    // ── Imagens dentro do HTML da descrição ──
    // Mantém as MESMAS dimensões: a descrição é HTML que vai pra loja e
    // trocar o tamanho de uma imagem quebraria o layout da página.
    async melhorarImagensDescricao() {
        const editor = document.getElementById('product-description');
        if (!editor) return;
        const imgs = [...editor.querySelectorAll('img')];
        if (!imgs.length) { showToast('A descrição não tem imagens.', 'info'); return; }
        if (!confirm(`Melhorar ${imgs.length} imagem(ns) da descrição? Cada uma é uma chamada paga à IA.`)) return;

        let ok = 0, falhas = 0;
        for (let i = 0; i < imgs.length; i++) {
            const el = imgs[i];
            const origem = el.getAttribute('src');
            if (!origem) { falhas++; continue; }
            this._statusImagem(`Melhorando imagem ${i + 1} de ${imgs.length} da descrição…`);
            try {
                const blob = await bytesDaImagem(origem);
                // Dimensão de destino: o que o HTML declara (width/height ou
                // style) manda; sem isso, o tamanho natural do arquivo.
                const natural = await dimensoesDaImagem(blob);
                const largura = parseInt(el.getAttribute('width'), 10) || natural.largura;
                const altura = parseInt(el.getAttribute('height'), 10) || natural.altura;

                const dataUrl = await this._melhorarBlob(blob, { largura, altura });
                el.setAttribute('src', dataUrl);
                el.dataset.melhorada = '1';
                ok++;
            } catch (e) {
                console.warn('[Produtos] falha na imagem da descrição', i, e.message);
                falhas++;
            }
        }
        this._statusImagem('');
        showToast(falhas
            ? `${ok} imagem(ns) da descrição melhorada(s), ${falhas} falharam.`
            : `${ok} imagem(ns) da descrição melhorada(s).`, falhas ? 'warning' : 'success');
    },

    // ══════════════════════════════════════════════════════════════
    //  TRADUÇÕES
    //  Traduz título, descrição, URL (handle) e variantes para os idiomas
    //  marcados em "Idiomas / Mercados" (o 1º é a origem). Ficam guardadas
    //  no produto (translations[idioma]) e editáveis aqui. As imagens da
    //  descrição podem ser traduzidas mantendo a dimensão original.
    // ══════════════════════════════════════════════════════════════

    _abrirTrad: null,

    _idiomasSelecionados() {
        return [...document.querySelectorAll('#product-languages input[type="checkbox"]:checked')].map(cb => cb.value);
    },

    // locale Shopify → código interno. Casa exato (pt-BR→Portugues) e, se
    // falhar, pela base do idioma (fr-CA → fr → Frances).
    _localeParaCodigo(locale) {
        const l = String(locale || '').toLowerCase();
        const base = l.split('-')[0];
        let achado = Object.entries(this._LANG_INFO).find(([, v]) => v.locale && v.locale.toLowerCase() === l);
        if (!achado) achado = Object.entries(this._LANG_INFO).find(([, v]) => v.locale && v.locale.toLowerCase() === base);
        return achado ? achado[0] : null;
    },

    // Marca as checkboxes de idioma a partir dos locales já configurados na
    // loja Shopify — evita ter que marcar 8 idiomas na mão por produto.
    async _puxarIdiomasDaLoja() {
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
            showToast('Conecte a Shopify primeiro para puxar os idiomas.', 'error'); return;
        }
        this._statusTrad('Buscando idiomas da loja…');
        try {
            const locales = await ShopifyModule.localesDaLoja();
            this._statusTrad('');
            if (!locales.length) { showToast('A loja não retornou idiomas.', 'info'); return; }
            const cbs = [...document.querySelectorAll('#product-languages input[type="checkbox"]')];
            const adicionados = [], semMapa = [];
            locales.forEach(l => {
                const code = this._localeParaCodigo(l.locale);
                if (!code) { semMapa.push(l.locale); return; }
                const cb = cbs.find(x => x.value === code);
                if (cb && !cb.checked) { cb.checked = true; adicionados.push(this._LANG_INFO[code]?.nome || code); }
            });
            this._renderTraducoes();
            if (adicionados.length) showToast(`Idiomas marcados: ${adicionados.join(', ')}`, 'success');
            else showToast('Todos os idiomas da loja já estavam marcados.', 'info');
            if (semMapa.length) console.warn('[Produtos] locales sem mapa interno:', semMapa);
        } catch (e) {
            this._statusTrad('');
            showToast('Falha ao buscar idiomas: ' + String(e.message).slice(0, 140), 'error');
        }
    },

    _statusTrad(txt, cor) {
        const el = document.getElementById('prod-trad-status');
        if (!el) return;
        if (!txt) { el.style.display = 'none'; el.textContent = ''; return; }
        el.style.display = ''; el.textContent = txt; el.style.color = cor || 'var(--text-muted)';
    },

    // Chamada de texto pra IA — OpenAI primeiro, Google como reserva. Usada
    // só pra traduzir (a imagem tem seu próprio caminho no ImageAI).
    async _traduzirComIA(system, user, { json = false } = {}) {
        const openAIKey = localStorage.getItem('openai_api_key') || '';
        const googleKey = localStorage.getItem('google_ai_api_key') || '';
        if (openAIKey) {
            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openAIKey}` },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
                    ...(json ? { response_format: { type: 'json_object' } } : {}),
                    temperature: 0.3,
                }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message);
            return data.choices?.[0]?.message?.content || '';
        }
        if (googleKey) {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleKey}`,
                {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        system_instruction: { parts: [{ text: system + (json ? ' Output raw JSON only, no markdown fences.' : '') }] },
                        contents: [{ parts: [{ text: user }] }],
                        generationConfig: { temperature: 0.3, ...(json ? { responseMimeType: 'application/json' } : {}) },
                    }),
                }
            );
            const data = await res.json();
            if (data.error) throw new Error(data.error.message || 'Google AI erro');
            return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        }
        throw new Error('Configure a chave OpenAI ou Google AI em Chaves de API');
    },

    // Conteúdo de origem lido do FORMULÁRIO (pode ter edição não salva).
    _conteudoOrigem() {
        const pid = document.getElementById('product-id')?.value;
        const prod = pid ? (AppState.allProducts || []).find(p => p.id === pid) : null;
        const nome = (document.getElementById('product-name')?.value || '').trim();
        return {
            title: nome,
            descriptionHtml: (document.getElementById('product-description')?.innerHTML || '').trim(),
            handle: prod?.shopifyHandle || _handleSimples(nome),
            variants: (prod?.shopifyOptions || []).map(o => ({ name: o.name, values: o.values || [] })),
        };
    },

    async _traduzirIdioma(langCode) {
        const info = this._LANG_INFO[langCode];
        if (!info) return;
        const origem = this._conteudoOrigem();
        if (!origem.title && !origem.descriptionHtml) {
            showToast('Nada para traduzir — preencha título/descrição.', 'error');
            return;
        }
        this._statusTrad(`Traduzindo para ${info.nome}…`);
        try {
            const system = `You are a professional e-commerce translator. Translate the product content given as JSON from its source language into ${info.en}.`
                + ` Rules: translate naturally for online shoppers, not word-for-word.`
                + ` descriptionHtml: translate ONLY the human-readable text and keep every HTML tag, attribute and <img> element exactly as-is.`
                + ` Never translate brand names, model names or trademarks (e.g. Ray-Ban, Shimano, Ferrari, Mercedes-Benz).`
                + ` handle: a URL slug in ${info.en} — lowercase ASCII, words separated by hyphens, no spaces or accents.`
                + ` variants: translate each option name and its values (e.g. "Color"→localized, "Black"→localized).`
                + ` Return ONLY valid JSON: {"title":"...","descriptionHtml":"...","handle":"...","variants":[{"name":"...","values":["..."]}]}`;
            const txt = await this._traduzirComIA(system, JSON.stringify(origem), { json: true });
            const t = JSON.parse(txt);
            this._translations[langCode] = {
                title: t.title || '',
                descriptionHtml: t.descriptionHtml || '',
                handle: (t.handle || '').trim(),
                variants: Array.isArray(t.variants) ? t.variants : [],
                traduzidoEm: new Date().toISOString(),
            };
            this._abrirTrad = langCode;   // já abre pra revisar
            this._statusTrad('');
            this._renderTraducoes();
            showToast(`Traduzido para ${info.nome}`, 'success');
        } catch (e) {
            this._statusTrad('');
            showToast('Falha ao traduzir: ' + String(e.message).slice(0, 140), 'error');
        }
    },

    async _traduzirImagensIdioma(langCode) {
        const t = this._translations[langCode];
        const info = this._LANG_INFO[langCode];
        if (!t) return;
        const tmp = document.createElement('div');
        tmp.innerHTML = t.descriptionHtml || '';
        const imgs = [...tmp.querySelectorAll('img')];
        if (!imgs.length) { showToast('A descrição traduzida não tem imagens.', 'info'); return; }
        if (!confirm(`Traduzir o texto de ${imgs.length} imagem(ns) para ${info.nome}? Cada uma é uma chamada paga à IA.`)) return;

        let ok = 0, falhas = 0;
        for (let i = 0; i < imgs.length; i++) {
            const el = imgs[i];
            const origem = el.getAttribute('src');
            if (!origem) { falhas++; continue; }
            this._statusTrad(`Traduzindo imagem ${i + 1} de ${imgs.length} para ${info.nome}…`);
            try {
                const blob = await bytesDaImagem(origem);
                const natural = await dimensoesDaImagem(blob);
                const largura = parseInt(el.getAttribute('width'), 10) || natural.largura;
                const altura = parseInt(el.getAttribute('height'), 10) || natural.altura;
                const prompt = ImageAI.promptTraducaoImagem(info.en);
                const gerado = await ImageAI.editar(blob, prompt, {
                    provedor: this._provedorImagem(), modelo: this._modeloImagem() || undefined,
                    largura, altura, formato: 'image/webp', compressao: 90,
                });
                const dataUrl = await comprimirImagemParaDataUrl(gerado, this._IMG_MAX, this._IMG_QUALIDADE,
                    { formato: 'image/webp', largura, altura });
                el.setAttribute('src', dataUrl);
                ok++;
            } catch (e) {
                console.warn('[Produtos] falha ao traduzir imagem', i, e.message);
                falhas++;
            }
        }
        t.descriptionHtml = tmp.innerHTML;   // grava as imagens traduzidas de volta
        this._statusTrad('');
        this._renderTraducoes();
        showToast(falhas
            ? `${ok} imagem(ns) traduzida(s), ${falhas} falharam.`
            : `${ok} imagem(ns) traduzida(s) para ${info.nome}.`, falhas ? 'warning' : 'success');
    },

    _tradEditorHtml(code, t) {
        const temImg = /<img/i.test(t.descriptionHtml || '');
        const vars = (t.variants || []).map(v =>
            `<div class="prod-trad-var"><strong>${escapeHtml(v.name)}:</strong> ${(v.values || []).map(escapeHtml).join(', ')}</div>`).join('');
        return `
            <div class="prod-trad-editor">
                <label>Título</label>
                <input class="input input-sm" data-trad-lang="${code}" data-trad-field="title" value="${escapeHtml(t.title || '')}">
                <label>URL (handle)</label>
                <input class="input input-sm" data-trad-lang="${code}" data-trad-field="handle" value="${escapeHtml(t.handle || '')}">
                <label>Descrição</label>
                <div class="prod-trad-desc" contenteditable="true" data-trad-lang="${code}" data-trad-field="descriptionHtml">${t.descriptionHtml || ''}</div>
                ${vars ? `<label>Variantes</label><div class="prod-trad-vars">${vars}</div>` : ''}
                ${temImg ? `<button type="button" class="btn btn-secondary btn-sm" data-trad-imgs="${code}" style="margin-top:0.5rem"><i data-lucide="languages" style="width:13px;height:13px;vertical-align:-2px"></i> Traduzir imagens da descrição</button>` : ''}
            </div>`;
    },

    _renderTraducoes() {
        const lista = document.getElementById('prod-trad-lista');
        const origemEl = document.getElementById('prod-trad-origem');
        if (!lista) return;
        const idiomas = this._idiomasSelecionados();
        const origem = idiomas[0];
        const alvos = idiomas.slice(1);
        if (origemEl) origemEl.textContent = origem ? (this._LANG_INFO[origem]?.nome || origem) : '—';

        const shopifyOk = typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured();
        // Botão de envio só faz sentido com Shopify conectado e algo traduzido.
        const btnShopify = document.getElementById('btn-prod-trad-shopify');
        if (btnShopify) {
            const temTraducao = alvos.some(c => this._translations[c]);
            btnShopify.style.display = (temTraducao && shopifyOk) ? '' : 'none';
        }
        // "Puxar idiomas da loja" só aparece com Shopify conectado.
        const btnPull = document.getElementById('btn-prod-trad-pull');
        if (btnPull) btnPull.style.display = shopifyOk ? '' : 'none';

        if (!alvos.length) {
            lista.innerHTML = `<p class="studio-vazio" style="font-size:0.76rem;padding:0.4rem 0">Marque 2 ou mais idiomas em "Idiomas / Mercados" — o 1º é a origem, os demais são traduzidos.</p>`;
            return;
        }

        lista.innerHTML = alvos.map(code => {
            const info = this._LANG_INFO[code] || { nome: code };
            const t = this._translations[code];
            const aberto = this._abrirTrad === code;
            return `
            <div class="prod-trad-item ${aberto ? 'aberto' : ''}" data-lang="${code}">
                <div class="prod-trad-head">
                    <span class="prod-trad-nome">${escapeHtml(info.nome)}</span>
                    ${t ? `<span class="prod-trad-ok"><i data-lucide="check" style="width:11px;height:11px;vertical-align:-1px"></i> traduzido</span>` : ''}
                    <span style="flex:1"></span>
                    ${t ? `<button type="button" class="btn-icon" data-trad-toggle="${code}" title="Ver/editar"><i data-lucide="chevron-${aberto ? 'up' : 'down'}" style="width:14px;height:14px"></i></button>` : ''}
                    <button type="button" class="btn btn-secondary btn-sm" data-trad-run="${code}">${t ? 'Retraduzir' : 'Traduzir com IA'}</button>
                </div>
                ${aberto && t ? this._tradEditorHtml(code, t) : ''}
            </div>`;
        }).join('');
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}

        lista.querySelectorAll('[data-trad-run]').forEach(b =>
            b.addEventListener('click', () => this._traduzirIdioma(b.dataset.tradRun)));
        lista.querySelectorAll('[data-trad-toggle]').forEach(b =>
            b.addEventListener('click', () => {
                this._abrirTrad = this._abrirTrad === b.dataset.tradToggle ? null : b.dataset.tradToggle;
                this._renderTraducoes();
            }));
        lista.querySelectorAll('[data-trad-imgs]').forEach(b =>
            b.addEventListener('click', () => this._traduzirImagensIdioma(b.dataset.tradImgs)));
        // Edição inline reflete direto no objeto guardado.
        lista.querySelectorAll('[data-trad-field]').forEach(el => {
            const ev = el.tagName === 'DIV' ? 'input' : 'input';
            el.addEventListener(ev, () => {
                const code = el.dataset.tradLang, field = el.dataset.tradField;
                if (!this._translations[code]) return;
                this._translations[code][field] = (field === 'descriptionHtml') ? el.innerHTML : el.value;
            });
        });
    },

    // Envia as traduções guardadas para a Shopify — todos os idiomas que já
    // foram traduzidos, não só um. Escrita real na loja, então confirma antes.
    async _enviarTraducoesShopify() {
        const pid = document.getElementById('product-id')?.value;
        const produto = pid ? (AppState.allProducts || []).find(p => p.id === pid) : null;
        if (!produto) { showToast('Salve o produto antes de enviar traduções.', 'error'); return; }
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
            showToast('Conecte a Shopify primeiro.', 'error'); return;
        }
        const sid = this._shopifyIdDe(produto);
        if (!sid) { showToast('Vincule o produto à Shopify primeiro.', 'error'); return; }
        const gid = String(sid).startsWith('gid://') ? sid : `gid://shopify/Product/${sid}`;

        // Monta { localeShopify: traducao } só dos idiomas já traduzidos e que
        // têm locale Shopify (Inglês-EUA não tem locale próprio).
        const porIdioma = {};
        const nomes = [];
        this._idiomasSelecionados().slice(1).forEach(code => {
            const t = this._translations[code];
            const info = this._LANG_INFO[code];
            if (t && info?.locale) { porIdioma[info.locale] = t; nomes.push(info.nome); }
        });
        if (!Object.keys(porIdioma).length) {
            showToast('Traduza ao menos um idioma antes de enviar.', 'error'); return;
        }
        if (!confirm(`Enviar ${nomes.length} tradução(ões) — ${nomes.join(', ')} — para a Shopify?\n\nIsso grava as traduções na loja (título, descrição, URL e variantes por idioma).`)) return;

        // Variantes de origem: casam os valores traduzidos com os GIDs certos.
        const variantesOrigem = (produto.shopifyOptions || []).map(o => ({ name: o.name, values: o.values || [] }));

        this._statusTrad('Enviando traduções para a Shopify…');
        const btn = document.getElementById('btn-prod-trad-shopify');
        if (btn) btn.disabled = true;
        try {
            const res = await ShopifyModule.enviarTraducoesDoProduto(gid, porIdioma, {
                variantesOrigem,
                onProgress: (m) => this._statusTrad(m),
            });
            this._statusTrad('');
            const okNomes = res.ok.map(loc => Object.entries(this._LANG_INFO).find(([, v]) => v.locale === loc)?.[1]?.nome || loc);
            if (res.falhas.length) {
                showToast(`${res.ok.length} enviada(s), ${res.falhas.length} falharam: ${res.falhas.map(f => f.locale).join(', ')}`, 'warning');
                console.warn('[Produtos] falhas de tradução Shopify:', res.falhas);
            } else {
                showToast(`Traduções enviadas para a Shopify: ${okNomes.join(', ')}`, 'success');
            }
        } catch (e) {
            this._statusTrad('');
            showToast('Falha ao enviar: ' + String(e.message).slice(0, 160), 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    // ── Gerar a GALERIA INTEIRA de uma vez ──
    // A capa sozinha não fecha uma página de produto: a loja precisa do
    // conjunto (estúdio, ângulo, em uso, detalhe, escala). Aqui o usuário
    // marca os cenários e os padrões que quer e a ferramenta gera tudo em
    // sequência, sempre a partir da MESMA foto base do produto real.
    abrirGerarGaleria() {
        const base = this._images.find(im => im.dataUrl || im.url);
        if (!base) { showToast('Adicione ao menos uma foto do produto para servir de base.', 'error'); return; }

        const presets = (window.StudioModule?.PRESETS_FOTO) || [];
        const padroes = (window.StudioModule?._state?.padroes) || [];
        const nichos = [...new Set(padroes.map(p => p.nicho).filter(Boolean))].sort();

        const linhaPreset = (p) => `
            <label class="prod-gal-item">
                <input type="checkbox" data-preset="${p.id}" checked>
                <span>${escapeHtml(p.label)}</span>
            </label>`;
        const linhaPadrao = (p) => `
            <label class="prod-gal-item" data-nicho="${escapeHtml(p.nicho || '')}">
                <input type="checkbox" data-padrao="${p.id}">
                ${p.exemploThumb ? `<img src="${p.exemploThumb}" alt="">` : ''}
                <span>${escapeHtml(p.nome)}${p.nicho ? ` <em>${escapeHtml(p.nicho)}</em>` : ''}</span>
            </label>`;

        this._abrirOverlay(`
            <strong style="font-size:1rem">Gerar galeria do produto</strong>
            <p style="margin:0;font-size:0.8rem;color:var(--text-muted)">
                Marque o que quer gerar. Cada item é uma chamada paga à IA, feita a partir da foto base do produto.
            </p>

            <div>
                <div class="prod-gal-titulo">Cenários <button type="button" class="prod-gal-toggle" data-toggle="preset">alternar todos</button></div>
                <div class="prod-gal-lista">${presets.map(linhaPreset).join('')}</div>
            </div>

            ${padroes.length ? `
            <div>
                <div class="prod-gal-titulo">
                    Padrões de criativo
                    ${nichos.length > 1 ? `<select id="pgal-nicho" class="input input-sm" style="width:auto;margin-left:auto">
                        <option value="">Todos os nichos</option>
                        ${nichos.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')}
                    </select>` : ''}
                </div>
                <div class="prod-gal-lista" id="pgal-padroes">${padroes.map(linhaPadrao).join('')}</div>
            </div>` : ''}

            <label class="prod-gal-item" style="border:none;padding-left:0">
                <input type="checkbox" id="pgal-substituir">
                <span>Substituir as imagens atuais (por padrão, as novas são <strong>adicionadas</strong>)</span>
            </label>

            <div style="display:flex;gap:0.5rem;justify-content:flex-end;align-items:center">
                <span id="pgal-conta" class="prod-gal-conta"></span>
                <button type="button" class="btn btn-primary btn-sm" id="pgal-gerar">Gerar</button>
            </div>
        `, (ov) => {
            const marcados = () => [...ov.querySelectorAll('input[type=checkbox][data-preset]:checked, input[type=checkbox][data-padrao]:checked')];
            const atualizaConta = () => {
                const n = marcados().length;
                ov.querySelector('#pgal-conta').textContent = n ? `${n} imagem(ns)` : 'nada marcado';
                ov.querySelector('#pgal-gerar').disabled = !n;
            };
            ov.addEventListener('change', atualizaConta);
            atualizaConta();

            ov.querySelector('[data-toggle="preset"]')?.addEventListener('click', () => {
                const caixas = [...ov.querySelectorAll('input[data-preset]')];
                const ligar = !caixas.every(c => c.checked);
                caixas.forEach(c => { c.checked = ligar; });
                atualizaConta();
            });
            ov.querySelector('#pgal-nicho')?.addEventListener('change', (e) => {
                ov.querySelectorAll('#pgal-padroes .prod-gal-item').forEach(el => {
                    el.style.display = (!e.target.value || el.dataset.nicho === e.target.value) ? '' : 'none';
                });
            });

            ov.querySelector('#pgal-gerar').addEventListener('click', () => {
                const itens = marcados().map(c => c.dataset.preset
                    ? { tipo: 'preset', id: c.dataset.preset }
                    : { tipo: 'padrao', id: c.dataset.padrao });
                const substituir = ov.querySelector('#pgal-substituir').checked;
                ov.remove();
                this._gerarGaleria(itens, substituir);
            });
        });
    },

    async _gerarGaleria(itens, substituir) {
        const base = this._images.find(im => im.dataUrl || im.url);
        if (!base || !itens.length) return;

        const presets = (window.StudioModule?.PRESETS_FOTO) || [];
        const padroes = (window.StudioModule?._state?.padroes) || [];
        const contexto = this._contextoDoFormulario();
        const idProduto = document.getElementById('product-id')?.value || null;

        // A base é lida UMA vez — reusar o mesmo blob evita refetch por item.
        let blobBase;
        try { blobBase = await bytesDaImagem(base.dataUrl || base.url); }
        catch (e) { showToast('Não consegui ler a foto base: ' + e.message, 'error'); return; }

        const novas = [];
        let falhas = 0;
        for (let i = 0; i < itens.length; i++) {
            const item = itens[i];
            const preset = item.tipo === 'preset' ? presets.find(p => p.id === item.id) : null;
            const padrao = item.tipo === 'padrao' ? padroes.find(p => p.id === item.id) : null;
            const rotulo = preset?.label || padrao?.nome || item.id;
            this._statusImagem(`Gerando ${i + 1} de ${itens.length} — ${rotulo}…`);

            try {
                let blobs = [blobBase];
                let prompt;

                if (preset) {
                    prompt = `${preset.prompt}${contexto ? ` The product is: ${contexto}.` : ''}`
                        + ' Do not add any text, logo, badge or label that is not already visible on the product in the input image.';
                } else if (padrao) {
                    prompt = window.StudioModule?.montarPromptDoPadrao?.(padrao, idProduto, {
                        produto: (document.getElementById('product-name')?.value || '').trim() || 'the product',
                        marca: (document.getElementById('product-vendor')?.value || '').trim(),
                    }) || padrao.esqueleto;

                    // Padrão tem referência visual: manda os pixels dela também.
                    let ref = null;
                    if (padrao.exemploMediaId && window.MediaStore?.isSupported?.()) {
                        try { ref = (await MediaStore.get(padrao.exemploMediaId))?.blob || null; } catch {}
                    }
                    if (!ref && padrao.exemploThumb) {
                        try { ref = await bytesDaImagem(padrao.exemploThumb); } catch {}
                    }
                    if (ref) {
                        blobs = [ref, blobBase];
                        prompt = `Use the two provided images. THE FIRST IMAGE is a reference advertising creative: copy its composition, framing, camera angle, product placement, background, surface, lighting and colour grading. THE SECOND IMAGE is the real product. Rebuild the scene of the first image featuring the product from the second image, keeping that product's exact shape, colour, materials and every marking unchanged. ${prompt}`;
                    }
                } else { continue; }

                const gerado = await ImageAI.editar(blobs, prompt, {
                    provedor: this._provedorImagem(),
                    modelo: this._modeloImagem() || undefined,
                    largura: 1024, altura: 1024,
                    formato: 'image/webp', compressao: 90,
                });
                const dataUrl = await comprimirImagemParaDataUrl(gerado, this._IMG_MAX, this._IMG_QUALIDADE, { formato: 'image/webp' });
                novas.push({ dataUrl, name: `${_handleSimples(rotulo)}.webp`, melhorada: true, cenario: rotulo });
                if (window.RecentEdits?.add) RecentEdits.add({ prompt: `Galeria: ${rotulo}`, thumb: dataUrl, origem: 'Produto' });

                // Mostra o que já saiu enquanto o resto ainda gera.
                if (substituir && novas.length === 1) this._images = [];
                this._images.push(novas[novas.length - 1]);
                this._renderProductImages();
            } catch (e) {
                console.warn('[Produtos] falha ao gerar', rotulo, e.message);
                falhas++;
            }
        }

        this._statusImagem('');
        if (!novas.length) { showToast('Nenhuma imagem foi gerada. Veja o console para o motivo.', 'error'); return; }
        showToast(falhas
            ? `${novas.length} imagem(ns) gerada(s), ${falhas} falharam.`
            : `Galeria gerada: ${novas.length} imagem(ns).`, falhas ? 'warning' : 'success');
    },

    // ══════════════════════════════════════════════════════════════
    //  Enviar imagens para a Shopify
    //  Única escrita que o app faz na loja — por isso é sempre um botão
    //  explícito com confirmação, nunca automático ao salvar. As imagens
    //  aqui são re-sintetizadas por IA; empurrar direto pra página que o
    //  cliente vê sem o usuário conferir seria arriscado.
    // ══════════════════════════════════════════════════════════════

    abrirEnviarShopify() {
        const idProduto = document.getElementById('product-id')?.value || null;
        const produto = idProduto ? (AppState.allProducts || []).find(p => p.id === idProduto) : null;
        if (!produto) {
            showToast('Salve o produto antes de enviar imagens para a Shopify.', 'error');
            return;
        }
        const sid = this._shopifyIdDe(produto);
        if (!sid) {
            showToast('Vincule o produto à Shopify primeiro (Conexão Shopify).', 'error');
            return;
        }
        // "const ShopifyModule" no topo do arquivo não vira propriedade de
        // window — window.ShopifyModule é sempre undefined. É o identificador
        // léxico que funciona (já documentado, mesma pegadinha de antes).
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
            showToast('Conecte a Shopify primeiro (Conexão Shopify).', 'error');
            return;
        }

        // Só as que ainda não foram — reenviar a mesma imagem duplicaria na
        // Shopify. `_images` reflete o formulário aberto, pode ter imagem
        // nova desde a última vez que a tela foi salva.
        const pendentes = this._images
            .map((im, i) => ({ im, i }))
            .filter(({ im }) => (im.dataUrl) && !im.enviadaShopify);

        if (!pendentes.length) {
            showToast('Nada novo para enviar — imagens da Shopify não precisam reenvio.', 'info');
            return;
        }

        this._abrirOverlay(`
            <strong style="font-size:1rem">Enviar para a Shopify</strong>
            <p style="margin:0;font-size:0.8rem;color:var(--text-muted)">
                ${pendentes.length} imagem(ns) ${pendentes.length > 1 ? 'vão' : 'vai'} para o produto <strong>${escapeHtml(produto.name)}</strong> na loja.
                Isso é uma escrita real na Shopify — a imagem fica visível na página do produto.
            </p>
            <div class="prod-gal-lista">
                ${pendentes.map(({ im, i }) => `
                    <label class="prod-gal-item">
                        <input type="checkbox" data-idx="${i}" checked>
                        <img src="${im.dataUrl}" alt="">
                        <span>${escapeHtml(im.name || `Imagem ${i + 1}`)}${i === 0 ? ' <em>(capa)</em>' : ''}</span>
                    </label>`).join('')}
            </div>
            <div style="display:flex;gap:0.5rem;justify-content:flex-end;align-items:center">
                <span id="pship-conta" class="prod-gal-conta"></span>
                <button type="button" class="btn btn-secondary btn-sm" id="pship-cancelar">Cancelar</button>
                <button type="button" class="btn btn-primary btn-sm" id="pship-enviar">Confirmar envio</button>
            </div>
        `, (ov) => {
            const atualizaConta = () => {
                const n = ov.querySelectorAll('input[data-idx]:checked').length;
                ov.querySelector('#pship-conta').textContent = `${n} selecionada(s)`;
                ov.querySelector('#pship-enviar').disabled = !n;
            };
            ov.addEventListener('change', atualizaConta);
            atualizaConta();
            ov.querySelector('#pship-cancelar').addEventListener('click', () => ov.remove());
            ov.querySelector('#pship-enviar').addEventListener('click', () => {
                const idxs = [...ov.querySelectorAll('input[data-idx]:checked')].map(c => parseInt(c.dataset.idx, 10));
                ov.remove();
                this._enviarParaShopify(sid, idxs);
            });
        });
    },

    async _enviarParaShopify(shopifyIdBruto, indices) {
        const gid = String(shopifyIdBruto).startsWith('gid://') ? shopifyIdBruto : `gid://shopify/Product/${shopifyIdBruto}`;

        this._statusImagem(`Enviando 0 de ${indices.length} para a Shopify…`);
        let idsConhecidos;
        try {
            idsConhecidos = await ShopifyModule.idsDeMidiaAtual(gid);
        } catch (e) {
            this._statusImagem('');
            showToast('Não consegui consultar a Shopify: ' + e.message, 'error');
            return;
        }

        let ok = 0, falhas = 0;
        const capaIdx = indices.includes(0) ? 0 : null;
        let capaMediaId = null;

        for (let n = 0; n < indices.length; n++) {
            const i = indices[n];
            const im = this._images[i];
            if (!im?.dataUrl) { falhas++; continue; }
            this._statusImagem(`Enviando ${n + 1} de ${indices.length} para a Shopify…`);
            try {
                const media = await ShopifyModule.enviarImagemDoProduto(gid, im.dataUrl, {
                    nome: im.name, alt: (document.getElementById('product-name')?.value || '').trim(),
                    idsConhecidos,
                });
                if (media?.id) {
                    idsConhecidos.add(media.id);
                    im.enviadaShopify = true;
                    im.shopifyMediaId = media.id;
                    if (i === capaIdx) capaMediaId = media.id;
                }
                ok++;
            } catch (e) {
                console.warn('[Produtos] falha ao enviar imagem', i, 'para a Shopify:', e.message);
                falhas++;
            }
        }

        // A imagem marcada "Capa" localmente (posição 0) também vira a
        // capa na Shopify — sem isso ela entraria no fim da galeria de lá.
        if (capaMediaId) {
            this._statusImagem('Definindo capa na Shopify…');
            try { await ShopifyModule.reordenarMidia(gid, [{ id: capaMediaId, posicao: 0 }]); }
            catch (e) { console.warn('[Produtos] falha ao definir capa na Shopify:', e.message); }
        }

        this._statusImagem('');
        this._renderProductImages();
        showToast(falhas
            ? `${ok} enviada(s) para a Shopify, ${falhas} falharam.`
            : `${ok} imagem(ns) enviada(s) para a Shopify.`, falhas ? 'warning' : 'success');
    },

    // ── Gerar capa a partir de um padrão de criativo (com filtro de nicho) ──
    abrirGerarCapa() {
        const padroes = (window.StudioModule?._state?.padroes) || [];
        if (!padroes.length) {
            showToast('Nenhum padrão de criativo ainda. Crie um no Estúdio de Produto (Padrões de criativo).', 'info');
            return;
        }
        const base = this._images[0];
        if (!base || !(base.dataUrl || base.url)) {
            showToast('Adicione ao menos uma foto do produto para servir de base.', 'error');
            return;
        }

        const nichos = [...new Set(padroes.map(p => p.nicho).filter(Boolean))].sort();
        const opcoesNicho = ['<option value="">Todos os nichos</option>']
            .concat(nichos.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)).join('');

        const cartao = (p) => `
            <button type="button" class="prod-padrao-card" data-padrao="${p.id}" data-nicho="${escapeHtml(p.nicho || '')}">
                ${p.exemploThumb ? `<img src="${p.exemploThumb}" alt="">` : '<span class="prod-padrao-sem"></span>'}
                <span class="prod-padrao-nome">${escapeHtml(p.nome)}</span>
                ${p.nicho ? `<span class="prod-padrao-nicho">${escapeHtml(p.nicho)}${p.subnicho ? ' · ' + escapeHtml(p.subnicho) : ''}</span>` : ''}
            </button>`;

        this._abrirOverlay(`
            <strong style="font-size:1rem">Gerar capa a partir de um padrão</strong>
            <p style="margin:0;font-size:0.8rem;color:var(--text-muted)">Usa a primeira foto do produto como base e reaplica o enquadramento do padrão escolhido.</p>
            <select id="pcapa-nicho" class="input input-sm">${opcoesNicho}</select>
            <div id="pcapa-lista" class="prod-padrao-grid">${padroes.map(cartao).join('')}</div>
        `, (ov) => {
            const filtro = ov.querySelector('#pcapa-nicho');
            filtro.addEventListener('change', () => {
                ov.querySelectorAll('.prod-padrao-card').forEach(c => {
                    c.style.display = (!filtro.value || c.dataset.nicho === filtro.value) ? '' : 'none';
                });
            });
            ov.querySelectorAll('.prod-padrao-card').forEach(c => {
                c.addEventListener('click', () => {
                    const p = padroes.find(x => x.id === c.dataset.padrao);
                    ov.remove();
                    if (p) this._gerarComPadrao(p);
                });
            });
        });
    },

    async _gerarComPadrao(padrao) {
        const base = this._images[0];
        this._statusImagem(`Gerando capa com o padrão "${padrao.nome}"…`);
        try {
            const blobBase = await bytesDaImagem(base.dataUrl || base.url);
            // O esqueleto do padrão já vem com marcadores; preenche com o que
            // está no formulário agora (produto pode nem estar salvo ainda).
            const idProduto = document.getElementById('product-id')?.value || null;
            let prompt = window.StudioModule?.montarPromptDoPadrao?.(padrao, idProduto, {
                produto: (document.getElementById('product-name')?.value || '').trim() || 'the product',
                marca: (document.getElementById('product-vendor')?.value || '').trim(),
            }) || padrao.esqueleto;

            // A referência visual do padrão entra como PIXEL quando existe —
            // descrever a composição em texto não reproduz o enquadramento.
            const blobs = [blobBase];
            let refBlob = null;
            if (padrao.exemploMediaId && window.MediaStore?.isSupported?.()) {
                try { refBlob = (await MediaStore.get(padrao.exemploMediaId))?.blob || null; } catch {}
            }
            if (!refBlob && padrao.exemploThumb) {
                try { refBlob = await bytesDaImagem(padrao.exemploThumb); } catch {}
            }
            if (refBlob) {
                blobs.unshift(refBlob);   // [referência, produto] — o prompt fala em "first/second image"
                prompt = `Use the two provided images. THE FIRST IMAGE is a reference advertising creative: copy its composition, framing, camera angle, product placement, background, surface, lighting and colour grading. THE SECOND IMAGE is the real product. Rebuild the scene of the first image featuring the product from the second image, keeping that product's exact shape, colour, materials and every marking unchanged. ${prompt}`;
            }

            const gerado = await ImageAI.editar(blobs, prompt, {
                provedor: this._provedorImagem(),
                modelo: this._modeloImagem() || undefined,
                largura: 1024, altura: 1024,
                formato: 'image/webp', compressao: 90,
            });
            const dataUrl = await comprimirImagemParaDataUrl(gerado, this._IMG_MAX, this._IMG_QUALIDADE, { formato: 'image/webp' });

            // Capa entra na primeira posição — é o que a lista rotula "Capa".
            this._images.unshift({ dataUrl, name: `capa-${padrao.id}.webp`, melhorada: true });
            this._renderProductImages();
            this._statusImagem('');
            if (window.RecentEdits?.add) RecentEdits.add({ prompt: `Capa — ${padrao.nome}`, thumb: dataUrl, origem: 'Produto' });
            showToast(`Capa gerada com o padrão "${padrao.nome}"`, 'success');
        } catch (e) {
            this._statusImagem('');
            showToast('Falha ao gerar capa: ' + String(e.message).slice(0, 140), 'error');
        }
    },

    // ── Produto em uso / sobre uma superfície ──
    abrirGerarCenario() {
        const base = this._images[0];
        if (!base || !(base.dataUrl || base.url)) {
            showToast('Adicione ao menos uma foto do produto para servir de base.', 'error');
            return;
        }
        const sugestoes = [
            'being held in a person\'s hand, outdoors',
            'on top of a rustic wooden table',
            'on top of a white marble countertop',
            'being worn by an adult model, natural light',
            'on top of a car dashboard',
            'on a beach towel with sand and sea in the background',
        ];
        this._abrirOverlay(`
            <strong style="font-size:1rem">Gerar produto em uso</strong>
            <p style="margin:0;font-size:0.8rem;color:var(--text-muted)">Descreva onde/como o produto aparece. Em inglês funciona melhor nos modelos de imagem.</p>
            <input id="pcen-texto" class="input" placeholder="ex.: on top of a wooden table / being used by a fisherman" list="pcen-sugestoes">
            <datalist id="pcen-sugestoes">${sugestoes.map(s => `<option value="${escapeHtml(s)}">`).join('')}</datalist>
            <div class="prod-cenario-chips">${sugestoes.map(s => `<button type="button" class="prod-cenario-chip" data-sug="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>
            <div style="display:flex;gap:0.5rem;justify-content:flex-end">
                <button type="button" class="btn btn-primary btn-sm" id="pcen-gerar">Gerar</button>
            </div>
        `, (ov) => {
            const campo = ov.querySelector('#pcen-texto');
            ov.querySelectorAll('.prod-cenario-chip').forEach(b => {
                b.addEventListener('click', () => { campo.value = b.dataset.sug; campo.focus(); });
            });
            const gerar = () => {
                const txt = campo.value.trim();
                if (!txt) { showToast('Descreva o cenário', 'error'); campo.focus(); return; }
                ov.remove();
                this._gerarCenario(txt);
            };
            ov.querySelector('#pcen-gerar').addEventListener('click', gerar);
            campo.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); gerar(); } });
            setTimeout(() => campo.focus(), 30);
        });
    },

    async _gerarCenario(sobre) {
        const base = this._images[0];
        this._statusImagem('Gerando o produto em uso…');
        try {
            const blob = await bytesDaImagem(base.dataUrl || base.url);
            const gerado = await ImageAI.editar(blob, ImageAI.promptCenario(sobre, this._contextoDoFormulario()), {
                provedor: this._provedorImagem(),
                modelo: this._modeloImagem() || undefined,
                largura: 1024, altura: 1024,
                formato: 'image/webp', compressao: 90,
            });
            const dataUrl = await comprimirImagemParaDataUrl(gerado, this._IMG_MAX, this._IMG_QUALIDADE, { formato: 'image/webp' });
            this._images.push({ dataUrl, name: 'em-uso.webp', melhorada: true });
            if (window.RecentEdits?.add) RecentEdits.add({ prompt: `Produto em uso: ${sobre}`, thumb: dataUrl, origem: 'Produto' });
            this._renderProductImages();
            this._statusImagem('');
            showToast('Imagem do produto em uso gerada', 'success');
        } catch (e) {
            this._statusImagem('');
            showToast('Falha ao gerar: ' + String(e.message).slice(0, 140), 'error');
        }
    },

    // Overlay leve reaproveitado pelos dois seletores acima.
    _abrirOverlay(html, aoAbrir) {
        document.getElementById('prod-img-overlay')?.remove();
        const ov = document.createElement('div');
        ov.id = 'prod-img-overlay';
        ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center';
        ov.innerHTML = `<div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:1.25rem;width:min(680px,94vw);max-height:88vh;overflow:auto;display:flex;flex-direction:column;gap:0.8rem">${html}</div>`;
        document.body.appendChild(ov);
        ov.addEventListener('click', (e) => { if (e.target === ov) ov.remove(); });
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
        aoAbrir?.(ov);
    },

    // Mostra as variantes trazidas da Shopify (leitura). Elas existem para
    // alimentar geração de criativo por variante — não são editáveis aqui,
    // já que a fonte da verdade continua sendo a Shopify.
    _renderShopifyVariants(product) {
        const box = document.getElementById('prod-shopify-variants');
        if (!box) return;
        const vars = product?.shopifyVariants || [];
        if (!vars.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
        box.style.display = '';
        const opts = (product.shopifyOptions || []).map(o => `${o.name}: ${o.values.join(', ')}`).join(' · ');
        box.innerHTML = `
            <div class="prod-section-title" style="display:flex;align-items:center;gap:0.4rem;margin-bottom:0.4rem">
                <i data-lucide="layers" style="width:14px;height:14px"></i> Variantes da Shopify
                <small style="font-weight:400;color:var(--text-muted)">${vars.length} · somente leitura</small>
            </div>
            ${opts ? `<p style="font-size:0.72rem;color:var(--text-muted);margin:0 0 0.5rem">${this._esc(opts)}</p>` : ''}
            <div class="prod-variants-grid">
                ${vars.map(v => `
                    <div class="prod-variant-chip" title="${this._esc(v.sku || '')}">
                        ${v.image ? `<img src="${this._esc(v.image)}" alt="" loading="lazy">` : '<span class="prod-variant-noimg"><i data-lucide="image-off" style="width:14px;height:14px"></i></span>'}
                        <span class="prod-variant-name">${this._esc(v.title)}</span>
                        <span class="prod-variant-price">${v.price}</span>
                        ${v.availableForSale ? '' : '<span class="prod-variant-off">esgotado</span>'}
                    </div>`).join('')}
            </div>`;
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    },

    // ══════════════════════════════════════════════════════════════
    //  Importar descrição, fotos e variantes da Shopify
    // ══════════════════════════════════════════════════════════════

    // Aplica os detalhes num produto local. Não sobrescreve o que o usuário
    // escreveu: por padrão só preenche o que está vazio.
    _aplicarDetalhesShopify(produto, det, { sobrescrever = false } = {}) {
        if (!produto || !det) return { descricao: false, fotos: 0, variantes: 0 };
        const res = { descricao: false, fotos: 0, variantes: 0 };

        const descAtual = String(produto.description || '').replace(/<[^>]*>/g, '').trim();
        if (det.descriptionHtml && (sobrescrever || !descAtual)) {
            produto.description = det.descriptionHtml;
            res.descricao = true;
        }

        if (det.images?.length) {
            const atuais = produto.images || [];
            const jaTem = new Set(atuais.map(im => im.url).filter(Boolean));
            const novas = det.images
                .filter(im => sobrescrever || !jaTem.has(im.url))
                .map(im => ({ url: im.url, alt: im.alt || '', name: im.alt || '', width: im.width, height: im.height }));
            // Uploads locais (base64) são preservados mesmo ao sobrescrever —
            // eles não vieram da Shopify e seriam perdidos sem volta.
            const uploads = atuais.filter(im => im.dataUrl);
            produto.images = sobrescrever ? [...uploads, ...novas] : [...atuais, ...novas];
            res.fotos = novas.length;
        }

        if (det.variants?.length) {
            produto.shopifyVariants = det.variants;
            produto.shopifyOptions = det.options || [];
            res.variantes = det.variants.length;
        }
        if (det.vendor && (sobrescrever || !produto.vendor)) produto.vendor = det.vendor;
        if (det.tags?.length && (sobrescrever || !(produto.tags || []).length)) produto.tags = det.tags;
        if (det.handle) produto.shopifyHandle = det.handle;
        produto.shopifyDetailsAt = new Date().toISOString();
        return res;
    },

    // Descobre o id Shopify de um produto local (vínculo, campo ou nome)
    _shopifyIdDe(produto) {
        if (!produto) return null;
        if (typeof ShopifyModule !== 'undefined' && ShopifyModule.getLink) {
            const l = ShopifyModule.getLink(produto.id);
            if (l) return String(l);
        }
        if (produto.shopifyId) return String(produto.shopifyId);
        const cat = (typeof ShopifyModule !== 'undefined' && ShopifyModule.getShopifyProducts)
            ? ShopifyModule.getShopifyProducts() : [];
        const norm = (s) => String(s || '').toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
        const achado = cat.find(sp => norm(sp.title) === norm(produto.name));
        return achado ? String(achado.id) : null;
    },

    // Importa para UM produto (usado dentro do formulário aberto)
    async importarDetalhesDoProdutoAberto() {
        const id = document.getElementById('product-id')?.value;
        const produto = (AppState.allProducts || []).find(p => p.id === id);
        if (!produto) { showToast('Salve o produto antes de importar da Shopify.', 'warning'); return; }
        const sid = this._shopifyIdDe(produto);
        if (!sid) { showToast('Vincule o produto à Shopify primeiro (Conexão Shopify).', 'error'); return; }

        const btn = document.getElementById('btn-import-shopify-details');
        const orig = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" style="width:13px;height:13px;animation:spin 1s linear infinite"></i> Importando…'; }
        try {
            const mapa = await ShopifyModule.fetchProductDetails([sid]);
            const det = mapa[sid];
            if (!det) throw new Error('Produto não encontrado na Shopify');

            const temDesc = String(produto.description || '').replace(/<[^>]*>/g, '').trim();
            const sobrescrever = temDesc
                ? confirm('Este produto já tem descrição.\n\nOK = substituir pela da Shopify\nCancelar = manter a atual e só trazer fotos/variantes')
                : false;

            const r = this._aplicarDetalhesShopify(produto, det, { sobrescrever });
            LocalStore.save('products', AppState.allProducts);
            if (typeof filterDataByStore === 'function') filterDataByStore();
            EventBus.emit('productsChanged');

            // Reabre o formulário para refletir os dados novos
            this.openForm(produto);
            showToast(`Importado: ${r.descricao ? 'descrição, ' : ''}${r.fotos} foto(s), ${r.variantes} variante(s).`, 'success');
        } catch (err) {
            showToast('Falha ao importar: ' + (err.message || err), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {} }
        }
    },

    // Importa em MASSA para todos os produtos vinculados
    async importarDetalhesEmMassa() {
        const produtos = (AppState.allProducts || []).filter(p => this._shopifyIdDe(p));
        if (!produtos.length) { showToast('Nenhum produto vinculado à Shopify.', 'warning'); return; }
        if (!confirm(`Importar descrição, fotos e variantes da Shopify para ${produtos.length} produto(s)?\n\nDescrições já preenchidas na ferramenta são preservadas.`)) return;

        const btn = document.getElementById('btn-import-shopify-details-bulk');
        const orig = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" style="width:13px;height:13px;animation:spin 1s linear infinite"></i> Importando…'; }
        try {
            const ids = produtos.map(p => this._shopifyIdDe(p));
            const mapa = await ShopifyModule.fetchProductDetails(ids);
            let comDesc = 0, fotos = 0, vars = 0, semDados = 0;
            produtos.forEach(p => {
                const det = mapa[this._shopifyIdDe(p)];
                if (!det) { semDados++; return; }
                const r = this._aplicarDetalhesShopify(p, det, { sobrescrever: false });
                if (r.descricao) comDesc++;
                fotos += r.fotos; vars += r.variantes;
            });
            LocalStore.save('products', AppState.allProducts);
            if (typeof filterDataByStore === 'function') filterDataByStore();
            EventBus.emit('productsChanged');
            this.render();
            showToast(`${comDesc} descrição(ões), ${fotos} foto(s) e ${vars} variante(s) importadas.${semDados ? ` ${semDados} sem dados na Shopify.` : ''}`, 'success');
        } catch (err) {
            showToast('Falha na importação: ' + (err.message || err), 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {} }
        }
    },

    render() {
        const tbody = document.getElementById('products-tbody');
        let products = AppState.products.filter(p => !p.status || p.status !== 'arquivado');

        // Filter por status
        const statusFilter = (document.getElementById('products-status-filter')?.value || '').trim();
        if (statusFilter) {
            products = AppState.products.filter(p => (p.status || 'ativo') === statusFilter);
        }

        // Filter por search query
        const q = (document.getElementById('products-search')?.value || '').toLowerCase().trim();
        if (q) {
            products = products.filter(p => {
                const haystack = [
                    p.name, p.sku, p.vendor, p.description, p.language,
                    ...(p.tags || []),
                ].filter(Boolean).join(' ').toLowerCase();
                return haystack.includes(q);
            });
        }

        // Update count
        const countEl = document.getElementById('products-search-count');
        if (countEl) {
            const total = AppState.products.filter(p => !p.status || p.status !== 'arquivado').length;
            countEl.textContent = (q || statusFilter)
                ? `${products.length} de ${total}`
                : '';
        }

        if (products.length === 0) {
            tbody.innerHTML = `<tr class="empty-row"><td colspan="11">${q || statusFilter ? 'Nenhum produto encontrado para os filtros aplicados.' : 'Nenhum produto cadastrado. Clique em "+ Adicionar Produto".'}</td></tr>`;
            this._renderBulkBar();
            return;
        }

        if (!this._selectedIds) this._selectedIds = new Set();

        const pipelineCards = typeof PipelineModule !== 'undefined' ? (PipelineModule.cards || []) : [];
        const pipelineCols = typeof PipelineModule !== 'undefined' ? (PipelineModule.FLOW_LABELS || {}) : {};

        const shopifyShop = (typeof ShopifyModule !== 'undefined' && ShopifyModule.getConfig) ? (ShopifyModule.getConfig().shop || '') : '';

        tbody.innerHTML = products.map(p => {
            const profitUSD = calculateProfitPerSale(p, p.cpaCurrency, p.cpa);
            const profitClass = profitUSD >= 0 ? 'color: var(--green)' : 'color: var(--red)';
            const statusBadge = p.status === 'rascunho'
                ? '<span class="prod-status-badge prod-status-rascunho">Rascunho</span>'
                : '<span class="prod-status-badge prod-status-ativo">Ativo</span>';

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

            const isSelected = this._selectedIds.has(p.id);
            return `<tr class="${isSelected ? 'row-selected' : ''}" data-product-id="${p.id}">
                <td><input type="checkbox" class="products-row-cb" data-id="${p.id}" ${isSelected ? 'checked' : ''}></td>
                <td><strong>${this._escapeHtml(p.name)}</strong>${typeof renderProductMetaBadges === 'function' ? renderProductMetaBadges(p) : ''}${p.pageUrl ? ` <a class="prod-page-link" href="${this._escapeHtml(p.pageUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Abrir a página que roda este produto"><i data-lucide="external-link" style="width:12px;height:12px;vertical-align:-2px"></i> Página</a>` : ''}<br>${stageBadge}${countryBadges}</td>
                <td>${statusBadge}</td>
                <td>${typeof renderProductMetaBadges === 'function' && (Array.isArray(p.languages) || Array.isArray(p.platforms)) ? renderProductMetaBadges(p) : this._escapeHtml(p.language || p.country || 'Ingles')}</td>
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

        // Bind row checkboxes
        tbody.querySelectorAll('.products-row-cb').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = e.target.dataset.id;
                if (e.target.checked) this._selectedIds.add(id);
                else this._selectedIds.delete(id);
                e.target.closest('tr').classList.toggle('row-selected', e.target.checked);
                this._renderBulkBar();
            });
        });

        this._renderBulkBar();
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    _renderBulkBar() {
        const bar = document.getElementById('products-bulk-bar');
        const count = document.getElementById('products-bulk-count');
        if (!bar) return;
        const n = (this._selectedIds || new Set()).size;
        if (n === 0) { bar.style.display = 'none'; return; }
        bar.style.display = '';
        if (count) count.textContent = `${n} selecionado${n !== 1 ? 's' : ''}`;
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
            const tombstones = this._getTombstones();

            status.style.display = 'none';
            controls.style.display = 'flex';

            list.innerHTML = shopifyProducts.map(sp => {
                const already = existingShopifyIds.has(String(sp.id));
                const deleted = tombstones.has(`shopify:${sp.id}`);
                const imgHtml = sp.image
                    ? `<img src="${sp.image}" alt="" class="shopify-import-thumb">`
                    : `<div class="shopify-import-thumb shopify-import-thumb-empty"><i data-lucide="image" style="width:14px;height:14px"></i></div>`;
                const disabled = already || deleted;
                return `
                    <label class="shopify-import-item ${disabled ? 'shopify-import-item-disabled' : ''}" data-name="${this._escapeHtml(sp.title || '')}">
                        <input type="checkbox" class="shopify-import-cb" value="${sp.id}" ${disabled ? 'disabled' : ''} ${already ? 'checked' : ''}>
                        ${imgHtml}
                        <div class="shopify-import-info">
                            <div class="shopify-import-title">${this._escapeHtml(sp.title || '(sem título)')}</div>
                            <div class="shopify-import-meta">
                                <span class="shopify-import-price">${sp.currency || ''} ${Number(sp.priceMin || 0).toFixed(2)}${sp.priceMax && sp.priceMax !== sp.priceMin ? ' — ' + Number(sp.priceMax).toFixed(2) : ''}</span>
                                ${sp.status ? `<span class="shopify-import-status-badge">${sp.status}</span>` : ''}
                                ${already ? '<span class="shopify-import-already">já importado</span>' : ''}
                                ${deleted ? '<span class="shopify-import-already" style="background:rgba(239,68,68,0.12);color:var(--danger);border-color:rgba(239,68,68,0.3)">excluído</span>' : ''}
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
