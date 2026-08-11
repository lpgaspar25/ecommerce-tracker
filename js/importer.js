/* ===========================
   Importador — Shopify CSV / URL → editar → traduzir → publicar
   =========================== */

const ImporterModule = (() => {
    const SHOPS_KEY = 'etracker_shopify_shops';
    const STATE_KEY = 'etracker_importer_state';
    const SESSIONS_KEY = 'etracker_importer_sessions';
    const PROXY_URL = 'https://shopify-proxy.lucasmedia.workers.dev';

    const LANGS = [
        { code: 'en', name: 'English' },
        { code: 'es', name: 'Español' },
        { code: 'pt', name: 'Português (Brasil)' },
        { code: 'de', name: 'Deutsch' },
        { code: 'fr', name: 'Français' },
        { code: 'it', name: 'Italiano' },
        { code: 'nl', name: 'Nederlands' },
        { code: 'ja', name: '日本語' },
        { code: 'zh', name: '中文 (Simpl.)' },
        { code: 'ko', name: '한국어' },
        { code: 'ar', name: 'العربية' },
        { code: 'ru', name: 'Русский' },
        { code: 'tr', name: 'Türkçe' },
        { code: 'pl', name: 'Polski' },
        { code: 'sv', name: 'Svenska' },
        { code: 'da', name: 'Dansk' },
        { code: 'no', name: 'Norsk' },
        { code: 'fi', name: 'Suomi' },
        { code: 'cs', name: 'Čeština' },
        { code: 'el', name: 'Ελληνικά' },
        { code: 'he', name: 'עברית' },
        { code: 'hi', name: 'हिन्दी' },
        { code: 'id', name: 'Bahasa Indonesia' },
        { code: 'th', name: 'ไทย' },
        { code: 'uk', name: 'Українська' },
        { code: 'vi', name: 'Tiếng Việt' },
    ];

    let _state = {
        source: 'csv',
        rawProducts: [],   // normalized product objects
        selected: new Set(),
        opened: new Set(),
        translateLangs: new Set(),
        currentSessionName: '',
        shops: [],         // [{id, domain, label, session, connected, scope}]
    };

    // ── Persistence ──────────────────────────────────────────────
    function _serializeState() {
        return {
            source: _state.source,
            rawProducts: _state.rawProducts,
            selected: [..._state.selected],
            opened: [..._state.opened],
            translateLangs: [..._state.translateLangs],
            currentSessionName: _state.currentSessionName || '',
        };
    }

    function _deserializeState(obj) {
        if (!obj) return;
        _state.source = obj.source || 'csv';
        _state.rawProducts = Array.isArray(obj.rawProducts) ? obj.rawProducts : [];
        _state.selected = new Set(obj.selected || []);
        _state.opened = new Set(obj.opened || []);
        _state.translateLangs = new Set(obj.translateLangs || []);
        _state.currentSessionName = obj.currentSessionName || '';
    }

    let _saveTimer = null;
    function persistSoon() {
        if (_saveTimer) clearTimeout(_saveTimer);
        _saveTimer = setTimeout(() => {
            try {
                localStorage.setItem(STATE_KEY, JSON.stringify(_serializeState()));
            } catch (err) {
                console.warn('[importer] persist failed (storage full?):', err);
            }
        }, 350);
    }

    function loadPersistedState() {
        try {
            const raw = localStorage.getItem(STATE_KEY);
            if (raw) _deserializeState(JSON.parse(raw));
        } catch (err) {
            console.warn('[importer] load state failed', err);
        }
    }

    function loadSessionsList() {
        try { return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]'); }
        catch { return []; }
    }
    function saveSessionsList(list) {
        localStorage.setItem(SESSIONS_KEY, JSON.stringify(list));
    }

    // ── CSV Parser (RFC 4180-ish) ────────────────────────────────
    function parseCSV(text) {
        const rows = [];
        let row = [], field = '', inQ = false, i = 0;
        const n = text.length;
        // strip BOM
        if (text.charCodeAt(0) === 0xFEFF) i = 1;
        while (i < n) {
            const c = text[i];
            if (inQ) {
                if (c === '"') {
                    if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
                    inQ = false; i++; continue;
                }
                field += c; i++; continue;
            }
            if (c === '"') { inQ = true; i++; continue; }
            if (c === ',') { row.push(field); field = ''; i++; continue; }
            if (c === '\r') { i++; continue; }
            if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
            field += c; i++;
        }
        // tail
        if (field.length || row.length) { row.push(field); rows.push(row); }
        return rows;
    }

    function csvToProducts(rows) {
        if (!rows.length) return [];
        const headers = rows[0].map(h => String(h || '').trim());
        const idx = (name) => headers.indexOf(name);

        const H = {
            handle: idx('Handle'),
            title: idx('Title'),
            body: idx('Body (HTML)'),
            vendor: idx('Vendor'),
            type: idx('Type'),
            tags: idx('Tags'),
            published: idx('Published'),
            opt1Name: idx('Option1 Name'), opt1Val: idx('Option1 Value'),
            opt2Name: idx('Option2 Name'), opt2Val: idx('Option2 Value'),
            opt3Name: idx('Option3 Name'), opt3Val: idx('Option3 Value'),
            sku: idx('Variant SKU'),
            grams: idx('Variant Grams'),
            price: idx('Variant Price'),
            compareAt: idx('Variant Compare At Price'),
            requiresShipping: idx('Variant Requires Shipping'),
            taxable: idx('Variant Taxable'),
            barcode: idx('Variant Barcode'),
            imageSrc: idx('Image Src'),
            imagePos: idx('Image Position'),
            imageAlt: idx('Image Alt Text'),
            seoTitle: idx('SEO Title'),
            seoDesc: idx('SEO Description'),
            cost: idx('Cost per item'),
            status: idx('Status'),
            variantImage: idx('Variant Image'),
            weightUnit: idx('Variant Weight Unit'),
        };

        // Group by Handle (Shopify CSV repeats handle for each variant/image row)
        const byHandle = new Map();
        for (let r = 1; r < rows.length; r++) {
            const row = rows[r];
            if (!row || !row.length) continue;
            const handle = (row[H.handle] || '').trim();
            if (!handle) continue;
            const title = (row[H.title] || '').trim();
            const body = (row[H.body] || '').trim();

            let p = byHandle.get(handle);
            if (!p) {
                p = {
                    id: 'imp_' + handle,
                    handle,
                    title,
                    body,
                    vendor: (row[H.vendor] || '').trim(),
                    type: (row[H.type] || '').trim(),
                    tags: (row[H.tags] || '').trim(),
                    published: (row[H.published] || '').trim().toLowerCase() === 'true',
                    seoTitle: (row[H.seoTitle] || '').trim(),
                    seoDescription: (row[H.seoDesc] || '').trim(),
                    status: (row[H.status] || 'active').trim(),
                    options: [],
                    variants: [],
                    images: [],
                    translations: {}, // { lang: { title, body, seoTitle, seoDescription } }
                };
                byHandle.set(handle, p);
            }
            // Option names appear on the first row of each handle in Shopify CSV
            if (title && !p.title) p.title = title;
            if (body && !p.body) p.body = body;

            // Option names
            const optNames = [row[H.opt1Name], row[H.opt2Name], row[H.opt3Name]].map(x => (x || '').trim()).filter(Boolean);
            if (optNames.length && !p.options.length) p.options = optNames;

            // Variant — only push if we have a price or sku for this row
            const variantValues = [row[H.opt1Val], row[H.opt2Val], row[H.opt3Val]].map(x => (x || '').trim()).filter(Boolean);
            const price = (row[H.price] || '').trim();
            const sku = (row[H.sku] || '').trim();
            if (price || sku) {
                p.variants.push({
                    optionValues: variantValues,
                    sku,
                    grams: parseFloat(row[H.grams]) || 0,
                    price: parseFloat(price) || 0,
                    compareAt: parseFloat(row[H.compareAt]) || 0,
                    requiresShipping: (row[H.requiresShipping] || '').trim().toLowerCase() !== 'false',
                    taxable: (row[H.taxable] || '').trim().toLowerCase() !== 'false',
                    barcode: (row[H.barcode] || '').trim(),
                    cost: parseFloat(row[H.cost]) || 0,
                    weightUnit: (row[H.weightUnit] || 'g').trim(),
                });
            }

            // Image
            const imgSrc = (row[H.imageSrc] || '').trim();
            if (imgSrc) {
                const pos = parseInt(row[H.imagePos], 10) || (p.images.length + 1);
                if (!p.images.find(im => im.src === imgSrc)) {
                    p.images.push({ src: imgSrc, position: pos, alt: (row[H.imageAlt] || '').trim() });
                }
            }
        }

        // Sort variants/images
        for (const p of byHandle.values()) {
            p.images.sort((a, b) => a.position - b.position);
        }

        return Array.from(byHandle.values());
    }

    // ── Shops storage ────────────────────────────────────────────
    function loadShops() {
        try { _state.shops = JSON.parse(localStorage.getItem(SHOPS_KEY) || '[]'); }
        catch { _state.shops = []; }
    }
    function saveShops() {
        localStorage.setItem(SHOPS_KEY, JSON.stringify(_state.shops));
    }

    // ── UI: source switch ────────────────────────────────────────
    function bindSourceSwitch() {
        document.querySelectorAll('.imp-source-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const src = tab.dataset.source;
                _state.source = src;
                document.querySelectorAll('.imp-source-tab').forEach(t => t.classList.toggle('active', t === tab));
                document.querySelectorAll('.imp-source-pane').forEach(p => p.style.display = 'none');
                const pane = document.getElementById('imp-source-' + src);
                if (pane) pane.style.display = '';
            });
        });
    }

    // ── CSV file upload ──────────────────────────────────────────
    function bindCsvUpload() {
        const input = document.getElementById('imp-csv-file');
        const drop = document.querySelector('#imp-source-csv .imp-drop-zone');
        if (!input || !drop) return;
        input.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            await loadCsvFile(file);
        });
        ['dragenter', 'dragover'].forEach(evt => drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.add('imp-drop-hover'); }));
        ['dragleave', 'drop'].forEach(evt => drop.addEventListener(evt, (e) => { e.preventDefault(); drop.classList.remove('imp-drop-hover'); }));
        drop.addEventListener('drop', async (e) => {
            const file = e.dataTransfer?.files?.[0];
            if (file) await loadCsvFile(file);
        });
    }

    async function loadCsvFile(file) {
        try {
            const text = await file.text();
            const rows = parseCSV(text);
            const products = csvToProducts(rows);
            _state.rawProducts = products;
            _state.selected = new Set();
            _state.opened = new Set();
            _state.currentSessionName = '';
            persistSoon();
            renderProducts();
            if (typeof showToast === 'function') showToast(`${products.length} produtos carregados`, 'success');
        } catch (err) {
            console.error('[importer] CSV parse error', err);
            if (typeof showToast === 'function') showToast('Erro ao ler CSV: ' + err.message, 'error');
        }
    }

    // ── URL /products.json ───────────────────────────────────────
    function bindUrlLoad() {
        const btn = document.getElementById('imp-url-load');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            const urlInput = document.getElementById('imp-url-input');
            const limitInput = document.getElementById('imp-url-limit');
            const raw = (urlInput.value || '').trim();
            if (!raw) return;
            const limit = Math.max(1, Math.min(250, parseInt(limitInput.value, 10) || 50));
            const base = raw.replace(/\/+$/, '').replace(/\/products\.json.*$/, '');
            const url = `${base}/products.json?limit=${limit}`;
            btn.disabled = true; btn.textContent = 'Buscando…';
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                const products = (data.products || []).map(shopifyJsonToProduct);
                _state.rawProducts = products;
                _state.selected = new Set();
                renderProducts();
                if (typeof showToast === 'function') showToast(`${products.length} produtos carregados`, 'success');
            } catch (err) {
                console.error('[importer] URL load error', err);
                if (typeof showToast === 'function') showToast('Falha ao buscar (CORS ou loja sem API pública): ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = '<i data-lucide="download" style="width:14px;height:14px;vertical-align:-2px"></i> Buscar';
                if (window.lucide?.createIcons) lucide.createIcons();
            }
        });
    }

    function shopifyJsonToProduct(p) {
        return {
            id: 'imp_url_' + p.id,
            handle: p.handle,
            title: p.title || '',
            body: p.body_html || '',
            vendor: p.vendor || '',
            type: p.product_type || '',
            tags: Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || ''),
            published: !!p.published_at,
            seoTitle: '',
            seoDescription: '',
            status: 'active',
            options: (p.options || []).map(o => o.name),
            variants: (p.variants || []).map(v => ({
                optionValues: [v.option1, v.option2, v.option3].filter(Boolean),
                sku: v.sku || '',
                grams: v.grams || 0,
                price: parseFloat(v.price) || 0,
                compareAt: parseFloat(v.compare_at_price) || 0,
                requiresShipping: !!v.requires_shipping,
                taxable: !!v.taxable,
                barcode: v.barcode || '',
                cost: 0,
                weightUnit: 'g',
            })),
            images: (p.images || []).map(im => ({ src: im.src, position: im.position, alt: im.alt || '' })),
            translations: {},
        };
    }

    // ── Product list render ──────────────────────────────────────
    function renderProducts() {
        const wrap = document.getElementById('imp-products');
        const toolbar = document.getElementById('imp-toolbar');
        const count = document.getElementById('imp-count');
        if (!wrap) return;
        if (!_state.rawProducts.length) {
            wrap.innerHTML = '';
            if (toolbar) toolbar.style.display = 'none';
            return;
        }
        if (toolbar) toolbar.style.display = '';
        if (count) count.textContent = `${_state.rawProducts.length} produtos · ${_state.selected.size} selecionados`;

        wrap.innerHTML = _state.rawProducts.map(p => renderProductCard(p)).join('');
        bindProductCardEvents();
        refreshShopSelector();
        refreshActionButtons();
    }

    function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function renderProductCard(p) {
        // Defensive normalization — products from various sources may have gaps
        if (!Array.isArray(p.variants)) p.variants = [];
        if (!Array.isArray(p.images)) p.images = [];
        if (!Array.isArray(p.options)) p.options = [];
        if (!p.translations) p.translations = {};
        for (const v of p.variants) {
            if (!Array.isArray(v.optionValues)) v.optionValues = [];
        }
        const checked = _state.selected.has(p.id) ? 'checked' : '';
        const img = p.images?.[0]?.src || '';
        const prices = p.variants.map(v => Number(v.price) || 0).filter(x => x > 0);
        const minPrice = prices.length ? Math.min(...prices) : 0;
        const maxPrice = p.variants.length ? Math.max(...p.variants.map(v => Number(v.price) || 0)) : 0;
        const priceLabel = minPrice && maxPrice && minPrice !== maxPrice ? `${minPrice.toLocaleString('pt-BR',{minimumFractionDigits:2})} – ${maxPrice.toLocaleString('pt-BR',{minimumFractionDigits:2})}` : (maxPrice ? maxPrice.toLocaleString('pt-BR',{minimumFractionDigits:2}) : '0,00');
        const langTags = Object.keys(p.translations || {}).map(l => `<span class="imp-lang-tag" title="Tradução para ${l}">${l}</span>`).join('');
        const isOpen = _state.opened?.has(p.id);
        return `
        <div class="imp-product-card ${checked ? 'selected' : ''}" data-id="${p.id}">
            <div class="imp-card-row">
                <input type="checkbox" class="imp-prod-check" data-id="${p.id}" ${checked}>
                ${img ? `<img class="imp-prod-thumb" src="${_esc(img)}" alt="${_esc(p.title)}" loading="lazy">` : '<div class="imp-prod-thumb imp-prod-thumb-empty"></div>'}
                <div class="imp-prod-info">
                    <div class="imp-prod-title">${_esc(p.title)}</div>
                    <div class="imp-prod-meta">
                        ${p.vendor ? `<span class="imp-prod-vendor">${_esc(p.vendor)}</span>` : ''}
                        <span class="imp-prod-price">R$ ${priceLabel}</span>
                        <span class="imp-prod-vcount">${p.variants.length} variante${p.variants.length === 1 ? '' : 's'}</span>
                        <span class="imp-prod-imgs">${p.images.length} img</span>
                        ${langTags}
                    </div>
                </div>
                <div class="imp-card-actions">
                    <button class="btn btn-secondary btn-sm imp-edit-btn" data-id="${p.id}"><i data-lucide="pencil" style="width:14px;height:14px;vertical-align:-2px"></i> Editar</button>
                    <button class="imp-toggle-btn" data-id="${p.id}" title="Expandir">${isOpen ? '▲' : '▼'}</button>
                </div>
            </div>
            <div class="imp-card-body" data-id="${p.id}" style="display:${isOpen ? '' : 'none'}">
                ${renderProductBody(p)}
            </div>
        </div>`;
    }

    function renderProductBody(p) {
        const langs = Object.keys(p.translations || {});
        const variantsHtml = p.variants.length ? `
            <table class="imp-variants-table">
                <thead><tr>${(p.options || []).map(o => `<th>${_esc(o)}</th>`).join('')}<th>SKU</th><th>Preço</th><th>Compare at</th><th>Custo</th></tr></thead>
                <tbody>${p.variants.map((v, vi) => `<tr data-pid="${p.id}" data-vi="${vi}">
                    ${v.optionValues.map(ov => `<td>${_esc(ov)}</td>`).join('')}
                    ${Array(Math.max(0, (p.options?.length || 0) - v.optionValues.length)).fill('<td></td>').join('')}
                    <td><input class="input input-sm imp-v-sku" value="${_esc(v.sku)}"></td>
                    <td><input class="input input-sm imp-v-price" type="number" min="0" step="0.01" value="${v.price || 0}"></td>
                    <td><input class="input input-sm imp-v-cmp" type="number" min="0" step="0.01" value="${v.compareAt || 0}"></td>
                    <td><input class="input input-sm imp-v-cost" type="number" min="0" step="0.01" value="${v.cost || 0}"></td>
                </tr>`).join('')}</tbody>
            </table>` : '<p class="imp-hint">Sem variantes.</p>';

        const imagesHtml = p.images.length ? `
            <div class="imp-images-grid">
                ${p.images.map((im, ii) => `
                    <div class="imp-image-cell" data-pid="${p.id}" data-ii="${ii}">
                        <img src="${_esc(im.src)}" alt="${_esc(im.alt)}" loading="lazy">
                        <button class="imp-image-del" data-pid="${p.id}" data-ii="${ii}" title="Remover">×</button>
                    </div>`).join('')}
            </div>` : '<p class="imp-hint">Sem imagens.</p>';

        return `
        <div class="imp-edit-grid">
            <div class="imp-edit-col">
                <label>Title</label>
                <input type="text" class="input imp-f-title" data-id="${p.id}" value="${_esc(p.title)}">
                <label>Vendor</label>
                <input type="text" class="input imp-f-vendor" data-id="${p.id}" value="${_esc(p.vendor)}">
                <label>Tags (separadas por vírgula)</label>
                <input type="text" class="input imp-f-tags" data-id="${p.id}" value="${_esc(p.tags)}">
                <label>Body (HTML)</label>
                <textarea class="input imp-f-body" data-id="${p.id}" rows="8" style="font-family:monospace;font-size:0.78rem">${_esc(p.body)}</textarea>
                <label>SEO Title</label>
                <input type="text" class="input imp-f-seo-title" data-id="${p.id}" value="${_esc(p.seoTitle)}">
                <label>SEO Description</label>
                <textarea class="input imp-f-seo-desc" data-id="${p.id}" rows="2">${_esc(p.seoDescription)}</textarea>
            </div>
            <div class="imp-edit-col">
                <div class="imp-section-label">Imagens</div>
                ${imagesHtml}
                <div class="imp-section-label" style="margin-top:0.75rem">Variantes</div>
                ${variantsHtml}
                ${langs.length ? `<div class="imp-section-label" style="margin-top:0.75rem">Traduções carregadas</div>
                    <div class="imp-trans-list">${langs.map(l => `<button class="imp-trans-pill" data-pid="${p.id}" data-lang="${l}">${l} <span class="imp-trans-del" data-pid="${p.id}" data-lang="${l}">×</span></button>`).join('')}</div>` : ''}
            </div>
        </div>`;
    }

    // ── Event binding for cards ──────────────────────────────────
    function bindProductCardEvents() {
        const wrap = document.getElementById('imp-products');
        if (!wrap) return;

        // Selection checkbox
        wrap.querySelectorAll('.imp-prod-check').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = cb.dataset.id;
                if (cb.checked) _state.selected.add(id); else _state.selected.delete(id);
                cb.closest('.imp-product-card')?.classList.toggle('selected', cb.checked);
                document.getElementById('imp-count').textContent = `${_state.rawProducts.length} produtos · ${_state.selected.size} selecionados`;
                refreshActionButtons();
                persistSoon();
            });
        });

        // Toggle expand
        wrap.querySelectorAll('.imp-toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                if (!_state.opened) _state.opened = new Set();
                if (_state.opened.has(id)) _state.opened.delete(id); else _state.opened.add(id);
                const body = wrap.querySelector(`.imp-card-body[data-id="${id}"]`);
                if (body) body.style.display = _state.opened.has(id) ? '' : 'none';
                btn.textContent = _state.opened.has(id) ? '▲' : '▼';
                persistSoon();
            });
        });

        // Edit button → expand if not opened
        wrap.querySelectorAll('.imp-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                if (!_state.opened) _state.opened = new Set();
                _state.opened.add(id);
                const body = wrap.querySelector(`.imp-card-body[data-id="${id}"]`);
                const tog = wrap.querySelector(`.imp-toggle-btn[data-id="${id}"]`);
                if (body) body.style.display = '';
                if (tog) tog.textContent = '▲';
                body?.querySelector('.imp-f-title')?.focus();
            });
        });

        // Field edits — write back to product
        const fieldMap = {
            'imp-f-title': 'title',
            'imp-f-vendor': 'vendor',
            'imp-f-tags': 'tags',
            'imp-f-body': 'body',
            'imp-f-seo-title': 'seoTitle',
            'imp-f-seo-desc': 'seoDescription',
        };
        Object.keys(fieldMap).forEach(cls => {
            wrap.querySelectorAll('.' + cls).forEach(inp => {
                inp.addEventListener('input', () => {
                    const p = _state.rawProducts.find(x => x.id === inp.dataset.id);
                    if (p) p[fieldMap[cls]] = inp.value;
                    if (cls === 'imp-f-title') {
                        const titleEl = wrap.querySelector(`.imp-product-card[data-id="${inp.dataset.id}"] .imp-prod-title`);
                        if (titleEl) titleEl.textContent = inp.value;
                    }
                    persistSoon();
                });
            });
        });

        // Variant edits
        ['imp-v-sku','imp-v-price','imp-v-cmp','imp-v-cost'].forEach(cls => {
            wrap.querySelectorAll('.' + cls).forEach(inp => {
                inp.addEventListener('input', () => {
                    const tr = inp.closest('tr');
                    if (!tr) return;
                    const p = _state.rawProducts.find(x => x.id === tr.dataset.pid);
                    const v = p?.variants?.[Number(tr.dataset.vi)];
                    if (!v) return;
                    if (cls === 'imp-v-sku') v.sku = inp.value;
                    else if (cls === 'imp-v-price') v.price = parseFloat(inp.value) || 0;
                    else if (cls === 'imp-v-cmp') v.compareAt = parseFloat(inp.value) || 0;
                    else if (cls === 'imp-v-cost') v.cost = parseFloat(inp.value) || 0;
                    persistSoon();
                });
            });
        });

        // Image delete
        wrap.querySelectorAll('.imp-image-del').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = _state.rawProducts.find(x => x.id === btn.dataset.pid);
                if (!p) return;
                p.images.splice(Number(btn.dataset.ii), 1);
                persistSoon();
                renderProducts();
            });
        });

        // Translation pill delete
        wrap.querySelectorAll('.imp-trans-del').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const p = _state.rawProducts.find(x => x.id === el.dataset.pid);
                if (!p?.translations) return;
                delete p.translations[el.dataset.lang];
                persistSoon();
                renderProducts();
            });
        });
    }

    // ── Select all ───────────────────────────────────────────────
    function bindSelectAll() {
        const cb = document.getElementById('imp-select-all');
        if (!cb) return;
        cb.addEventListener('change', () => {
            if (cb.checked) _state.rawProducts.forEach(p => _state.selected.add(p.id));
            else _state.selected.clear();
            persistSoon();
            renderProducts();
        });
    }

    function bindClearAll() {
        document.getElementById('imp-clear-all') ||
        document.getElementById('imp-clear') ||
        document.getElementById('btn-imp-clear')?.addEventListener('click', () => {
            if (!_state.rawProducts.length) return;
            if (!confirm('Limpar todos os produtos carregados?')) return;
            _state.rawProducts = []; _state.selected = new Set(); _state.opened = new Set();
            renderProducts();
            const f = document.getElementById('imp-csv-file'); if (f) f.value = '';
        });
    }

    // ── Translation via Claude API ───────────────────────────────
    async function translateSelected() {
        const langs = [..._state.translateLangs];
        if (!langs.length) { if (typeof showToast === 'function') showToast('Escolha pelo menos um idioma', 'error'); return; }
        const ids = [..._state.selected];
        if (!ids.length) return;
        const apiKey = localStorage.getItem('ai_consultant_api_key');
        if (!apiKey) {
            if (typeof showToast === 'function') showToast('Configure a chave Anthropic em IA primeiro', 'error');
            return;
        }
        const btn = document.getElementById('imp-translate-btn');
        const total = ids.length * langs.length;
        btn.disabled = true; btn.textContent = `Traduzindo 0/${total}…`;
        let done = 0, errors = 0;
        for (const lang of langs) {
            for (const id of ids) {
                const p = _state.rawProducts.find(x => x.id === id);
                if (!p) { done++; continue; }
                try {
                    const out = await translateProduct(p, lang, apiKey);
                    p.translations[lang] = out;
                    persistSoon();
                } catch (err) {
                    errors++;
                    console.error('[importer] translate error', err);
                    if (typeof showToast === 'function') showToast(`"${p.title}" → ${lang}: ${err.message}`, 'error');
                }
                done++;
                btn.textContent = `Traduzindo ${done}/${total} (${lang})…`;
            }
        }
        btn.disabled = false; btn.textContent = 'Traduzir selecionados';
        if (typeof showToast === 'function') showToast(`${done - errors}/${total} traduções concluídas`, errors ? 'error' : 'success');
        renderProducts();
    }

    async function translateProduct(p, lang, apiKey) {
        const langName = (LANGS.find(l => l.code === lang)?.name) || lang;
        const sys = `You are an e-commerce localization specialist. Translate product copy to ${langName}. Preserve HTML tags, attributes, and inline styles exactly. Do not translate brand names, product codes, or SKUs. Return ONLY a strict JSON object with keys: title, body, seoTitle, seoDescription, tags. tags is the original tag list translated where appropriate, joined by ", ". No markdown, no commentary.`;
        const user = JSON.stringify({
            title: p.title || '',
            body: p.body || '',
            seoTitle: p.seoTitle || '',
            seoDescription: p.seoDescription || '',
            tags: p.tags || ''
        });
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 4096,
                system: sys,
                messages: [{ role: 'user', content: user }],
            }),
        });
        if (!res.ok) { const t = await res.text(); throw new Error(t.slice(0, 200)); }
        const data = await res.json();
        const txt = data?.content?.[0]?.text || '';
        // Extract JSON
        const match = txt.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Resposta sem JSON');
        const json = JSON.parse(match[0]);
        return {
            title: json.title || '',
            body: json.body || '',
            seoTitle: json.seoTitle || '',
            seoDescription: json.seoDescription || '',
            tags: json.tags || '',
        };
    }

    function bindTranslate() {
        const btn = document.getElementById('imp-translate-btn');
        if (btn) btn.addEventListener('click', translateSelected);
    }

    // ── Multi-language picker ────────────────────────────────────
    function renderLangPickerList(filter = '') {
        const wrap = document.getElementById('imp-lang-list');
        if (!wrap) return;
        const f = filter.trim().toLowerCase();
        const visible = LANGS.filter(l => !f || l.code.includes(f) || l.name.toLowerCase().includes(f));
        wrap.innerHTML = visible.map(l => {
            const checked = _state.translateLangs.has(l.code) ? 'checked' : '';
            return `<label class="imp-lang-row">
                <input type="checkbox" class="imp-lang-cb" data-code="${l.code}" ${checked}>
                <span class="imp-lang-row-name">${l.name}</span>
                <span class="imp-lang-row-code">${l.code}</span>
            </label>`;
        }).join('');
        wrap.querySelectorAll('.imp-lang-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                const code = cb.dataset.code;
                if (cb.checked) _state.translateLangs.add(code);
                else _state.translateLangs.delete(code);
                refreshLangBtnLabel();
                refreshActionButtons();
                persistSoon();
            });
        });
    }

    function refreshLangBtnLabel() {
        const lbl = document.getElementById('imp-lang-btn-label');
        if (!lbl) return;
        const n = _state.translateLangs.size;
        if (!n) { lbl.textContent = 'Idiomas'; return; }
        const codes = [..._state.translateLangs].slice(0, 4).join(', ').toUpperCase();
        lbl.textContent = n <= 4 ? codes : `${n} idiomas`;
    }

    function bindLangPicker() {
        const btn = document.getElementById('imp-lang-btn');
        const pop = document.getElementById('imp-lang-popover');
        const search = document.getElementById('imp-lang-search');
        const clearBtn = document.getElementById('imp-lang-clear');
        const doneBtn = document.getElementById('imp-lang-done');
        if (!btn || !pop) return;

        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const opening = pop.style.display === 'none';
            pop.style.display = opening ? '' : 'none';
            if (opening) {
                renderLangPickerList(search?.value || '');
                search?.focus();
            }
        });
        document.addEventListener('click', (e) => {
            if (!pop || pop.style.display === 'none') return;
            if (e.target.closest('#imp-lang-picker')) return;
            pop.style.display = 'none';
        });
        if (search) search.addEventListener('input', () => renderLangPickerList(search.value));
        if (clearBtn) clearBtn.addEventListener('click', () => {
            _state.translateLangs = new Set();
            renderLangPickerList(search?.value || '');
            refreshLangBtnLabel();
            refreshActionButtons();
            persistSoon();
        });
        if (doneBtn) doneBtn.addEventListener('click', () => { pop.style.display = 'none'; });
        refreshLangBtnLabel();
    }

    // ── Sessions ─────────────────────────────────────────────────
    function bindSessionsModal() {
        document.getElementById('btn-imp-sessions')?.addEventListener('click', () => {
            renderSessionsList();
            const nameInput = document.getElementById('imp-session-name');
            if (nameInput) nameInput.value = _state.currentSessionName || '';
            document.getElementById('modal-imp-sessions').classList.remove('hidden');
        });
        document.getElementById('btn-imp-session-save')?.addEventListener('click', () => {
            const nameInput = document.getElementById('imp-session-name');
            const name = (nameInput?.value || '').trim();
            if (!name) { if (typeof showToast === 'function') showToast('Digite um nome', 'error'); return; }
            saveCurrentAsSession(name);
        });
    }

    function saveCurrentAsSession(name) {
        const list = loadSessionsList();
        const existing = list.findIndex(s => s.name === name);
        const entry = {
            id: existing >= 0 ? list[existing].id : 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            name,
            updatedAt: new Date().toISOString(),
            productCount: _state.rawProducts.length,
            data: _serializeState(),
        };
        if (existing >= 0) list[existing] = entry; else list.unshift(entry);
        try { saveSessionsList(list); }
        catch (err) {
            if (typeof showToast === 'function') showToast('Storage cheio. Apague sessões antigas.', 'error');
            return;
        }
        _state.currentSessionName = name;
        persistSoon();
        renderSessionsList();
        if (typeof showToast === 'function') showToast(`Sessão "${name}" salva (${entry.productCount} produtos)`, 'success');
    }

    function renderSessionsList() {
        const wrap = document.getElementById('imp-sessions-list');
        if (!wrap) return;
        const list = loadSessionsList();
        if (!list.length) {
            wrap.innerHTML = '<p class="imp-hint">Nenhuma sessão salva ainda.</p>';
            return;
        }
        wrap.innerHTML = list.map(s => {
            const date = new Date(s.updatedAt).toLocaleString('pt-BR');
            const isCurrent = s.name === _state.currentSessionName;
            return `<div class="imp-session-row ${isCurrent ? 'imp-session-current' : ''}">
                <div class="imp-session-info">
                    <strong>${_esc(s.name)}</strong> ${isCurrent ? '<span class="imp-session-badge">atual</span>' : ''}
                    <div class="imp-session-meta">${s.productCount} produtos · ${_esc(date)}</div>
                </div>
                <div class="imp-session-actions">
                    <button class="btn btn-sm btn-primary imp-session-load" data-id="${s.id}">Carregar</button>
                    <button class="btn btn-sm btn-secondary imp-session-del" data-id="${s.id}">×</button>
                </div>
            </div>`;
        }).join('');
        wrap.querySelectorAll('.imp-session-load').forEach(b => b.addEventListener('click', () => loadSessionById(b.dataset.id)));
        wrap.querySelectorAll('.imp-session-del').forEach(b => b.addEventListener('click', () => deleteSessionById(b.dataset.id)));
    }

    function loadSessionById(id) {
        const list = loadSessionsList();
        const sess = list.find(s => s.id === id);
        if (!sess) return;
        if (_state.rawProducts.length && !confirm(`Carregar "${sess.name}"? Isso substitui o conteúdo atual.`)) return;
        _deserializeState(sess.data);
        _state.currentSessionName = sess.name;
        persistSoon();
        renderProducts();
        renderSessionsList();
        refreshLangBtnLabel();
        if (typeof showToast === 'function') showToast(`Sessão "${sess.name}" carregada`, 'success');
        if (typeof closeModal === 'function') closeModal('modal-imp-sessions');
    }

    function deleteSessionById(id) {
        if (!confirm('Excluir esta sessão?')) return;
        const list = loadSessionsList().filter(s => s.id !== id);
        saveSessionsList(list);
        renderSessionsList();
    }

    // ── Shops modal & connect flow ───────────────────────────────
    function bindShopsModal() {
        document.getElementById('btn-imp-shops')?.addEventListener('click', () => {
            renderShopsList();
            document.getElementById('modal-shops').classList.remove('hidden');
        });
        document.getElementById('btn-shop-connect')?.addEventListener('click', connectNewShop);
    }

    function renderShopsList() {
        const wrap = document.getElementById('shops-list');
        if (!wrap) return;
        if (!_state.shops.length) {
            wrap.innerHTML = '<p class="imp-hint">Nenhuma loja conectada. Adicione uma abaixo.</p>';
            return;
        }
        wrap.innerHTML = _state.shops.map(s => `
            <div class="imp-shop-row">
                <div>
                    <strong>${_esc(s.label || s.domain)}</strong>
                    <div style="font-size:0.78rem;color:var(--text-muted)">${_esc(s.domain)} · ${s.connected ? '<span style="color:#059669">conectada</span>' : '<span style="color:#dc2626">desconectada</span>'}</div>
                </div>
                <div style="display:flex;gap:0.4rem">
                    ${!s.connected ? `<button class="btn btn-sm btn-primary imp-shop-reauth" data-id="${s.id}">Conectar</button>` : ''}
                    <button class="btn btn-sm btn-secondary imp-shop-del" data-id="${s.id}">×</button>
                </div>
            </div>`).join('');
        wrap.querySelectorAll('.imp-shop-del').forEach(b => b.addEventListener('click', () => deleteShop(b.dataset.id)));
        wrap.querySelectorAll('.imp-shop-reauth').forEach(b => b.addEventListener('click', () => startOAuth(b.dataset.id)));
    }

    function connectNewShop() {
        const domainRaw = (document.getElementById('shop-domain-input').value || '').trim();
        const label = (document.getElementById('shop-label-input').value || '').trim();
        if (!domainRaw) return;
        const domain = domainRaw.replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
        if (!/\.myshopify\.com$/.test(domain)) {
            if (typeof showToast === 'function') showToast('Use o domínio .myshopify.com da loja', 'error');
            return;
        }
        const existing = _state.shops.find(s => s.domain === domain);
        if (existing) {
            startOAuth(existing.id);
            return;
        }
        const id = 'shop_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
        _state.shops.push({ id, domain, label, session: '', connected: false, scope: '' });
        saveShops();
        document.getElementById('shop-domain-input').value = '';
        document.getElementById('shop-label-input').value = '';
        renderShopsList();
        startOAuth(id);
    }

    function startOAuth(shopId) {
        const s = _state.shops.find(x => x.id === shopId);
        if (!s) return;
        // Use existing proxy /oauth/start with shop param. Token returns to /oauth/callback.
        // We pass our shopId in `state` so the callback page can postMessage back.
        const startUrl = `${PROXY_URL}/oauth/start?shop=${encodeURIComponent(s.domain)}&app_state=${encodeURIComponent(shopId)}`;
        const w = window.open(startUrl, 'shopify-oauth', 'width=720,height=820');
        if (!w) {
            if (typeof showToast === 'function') showToast('Permita popups para conectar', 'error');
            return;
        }
        // Listen for postMessage from callback
        const onMsg = (ev) => {
            if (!ev.data || ev.data.type !== 'shopify-oauth-complete') return;
            if (ev.data.app_state !== shopId) return;
            window.removeEventListener('message', onMsg);
            s.session = ev.data.session || '';
            s.scope = ev.data.scope || '';
            s.connected = !!s.session;
            saveShops();
            renderShopsList();
            refreshShopSelector();
            if (typeof showToast === 'function') showToast(`Loja ${s.label || s.domain} conectada`, 'success');
        };
        window.addEventListener('message', onMsg);
    }

    function deleteShop(id) {
        if (!confirm('Remover esta loja?')) return;
        _state.shops = _state.shops.filter(s => s.id !== id);
        saveShops();
        renderShopsList();
        refreshShopSelector();
    }

    // ── Shop selector (toolbar) ──────────────────────────────────
    function refreshShopSelector() {
        const sel = document.getElementById('imp-target-shop');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">Loja de destino…</option>' + _state.shops.filter(s => s.connected).map(s => `<option value="${s.id}">${_esc(s.label || s.domain)}</option>`).join('');
        if (current && _state.shops.find(s => s.id === current && s.connected)) sel.value = current;
    }

    function refreshActionButtons() {
        const transBtn = document.getElementById('imp-translate-btn');
        const pubBtn = document.getElementById('imp-publish-btn');
        const rebBtn = document.getElementById('btn-imp-rebrand');
        const hasSelection = _state.selected.size > 0;
        if (transBtn) transBtn.disabled = !hasSelection;
        if (pubBtn) pubBtn.disabled = !hasSelection;
        if (rebBtn) rebBtn.disabled = !hasSelection;
    }

    // ── Publish to Shopify ───────────────────────────────────────
    async function publishSelected() {
        const shopId = document.getElementById('imp-target-shop').value;
        const mode = document.getElementById('imp-publish-mode').value;
        if (!shopId) { if (typeof showToast === 'function') showToast('Escolha a loja de destino', 'error'); return; }
        const shop = _state.shops.find(s => s.id === shopId);
        if (!shop?.connected) { if (typeof showToast === 'function') showToast('Loja não está conectada', 'error'); return; }
        const ids = [..._state.selected];
        if (!ids.length) return;

        const btn = document.getElementById('imp-publish-btn');
        btn.disabled = true; btn.textContent = `Publicando 0/${ids.length}…`;
        let done = 0, errors = 0;
        for (const id of ids) {
            const p = _state.rawProducts.find(x => x.id === id);
            if (!p) continue;
            try {
                if (mode === 'duplicate') await publishProduct(shop, p);
                else await publishMarketsTranslations(shop, p);
                done++;
            } catch (err) {
                errors++;
                console.error('[importer] publish error', err);
                if (typeof showToast === 'function') showToast(`"${p.title}": ${err.message}`, 'error');
            }
            btn.textContent = `Publicando ${done}/${ids.length}…`;
        }
        btn.disabled = false; btn.innerHTML = '<i data-lucide="upload" style="width:14px;height:14px;vertical-align:-2px"></i> Publicar selecionados';
        if (window.lucide?.createIcons) lucide.createIcons();
        if (typeof showToast === 'function') showToast(`${done} publicados, ${errors} erros`, errors ? 'error' : 'success');
    }

    // ── Image compression (canvas → WebP) + Shopify staged upload ─
    const COMPRESS_DEFAULTS = { maxDim: 2000, quality: 0.85, mime: 'image/webp' };

    async function compressImageFromUrl(url, opts = {}) {
        const cfg = { ...COMPRESS_DEFAULTS, ...opts };
        // Try direct fetch (works when CDN sets CORS); fallback to <img crossOrigin>.
        let blob = null;
        try {
            const r = await fetch(url, { mode: 'cors' });
            if (r.ok) blob = await r.blob();
        } catch {}
        let bitmap = null;
        if (blob) {
            try { bitmap = await createImageBitmap(blob); } catch {}
        }
        if (!bitmap) {
            // Fallback via <img> + canvas (may still fail without CORS)
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.crossOrigin = 'anonymous';
                i.onload = () => resolve(i);
                i.onerror = (e) => reject(new Error('Falha ao carregar imagem (CORS?)'));
                i.src = url;
            });
            bitmap = img;
        }
        const w0 = bitmap.width || bitmap.naturalWidth;
        const h0 = bitmap.height || bitmap.naturalHeight;
        const ratio = Math.min(1, cfg.maxDim / Math.max(w0, h0));
        const w = Math.round(w0 * ratio);
        const h = Math.round(h0 * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, w, h);
        const outBlob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => b ? resolve(b) : reject(new Error('toBlob falhou')), cfg.mime, cfg.quality);
        });
        return {
            blob: outBlob,
            originalSize: blob?.size || null,
            newSize: outBlob.size,
            width: w, height: h,
        };
    }

    async function shopifyStagedUploadImage(shop, blob, filename) {
        const fileSize = blob.size;
        const stageMut = `mutation StagedUploads($input: [StagedUploadInput!]!) {
            stagedUploadsCreate(input: $input) {
                stagedTargets { url resourceUrl parameters { name value } }
                userErrors { field message }
            }
        }`;
        const stageRes = await shopifyGraphQL(shop, stageMut, {
            input: [{
                resource: 'IMAGE',
                filename: filename || `image-${Date.now()}.webp`,
                mimeType: blob.type || 'image/webp',
                fileSize: String(fileSize),
                httpMethod: 'POST',
            }],
        });
        const errs = stageRes.stagedUploadsCreate.userErrors;
        if (errs?.length) throw new Error('stagedUploads: ' + errs.map(e => e.message).join('; '));
        const target = stageRes.stagedUploadsCreate.stagedTargets[0];
        if (!target) throw new Error('stagedUploads: sem alvo retornado');
        // POST blob as multipart/form-data with Shopify-provided params
        const fd = new FormData();
        for (const p of (target.parameters || [])) fd.append(p.name, p.value);
        fd.append('file', blob, filename || `image-${Date.now()}.webp`);
        const upRes = await fetch(target.url, { method: 'POST', body: fd });
        if (!upRes.ok && upRes.status !== 201) throw new Error(`Upload HTTP ${upRes.status}`);
        return target.resourceUrl;
    }

    async function shopifyGraphQL(shop, query, variables) {
        const res = await fetch(`${PROXY_URL}/shop/graphql`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Shop-Session': shop.session },
            body: JSON.stringify({ query, variables }),
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data.errors) throw new Error(data.errors.map(e => e.message).join('; '));
        return data.data;
    }

    async function publishProduct(shop, p) {
        // Pick translation if a target lang is set on body (basic): for v1 we publish primary fields
        const productInput = {
            title: p.title,
            descriptionHtml: p.body,
            vendor: p.vendor || undefined,
            productType: p.type || undefined,
            tags: p.tags ? p.tags.split(',').map(s => s.trim()).filter(Boolean) : [],
            seo: { title: p.seoTitle || '', description: p.seoDescription || '' },
            status: (p.status || 'ACTIVE').toUpperCase(),
            productOptions: (p.options || []).map((name, i) => ({
                name,
                values: [...new Set(p.variants.map(v => v.optionValues[i]).filter(Boolean))].map(v => ({ name: v }))
            })),
        };
        const mutation = `mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
            productCreate(product: $product, media: $media) {
                product { id handle variants(first: 100) { nodes { id selectedOptions { name value } } } }
                userErrors { field message }
            }
        }`;

        // Build media: optionally compress + staged-upload each image first
        const compressOn = !!document.getElementById('imp-compress-toggle')?.checked;
        let totalSavedBytes = 0;
        const media = [];
        for (let i = 0; i < (p.images || []).length; i++) {
            const im = p.images[i];
            let src = im.src;
            const isBlob = typeof src === 'string' && src.startsWith('blob:');
            // blob: URLs (rebranded or otherwise local) MUST go through staged uploads — Shopify can't fetch them
            if (isBlob) {
                try {
                    const r = await fetch(src);
                    const blob = await r.blob();
                    const filename = `${p.handle || 'product'}-${i + 1}.png`;
                    src = await shopifyStagedUploadImage(shop, blob, filename);
                } catch (err) {
                    throw new Error(`Falha ao subir imagem editada: ${err.message}`);
                }
            } else if (compressOn) {
                try {
                    const out = await compressImageFromUrl(im.src);
                    if (out.originalSize && out.newSize < out.originalSize) totalSavedBytes += (out.originalSize - out.newSize);
                    const filename = `${p.handle || 'product'}-${i + 1}.webp`;
                    src = await shopifyStagedUploadImage(shop, out.blob, filename);
                } catch (err) {
                    console.warn('[importer] compressão falhou, usando URL original:', im.src, err.message);
                }
            }
            media.push({ originalSource: src, alt: im.alt || '', mediaContentType: 'IMAGE' });
        }
        if (compressOn && totalSavedBytes > 0) {
            const kb = (totalSavedBytes / 1024).toFixed(0);
            if (typeof showToast === 'function') showToast(`"${p.title}": ${kb} KB economizados`, 'success');
        }

        const data = await shopifyGraphQL(shop, mutation, { product: productInput, media });
        const errs = data.productCreate.userErrors;
        if (errs?.length) throw new Error(errs.map(e => e.message).join('; '));
        const created = data.productCreate.product;

        // Bulk-set variant prices/sku/cost via productVariantsBulkUpdate
        if (created.variants?.nodes?.length && p.variants.length) {
            const updates = created.variants.nodes.map(node => {
                const match = p.variants.find(v => {
                    const vKey = v.optionValues.join('|');
                    const nodeKey = node.selectedOptions.map(o => o.value).join('|');
                    return vKey === nodeKey;
                });
                if (!match) return null;
                return {
                    id: node.id,
                    price: String(match.price || 0),
                    compareAtPrice: match.compareAt ? String(match.compareAt) : null,
                    barcode: match.barcode || undefined,
                    inventoryItem: { sku: match.sku || undefined, cost: match.cost ? String(match.cost) : undefined },
                };
            }).filter(Boolean);
            if (updates.length) {
                const upMut = `mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
                    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                        userErrors { field message }
                    }
                }`;
                const up = await shopifyGraphQL(shop, upMut, { productId: created.id, variants: updates });
                const e2 = up.productVariantsBulkUpdate.userErrors;
                if (e2?.length) throw new Error(e2.map(e => e.message).join('; '));
            }
        }
        return created;
    }

    async function publishMarketsTranslations(shop, p) {
        // For Markets: requires the product to already exist on the destination by Handle.
        // Find product id by handle, then push translations for all loaded langs (skip primary).
        const langs = Object.keys(p.translations || {});
        if (!langs.length) throw new Error('Sem traduções carregadas');
        const lookup = `query findByHandle($handle: String!) {
            productByHandle(handle: $handle) { id }
        }`;
        const r = await shopifyGraphQL(shop, lookup, { handle: p.handle });
        const prodId = r.productByHandle?.id;
        if (!prodId) throw new Error(`Produto "${p.handle}" não existe na loja destino`);

        // Fetch translatable digest for this resource so we can register translations
        const digestQ = `query digest($id: ID!) {
            translatableResource(resourceId: $id) { translatableContent { key digest locale } }
        }`;
        const digestR = await shopifyGraphQL(shop, digestQ, { id: prodId });
        const digestMap = {};
        for (const c of (digestR.translatableResource?.translatableContent || [])) digestMap[c.key] = c.digest;

        const mutation = `mutation translationsRegister($resourceId: ID!, $translations: [TranslationInput!]!) {
            translationsRegister(resourceId: $resourceId, translations: $translations) {
                userErrors { field message }
            }
        }`;

        for (const lang of langs) {
            const t = p.translations[lang];
            const items = [];
            if (t.title && digestMap.title) items.push({ key: 'title', value: t.title, locale: lang, translatableContentDigest: digestMap.title });
            if (t.body && digestMap.body_html) items.push({ key: 'body_html', value: t.body, locale: lang, translatableContentDigest: digestMap.body_html });
            if (t.seoTitle && digestMap.meta_title) items.push({ key: 'meta_title', value: t.seoTitle, locale: lang, translatableContentDigest: digestMap.meta_title });
            if (t.seoDescription && digestMap.meta_description) items.push({ key: 'meta_description', value: t.seoDescription, locale: lang, translatableContentDigest: digestMap.meta_description });
            if (!items.length) continue;
            const out = await shopifyGraphQL(shop, mutation, { resourceId: prodId, translations: items });
            const errs = out.translationsRegister.userErrors;
            if (errs?.length) throw new Error(`${lang}: ${errs.map(e => e.message).join('; ')}`);
        }
    }

    function bindPublish() {
        document.getElementById('imp-publish-btn')?.addEventListener('click', publishSelected);
    }

    function bindClearTopBtn() {
        document.getElementById('btn-imp-clear')?.addEventListener('click', () => {
            if (!_state.rawProducts.length) return;
            if (!confirm('Limpar todos os produtos carregados? A sessão atual continuará nas Sessões salvas se você tiver guardado.')) return;
            _state.rawProducts = []; _state.selected = new Set(); _state.opened = new Set();
            _state.currentSessionName = '';
            persistSoon();
            renderProducts();
            const f = document.getElementById('imp-csv-file'); if (f) f.value = '';
        });
    }

    // ── Rebrand (text + image via gpt-image-1) ───────────────────
    function _rebrandText(s, oldB, newB) {
        if (!s || !oldB) return s;
        const escaped = oldB.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        // Word-boundary aware (works decently in Latin scripts)
        const re = new RegExp('\\b' + escaped + '\\b', 'gi');
        return s.replace(re, newB || '');
    }

    async function _imageUrlToPngBlob(url, maxDim = 1536) {
        // Fetch + decode + redraw to PNG (gpt-image-1 needs PNG/WebP)
        let bitmap;
        try {
            const r = await fetch(url, { mode: 'cors' });
            if (r.ok) {
                const b = await r.blob();
                bitmap = await createImageBitmap(b);
            }
        } catch {}
        if (!bitmap) {
            const img = await new Promise((res, rej) => {
                const i = new Image();
                i.crossOrigin = 'anonymous';
                i.onload = () => res(i);
                i.onerror = () => rej(new Error('CORS bloqueia esta imagem (use Compressão pra debug)'));
                i.src = url;
            });
            bitmap = img;
        }
        const w0 = bitmap.width || bitmap.naturalWidth;
        const h0 = bitmap.height || bitmap.naturalHeight;
        const ratio = Math.min(1, maxDim / Math.max(w0, h0));
        const w = Math.round(w0 * ratio), h = Math.round(h0 * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
        return await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    }

    async function _openaiEditImage(blob, prompt, size, apiKey) {
        const fd = new FormData();
        fd.append('model', 'gpt-image-1');
        fd.append('image', blob, 'src.png');
        fd.append('prompt', prompt);
        fd.append('size', size || '1024x1024');
        fd.append('quality', 'high');
        fd.append('n', '1');
        const r = await fetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey },
            body: fd,
        });
        if (!r.ok) throw new Error((await r.text()).slice(0, 200));
        const data = await r.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) throw new Error('Resposta sem imagem');
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        return new Blob([arr], { type: 'image/png' });
    }

    function _buildRebrandPrompt(oldB, newB) {
        if (newB && newB.trim()) {
            return `Replace every visible "${oldB}" brand mark, logo, or wordmark with "${newB}", matching the original style, font, color, and position. Keep the product, lighting, background, and composition completely unchanged. Do not add, remove, or stylize anything else.`;
        }
        return `Cleanly remove every visible "${oldB}" brand mark, logo, or wordmark. Restore the underlying surface naturally so the area looks original. Keep the product, lighting, background, and composition completely unchanged.`;
    }

    async function _rebrandSelected() {
        const oldB = (document.getElementById('rebrand-old')?.value || '').trim();
        const newB = (document.getElementById('rebrand-new')?.value || '').trim();
        const doText = !!document.getElementById('rebrand-do-text')?.checked;
        const doImages = !!document.getElementById('rebrand-do-images')?.checked;
        const size = document.getElementById('rebrand-size')?.value || '1024x1024';
        const ids = [..._state.selected];
        if (!oldB) { if (typeof showToast === 'function') showToast('Informe a marca antiga', 'error'); return; }
        if (!ids.length) return;
        if (!doText && !doImages) { if (typeof showToast === 'function') showToast('Marque ao menos uma das opções', 'error'); return; }

        let apiKey = '';
        if (doImages) {
            apiKey = localStorage.getItem('ai_consultant_openai_key') || '';
            if (!apiKey) { if (typeof showToast === 'function') showToast('Configure a chave OpenAI em IA primeiro', 'error'); return; }
            const totalImgs = ids.reduce((s, id) => s + (_state.rawProducts.find(p => p.id === id)?.images?.length || 0), 0);
            const cost = (totalImgs * 0.17).toFixed(2);
            if (!confirm(`Você está prestes a editar ${totalImgs} imagens. Custo estimado: ~US$ ${cost}. Continuar?`)) return;
        }

        const progress = document.getElementById('rebrand-progress');
        const btn = document.getElementById('btn-rebrand-apply');
        if (btn) btn.disabled = true;
        let textCount = 0, imgCount = 0, errCount = 0;
        const totalImgs = doImages ? ids.reduce((s, id) => s + (_state.rawProducts.find(p => p.id === id)?.images?.length || 0), 0) : 0;
        const prompt = _buildRebrandPrompt(oldB, newB);

        for (const id of ids) {
            const p = _state.rawProducts.find(x => x.id === id);
            if (!p) continue;
            if (doText) {
                p.title = _rebrandText(p.title, oldB, newB);
                p.body = _rebrandText(p.body, oldB, newB);
                p.vendor = _rebrandText(p.vendor, oldB, newB);
                p.tags = _rebrandText(p.tags, oldB, newB);
                p.seoTitle = _rebrandText(p.seoTitle, oldB, newB);
                p.seoDescription = _rebrandText(p.seoDescription, oldB, newB);
                textCount++;
            }
            if (doImages && p.images?.length) {
                for (let i = 0; i < p.images.length; i++) {
                    const im = p.images[i];
                    if (progress) progress.textContent = `Editando imagem ${imgCount + 1}/${totalImgs} (${p.title.slice(0, 30)})…`;
                    try {
                        const inputBlob = await _imageUrlToPngBlob(im.src, 1536);
                        const outBlob = await _openaiEditImage(inputBlob, prompt, size, apiKey);
                        const url = URL.createObjectURL(outBlob);
                        // Keep original URL so the user can revert if needed
                        im.originalSrc = im.originalSrc || im.src;
                        im.src = url;
                        im.rebranded = true;
                        imgCount++;
                    } catch (err) {
                        errCount++;
                        console.error('[rebrand] image error', err);
                        if (typeof showToast === 'function') showToast(`Falha em "${p.title}" img ${i + 1}: ${err.message}`, 'error');
                    }
                }
            }
            persistSoon();
        }

        if (btn) btn.disabled = false;
        if (progress) progress.textContent = '';
        if (typeof showToast === 'function') showToast(`Rebrand: ${textCount} textos, ${imgCount}/${totalImgs} imagens (${errCount} erros)`, errCount ? 'error' : 'success');
        renderProducts();
        if (!errCount) closeModal('modal-rebrand');
    }

    function bindRebrand() {
        document.getElementById('btn-imp-rebrand')?.addEventListener('click', () => {
            if (!_state.selected.size) { if (typeof showToast === 'function') showToast('Selecione produtos primeiro', 'error'); return; }
            const modal = document.getElementById('modal-rebrand');
            if (modal) {
                modal.classList.remove('hidden');
                document.getElementById('rebrand-old')?.focus();
                if (window.lucide?.createIcons) lucide.createIcons();
            }
        });
        document.getElementById('btn-rebrand-apply')?.addEventListener('click', _rebrandSelected);
        // Toggle image options visibility
        const doImg = document.getElementById('rebrand-do-images');
        const opts = document.getElementById('rebrand-image-opts');
        const warn = document.getElementById('rebrand-cost-warn');
        const sync = () => {
            const on = !!doImg?.checked;
            if (opts) opts.style.display = on ? '' : 'none';
            if (warn) warn.style.display = on ? '' : 'none';
        };
        doImg?.addEventListener('change', sync);
        sync();
    }

    // ── Extension bridge — receive products from Chrome extension ─
    function _handleExtensionMessage(ev) {
        if (ev.source !== window) return;
        const data = ev.data;
        if (!data || data.source !== 'etracker-extension') return;
        if (data.type !== 'importer-product-data') return;
        const incoming = Array.isArray(data.products) ? data.products : [];
        if (!incoming.length) return;
        // Switch to importador tab
        document.querySelector('.tab-btn[data-tab="importador"]')?.click();
        // Switch to extension source pane
        const extTab = document.querySelector('.imp-source-tab[data-source="extension"]');
        if (extTab) extTab.click();
        // Merge by handle: replace if exists, else append
        const existingByHandle = new Map(_state.rawProducts.map(p => [p.handle, p]));
        let added = 0, updated = 0;
        for (const p of incoming) {
            // Ensure shape
            p.id = p.id || ('imp_ext_' + (p.handle || Date.now()));
            p.translations = p.translations || {};
            p.images = (p.images || []).map((im, i) => ({ src: im.src, position: im.position || (i + 1), alt: im.alt || '' }));
            p.options = Array.isArray(p.options) ? p.options : [];
            p.variants = Array.isArray(p.variants) ? p.variants.map(v => ({
                optionValues: Array.isArray(v.optionValues) ? v.optionValues : [],
                sku: v.sku || '',
                grams: Number(v.grams) || 0,
                price: parseFloat(v.price) || 0,
                compareAt: parseFloat(v.compareAt) || 0,
                requiresShipping: v.requiresShipping !== false,
                taxable: v.taxable !== false,
                barcode: v.barcode || '',
                cost: Number(v.cost) || 0,
                weightUnit: v.weightUnit || 'g',
            })) : [];
            if (existingByHandle.has(p.handle)) {
                const idx = _state.rawProducts.findIndex(x => x.handle === p.handle);
                if (idx >= 0) { _state.rawProducts[idx] = { ...p }; updated++; }
            } else {
                _state.rawProducts.unshift(p);
                added++;
            }
        }
        _state.currentSessionName = '';
        persistSoon();
        renderProducts();
        if (typeof showToast === 'function') showToast(`Extensão: +${added} novos · ${updated} atualizados`, 'success');
    }

    function bindExtensionListener() {
        window.addEventListener('message', _handleExtensionMessage);
    }

    // ── Extension install instructions ───────────────────────────
    function bindExtensionInstall() {
        document.getElementById('btn-imp-ext-install')?.addEventListener('click', () => {
            const modal = document.getElementById('modal-ext-install');
            if (modal) modal.classList.remove('hidden');
        });
    }

    // ── Init ─────────────────────────────────────────────────────
    function init() {
        if (window._importerInited) return;
        window._importerInited = true;
        loadShops();
        loadPersistedState();
        bindSourceSwitch();
        bindCsvUpload();
        bindUrlLoad();
        bindSelectAll();
        bindClearTopBtn();
        bindTranslate();
        bindLangPicker();
        bindShopsModal();
        bindSessionsModal();
        bindPublish();
        bindExtensionListener();
        bindExtensionInstall();
        bindRebrand();
        refreshShopSelector();
        renderProducts();

        // Re-render icons on tab switch
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (t) => {
                if (t === 'importador' && window.lucide?.createIcons) lucide.createIcons();
            });
        }
    }

    return {
        init,
        _state, // expose for debug
        parseCSV,
        csvToProducts,
        compressImageFromUrl,
    };
})();

document.addEventListener('DOMContentLoaded', () => ImporterModule.init());
