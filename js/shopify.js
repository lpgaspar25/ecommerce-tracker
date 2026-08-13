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

    // Escopos que o app pede na conexão. Passados na URL do /oauth/start
    // porque o parâmetro tem prioridade sobre a env SCOPES do servidor — é a
    // única forma de garantir a lista certa sem mexer em variável de ambiente.
    //  reads: pedidos/produtos/idiomas/traduções/temas (só leitura, pro
    //  seletor de tema/template do Agente de Loja) · writes: produtos
    //  (imagem), arquivos, traduções, idiomas.
    //  read_reports: exigido pelo campo shopifyqlQuery da Admin API — é o que
    //  alimenta VISITAS (denominador da Conversão Real) e o funil da loja.
    //  Sem ele a query é recusada na autorização. Ficou anos despercebido
    //  porque o app pedia um campo inexistente (`rowData`) e a query morria
    //  na VALIDAÇÃO do documento, antes de o escopo chegar a ser testado.
    //  ATENÇÃO: esta é a lista que vale de verdade — beginInstall manda
    //  ?scopes= na URL e tanto a Pages Function quanto o Worker fazem
    //  `searchParams.get('scopes') || env.SCOPES`, ou seja o query param
    //  SEMPRE ganha de wrangler.toml/env. Mexer só no worker não muda nada.
    const OAUTH_SCOPES = 'read_orders,read_products,read_all_orders,write_products,write_files,read_inventory,write_inventory,read_locations,read_translations,write_translations,read_locales,write_locales,read_themes,read_reports';

    let _config = null;
    let _productLinks = {};
    let _shopifyProducts = [];

    function _defaultConfig() {
        return {
            shop: '', session: '', proxyUrl: DEFAULT_PROXY_URL, connected: false,
            clientId: '', clientSecret: '',
        };
    }

    // Conexão da Shopify é SEPARADA POR LOJA (cada loja tem seu próprio token,
    // domínio e vínculos de produto). storeId lido DIRETO do localStorage, não
    // de AppState — porque ShopifyModule.init() roda antes de ensureStoreSetup
    // popular AppState. '__ALL__' ou vazio caem na 1ª loja salva (não existe
    // uma conexão única pra "todas as lojas").
    function _lojaAtualId() {
        let sid = '';
        try { sid = localStorage.getItem('currentStoreId') || ''; } catch {}
        if (!sid || sid === '__ALL__') {
            try { sid = (JSON.parse(localStorage.getItem('etracker_stores') || '[]')[0] || {}).id || ''; } catch {}
        }
        return sid || '_default';
    }
    function _configKey() { return CONFIG_KEY + '__' + _lojaAtualId(); }
    function _linksKey() { return LINKS_KEY + '__' + _lojaAtualId(); }

    // Migração idempotente: a config GLOBAL antiga (chave sem sufixo de loja,
    // de antes deste recurso) é adotada pela loja ativa, pra quem já estava
    // conectado NÃO perder o token de sessão. Copia primeiro, só então apaga
    // a global — se algo falhar no meio, a global continua lá.
    function _migrarConfigGlobalLegada() {
        try {
            const cfgLegada = localStorage.getItem(CONFIG_KEY);   // chave exata, sem '__'
            if (cfgLegada && !localStorage.getItem(_configKey())) localStorage.setItem(_configKey(), cfgLegada);
            if (cfgLegada && localStorage.getItem(_configKey())) localStorage.removeItem(CONFIG_KEY);
            const linksLegado = localStorage.getItem(LINKS_KEY);
            if (linksLegado && !localStorage.getItem(_linksKey())) localStorage.setItem(_linksKey(), linksLegado);
            if (linksLegado && localStorage.getItem(_linksKey())) localStorage.removeItem(LINKS_KEY);
        } catch {}
    }

    function _loadConfig() {
        _migrarConfigGlobalLegada();
        try {
            _config = JSON.parse(localStorage.getItem(_configKey())) || _defaultConfig();
            _productLinks = JSON.parse(localStorage.getItem(_linksKey())) || {};
        } catch {
            _config = _defaultConfig();
            _productLinks = {};
        }
        // Ensure proxyUrl set
        if (!_config.proxyUrl) _config.proxyUrl = DEFAULT_PROXY_URL;
    }

    function _saveConfig() {
        const write = () => localStorage.setItem(_configKey(), JSON.stringify(_config));
        if (typeof StorageManager !== 'undefined' && StorageManager.withReclaim) {
            if (!StorageManager.withReclaim(write, 'shopify_config')) {
                throw new Error('Armazenamento cheio — libere espaço (Diário/testes antigos) e tente de novo.');
            }
        } else { write(); }
    }
    function _saveLinks() {
        const write = () => localStorage.setItem(_linksKey(), JSON.stringify(_productLinks));
        if (typeof StorageManager !== 'undefined' && StorageManager.withReclaim) {
            StorageManager.withReclaim(write, 'shopify_links');
        } else { write(); }
    }

    // Chamado ao TROCAR de loja: recarrega a conexão da nova loja e joga fora
    // o estado/caches em memória da anterior (senão _shopifyProducts,
    // _productLinks e os pedidos em cache ficariam da loja errada).
    function reloadConfig() {
        _loadConfig();
        _shopifyProducts = [];
        // Caches de pedidos são globais (keyed por período/dia, sem loja);
        // limpar ao trocar de loja evita servir pedidos da loja anterior. São
        // regeneráveis, TTL curto — descartar é seguro.
        try { localStorage.removeItem(CACHE_KEY); } catch {}
        try { if (typeof KVStore !== 'undefined') KVStore.del('etracker_shopify_orders_day_cache'); } catch {}
        try { renderDashboardWidget(); } catch {}
    }

    function getConfig() { return { ..._config }; }
    function isConfigured() { return !!(_config && _config.session && _config.shop && _config.connected); }

    // ── OAuth flow ──

    function beginInstall(shop) {
        // OAuth start is hosted on the same origin as the app (Pages Functions)
        // so that redirect_uri host matches the App URL configured in Shopify Partners.
        const returnUrl = window.location.origin + window.location.pathname;
        const params = new URLSearchParams({ shop, return: returnUrl });
        // Passa os escopos explicitamente — tem prioridade sobre a env SCOPES
        // do servidor (que estava presa em só-leitura e ignorava o código).
        params.set('scopes', OAUTH_SCOPES);
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

    // Bump this when changing the order shape (cached payloads with old shape get invalidated).
    const ORDERS_CACHE_VERSION = 'v4'; // v4: line_items ganharam discounted_price
    const DAY_CACHE_KEY = 'etracker_shopify_orders_day_cache';
    // Per-day TTL based on age:
    //   - today:        5 min  (data still changing)
    //   - yesterday:    6 h    (late refunds/captures)
    //   - 2-6 days ago: 7 days
    //   - 7+ days ago:  never expires (until version bump)
    const DAY_TTL_TODAY     = 5 * 60 * 1000;
    const DAY_TTL_YESTERDAY = 6 * 60 * 60 * 1000;
    const DAY_TTL_RECENT    = 7 * 24 * 60 * 60 * 1000;
    const DAY_TTL_OLD       = Infinity;
    // Dia antigo com ZERO pedidos em cache: se a primeira busca falhou em
    // silêncio (rede, rate limit) o dia fica com [] e TTL Infinity o
    // condenaria a zero para sempre. Com 3 dias, uma falha se autocorrige
    // sozinha em vez de exigir intervenção manual.
    const DAY_TTL_OLD_EMPTY = 3 * 24 * 60 * 60 * 1000;

    // Cache por dia (até 365 entradas, cada uma com os pedidos daquele dia)
    // vive no IndexedDB via KVStore — é o que mais engordava o localStorage,
    // já que é alimentado toda vez que algo pede vendas por período (Diário,
    // Diagnóstico, resultado Shopify do Laboratório etc.).
    async function _loadDayCache() {
        try {
            let parsed = (typeof KVStore !== 'undefined') ? await KVStore.get(DAY_CACHE_KEY) : null;
            if (parsed === null) parsed = await _migrarDayCacheDeLocalStorage();
            if (!parsed || parsed.__v !== ORDERS_CACHE_VERSION) return {}; // sem dado ou versão mudou → reset
            return parsed.days || {};
        } catch { return {}; }
    }
    // Migração única do dado antigo em localStorage pro IndexedDB.
    async function _migrarDayCacheDeLocalStorage() {
        let parsed = null;
        try {
            const raw = localStorage.getItem(DAY_CACHE_KEY);
            if (raw) {
                parsed = JSON.parse(raw);
                if (typeof KVStore !== 'undefined') await KVStore.set(DAY_CACHE_KEY, parsed);
            }
        } catch (e) { console.warn('[Shopify] migração do day cache falhou:', e); }
        try { localStorage.removeItem(DAY_CACHE_KEY); } catch {}
        return parsed;
    }
    async function _saveDayCache(days) {
        try {
            // Race-condition safe: merge with the latest on-disk cache so concurrent
            // fetchOrders calls don't overwrite each other's days.
            const onDisk = await _loadDayCache();
            const merged = { ...onDisk, ...days };
            // For overlapping keys, keep whichever has the most recent ts (i.e., freshest data wins)
            for (const k of Object.keys(days)) {
                const a = onDisk[k], b = days[k];
                if (a && b && a.ts > b.ts) merged[k] = a;
            }
            const keys = Object.keys(merged).sort();
            while (keys.length > 365) {
                const k = keys.shift();
                delete merged[k];
            }
            await KVStore.set(DAY_CACHE_KEY, { __v: ORDERS_CACHE_VERSION, days: merged });
        } catch (e) { console.warn('[Shopify] day cache save failed:', e); }
    }
    function _ttlForDay(dateStr, cacheEntry) {
        // "Hoje" em data LOCAL — toISOString() é UTC e perto da virada da
        // noite (em fusos atrás de UTC, como o Brasil) já aponta pro dia
        // seguinte, classificando "hoje" com o TTL de um dia mais antigo.
        const agora = new Date();
        const today = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}-${String(agora.getDate()).padStart(2, '0')}`;
        if (dateStr === today) return DAY_TTL_TODAY;
        const t = new Date(today + 'T00:00:00');
        const d = new Date(dateStr + 'T00:00:00');
        const ageDays = Math.round((t - d) / 86400000);
        if (ageDays <= 1) return DAY_TTL_YESTERDAY;
        if (ageDays <= 6) return DAY_TTL_RECENT;
        // Dia "velho" sem nenhum pedido: pode ser zero de verdade, ou pode
        // ser uma busca que falhou e ficou presa em [] com TTL Infinity —
        // aqui não dá para diferenciar os dois, então tratamos como
        // suspeito e revalida de tempos em tempos.
        if (cacheEntry && Array.isArray(cacheEntry.orders) && cacheEntry.orders.length === 0) return DAY_TTL_OLD_EMPTY;
        return DAY_TTL_OLD;
    }
    function _eachDayInRange(from, to) {
        const out = [];
        if (!from || !to) return out;
        const start = new Date(from + 'T00:00:00');   // meia-noite LOCAL
        const end = new Date(to + 'T00:00:00');
        // Formatar em LOCAL, não com toISOString (que é UTC). Misturar os dois
        // deslocava todo o intervalo em -1 dia em qualquer fuso a leste de
        // Greenwich: pedir 01/08–31/08 em Londres buscava 31/07–30/08.
        const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            out.push(iso(d));
        }
        return out;
    }

    // Fetches a single day from Shopify (no cache check).
    async function _fetchOrdersForDay(dateStr) {
        const searchQuery = `created_at:>=${dateStr} AND created_at:<=${dateStr} AND (financial_status:paid OR financial_status:partially_paid OR financial_status:authorized)`;
        const gql = `
            query Orders($q: String!, $cursor: String) {
              orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  id name createdAt cancelledAt displayFinancialStatus
                  currencyCode
                  totalPriceSet { shopMoney { amount currencyCode } }
                  shippingAddress {
                    country countryCodeV2
                    province provinceCode
                    city zip
                    latitude longitude
                  }
                  customer { id displayName email }
                  lineItems(first: 50) {
                    nodes {
                      quantity
                      originalUnitPriceSet { shopMoney { amount currencyCode } }
                      discountedUnitPriceSet { shopMoney { amount currencyCode } }
                      product { id title }
                      variant { id title }
                    }
                  }
                }
              }
            }`;
        const all = [];
        let cursor = null;
        let pages = 0;
        do {
            const data = await _graphql(gql, { q: searchQuery, cursor });
            const conn = data.orders;
            for (const node of conn.nodes) {
                if (node.cancelledAt) continue;
                all.push(_normalizeOrder(node));
            }
            cursor = conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null;
            pages++;
            if (pages > 50) break;
        } while (cursor);
        return all;
    }

    async function fetchOrders(dateFrom, dateTo, opts = {}) {
        if (!isConfigured()) throw new Error('Shopify não conectado.');
        if (!dateFrom || !dateTo) return [];

        const days = _eachDayInRange(dateFrom, dateTo);
        const cache = await _loadDayCache();
        const now = Date.now();

        // Identify which days need fetching (missing OR expired by TTL)
        const toFetch = [];
        const cachedDays = {};
        for (const day of days) {
            const entry = cache[day];
            const ttl = _ttlForDay(day, entry);
            const fresh = entry && (now - entry.ts) < ttl;
            if (!opts.force && fresh) {
                cachedDays[day] = entry.orders || [];
            } else {
                toFetch.push(day);
            }
        }

        // Fetch missing/stale days (sequential to avoid rate limits; parallel max 3)
        const fetched = {};
        const CONCURRENCY = 3;
        for (let i = 0; i < toFetch.length; i += CONCURRENCY) {
            const batch = toFetch.slice(i, i + CONCURRENCY);
            const results = await Promise.all(batch.map(async (day) => {
                try {
                    const orders = await _fetchOrdersForDay(day);
                    return { day, orders };
                } catch (e) {
                    console.warn('[Shopify] fetch failed for', day, e);
                    // On failure, fall back to cached if available (stale)
                    return { day, orders: cache[day]?.orders || [], failed: true };
                }
            }));
            for (const r of results) {
                fetched[r.day] = r.orders;
                if (!r.failed) {
                    cache[r.day] = { ts: now, orders: r.orders };
                }
            }
        }
        if (toFetch.length) await _saveDayCache(cache);

        // Combine all days in chronological order
        const all = [];
        for (const day of days) {
            const dayOrders = cachedDays[day] || fetched[day] || [];
            all.push(...dayOrders);
        }
        // Sort by created_at desc (most recent first) — Shopify default
        all.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

        // Legacy: still write to range cache so any old code path that reads it gets something
        try {
            const cacheKey = `${ORDERS_CACHE_VERSION}|${dateFrom}|${dateTo}`;
            _setCachedOrders(cacheKey, all);
        } catch {}

        return all;
    }

    // (Legacy range-fetch removed — fetchOrders now uses per-day cache)

    function _normalizeOrder(o) {
        const sa = o.shippingAddress || null;
        return {
            id: o.id,
            name: o.name,
            created_at: o.createdAt,
            currency: o.currencyCode,
            total_price: o.totalPriceSet?.shopMoney?.amount,
            financial_status: o.displayFinancialStatus,
            customer: o.customer ? {
                id: o.customer.id ? _gidToNumeric(o.customer.id) : null,
                name: o.customer.displayName || '',
                email: o.customer.email || '',
            } : null,
            shipping_address: sa ? {
                country: sa.country || '',
                country_code: sa.countryCodeV2 || '',
                province: sa.province || '',
                province_code: sa.provinceCode || '',
                city: sa.city || '',
                zip: sa.zip || '',
                latitude: sa.latitude ?? null,
                longitude: sa.longitude ?? null,
            } : null,
            line_items: (o.lineItems?.nodes || []).map(li => ({
                product_id: li.product?.id ? _gidToNumeric(li.product.id) : null,
                variant_id: li.variant?.id ? _gidToNumeric(li.variant.id) : null,
                title: li.product?.title,
                quantity: li.quantity,
                price: li.originalUnitPriceSet?.shopMoney?.amount,
                // Preço realmente cobrado (desconto de linha aplicado). Sem isto,
                // "50% na segunda unidade" contaria receita pelo preço cheio.
                discounted_price: li.discountedUnitPriceSet?.shopMoney?.amount
                    ?? li.originalUnitPriceSet?.shopMoney?.amount,
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

    // ── Product views / sessions via ShopifyQL (requires read_reports scope) ──
    // Returns { byShopifyProductId: { <pid>: views }, byLocalProductId: { <localId>: views }, total }
    // Throws a friendly error if scope/ShopifyQL unavailable.
    let _viewsCache = {}; // key: "from|to" -> result
    async function fetchProductViews(dateFrom, dateTo) {
        if (!isConfigured()) throw new Error('Shopify não conectado.');
        if (!dateFrom || !dateTo) throw new Error('Período inválido.');
        const cacheKey = `${dateFrom}|${dateTo}`;
        if (_viewsCache[cacheKey]) return _viewsCache[cacheKey];

        // ShopifyQL: sessões/visualizações agrupadas por produto.
        // Datasets variam por versão da API; tentamos algumas formas em ordem.
        // Mesma correção de sintaxe de fetchProductViewsByDate: dataset é
        // `sessions` (não existe `FROM products`) e as colunas de produto
        // podem simplesmente não existir nesta loja.
        const queries = [
            `FROM sessions SHOW product_views GROUP BY product_id, product_title SINCE ${dateFrom} UNTIL ${dateTo} ORDER BY product_views DESC LIMIT 250`,
            `FROM sessions SHOW product_views GROUP BY product_title SINCE ${dateFrom} UNTIL ${dateTo} ORDER BY product_views DESC LIMIT 250`,
            `FROM sessions SHOW sessions GROUP BY product_title SINCE ${dateFrom} UNTIL ${dateTo} ORDER BY sessions DESC LIMIT 250`,
        ];

        let lastErr = null;
        for (const q of queries) {
            try {
                const table = await _shopifyql(q);
                if (!table) continue;

                // Identify column indices
                const cols = (table.columns || []).map(c => (c.name || '').toLowerCase());
                const pidIdx = cols.findIndex(c => c.includes('product_id'));
                const titleIdx = cols.findIndex(c => c.includes('product_title') || c.includes('title'));
                // views metric = the column that isn't product_id/title
                const viewIdx = cols.findIndex((c, i) => i !== pidIdx && i !== titleIdx);

                const byShopifyProductId = {};
                const byTitle = {};
                let total = 0;
                for (const row of table.rows) {
                    const pid = pidIdx >= 0 ? String(row[pidIdx] || '').replace(/\D/g, '') : '';
                    const title = titleIdx >= 0 ? String(row[titleIdx] || '') : '';
                    const views = parseInt(String(row[viewIdx] ?? '0').replace(/\D/g, ''), 10) || 0;
                    if (pid) byShopifyProductId[pid] = (byShopifyProductId[pid] || 0) + views;
                    if (title) byTitle[title] = (byTitle[title] || 0) + views;
                    total += views;
                }

                // Map to local product IDs via existing links
                const byLocalProductId = {};
                if (typeof AppState !== 'undefined') {
                    const localProducts = AppState.allProducts || AppState.products || [];
                    for (const lp of localProducts) {
                        const sid = getLink(lp.id);
                        if (sid && byShopifyProductId[String(sid)] != null) {
                            byLocalProductId[lp.id] = byShopifyProductId[String(sid)];
                        }
                    }
                }

                const result = { byShopifyProductId, byTitle, byLocalProductId, total };
                _viewsCache[cacheKey] = result;
                return result;
            } catch (e) {
                lastErr = e;
                const msg = (e.message || '').toLowerCase();
                // Scope missing → actionable message
                if (msg.includes('access denied') || msg.includes('read_reports') || msg.includes('not approved')) {
                    throw new Error('Visualizações indisponíveis: falta o escopo read_reports (Analytics) no app Shopify. Adicione e reconecte.');
                }
                // otherwise keep trying next query form
            }
        }
        // Surface the RAW error so we can see exactly which field/dataset is wrong
        throw lastErr || new Error('ShopifyQL não retornou dados de visualizações.');
    }

    // Per-day product views via ShopifyQL.
    // Returns { "YYYY-MM-DD|shopifyProductId": views }.  Empty object if unavailable.
    let _viewsByDateCache = {};
    async function fetchProductViewsByDate(dateFrom, dateTo) {
        if (!isConfigured()) throw new Error('Shopify não conectado.');
        if (!dateFrom || !dateTo) return {};
        const cacheKey = `${dateFrom}|${dateTo}`;
        if (_viewsByDateCache[cacheKey]) return _viewsByDateCache[cacheKey];

        // CAMINHO PRINCIPAL: sessões por página de ENTRADA (landing_page_path).
        // As colunas de produto (product_views/product_title/product_id) não
        // existem no dataset `sessions` desta loja — nem a query de exemplo da
        // doc oficial passa. Já landing_page_path existe e traz /products/
        // <handle>, que casa com o handle do produto.
        //
        // Semântica honesta: isto é "sessões que ENTRARAM pela página do
        // produto", não "todas as visualizações do produto" — quem entra pela
        // home e navega até o produto não é contado. Pra tráfego pago (o caso
        // deste app) a landing page É o anúncio, então cobre bem; mas o número
        // é um piso, não o total.
        try {
            const porEntrada = await _viewsPorLandingPage(dateFrom, dateTo);
            if (porEntrada && Object.keys(porEntrada).length) {
                _viewsByDateCache[cacheKey] = porEntrada;
                return porEntrada;
            }
        } catch (e) {
            console.warn('[Shopify] visitas por landing page falharam:', e.message);
        }

        // Fallback: lojas/planos onde as colunas de produto existem de fato.
        const queries = [
            `FROM sessions SHOW product_views GROUP BY product_id, product_title TIMESERIES day SINCE ${dateFrom} UNTIL ${dateTo} LIMIT 2000`,
            `FROM sessions SHOW product_views GROUP BY product_title TIMESERIES day SINCE ${dateFrom} UNTIL ${dateTo} LIMIT 2000`,
            `FROM sessions SHOW sessions GROUP BY product_title TIMESERIES day SINCE ${dateFrom} UNTIL ${dateTo} LIMIT 2000`,
        ];

        let lastErr = null;
        for (const q of queries) {
            try {
                const table = await _shopifyql(q);
                if (!table) continue;
                const cols = (table.columns || []).map(c => (c.name || '').toLowerCase());
                const dayIdx = cols.findIndex(c => c === 'day' || c.includes('date') || c.includes('dia'));
                const pidIdx = cols.findIndex(c => c.includes('product_id'));
                const titleIdx = cols.findIndex(c => c.includes('product_title') || c.includes('title'));
                const viewIdx = cols.findIndex((c, i) => i !== dayIdx && i !== pidIdx && i !== titleIdx);
                if (dayIdx < 0 || viewIdx < 0 || (pidIdx < 0 && titleIdx < 0)) continue;

                // Sem product_id, casa por TÍTULO — resolve pro id numérico da
                // Shopify usando o catálogo já em cache, pra a chave sair no
                // mesmo formato "dia|idShopify" que o resto do app espera.
                const idPorTitulo = {};
                if (pidIdx < 0 && titleIdx >= 0) {
                    (getShopifyProducts() || []).forEach(p => {
                        if (p.title) idPorTitulo[String(p.title).trim().toLowerCase()] = String(p.id);
                    });
                }
                const out = {};
                for (const row of table.rows) {
                    const day = String(row[dayIdx] || '').slice(0, 10);
                    const pid = pidIdx >= 0
                        ? String(row[pidIdx] || '').replace(/\D/g, '')
                        : (idPorTitulo[String(row[titleIdx] || '').trim().toLowerCase()] || '');
                    const views = parseInt(String(row[viewIdx] ?? '0').replace(/\D/g, ''), 10) || 0;
                    if (day && pid) out[`${day}|${pid}`] = (out[`${day}|${pid}`] || 0) + views;
                }
                if (!Object.keys(out).length) continue;   // veio tabela, mas nada casou
                _viewsByDateCache[cacheKey] = out;
                return out;
            } catch (e) {
                lastErr = e;
                const msg = (e.message || '').toLowerCase();
                if (msg.includes('access denied') || msg.includes('read_reports') || msg.includes('not approved')) {
                    throw new Error('Visitas indisponíveis: falta o escopo read_reports — reconecte a loja em Configurações → Integrações depois de atualizar os escopos.');
                }
                // senão, tenta a próxima forma de query
            }
        }
        throw new Error('Esta loja não expõe visitas POR PRODUTO no ShopifyQL'
            + (lastErr ? ` (${String(lastErr.message).slice(0, 120)})` : '')
            + '. As visitas totais da loja continuam disponíveis.');
    }

    // Normaliza uma landing page pro handle do produto.
    // Trata os 4 formatos reais que aparecem nos dados desta loja:
    //   /products/gt-line-sunglasses          → gt-line-sunglasses
    //   /products/gt-line-sunglasses/         → (barra final)
    //   /de/products/mb-amg-line-brille-3     → (prefixo de idioma)
    //   /products/ry-bn%C2%AE-ferrari-...     → (percent-encoding)
    function _handleDaLandingPage(path) {
        let p = String(path || '').split('?')[0].trim();
        try { p = decodeURIComponent(p); } catch {}
        p = p.replace(/^\/[a-z]{2}(-[a-z]{2})?\//i, '/');   // /de/... , /pt-br/...
        const m = p.match(/^\/products\/([^/]+)\/?$/i);
        return m ? m[1].toLowerCase() : '';
    }

    async function _viewsPorLandingPage(dateFrom, dateTo) {
        const q = `FROM sessions SHOW sessions GROUP BY landing_page_path TIMESERIES day SINCE ${dateFrom} UNTIL ${dateTo} LIMIT 5000`;
        const table = await _shopifyql(q);
        if (!table) return null;
        const cols = (table.columns || []).map(c => (c.name || '').toLowerCase());
        const iDia = cols.indexOf('day');
        const iPath = cols.indexOf('landing_page_path');
        const iSess = cols.indexOf('sessions');
        if (iDia < 0 || iPath < 0 || iSess < 0) return null;

        // handle → id numérico da Shopify (a chave que o resto do app usa).
        // O catálogo pode ainda não ter sido buscado nesta sessão — sem ele
        // NADA casaria e a conversão real cairia em "sem dados" por um motivo
        // que não tem nada a ver com a API.
        let catalogo = getShopifyProducts() || [];
        if (!catalogo.length) {
            try { catalogo = await fetchShopifyProducts(); } catch (e) { console.warn('[Shopify] catálogo indisponível pro casamento por handle:', e.message); }
        }
        const idPorHandle = {};
        (catalogo || []).forEach(p => {
            if (p.handle) idPorHandle[String(p.handle).toLowerCase()] = String(p.id);
        });
        if (!Object.keys(idPorHandle).length) return null;

        const out = {};
        let casadas = 0, orfas = 0;
        const handlesOrfaos = new Set();
        for (const row of table.rows) {
            const handle = _handleDaLandingPage(row[iPath]);
            if (!handle) continue;   // não é página de produto
            const sess = parseInt(String(row[iSess] ?? '0').replace(/\D/g, ''), 10) || 0;
            const pid = idPorHandle[handle];
            // Handle traduzido (ex.: /de/products/...-sonnenbrille) não casa com
            // o handle do idioma primário — essas sessões ficam de fora em vez
            // de serem chutadas pro produto errado.
            if (!pid) { orfas += sess; if (handlesOrfaos.size < 8) handlesOrfaos.add(handle); continue; }
            const dia = String(row[iDia] || '').slice(0, 10);
            if (dia && sess) { out[`${dia}|${pid}`] = (out[`${dia}|${pid}`] || 0) + sess; casadas += sess; }
        }
        // Descartar sessão órfã evita atribuir ao produto errado, mas encolhe o
        // DENOMINADOR — ou seja, infla a conversão. Guarda a cobertura pra UI
        // poder avisar em vez de mostrar um número otimista em silêncio.
        _coberturaViews = {
            casadas, orfas,
            pct: (casadas + orfas) > 0 ? (casadas / (casadas + orfas)) * 100 : 100,
            exemplos: [...handlesOrfaos],
        };
        return out;
    }

    let _coberturaViews = null;
    function getCoberturaViews() { return _coberturaViews; }

    // Código ISO ('DE') → nomes que o ShopifyQL usa em session_country
    // ('Germany'). session_country vem por NOME, não código, então convertemos
    // o alvo via Intl.DisplayNames (nomes em inglês = os que a Shopify usa) +
    // alguns overrides pra tags que não são ISO exato (UK→GB).
    function _paisCodigoParaNomes(code) {
        const c = String(code || '').toUpperCase();
        const nomes = new Set();
        const overrides = { UK: 'United Kingdom', GB: 'United Kingdom', US: 'United States', UAE: 'United Arab Emirates' };
        if (overrides[c]) nomes.add(overrides[c]);
        try {
            const dn = new Intl.DisplayNames(['en'], { type: 'region' });
            const n = dn.of(c);
            if (n && n.toUpperCase() !== c) nomes.add(n);
        } catch {}
        return [...nomes].map(n => n.toLowerCase());
    }

    // Visitas por PAÍS por produto por dia — o denominador que faltava pra
    // Conversão Real por país. Mesmo casamento landing_page → handle → id da
    // _viewsPorLandingPage, mas quebrado por session_country. Confirmado que o
    // ShopifyQL desta loja aceita cruzar session_country + landing_page_path +
    // TIMESERIES day. Retorna { "YYYY-MM-DD|shopifyProductId": sessions }.
    async function getViewsMapPorPais(dateFrom, dateTo, countryCode) {
        if (!isConfigured()) throw new Error('Shopify não conectado.');
        if (!dateFrom || !dateTo || !countryCode) return {};
        const nomesAlvo = _paisCodigoParaNomes(countryCode);
        if (!nomesAlvo.length) return {};
        const q = `FROM sessions SHOW sessions GROUP BY session_country, landing_page_path TIMESERIES day SINCE ${dateFrom} UNTIL ${dateTo} LIMIT 5000`;
        const table = await _shopifyql(q);
        if (!table) return {};
        const cols = (table.columns || []).map(c => (c.name || '').toLowerCase());
        const iDia = cols.indexOf('day');
        const iPais = cols.indexOf('session_country');
        const iPath = cols.indexOf('landing_page_path');
        const iSess = cols.indexOf('sessions');
        if (iDia < 0 || iPais < 0 || iPath < 0 || iSess < 0) return {};

        let catalogo = getShopifyProducts() || [];
        if (!catalogo.length) { try { catalogo = await fetchShopifyProducts(); } catch (e) { console.warn('[Shopify] catálogo indisponível (views por país):', e.message); } }
        const idPorHandle = {};
        (catalogo || []).forEach(p => { if (p.handle) idPorHandle[String(p.handle).toLowerCase()] = String(p.id); });
        if (!Object.keys(idPorHandle).length) return {};

        const out = {};
        for (const row of table.rows) {
            const pais = String(row[iPais] || '').toLowerCase();
            if (!nomesAlvo.includes(pais)) continue;
            const handle = _handleDaLandingPage(row[iPath]);
            if (!handle) continue;
            const pid = idPorHandle[handle];
            if (!pid) continue;   // handle traduzido não casa — fica de fora
            const sess = parseInt(String(row[iSess] ?? '0').replace(/\D/g, ''), 10) || 0;
            const dia = String(row[iDia] || '').slice(0, 10);
            if (dia && sess) out[`${dia}|${pid}`] = (out[`${dia}|${pid}`] || 0) + sess;
        }
        return out;
    }

    // O token guardado na sessão carrega os escopos que existiam NA HORA da
    // conexão. Adicionar read_reports ao OAUTH_SCOPES não muda um token já
    // emitido — só uma reconexão emite outro. Sem checar isso, o usuário fica
    // vendo "visitas indisponíveis" sem saber que a ação é reconectar.
    // null = não deu pra saber (offline/sessão inválida) — não afirma nada.
    async function tokenTemEscopoDeVisitas() {
        try {
            const info = await _fetchShopInfo();
            const scope = info?.scope || info?.info?.scope || '';
            if (!scope) return null;
            return String(scope).split(',').map(s => s.trim()).includes('read_reports');
        } catch { return null; }
    }

    // Executa uma query ShopifyQL e devolve { columns, rows } já validado.
    // Centraliza o contrato do campo porque ele estava ERRADO em dois lugares:
    // pedia `tableData { ... rowData }`, e `rowData` não existe no schema (é
    // `rows`). Campo inexistente = erro de VALIDAÇÃO do documento, que o
    // servidor rejeita antes até de checar escopo — por isso toda chamada
    // ShopifyQL do app falhava, e o Dashboard só mostrava "Sem dados".
    // `parseErrors` também é [String!]!, não String.
    async function _shopifyql(q) {
        const gql = `query SQL($q: String!) {
            shopifyqlQuery(query: $q) {
                tableData { columns { name dataType } rows }
                parseErrors
            }
        }`;
        const data = await _graphql(gql, { q });
        const resp = data?.shopifyqlQuery;
        if (!resp) return null;
        const erros = Array.isArray(resp.parseErrors) ? resp.parseErrors.filter(Boolean) : [];
        if (erros.length) throw new Error(erros.join('; '));
        const table = resp.tableData;
        if (!table || !Array.isArray(table.rows)) return null;
        return table;
    }

    // Funil REAL da loja, direto do ShopifyQL (não é pixel do Facebook):
    // sessões → carrinho → checkout → compra. Opcionalmente quebrado por país
    // de sessão. Confirmado funcionando nesta loja.
    async function fetchFunilLoja(dateFrom, dateTo, { porPais = false } = {}) {
        if (!isConfigured()) throw new Error('Shopify não conectado.');
        if (!dateFrom || !dateTo) return [];
        const metricas = 'sessions, sessions_with_cart_additions, sessions_that_reached_checkout, sessions_that_completed_checkout';
        const q = porPais
            ? `FROM sessions SHOW ${metricas} GROUP BY session_country SINCE ${dateFrom} UNTIL ${dateTo} ORDER BY sessions DESC LIMIT 30`
            : `FROM sessions SHOW ${metricas} TIMESERIES day SINCE ${dateFrom} UNTIL ${dateTo}`;
        const table = await _shopifyql(q);
        if (!table) return [];
        const cols = (table.columns || []).map(c => (c.name || '').toLowerCase());
        const idx = (nome) => cols.indexOf(nome);
        const iChave = porPais ? idx('session_country') : idx('day');
        const iSess = idx('sessions');
        const iCart = idx('sessions_with_cart_additions');
        const iCheck = idx('sessions_that_reached_checkout');
        const iComp = idx('sessions_that_completed_checkout');
        const num = (v) => parseInt(String(v ?? '0').replace(/\D/g, ''), 10) || 0;
        return table.rows.map(r => ({
            chave: iChave >= 0 ? String(r[iChave] || '') : '',
            sessoes: num(r[iSess]),
            carrinho: num(r[iCart]),
            checkout: num(r[iCheck]),
            compras: num(r[iComp]),
        })).filter(l => l.chave);
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
                agg[pid].revenue += parseFloat(item.discounted_price ?? item.price ?? '0') * (item.quantity || 0);
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
                agg[key].revenue += parseFloat(item.discounted_price ?? item.price ?? '0') * (item.quantity || 0);
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
                agg[date].revenue += parseFloat(item.discounted_price ?? item.price ?? '0') * qty;
            }
            if (orderItems > 0) agg[date].orderCount += 1;
        }
        return agg;
    }

    // Vendas reais agregadas por PAÍS DE ENTREGA do pedido.
    // Dimensão diferente da tag de região da campanha (que é segmentação de
    // anúncio, no Diário): aqui é o país real pra onde o pedido foi. Pedido
    // sem shipping_address (ex.: produto digital) cai em '??' em vez de
    // sumir da conta — some do ranking mas o total continua batendo.
    async function getRealSalesPorPais(dateFrom, dateTo) {
        const orders = await fetchOrders(dateFrom, dateTo);
        const agg = {};
        for (const order of orders) {
            const cc = order.shipping_address?.country_code || '??';
            const nome = order.shipping_address?.country || '';
            if (!agg[cc]) agg[cc] = { countryCode: cc, country: nome, sales: 0, revenue: 0, orderCount: 0, currency: order.currency || 'BRL' };
            if (nome && !agg[cc].country) agg[cc].country = nome;
            let itens = 0;
            for (const item of (order.line_items || [])) {
                const qty = item.quantity || 0;
                itens += qty;
                agg[cc].sales += qty;
                agg[cc].revenue += parseFloat(item.discounted_price ?? item.price ?? '0') * qty;
            }
            if (itens > 0) agg[cc].orderCount += 1;
        }
        return agg;
    }

    // Fetch + cache shopify sales map keyed by "date|localProductId" for the given range.
    // Returns: { "YYYY-MM-DD|localProductId": { sales, revenue, currency } }
    // opts.countryCode (opcional, DASH-02): filtra os pedidos pelo país de
    // entrega (shipping_address.country_code, ISO-2) ANTES de agregar —
    // usado só pra Conversão Real por país no Calendário de Métricas.
    async function getRealSalesMapByDate(dateFrom, dateTo, opts = {}) {
        let orders = await fetchOrders(dateFrom, dateTo, opts);
        if (opts.countryCode) {
            orders = orders.filter(o => (o.shipping_address?.country_code || '') === opts.countryCode);
        }
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

    // ══════════════════════════════════════════════════════════════
    //  Detalhes ricos de produto (descrição, mídia, opções, variantes)
    //
    //  Fica FORA do fetchShopifyProducts de propósito: descriptionHtml
    //  costuma ter vários KB por produto e media traz dezenas de URLs.
    //  Puxar isso para o catálogo inteiro tornaria a listagem lenta e
    //  encheria o cache — aqui buscamos só os produtos pedidos.
    // ══════════════════════════════════════════════════════════════
    async function fetchProductDetails(shopifyIds) {
        const ids = (Array.isArray(shopifyIds) ? shopifyIds : [shopifyIds])
            .map(String).filter(Boolean);
        if (!ids.length) return {};
        if (!isConfigured()) throw new Error('Shopify não conectado.');

        const gql = `
            query Detalhes($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product {
                  id title handle status vendor productType tags descriptionHtml
                  options { name optionValues { name } }
                  media(first: 30) {
                    nodes {
                      mediaContentType alt
                      ... on MediaImage { image { url width height } }
                    }
                  }
                  variants(first: 100) {
                    nodes {
                      id title sku price compareAtPrice availableForSale inventoryQuantity
                      selectedOptions { name value }
                      image { url }
                    }
                  }
                }
              }
            }`;

        const out = {};
        // A API aceita no máximo 250 nós por chamada; 50 mantém a resposta leve.
        for (let i = 0; i < ids.length; i += 50) {
            const lote = ids.slice(i, i + 50).map(id =>
                String(id).startsWith('gid://') ? id : `gid://shopify/Product/${id}`);
            const data = await _graphql(gql, { ids: lote });
            (data.nodes || []).forEach(p => {
                if (!p || !p.id) return;
                const numId = _gidToNumeric(p.id);
                out[numId] = {
                    id: numId,
                    title: p.title,
                    handle: p.handle,
                    status: p.status,
                    vendor: p.vendor || '',
                    productType: p.productType || '',
                    tags: p.tags || [],
                    descriptionHtml: p.descriptionHtml || '',
                    options: (p.options || []).map(o => ({
                        name: o.name,
                        values: (o.optionValues || []).map(v => v.name),
                    })),
                    // Só imagens: vídeo e 3D não têm .image e virariam entradas vazias
                    images: (p.media?.nodes || [])
                        .filter(m => m.mediaContentType === 'IMAGE' && m.image?.url)
                        .map(m => ({ url: m.image.url, alt: m.alt || '', width: m.image.width, height: m.image.height })),
                    variants: (p.variants?.nodes || []).map(v => ({
                        id: _gidToNumeric(v.id),
                        title: v.title,
                        sku: v.sku || '',
                        price: parseFloat(v.price || '0'),
                        compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
                        availableForSale: !!v.availableForSale,
                        inventory: Number.isFinite(v.inventoryQuantity) ? v.inventoryQuantity : null,
                        options: (v.selectedOptions || []).map(o => ({ name: o.name, value: o.value })),
                        image: v.image?.url || '',
                    })),
                };
            });
        }
        return out;
    }

    // Escopos efetivamente concedidos ao token atual. Usado pelo Unificador
    // para avisar quando uma conexão antiga ainda não recebeu acesso a
    // estoque/localizações — adicionar o escopo no código não atualiza um
    // token já emitido; a loja precisa autorizar novamente uma única vez.
    async function getGrantedScopes() {
        // O `scope` guardado junto da sessão é só um snapshot do OAuth e pode
        // ficar defasado depois que a instalação recebe novas permissões. A
        // instalação atual é a fonte de verdade da Shopify.
        try {
            const data = await _graphql(`query GrantedAccessScopes {
                currentAppInstallation {
                    accessScopes { handle }
                }
            }`);
            const handles = (data?.currentAppInstallation?.accessScopes || [])
                .map(scope => scope?.handle).filter(Boolean);
            if (handles.length) return handles;
        } catch (error) {
            console.warn('[Shopify] Não foi possível consultar os escopos atuais; usando o snapshot da sessão.', error);
        }

        const sessionData = await _fetchShopInfo();
        const raw = sessionData?.scope || '';
        return (Array.isArray(raw) ? raw : String(raw).split(','))
            .map(scope => String(scope).trim()).filter(Boolean);
    }

    // Resolve uma URL/handle de coleção pela Admin API. A URL é apenas um
    // atalho de seleção: produto, preço e estoque continuam vindo da conexão
    // autenticada, nunca de scraping da vitrine.
    async function fetchCollectionForMerge(handle) {
        const cleanHandle = String(handle || '').trim().replace(/^\/+|\/+$/g, '');
        if (!cleanHandle) throw new Error('Informe o identificador da coleção.');

        const gql = `
            query CollectionForMerge($handle: String!, $cursor: String) {
              collectionByIdentifier(identifier: { handle: $handle }) {
                id title handle
                products(first: 100, after: $cursor) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    id title handle status
                    featuredMedia { ... on MediaImage { image { url } } }
                    variants(first: 2) {
                      nodes { id title sku price inventoryQuantity }
                    }
                    media(first: 2) {
                      nodes { alt ... on MediaImage { image { url } } }
                    }
                  }
                }
              }
            }`;

        let cursor = null;
        let collection = null;
        const products = [];
        let pages = 0;
        do {
            const data = await _graphql(gql, { handle: cleanHandle, cursor });
            const c = data?.collectionByIdentifier;
            if (!c) throw new Error(`Coleção "${cleanHandle}" não encontrada na loja conectada.`);
            if (!collection) collection = { id: c.id, title: c.title, handle: c.handle };
            const conn = c.products;
            (conn?.nodes || []).forEach(p => products.push({
                id: _gidToNumeric(p.id),
                gid: p.id,
                title: p.title,
                handle: p.handle,
                status: p.status,
                image: p.featuredMedia?.image?.url || p.media?.nodes?.find(m => m.image?.url)?.image?.url || null,
                priceMin: parseFloat(p.variants?.nodes?.[0]?.price || '0'),
                currency: _config.shopCurrency || 'BRL',
                variants: (p.variants?.nodes || []).map(v => ({
                    id: _gidToNumeric(v.id), title: v.title, sku: v.sku || '',
                    price: parseFloat(v.price || '0'), inventory: v.inventoryQuantity,
                })),
            }));
            cursor = conn?.pageInfo?.hasNextPage ? conn.pageInfo.endCursor : null;
            pages++;
        } while (cursor && pages < 20);

        return { ...collection, products };
    }

    // Leitura dedicada ao Unificador. Fica separada de fetchProductDetails
    // porque traz coleções, SEO e estoque por localização — dados pesados
    // que não devem entrar no fluxo comum de listagem/importação.
    async function fetchProductsForMerge(shopifyIds, { includeInventory = true } = {}) {
        const ids = (Array.isArray(shopifyIds) ? shopifyIds : [shopifyIds])
            .map(String).filter(Boolean)
            .map(id => id.startsWith('gid://') ? id : `gid://shopify/Product/${id}`);
        if (!ids.length) return [];

        const inventoryFragment = includeInventory ? `
            inventoryItem {
              id tracked requiresShipping
              inventoryLevels(first: 20) {
                nodes {
                  location { id name }
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }` : '';

        const gql = `
            query ProductsForMerge($ids: [ID!]!) {
              nodes(ids: $ids) {
                ... on Product {
                  id title handle status vendor productType tags descriptionHtml templateSuffix
                  seo { title description }
                  collections(first: 20) { nodes { id title handle } }
                  media(first: 100) {
                    nodes {
                      id mediaContentType alt status
                      ... on MediaImage { image { url width height } }
                    }
                  }
                  variants(first: 100) {
                    nodes {
                      id title sku barcode price compareAtPrice taxable inventoryPolicy
                      availableForSale inventoryQuantity
                      selectedOptions { name value }
                      media(first: 1) {
                        nodes { id alt ... on MediaImage { image { url } } }
                      }
                      ${inventoryFragment}
                    }
                  }
                }
              }
            }`;

        const data = await _graphql(gql, { ids });
        return (data?.nodes || []).filter(Boolean).map(p => ({
            id: _gidToNumeric(p.id),
            gid: p.id,
            title: p.title,
            handle: p.handle,
            status: p.status,
            vendor: p.vendor || '',
            productType: p.productType || '',
            tags: p.tags || [],
            descriptionHtml: p.descriptionHtml || '',
            templateSuffix: p.templateSuffix || '',
            seo: p.seo || { title: '', description: '' },
            collections: (p.collections?.nodes || []).map(c => ({ id: c.id, title: c.title, handle: c.handle })),
            images: (p.media?.nodes || [])
                .filter(m => m.mediaContentType === 'IMAGE' && m.image?.url)
                .map(m => ({
                    id: m.id, url: m.image.url, alt: m.alt || '', status: m.status,
                    width: m.image.width, height: m.image.height,
                })),
            variants: (p.variants?.nodes || []).map(v => ({
                id: _gidToNumeric(v.id),
                gid: v.id,
                title: v.title,
                sku: v.sku || '',
                barcode: v.barcode || '',
                price: parseFloat(v.price || '0'),
                compareAtPrice: v.compareAtPrice ? parseFloat(v.compareAtPrice) : null,
                taxable: v.taxable !== false,
                inventoryPolicy: v.inventoryPolicy || 'DENY',
                availableForSale: !!v.availableForSale,
                inventory: Number.isFinite(v.inventoryQuantity) ? v.inventoryQuantity : null,
                tracked: !!v.inventoryItem?.tracked,
                requiresShipping: v.inventoryItem?.requiresShipping !== false,
                inventoryItemId: v.inventoryItem?.id || null,
                inventoryLevels: (v.inventoryItem?.inventoryLevels?.nodes || []).map(level => ({
                    locationId: level.location?.id,
                    locationName: level.location?.name || '',
                    available: level.quantities?.find(q => q.name === 'available')?.quantity ?? 0,
                })).filter(level => level.locationId),
                options: (v.selectedOptions || []).map(o => ({ name: o.name, value: o.value })),
                image: v.media?.nodes?.[0]?.image?.url || '',
            })),
        }));
    }

    // Per-date totals (all products): { "YYYY-MM-DD": { sales, revenue, currency, orderCount } }
    async function getSalesMapByDate(dateFrom, dateTo, opts = {}) {
        const orders = await fetchOrders(dateFrom, dateTo, opts);
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
            // Nota: NÃO exigimos mais o prefixo `shpss_`. A Shopify mudou o
            // formato do Client Secret (apps novos não usam mais esse prefixo),
            // e a exigência antiga bloqueava o install em silêncio.

            const normalized = shop.replace(/^https?:\/\//, '').replace(/\/$/, '');
            if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(normalized)) {
                if (status) status.innerHTML = '<span style="color:var(--red)">Domínio inválido. Use o formato <code>sua-loja.myshopify.com</code>.</span>';
                return;
            }

            // try/catch: se _saveConfig ou beginInstall falharem, o usuário VÊ o
            // erro em vez do botão parecer "morto" (antes um throw aqui deixava a
            // tela sem reação nenhuma).
            try {
                _config.clientId = clientId;
                _config.clientSecret = clientSecret;
                _config.proxyUrl = proxyUrl;
                _saveConfig();
                if (status) status.innerHTML = '<span style="color:var(--text-muted)">Redirecionando para Shopify...</span>';
                setTimeout(() => beginInstall(normalized), 300);
            } catch (e) {
                if (status) status.innerHTML = '<span style="color:var(--red)">Erro ao iniciar a instalação: ' + ((e && e.message) || e) + '</span>';
            }
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
                    <p style="color:var(--text-muted)">${window.loadingHTML('Carregando produtos Shopify...')}</p>
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

    // Cabeçalho reduzido (DASH-01) — loja/timezone/período iam sempre visíveis
    // numa linha inteira própria; viraram tooltip num ícone só, deixando as
    // métricas (não o cabeçalho) o que chama mais atenção no bloco.
    // O nome da loja é dado sensível (já era borrado/ocultado no modo
    // privacidade) — o tooltip usa um <span class="shopify-widget-shop">
    // de verdade, não atributo title, senão o modo privacidade (feito pra
    // gravação de tela) perderia esse dado ao passar o mouse.
    function _widgetHeaderHtml(rangeLabel, botoesExtrasHtml) {
        return `
            <div class="shopify-widget-header">
                <div class="shopify-widget-titulo-row">
                    <h4>Vendas Reais</h4>
                    <span class="shopify-widget-info-wrap" tabindex="0">
                        <i data-lucide="info" class="shopify-widget-info-icon"></i>
                        <span class="shopify-widget-shop shopify-widget-info-tooltip">${_esc(_config.shopName || _config.shop)}${_config.shopTimezone ? ' · ' + _esc(_config.shopTimezone) : ''} · ${_esc(rangeLabel)}</span>
                    </span>
                </div>
                <div style="display:flex;gap:0.4rem">
                    <button class="btn btn-secondary btn-sm" id="btn-shopify-refresh">
                        <i data-lucide="refresh-cw" style="width:12px;height:12px"></i>
                    </button>
                    ${botoesExtrasHtml || ''}
                </div>
            </div>
        `;
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
            : `${period.start} → ${period.end}`;

        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.8rem">' + window.loadingHTML('Carregando dados Shopify...') + '</p>';

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
                        // Platforms + languages + ad-account badges (only when product is linked)
                        const metaBadges = (localP && typeof renderProductMetaBadges === 'function')
                            ? renderProductMetaBadges(localP) : '';
                        const rowRevenue = _convToDisplay(data.revenue, data.currency || shopCurrencyRaw);
                        return `
                            <div class="shopify-products-table-row shopify-products-table-row-3col">
                                <span class="shopify-product-name">${_esc(name)}${badge}${metaBadges}</span>
                                <span class="shopify-product-num">${data.sales}</span>
                                <span class="shopify-product-num">${fmtMoney(rowRevenue)}</span>
                            </div>
                        `;
                    }).join('');

                container.innerHTML = `
                    ${_widgetHeaderHtml(rangeLabel, '<button class="btn btn-secondary btn-sm" onclick="ShopifyModule.openLinkModal()">Vincular</button>')}

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
                ${_widgetHeaderHtml(rangeLabel)}

                <p class="shopify-widget-escopo">
                    ${totalShopifyOrders} pedido${totalShopifyOrders === 1 ? '' : 's'} Shopify no período · ${totalShopify} venda${totalShopify === 1 ? '' : 's'} já conciliada${totalShopify === 1 ? '' : 's'} com o diário (produto vinculado + Facebook preenchido)
                </p>

                <div class="shopify-widget-summary">
                    <div class="shopify-metric" title="Só conta vendas de produtos vinculados que já têm o diário do Facebook preenchido — não é o total de pedidos da Shopify.">
                        <span class="shopify-metric-label">Vendas conciliadas</span>
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
                    <details class="shopify-warnings shopify-warnings-collapsed">
                        <summary class="shopify-warnings-header">
                            <i data-lucide="alert-triangle" style="width:14px;height:14px;color:#d97706"></i>
                            <span>${warnings.length} incompatibilidade${warnings.length > 1 ? 's' : ''} detectada${warnings.length > 1 ? 's' : ''}</span>
                            <i data-lucide="chevron-down" class="shopify-warnings-chevron" style="width:14px;height:14px;margin-left:auto;color:var(--text-muted)"></i>
                        </summary>
                        <div class="shopify-warnings-list">
                            ${warnings.map(w => `
                                <div class="shopify-warning-row">
                                    <strong>${_esc(w.productName)}</strong>:
                                    Facebook diz <b>${w.fbSales}</b>, Shopify tem <b>${w.shopifySales}</b>
                                    (${w.discrepancy > 0 ? '+' : ''}${w.discrepancy} / ${w.discrepancyPct >= 0 ? '+' : ''}${w.discrepancyPct.toFixed(0)}%)
                                </div>
                            `).join('')}
                        </div>
                    </details>
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
            // Trocar de loja recarrega a conexão da nova loja (cada loja tem a
            // sua). Sem isso, o token/domínio/vínculos ficariam presos na loja
            // do boot.
            EventBus.on('storeChanged', () => reloadConfig());
        }

        setTimeout(() => renderDashboardWidget(), 500);
    }

    // ══════════════════════════════════════════════════════════════
    //  ENVIO DE IMAGEM PARA A LOJA  (única escrita que o app faz)
    //
    //  Fluxo oficial em 3 passos, porque o app só tem os BYTES da imagem
    //  (base64 no navegador), não uma URL pública:
    //    1. stagedUploadsCreate  → devolve um alvo no Google Cloud Storage
    //    2. POST multipart direto do browser para esse alvo
    //    3. productUpdate(media:) → anexa a imagem ao produto
    //
    //  productCreateMedia existe mas está DEPRECADO ("Use productUpdate or
    //  productSet instead"), por isso o passo 3 usa productUpdate.
    // ══════════════════════════════════════════════════════════════

    // Limites publicados pela Shopify para mídia de produto.
    const IMG_MAX_BYTES = 20 * 1024 * 1024;
    const IMG_MAX_LADO = 4472;

    async function _criarAlvoDeUpload(nomeArquivo, mimeType, tamanho) {
        const q = `
            mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
                stagedUploadsCreate(input: $input) {
                    stagedTargets { url resourceUrl parameters { name value } }
                    userErrors { field message }
                }
            }`;
        const d = await _graphql(q, {
            input: [{
                filename: nomeArquivo,
                mimeType,
                // O enum é IMAGE. "PRODUCT_IMAGE" aparece em exemplos antigos
                // mas não existe mais no schema.
                resource: 'IMAGE',
                httpMethod: 'POST',
                fileSize: String(tamanho),
            }],
        });
        const err = d?.stagedUploadsCreate?.userErrors?.[0];
        if (err) throw new Error(err.message);
        const alvo = d?.stagedUploadsCreate?.stagedTargets?.[0];
        if (!alvo?.url) throw new Error('A Shopify não devolveu um destino de upload.');
        return alvo;
    }

    async function _enviarBytes(alvo, blob, nomeArquivo) {
        const form = new FormData();
        // Regra do Google Cloud Storage: os parâmetros vêm ANTES e o arquivo
        // é obrigatoriamente o ÚLTIMO campo — qualquer campo depois dele é
        // ignorado em silêncio e o upload falha de forma confusa depois.
        (alvo.parameters || []).forEach(p => form.append(p.name, p.value));
        form.append('file', blob, nomeArquivo);

        // Sem Content-Type manual: o browser precisa gerar o boundary sozinho.
        const r = await fetch(alvo.url, { method: 'POST', body: form, mode: 'cors' });
        if (!r.ok) {
            const t = await r.text().catch(() => '');
            throw new Error(`Falha no upload (HTTP ${r.status}). ${t.slice(0, 160)}`);
        }
    }

    // productUpdate devolve a lista INTEIRA de mídia do produto, não só a que
    // acabou de entrar — sem saber o que já existia antes, não dá pra saber
    // com segurança qual node é o novo (a ordem devolvida não é garantida).
    async function _idsDeMidiaAtual(produtoGid) {
        const q = `query MidiaAtual($id: ID!) { product(id: $id) { media(first: 60) { nodes { id } } } }`;
        const d = await _graphql(q, { id: produtoGid });
        return new Set((d?.product?.media?.nodes || []).map(n => n.id));
    }

    async function _anexarAoProduto(produtoGid, resourceUrl, alt) {
        const q = `
            mutation ProductUpdateAddMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
                productUpdate(product: $product, media: $media) {
                    product { id media(first: 30) { nodes { id status mediaContentType } } }
                    userErrors { field message }
                }
            }`;
        const d = await _graphql(q, {
            product: { id: produtoGid },
            media: [{ originalSource: resourceUrl, mediaContentType: 'IMAGE', alt: alt || '' }],
        });
        const err = d?.productUpdate?.userErrors?.[0];
        if (err) throw new Error(err.message);
        return d?.productUpdate?.product?.media?.nodes || [];
    }

    // Sobe UMA imagem. `origem` pode ser dataUrl (base64) ou URL. `idsConhecidos`
    // é o Set devolvido por _idsDeMidiaAtual ANTES do upload — usado pra achar
    // com segurança qual media id é o novo; quando enviar várias em sequência,
    // o chamador deve ir somando o novo id ao mesmo Set entre as chamadas.
    async function enviarImagemDoProduto(produtoGid, origem, { nome, alt, idsConhecidos } = {}) {
        if (!isConfigured()) throw new Error('Shopify não conectado.');
        if (!produtoGid) throw new Error('Produto sem vínculo na Shopify.');

        const blob = await bytesDaImagem(origem);
        if (blob.size > IMG_MAX_BYTES) {
            throw new Error(`Imagem de ${(blob.size / 1024 / 1024).toFixed(1)} MB — a Shopify aceita no máximo 20 MB.`);
        }
        const dim = await dimensoesDaImagem(blob).catch(() => null);
        if (dim && (dim.largura > IMG_MAX_LADO || dim.altura > IMG_MAX_LADO)) {
            throw new Error(`Imagem ${dim.largura}×${dim.altura} — a Shopify aceita no máximo ${IMG_MAX_LADO}px por lado.`);
        }

        // A extensão do filename precisa casar com o mimeType — divergência é
        // causa comum de FAILED no processamento do lado da Shopify.
        const ext = (blob.type.split('/')[1] || 'webp').replace('jpeg', 'jpg');
        const base = String(nome || 'imagem').replace(/\.[^.]+$/, '') || 'imagem';
        const nomeArquivo = `${base}.${ext}`;

        const alvo = await _criarAlvoDeUpload(nomeArquivo, blob.type || 'image/webp', blob.size);
        await _enviarBytes(alvo, blob, nomeArquivo);
        const nodes = await _anexarAoProduto(produtoGid, alvo.resourceUrl, alt || base);

        const novo = idsConhecidos ? nodes.find(n => !idsConhecidos.has(n.id)) : nodes[nodes.length - 1];
        return novo || nodes[nodes.length - 1] || null;
    }

    // Query pública — o chamador (products.js) precisa dela pra montar
    // idsConhecidos antes de mandar vários uploads em sequência.
    const idsDeMidiaAtual = _idsDeMidiaAtual;

    // Define qual mídia é a capa (posição 0). Assíncrono do lado da Shopify:
    // devolve um Job, não o resultado.
    async function reordenarMidia(produtoGid, movimentos) {
        const q = `
            mutation ProductReorderMedia($id: ID!, $moves: [MoveInput!]!) {
                productReorderMedia(id: $id, moves: $moves) {
                    job { id done }
                    mediaUserErrors { field message code }
                }
            }`;
        const d = await _graphql(q, {
            id: produtoGid,
            // newPosition é UnsignedInt64 → vai como STRING, e é zero-based.
            moves: movimentos.map(m => ({ id: m.id, newPosition: String(m.posicao) })),
        });
        const err = d?.productReorderMedia?.mediaUserErrors?.[0];
        if (err) throw new Error(err.message);
        return d?.productReorderMedia?.job || null;
    }

    // ══════════════════════════════════════════════════════════════
    //  TRADUÇÕES  (translatableResource → translationsRegister)
    //
    //  Fluxo oficial validado contra o schema, sempre 2 passos por recurso:
    //    1. LER translatableContent → pega key + digest (hash do valor de
    //       ORIGEM). O digest muda quando a origem muda; por isso é lido na
    //       hora, nunca cacheado.
    //    2. GRAVAR translationsRegister com {locale, key, value, digest}.
    //
    //  Keys de Product: title, body_html (descrição), handle. Opção e valor
    //  de variante são recursos SEPARADOS (ProductOption / ProductOptionValue,
    //  key "name", GID e digest próprios).
    // ══════════════════════════════════════════════════════════════

    async function _shopLocales() {
        const q = `query GetShopLocales { shopLocales { locale name primary published } }`;
        const d = await _graphql(q, {});
        return d?.shopLocales || [];
    }

    async function _habilitarLocale(locale) {
        const q = `
            mutation EnableLocale($locale: String!) {
                shopLocaleEnable(locale: $locale) {
                    shopLocale { locale name published }
                    userErrors { field message }
                }
            }`;
        const d = await _graphql(q, { locale });
        const err = d?.shopLocaleEnable?.userErrors?.[0];
        if (err) throw new Error(err.message);
        return d?.shopLocaleEnable?.shopLocale || null;
    }

    // Lê os campos traduzíveis + digests de um recurso (produto, opção, valor).
    async function _conteudoTraduzivel(gid) {
        const q = `
            query GetTranslatable($id: ID!) {
                translatableResource(resourceId: $id) {
                    resourceId
                    translatableContent { key value digest locale type }
                }
            }`;
        const d = await _graphql(q, { id: gid });
        const map = {};
        (d?.translatableResource?.translatableContent || []).forEach(c => { map[c.key] = c; });
        return map;
    }

    // Opções e valores de variante do produto (cada um com GID + digest).
    async function _nestedTraduzivel(gid) {
        const q = `
            query GetNested($id: ID!) {
                translatableResource(resourceId: $id) {
                    nestedTranslatableResources(first: 100) {
                        edges { node { resourceId translatableContent { key value digest } } }
                    }
                }
            }`;
        const d = await _graphql(q, { id: gid });
        return (d?.translatableResource?.nestedTranslatableResources?.edges || [])
            .map(e => e.node)
            .map(n => ({
                resourceId: n.resourceId,
                conteudo: (n.translatableContent || []).reduce((a, c) => (a[c.key] = c, a), {}),
            }));
    }

    async function _registrarTraducoes(resourceId, translations) {
        if (!translations.length) return [];
        const q = `
            mutation RegisterTranslations($resourceId: ID!, $translations: [TranslationInput!]!) {
                translationsRegister(resourceId: $resourceId, translations: $translations) {
                    translations { locale key }
                    userErrors { field message code }
                }
            }`;
        const d = await _graphql(q, { resourceId, translations });
        const err = d?.translationsRegister?.userErrors?.[0];
        if (err) throw new Error(err.message);
        return d?.translationsRegister?.translations || [];
    }

    // Envia as traduções de UM produto para vários idiomas. `porIdioma` é
    // { [locale]: { title, descriptionHtml, handle, variants:[{name,values}] } }.
    // `origem` = { variants:[{name,values}] } do idioma de origem, pra casar
    // os valores traduzidos com os GIDs certos das opções.
    async function enviarTraducoesDoProduto(produtoGid, porIdioma, opcoes = {}) {
        if (!isConfigured()) throw new Error('Shopify não conectado.');
        if (!produtoGid) throw new Error('Produto sem vínculo na Shopify.');
        const aviso = typeof opcoes.onProgress === 'function' ? opcoes.onProgress : () => {};

        // Idiomas já habilitados na loja (só dá pra registrar em locale enabled).
        // Se a leitura falhar (ex.: falta read_locales), NÃO trava o envio — os
        // idiomas costumam já estar habilitados; segue pro registro e a própria
        // Shopify recusa se algum locale não estiver enabled.
        aviso('Verificando idiomas da loja…');
        let locales = [];
        let podeHabilitar = true;
        try {
            locales = await _shopLocales();
        } catch (e) {
            console.warn('[Shopify] não consegui ler shopLocales:', e.message);
            podeHabilitar = false;   // sem a lista, não tenta habilitar às cegas
        }
        const habilitados = new Set(locales.map(l => l.locale));
        const primario = (locales.find(l => l.primary) || {}).locale;

        const resultado = { ok: [], falhas: [] };
        const alvos = Object.keys(porIdioma);

        for (const locale of alvos) {
            if (!locale || locale === primario) continue;   // não traduz para a própria origem
            const t = porIdioma[locale];
            try {
                if (podeHabilitar && !habilitados.has(locale)) {
                    aviso(`Habilitando idioma ${locale}…`);
                    await _habilitarLocale(locale);
                    habilitados.add(locale);
                }

                // 1) Produto: title, body_html, handle. Digest lido AGORA.
                aviso(`Enviando ${locale}: texto…`);
                let bodyHtml = t.descriptionHtml || '';
                // Imagens traduzidas viram base64 na descrição — a loja não
                // renderiza data: em body_html. Hospeda como arquivo e troca.
                bodyHtml = await _hospedarImagensData(bodyHtml, (m) => aviso(`Enviando ${locale}: ${m}`));

                const cont = await _conteudoTraduzivel(produtoGid);
                const traducoesProduto = [];
                const add = (key, value) => {
                    const c = cont[key];
                    if (c && value != null && String(value).trim()) {
                        traducoesProduto.push({ locale, key, value: String(value), translatableContentDigest: c.digest });
                    }
                };
                add('title', t.title);
                add('body_html', bodyHtml);
                add('handle', t.handle);
                await _registrarTraducoes(produtoGid, traducoesProduto);

                // 2) Opções/valores de variante (recursos separados).
                if ((t.variants || []).length) {
                    aviso(`Enviando ${locale}: variantes…`);
                    await _traduzirVariantes(produtoGid, t.variants, opcoes.variantesOrigem || [], locale);
                }

                resultado.ok.push(locale);
            } catch (e) {
                console.warn('[Shopify] falha ao traduzir', locale, e.message);
                resultado.falhas.push({ locale, erro: e.message });
            }
        }
        return resultado;
    }

    // Casa cada opção/valor traduzido com o GID certo pelo VALOR de origem.
    async function _traduzirVariantes(produtoGid, variantesTraduzidas, variantesOrigem, locale) {
        const nested = await _nestedTraduzivel(produtoGid);
        // Índice: valor de origem (lowercase) → { resourceId, digest } do "name".
        const porValor = new Map();
        nested.forEach(n => {
            const c = n.conteudo?.name;
            if (c && c.value) porValor.set(String(c.value).toLowerCase().trim(), { resourceId: n.resourceId, digest: c.digest });
        });

        for (let oi = 0; oi < variantesTraduzidas.length; oi++) {
            const optT = variantesTraduzidas[oi];
            const optO = variantesOrigem[oi];
            if (!optO) continue;
            // Nome da opção (Color → Farbe)
            const alvoNome = porValor.get(String(optO.name).toLowerCase().trim());
            if (alvoNome && optT.name) {
                try { await _registrarTraducoes(alvoNome.resourceId, [{ locale, key: 'name', value: optT.name, translatableContentDigest: alvoNome.digest }]); } catch (e) { console.warn('[Shopify] opção', e.message); }
            }
            // Valores (Black → Schwarz), casados por posição via valor de origem.
            // for-of com await (forEach(async) não aguardaria nem trataria erro).
            const valores = optO.values || [];
            for (let vi = 0; vi < valores.length; vi++) {
                const alvo = porValor.get(String(valores[vi]).toLowerCase().trim());
                const valTrad = (optT.values || [])[vi];
                if (alvo && valTrad) {
                    try { await _registrarTraducoes(alvo.resourceId, [{ locale, key: 'name', value: valTrad, translatableContentDigest: alvo.digest }]); } catch (e) { console.warn('[Shopify] valor', e.message); }
                }
            }
        }
    }

    // Troca imagens data: (base64) da descrição por arquivos hospedados na
    // Shopify, senão a loja não renderiza e o body_html fica gigante.
    async function _hospedarImagensData(html, aviso = () => {}) {
        if (!html || !html.includes('data:image')) return html;
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        const imgs = [...tmp.querySelectorAll('img')].filter(im => (im.getAttribute('src') || '').startsWith('data:'));
        for (let i = 0; i < imgs.length; i++) {
            aviso(`hospedando imagem ${i + 1}/${imgs.length}`);
            try {
                const url = await _hospedarArquivoImagem(imgs[i].getAttribute('src'), `desc-${Date.now()}-${i}`);
                if (url) imgs[i].setAttribute('src', url);
            } catch (e) { console.warn('[Shopify] hospedar imagem descrição:', e.message); }
        }
        return tmp.innerHTML;
    }

    // Sobe um BLOB pra Files da loja e devolve a URL pública (poll) — núcleo
    // compartilhado por _hospedarArquivoImagem (recebe data:URL, usada na
    // descrição do produto) e hospedarBlobImagem (API pública, usada pelo
    // botão "Inserir imagem" do Loja/Código — LAUNCH-04).
    async function _hospedarBlobImagem(blob, nome) {
        const ext = (blob.type.split('/')[1] || 'webp').replace('jpeg', 'jpg');
        const arquivo = `${nome}.${ext}`;
        const alvo = await _criarAlvoDeUpload(arquivo, blob.type || 'image/webp', blob.size);
        await _enviarBytes(alvo, blob, arquivo);

        const q = `
            mutation FileCreate($files: [FileCreateInput!]!) {
                fileCreate(files: $files) {
                    files { id fileStatus ... on MediaImage { image { url } } }
                    userErrors { field message }
                }
            }`;
        const d = await _graphql(q, { files: [{ originalSource: alvo.resourceUrl, contentType: 'IMAGE' }] });
        const err = d?.fileCreate?.userErrors?.[0];
        if (err) throw new Error(err.message);
        const fileId = d?.fileCreate?.files?.[0]?.id;
        let url = d?.fileCreate?.files?.[0]?.image?.url;
        // fileCreate processa async — faz poll até a URL aparecer.
        for (let i = 0; i < 10 && !url && fileId; i++) {
            await new Promise(r => setTimeout(r, 900));
            const pq = `query FileUrl($id: ID!) { node(id: $id) { ... on MediaImage { image { url } fileStatus } } }`;
            const pd = await _graphql(pq, { id: fileId });
            url = pd?.node?.image?.url;
        }
        return url || '';
    }

    // Sobe um data:URL para a Files da loja e devolve a URL pública (poll).
    async function _hospedarArquivoImagem(dataUrl, nome) {
        return _hospedarBlobImagem(await bytesDaImagem(dataUrl), nome);
    }

    // Versão pública de _hospedarBlobImagem — usada fora deste módulo (ex.:
    // "Inserir imagem" no Loja/Código) pra hospedar uma imagem qualquer nos
    // Arquivos da loja sem precisar vinculá-la a um produto.
    async function hospedarBlobImagem(blob, nome) {
        if (!isConfigured()) throw new Error('Shopify não conectado.');
        return _hospedarBlobImagem(blob, nome || `imagem-${Date.now()}`);
    }

    // ── Agente de Loja (Fase 1: campos de produto + atribuição de template) ──

    // Lista os temas da loja (precisa do escopo read_themes — se a sessão
    // ainda não tem esse escopo, a Shopify recusa com um erro de permissão
    // que o chamador deve tratar mostrando "reautorize a loja").
    async function fetchThemes() {
        const gql = `{ themes(first: 20) { nodes { id name role } } }`;
        const data = await _graphql(gql);
        return (data?.themes?.nodes || []).map(t => ({ id: t.id, name: t.name, role: t.role }));
    }

    // Lista TODOS os arquivos de um tema — a API não filtra por prefixo,
    // então pagina e devolve tudo; quem chama filtra no cliente. Tema
    // costuma ter poucas centenas de arquivos — 250×6 páginas cobre a
    // esmagadora maioria das lojas.
    async function fetchThemeFiles(themeId) {
        const gql = `query ThemeFiles($id: ID!, $after: String) {
            theme(id: $id) {
                files(first: 250, after: $after) {
                    pageInfo { hasNextPage endCursor }
                    nodes { filename }
                }
            }
        }`;
        const arquivos = [];
        let after = null;
        for (let pagina = 0; pagina < 6; pagina++) {
            const data = await _graphql(gql, { id: themeId, after });
            const conn = data?.theme?.files;
            for (const f of (conn?.nodes || [])) arquivos.push(f.filename);
            if (!conn?.pageInfo?.hasNextPage) break;
            after = conn.pageInfo.endCursor;
        }
        return arquivos;
    }

    // Templates de PRODUTO de um tema (templates/product.*.json — Online Store 2.0).
    async function fetchProductTemplates(themeId) {
        const arquivos = await fetchThemeFiles(themeId);
        const templates = [];
        for (const filename of arquivos) {
            const m = /^templates\/product(?:\.([a-z0-9-]+))?\.(?:json|liquid)$/i.exec(filename || '');
            if (m) templates.push({ filename, suffix: m[1] || null });
        }
        return templates;
    }

    // Aplica campos simples de produto (título, status, template) — tudo
    // via productUpdate, já liberado no allowlist do Worker. Preço NÃO
    // entra aqui: mora na variante, não no produto (ver updateVariantPrice).
    async function updateProductFields(gid, campos) {
        const input = { id: gid };
        if ('title' in campos) input.title = campos.title;
        if ('status' in campos) input.status = campos.status;
        if ('templateSuffix' in campos) input.templateSuffix = campos.templateSuffix || null;
        const gql = `mutation ProdUpdate($input: ProductUpdateInput!) {
            productUpdate(product: $input) {
                product { id title status templateSuffix }
                userErrors { field message }
            }
        }`;
        const data = await _graphql(gql, { input });
        const err = data?.productUpdate?.userErrors?.[0];
        if (err) throw new Error(err.message);
        return data?.productUpdate?.product;
    }

    // Preço mora na variante — productVariantsBulkUpdate, também já
    // liberado no allowlist.
    async function updateVariantPrice(productGid, variantGid, price, compareAtPrice) {
        const variant = { id: variantGid, price: String(price) };
        if (compareAtPrice !== undefined) variant.compareAtPrice = compareAtPrice === null ? null : String(compareAtPrice);
        const gql = `mutation VarUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
                productVariants { id price compareAtPrice }
                userErrors { field message }
            }
        }`;
        const data = await _graphql(gql, { productId: productGid, variants: [variant] });
        const err = data?.productVariantsBulkUpdate?.userErrors?.[0];
        if (err) throw new Error(err.message);
        return data?.productVariantsBulkUpdate?.productVariants?.[0];
    }

    async function _findMergedProductByTag(mergeTag) {
        if (!mergeTag) return null;
        const gql = `query ExistingMerge($query: String!) {
            products(first: 1, query: $query) {
                nodes { id title handle status featuredMedia { ... on MediaImage { image { url } } } }
            }
        }`;
        const escaped = String(mergeTag).replace(/["\\]/g, '');
        const data = await _graphql(gql, { query: `tag:"${escaped}"` });
        return data?.products?.nodes?.[0] || null;
    }

    async function fetchMergedProductResult(productGid) {
        const gid = String(productGid || '').startsWith('gid://')
            ? String(productGid)
            : `gid://shopify/Product/${productGid}`;
        const gql = `query MergeResult($id: ID!) {
            product(id: $id) {
                id title handle status
                featuredMedia { ... on MediaImage { image { url } } }
                options { name optionValues { name } }
                variants(first: 100) {
                    nodes {
                        id title sku price inventoryQuantity
                        selectedOptions { name value }
                        media(first: 1) { nodes { id alt } }
                    }
                }
                media(first: 100) { nodes { id alt status } }
            }
        }`;
        const data = await _graphql(gql, { id: gid });
        return data?.product || null;
    }

    // Cria o produto unificado inteiro em uma operação productSet: opções,
    // variantes, arquivos/alt text e estoque por localização. `mergeTag`
    // funciona como chave de idempotência da aplicação: se a resposta de
    // rede se perder depois da criação, a repetição encontra o rascunho já
    // criado em vez de gerar uma cópia.
    async function createMergedProduct({ input, mergeTag, collectionIds = [] }) {
        if (!input?.title) throw new Error('O produto unificado precisa de um título.');

        const existing = await _findMergedProductByTag(mergeTag);
        if (existing) {
            const verified = await fetchMergedProductResult(existing.id).catch(() => existing);
            return { product: verified || existing, reused: true, warnings: [] };
        }

        const gql = `mutation CreateMergedProduct($input: ProductSetInput!) {
            productSet(synchronous: true, input: $input) {
                product {
                    id title handle status
                    featuredMedia { ... on MediaImage { image { url } } }
                    options { name optionValues { name } }
                    variants(first: 100) {
                        nodes {
                            id title sku price inventoryQuantity
                            selectedOptions { name value }
                            media(first: 1) { nodes { id alt } }
                        }
                    }
                    media(first: 100) { nodes { id alt status } }
                }
                userErrors { field message }
            }
        }`;
        const data = await _graphql(gql, { input });
        const errors = data?.productSet?.userErrors || [];
        if (errors.length) {
            throw new Error(errors.map(e => `${e.field?.join?.('.') || e.field || 'produto'}: ${e.message}`).join('; '));
        }

        const product = data?.productSet?.product;
        if (!product?.id) throw new Error('A Shopify não devolveu o produto criado.');

        const warnings = [];
        const uniqueCollections = [...new Set((collectionIds || []).filter(Boolean))];
        const addToCollection = `mutation AddMergedToCollection($id: ID!, $productIds: [ID!]!) {
            collectionAddProducts(id: $id, productIds: $productIds) {
                collection { id title }
                userErrors { field message }
            }
        }`;
        for (const collectionId of uniqueCollections) {
            try {
                const cdata = await _graphql(addToCollection, { id: collectionId, productIds: [product.id] });
                const cerr = cdata?.collectionAddProducts?.userErrors || [];
                if (cerr.length) warnings.push(cerr.map(e => e.message).join('; '));
            } catch (e) {
                warnings.push(`Coleção: ${e.message}`);
            }
        }

        const verified = await fetchMergedProductResult(product.id).catch(() => null);
        return { product: verified || product, reused: false, warnings };
    }

    return {
        init, getConfig, isConfigured,
        enviarImagemDoProduto, reordenarMidia, idsDeMidiaAtual,
        enviarTraducoesDoProduto, localesDaLoja: _shopLocales,
        beginInstall, testConnection, disconnect, diagnose,
        fetchOrders, fetchShopifyProducts, getShopifyProducts,
        linkProduct, getLink, autoLinkByName, syncAllLinkedPrices,
        aggregateByProduct, aggregateByProductAndDate, aggregateByDate,
        getRealSalesForProduct, getRealSalesMap,
        getRealSalesMapByDate, getSalesMapByDate, getRealSalesPorPais, fetchProductViews, fetchProductViewsByDate,
        fetchFunilLoja, getCoberturaViews, getViewsMapPorPais, tokenTemEscopoDeVisitas,
        fetchProductDetails, getGrantedScopes, fetchCollectionForMerge, fetchProductsForMerge,
        createMergedProduct, fetchMergedProductResult,
        compareWithDiary, compareWithDiaryRange,
        openConfigModal, openLinkModal, renderDashboardWidget,
        fetchThemes, fetchThemeFiles, fetchProductTemplates, updateProductFields, updateVariantPrice,
        hospedarBlobImagem, reloadConfig,
    };
})();
