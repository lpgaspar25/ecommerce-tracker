/* Injected via chrome.scripting.executeScript on the active tab.
   Returns { kind: 'product'|'collection'|'none', product?, collection?, error? } */
(function () {
    function abs(url) {
        try { return new URL(url, location.href).toString(); }
        catch { return url; }
    }

    function pickPrice(p) {
        if (typeof p === 'number') return p;
        if (typeof p === 'string') {
            const n = parseFloat(p.replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
            return isNaN(n) ? 0 : n;
        }
        return 0;
    }

    function readJsonLd() {
        const out = [];
        for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
            try {
                const data = JSON.parse(s.textContent);
                const arr = Array.isArray(data) ? data : (Array.isArray(data['@graph']) ? data['@graph'] : [data]);
                out.push(...arr);
            } catch {}
        }
        return out;
    }

    function extractFromJsonLd() {
        const items = readJsonLd();
        const product = items.find(it => {
            const t = it['@type'];
            return t === 'Product' || (Array.isArray(t) && t.includes('Product'));
        });
        if (!product) return null;
        const offers = Array.isArray(product.offers) ? product.offers : (product.offers ? [product.offers] : []);
        let price = 0, compareAt = 0, currency = '';
        for (const o of offers) {
            const p = pickPrice(o.price || o.lowPrice);
            if (p > 0 && (!price || p < price)) price = p;
            const cmp = pickPrice(o.priceSpecification?.priceCurrency ? o.priceSpecification?.price : 0);
            if (cmp > price) compareAt = cmp;
            currency = currency || o.priceCurrency || o.priceSpecification?.priceCurrency || '';
        }
        const images = (Array.isArray(product.image) ? product.image : [product.image]).filter(Boolean).map((src, i) => ({
            src: abs(typeof src === 'string' ? src : (src.url || src['@id'] || '')),
            position: i + 1,
            alt: product.name || '',
        })).filter(im => im.src);

        return {
            handle: (product.sku || product.mpn || product.name || 'product').toString().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100),
            title: product.name || '',
            body: product.description || '',
            vendor: (product.brand && (product.brand.name || product.brand)) || '',
            type: product.category || '',
            tags: '',
            published: true,
            seoTitle: '', seoDescription: '',
            status: 'active',
            options: [],
            variants: [{ optionValues: [], sku: product.sku || '', grams: 0, price, compareAt, requiresShipping: true, taxable: true, barcode: product.gtin || product.gtin13 || '', cost: 0, weightUnit: 'g' }],
            images,
            translations: {},
            _source: { method: 'json-ld', url: location.href, currency },
        };
    }

    async function extractFromShopify() {
        // If the URL matches /products/<handle>, fetch /products/<handle>.json
        const m = location.pathname.match(/\/products\/([^\/?#]+)/);
        if (!m) return null;
        const handle = m[1];
        try {
            const r = await fetch(`${location.origin}/products/${handle}.json`, { credentials: 'omit' });
            if (!r.ok) return null;
            const j = await r.json();
            const p = j.product;
            if (!p) return null;
            return {
                handle: p.handle,
                title: p.title || '',
                body: p.body_html || '',
                vendor: p.vendor || '',
                type: p.product_type || '',
                tags: Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || ''),
                published: !!p.published_at,
                seoTitle: '', seoDescription: '',
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
                images: (p.images || []).map(im => ({ src: abs(im.src), position: im.position, alt: im.alt || '' })),
                translations: {},
                _source: { method: 'shopify-json', url: location.href },
            };
        } catch {
            return null;
        }
    }

    function extractHeuristic() {
        const title = document.querySelector('h1')?.innerText?.trim()
            || document.querySelector('meta[property="og:title"]')?.content
            || document.title || '';
        const body = document.querySelector('meta[property="og:description"]')?.content
            || document.querySelector('meta[name="description"]')?.content
            || '';
        const vendor = document.querySelector('meta[property="product:brand"]')?.content || '';
        const priceText = document.querySelector('meta[property="product:price:amount"]')?.content
            || document.querySelector('[itemprop="price"]')?.getAttribute('content')
            || document.querySelector('[itemprop="price"]')?.innerText
            || '';
        const currency = document.querySelector('meta[property="product:price:currency"]')?.content
            || document.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') || '';
        const price = pickPrice(priceText);

        // Image collection: og:image plus visible product imgs
        const images = [];
        const seen = new Set();
        const push = (src) => {
            if (!src) return;
            const a = abs(src);
            if (seen.has(a)) return;
            seen.add(a);
            images.push({ src: a, position: images.length + 1, alt: title });
        };
        document.querySelectorAll('meta[property="og:image"], meta[property="og:image:url"]').forEach(m => push(m.content));
        // Heuristics for product image gallery
        document.querySelectorAll('main img, [class*="product" i] img, [class*="gallery" i] img, [class*="hero" i] img').forEach(img => {
            const src = img.currentSrc || img.src;
            if (!src || src.startsWith('data:')) return;
            // Skip tiny icons
            if ((img.naturalWidth && img.naturalWidth < 200) && (img.naturalHeight && img.naturalHeight < 200)) return;
            push(src);
        });

        if (!title && !images.length) return null;
        return {
            handle: title.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 100) || 'imported',
            title, body, vendor, type: '', tags: '',
            published: true, seoTitle: '', seoDescription: '',
            status: 'active',
            options: [],
            variants: [{ optionValues: [], sku: '', grams: 0, price, compareAt: 0, requiresShipping: true, taxable: true, barcode: '', cost: 0, weightUnit: 'g' }],
            images: images.slice(0, 12),
            translations: {},
            _source: { method: 'heuristic', url: location.href, currency },
        };
    }

    async function extractCollection() {
        // Shopify-style /collections/<handle> → /collections/<handle>/products.json
        const m = location.pathname.match(/\/collections\/([^\/?#]+)/);
        if (!m) return null;
        const handle = m[1];
        try {
            const items = [];
            for (let page = 1; page <= 5; page++) {
                const r = await fetch(`${location.origin}/collections/${handle}/products.json?limit=50&page=${page}`, { credentials: 'omit' });
                if (!r.ok) break;
                const j = await r.json();
                const ps = j.products || [];
                if (!ps.length) break;
                items.push(...ps);
                if (ps.length < 50) break;
            }
            if (!items.length) return null;
            return {
                kind: 'collection',
                handle,
                count: items.length,
                products: items.map(p => ({
                    handle: p.handle,
                    title: p.title || '',
                    body: p.body_html || '',
                    vendor: p.vendor || '',
                    type: p.product_type || '',
                    tags: Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || ''),
                    published: !!p.published_at,
                    seoTitle: '', seoDescription: '',
                    status: 'active',
                    options: (p.options || []).map(o => o.name),
                    variants: (p.variants || []).map(v => ({
                        optionValues: [v.option1, v.option2, v.option3].filter(Boolean),
                        sku: v.sku || '', grams: v.grams || 0,
                        price: parseFloat(v.price) || 0,
                        compareAt: parseFloat(v.compare_at_price) || 0,
                        requiresShipping: !!v.requires_shipping,
                        taxable: !!v.taxable,
                        barcode: v.barcode || '',
                        cost: 0, weightUnit: 'g',
                    })),
                    images: (p.images || []).map(im => ({ src: abs(im.src), position: im.position, alt: im.alt || '' })),
                    translations: {},
                    _source: { method: 'shopify-collection', url: location.href },
                })),
            };
        } catch {
            return null;
        }
    }

    return (async function run() {
        try {
            // 1) Try Shopify product API first (most reliable when available)
            const sh = await extractFromShopify();
            if (sh) return { kind: 'product', product: sh };

            // 2) Try collection (Shopify pattern)
            if (/\/collections\//.test(location.pathname)) {
                const col = await extractCollection();
                if (col) return col;
            }

            // 3) JSON-LD Product
            const jl = extractFromJsonLd();
            if (jl) return { kind: 'product', product: jl };

            // 4) Heuristic
            const h = extractHeuristic();
            if (h && (h.title || h.images.length)) return { kind: 'product', product: h };

            return { kind: 'none', error: 'Não consegui detectar um produto nesta página.' };
        } catch (e) {
            return { kind: 'none', error: 'Erro: ' + (e?.message || e) };
        }
    })();
})();
