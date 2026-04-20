/* ===========================
   Shopify Integration Module — OAuth Partners + GraphQL Admin API 2026-01
   Real sales tracking, product linking, CPA comparison
   =========================== */

const ShopifyModule = (() => {
    const CONFIG_KEY = 'etracker_shopify_config';
    const LINKS_KEY = 'etracker_shopify_links';
    const CACHE_KEY = 'etracker_shopify_orders_cache';
    const CACHE_TTL_MS = 5 * 60 * 1000;

    // Cloudflare Worker that handles OAuth + GraphQL proxy
    const DEFAULT_PROXY_URL = 'https://shopify-proxy.lucasmedia.workers.dev';

    let _config = null;
    let _productLinks = {};
    let _shopifyProducts = [];

    function _defaultConfig() {
        return {
            shop: '', session: '', proxyUrl: DEFAULT_PROXY_URL, connected: false,
            clientId: '', clientSecret: '',
        };
    }

    function _loadConfig() {
        try {
            _config = JSON.parse(localStorage.getItem(CONFIG_KEY)) || _defaultConfig();
            _productLinks = JSON.parse(localStorage.getItem(LINKS_KEY)) || {};
        } catch {
            _config = _defaultConfig();
            _productLinks = {};
        }
        // Ensure proxyUrl set
        if (!_config.proxyUrl) _config.proxyUrl = DEFAULT_PROXY_URL;
    }

    function _saveConfig() { localStorage.setItem(CONFIG_KEY, JSON.stringify(_config)); }
    function _saveLinks() { localStorage.setItem(LINKS_KEY, JSON.stringify(_productLinks)); }

    function getConfig() { return { ..._config }; }
    function isConfigured() { return !!(_config && _config.session && _config.shop && _config.connected); }

    // ── OAuth flow ──

    function beginInstall(shop) {
        // OAuth start is hosted on the same origin as the app (Pages Functions)
        // so that redirect_uri host matches the App URL configured in Shopify Partners.
        const returnUrl = window.location.origin + window.location.pathname;
        const params = new URLSearchParams({ shop, return: returnUrl });
        // Pass custom credentials if user provided them — otherwise server falls back to env secrets
        if (_config.clientId)     params.set('client_id',     _config.clientId);
        if (_config.clientSecret) params.set('client_secret', _config.clientSecret);
        window.location.href = `${window.location.origin}/oauth/start?${params.toString()}`;
    }

    // Called on page load if ?shopify_session=... present in URL
    function _captureCallback() {
        const params = new URLSearchParams(window.location.search);
        const session = params.get('shopify_session');
        const shop = params.get('shopify_shop');
        if (!session || !shop) return false;

        _config.session = session;
        _config.shop = shop;
        _config.connected = true;
        _saveConfig();

        // Clean URL
        params.delete('shopify_session');
        params.delete('shopify_shop');
        const newSearch = params.toString();
        const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
        window.history.replaceState({}, '', newUrl);

        // Fetch shop info in background
        _fetchShopInfo().catch(() => {});

        if (typeof showToast === 'function') showToast('Shopify conectado com sucesso!', 'success');
        return true;
    }

    async function _fetchShopInfo() {
        try {
            const proxyUrl = (_config?.proxyUrl || DEFAULT_PROXY_URL).replace(/\/$/, '');
            const resp = await fetch(`${proxyUrl}/shop/session`, {
                headers: { 'X-Shop-Session': _config.session },
            });
            const data = await resp.json();
            if (data.ok && data.info) {
                _config.shopName = data.info.name;
                _config.shopCurrency = data.info.currencyCode;
                _config.shopTimezone = data.info.ianaTimezone || null;
                _saveConfig();
            } else if (!data.ok) {
                _config.connected = false;
                _saveConfig();
            }
            return data;
        } catch {
            return null;
        }
    }

    // Return "today" (YYYY-MM-DD) in the SHOP's timezone, not user's local timezone.
    // Critical for accurate "today's sales" when shop and user are in different zones.
    function _todayInShopTz() {
        const tz = _config?.shopTimezone;
        try {
            if (tz) {
                // Intl.DateTimeFormat → YYYY-MM-DD in the target timezone
                const parts = new Intl.DateTimeFormat('en-CA', {
                    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
                }).formatToParts(new Date());
                const y = parts.find(p => p.type === 'year').value;
                const m = parts.find(p => p.type === 'month').value;
                const d = parts.find(p => p.type === 'day').value;
                return `${y}-${m}-${d}`;
            }
        } catch {}
        return new Date().toISOString().slice(0, 10);
    }

    // ── GraphQL request ──

    async function _graphql(query, variables = {}) {
        if (!isConfigured()) throw new Error('Shopify não conectado.');
        const proxyUrl = (_config.proxyUrl || DEFAULT_PROXY_URL).replace(/\/$/, '');

        const resp = await fetch(`${proxyUrl}/shop/graphql`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shop-Session': _config.session,
            },
            body: JSON.stringify({ query, variables }),
        });

        if (resp.status === 401) {
            _config.connected = false;
            _saveConfig();
            throw new Error('Sessão Shopify expirada. Reconecte.');
        }

        const text = await resp.text();
        let data;
        try { data = JSON.parse(text); } catch { throw new Error('Resposta inválida: ' + text.slice(0, 200)); }
        if (data.errors) throw new Error(data.errors.map(e => e.message).join('; '));
        return data.data;
    }

    async function testConnection() {
        const data = await _fetchShopInfo();
        if (!data || !data.ok) throw new Error('Sessão inválida ou expirada.');
        return data;
    }

    async function diagnose() {
        const results = {
            session: { ok: false, scope: null },
            shop: { ok: false, error: null, data: null },
            products: { ok: false, error: null, count: null },
            orders: { ok: false, error: null, count: null },
            ordersCount: { ok: false, error: null, value: null },
        };

        // 1. Session + scope
        try {
            const info = await _fetchShopInfo();
            if (info && info.ok) {
                results.session.ok = true;
                results.session.scope = info.scope;
                results.shop.ok = true;
                results.shop.data = info.info;
            } else {
                results.session.error = info?.error || 'session invalid';
            }
        } catch (e) { results.session.error = e.message; }

        // 2. Shop query — always works
        try {
            const d = await _graphql(`{ shop { name currencyCode } }`);
            results.shop.ok = true;
            results.shop.data = d.shop;
        } catch (e) { results.shop.error = e.message; }

        // 3. Products query — needs read_products
        try {
            const d = await _graphql(`{ products(first: 1) { nodes { id title } } }`);
            results.products.ok = true;
            results.products.count = (d.products?.nodes?.length) || 0;
        } catch (e) { results.products.error = e.message; }

        // 4. Orders count — needs read_orders (lighter, no PCD fields)
        try {
            const d = await _graphql(`{ ordersCount { count } }`);
            results.ordersCount.ok = true;
            results.ordersCount.value = d.ordersCount?.count;
        } catch (e) { results.ordersCount.error = e.message; }

        // 5. Orders list — needs read_orders + Protected Customer Data
        try {
            const d = await _graphql(`{ orders(first: 1) { nodes { id name } } }`);
            results.orders.ok = true;
            results.orders.count = (d.orders?.nodes?.length) || 0;
        } catch (e) { results.orders.error = e.message; }

        return results;
    }

    async function disconnect() {
        try {
            const proxyUrl = (_config.proxyUrl || DEFAULT_PROXY_URL).replace(/\/$/, '');
            if (_config.session) {
                await fetch(`${proxyUrl}/shop/disconnect`, {
                    method: 'POST',
                    headers: { 'X-Shop-Session': _config.session },
                }).catch(() => {});
            }
        } finally {
            _config = _defaultConfig();
            _saveConfig();
            localStorage.removeItem(CACHE_KEY);
        }
    }

    // ── Orders (GraphQL) ──

    async function fetchOrders(dateFrom, dateTo, opts = {}) {
        if (!isConfigured()) throw new Error('Shopify não conectado.');

        const cacheKey = `${dateFrom}|${dateTo}`;
        if (!opts.force) {
            const cached = _getCachedOrders(cacheKey);
            if (cached) return cached;
        }

        // Shopify interprets bare YYYY-MM-DD in the SHOP's timezone, which is what we want.
        // Never use ISO timestamps here — they bypass shop timezone and pin to UTC.
        const queryParts = [];
        if (dateFrom) queryParts.push(`created_at:>=${dateFrom}`);
        if (dateTo)   queryParts.push(`created_at:<=${dateTo}`);
        queryParts.push(`(financial_status:paid OR financial_status:partially_paid OR financial_status:authorized)`);
        const searchQuery = queryParts.join(' AND ');

        const all = [];
        let cursor = null;
        let pages = 0;

        const gql = `
            query Orders($q: String!, $cursor: String) {
              orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  id name createdAt cancelledAt displayFinancialStatus
                  currencyCode
                  totalPriceSet { shopMoney { amount currencyCode } }
                  lineItems(first: 50) {
                    nodes {
                      quantity
                      originalUnitPriceSet { shopMoney { amount currencyCode } }
                      product { id title }
                      variant { id title }
                    }
                  }
                }
              }
            }`;

        do {
            const data = await _graphql(gql, { q: searchQuery, cursor });
            const conn = data.orders;
            for (const node of conn.nodes) {
                if (node.cancelledAt) continue;
                all.push(_normalizeOrder(node));
            }
            cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
            pages++;
            if (pages > 50) break; // safety: max ~5000 orders
        } while (cursor);

        _setCachedOrders(cacheKey, all);
        return all;
    }

    function _normalizeOrder(o) {
        return {
            id: o.id,
            name: o.name,
            created_at: o.createdAt,
            currency: o.currencyCode,
            total_price: o.totalPriceSet?.shopMoney?.amount,
            financial_status: o.displayFinancialStatus,
            line_items: (o.lineItems?.nodes || []).map(li => ({
                product_id: li.product?.id ? _gidToNumeric(li.product.id) : null,
                variant_id: li.variant?.id ? _gidToNumeric(li.variant.id) : null,
                title: li.product?.title,
                quantity: li.quantity,
                price: li.originalUnitPriceSet?.shopMoney?.amount,
            })),
        };
    }

    function _gidToNumeric(gid) {
        // gid://shopify/Product/1234567890 → "1234567890"
        const m = String(gid).match(/\/(\d+)$/);
        return m ? m[1] : String(gid);
    }

    function _getCachedOrders(key) {
        try {
            const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            const entry = cache[key];
            if (!entry) return null;
            if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
            return entry.orders;
        } catch { return null; }
    }

    function _setCachedOrders(key, orders) {
        try {
            const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            cache[key] = { ts: Date.now(), orders };
            const keys = Object.keys(cache);
            if (keys.length > 10) {
                const oldest = keys.sort((a, b) => cache[a].ts - cache[b].ts)[0];
                delete cache[oldest];
            }
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch {}
    }

    // ── Products (GraphQL) ──

    async function fetchShopifyProducts() {
        const all = [];
        let cursor = null;
        let pages = 0;

        // Fetch variants so we can auto-sync local product prices on link.
        // priceRangeV2 is more efficient than listing every variant when we only need min price.
        const gql = `
            query Products($cursor: String) {
              products(first: 100, after: $cursor, sortKey: TITLE) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  id title handle status
                  featuredImage { url }
                  priceRangeV2 {
                    minVariantPrice { amount currencyCode }
                    maxVariantPrice { amount currencyCode }
                  }
                  variants(first: 20) {
                    nodes {
                      id title sku
                      price
                      compareAtPrice
                      availableForSale
                    }
                  }
                }
              }
            }`;

        do {
            const data = await _graphql(gql, { cursor });
            const conn = data.products;
            for (const p of conn.nodes) {
                const variants = (p.variants?.nodes || []).map(v => ({
                    id: _gidToNumeric(v.id),
                    title: v.title,
                    sku: v.sku,
                    price: parseFloat(v.price || '0'),
                    compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
                    availableForSale: !!v.availableForSale,
                }));
                all.push({
                    id: _gidToNumeric(p.id),
                    gid: p.id,
                    title: p.title,
                    handle: p.handle,
                    status: p.status,
                    image: p.featuredImage?.url || null,
                    priceMin: parseFloat(p.priceRangeV2?.minVariantPrice?.amount || '0'),
                    priceMax: parseFloat(p.priceRangeV2?.maxVariantPrice?.amount || '0'),
                    currency: p.priceRangeV2?.minVariantPrice?.currencyCode || _config.shopCurrency || 'BRL',
                    variants,
                });
            }
            cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
            pages++;
            if (pages > 20) break;
        } while (cursor);

        _shopifyProducts = all;
        return _shopifyProducts;
    }

    // Update a single local product's price from the linked Shopify product.
    // Returns true if price was updated.
    function _syncLocalProductPriceFromShopify(localProductId, shopifyProduct) {
        if (typeof AppState === 'undefined') return false;
        const localProducts = AppState.allProducts || AppState.products || [];
        const lp = localProducts.find(p => String(p.id) === String(localProductId));
        if (!lp || !shopifyProduct) return false;

        // Use the smallest available variant price (most common retail price)
        const price = Number(shopifyProduct.priceMin) || 0;
        const currency = shopifyProduct.currency || _config.shopCurrency || 'BRL';
        if (price <= 0) return false;

        const changed = (lp.price !== price) || (lp.priceCurrency !== currency);
        if (!changed) return false;

        lp.price = price;
        lp.priceCurrency = currency;
        lp.shopifyPriceSyncedAt = new Date().toISOString();

        if (typeof LocalStore !== 'undefined') {
            try { LocalStore.save('products', localProducts); } catch {}
        }
        if (typeof EventBus !== 'undefined') {
            try { EventBus.emit('productsChanged'); } catch {}
        }
        return true;
    }

    // Sync prices for ALL currently linked products. Returns count synced.
    async function syncAllLinkedPrices() {
        if (!isConfigured()) throw new Error('Shopify não conectado.');
        if (!_shopifyProducts.length) await fetchShopifyProducts();

        let synced = 0;
        for (const [localId, shopifyId] of Object.entries(_productLinks)) {
            const sp = _shopifyProducts.find(p => String(p.id) === String(shopifyId));
            if (!sp) continue;
            if (_syncLocalProductPriceFromShopify(localId, sp)) synced++;
        }
        return synced;
    }

    function getShopifyProducts() { return [..._shopifyProducts]; }

    // ── Product Linking ──

    function linkProduct(localProductId, shopifyProductId) {
        if (!shopifyProductId) {
            delete _productLinks[localProductId];
            _saveLinks();
            return { linked: false, priceSynced: false };
        }
        _productLinks[localProductId] = shopifyProductId;
        _saveLinks();

        // Auto-sync price from Shopify when linking
        const sp = _shopifyProducts.find(p => String(p.id) === String(shopifyProductId));
        let priceSynced = false;
        if (sp) priceSynced = _syncLocalProductPriceFromShopify(localProductId, sp);
        return { linked: true, priceSynced };
    }

    function getLink(localProductId) { return _productLinks[localProductId] || null; }

    function autoLinkByName() {
        if (!_shopifyProducts.length || typeof AppState === 'undefined') return 0;
        const localProducts = AppState.allProducts || AppState.products || [];
        let linked = 0;
        for (const lp of localProducts) {
            if (_productLinks[lp.id]) continue;
            const lpName = (lp.name || '').toLowerCase().trim();
            if (!lpName) continue;
            const match = _shopifyProducts.find(sp => (sp.title || '').toLowerCase().trim() === lpName);
            if (match) { _productLinks[lp.id] = match.id; linked++; }
        }
        if (linked > 0) _saveLinks();
        return linked;
    }

    // ── Aggregation ──

    function aggregateByProduct(orders) {
        const agg = {};
        for (const order of orders) {
            const currency = order.currency || 'BRL';
            for (const item of (order.line_items || [])) {
                const pid = String(item.product_id || '');
                if (!pid) continue;
                if (!agg[pid]) agg[pid] = { sales: 0, revenue: 0, currency };
                agg[pid].sales += item.quantity || 0;
                agg[pid].revenue += parseFloat(item.price || '0') * (item.quantity || 0);
            }
        }
        return agg;
    }

    // Returns date string (YYYY-MM-DD) in shop timezone for an order ISO timestamp.
    function _orderDateInShopTz(createdAt) {
        if (!createdAt) return null;
        const tz = _config.shopTimezone;
        try {
            if (tz) {
                // Use Intl to get the Y-M-D in the shop's timezone
                const fmt = new Intl.DateTimeFormat('en-CA', {
                    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
                });
                return fmt.format(new Date(createdAt));
            }
        } catch {}
        return String(createdAt).slice(0, 10);
    }

    // Aggregate by shopify product id + date. Keys: "YYYY-MM-DD|shopifyPid".
    function aggregateByProductAndDate(orders) {
        const agg = {};
        for (const order of orders) {
            const date = _orderDateInShopTz(order.created_at);
            if (!date) continue;
            const currency = order.currency || 'BRL';
            for (const item of (order.line_items || [])) {
                const pid = String(item.product_id || '');
                if (!pid) continue;
                const key = `${date}|${pid}`;
                if (!agg[key]) agg[key] = { sales: 0, revenue: 0, currency, date, productId: pid };
                agg[key].sales += item.quantity || 0;
                agg[key].revenue += parseFloat(item.price || '0') * (item.quantity || 0);
            }
        }
        return agg;
    }

    // Aggregate total sales/revenue per date (across all products). Key: "YYYY-MM-DD".
    function aggregateByDate(orders) {
        const agg = {};
        for (const order of orders) {
            const date = _orderDateInShopTz(order.created_at);
            if (!date) continue;
            const currency = order.currency || 'BRL';
            if (!agg[date]) agg[date] = { sales: 0, revenue: 0, currency, orderCount: 0 };
            let orderItems = 0;
            for (const item of (order.line_items || [])) {
                const qty = item.quantity || 0;
                orderItems += qty;
                agg[date].sales += qty;
                agg[date].revenue += parseFloat(item.price || '0') * qty;
            }
            if (orderItems > 0) agg[date].orderCount += 1;
        }
        return agg;
    }

    // Fetch + cache shopify sales map keyed by "date|localProductId" for the given range.
    // Returns: { "YYYY-MM-DD|localProductId": { sales, revenue, currency } }
    async function getRealSalesMapByDate(dateFrom, dateTo) {
        const orders = await fetchOrders(dateFrom, dateTo);
        const perProductDate = aggregateByProductAndDate(orders);
        const result = {};
        const products = (typeof AppState !== 'undefined' ? (AppState.allProducts || AppState.products || []) : []);
        for (const p of products) {
            const sid = getLink(p.id);
            if (!sid) continue;
            for (const key in perProductDate) {
                if (key.endsWith('|' + sid)) {
                    const date = key.split('|')[0];
                    result[`${date}|${p.id}`] = perProductDate[key];
                }
            }
        }
        return result;
    }

    // Per-date totals (all products): { "YYYY-MM-DD": { sales, revenue, currency, orderCount } }
    async function getSalesMapByDate(dateFrom, dateTo) {
        const orders = await fetchOrders(dateFrom, dateTo);
        return aggregateByDate(orders);
    }

    async function getRealSalesForProduct(localProductId, date) {
        const shopifyPid = getLink(localProductId);
        if (!shopifyPid) return null;
        const orders = await fetchOrders(date, date);
        const agg = aggregateByProduct(orders);
        return agg[String(shopifyPid)] || { sales: 0, revenue: 0, currency: _config.shopCurrency || 'BRL' };
    }

    async function getRealSalesMap(dateFrom, dateTo) {
        const orders = await fetchOrders(dateFrom, dateTo);
        const agg = aggregateByProduct(orders);
        const result = {};
        for (const [localId, shopifyId] of Object.entries(_productLinks)) {
            result[localId] = agg[String(shopifyId)] || { sales: 0, revenue: 0, currency: _config.shopCurrency || 'BRL' };
        }
        return result;
    }

    // ── Comparison (Facebook vs Shopify) ──

    // Compare Facebook diary vs Shopify orders for a date RANGE.
    // Returns same shape as compareWithDiary but aggregated across dates.
    // displayCurrency: optional target currency for budget/revenue/CPA values.
    //   Defaults to Shopify store currency; pass e.g. Dashboard's selector to follow user choice.
    async function compareWithDiaryRange(startDate, endDate, displayCurrency) {
        if (!isConfigured()) return [];
        if (typeof AppState === 'undefined') return [];
        const s = startDate || endDate;
        const e = endDate || startDate;
        if (!s || !e) return [];

        const products = AppState.allProducts || AppState.products || [];
        const diaryEntries = (AppState.allDiary || AppState.diary || []).filter(d =>
            d.date >= s && d.date <= e && !d.isCampaign
        );

        const orders = await fetchOrders(s, e);
        const agg = aggregateByProduct(orders);

        const results = [];
        for (const p of products) {
            const shopifyId = getLink(p.id);
            if (!shopifyId) continue;

            const shopifyData = agg[String(shopifyId)] || { sales: 0, revenue: 0 };
            const shopCurrency = shopifyData.currency || _config.shopCurrency || 'BRL';
            const targetCurrency = displayCurrency || shopCurrency;
            const fbEntries = diaryEntries.filter(de => de.productId === p.id);
            if (!fbEntries.length && shopifyData.sales === 0) continue;

            const conv = (v, from) => (typeof convertCurrency === 'function')
                ? convertCurrency(v, from, targetCurrency)
                : v;

            const fbSales = fbEntries.reduce((sum, de) => sum + (Number(de.sales) || 0), 0);
            const budget = fbEntries.reduce((sum, de) => {
                const b = Number(de.budget) || 0;
                const cur = de.budgetCurrency || shopCurrency;
                return sum + conv(b, cur);
            }, 0);
            const shopifyRevenue = conv(Number(shopifyData.revenue) || 0, shopCurrency);
            const shopifySales = shopifyData.sales;
            const fbCPA = fbSales > 0 ? budget / fbSales : null;
            const realCPA = shopifySales > 0 ? budget / shopifySales : null;
            const diff = shopifySales - fbSales;
            const diffPct = fbSales > 0 ? (diff / fbSales) * 100 : (shopifySales > 0 ? 100 : 0);

            results.push({
                productId: p.id, productName: p.name,
                fbSales, shopifySales,
                discrepancy: diff, discrepancyPct: diffPct,
                fbCPA, realCPA, budget,
                shopifyRevenue,
                currency: targetCurrency,
                hasWarning: Math.abs(diffPct) >= 10 || (fbSales > 0 && shopifySales === 0) || (shopifySales > 0 && fbSales === 0),
            });
        }
        return results;
    }

    async function compareWithDiary(date, displayCurrency) {
        if (!isConfigured()) return [];
        if (typeof AppState === 'undefined') return [];

        const products = AppState.allProducts || AppState.products || [];
        const diaryEntries = (AppState.allDiary || AppState.diary || []).filter(e => e.date === date);

        const orders = await fetchOrders(date, date);
        const agg = aggregateByProduct(orders);

        const results = [];
        for (const p of products) {
            const shopifyId = getLink(p.id);
            if (!shopifyId) continue;

            const shopifyData = agg[String(shopifyId)] || { sales: 0, revenue: 0 };
            const shopCurrency = shopifyData.currency || _config.shopCurrency || 'BRL';
            const targetCurrency = displayCurrency || shopCurrency;
            const fbEntry = diaryEntries.find(e => e.productId === p.id);
            if (!fbEntry) continue;

            const conv = (v, from) => (typeof convertCurrency === 'function')
                ? convertCurrency(v, from, targetCurrency)
                : v;

            const fbSales = Number(fbEntry.sales) || 0;
            const rawBudget = Number(fbEntry.budget) || 0;
            const budgetCurrency = fbEntry.budgetCurrency || shopCurrency;
            const budget = conv(rawBudget, budgetCurrency);
            const shopifyRevenue = conv(Number(shopifyData.revenue) || 0, shopCurrency);
            const shopifySales = shopifyData.sales;

            const fbCPA = fbSales > 0 ? budget / fbSales : null;
            const realCPA = shopifySales > 0 ? budget / shopifySales : null;

            const diff = shopifySales - fbSales;
            const diffPct = fbSales > 0 ? (diff / fbSales) * 100 : (shopifySales > 0 ? 100 : 0);

            results.push({
                productId: p.id,
                productName: p.name,
                fbSales, shopifySales,
                discrepancy: diff, discrepancyPct: diffPct,
                fbCPA, realCPA, budget,
                shopifyRevenue,
                currency: targetCurrency,
                hasWarning: Math.abs(diffPct) >= 10 || (fbSales > 0 && shopifySales === 0) || (shopifySales > 0 && fbSales === 0),
            });
        }
        return results;
    }

    // ── UI: Config Modal ──

    function openConfigModal() {
        const existing = document.getElementById('shopify-config-modal');
        if (existing) existing.remove();

        const connected = isConfigured();
        const modal = document.createElement('div');
        modal.id = 'shopify-config-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width:560px">
                <div class="modal-header">
                    <h3><i data-lucide="shopping-bag" style="width:18px;height:18px"></i> Conectar Shopify</h3>
                    <button class="btn-close" id="shopify-config-close">&times;</button>
                </div>
                <div style="padding:1rem;display:flex;flex-direction:column;gap:1rem">

                    ${connected ? `
                        <div class="shopify-connected-info" style="display:flex;align-items:center;gap:0.5rem;padding:0.8rem;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:6px">
                            <i data-lucide="check-circle-2" style="width:18px;height:18px;color:#10b981"></i>
                            <div style="flex:1">
                                <div style="font-weight:600">Conectado: ${_esc(_config.shopName || _config.shop)}</div>
                                <div style="font-size:0.75rem;color:var(--text-muted)">${_esc(_config.shop)}</div>
                            </div>
                        </div>

                        <button id="btn-shopify-refresh-api" class="btn btn-primary" style="width:100%">
                            <i data-lucide="refresh-cw" style="width:14px;height:14px"></i>
                            Atualizar API da Shopify
                        </button>
                        <button id="btn-shopify-diagnose" class="btn btn-secondary" style="width:100%">
                            <i data-lucide="stethoscope" style="width:14px;height:14px"></i>
                            Diagnosticar permissões
                        </button>
                        <div id="shopify-refresh-status" style="font-size:0.8rem;min-height:1.2em"></div>
                        <div id="shopify-diagnose-result" style="font-size:0.75rem"></div>

                        <button id="btn-shopify-reinstall" class="btn btn-secondary" style="width:100%">
                            <i data-lucide="download" style="width:14px;height:14px"></i>
                            Reinstalar app (atualizar escopos/permissões)
                        </button>
                        <button id="btn-shopify-link" class="btn btn-secondary" style="width:100%">
                            <i data-lucide="link" style="width:14px;height:14px"></i> Vincular produtos
                        </button>
                        <button id="btn-shopify-disconnect" class="btn btn-secondary" style="color:var(--red)">
                            Desconectar
                        </button>
                    ` : `
                        <div class="shopify-help">
                            <p style="font-size:0.85rem;margin-bottom:0.5rem"><strong>Conectar via OAuth (Shopify Partners)</strong></p>
                            <p style="font-size:0.75rem;color:var(--text-muted);line-height:1.5">
                                Credenciais do seu app em <strong>Shopify Partners <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> seu app <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> Configurações <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> Credenciais</strong>.
                            </p>
                        </div>

                        <div>
                            <label class="label">Client ID (ID do cliente)</label>
                            <input id="shopify-client-id-input" class="input" placeholder="ex: 45ba71aea473924db288fb2207bd0f33"
                                value="${_esc(_config?.clientId || '')}">
                        </div>

                        <div>
                            <label class="label">Client Secret (Chave secreta)</label>
                            <input id="shopify-client-secret-input" class="input" type="password" placeholder="shpss_..."
                                value="${_esc(_config?.clientSecret || '')}">
                            <p style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem">
                                Guardado local + enviado uma vez para o servidor durante o OAuth.
                            </p>
                        </div>

                        <div>
                            <label class="label">Domínio da loja</label>
                            <input id="shopify-shop-input" class="input" placeholder="sua-loja.myshopify.com"
                                value="${_esc(_config?.shop || '')}">
                            <p style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem">
                                Ex: <code>w9q9iq-64.myshopify.com</code>
                            </p>
                        </div>

                        <details>
                            <summary style="font-size:0.75rem;color:var(--text-muted);cursor:pointer">Avançado: URL do proxy</summary>
                            <input id="shopify-proxy-input" class="input" style="margin-top:0.5rem;font-size:0.75rem"
                                value="${_esc(_config?.proxyUrl || DEFAULT_PROXY_URL)}">
                            <p style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem">
                                Worker Cloudflare que lida com OAuth + GraphQL. Código em <code>workers/shopify-proxy/</code>.
                            </p>
                        </details>

                        <div id="shopify-config-status" style="font-size:0.8rem"></div>

                        <button id="btn-shopify-install" class="btn btn-primary" style="width:100%">
                            <i data-lucide="external-link" style="width:14px;height:14px"></i>
                            Instalar na minha loja
                        </button>
                    `}
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        const close = () => modal.remove();
        document.getElementById('shopify-config-close')?.addEventListener('click', close);
        modal.querySelector('.modal-overlay')?.addEventListener('click', close);

        document.getElementById('btn-shopify-install')?.addEventListener('click', () => {
            const clientId = document.getElementById('shopify-client-id-input').value.trim();
            const clientSecret = document.getElementById('shopify-client-secret-input').value.trim();
            const shop = document.getElementById('shopify-shop-input').value.trim().toLowerCase();
            const proxyUrl = document.getElementById('shopify-proxy-input')?.value.trim() || DEFAULT_PROXY_URL;
            const status = document.getElementById('shopify-config-status');

            if (!clientId || !clientSecret) {
                if (status) status.innerHTML = '<span style="color:var(--red)">Preencha Client ID e Client Secret.</span>';
                return;
            }
            if (!/^[a-f0-9]{32}$/i.test(clientId)) {
                if (status) status.innerHTML = '<span style="color:var(--red)">Client ID inválido (esperado 32 caracteres hex).</span>';
                return;
            }
            if (!clientSecret.startsWith('shpss_')) {
                if (status) status.innerHTML = '<span style="color:var(--red)">Client Secret deve começar com <code>shpss_</code>.</span>';
                return;
            }

            const normalized = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
            if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
                if (status) status.innerHTML = '<span style="color:var(--red)">Domínio inválido. Use o formato <code>sua-loja.myshopify.com</code>.</span>';
                return;
            }

            _config.clientId = clientId;
            _config.clientSecret = clientSecret;
            _config.proxyUrl = proxyUrl;
            _saveConfig();

            if (status) status.innerHTML = '<span style="color:var(--text-muted)">Redirecionando para Shopify...</span>';
            setTimeout(() => beginInstall(normalized), 300);
        });

        document.getElementById('btn-shopify-disconnect')?.addEventListener('click', async () => {
            if (!confirm('Desconectar da Shopify? Seus vínculos de produtos serão mantidos.')) return;
            await disconnect();
            if (typeof showToast === 'function') showToast('Shopify desconectado.', 'info');
            close();
        });

        document.getElementById('btn-shopify-link')?.addEventListener('click', () => {
            close();
            openLinkModal();
        });

        document.getElementById('btn-shopify-refresh-api')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-shopify-refresh-api');
            const status = document.getElementById('shopify-refresh-status');
            if (!btn) return;
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px"></i> Atualizando...';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            if (status) status.innerHTML = '<span style="color:var(--text-muted)">Limpando cache e buscando dados frescos...</span>';

            try {
                // 1. Clear local cache
                localStorage.removeItem(CACHE_KEY);
                _shopifyProducts = [];

                // 2. Re-validate session + refresh shop info
                const sessionInfo = await _fetchShopInfo();
                if (!sessionInfo || !sessionInfo.ok) {
                    throw new Error('Sessão expirada. Clique em "Reinstalar app".');
                }

                // 3. Re-fetch products (tests read_products scope)
                await fetchShopifyProducts();

                // 4. Re-render dashboard widget with fresh data
                await renderDashboardWidget();

                if (status) status.innerHTML = `<span style="color:var(--success)"><i data-lucide="check" style="width:14px;height:14px;vertical-align:-2px"></i> API atualizada. ${_shopifyProducts.length} produtos sincronizados.</span>`;
                if (typeof showToast === 'function') showToast('API da Shopify atualizada.', 'success');
            } catch (err) {
                if (status) status.innerHTML = `<span style="color:var(--red)"><i data-lucide="x" style="width:14px;height:14px;vertical-align:-2px"></i> ${_esc(err.message)}</span>`;
                if (typeof showToast === 'function') showToast('Erro ao atualizar: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        });

        document.getElementById('btn-shopify-reinstall')?.addEventListener('click', () => {
            if (!confirm('Reinstalar o app vai abrir a Shopify para você autorizar novamente os escopos. Continuar?')) return;
            const shop = _config.shop;
            if (!shop) return;
            // Don't call disconnect — we want the KV session to persist until the new one overwrites
            localStorage.removeItem(CACHE_KEY);
            beginInstall(shop);
        });

        document.getElementById('btn-shopify-diagnose')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-shopify-diagnose');
            const out = document.getElementById('shopify-diagnose-result');
            if (!btn || !out) return;
            const originalHtml = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px"></i> Diagnosticando...';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            out.innerHTML = '';

            try {
                const r = await diagnose();
                const row = (label, test, required) => {
                    const icon = test.ok ? '<i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i>' : '<i data-lucide="x-circle" style="width:14px;height:14px;vertical-align:-2px"></i>';
                    const detail = test.ok
                        ? (test.count !== null ? ` <span style="color:var(--text-muted)">(${test.count} resultados)</span>`
                           : test.value !== null ? ` <span style="color:var(--text-muted)">(${test.value})</span>`
                           : '')
                        : ` <span style="color:var(--red)">${_esc(String(test.error || '').slice(0, 120))}</span>`;
                    return `<div style="padding:0.3rem 0;border-bottom:1px solid rgba(128,128,128,0.15)">
                        ${icon} <strong>${label}</strong><br>
                        <span style="color:var(--text-muted);font-size:0.7rem">requer: ${required}</span>${detail}
                    </div>`;
                };

                const scopeStr = r.session.scope || 'desconhecido';
                const hasReadOrders = scopeStr.includes('read_orders');
                const hasReadProducts = scopeStr.includes('read_products');
                const hasReadAllOrders = scopeStr.includes('read_all_orders');

                // Diagnose root cause
                let hint = '';
                if (!r.shop.ok) {
                    hint = `<p style="color:var(--red);padding:0.5rem;background:rgba(239,68,68,0.1);border-radius:4px;margin-top:0.5rem">
                        <i data-lucide="alert-triangle" style="width:14px;height:14px;vertical-align:-2px"></i> Sessão inválida — clique em <strong>Reinstalar app</strong>.
                    </p>`;
                } else if (!hasReadOrders || !hasReadProducts) {
                    hint = `<p style="color:#d97706;padding:0.5rem;background:rgba(217,119,6,0.1);border-radius:4px;margin-top:0.5rem">
                        <i data-lucide="alert-triangle" style="width:14px;height:14px;vertical-align:-2px"></i> <strong>Escopos faltando</strong> no token atual (${_esc(scopeStr)}).<br>
                        No Partners <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> Versões <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> campo "Escopos", coloque: <code>read_orders,read_products,read_all_orders</code><br>
                        <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> Publicar versão <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> Voltar aqui <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> <strong>Reinstalar app</strong>.
                    </p>`;
                } else if (r.products.ok && !r.orders.ok && r.orders.error?.toLowerCase().includes('access denied')) {
                    hint = `<p style="color:#d97706;padding:0.5rem;background:rgba(217,119,6,0.1);border-radius:4px;margin-top:0.5rem">
                        <i data-lucide="alert-triangle" style="width:14px;height:14px;vertical-align:-2px"></i> <strong>Protected Customer Data Access não aprovado</strong>.<br>
                        Você tem o escopo <code>read_orders</code> mas a Shopify bloqueia o campo porque pedidos contêm dados do cliente.<br>
                        <br>
                        <strong>Como resolver no novo dev dashboard:</strong><br>
                        1. Partners <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> seu app <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> na sidebar procure <strong>"Acesso a dados"</strong> ou <strong>"Data access"</strong> (pode estar em uma aba separada, não dentro de Versões)<br>
                        2. Se não encontrar, vá em <strong>Distribuição</strong> <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> algumas opções de dados aparecem só depois de configurar distribuição<br>
                        3. Alternativa: no admin da loja, reinstale o app — na tela de autorização, se aparecer "Este app solicita acesso a dados de clientes", aceite todos<br>
                        4. Para desenvolvimento: pode tentar usar <code>ordersCount</code> em vez de listar pedidos (não precisa PCD)
                    </p>`;
                } else if (r.orders.ok) {
                    hint = `<p style="color:var(--success);padding:0.5rem;background:rgba(16,185,129,0.1);border-radius:4px;margin-top:0.5rem">
                        <i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i> Tudo funcionando! Você pode usar o dashboard normalmente.
                    </p>`;
                }

                out.innerHTML = `
                    <div style="background:rgba(128,128,128,0.08);padding:0.75rem;border-radius:6px;margin-top:0.5rem">
                        <div style="font-weight:600;margin-bottom:0.5rem">Diagnóstico</div>
                        <div style="margin-bottom:0.5rem;font-size:0.7rem;color:var(--text-muted)">
                            Escopos concedidos: <code>${_esc(scopeStr)}</code>
                        </div>
                        ${row('Shop info', r.shop, 'nenhum (sempre funciona)')}
                        ${row('Produtos', r.products, 'read_products')}
                        ${row('Total de pedidos', r.ordersCount, 'read_orders')}
                        ${row('Lista de pedidos', r.orders, 'read_orders + Protected Customer Data')}
                        ${hint}
                    </div>
                `;
            } catch (err) {
                out.innerHTML = `<div style="color:var(--red);padding:0.5rem">Erro: ${_esc(err.message)}</div>`;
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalHtml;
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        });
    }

    // ── UI: Product Link Modal ──

    async function openLinkModal() {
        if (!isConfigured()) { if (typeof showToast === 'function') showToast('Conecte a Shopify primeiro.', 'error'); return; }

        const existing = document.getElementById('shopify-link-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'shopify-link-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width:640px;max-height:85vh;overflow-y:auto">
                <div class="modal-header">
                    <h3><i data-lucide="link" style="width:18px;height:18px"></i> Vincular Produtos</h3>
                    <button class="btn-close" id="shopify-link-close">&times;</button>
                </div>
                <div style="padding:1rem" id="shopify-link-body">
                    <p style="color:var(--text-muted)">Carregando produtos Shopify...</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        const close = () => modal.remove();
        document.getElementById('shopify-link-close')?.addEventListener('click', close);
        modal.querySelector('.modal-overlay')?.addEventListener('click', close);

        try {
            await fetchShopifyProducts();
            _renderLinkModal();
        } catch (err) {
            document.getElementById('shopify-link-body').innerHTML =
                `<p style="color:var(--red)">Erro: ${_esc(err.message)}</p>`;
        }
    }

    function _renderLinkModal() {
        const body = document.getElementById('shopify-link-body');
        if (!body) return;

        const localProducts = (typeof AppState !== 'undefined') ?
            (AppState.allProducts || AppState.products || []) : [];

        if (!localProducts.length) {
            body.innerHTML = '<p style="color:var(--text-muted)">Nenhum produto cadastrado. Cadastre produtos na aba Produtos primeiro.</p>';
            return;
        }

        const fmtPrice = (v, cur) => {
            if (v == null || isNaN(v)) return '—';
            const symbol = cur === 'BRL' ? 'R$' : cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'AUD' ? 'A$' : (cur || '');
            return `${symbol} ${Number(v).toFixed(2)}`;
        };

        let html = `
            <div style="display:flex;gap:0.5rem;margin-bottom:1rem;align-items:center;flex-wrap:wrap">
                <button id="btn-shopify-auto-link" class="btn btn-secondary btn-sm">
                    <i data-lucide="zap" style="width:12px;height:12px"></i> Vincular automaticamente por nome
                </button>
                <button id="btn-shopify-sync-prices" class="btn btn-secondary btn-sm">
                    <i data-lucide="dollar-sign" style="width:12px;height:12px"></i> Atualizar preços da Shopify
                </button>
                <span style="font-size:0.75rem;color:var(--text-muted)">${_shopifyProducts.length} produtos Shopify</span>
            </div>
            <p style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.5rem">
                Ao vincular, o preço local é atualizado automaticamente com o preço da Shopify (BRL/USD/EUR/GBP/AUD).
            </p>
            <div class="shopify-link-list">
        `;

        for (const lp of localProducts) {
            const linkedId = _productLinks[lp.id];
            const linkedProduct = _shopifyProducts.find(sp => String(sp.id) === String(linkedId));
            const localPrice = fmtPrice(lp.price, lp.priceCurrency);
            const shopifyPrice = linkedProduct
                ? (linkedProduct.priceMin === linkedProduct.priceMax
                    ? fmtPrice(linkedProduct.priceMin, linkedProduct.currency)
                    : `${fmtPrice(linkedProduct.priceMin, linkedProduct.currency)}–${fmtPrice(linkedProduct.priceMax, linkedProduct.currency)}`)
                : '';
            const priceMismatch = linkedProduct && Math.abs((lp.price || 0) - linkedProduct.priceMin) > 0.01;

            html += `
                <div class="shopify-link-row">
                    <div class="shopify-link-local">
                        <strong>${_esc(lp.name)}</strong>
                        <span style="font-size:0.7rem;color:var(--text-muted);display:block">Local: ${localPrice}</span>
                    </div>
                    <span class="shopify-link-arrow"><i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i></span>
                    <div style="flex:1;display:flex;flex-direction:column;gap:0.2rem">
                        <select class="input shopify-link-select" data-pid="${lp.id}">
                            <option value="">— Sem vínculo —</option>
                            ${_shopifyProducts.map(sp =>
                                `<option value="${sp.id}" ${String(sp.id) === String(linkedId) ? 'selected' : ''}>${_esc(sp.title)}</option>`
                            ).join('')}
                        </select>
                        ${linkedProduct ? `<span style="font-size:0.7rem;color:${priceMismatch ? '#d97706' : 'var(--text-muted)'}">Shopify: ${shopifyPrice}${priceMismatch ? ' <i data-lucide="alert-triangle" style="width:14px;height:14px;vertical-align:-2px"></i> divergente' : ''}</span>` : ''}
                    </div>
                    ${linkedProduct ? '<span class="shopify-link-ok"><i data-lucide="check" style="width:14px;height:14px;vertical-align:-2px"></i></span>' : ''}
                </div>
            `;
        }

        html += '</div>';
        body.innerHTML = html;
        if (typeof lucide !== 'undefined') lucide.createIcons();

        body.querySelectorAll('.shopify-link-select').forEach(sel => {
            sel.addEventListener('change', (e) => {
                const result = linkProduct(e.target.dataset.pid, e.target.value);
                _renderLinkModal();
                if (typeof showToast === 'function') {
                    if (result.priceSynced) showToast('Vínculo salvo. Preço sincronizado da Shopify.', 'success');
                    else if (result.linked) showToast('Vínculo salvo.', 'success');
                    else showToast('Vínculo removido.', 'info');
                }
            });
        });

        document.getElementById('btn-shopify-auto-link')?.addEventListener('click', () => {
            const count = autoLinkByName();
            // Auto-link updates links without going through linkProduct(), so sync prices afterward
            syncAllLinkedPrices().catch(() => {}).then(synced => {
                if (typeof showToast === 'function') {
                    if (count > 0) {
                        showToast(`${count} produtos vinculados; ${synced} preços sincronizados.`, 'success');
                    } else {
                        showToast('Nenhum match automático.', 'info');
                    }
                }
                if (count > 0) _renderLinkModal();
            });
        });

        document.getElementById('btn-shopify-sync-prices')?.addEventListener('click', async () => {
            const btn = document.getElementById('btn-shopify-sync-prices');
            if (!btn) return;
            const original = btn.innerHTML;
            btn.disabled = true;
            btn.innerHTML = '<i data-lucide="loader" style="width:12px;height:12px"></i> Sincronizando...';
            if (typeof lucide !== 'undefined') lucide.createIcons();
            try {
                const synced = await syncAllLinkedPrices();
                if (typeof showToast === 'function') {
                    showToast(synced > 0 ? `${synced} preços atualizados da Shopify.` : 'Preços já estão em dia.', synced > 0 ? 'success' : 'info');
                }
                _renderLinkModal();
            } catch (e) {
                if (typeof showToast === 'function') showToast('Erro: ' + e.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = original;
                if (typeof lucide !== 'undefined') lucide.createIcons();
            }
        });
    }

    // ── Dashboard Widget ──

    // Read the current dashboard-selected period from the date inputs.
    // Falls back to today in shop's timezone if inputs not found / empty.
    function _getActivePeriod() {
        const startInput = document.getElementById('dash-date-start');
        const endInput = document.getElementById('dash-date-end');
        const s = startInput?.value?.trim();
        const e = endInput?.value?.trim();
        if (s && e) return { start: s, end: e, isToday: false };
        const today = _todayInShopTz();
        return { start: today, end: today, isToday: true };
    }

    async function renderDashboardWidget(explicitStart, explicitEnd) {
        const container = document.getElementById('shopify-widget');
        if (!container) return;

        if (!isConfigured()) {
            container.innerHTML = `
                <div class="shopify-widget-empty">
                    <i data-lucide="shopping-bag" style="width:32px;height:32px;opacity:0.4"></i>
                    <p>Conecte sua Shopify para ver vendas reais e CPA real.</p>
                    <button id="btn-shopify-widget-connect" class="btn btn-primary btn-sm">Conectar Shopify</button>
                </div>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            document.getElementById('btn-shopify-widget-connect')?.addEventListener('click', () => openConfigModal());
            return;
        }

        // Use shop's own timezone for "today" — not user's local or UTC.
        if (!_config.shopTimezone) {
            try { await _fetchShopInfo(); } catch {}
        }

        // Use explicit range if caller passed one, otherwise sync with dashboard period
        const period = (explicitStart && explicitEnd)
            ? { start: explicitStart, end: explicitEnd, isToday: false }
            : _getActivePeriod();
        const today = period.start;
        const isSingleDay = period.start === period.end;
        const isTodayLabel = period.isToday || (period.start === _todayInShopTz() && period.end === _todayInShopTz());
        const rangeLabel = isSingleDay
            ? (isTodayLabel ? `Hoje (${period.start})` : period.start)
            : `${period.start} <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> ${period.end}`;

        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">Carregando dados Shopify...</p>';

        // Follow the dashboard currency selector when available; fall back to shop currency.
        const displayCurrency = (typeof DashboardModule !== 'undefined' && DashboardModule._currency)
            || _config.shopCurrency || 'BRL';

        try {
            // Fetch raw Shopify orders for the active period
            const orders = await fetchOrders(period.start, period.end);
            const shopifyAgg = aggregateByProduct(orders);
            const comparison = isSingleDay
                ? await compareWithDiary(period.start, displayCurrency)
                : await compareWithDiaryRange(period.start, period.end, displayCurrency);

            const totalShopifyOrders = orders.length;
            const totalShopifySalesAll = Object.values(shopifyAgg).reduce((s, a) => s + a.sales, 0);
            const shopCurrencyRaw = orders[0]?.currency || _config.shopCurrency || 'BRL';
            const _convToDisplay = (v, from) => (typeof convertCurrency === 'function')
                ? convertCurrency(v, from, displayCurrency)
                : v;
            const totalShopifyRevenueAll = _convToDisplay(
                Object.values(shopifyAgg).reduce((s, a) => s + a.revenue, 0),
                shopCurrencyRaw
            );

            // When no comparison (= no diary + linked products), show Shopify-only view
            if (!comparison.length) {
                const currency = displayCurrency;
                const fmtMoney = (v) => {
                const symbol = currency === 'BRL' ? 'R$'
                    : currency === 'USD' ? 'US$'
                    : currency === 'EUR' ? '€'
                    : currency === 'GBP' ? '£'
                    : currency === 'AUD' ? 'A$'
                    : currency;
                const n = Number(v);
                if (!isFinite(n)) return `${symbol} 0,00`;
                return `${symbol} ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            };

                // Build product breakdown from Shopify data, showing local product name when linked
                const localProducts = (typeof AppState !== 'undefined') ? (AppState.allProducts || AppState.products || []) : [];
                const reverseLinks = {}; // shopifyId -> localProduct
                for (const [localId, shopifyId] of Object.entries(_productLinks)) {
                    reverseLinks[String(shopifyId)] = localProducts.find(p => String(p.id) === String(localId));
                }

                // Also grab product titles from line items
                const productTitles = {};
                for (const order of orders) {
                    for (const item of (order.line_items || [])) {
                        if (item.product_id) productTitles[String(item.product_id)] = item.title;
                    }
                }

                const rows = Object.entries(shopifyAgg)
                    .sort((a, b) => b[1].revenue - a[1].revenue)
                    .map(([pid, data]) => {
                        const localP = reverseLinks[pid];
                        const name = localP?.name || productTitles[pid] || `Produto #${pid}`;
                        const badge = localP ? '' : '<span class="shopify-tag-unlinked">não vinculado</span>';
                        const rowRevenue = _convToDisplay(data.revenue, data.currency || shopCurrencyRaw);
                        return `
                            <div class="shopify-products-table-row shopify-products-table-row-3col">
                                <span class="shopify-product-name">${_esc(name)}${badge}</span>
                                <span class="shopify-product-num">${data.sales}</span>
                                <span class="shopify-product-num">${fmtMoney(rowRevenue)}</span>
                            </div>
                        `;
                    }).join('');

                container.innerHTML = `
                    <div class="shopify-widget-header">
                        <div>
                            <h4>Shopify — Vendas Reais · ${_esc(rangeLabel)}</h4>
                            <span class="shopify-widget-shop">${_esc(_config.shopName || _config.shop)}${_config.shopTimezone ? ' · ' + _esc(_config.shopTimezone) : ''}</span>
                        </div>
                        <div style="display:flex;gap:0.4rem">
                            <button class="btn btn-secondary btn-sm" id="btn-shopify-refresh">
                                <i data-lucide="refresh-cw" style="width:12px;height:12px"></i>
                            </button>
                            <button class="btn btn-secondary btn-sm" onclick="ShopifyModule.openLinkModal()">Vincular</button>
                        </div>
                    </div>

                    <div class="shopify-widget-summary">
                        <div class="shopify-metric">
                            <span class="shopify-metric-label">Pedidos</span>
                            <span class="shopify-metric-value">${totalShopifyOrders}</span>
                        </div>
                        <div class="shopify-metric">
                            <span class="shopify-metric-label">Itens Vendidos</span>
                            <span class="shopify-metric-value">${totalShopifySalesAll}</span>
                        </div>
                        <div class="shopify-metric">
                            <span class="shopify-metric-label">Receita Real</span>
                            <span class="shopify-metric-value">${fmtMoney(totalShopifyRevenueAll)}</span>
                        </div>
                    </div>

                    ${totalShopifyOrders === 0 ? `
                        <p style="color:var(--text-muted);font-size:0.8rem;padding:1rem;text-align:center">
                            Nenhum pedido na Shopify no período selecionado.
                        </p>
                    ` : `
                        <p style="font-size:0.75rem;color:var(--text-muted);margin:0.5rem 0">
                            Preencha o diário do Facebook e vincule os produtos para ver comparação de CPA.
                        </p>
                        <div class="shopify-products-table">
                            <div class="shopify-products-table-header shopify-products-table-header-3col">
                                <span>Produto</span>
                                <span>Vendas</span>
                                <span>Receita</span>
                            </div>
                            ${rows}
                        </div>
                    `}
                `;

                if (typeof lucide !== 'undefined') lucide.createIcons();
                document.getElementById('btn-shopify-refresh')?.addEventListener('click', async () => {
                    localStorage.removeItem(CACHE_KEY);
                    await renderDashboardWidget();
                    if (typeof showToast === 'function') showToast('Dados Shopify atualizados.', 'success');
                });
                return;
            }

            const totalFb = comparison.reduce((s, c) => s + c.fbSales, 0);
            const totalShopify = comparison.reduce((s, c) => s + c.shopifySales, 0);
            const totalBudget = comparison.reduce((s, c) => s + c.budget, 0);
            const totalRevenue = comparison.reduce((s, c) => s + c.shopifyRevenue, 0);
            const warnings = comparison.filter(c => c.hasWarning);

            const currency = displayCurrency;
            const fmtMoney = (v) => {
                const symbol = currency === 'BRL' ? 'R$'
                    : currency === 'USD' ? 'US$'
                    : currency === 'EUR' ? '€'
                    : currency === 'GBP' ? '£'
                    : currency === 'AUD' ? 'A$'
                    : currency;
                const n = Number(v);
                if (!isFinite(n)) return `${symbol} 0,00`;
                return `${symbol} ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            };
            const realCPA = totalShopify > 0 ? totalBudget / totalShopify : null;
            const fbCPA = totalFb > 0 ? totalBudget / totalFb : null;

            container.innerHTML = `
                <div class="shopify-widget-header">
                    <div>
                        <h4>Shopify — Vendas Reais · ${_esc(rangeLabel)}</h4>
                        <span class="shopify-widget-shop">${_esc(_config.shopName || _config.shop)}${_config.shopTimezone ? ' · ' + _esc(_config.shopTimezone) : ''}</span>
                    </div>
                    <button class="btn btn-secondary btn-sm" id="btn-shopify-refresh">
                        <i data-lucide="refresh-cw" style="width:12px;height:12px"></i>
                    </button>
                </div>

                <div class="shopify-widget-summary">
                    <div class="shopify-metric">
                        <span class="shopify-metric-label">Vendas Shopify</span>
                        <span class="shopify-metric-value">${totalShopify}</span>
                    </div>
                    <div class="shopify-metric">
                        <span class="shopify-metric-label">Vendas Facebook</span>
                        <span class="shopify-metric-value">${totalFb}</span>
                    </div>
                    <div class="shopify-metric">
                        <span class="shopify-metric-label">Receita Real</span>
                        <span class="shopify-metric-value">${fmtMoney(totalRevenue)}</span>
                    </div>
                    <div class="shopify-metric ${realCPA !== null && fbCPA !== null && Math.abs(realCPA - fbCPA) / (fbCPA || 1) > 0.1 ? 'shopify-metric-warn' : ''}">
                        <span class="shopify-metric-label">CPA Real</span>
                        <span class="shopify-metric-value">${realCPA !== null ? fmtMoney(realCPA) : '—'}</span>
                        ${fbCPA !== null && realCPA !== null ? `<span class="shopify-metric-compare">FB: ${fmtMoney(fbCPA)}</span>` : ''}
                    </div>
                </div>

                ${warnings.length ? `
                    <div class="shopify-warnings">
                        <div class="shopify-warnings-header">
                            <i data-lucide="alert-triangle" style="width:14px;height:14px;color:#d97706"></i>
                            <span>${warnings.length} incompatibilidade${warnings.length > 1 ? 's' : ''} detectada${warnings.length > 1 ? 's' : ''}</span>
                        </div>
                        <div class="shopify-warnings-list">
                            ${warnings.map(w => `
                                <div class="shopify-warning-row">
                                    <strong>${_esc(w.productName)}</strong>:
                                    Facebook diz <b>${w.fbSales}</b>, Shopify tem <b>${w.shopifySales}</b>
                                    (${w.discrepancy > 0 ? '+' : ''}${w.discrepancy} / ${w.discrepancyPct >= 0 ? '+' : ''}${w.discrepancyPct.toFixed(0)}%)
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : `
                    <div class="shopify-warnings-ok">
                        <i data-lucide="check-circle-2" style="width:14px;height:14px;color:var(--success)"></i>
                        Facebook e Shopify estão consistentes.
                    </div>
                `}

                <div class="shopify-products-table">
                    <div class="shopify-products-table-header">
                        <span>Produto</span>
                        <span title="Vendas reportadas pelo Facebook">Vendas FB</span>
                        <span title="Vendas reais na Shopify">Vendas Shopify</span>
                        <span title="CPA com base nas vendas reais">CPA Real</span>
                    </div>
                    ${comparison.map(c => `
                        <div class="shopify-products-table-row ${c.hasWarning ? 'shopify-product-warn' : ''}">
                            <span class="shopify-product-name">${_esc(c.productName)}</span>
                            <span class="shopify-product-num">${c.fbSales}</span>
                            <span class="shopify-product-num ${c.shopifySales !== c.fbSales ? 'shopify-product-num-mismatch' : ''}">${c.shopifySales}</span>
                            <span class="shopify-product-num">${c.realCPA !== null ? fmtMoney(c.realCPA) : '—'}</span>
                        </div>
                    `).join('')}
                </div>
            `;

            if (typeof lucide !== 'undefined') lucide.createIcons();

            document.getElementById('btn-shopify-refresh')?.addEventListener('click', async () => {
                localStorage.removeItem(CACHE_KEY);
                await renderDashboardWidget();
                if (typeof showToast === 'function') showToast('Dados Shopify atualizados.', 'success');
            });
        } catch (err) {
            container.innerHTML = `
                <div class="shopify-widget-error">
                    <i data-lucide="alert-circle" style="width:16px;height:16px;color:var(--red)"></i>
                    <span>Erro: ${_esc(err.message)}</span>
                    <div style="display:flex;gap:0.5rem;margin-top:0.5rem;flex-wrap:wrap">
                        <button class="btn btn-primary btn-sm" id="btn-shopify-widget-refresh-api">
                            <i data-lucide="refresh-cw" style="width:12px;height:12px"></i> Atualizar API
                        </button>
                        <button class="btn btn-secondary btn-sm" onclick="ShopifyModule.openConfigModal()">Verificar conexão</button>
                    </div>
                </div>
            `;
            if (typeof lucide !== 'undefined') lucide.createIcons();
            document.getElementById('btn-shopify-widget-refresh-api')?.addEventListener('click', async () => {
                localStorage.removeItem(CACHE_KEY);
                _shopifyProducts = [];
                try {
                    await _fetchShopInfo();
                    await renderDashboardWidget();
                    if (typeof showToast === 'function') showToast('API atualizada.', 'success');
                } catch (e) {
                    if (typeof showToast === 'function') showToast('Falha ao atualizar: ' + e.message, 'error');
                }
            });
        }
    }

    function _esc(str) {
        const el = document.createElement('span');
        el.textContent = str || '';
        return el.innerHTML;
    }

    // ── Init ──

    function init() {
        _loadConfig();
        const captured = _captureCallback();

        document.getElementById('btn-shopify-config')?.addEventListener('click', () => openConfigModal());

        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (tab) => {
                if (tab === 'dashboard') setTimeout(() => renderDashboardWidget(), 100);
            });
            EventBus.on('dataLoaded', () => renderDashboardWidget());
        }

        setTimeout(() => renderDashboardWidget(), 500);
    }

    return {
        init, getConfig, isConfigured,
        beginInstall, testConnection, disconnect, diagnose,
        fetchOrders, fetchShopifyProducts, getShopifyProducts,
        linkProduct, getLink, autoLinkByName, syncAllLinkedPrices,
        aggregateByProduct, aggregateByProductAndDate, aggregateByDate,
        getRealSalesForProduct, getRealSalesMap,
        getRealSalesMapByDate, getSalesMapByDate,
        compareWithDiary, compareWithDiaryRange,
        openConfigModal, openLinkModal, renderDashboardWidget,
    };
})();
