/* ============================================================
   Product Merger — produtos separados por cor -> um produto Shopify
   com variantes, arquivos renomeados e alt text por variante.

   Princípios de segurança:
   - sempre cria um NOVO produto DRAFT;
   - nunca altera/arquiva/exclui os produtos de origem;
   - productSet cria produto, variantes, mídia e estoque de forma atômica;
   - um tag de job torna a repetição idempotente no nível da aplicação.
   ============================================================ */

const ProductMerger = (() => {
    const REQUIRED_INVENTORY_SCOPES = ['read_inventory', 'write_inventory', 'read_locations'];
    const RESUME_KEY = 'etracker_product_merge_resume';
    const JOB_PREFIX = 'etracker_product_merge_job__';

    let state = null;
    let initialized = false;

    function _uuid() {
        if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
        return `pm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    function _freshState() {
        return {
            step: 1,
            loading: false,
            creating: false,
            catalog: [],
            selectedIds: new Set(),
            grantedScopes: [],
            missingScopes: [],
            canCopyInventory: false,
            collection: null,
            collectionUrl: '',
            products: [],
            mappings: [],
            title: '',
            handle: '',
            handleTouched: false,
            optionName: 'Color',
            baseId: '',
            jobId: _uuid(),
            mergeTag: '',
            result: null,
            resultWarnings: [],
            executionError: '',
        };
    }

    function init() {
        if (initialized) return;
        initialized = true;

        document.getElementById('btn-product-merge')?.addEventListener('click', () => open());
        document.getElementById('products-bulk-merge')?.addEventListener('click', () => {
            const localProductIds = Array.from(ProductsModule?._selectedIds || []);
            open({ localProductIds });
        });
        document.getElementById('product-merge-next')?.addEventListener('click', () => _next());
        document.getElementById('product-merge-back')?.addEventListener('click', () => _back());
        document.getElementById('product-merge-close')?.addEventListener('click', () => close());

        // Retoma automaticamente o assistente depois de uma reautorização
        // de estoque/localizações na Shopify.
        let resume = null;
        try { resume = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null'); } catch {}
        if (resume?.shopifyIds?.length) {
            setTimeout(() => {
                open({ shopifyIds: resume.shopifyIds, collectionUrl: resume.collectionUrl || '' });
                try { localStorage.removeItem(RESUME_KEY); } catch {}
            }, 700);
        }
    }

    async function open({ localProductIds = [], shopifyIds = [], collectionUrl = '' } = {}) {
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured?.()) {
            _toast('Conecte a Shopify antes de unificar produtos.', 'error');
            return;
        }

        state = _freshState();
        state.collectionUrl = collectionUrl;

        const idsFromLocal = (localProductIds || []).map(localId => {
            const product = (AppState.allProducts || []).find(p => String(p.id) === String(localId));
            return product?.shopifyId || ShopifyModule.getLink?.(localId) || null;
        }).filter(Boolean).map(String);
        [...idsFromLocal, ...(shopifyIds || []).map(String)].forEach(id => state.selectedIds.add(id));

        openModal('product-merge-modal');
        state.loading = true;
        _renderLoading('Lendo o catálogo da loja conectada…');

        try {
            const [catalog, scopes] = await Promise.all([
                ShopifyModule.fetchShopifyProducts(),
                ShopifyModule.getGrantedScopes().catch(() => []),
            ]);
            state.catalog = catalog || [];
            state.grantedScopes = scopes || [];
            state.missingScopes = REQUIRED_INVENTORY_SCOPES.filter(scope => !state.grantedScopes.includes(scope));
            state.canCopyInventory = state.missingScopes.length === 0;
            state.loading = false;
            _render();
        } catch (e) {
            state.loading = false;
            _renderFatal(e.message || String(e));
        }
    }

    function close() {
        closeModal('product-merge-modal');
    }

    function _renderLoading(message) {
        const body = document.getElementById('product-merge-body');
        if (body) body.innerHTML = `<div class="pm-empty"><div><span class="spinner" style="margin:0 auto 12px"></span><strong>${_esc(message)}</strong><span>Isso pode levar alguns segundos em catálogos maiores.</span></div></div>`;
        _setFooter('', { disabled: true, label: 'Carregando…', back: false });
    }

    function _renderFatal(message) {
        const body = document.getElementById('product-merge-body');
        if (body) body.innerHTML = `<div class="pm-view"><div class="pm-alert error"><i data-lucide="circle-alert"></i><div><strong>Não foi possível abrir o assistente.</strong><br>${_esc(message)}</div></div></div>`;
        _setFooter('A conexão da Shopify não foi modificada.', { disabled: false, label: 'Tentar novamente', back: false });
        document.getElementById('product-merge-next').dataset.retryFatal = '1';
        _icons();
    }

    function _render() {
        if (!state || state.loading) return;
        _renderSteps();
        if (state.result) return _renderSuccess();
        if (state.creating) return;
        if (state.step === 1) _renderSources();
        else if (state.step === 2) _renderMapping();
        else if (state.step === 3) _renderMedia();
        else _renderReview();
        _updateFooter();
        _icons();
    }

    function _renderSteps() {
        document.querySelectorAll('#product-merge-steps li').forEach(li => {
            const step = Number(li.dataset.step);
            li.classList.toggle('active', step === state.step && !state.result);
            li.classList.toggle('done', step < state.step || !!state.result);
            const badge = li.querySelector(':scope > span');
            if (badge) badge.innerHTML = (step < state.step || state.result) ? '<i data-lucide="check"></i>' : String(step);
        });
    }

    function _renderSources() {
        const body = document.getElementById('product-merge-body');
        const selected = state.selectedIds.size;
        body.innerHTML = `
            <section class="pm-view">
                <div class="pm-view-head">
                    <div><h4>Quais produtos viram variantes?</h4><p>Cole uma coleção da loja ou escolha os produtos manualmente.</p></div>
                    <span class="pm-count-chip" id="pm-selected-count">${selected} selecionado${selected === 1 ? '' : 's'}</span>
                </div>

                <div class="pm-source-card">
                    <div class="pm-field">
                        <label for="pm-collection-url">URL da coleção</label>
                        <div class="pm-source-url">
                            <input id="pm-collection-url" class="input" type="url" value="${_attr(state.collectionUrl)}" placeholder="https://sualoja.com/collections/sophia">
                            <button type="button" class="btn btn-secondary" id="pm-load-collection"><i data-lucide="folder-search"></i> Buscar coleção</button>
                        </div>
                        <small>A URL serve apenas para localizar a coleção. Os dados vêm da Shopify conectada.</small>
                    </div>

                    <div class="pm-inline-divider">OU SELECIONE</div>

                    <div class="pm-catalog-tools">
                        <div class="pm-search-wrap"><i data-lucide="search"></i><input id="pm-catalog-search" class="input" type="search" placeholder="Buscar no catálogo Shopify…"></div>
                        <span class="pm-status-chip ok"><i data-lucide="plug-zap"></i> Shopify conectada</span>
                    </div>
                    <div id="pm-product-list" class="pm-product-list">
                        ${_catalogRows(state.catalog)}
                    </div>
                </div>
            </section>`;

        document.getElementById('pm-load-collection')?.addEventListener('click', () => _loadCollection());
        document.getElementById('pm-collection-url')?.addEventListener('input', e => { state.collectionUrl = e.target.value; });
        document.getElementById('pm-catalog-search')?.addEventListener('input', e => {
            const q = _norm(e.target.value);
            document.querySelectorAll('#pm-product-list .pm-product-row').forEach(row => {
                row.style.display = !q || row.dataset.search.includes(q) ? '' : 'none';
            });
        });
        _bindCatalogRows();
    }

    function _catalogRows(products) {
        if (!products.length) {
            return '<div class="pm-empty"><div><i data-lucide="package-search"></i><strong>Nenhum produto encontrado</strong><span>Atualize a conexão da Shopify e tente novamente.</span></div></div>';
        }
        return products.map(p => {
            const selected = state.selectedIds.has(String(p.id));
            const image = p.image
                ? `<img class="pm-product-thumb" src="${_attr(p.image)}" alt="">`
                : '<span class="pm-product-thumb-empty"><i data-lucide="image"></i></span>';
            const price = Number(p.priceMin || 0);
            return `<label class="pm-product-row ${selected ? 'selected' : ''}" data-search="${_attr(_norm(`${p.title} ${p.handle || ''}`))}">
                <input type="checkbox" class="pm-product-cb" value="${_attr(p.id)}" ${selected ? 'checked' : ''}>
                ${image}
                <span class="pm-product-main">
                    <span class="pm-product-title">${_esc(p.title || '(sem título)')}</span>
                    <span class="pm-product-meta"><span>${_esc(p.status || '')}</span><span>${p.variants?.length || 0} variante${p.variants?.length === 1 ? '' : 's'}</span></span>
                </span>
                <span class="pm-product-price">${_esc(p.currency || '')} ${price.toFixed(2)}</span>
            </label>`;
        }).join('');
    }

    function _bindCatalogRows() {
        document.querySelectorAll('#pm-product-list .pm-product-cb').forEach(cb => {
            cb.addEventListener('change', e => {
                const id = String(e.target.value);
                if (e.target.checked) state.selectedIds.add(id);
                else state.selectedIds.delete(id);
                e.target.closest('.pm-product-row')?.classList.toggle('selected', e.target.checked);
                const count = document.getElementById('pm-selected-count');
                if (count) count.textContent = `${state.selectedIds.size} selecionado${state.selectedIds.size === 1 ? '' : 's'}`;
                _updateFooter();
            });
        });
    }

    async function _loadCollection() {
        const input = document.getElementById('pm-collection-url');
        const button = document.getElementById('pm-load-collection');
        const raw = input?.value?.trim() || '';
        const handle = _collectionHandle(raw);
        if (!handle) {
            _toast('Cole uma URL de coleção válida.', 'error');
            input?.focus();
            return;
        }

        button.disabled = true;
        button.innerHTML = '<span class="spinner" style="width:13px;height:13px"></span> Buscando…';
        try {
            const collection = await ShopifyModule.fetchCollectionForMerge(handle);
            state.collection = { id: collection.id, title: collection.title, handle: collection.handle };
            state.collectionUrl = raw;
            state.selectedIds = new Set(collection.products.map(p => String(p.id)));

            const known = new Set(state.catalog.map(p => String(p.id)));
            collection.products.forEach(p => { if (!known.has(String(p.id))) state.catalog.push(p); });
            _renderSources();
            _updateFooter();
            _icons();
            _toast(`${collection.products.length} produto(s) encontrados em ${collection.title}.`, 'success');
        } catch (e) {
            _toast(e.message || String(e), 'error');
            button.disabled = false;
            button.innerHTML = '<i data-lucide="folder-search"></i> Buscar coleção';
            _icons();
        }
    }

    async function _prepareMappings() {
        if (state.selectedIds.size < 2) return;
        state.loading = true;
        _renderLoading('Lendo variantes, fotos e estoque…');
        try {
            const products = await ShopifyModule.fetchProductsForMerge(
                Array.from(state.selectedIds),
                { includeInventory: state.canCopyInventory },
            );
            if (products.length < 2) throw new Error('Não foi possível carregar pelo menos dois produtos selecionados.');

            // Preserva a ordem visual do catálogo/coleção.
            const order = new Map(Array.from(state.selectedIds).map((id, i) => [String(id), i]));
            products.sort((a, b) => (order.get(String(a.id)) ?? 999) - (order.get(String(b.id)) ?? 999));
            state.products = products;

            const commonTitle = _commonTitle(products.map(p => p.title)) || products[0].title;
            state.title = commonTitle.trim();
            state.handle = _slug(state.title);
            state.baseId = String(products[0].id);
            state.jobId = _uuid();
            state.mergeTag = `etracker-merge:${state.jobId}`;

            state.mappings = products.map((product, index) => {
                const variant = product.variants[0] || null;
                const color = _inferColor(product, variant, commonTitle, index);
                const images = product.images.map((image, imageIndex) => ({
                    ...image,
                    include: true,
                    cover: imageIndex === 0,
                    autoAlt: true,
                    alt: _defaultAlt(state.title, color, image, imageIndex),
                    filename: _defaultFilename(state.title, color, image, imageIndex),
                }));
                return { product, variant, color, images };
            });

            state.step = 2;
            state.loading = false;
            _render();
        } catch (e) {
            state.loading = false;
            state.step = 1;
            _render();
            _toast(e.message || String(e), 'error');
        }
    }

    function _renderMapping() {
        const body = document.getElementById('product-merge-body');
        const invalidVariantProducts = state.mappings.filter(m => m.product.variants.length !== 1);
        const permissionAlert = state.missingScopes.length ? `
            <div class="pm-alert warn">
                <i data-lucide="key-round"></i>
                <div><strong>Autorização de estoque necessária.</strong><br>A conexão atual é válida, mas foi criada antes destes acessos. Você poderá atualizar a permissão na última etapa.</div>
                <span class="pm-status-chip warn">${state.missingScopes.length} acesso${state.missingScopes.length === 1 ? '' : 's'}</span>
            </div>` : '';
        const variantAlert = invalidVariantProducts.length ? `
            <div class="pm-alert error"><i data-lucide="circle-alert"></i><div><strong>MVP: uma variante por produto de origem.</strong><br>${invalidVariantProducts.map(m => _esc(m.product.title)).join(', ')} possui outras variantes e precisa ser reorganizado antes.</div></div>` : '';

        body.innerHTML = `
            <section class="pm-view">
                <div class="pm-view-head"><div><h4>Confirme o produto e as cores</h4><p>A detecção usa o trecho comum dos títulos. Você pode corrigir tudo agora.</p></div><span class="pm-count-chip">${state.mappings.length} cores</span></div>
                ${permissionAlert}${variantAlert}

                <div class="pm-panel pm-form-grid">
                    <div class="pm-field"><label for="pm-target-title">Nome do novo produto</label><input id="pm-target-title" class="input" value="${_attr(state.title)}"></div>
                    <div class="pm-field"><label for="pm-target-handle">URL (handle)</label><input id="pm-target-handle" class="input" value="${_attr(state.handle)}"></div>
                    <div class="pm-field"><label for="pm-option-name">Nome da opção</label><input id="pm-option-name" class="input" value="${_attr(state.optionName)}"></div>
                </div>

                <div class="pm-field-label">Produto-base e valor da variante</div>
                <div class="pm-map-list">
                    ${state.mappings.map((m, index) => _mappingRow(m, index)).join('')}
                </div>
            </section>`;

        const titleInput = document.getElementById('pm-target-title');
        titleInput?.addEventListener('input', e => {
            state.title = e.target.value;
            if (!state.handleTouched) {
                state.handle = _slug(state.title);
                const handle = document.getElementById('pm-target-handle');
                if (handle) handle.value = state.handle;
            }
            _regenerateAutomaticMedia();
            _updateFooter();
        });
        document.getElementById('pm-target-handle')?.addEventListener('input', e => {
            state.handleTouched = true;
            state.handle = _slug(e.target.value);
            e.target.value = state.handle;
            _updateFooter();
        });
        document.getElementById('pm-option-name')?.addEventListener('input', e => {
            state.optionName = e.target.value;
            _updateFooter();
        });
        document.querySelectorAll('.pm-base-input').forEach(radio => radio.addEventListener('change', e => { state.baseId = e.target.value; }));
        document.querySelectorAll('.pm-color-input').forEach(input => input.addEventListener('input', e => {
            const index = Number(e.target.dataset.index);
            state.mappings[index].color = e.target.value;
            _regenerateMappingMedia(index);
            _markColorValidity();
            _updateFooter();
        }));
        _markColorValidity();
    }

    function _mappingRow(mapping, index) {
        const p = mapping.product;
        const v = mapping.variant;
        const image = p.images[0]?.url
            ? `<img class="pm-product-thumb" src="${_attr(p.images[0].url)}" alt="">`
            : '<span class="pm-product-thumb-empty"><i data-lucide="image"></i></span>';
        return `<div class="pm-map-row">
            <label class="pm-base-radio" title="Usar descrição, SEO e tags deste produto"><input type="radio" class="pm-base-input" name="pm-base" value="${_attr(p.id)}" ${String(p.id) === state.baseId ? 'checked' : ''}></label>
            ${image}
            <div class="pm-map-source"><strong>${_esc(p.title)}</strong><small>${v?.sku ? `SKU ${_esc(v.sku)}` : 'Sem SKU'} · produto-base ${String(p.id) === state.baseId ? 'selecionado' : 'disponível'}</small></div>
            <div class="pm-color-wrap pm-field"><label>Cor / variante</label><input class="input pm-color-input" data-index="${index}" value="${_attr(mapping.color)}"></div>
            <div class="pm-map-stats">
                <span class="pm-stat">${p.images.length} foto${p.images.length === 1 ? '' : 's'}</span>
                <span class="pm-stat">${v ? Number(v.price || 0).toFixed(2) : '—'}</span>
                <span class="pm-stat">Estoque ${v?.inventory ?? '—'}</span>
                ${p.variants.length !== 1 ? '<span class="pm-status-chip warn">revisão</span>' : '<span class="pm-status-chip ok">pronto</span>'}
            </div>
        </div>`;
    }

    function _markColorValidity() {
        const counts = new Map();
        state.mappings.forEach(m => {
            const key = _norm(m.color);
            if (key) counts.set(key, (counts.get(key) || 0) + 1);
        });
        document.querySelectorAll('.pm-color-input').forEach(input => {
            const key = _norm(input.value);
            input.classList.toggle('invalid', !key || counts.get(key) > 1);
        });
    }

    function _renderMedia() {
        const body = document.getElementById('product-merge-body');
        const total = _includedImages().length;
        body.innerHTML = `
            <section class="pm-view">
                <div class="pm-view-head"><div><h4>Fotos separadas por variante</h4><p>O marcador <code>[variant:Cor]</code> é o que faz o tema esconder as outras fotos.</p></div><span class="pm-count-chip">${total} fotos incluídas</span></div>
                <div class="pm-media-groups">
                    ${state.mappings.map((m, index) => _mediaGroup(m, index)).join('')}
                </div>
            </section>`;

        document.querySelectorAll('.pm-media-include').forEach(input => input.addEventListener('change', e => {
            const mapping = state.mappings[Number(e.target.dataset.mapping)];
            const image = mapping.images[Number(e.target.dataset.image)];
            image.include = e.target.checked;
            if (!image.include && image.cover) {
                image.cover = false;
                const next = mapping.images.find(img => img.include);
                if (next) next.cover = true;
            }
            _renderMedia();
            _updateFooter();
            _icons();
        }));
        document.querySelectorAll('.pm-cover-input').forEach(input => input.addEventListener('change', e => {
            const mapping = state.mappings[Number(e.target.dataset.mapping)];
            mapping.images.forEach((image, index) => {
                image.cover = index === Number(e.target.dataset.image);
                if (image.cover) image.include = true;
            });
            _renderMedia();
            _updateFooter();
            _icons();
        }));
        document.querySelectorAll('.pm-alt-input').forEach(input => input.addEventListener('input', e => {
            const image = state.mappings[Number(e.target.dataset.mapping)].images[Number(e.target.dataset.image)];
            image.alt = e.target.value;
            image.autoAlt = false;
            _updateFooter();
        }));
    }

    function _mediaGroup(mapping, mappingIndex) {
        const included = mapping.images.filter(i => i.include).length;
        const cards = mapping.images.length ? mapping.images.map((image, imageIndex) => `
            <article class="pm-media-card ${image.include ? '' : 'excluded'}">
                <div class="pm-media-preview">
                    <img src="${_attr(image.url)}" alt="">
                    <label class="pm-media-toggle" title="Incluir foto"><input type="checkbox" class="pm-media-include" data-mapping="${mappingIndex}" data-image="${imageIndex}" ${image.include ? 'checked' : ''}></label>
                    <label class="pm-cover-radio"><input type="radio" class="pm-cover-input" name="pm-cover-${mappingIndex}" data-mapping="${mappingIndex}" data-image="${imageIndex}" ${image.cover ? 'checked' : ''}> capa</label>
                </div>
                <div class="pm-media-meta">
                    <input class="input pm-alt-input" data-mapping="${mappingIndex}" data-image="${imageIndex}" value="${_attr(image.alt)}" ${image.include ? '' : 'disabled'}>
                    <div class="pm-media-filename" title="${_attr(image.filename)}">${_esc(image.filename)}</div>
                </div>
            </article>`).join('') : '<div class="pm-empty"><div><i data-lucide="image-off"></i><strong>Sem fotos</strong><span>A variante será criada sem mídia.</span></div></div>';
        return `<section class="pm-media-group">
            <div class="pm-media-group-head"><div><strong>${_esc(mapping.color)}</strong><span> · ${_esc(mapping.product.title)}</span></div><span>${included}/${mapping.images.length} incluídas</span></div>
            <div class="pm-media-grid">${cards}</div>
        </section>`;
    }

    function _renderReview() {
        const body = document.getElementById('product-merge-body');
        const totalImages = _includedImages().length;
        const totalStock = state.mappings.reduce((sum, m) => sum + Number(m.variant?.inventory || 0), 0);
        const permissionAlert = state.missingScopes.length ? `
            <div class="pm-alert warn"><i data-lucide="key-round"></i><div><strong>Atualize a autorização antes de criar.</strong><br>Isso permite copiar o estoque por localização. A conexão da loja será mantida.</div><button type="button" class="btn btn-secondary btn-sm" id="pm-authorize-scopes">Atualizar acesso</button></div>` : '';
        const errorAlert = state.executionError ? `<div class="pm-alert error"><i data-lucide="circle-alert"></i><div><strong>A criação não terminou.</strong><br>${_esc(state.executionError)}</div></div>` : '';

        body.innerHTML = `
            <section class="pm-view">
                <div class="pm-view-head"><div><h4>Revise antes de criar</h4><p>A Shopify receberá um produto novo em rascunho. As origens ficam intactas.</p></div><span class="pm-status-chip ok"><i data-lucide="shield-check"></i> Sem alteração nas origens</span></div>
                ${permissionAlert}${errorAlert}
                <div class="pm-review-hero">
                    <div><h5>${_esc(state.title)}</h5><p>/products/${_esc(state.handle)} · opção ${_esc(state.optionName)} · status RASCUNHO</p></div>
                    <div class="pm-review-total"><strong>${state.mappings.length}</strong><span>variantes · ${totalImages} fotos · ${totalStock} em estoque</span></div>
                </div>
                <div class="pm-review-table-wrap">
                    <table class="pm-review-table">
                        <thead><tr><th>Variante</th><th>Origem</th><th>SKU</th><th>Preço</th><th>Estoque</th><th>Fotos</th></tr></thead>
                        <tbody>${state.mappings.map(m => `<tr><td>${_esc(m.color)}</td><td>${_esc(m.product.title)}</td><td>${_esc(m.variant?.sku || '—')}</td><td>${Number(m.variant?.price || 0).toFixed(2)}</td><td>${m.variant?.inventory ?? '—'}</td><td>${m.images.filter(i => i.include).length}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
            </section>`;
        document.getElementById('pm-authorize-scopes')?.addEventListener('click', () => _requestPermissions());
    }

    function _renderProgress(items) {
        state.creating = true;
        const body = document.getElementById('product-merge-body');
        body.innerHTML = `<section class="pm-view"><div class="pm-view-head"><div><h4>Criando o rascunho</h4><p>Não feche esta janela enquanto a Shopify processa o catálogo.</p></div></div><div class="pm-progress">${items.map(item => `
            <div class="pm-progress-item ${item.state}" data-progress="${item.id}">
                <span class="pm-progress-icon"><i data-lucide="${item.state === 'done' ? 'check' : item.icon}"></i></span>
                <div><strong>${_esc(item.title)}</strong><small>${_esc(item.subtitle)}</small></div>
                <span class="pm-progress-state">${item.state === 'done' ? 'Concluído' : item.state === 'running' ? 'Em andamento' : 'Aguardando'}</span>
            </div>`).join('')}</div></section>`;
        _setFooter('O produto será criado como <strong>rascunho</strong>.', { disabled: true, label: 'Criando…', back: false });
        _icons();
    }

    async function _execute() {
        if (state.missingScopes.length) return _requestPermissions();
        state.executionError = '';

        const jobKey = _jobKey();
        let savedJob = null;
        try { savedJob = await KVStore.get(jobKey, null); } catch {}
        if (savedJob?.jobId) {
            state.jobId = savedJob.jobId;
            state.mergeTag = savedJob.mergeTag || `etracker-merge:${state.jobId}`;
        }

        const progress = [
            { id: 'plan', title: 'Plano validado', subtitle: 'Cores, SKUs, fotos e estoque conferidos.', icon: 'list-checks', state: 'done' },
            { id: 'create', title: 'Produto, variantes e fotos', subtitle: 'Criando o novo rascunho em uma operação segura.', icon: 'combine', state: 'running' },
            { id: 'collections', title: 'Coleções e verificação', subtitle: 'Relacionando o produto e relendo o resultado.', icon: 'folder-check', state: 'pending' },
        ];
        _renderProgress(progress);

        const base = state.mappings.find(m => String(m.product.id) === String(state.baseId))?.product || state.products[0];
        const collectionIds = _targetCollectionIds();
        const input = _buildProductSetInput(base);
        const job = {
            version: 1,
            jobId: state.jobId,
            mergeTag: state.mergeTag,
            sourceIds: Array.from(state.selectedIds).sort(),
            status: 'creating',
            title: state.title,
            createdAt: savedJob?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        try { await KVStore.set(jobKey, job); } catch {}

        try {
            const result = await ShopifyModule.createMergedProduct({ input, mergeTag: state.mergeTag, collectionIds });
            progress[1].state = 'done';
            progress[2].state = 'done';
            _renderProgress(progress);

            state.result = result.product;
            state.resultWarnings = result.warnings || [];
            state.creating = false;
            job.status = result.warnings?.length ? 'created_with_warnings' : 'created';
            job.targetProductId = result.product.id;
            job.targetHandle = result.product.handle;
            job.updatedAt = new Date().toISOString();
            try { await KVStore.set(jobKey, job); } catch {}

            const firstVariant = result.product.variants?.nodes?.[0];
            const local = ProductsModule?.upsertFromShopify?.(result.product, {
                title: result.product.title,
                price: Number(firstVariant?.price || 0),
                currency: ShopifyModule.getConfig()?.shopCurrency || 'USD',
                image: result.product.featuredMedia?.image?.url || '',
                status: 'rascunho',
            });
            if (local?.id) ShopifyModule.linkProduct?.(local.id, String(result.product.id).split('/').pop());
            _render();
            _toast(result.reused ? 'Rascunho recuperado sem duplicar.' : 'Produto unificado criado em rascunho.', 'success');
        } catch (e) {
            state.creating = false;
            state.executionError = e.message || String(e);
            job.status = 'failed';
            job.error = state.executionError;
            job.updatedAt = new Date().toISOString();
            try { await KVStore.set(jobKey, job); } catch {}
            state.step = 4;
            _render();
        }
    }

    function _renderSuccess() {
        const body = document.getElementById('product-merge-body');
        const product = state.result;
        const cfg = ShopifyModule.getConfig?.() || {};
        const numericId = String(product.id || '').split('/').pop();
        const adminUrl = cfg.shop ? `https://${cfg.shop}/admin/products/${numericId}` : '#';
        const warning = state.resultWarnings.length
            ? `<div class="pm-alert warn" style="margin-top:18px;text-align:left"><i data-lucide="triangle-alert"></i><div><strong>Produto criado com aviso.</strong><br>${state.resultWarnings.map(_esc).join('<br>')}</div></div>`
            : '';
        body.innerHTML = `<section class="pm-view"><div class="pm-success">
            <div class="pm-success-icon"><i data-lucide="badge-check"></i></div>
            <h4>${_esc(product.title)} foi criado</h4>
            <p>O novo produto está em rascunho com ${product.variants?.nodes?.length || state.mappings.length} variantes e ${product.media?.nodes?.length || _includedImages().length} fotos. Os produtos originais continuam ativos e sem alterações.</p>
            <div class="pm-success-actions">
                <a class="btn btn-primary" href="${_attr(adminUrl)}" target="_blank" rel="noopener"><i data-lucide="external-link"></i> Abrir na Shopify</a>
                <button type="button" class="btn btn-secondary" id="pm-new-merge"><i data-lucide="combine"></i> Nova unificação</button>
                <button type="button" class="btn btn-secondary" id="pm-finish">Fechar</button>
            </div>${warning}
        </div></section>`;
        document.getElementById('pm-new-merge')?.addEventListener('click', async () => {
            try { await KVStore.del(_jobKey()); } catch {}
            open();
        });
        document.getElementById('pm-finish')?.addEventListener('click', close);
        document.getElementById('product-merge-footer').style.display = 'none';
        _renderSteps();
        _icons();
    }

    function _buildProductSetInput(base) {
        const files = [];
        state.mappings.forEach(mapping => mapping.images.filter(image => image.include).forEach(image => {
            files.push(_fileInput(image));
        }));

        const variants = state.mappings.map(mapping => {
            const source = mapping.variant;
            const variant = {
                optionValues: [{ optionName: state.optionName.trim(), name: mapping.color.trim() }],
                price: Number(source?.price || 0),
                taxable: source?.taxable !== false,
                inventoryPolicy: source?.inventoryPolicy || 'DENY',
                inventoryItem: {
                    tracked: !!source?.tracked,
                    requiresShipping: source?.requiresShipping !== false,
                },
            };
            if (source?.compareAtPrice != null) variant.compareAtPrice = Number(source.compareAtPrice);
            if (source?.barcode) variant.barcode = source.barcode;
            if (source?.sku) variant.inventoryItem.sku = source.sku;
            if (source?.tracked && source.inventoryLevels?.length) {
                variant.inventoryQuantities = source.inventoryLevels.map(level => ({
                    locationId: level.locationId,
                    name: 'available',
                    quantity: Number(level.available || 0),
                }));
            }
            const cover = mapping.images.find(image => image.include && image.cover)
                || mapping.images.find(image => image.include);
            if (cover) variant.file = _fileInput(cover);
            return variant;
        });

        const tags = [...new Set([...(base?.tags || []), 'etracker-unified', state.mergeTag].filter(Boolean))];
        const input = {
            title: state.title.trim(),
            handle: _slug(state.handle || state.title),
            status: 'DRAFT',
            descriptionHtml: base?.descriptionHtml || '',
            vendor: base?.vendor || '',
            productType: base?.productType || '',
            tags,
            productOptions: [{
                name: state.optionName.trim(),
                position: 1,
                values: state.mappings.map(m => ({ name: m.color.trim() })),
            }],
            variants,
        };
        if (files.length) input.files = files;
        if (base?.templateSuffix) input.templateSuffix = base.templateSuffix;
        if (base?.seo?.title || base?.seo?.description) {
            input.seo = {
                title: base.seo.title || state.title.trim(),
                description: base.seo.description || '',
            };
        }
        return input;
    }

    function _fileInput(image) {
        return {
            originalSource: image.url,
            filename: image.filename,
            alt: image.alt.trim(),
            contentType: 'IMAGE',
        };
    }

    function _targetCollectionIds() {
        const selectedCollection = state.collection?.id ? [state.collection.id] : [];
        if (!state.products.length) return selectedCollection;
        const counts = new Map();
        state.products.forEach(product => (product.collections || []).forEach(c => counts.set(c.id, (counts.get(c.id) || 0) + 1)));
        const common = [...counts.entries()].filter(([, count]) => count === state.products.length).map(([id]) => id);
        return [...new Set([...selectedCollection, ...common])];
    }

    function _requestPermissions() {
        const cfg = ShopifyModule.getConfig?.() || {};
        if (!cfg.shop) return _toast('Domínio da loja conectada não encontrado.', 'error');
        try {
            localStorage.setItem(RESUME_KEY, JSON.stringify({
                shopifyIds: Array.from(state.selectedIds),
                collectionUrl: state.collectionUrl || '',
            }));
        } catch {}
        ShopifyModule.beginInstall(cfg.shop);
    }

    function _next() {
        if (!state || state.loading || state.creating) return;
        if (document.getElementById('product-merge-next')?.dataset.retryFatal === '1') return open();
        if (state.step === 1) return _prepareMappings();
        if (state.step === 2) {
            if (_mappingErrors().length) return _toast(_mappingErrors()[0], 'error');
            state.step = 3;
            return _render();
        }
        if (state.step === 3) {
            if (_mediaErrors().length) return _toast(_mediaErrors()[0], 'error');
            state.step = 4;
            return _render();
        }
        if (state.missingScopes.length) return _requestPermissions();
        return _execute();
    }

    function _back() {
        if (!state || state.creating || state.step <= 1) return;
        state.step--;
        state.executionError = '';
        _render();
    }

    function _mappingErrors() {
        const errors = [];
        if (!state.title.trim()) errors.push('Informe o nome do novo produto.');
        if (!_slug(state.handle || state.title)) errors.push('Informe uma URL válida para o produto.');
        if (!state.optionName.trim()) errors.push('Informe o nome da opção.');
        if (state.mappings.some(m => m.product.variants.length !== 1)) errors.push('O MVP aceita apenas produtos de origem com uma variante cada.');
        const colors = state.mappings.map(m => _norm(m.color));
        if (colors.some(color => !color)) errors.push('Todas as cores precisam de um nome.');
        if (new Set(colors).size !== colors.length) errors.push('Cada cor precisa ter um nome único.');
        return errors;
    }

    function _mediaErrors() {
        const errors = [];
        state.mappings.forEach(mapping => {
            const included = mapping.images.filter(i => i.include);
            if (included.some(i => !i.alt.trim() || !i.alt.includes(`[variant:${mapping.color.trim()}]`))) {
                errors.push(`Revise o marcador das fotos da variante ${mapping.color}.`);
            }
            if (included.length && !included.some(i => i.cover)) errors.push(`Escolha uma capa para ${mapping.color}.`);
        });
        return errors;
    }

    function _updateFooter() {
        if (!state || state.result) return;
        const back = state.step > 1;
        let label = 'Continuar';
        let disabled = false;
        let note = '';
        if (state.step === 1) {
            disabled = state.selectedIds.size < 2;
            note = state.collection ? `<strong>${_esc(state.collection.title)}</strong> · ${state.selectedIds.size} produtos encontrados` : 'Selecione pelo menos <strong>2 produtos</strong>.';
        } else if (state.step === 2) {
            disabled = _mappingErrors().length > 0;
            note = disabled ? _esc(_mappingErrors()[0]) : 'Descrição, SEO e tags virão do produto-base marcado.';
        } else if (state.step === 3) {
            disabled = _mediaErrors().length > 0;
            note = `${_includedImages().length} fotos serão copiadas e renomeadas.`;
        } else {
            label = state.missingScopes.length ? 'Atualizar permissões' : (state.executionError ? 'Tentar novamente' : 'Criar rascunho');
            note = state.missingScopes.length ? 'A conexão continua ativa; falta autorizar estoque e localizações.' : 'Nenhum produto original será alterado.';
        }
        _setFooter(note, { disabled, label, back });
    }

    function _setFooter(note, { disabled = false, label = 'Continuar', back = false } = {}) {
        const footer = document.getElementById('product-merge-footer');
        const noteEl = document.getElementById('product-merge-footer-note');
        const backBtn = document.getElementById('product-merge-back');
        const nextBtn = document.getElementById('product-merge-next');
        if (footer) footer.style.display = '';
        if (noteEl) noteEl.innerHTML = note || '';
        if (backBtn) backBtn.style.display = back ? '' : 'none';
        if (nextBtn) {
            nextBtn.disabled = !!disabled;
            nextBtn.dataset.retryFatal = '0';
            nextBtn.onclick = null;
            const icon = label.includes('Criar') ? 'sparkles' : label.includes('permiss') ? 'key-round' : 'arrow-right';
            nextBtn.innerHTML = `${_esc(label)} <i data-lucide="${icon}"></i>`;
        }
        _icons();
    }

    function _regenerateAutomaticMedia() {
        state.mappings.forEach((mapping, index) => _regenerateMappingMedia(index));
    }

    function _regenerateMappingMedia(index) {
        const mapping = state.mappings[index];
        mapping.images.forEach((image, imageIndex) => {
            if (image.autoAlt) image.alt = _defaultAlt(state.title, mapping.color, image, imageIndex);
            image.filename = _defaultFilename(state.title, mapping.color, image, imageIndex);
        });
    }

    function _includedImages() {
        return state.mappings.flatMap(m => m.images.filter(i => i.include));
    }

    function _commonTitle(titles) {
        const tokenized = titles.map(title => String(title || '').trim().split(/\s+/).filter(Boolean));
        if (!tokenized.length) return '';
        const prefix = [];
        const shortest = Math.min(...tokenized.map(tokens => tokens.length));
        for (let i = 0; i < shortest; i++) {
            const token = tokenized[0][i];
            if (tokenized.every(tokens => _norm(tokens[i]) === _norm(token))) prefix.push(token);
            else break;
        }
        return prefix.join(' ').replace(/[\s\-|–—,:/]+$/g, '').trim();
    }

    function _inferColor(product, variant, commonTitle, index) {
        const colorOption = variant?.options?.find(o => /^(cor|color|colour)$/i.test(o.name || ''));
        if (colorOption?.value && !/^default title$/i.test(colorOption.value)) return colorOption.value.trim();
        let suffix = String(product.title || '').slice(String(commonTitle || '').length).replace(/^[\s\-|–—,:/]+/, '').trim();
        if (suffix) return suffix;
        if (variant?.title && !/^default title$/i.test(variant.title)) return variant.title.trim();
        return `Cor ${index + 1}`;
    }

    function _defaultAlt(title, color, image, index) {
        return `${String(title || 'Produto').trim()} — ${_imageAngle(image, index)} [variant:${String(color || '').trim()}]`;
    }

    function _imageAngle(image, index) {
        let source = `${image?.alt || ''} ${image?.url || ''}`;
        try { source = decodeURIComponent(source); } catch {}
        source = _norm(source);
        if (/\b(front|frente|frontal)\b/.test(source)) return 'vista frontal';
        if (/\b(side|lateral|perfil)\b/.test(source)) return 'vista lateral';
        if (/\b(top|superior|cima)\b/.test(source)) return 'vista superior';
        if (/\b(back|rear|traseira|costas)\b/.test(source)) return 'vista traseira';
        if (/\b(detail|macro|detalhe|close)\b/.test(source)) return 'detalhe';
        return `foto ${index + 1}`;
    }

    function _defaultFilename(title, color, image, index) {
        let ext = 'jpg';
        try {
            const name = new URL(image.url).pathname.split('/').pop() || '';
            const match = name.match(/\.([a-zA-Z0-9]{2,5})$/);
            if (match) ext = match[1].toLowerCase().replace('jpeg', 'jpg');
        } catch {}
        if (!['jpg', 'png', 'webp', 'gif', 'avif'].includes(ext)) ext = 'jpg';
        return `${_slug(title) || 'produto'}-${_slug(color) || 'cor'}-${String(index + 1).padStart(2, '0')}.${ext}`;
    }

    function _collectionHandle(raw) {
        const value = String(raw || '').trim();
        if (!value) return '';
        try {
            const url = new URL(value.includes('://') ? value : `https://placeholder.invalid/${value.replace(/^\/+/, '')}`);
            const match = url.pathname.match(/\/collections\/([^/?#]+)/i);
            if (match) return decodeURIComponent(match[1]);
        } catch {}
        if (/^[a-z0-9][a-z0-9-]*$/i.test(value)) return value;
        return '';
    }

    function _jobKey() {
        const shop = ShopifyModule.getConfig?.()?.shop || 'shop';
        const source = Array.from(state.selectedIds).map(String).sort().join('|');
        return `${JOB_PREFIX}${_slug(shop)}__${_hash(source)}`;
    }

    function _hash(value) {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(36);
    }

    function _slug(value) {
        return String(value || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().trim()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 120);
    }

    function _norm(value) {
        return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    }

    function _esc(value) {
        return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
    }

    function _attr(value) { return _esc(value); }
    function _icons() { try { if (typeof lucide !== 'undefined') lucide.createIcons(); } catch {} }
    function _toast(message, type) { if (typeof showToast === 'function') showToast(_esc(message), type); else alert(message); }

    return { init, open, close };
})();

document.addEventListener('DOMContentLoaded', () => ProductMerger.init());
