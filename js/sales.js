/* ===========================
   Sales & Patterns — order-level history with dual-timezone display
   =========================== */

const SalesModule = (() => {
    const PAGE_SIZE = 100;
    const CALC_KEY = 'etracker_sales_calc';

    // Campaign link to open in a NEW TAB (no Mapa de Ads).
    // Per-country links live in lp.campaignUrlsByCountry["DE"]; campaignGroupUrl is the generic fallback.
    // No auto-build — that opened unrelated ad accounts. Empty => fall back to Mapa de Ads.
    const _buildCampaignUrl = (lp, country) => {
        if (!lp) return '';
        const cc = String(country || '').toUpperCase();
        const byC = lp.campaignUrlsByCountry || {};
        if (cc && byC[cc] && String(byC[cc]).trim()) return String(byC[cc]).trim();
        return (lp.campaignGroupUrl || '').trim();
    };

    // Count how many campaigns a pasted Ads Manager URL points to.
    // Reads selected_campaign_ids=ID1%2CID2... (the IDs the user selected in the manager).
    const _campaignCountFromUrl = (url) => {
        if (!url) return 0;
        try {
            const m = String(url).match(/selected_campaign_ids=([^&#]+)/i);
            if (m && m[1]) {
                const decoded = decodeURIComponent(m[1]);
                return decoded.split(',').map(s => s.trim()).filter(Boolean).length;
            }
        } catch {}
        return 0;
    };

    // Save a campaign URL onto a product (by id). country='' => generic; country='DE' => per-country.
    const _saveCampaignUrl = (productId, url, country) => {
        try {
            const all = (typeof AppState !== 'undefined' && (AppState.allProducts || AppState.products)) || [];
            const prod = all.find(p => p && p.id === productId);
            if (!prod) return false;
            const cc = String(country || '').toUpperCase();
            const clean = (url || '').trim();
            if (cc) {
                if (!prod.campaignUrlsByCountry || typeof prod.campaignUrlsByCountry !== 'object') prod.campaignUrlsByCountry = {};
                if (clean) prod.campaignUrlsByCountry[cc] = clean;
                else delete prod.campaignUrlsByCountry[cc];
            } else {
                prod.campaignGroupUrl = clean;
            }
            if (typeof LocalStore !== 'undefined') LocalStore.save('products', AppState.allProducts || all);
            if (typeof EventBus !== 'undefined') EventBus.emit('productsChanged');
            return true;
        } catch (e) { console.warn('[Sales] saveCampaignUrl failed', e); return false; }
    };

    // Prompt to paste/edit a product's campaign link. If no country is given, ask for one
    // (empty = generic/all countries), so the user can set separate campaigns per country.
    const _promptCampaignUrl = (productId, prodName, country) => {
        const all = (typeof AppState !== 'undefined' && (AppState.allProducts || AppState.products)) || [];
        const prod = all.find(p => p && p.id === productId);
        const name = prodName || (prod && prod.name) || 'produto';
        let cc = String(country || '').toUpperCase();
        if (!cc) {
            const ans = prompt(`Campanha de "${name}" — para qual PAÍS?\nUse a sigla (ex.: DE, IE, US). Deixe vazio = campanha padrão (todos os países).`, '');
            if (ans === null) return; // cancelled
            cc = (ans || '').trim().toUpperCase();
        }
        const current = cc
            ? ((prod && prod.campaignUrlsByCountry && prod.campaignUrlsByCountry[cc]) || '')
            : ((prod && prod.campaignGroupUrl) || '');
        const label = cc ? `${name} — país ${cc}` : `${name} (padrão)`;
        const url = prompt(`Cole o link da campanha de "${label}"\n(ex.: https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=...)\nDeixe vazio pra remover.`, current);
        if (url === null) return; // cancelled
        const trimmed = url.trim();
        if (trimmed && !/^https?:\/\//i.test(trimmed)) {
            if (typeof showToast === 'function') showToast('Link inválido — precisa começar com http:// ou https://', 'error');
            return;
        }
        const ok = _saveCampaignUrl(productId, trimmed, cc);
        if (ok && typeof showToast === 'function') {
            const where = cc ? ` (${cc})` : '';
            showToast(trimmed ? `Link${where} salvo! Clique no produto pra abrir a campanha.` : `Link${where} removido.`, 'success');
        }
        _renderMdgxRanking();
        try { _renderTable(); } catch {}
    };

    let _state = {
        orders: [],
        filtered: [],
        from: '',
        to: '',
        countries: [],          // multi-select de países (siglas, ex.: ['DE','IE'])
        productFilter: '',
        cityFilter: '',
        accountFilter: '',
        sortKey: 'created_at',
        sortDir: 'desc',
        shopTz: 'UTC',
        shopName: '',
        currency: '',
        displayed: PAGE_SIZE,
        loaded: false,
        loading: false,
        calc: {
            spend: 0,
            spendCurrency: 'BRL',
            visitors: 0,
            targetProfitPct: 30,
            targetConvPct: 2,
            marginOverride: null, // null = auto from products
            collapsed: false,
        },
    };

    function _saveCalc() {
        try { localStorage.setItem(CALC_KEY, JSON.stringify(_state.calc)); } catch {}
    }
    function _loadCalc() {
        try {
            const v = JSON.parse(localStorage.getItem(CALC_KEY) || 'null');
            if (v) Object.assign(_state.calc, v);
        } catch {}
    }

    // ── Date helpers ─────────────────────────────────────────────
    function _todayISO() {
        return new Date().toISOString().slice(0, 10);
    }
    function _daysAgoISO(n) {
        const d = new Date();
        d.setDate(d.getDate() - n);
        return d.toISOString().slice(0, 10);
    }
    function _setQuickPeriod(days) {
        _state.from = _daysAgoISO(days - 1);
        _state.to = _todayISO();
        const f = document.getElementById('sales-date-from');
        const t = document.getElementById('sales-date-to');
        if (f) f.value = _state.from;
        if (t) t.value = _state.to;
    }

    // ── Format helpers ───────────────────────────────────────────
    function _fmtMoney(amt, currency) {
        const n = Number(amt) || 0;
        const cur = currency || _state.currency || 'BRL';
        try {
            return n.toLocaleString('pt-BR', { style: 'currency', currency: cur });
        } catch {
            return cur + ' ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
    }
    function _fmtNumber(n) {
        return Number(n || 0).toLocaleString('pt-BR');
    }

    function _fmtInTz(iso, tz) {
        if (!iso || !tz) return '—';
        try {
            const d = new Date(iso);
            const date = d.toLocaleDateString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', year: '2-digit' });
            const time = d.toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
            return `${date} ${time}`;
        } catch (e) {
            return '—';
        }
    }

    function _tzShort(tz) {
        if (!tz) return '';
        try {
            const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' });
            const parts = fmt.formatToParts(new Date());
            const tzPart = parts.find(p => p.type === 'timeZoneName');
            return tzPart?.value || tz.split('/').pop().replace(/_/g, ' ');
        } catch {
            return tz.split('/').pop().replace(/_/g, ' ');
        }
    }

    // ── BR number parse (1.500,50 → 1500.5) ──────────────────────
    function _parseBR(str) {
        if (typeof str === 'number') return str;
        if (!str) return 0;
        const s = String(str).trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
        const n = parseFloat(s);
        return isNaN(n) ? 0 : n;
    }

    // ── Live-format pt-BR money input ─────────────────────────────
    function _liveFormatMoney(input) {
        const raw = String(input.value || '').replace(/[^\d,]/g, '');
        const firstComma = raw.indexOf(',');
        let cleaned = firstComma === -1 ? raw : (raw.slice(0, firstComma + 1) + raw.slice(firstComma + 1).replace(/,/g, ''));
        if (cleaned.includes(',')) {
            const [intPart, decPart] = cleaned.split(',');
            cleaned = intPart + ',' + decPart.slice(0, 2);
        }
        const [intPart, decPart] = cleaned.split(',');
        const intDigits = intPart.replace(/^0+(?=\d)/, '');
        const intFormatted = intDigits ? Number(intDigits).toLocaleString('pt-BR') : '';
        const formatted = decPart !== undefined ? `${intFormatted || '0'},${decPart}` : intFormatted;
        if (input.value !== formatted) input.value = formatted;
    }
    function _liveFormatInt(input) {
        const raw = String(input.value || '').replace(/\D/g, '');
        const formatted = raw ? Number(raw).toLocaleString('pt-BR') : '';
        if (input.value !== formatted) input.value = formatted;
    }

    // ── Auto-margin estimate from filtered orders × product cost ─
    function _autoMarginPerSale() {
        if (typeof AppState === 'undefined' || !Array.isArray(AppState.products)) return null;
        const orders = _state.filtered;
        if (!orders.length) return null;
        let totalUnits = 0;
        let totalRevenueUSD = 0;
        let totalCostUSD = 0;
        const conv = (v, c) => (typeof convertToUSD === 'function') ? convertToUSD(v, c) : v;
        let matched = 0;
        for (const o of orders) {
            for (const li of (o.line_items || [])) {
                const qty = li.quantity || 0;
                if (!qty) continue;
                const unitPrice = parseFloat(li.price) || 0;
                totalUnits += qty;
                totalRevenueUSD += conv(unitPrice * qty, o.currency || 'USD');
                // Find product by id, fallback by title match
                const pid = String(li.product_id || '');
                let prod = AppState.products.find(p => String(p.shopifyProductId || '') === pid)
                        || AppState.products.find(p => p.name && li.title && p.name.toLowerCase() === li.title.toLowerCase());
                if (prod) {
                    matched += qty;
                    const costUSD = conv(prod.cost || 0, prod.costCurrency || prod.priceCurrency || 'USD');
                    const tax = (prod.tax || 0) / 100;
                    const varCost = (prod.variableCosts || 0) / 100;
                    const unitMargin = conv(unitPrice, o.currency || 'USD') * (1 - tax - varCost) - costUSD;
                    totalCostUSD += conv(unitPrice, o.currency || 'USD') - unitMargin;
                    totalCostUSD = Math.max(0, totalCostUSD); // sanity
                }
            }
        }
        if (!totalUnits) return null;
        const matchRatio = matched / totalUnits;
        if (matchRatio < 0.3) return null; // too many unmatched products
        // Average margin per unit in USD
        const avgMarginUSD = (totalRevenueUSD - totalCostUSD) / totalUnits;
        return { marginUSD: avgMarginUSD, matchRatio, totalUnits };
    }

    function _convertFromUSD(usd, targetCcy) {
        const rates = (typeof AppState !== 'undefined' && AppState.exchangeRates) || {};
        if (!targetCcy || targetCcy === 'USD') return usd;
        const rate = rates[targetCcy];
        return (typeof rate === 'number' && rate > 0) ? usd * rate : usd;
    }

    function _renderCalculator() {
        const meta = document.getElementById('sales-calc-meta');
        const scenWrap = document.getElementById('sales-calc-scenarios');
        const periodLbl = document.getElementById('sales-calc-period-label');
        if (!meta || !scenWrap) return;

        if (periodLbl) periodLbl.textContent = (_state.from && _state.to) ? ` · ${_state.from} → ${_state.to}` : '';

        const orders = _state.filtered;
        const actualSales = orders.reduce((s, o) => s + (o.line_items || []).reduce((a, li) => a + (li.quantity || 0), 0), 0);
        const actualRevenueUSD = orders.reduce((s, o) => {
            const v = parseFloat(o.total_price) || 0;
            return s + ((typeof convertToUSD === 'function') ? convertToUSD(v, o.currency || 'USD') : v);
        }, 0);
        const ticketUSD = actualSales > 0 ? actualRevenueUSD / actualSales : 0;

        // Margin — override is entered in the display currency (= spend currency)
        const displayCcy = _state.calc.spendCurrency || _state.currency || 'BRL';
        const auto = _autoMarginPerSale();
        const overrideUSD = (_state.calc.marginOverride != null && !isNaN(_state.calc.marginOverride))
            ? ((typeof convertToUSD === 'function') ? convertToUSD(_state.calc.marginOverride, displayCcy) : _state.calc.marginOverride)
            : null;
        const marginUSD = (overrideUSD != null) ? overrideUSD : (auto ? auto.marginUSD : null);

        const spendUSD = (typeof convertToUSD === 'function') ? convertToUSD(_state.calc.spend || 0, _state.calc.spendCurrency || 'USD') : (_state.calc.spend || 0);

        // Meta line
        const marginNote = marginUSD == null
            ? '<span class="sales-warn">Margem não calculável — defina custos nos produtos ou um override.</span>'
            : (overrideUSD != null
                ? `Margem unitária <strong>${_fmtMoney(_convertFromUSD(marginUSD, displayCcy), displayCcy)}</strong> (override).`
                : `Margem unitária <strong>${_fmtMoney(_convertFromUSD(marginUSD, displayCcy), displayCcy)}</strong> · estimado a partir de ${Math.round((auto?.matchRatio || 0) * 100)}% dos produtos vendidos.`);
        // Conversão real = vendas ÷ visitantes
        const visitorsForConv = _state.calc.visitors || 0;
        const realConvPct = visitorsForConv > 0 ? (actualSales / visitorsForConv) * 100 : null;
        const targetConvPct = _state.calc.targetConvPct || 0;
        let convLine = '';
        if (realConvPct != null) {
            let convColor = '#6b7280', convArrow = '', convNote = '';
            if (targetConvPct > 0) {
                if (realConvPct >= targetConvPct) {
                    convColor = '#059669'; convArrow = '↑';
                    convNote = ` (alvo ${targetConvPct}% ✓)`;
                } else {
                    convColor = '#dc2626'; convArrow = '↓';
                    const gap = (targetConvPct - realConvPct).toFixed(2);
                    convNote = ` (alvo ${targetConvPct}% · faltam ${gap}pp)`;
                }
            }
            convLine = `<div class="sales-calc-meta-row sales-calc-conv-row">
                <span class="sales-calc-conv-big" style="color:${convColor}">
                    <i data-lucide="percent" style="width:14px;height:14px;vertical-align:-2px"></i>
                    Conversão real: <strong>${convArrow} ${realConvPct.toFixed(2)}%</strong>
                </span>
                <span class="sales-calc-conv-detail">${_fmtNumber(actualSales)} vendas ÷ ${_fmtNumber(visitorsForConv)} visitantes${convNote}</span>
            </div>`;
        } else {
            convLine = `<div class="sales-calc-meta-row sales-calc-conv-row">
                <span class="sales-calc-conv-hint">Preencha <strong>Visitantes / sessões</strong> acima para ver a conversão real (vendas ÷ visitantes).</span>
            </div>`;
        }

        // Conversão FB — placeholder (preenchido async por _renderFbConversion)
        const fbConvLine = `<div class="sales-calc-meta-row sales-calc-conv-row sales-calc-fbconv-row" id="sales-calc-fbconv">
            <span class="sales-calc-conv-hint"><i data-lucide="loader-2" style="width:13px;height:13px;vertical-align:-2px;animation:spin 1s linear infinite"></i> Carregando conversão do Facebook…</span>
        </div>`;
        // Conversão Shopify — placeholder (sessões reais da loja via ShopifyQL)
        const shopConvLine = `<div class="sales-calc-meta-row sales-calc-conv-row sales-calc-shopconv-row" id="sales-calc-shopconv">
            <span class="sales-calc-conv-hint"><i data-lucide="loader-2" style="width:13px;height:13px;vertical-align:-2px;animation:spin 1s linear infinite"></i> Carregando visualizações da Shopify…</span>
        </div>`;

        meta.innerHTML = `
            <div class="sales-calc-meta-row">
                <span>Vendas atuais: <strong>${_fmtNumber(actualSales)}</strong></span>
                <span>Receita: <strong>${_fmtMoney(_convertFromUSD(actualRevenueUSD, displayCcy), displayCcy)}</strong></span>
                <span>Ticket médio: <strong>${_fmtMoney(_convertFromUSD(ticketUSD, displayCcy), displayCcy)}</strong></span>
            </div>
            ${convLine}
            ${fbConvLine}
            ${shopConvLine}
            <div class="sales-calc-meta-row">${marginNote}</div>`;
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}

        // Fetch + render FB conversion async (separate metric, uses FB API clicks)
        _renderFbConversion(actualSales);
        // Fetch + render Shopify conversion async (real store sessions via ShopifyQL)
        _renderShopifyConversion(actualSales);

        // Scenarios
        const scenarios = [];
        if (marginUSD != null && marginUSD > 0 && spendUSD > 0) {
            // Breakeven
            scenarios.push({ key: 'be', label: 'Breakeven (zerar)', need: spendUSD / marginUSD });
            // Target profit %
            const x = (_state.calc.targetProfitPct || 0) / 100;
            if (x > 0 && ticketUSD > 0) {
                const denom = marginUSD - x * ticketUSD;
                if (denom > 0) scenarios.push({ key: 'profit', label: `Lucro ${_state.calc.targetProfitPct}% sobre receita`, need: spendUSD / denom });
                else scenarios.push({ key: 'profit', label: `Lucro ${_state.calc.targetProfitPct}% sobre receita`, unreachable: true, note: 'Inalcançável: margem unitária menor que o lucro alvo' });
            }
        }
        // Target conversion
        const y = (_state.calc.targetConvPct || 0) / 100;
        const visitors = _state.calc.visitors || 0;
        if (visitors > 0 && y > 0) {
            scenarios.push({ key: 'conv', label: `Conversão ${_state.calc.targetConvPct}%`, need: visitors * y });
        }

        if (!scenarios.length) {
            scenWrap.innerHTML = '<p class="sales-empty" style="padding:1rem">Preencha gasto em ads + visitantes acima para ver as metas.</p>';
            return;
        }

        scenWrap.innerHTML = `<table class="sales-calc-table">
            <thead><tr><th>Cenário</th><th class="num">Vendas necessárias</th><th class="num">Você está em</th><th class="num">Faltam</th><th class="num">Progresso</th></tr></thead>
            <tbody>${scenarios.map(s => {
                if (s.unreachable) {
                    return `<tr><td>${_esc(s.label)}</td><td colspan="4" class="sales-calc-unreachable">${_esc(s.note || 'Inalcançável')}</td></tr>`;
                }
                const need = Math.ceil(s.need);
                const remaining = Math.max(0, need - actualSales);
                const pct = need > 0 ? Math.min(999, (actualSales / need) * 100) : 0;
                const pctColor = pct >= 100 ? '#059669' : (pct >= 60 ? '#2563eb' : (pct >= 30 ? '#d97706' : '#dc2626'));
                return `<tr>
                    <td>${_esc(s.label)}</td>
                    <td class="num"><strong>${_fmtNumber(need)}</strong></td>
                    <td class="num">${_fmtNumber(actualSales)}</td>
                    <td class="num">${_fmtNumber(remaining)}</td>
                    <td class="num">
                        <span class="sales-calc-pct" style="color:${pctColor}">${pct.toFixed(0)}%</span>
                        <div class="sales-calc-bar"><div class="sales-calc-bar-fill" style="width:${Math.min(100, pct)}%;background:${pctColor}"></div></div>
                    </td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    }

    // ── Conversão FB (separada): vendas ÷ cliques no link do Facebook ──
    let _fbConvCache = { key: '', totals: null };
    async function _renderFbConversion(actualSales) {
        const el = document.getElementById('sales-calc-fbconv');
        if (!el) return;

        if (typeof FacebookAds === 'undefined' || !FacebookAds.isConnected || !FacebookAds.isConnected()) {
            el.innerHTML = `<span class="sales-calc-conv-hint"><svg class="brand-icon" viewBox="0 0 24 24" style="width:13px;height:13px;vertical-align:-2px"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg> Conecte o Facebook Ads para ver a conversão do FB (cliques → vendas).</span>`;
            return;
        }

        const from = _state.from, to = _state.to;
        if (!from || !to) { el.style.display = 'none'; return; }
        const cacheKey = `${from}|${to}|${FacebookAds.config?.activeAdAccountId}`;
        try {
            let totals;
            if (_fbConvCache.key === cacheKey && _fbConvCache.totals) {
                totals = _fbConvCache.totals;
            } else {
                totals = await FacebookAds.fetchAccountTotals({ since: from, until: to });
                _fbConvCache = { key: cacheKey, totals };
            }
            // Element may have been re-rendered; re-grab
            const el2 = document.getElementById('sales-calc-fbconv');
            if (!el2) return;

            if (!totals || totals.linkClicks === 0) {
                el2.innerHTML = `<span class="sales-calc-conv-hint">Sem cliques de anúncios FB no período (ou conta sem dados).</span>`;
                return;
            }

            const clicks = totals.linkClicks;
            // PURO FACEBOOK: compras atribuídas pelo pixel ÷ cliques no link do FB.
            // Não mistura vendas Shopify — só dados do próprio Facebook.
            const fbPurchases = totals.purchases || 0;
            const convFb = (fbPurchases / clicks) * 100;
            const targetConv = _state.calc.targetConvPct || 0;

            let color = '#1877F2', arrow = '', note = '';
            if (targetConv > 0) {
                if (convFb >= targetConv) { color = '#059669'; arrow = '↑'; note = ` (alvo ${targetConv}% ✓)`; }
                else { color = '#dc2626'; arrow = '↓'; note = ` (alvo ${targetConv}% · faltam ${(targetConv - convFb).toFixed(2)}pp)`; }
            }

            const fbIcon = `<svg class="brand-icon" viewBox="0 0 24 24" style="width:14px;height:14px;vertical-align:-2px"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>`;
            el2.innerHTML = `
                <span class="sales-calc-conv-big" style="color:${color}">
                    ${fbIcon} Conversão FB: <strong>${arrow} ${convFb.toFixed(2)}%</strong>
                </span>
                <span class="sales-calc-conv-detail">${_fmtNumber(fbPurchases)} compras (pixel FB) ÷ ${_fmtNumber(clicks)} cliques no link${note}</span>`;
        } catch (e) {
            const el3 = document.getElementById('sales-calc-fbconv');
            if (el3) el3.innerHTML = `<span class="sales-calc-conv-hint">Erro ao buscar dados do FB.</span>`;
        }
    }

    // ── Conversão Shopify (separada): vendas ÷ sessões reais da loja (ShopifyQL) ──
    let _shopViewsCache = { key: '', data: null };
    async function _renderShopifyConversion(actualSales) {
        const el = document.getElementById('sales-calc-shopconv');
        if (!el) return;
        const shopIcon = `<svg viewBox="0 0 24 24" style="width:14px;height:14px;vertical-align:-2px"><path fill="#95BF47" d="M15.34 3.3c-.06-.04-.13-.06-.2-.06-.07 0-1.4.03-1.4.03s-.93-.9-1.02-1c-.1-.1-.28-.07-.36-.05l-.5.15c-.3-.86-.82-1.65-1.74-1.65h-.08C9.5.27 9.05.03 8.66.03 5.7.04 4.28 3.74 3.84 5.62l-2.07.64c-.64.2-.66.22-.74.83C.97 7.55 0 14.9 0 14.9l9.13 1.7 4.95-1.07S15.4 3.4 15.34 3.3zM11.4 2.5l-.8.25v-.17c0-.5-.07-.9-.18-1.22.46.06.76.58.98 1.14zm-1.62-1.04c.13.32.2.78.2 1.4v.1l-1.67.5c.32-1.22.93-1.82 1.47-2zM9.1.7c.1 0 .2.04.28.1-.72.34-1.5 1.2-1.82 2.9l-1.32.4C6.66 2.46 7.83.7 9.1.7z"/><path fill="#5E8E3E" d="M15.14 3.24c-.07 0-1.4.03-1.4.03s-.93-.9-1.02-1c-.04-.03-.08-.05-.13-.06L12 16.6l4.95-1.07S15.4 3.4 15.34 3.3c-.06-.04-.13-.06-.2-.06z"/><path fill="#FFF" d="M9.6 6.04l-.6 1.8s-.54-.28-1.18-.28c-.95 0-1 .6-1 .75 0 .82 2.13 1.13 2.13 3.04 0 1.5-.95 2.47-2.24 2.47-1.54 0-2.33-.96-2.33-.96l.4-1.36s.8.7 1.5.7c.45 0 .63-.36.63-.62 0-1.07-1.75-1.12-1.75-2.87 0-1.47 1.05-2.9 3.2-2.9.82 0 1.22.23 1.22.23z"/></svg>`;

        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured || !ShopifyModule.isConfigured()) {
            el.innerHTML = `<span class="sales-calc-conv-hint">${shopIcon} Conecte o Shopify para ver as visualizações reais da loja.</span>`;
            return;
        }
        const from = _state.from, to = _state.to;
        if (!from || !to) { el.style.display = 'none'; return; }

        const cacheKey = `${from}|${to}`;
        try {
            let viewsData;
            if (_shopViewsCache.key === cacheKey && _shopViewsCache.data) {
                viewsData = _shopViewsCache.data;
            } else {
                viewsData = await ShopifyModule.fetchProductViews(from, to);
                _shopViewsCache = { key: cacheKey, data: viewsData };
            }
            const el2 = document.getElementById('sales-calc-shopconv');
            if (!el2) return;

            // Determine views: product-specific if filter active, else total
            const pf = String(_state.productFilter || '');
            let views = viewsData.total || 0;
            if (pf) {
                // productFilter is a Shopify product_id
                views = (viewsData.byShopifyProductId && viewsData.byShopifyProductId[pf]) || 0;
            }
            if (!views) {
                el2.innerHTML = `<span class="sales-calc-conv-hint">${shopIcon} Sem visualizações Shopify no período${pf ? ' para este produto' : ''}.</span>`;
                return;
            }

            const conv = (actualSales / views) * 100;
            const target = _state.calc.targetConvPct || 0;
            let color = '#95BF47', arrow = '', note = '';
            if (target > 0) {
                if (conv >= target) { color = '#059669'; arrow = '↑'; note = ` (alvo ${target}% ✓)`; }
                else { color = '#dc2626'; arrow = '↓'; note = ` (alvo ${target}% · faltam ${(target - conv).toFixed(2)}pp)`; }
            }
            el2.innerHTML = `
                <span class="sales-calc-conv-big" style="color:${color}">
                    ${shopIcon} Conversão Shopify: <strong>${arrow} ${conv.toFixed(2)}%</strong>
                </span>
                <span class="sales-calc-conv-detail">${_fmtNumber(actualSales)} vendas ÷ ${_fmtNumber(views)} visualizações${note}</span>`;
        } catch (e) {
            const el3 = document.getElementById('sales-calc-shopconv');
            if (el3) el3.innerHTML = `<span class="sales-calc-conv-hint">${shopIcon} ${(e.message || 'Erro ao buscar visualizações Shopify.')}</span>`;
        }
    }

    // ── Pull spend + visitors from Diário (Facebook report ingest) ─
    function _pullFromDiary() {
        if (typeof AppState === 'undefined' || !Array.isArray(AppState.diary)) return null;
        const from = _state.from, to = _state.to;
        if (!from || !to) return null;
        const productFilter = _state.productFilter ? String(_state.productFilter) : '';
        const targetCcy = _state.calc.spendCurrency || _state.currency || 'BRL';
        let spendUSD = 0;
        let visitors = 0;
        let entryCount = 0;
        let earliest = null, latest = null;

        for (const d of AppState.diary) {
            const dateStr = String(d.date || '').trim();
            if (!dateStr) continue;
            if (dateStr < from || dateStr > to) continue;
            // If a product filter is on AND we have shopify product mapping, only include matching diary entries
            if (productFilter && d.productId) {
                // Best-effort: if productFilter matches d.productId or any internal product mapped to that shopify id
                let match = String(d.productId) === productFilter;
                if (!match && Array.isArray(AppState.products)) {
                    const internal = AppState.products.find(p => String(p.id) === String(d.productId));
                    if (internal && String(internal.shopifyProductId || '') === productFilter) match = true;
                }
                if (!match) continue;
            }
            const budget = Number(d.budget) || 0;
            const cur = d.budgetCurrency || 'BRL';
            spendUSD += (typeof convertToUSD === 'function') ? convertToUSD(budget, cur) : budget;
            visitors += Number(d.pageViews) || 0;
            entryCount++;
            if (!earliest || dateStr < earliest) earliest = dateStr;
            if (!latest || dateStr > latest) latest = dateStr;
        }
        if (!entryCount) return null;
        const spendInTarget = (typeof convertCurrency === 'function')
            ? convertCurrency(spendUSD, 'USD', targetCcy)
            : _convertFromUSD(spendUSD, targetCcy);
        return { spend: spendInTarget, currency: targetCcy, visitors, entryCount, earliest, latest };
    }

    function _autofillFromDiary() {
        const data = _pullFromDiary();
        const sourceEl = document.getElementById('sales-calc-source');
        if (!data) {
            if (sourceEl) sourceEl.textContent = 'Nenhuma entrada do Diário no período (com filtro de produto, se ativo).';
            if (sourceEl) sourceEl.classList.add('sales-calc-source-warn');
            if (typeof showToast === 'function') showToast('Sem dados do Diário no período', 'error');
            return;
        }
        _state.calc.spend = data.spend;
        _state.calc.spendCurrency = data.currency;
        _state.calc.visitors = data.visitors;
        _saveCalc();
        // Reflect in inputs
        const spendInp = document.getElementById('sales-calc-spend');
        const visitorsInp = document.getElementById('sales-calc-visitors');
        const ccyInp = document.getElementById('sales-calc-spend-currency');
        if (spendInp) spendInp.value = data.spend ? data.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
        if (visitorsInp) visitorsInp.value = data.visitors ? data.visitors.toLocaleString('pt-BR') : '';
        if (ccyInp) ccyInp.value = data.currency;
        if (sourceEl) {
            sourceEl.classList.remove('sales-calc-source-warn');
            sourceEl.textContent = `Diário · ${data.entryCount} entradas (${data.earliest} → ${data.latest})`;
        }
        _renderCalculator();
    }

    function _bindCalculator() {
        const spend = document.getElementById('sales-calc-spend');
        const spendCcy = document.getElementById('sales-calc-spend-currency');
        const visitors = document.getElementById('sales-calc-visitors');
        const profit = document.getElementById('sales-calc-target-profit');
        const conv = document.getElementById('sales-calc-target-conv');
        const marginOv = document.getElementById('sales-calc-margin-override');
        const toggle = document.getElementById('sales-calc-toggle');
        const body = document.getElementById('sales-calc-body');

        // Restore values
        if (spend) spend.value = _state.calc.spend ? _state.calc.spend.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
        if (spendCcy) spendCcy.value = _state.calc.spendCurrency || 'BRL';
        if (visitors) visitors.value = _state.calc.visitors ? Number(_state.calc.visitors).toLocaleString('pt-BR') : '';
        if (profit) profit.value = _state.calc.targetProfitPct ?? 30;
        if (conv) conv.value = _state.calc.targetConvPct ?? 2;
        if (marginOv) marginOv.value = (_state.calc.marginOverride != null) ? _state.calc.marginOverride.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
        if (body && _state.calc.collapsed) { body.style.display = 'none'; if (toggle) toggle.textContent = '▶'; }

        const onChange = () => {
            _state.calc.spend = _parseBR(spend?.value);
            _state.calc.spendCurrency = spendCcy?.value || 'BRL';
            _state.calc.visitors = parseInt((visitors?.value || '').replace(/\D/g, ''), 10) || 0;
            _state.calc.targetProfitPct = parseFloat(profit?.value) || 0;
            _state.calc.targetConvPct = parseFloat(conv?.value) || 0;
            const ov = _parseBR(marginOv?.value);
            _state.calc.marginOverride = (marginOv?.value || '').trim() === '' ? null : ov;
            _saveCalc();
            _renderCalculator();
        };

        if (spend) { spend.addEventListener('input', () => { _liveFormatMoney(spend); onChange(); }); }
        if (visitors) { visitors.addEventListener('input', () => { _liveFormatInt(visitors); onChange(); }); }
        if (marginOv) { marginOv.addEventListener('input', () => { _liveFormatMoney(marginOv); onChange(); }); }
        [spendCcy, profit, conv].forEach(el => el?.addEventListener('input', onChange));

        if (toggle && body) {
            toggle.addEventListener('click', () => {
                _state.calc.collapsed = !_state.calc.collapsed;
                body.style.display = _state.calc.collapsed ? 'none' : '';
                toggle.textContent = _state.calc.collapsed ? '▶' : '▼';
                _saveCalc();
            });
        }

        document.getElementById('btn-sales-calc-autofill')?.addEventListener('click', _autofillFromDiary);
    }

    // ── Patterns / Insights ───────────────────────────────────────
    function _orderHourInShopTz(iso) {
        try { return parseInt(new Date(iso).toLocaleString('en-US', { timeZone: _state.shopTz, hour: '2-digit', hour12: false }), 10); }
        catch { return null; }
    }
    function _orderWeekdayInShopTz(iso) {
        try {
            const wd = new Date(iso).toLocaleString('en-US', { timeZone: _state.shopTz, weekday: 'short' });
            return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(wd);
        } catch { return -1; }
    }
    function _orderDateInShopTz(iso) {
        try {
            // Build YYYY-MM-DD in shop timezone
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: _state.shopTz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
            const y = parts.find(p => p.type === 'year').value;
            const m = parts.find(p => p.type === 'month').value;
            const d = parts.find(p => p.type === 'day').value;
            return `${y}-${m}-${d}`;
        } catch { return null; }
    }

    function _renderHeatmap() {
        const wrap = document.getElementById('sales-heatmap');
        if (!wrap) return;
        const orders = _state.filtered;
        // Build 7 × 24 grid
        const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
        for (const o of orders) {
            const wd = _orderWeekdayInShopTz(o.created_at);
            const h = _orderHourInShopTz(o.created_at);
            if (wd >= 0 && h >= 0 && h < 24) grid[wd][h]++;
        }
        const max = Math.max(...grid.flat(), 1);
        const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const hours = Array.from({ length: 24 }, (_, i) => i);
        // Build table-like grid
        let html = '<div class="sales-heatmap-row sales-heatmap-header">';
        html += '<div class="sales-heatmap-cell sales-heatmap-axis"></div>';
        for (const h of hours) {
            html += `<div class="sales-heatmap-cell sales-heatmap-axis">${String(h).padStart(2, '0')}</div>`;
        }
        html += '</div>';
        for (let wd = 1; wd <= 7; wd++) {
            const idx = wd % 7; // start from Monday
            html += '<div class="sales-heatmap-row">';
            html += `<div class="sales-heatmap-cell sales-heatmap-axis">${dayNames[idx]}</div>`;
            for (const h of hours) {
                const v = grid[idx][h];
                const intensity = max ? v / max : 0;
                const bg = intensity > 0
                    ? `rgba(37, 99, 235, ${0.10 + intensity * 0.70})`
                    : 'transparent';
                html += `<div class="sales-heatmap-cell" style="background:${bg}" title="${dayNames[idx]} ${String(h).padStart(2,'0')}h: ${v} ${v === 1 ? 'pedido' : 'pedidos'}">${v || ''}</div>`;
            }
            html += '</div>';
        }
        wrap.innerHTML = html;
    }

    function _renderWeekdayBars() {
        const wrap = document.getElementById('sales-weekday-bars');
        if (!wrap) return;
        const orders = _state.filtered;
        const counts = new Array(7).fill(0);
        const revenue = new Array(7).fill(0);
        for (const o of orders) {
            const wd = _orderWeekdayInShopTz(o.created_at);
            if (wd < 0) continue;
            counts[wd]++;
            const v = parseFloat(o.total_price) || 0;
            revenue[wd] += (typeof convertToUSD === 'function') ? convertToUSD(v, o.currency || 'USD') : v;
        }
        const max = Math.max(...counts, 1);
        const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const displayCcy = _state.calc?.spendCurrency || _state.currency || 'BRL';
        const order = [1, 2, 3, 4, 5, 6, 0]; // Mon-Sun
        wrap.innerHTML = order.map(i => {
            const w = max ? (counts[i] / max) * 100 : 0;
            return `<div class="sales-weekday-row">
                <div class="sales-weekday-name">${dayNames[i]}</div>
                <div class="sales-weekday-bar-wrap">
                    <div class="sales-weekday-bar" style="width:${w}%"></div>
                    <span class="sales-weekday-val">${counts[i]} pedidos · ${_fmtMoney(_convertFromUSD(revenue[i], displayCcy), displayCcy)}</span>
                </div>
            </div>`;
        }).join('');
    }

    function _renderGeo() {
        const wrap = document.getElementById('sales-geo-table');
        if (!wrap) return;
        const orders = _state.filtered;
        const byCountry = new Map();
        for (const o of orders) {
            const cc = o.shipping_address?.country_code || '';
            const name = o.shipping_address?.country || cc || '—';
            const city = o.shipping_address?.city || '';
            const v = parseFloat(o.total_price) || 0;
            const usd = (typeof convertToUSD === 'function') ? convertToUSD(v, o.currency || 'USD') : v;
            const k = cc || name;
            if (!byCountry.has(k)) byCountry.set(k, { name, count: 0, revenue: 0, cities: new Map() });
            const e = byCountry.get(k);
            e.count++;
            e.revenue += usd;
            if (city) e.cities.set(city, (e.cities.get(city) || 0) + 1);
        }
        const list = [...byCountry.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);
        const totalOrders = orders.length || 1;
        const displayCcy = _state.calc?.spendCurrency || _state.currency || 'BRL';
        if (!list.length) {
            wrap.innerHTML = '<p class="sales-empty" style="padding:1rem">—</p>';
            return;
        }
        wrap.innerHTML = `<table class="sales-geo-table">
            <thead><tr><th>País</th><th class="num">Pedidos</th><th class="num">% do total</th><th class="num">Receita</th><th>Top cidades</th></tr></thead>
            <tbody>${list.map(([cc, e]) => {
                const cities = [...e.cities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, n]) => `${_esc(c)} (${n})`).join(', ');
                const pct = (e.count / totalOrders) * 100;
                return `<tr>
                    <td><strong>${_esc(e.name)}</strong> <span class="sales-tz-note">${_esc(cc)}</span></td>
                    <td class="num">${_fmtNumber(e.count)}</td>
                    <td class="num">${pct.toFixed(1)}%</td>
                    <td class="num">${_fmtMoney(_convertFromUSD(e.revenue, displayCcy), displayCcy)}</td>
                    <td>${cities || '—'}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    }

    function _renderFirstSale() {
        const wrap = document.getElementById('sales-first-sale');
        if (!wrap) return;
        const orders = _state.filtered;
        // Group by date in shop TZ; for each day compute revenue and time of first order (minutes from midnight)
        const byDay = new Map();
        for (const o of orders) {
            const date = _orderDateInShopTz(o.created_at);
            if (!date) continue;
            const tStr = new Date(o.created_at).toLocaleString('en-US', { timeZone: _state.shopTz, hour: '2-digit', minute: '2-digit', hour12: false });
            const m = tStr.match(/(\d{2}):(\d{2})/);
            const minutes = m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
            const v = parseFloat(o.total_price) || 0;
            const usd = (typeof convertToUSD === 'function') ? convertToUSD(v, o.currency || 'USD') : v;
            const e = byDay.get(date) || { revenue: 0, firstMin: null };
            e.revenue += usd;
            if (minutes != null && (e.firstMin == null || minutes < e.firstMin)) e.firstMin = minutes;
            byDay.set(date, e);
        }
        const days = [...byDay.values()];
        if (days.length < 4) {
            wrap.innerHTML = '<p class="sales-empty">Pelo menos 4 dias com vendas são necessários pra detectar padrão.</p>';
            return;
        }
        // Strong = top 25% revenue days, weak = bottom 25%
        const sorted = [...days].sort((a, b) => b.revenue - a.revenue);
        const cut = Math.max(1, Math.floor(sorted.length * 0.25));
        const strong = sorted.slice(0, cut).filter(d => d.firstMin != null);
        const weak = sorted.slice(-cut).filter(d => d.firstMin != null);
        const fmtTime = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
        const avgStrong = strong.length ? strong.reduce((s, d) => s + d.firstMin, 0) / strong.length : null;
        const avgWeak = weak.length ? weak.reduce((s, d) => s + d.firstMin, 0) / weak.length : null;
        wrap.innerHTML = `
            <div class="sales-first-row sales-first-strong">
                <span class="sales-first-lbl">Dias fortes (${strong.length})</span>
                <span class="sales-first-val">${avgStrong != null ? fmtTime(avgStrong) : '—'}</span>
            </div>
            <div class="sales-first-row sales-first-weak">
                <span class="sales-first-lbl">Dias fracos (${weak.length})</span>
                <span class="sales-first-val">${avgWeak != null ? fmtTime(avgWeak) : '—'}</span>
            </div>
            ${(avgStrong != null && avgWeak != null) ? `<p class="sales-first-note">${avgStrong < avgWeak
                ? `<i data-lucide="check-circle-2" style="width:12px;height:12px;vertical-align:-2px"></i> Em dias fortes a 1ª venda chega <strong>${Math.round((avgWeak - avgStrong) / 60 * 10) / 10}h mais cedo</strong>.`
                : `<i data-lucide="alert-circle" style="width:12px;height:12px;vertical-align:-2px"></i> Em dias fortes a 1ª venda chega <strong>mais tarde</strong> (${Math.round((avgStrong - avgWeak) / 60 * 10) / 10}h).`}</p>` : ''}`;
    }

    function _renderInsights() {
        const wrap = document.getElementById('sales-insights');
        if (!wrap) return;
        const orders = _state.filtered;
        if (orders.length < 5) {
            wrap.innerHTML = '<li>Poucos pedidos no período pra gerar insights confiáveis (mínimo 5).</li>';
            return;
        }
        const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        const hourCounts = new Array(24).fill(0);
        const dayCounts = new Array(7).fill(0);
        const dayRev = new Array(7).fill(0);
        for (const o of orders) {
            const h = _orderHourInShopTz(o.created_at);
            const wd = _orderWeekdayInShopTz(o.created_at);
            if (h >= 0) hourCounts[h]++;
            if (wd >= 0) {
                dayCounts[wd]++;
                const v = parseFloat(o.total_price) || 0;
                dayRev[wd] += (typeof convertToUSD === 'function') ? convertToUSD(v, o.currency || 'USD') : v;
            }
        }
        const insights = [];

        // Best/worst day (only if difference is meaningful)
        const maxDay = dayCounts.indexOf(Math.max(...dayCounts));
        const minDay = dayCounts.indexOf(Math.min(...dayCounts));
        if (dayCounts[maxDay] >= dayCounts[minDay] * 1.5 + 2) {
            insights.push(`<strong>${dayNames[maxDay]}</strong> é o dia mais forte (${dayCounts[maxDay]} pedidos) — vende ${(dayCounts[maxDay] / Math.max(1, dayCounts[minDay])).toFixed(1)}× mais que <strong>${dayNames[minDay]}</strong>.`);
        }

        // Peak hour window
        const peakH = hourCounts.indexOf(Math.max(...hourCounts));
        if (hourCounts[peakH] >= 3) {
            const window = `${String(peakH).padStart(2,'0')}h–${String((peakH + 1) % 24).padStart(2,'0')}h`;
            const pct = ((hourCounts[peakH] / orders.length) * 100).toFixed(0);
            insights.push(`Hora pico: <strong>${window}</strong> concentra ${pct}% dos pedidos (${hourCounts[peakH]}).`);
        }

        // Country concentration
        const byCountry = new Map();
        for (const o of orders) {
            const cc = o.shipping_address?.country_code || '—';
            byCountry.set(cc, (byCountry.get(cc) || 0) + 1);
        }
        const topC = [...byCountry.entries()].sort((a, b) => b[1] - a[1])[0];
        if (topC && topC[1] / orders.length >= 0.5) {
            const pct = ((topC[1] / orders.length) * 100).toFixed(0);
            insights.push(`<strong>${topC[0]}</strong> domina o período: ${pct}% dos pedidos.`);
        }

        // Weekday vs weekend balance
        const wkd = dayCounts[1] + dayCounts[2] + dayCounts[3] + dayCounts[4] + dayCounts[5];
        const wke = dayCounts[0] + dayCounts[6];
        if (wkd > wke * 2.5) insights.push(`Vendas concentram em dias úteis: ${wkd} úteis vs ${wke} fim de semana.`);
        else if (wke > wkd) insights.push(`Fim de semana puxa as vendas: ${wke} sáb/dom vs ${wkd} dias úteis.`);

        if (!insights.length) {
            wrap.innerHTML = '<li>Sem padrões fortes detectados no período.</li>';
            return;
        }
        wrap.innerHTML = insights.map(t => `<li>${t}</li>`).join('');
    }

    function _renderPatterns() {
        _renderHeatmap();
        _renderWeekdayBars();
        _renderGeo();
        _renderFirstSale();
        _renderInsights();
        _renderMdgxRanking();
        if (window.lucide?.createIcons) lucide.createIcons();
    }

    // Aggregate orders by product (using line_items.product_id)
    function _aggregateByProduct(orders) {
        const byProd = {}; // shopifyProductId -> { sales, revenue, title }
        for (const o of (orders || [])) {
            const cur = o.currency || _state.currency || 'BRL';
            for (const li of (o.line_items || [])) {
                const pid = String(li.product_id || '');
                if (!pid) continue;
                const qty = li.quantity || 0;
                const unitPrice = parseFloat(li.price) || 0;
                if (!byProd[pid]) byProd[pid] = { sales: 0, revenue: 0, title: li.title || pid, currency: cur };
                byProd[pid].sales += qty;
                byProd[pid].revenue += unitPrice * qty;
            }
        }
        return byProd;
    }

    function _previousRange(from, to) {
        if (!from || !to) return { from: '', to: '' };
        const start = new Date(from + 'T00:00:00');
        const end = new Date(to + 'T00:00:00');
        const days = Math.round((end - start) / 86400000) + 1;
        const prevEnd = new Date(start);
        prevEnd.setDate(prevEnd.getDate() - 1);
        const prevStart = new Date(prevEnd);
        prevStart.setDate(prevStart.getDate() - (days - 1));
        const fmt = (d) => d.toISOString().slice(0, 10);
        return { from: fmt(prevStart), to: fmt(prevEnd) };
    }

    let _mdgxPrevCache = { key: '', orders: null };
    let _mdgxShowAll = false;

    async function _renderMdgxRanking() {
        const totalEl = document.getElementById('sales-mdgx-ranking-total');
        const compareEl = document.getElementById('sales-mdgx-ranking-compare');
        const listEl = document.getElementById('sales-mdgx-ranking-list');
        if (!listEl) return;

        const curOrders = _state.filtered || [];
        const curByProd = _aggregateByProduct(curOrders);
        const totalSales = Object.values(curByProd).reduce((s, p) => s + p.sales, 0);
        if (totalEl) totalEl.textContent = totalSales.toLocaleString('pt-BR');

        // Fetch previous period for comparison
        const { from: pFrom, to: pTo } = _previousRange(_state.from, _state.to);
        let prevByProd = {};
        let prevTotal = 0;
        let pairedHourLabel = '';
        if (pFrom && pTo && typeof ShopifyModule !== 'undefined' && ShopifyModule.fetchOrders) {
            // Raw orders from yesterday — cache normally
            const cacheKey = `${pFrom}|${pTo}`;
            try {
                let prevOrders;
                if (_mdgxPrevCache.key === cacheKey && _mdgxPrevCache.orders) {
                    prevOrders = _mdgxPrevCache.orders;
                } else {
                    prevOrders = await ShopifyModule.fetchOrders(pFrom, pTo, { silent: true });
                    _mdgxPrevCache = { key: cacheKey, orders: prevOrders }; // cache RAW (unfiltered)
                }

                // Apply the SAME active filters (país/produto/conta/cidade) to the previous
                // period — otherwise we'd compare filtered-current vs unfiltered-previous.
                prevOrders = (prevOrders || []).filter(_buildFilterPredicate());

                // PAIRED-HOUR COMPARISON: when current period is "today" (in progress), trim
                // previous-period orders to the same time-of-day window so the comparison is fair.
                const todayStr = _todayISO();
                const isSingleDay = _state.from === _state.to;
                const isTodayOrPartial = isSingleDay && _state.from === todayStr;
                if (isTodayOrPartial) {
                    const now = new Date();
                    const hh = String(now.getHours()).padStart(2, '0');
                    const mm = String(now.getMinutes()).padStart(2, '0');
                    pairedHourLabel = ` até ${hh}:${mm}`;
                    // Filter prev orders to only those whose created_at hour:min <= now's hour:min
                    const cutoffMins = now.getHours() * 60 + now.getMinutes();
                    prevOrders = (prevOrders || []).filter(o => {
                        if (!o.created_at) return true;
                        const d = new Date(o.created_at);
                        const oMins = d.getHours() * 60 + d.getMinutes();
                        return oMins <= cutoffMins;
                    });
                }

                prevByProd = _aggregateByProduct(prevOrders || []);
                prevTotal = Object.values(prevByProd).reduce((s, p) => s + p.sales, 0);
            } catch (e) { /* fail silently — no comparator */ }
        }

        // Total comparator badge
        if (compareEl) {
            if (prevTotal > 0) {
                const deltaPct = ((totalSales - prevTotal) / prevTotal) * 100;
                const sign = deltaPct >= 0 ? '+' : '';
                const cls = deltaPct > 0 ? 'mdgx-ranking-compare-up' :
                           deltaPct < 0 ? 'mdgx-ranking-compare-down' :
                           'mdgx-ranking-compare-neutral';
                const arrow = deltaPct > 0 ? '↑' : deltaPct < 0 ? '↓' : '→';
                compareEl.className = 'mdgx-ranking-compare ' + cls;
                const periodLbl = pairedHourLabel ? `ontem${pairedHourLabel}` : 'período anterior';
                compareEl.innerHTML = `${arrow} ${sign}${deltaPct.toFixed(1)}% vs ${periodLbl} (${prevTotal})`;
            } else if (totalSales > 0) {
                compareEl.className = 'mdgx-ranking-compare mdgx-ranking-compare-up';
                compareEl.innerHTML = `↑ Novo (sem período anterior)`;
            } else {
                compareEl.className = 'mdgx-ranking-compare mdgx-ranking-compare-neutral';
                compareEl.innerHTML = '';
            }
        }

        // Build ranked list
        const ranked = Object.entries(curByProd).map(([pid, info]) => {
            const prev = prevByProd[pid];
            const prevSales = prev?.sales || 0;
            let delta = null;
            if (prevSales === 0 && info.sales > 0) delta = { type: 'new', label: 'Novo' };
            else if (prevSales > 0) {
                const pct = ((info.sales - prevSales) / prevSales) * 100;
                if (pct > 0) delta = { type: 'up', label: `+${pct.toFixed(0)}%` };
                else if (pct < 0) delta = { type: 'down', label: `${pct.toFixed(0)}%` };
                else delta = { type: 'neutral', label: '0%' };
            }
            return {
                pid,
                title: info.title,
                sales: info.sales,
                revenue: info.revenue,
                currency: info.currency,
                avgPrice: info.sales > 0 ? info.revenue / info.sales : 0,
                delta,
            };
        }).filter(p => p.sales > 0).sort((a, b) => b.sales - a.sales);

        if (ranked.length === 0) {
            listEl.innerHTML = '<div class="mdgx-ranking-empty">Sem vendas no período.</div>';
            return;
        }

        // Get Shopify product cover images
        const shopifyProds = (typeof ShopifyModule !== 'undefined' && ShopifyModule.getShopifyProducts)
            ? ShopifyModule.getShopifyProducts() : [];
        const coverOf = (pid) => {
            const sp = shopifyProds.find(p => String(p.id) === String(pid));
            return sp?.image || '';
        };

        const fmtMoney = (v, cur) => {
            const sym = { BRL:'R$', USD:'$', EUR:'€', GBP:'£' }[cur] || (cur + ' ');
            return `${sym} ${(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        };

        const localProducts = AppState.allProducts || AppState.products || [];
        const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
        const localProductFor = (shopifyPid, title) => {
            // 1) by Shopify link, 2) by name match
            let lp = null;
            if (typeof ShopifyModule !== 'undefined' && ShopifyModule.getLink) {
                lp = localProducts.find(p => String(ShopifyModule.getLink(p.id)) === String(shopifyPid)) || null;
            }
            if (!lp && title) lp = localProducts.find(p => norm(p.name) === norm(title)) || null;
            return lp;
        };

        // Per-product conversions from the Diary (FB CSV + Shopify sync). No live FB needed.
        const convForProduct = (localId) => {
            if (!localId) return { fb: null, shopify: null };
            const from = _state.from, to = _state.to;
            const entries = (AppState.allDiary || AppState.diary || []).filter(d =>
                d.productId === localId && !d.isCampaign && !d.parentId &&
                (!from || d.date >= from) && (!to || d.date <= to)
            );
            let fbSales = 0, clicks = 0, shSales = 0, visits = 0;
            entries.forEach(d => {
                fbSales += Number(d.fbSales != null ? d.fbSales : (d.salesSource === 'shopify' ? 0 : d.sales)) || 0;
                clicks += Number(d.clicks || 0);
                shSales += Number(d.shopifySales != null ? d.shopifySales : (d.salesSource === 'shopify' ? d.sales : 0)) || 0;
                visits += Number(d.shopifyViews || d.pageViews || 0) || 0;
            });
            return {
                fb: clicks > 0 ? (fbSales / clicks) * 100 : null,
                shopify: visits > 0 ? (shSales / visits) * 100 : null,
            };
        };

        const total = ranked.length;
        const visibleCount = _mdgxShowAll ? total : Math.min(5, total);
        const visible = ranked.slice(0, visibleCount);

        let itemsHtml = visible.map(p => {
            const thumb = coverOf(p.pid);
            const deltaHtml = p.delta
                ? `<span class="mdgx-ranking-delta mdgx-ranking-delta-${p.delta.type}">${p.delta.label}</span>`
                : '';
            const lp = localProductFor(p.pid, p.title);
            const badges = (lp && typeof renderProductMetaBadges === 'function') ? renderProductMetaBadges(lp) : '';
            const conv = convForProduct(lp?.id);
            const convHtml = `<span class="mdgx-conv-chips">
                ${conv.fb != null ? `<span class="mdgx-conv-chip mdgx-conv-fb" title="Conversão Facebook = compras FB ÷ cliques FB"><svg class="brand-icon" viewBox="0 0 24 24" style="width:11px;height:11px;vertical-align:-2px"><path fill="#1877F2" d="M24 12.07C24 5.44 18.63.07 12 .07S0 5.44 0 12.07c0 5.99 4.39 10.95 10.13 11.85v-8.38H7.08v-3.47h3.05V9.43c0-3.01 1.79-4.67 4.53-4.67 1.31 0 2.69.24 2.69.24v2.95h-1.52c-1.49 0-1.96.93-1.96 1.87v2.25h3.33l-.53 3.47h-2.8v8.38C19.61 23.02 24 18.06 24 12.07z"/></svg> ${conv.fb.toFixed(1)}%</span>` : ''}
                ${conv.shopify != null ? `<span class="mdgx-conv-chip mdgx-conv-shop" title="Conversão Shopify = vendas ÷ visitas">🛍️ ${conv.shopify.toFixed(1)}%</span>` : ''}
            </span>`;
            // Campaign access buttons — open the campaign in a NEW TAB (no Mapa de Ads).
            // Country context = active País filter. Without filter, show one chip per country link.
            // Country context for per-country campaigns: only when exactly ONE country is selected
            const curCC = ((_state.countries || []).length === 1) ? String(_state.countries[0]).toUpperCase() : '';
            const byC = (lp && lp.campaignUrlsByCountry) || {};
            const campCount = (lp && typeof AdHierarchyModule !== 'undefined' && AdHierarchyModule.campaignCountForProduct)
                ? AdHierarchyModule.campaignCountForProduct(lp.id) : 0;
            const nameAttr = lp ? (lp.name || '').replace(/"/g, '&quot;') : '';
            const esc = (s) => String(s || '').replace(/"/g, '&quot;');
            let btnsInner = '';
            if (lp) {
                // Badge with the number of campaigns the link points to (selected_campaign_ids)
                const campBadge = (n) => n ? `<span class="mdgx-camp-count" title="${n} campanha${n !== 1 ? 's' : ''} no link">${n}</span>` : '';
                if (curCC) {
                    // País filter active → operate on that country (fallback to generic for opening)
                    const url = _buildCampaignUrl(lp, curCC);
                    if (url) {
                        const n = _campaignCountFromUrl(url);
                        btnsInner = `<a class="mdgx-ranking-btn mdgx-ranking-btn-go" href="${esc(url)}" target="_blank" rel="noopener" title="Abrir ${n || ''} campanha${n !== 1 ? 's' : ''} ${curCC} em nova guia" onclick="event.stopPropagation()"><i data-lucide="external-link" style="width:13px;height:13px"></i><span class="mdgx-cc-tag">${curCC}</span>${campBadge(n)}</a>
                            <button class="mdgx-ranking-btn" data-set-camp-url="${lp.id}" data-set-camp-name="${nameAttr}" data-set-camp-country="${curCC}" title="Editar link da campanha (${curCC})"><i data-lucide="pencil" style="width:12px;height:12px"></i></button>`;
                    } else {
                        btnsInner = `<button class="mdgx-ranking-btn mdgx-ranking-btn-setlink" data-set-camp-url="${lp.id}" data-set-camp-name="${nameAttr}" data-set-camp-country="${curCC}" title="Colar link da campanha de ${curCC}"><i data-lucide="link" style="width:13px;height:13px"></i><span class="mdgx-cc-tag">${curCC}</span></button>
                            <button class="mdgx-ranking-btn" data-map-product="${lp.id}" title="Ver campanhas no Mapa de Ads"><i data-lucide="git-fork" style="width:13px;height:13px"></i></button>`;
                    }
                } else {
                    // No filter → a chip per country link, plus the generic, plus add/manage
                    const ccList = Object.keys(byC).filter(cc => String(byC[cc]).trim());
                    const ccChips = ccList.map(cc => {
                        const n = _campaignCountFromUrl(byC[cc]);
                        return `<a class="mdgx-ranking-btn mdgx-ranking-btn-go mdgx-ranking-btn-cc" href="${esc(byC[cc])}" target="_blank" rel="noopener" title="Abrir ${n || ''} campanha${n !== 1 ? 's' : ''} ${cc} em nova guia" onclick="event.stopPropagation()"><i data-lucide="external-link" style="width:11px;height:11px"></i><span class="mdgx-cc-tag">${cc}</span>${campBadge(n)}</a>`;
                    }).join('');
                    const generic = (lp.campaignGroupUrl || '').trim();
                    const genN = _campaignCountFromUrl(generic) || campCount;
                    const genChip = generic
                        ? `<a class="mdgx-ranking-btn mdgx-ranking-btn-go" href="${esc(generic)}" target="_blank" rel="noopener" title="Abrir campanha padrão em nova guia" onclick="event.stopPropagation()"><i data-lucide="external-link" style="width:13px;height:13px"></i>${campBadge(genN)}</a>`
                        : '';
                    const addBtn = `<button class="mdgx-ranking-btn ${(ccChips||genChip) ? '' : 'mdgx-ranking-btn-setlink'}" data-set-camp-url="${lp.id}" data-set-camp-name="${nameAttr}" title="Adicionar/editar link da campanha (por país)"><i data-lucide="${(ccChips||genChip) ? 'plus' : 'link'}" style="width:12px;height:12px"></i></button>`;
                    const mapBtn = (!ccChips && !genChip) ? `<button class="mdgx-ranking-btn" data-map-product="${lp.id}" title="Ver campanhas no Mapa de Ads"><i data-lucide="git-fork" style="width:13px;height:13px"></i></button>` : '';
                    btnsInner = ccChips + genChip + addBtn + mapBtn;
                }
            }
            const btns = `<span class="mdgx-ranking-actions">${btnsInner}</span>`;
            return `<div class="mdgx-ranking-item">
                ${thumb
                    ? `<img class="mdgx-ranking-thumb" src="${thumb}" alt="">`
                    : '<div class="mdgx-ranking-thumb-empty"><i data-lucide="package" style="width:22px;height:22px"></i></div>'
                }
                <div class="mdgx-ranking-info">
                    <div class="mdgx-ranking-name" title="${(p.title || '').replace(/"/g, '&quot;')}">${p.title || p.pid}${badges}</div>
                    <div class="mdgx-ranking-meta">
                        <span class="mdgx-ranking-price">${fmtMoney(p.avgPrice, p.currency)}</span>
                        <span class="mdgx-ranking-sold">${p.sales} Vendido${p.sales !== 1 ? 's' : ''}</span>
                        ${convHtml}
                    </div>
                </div>
                ${btns}
                ${deltaHtml}
            </div>`;
        }).join('');

        // "Ver mais N" / "Mostrar menos" footer (inline expand without leaving page)
        if (total > 5) {
            if (_mdgxShowAll) {
                itemsHtml += `<button type="button" class="mdgx-ranking-expand" id="mdgx-ranking-collapse-btn">
                    <i data-lucide="chevron-up" style="width:13px;height:13px"></i> Mostrar menos
                </button>`;
            } else {
                const hidden = total - visibleCount;
                itemsHtml += `<button type="button" class="mdgx-ranking-expand" id="mdgx-ranking-expand-btn">
                    <i data-lucide="chevron-down" style="width:13px;height:13px"></i> Ver mais ${hidden} produto${hidden !== 1 ? 's' : ''}
                </button>`;
            }
        }

        listEl.innerHTML = itemsHtml;

        document.getElementById('mdgx-ranking-expand-btn')?.addEventListener('click', () => {
            _mdgxShowAll = true;
            _renderMdgxRanking();
        });
        document.getElementById('mdgx-ranking-collapse-btn')?.addEventListener('click', () => {
            _mdgxShowAll = false;
            _renderMdgxRanking();
            // Scroll back to ranking header
            document.getElementById('sales-mdgx-ranking-list')?.scrollIntoView({ behavior:'smooth', block:'center' });
        });

        // "Ver campanhas no Mapa de Ads" buttons → switch tab + select product
        listEl.querySelectorAll('[data-map-product]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pid = btn.dataset.mapProduct;
                document.querySelectorAll('[data-tab="ad-hierarchy"]').forEach(b => b.click());
                setTimeout(() => {
                    if (typeof AdHierarchyModule !== 'undefined' && AdHierarchyModule.focusProduct) {
                        AdHierarchyModule.focusProduct(pid);
                    }
                }, 200);
            });
        });

        // "+" add campaign inline (without leaving for Mapa de Ads)
        listEl.querySelectorAll('[data-add-campaign]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pid = btn.dataset.addCampaign;
                const prodName = btn.dataset.addCampaignName || '';
                const name = prompt(`Nova campanha para "${prodName}":`);
                if (!name) return;
                if (typeof AdHierarchyModule !== 'undefined' && AdHierarchyModule.addCampaignForProduct) {
                    const ok = AdHierarchyModule.addCampaignForProduct(pid, name);
                    if (ok && typeof showToast === 'function') showToast(`Campanha "${name}" adicionada a ${prodName}`, 'success');
                    _renderMdgxRanking(); // refresh campaign count
                }
            });
        });

        // "🔗 / ✏️ / ➕" paste/edit the campaign link directly here → saved on the product.
        // data-set-camp-country carries the active País filter (per-country campaign).
        listEl.querySelectorAll('[data-set-camp-url]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const pid = btn.dataset.setCampUrl;
                _promptCampaignUrl(pid, btn.dataset.setCampName || '', btn.dataset.setCampCountry || '');
            });
        });

        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    }

    function _bindPatternsToggle() {
        const toggle = document.getElementById('sales-patterns-toggle');
        const body = document.getElementById('sales-patterns-body');
        if (!toggle || !body) return;
        toggle.addEventListener('click', () => {
            const open = body.style.display !== 'none';
            body.style.display = open ? 'none' : '';
            toggle.textContent = open ? '▶' : '▼';
        });
    }

    // ── Filters ──────────────────────────────────────────────────
    // Build a predicate (order) => boolean from the CURRENT filter state.
    // Reused for both the current period AND the previous period (fair comparison).
    function _buildFilterPredicate() {
        const ccSet = new Set((_state.countries || []).map(c => String(c).toUpperCase()));
        const pf = String(_state.productFilter || '');
        const city = _state.cityFilter || '';
        const acc = _state.accountFilter || ''; // "fb:<id>" or "google:<id>"

        // Pre-compute which local products match the selected account
        let accProductIds = null;
        if (acc) {
            const [plat, accId] = acc.split(':');
            const localProducts = AppState.allProducts || AppState.products || [];
            accProductIds = new Set();
            localProducts.forEach(p => {
                const ids = plat === 'fb' ? (p.fbAdAccountIds || []) : (p.googleAdAccountIds || []);
                if (ids.map(String).includes(String(accId))) {
                    // store the product's shopify id (linked) so we match orders
                    const sid = (typeof ShopifyModule !== 'undefined' && ShopifyModule.getLink) ? ShopifyModule.getLink(p.id) : null;
                    if (sid) accProductIds.add(String(sid));
                    accProductIds.add('__name__' + String(p.name || '').toLowerCase().trim());
                }
            });
        }
        const normT = (s) => String(s || '').toLowerCase().trim();

        return (o) => {
            if (ccSet.size) {
                const cc = (o.shipping_address?.country_code || '').toUpperCase();
                if (!ccSet.has(cc)) return false;
            }
            if (pf) {
                const has = (o.line_items || []).some(li => String(li.product_id || '') === pf);
                if (!has) return false;
            }
            if (city) {
                if ((o.shipping_address?.city || '') !== city) return false;
            }
            if (accProductIds) {
                const has = (o.line_items || []).some(li =>
                    accProductIds.has(String(li.product_id || '')) ||
                    accProductIds.has('__name__' + normT(li.title))
                );
                if (!has) return false;
            }
            return true;
        };
    }

    function _applyFilters() {
        _state.filtered = _state.orders.filter(_buildFilterPredicate());
        _sortFiltered();
        _state.displayed = PAGE_SIZE;
    }

    function _sortFiltered() {
        const key = _state.sortKey || 'created_at';
        const dir = _state.sortDir === 'asc' ? 1 : -1;

        // Helper: parse order number ("#14175") → 14175 for numeric sort
        const orderNum = (o) => {
            const s = String(o.name || '').replace(/[^\d]/g, '');
            return s ? Number(s) : 0;
        };
        // Helper: extract the hour-of-day (0-23) in the customer's local timezone
        const customerHour = (o) => {
            try {
                const addr = o.shipping_address || {};
                const tz = (window.CountryTZ?.tzForOrder?.(addr));
                if (!tz || !o.created_at) return -1;
                const s = new Date(o.created_at).toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false });
                const h = parseInt(s, 10);
                return Number.isNaN(h) ? -1 : h;
            } catch { return -1; }
        };

        _state.filtered.sort((a, b) => {
            let av, bv;
            switch (key) {
                case 'name':
                    return (orderNum(a) - orderNum(b)) * dir;
                case 'created_at':
                    av = a.created_at || '';
                    bv = b.created_at || '';
                    return av < bv ? -dir : av > bv ? dir : 0;
                case 'customer_local':
                    return (customerHour(a) - customerHour(b)) * dir;
                case 'total_price':
                    return ((Number(a.total_price) || 0) - (Number(b.total_price) || 0)) * dir;
                case 'country':
                    av = (a.shipping_address?.country || '').toLowerCase();
                    bv = (b.shipping_address?.country || '').toLowerCase();
                    return av < bv ? -dir : av > bv ? dir : 0;
                case 'city':
                    av = (a.shipping_address?.city || '').toLowerCase();
                    bv = (b.shipping_address?.city || '').toLowerCase();
                    return av < bv ? -dir : av > bv ? dir : 0;
                case 'product':
                    av = ((a.line_items?.[0]?.title) || '').toLowerCase();
                    bv = ((b.line_items?.[0]?.title) || '').toLowerCase();
                    return av < bv ? -dir : av > bv ? dir : 0;
                case 'items':
                    av = (a.line_items || []).reduce((s, li) => s + (li.quantity || 0), 0);
                    bv = (b.line_items || []).reduce((s, li) => s + (li.quantity || 0), 0);
                    return (av - bv) * dir;
                case 'status':
                    av = (a.financial_status || '').toLowerCase();
                    bv = (b.financial_status || '').toLowerCase();
                    return av < bv ? -dir : av > bv ? dir : 0;
                default:
                    return 0;
            }
        });
    }

    function _updateSortIndicators() {
        document.querySelectorAll('.sales-table th[data-sort]').forEach(th => {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === _state.sortKey) {
                th.classList.add(_state.sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
    }

    // ── Render: summary + table ──────────────────────────────────
    function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    function _renderSummary() {
        const wrap = document.getElementById('sales-summary');
        if (!wrap) return;
        const orders = _state.filtered;
        const totalOrders = orders.length;
        const totalRevenue = orders.reduce((s, o) => s + (Number(o.total_price) || 0), 0);
        const itemsTotal = orders.reduce((s, o) => s + (o.line_items || []).reduce((a, li) => a + (li.quantity || 0), 0), 0);
        const avgTicket = totalOrders ? totalRevenue / totalOrders : 0;

        // Top country
        const byCountry = new Map();
        for (const o of orders) {
            const c = o.shipping_address?.country || '—';
            byCountry.set(c, (byCountry.get(c) || 0) + 1);
        }
        const topCountry = [...byCountry.entries()].sort((a, b) => b[1] - a[1])[0];

        // Peak hour (in shop TZ)
        const byHour = new Array(24).fill(0);
        for (const o of orders) {
            try {
                const h = parseInt(new Date(o.created_at).toLocaleString('en-US', { timeZone: _state.shopTz, hour: '2-digit', hour12: false }), 10);
                if (!isNaN(h)) byHour[h]++;
            } catch {}
        }
        let peakHour = 0;
        for (let h = 0; h < 24; h++) if (byHour[h] > byHour[peakHour]) peakHour = h;

        // Best/worst weekday
        const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        const byDay = new Array(7).fill(0);
        for (const o of orders) {
            try {
                const dStr = new Date(o.created_at).toLocaleString('en-US', { timeZone: _state.shopTz, weekday: 'short' });
                const idx = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(dStr);
                if (idx >= 0) byDay[idx]++;
            } catch {}
        }
        const maxDayIdx = byDay.indexOf(Math.max(...byDay));
        const minDayIdx = byDay.reduce((mi, v, i, a) => v < a[mi] ? i : mi, 0);

        const noData = !totalOrders;
        wrap.innerHTML = `
            <div class="sales-stat-card">
                <span class="sales-stat-lbl">Pedidos</span>
                <span class="sales-stat-val">${_fmtNumber(totalOrders)}</span>
                <span class="sales-stat-sub">${_fmtNumber(itemsTotal)} itens</span>
            </div>
            <div class="sales-stat-card">
                <span class="sales-stat-lbl">Receita</span>
                <span class="sales-stat-val">${_fmtMoney(totalRevenue)}</span>
                <span class="sales-stat-sub">Ticket médio ${_fmtMoney(avgTicket)}</span>
            </div>
            <div class="sales-stat-card">
                <span class="sales-stat-lbl">Top país</span>
                <span class="sales-stat-val">${noData ? '—' : _esc(topCountry?.[0] || '—')}</span>
                <span class="sales-stat-sub">${noData ? '' : `${topCountry?.[1] || 0} pedidos`}</span>
            </div>
            <div class="sales-stat-card">
                <span class="sales-stat-lbl">Hora pico (loja)</span>
                <span class="sales-stat-val">${noData ? '—' : `${String(peakHour).padStart(2,'0')}h`}</span>
                <span class="sales-stat-sub">${noData ? '' : `${byHour[peakHour]} pedidos`}</span>
            </div>
            <div class="sales-stat-card">
                <span class="sales-stat-lbl">Melhor dia</span>
                <span class="sales-stat-val">${noData ? '—' : dayNames[maxDayIdx]}</span>
                <span class="sales-stat-sub">${noData ? '' : `${byDay[maxDayIdx]} pedidos`}</span>
            </div>
            <div class="sales-stat-card">
                <span class="sales-stat-lbl">Pior dia</span>
                <span class="sales-stat-val">${noData ? '—' : dayNames[minDayIdx]}</span>
                <span class="sales-stat-sub">${noData ? '' : `${byDay[minDayIdx]} pedidos`}</span>
            </div>`;
    }

    function _renderTable() {
        const tbody = document.getElementById('sales-tbody');
        const more = document.getElementById('btn-sales-load-more');
        if (!tbody) return;

        const orders = _state.filtered;
        if (!orders.length) {
            tbody.innerHTML = `<tr><td colspan="9" class="sales-empty">${_state.loaded ? 'Nenhum pedido encontrado nesse filtro.' : 'Conecte o Shopify e clique em "Atualizar".'}</td></tr>`;
            if (more) more.style.display = 'none';
            return;
        }

        // Compact platform-icon + clickable product helper (no extra column)
        const localProducts = AppState.allProducts || AppState.products || [];
        const normP = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
        const localFor = (pid, title) => {
            let lp = null;
            if (typeof ShopifyModule !== 'undefined' && ShopifyModule.getLink) {
                lp = localProducts.find(p => String(ShopifyModule.getLink(p.id)) === String(pid)) || null;
            }
            if (!lp && title) lp = localProducts.find(p => normP(p.name) === normP(title)) || null;
            return lp;
        };
        const platMiniIcons = (lp) => {
            if (!lp) return '';
            const plats = Array.isArray(lp.platforms) ? lp.platforms : [];
            const fbIds = lp.fbAdAccountIds || [];
            const gIds = lp.googleAdAccountIds || [];
            if (!plats.length && !fbIds.length && !gIds.length) return '';
            const icon = (b) => (typeof BRAND_ICONS !== 'undefined' && BRAND_ICONS[b]) ? `<span style="display:inline-block;width:13px;height:13px;vertical-align:-2px">${BRAND_ICONS[b]}</span>` : '';
            const html = plats.map(icon).join('');
            // Build detailed tooltip with account names
            const fbName = (id) => (lp.fbAdAccountLabels && lp.fbAdAccountLabels[id]) || (typeof fbAdAccountName === 'function' ? fbAdAccountName(id, lp.fbAdAccountLabels) : id);
            const gName = (id) => (lp.googleAdAccountLabels && lp.googleAdAccountLabels[id]) || id;
            const platLabels = plats.map(p => ({facebook:'Facebook',google:'Google',tiktok:'TikTok',instagram:'Instagram',youtube:'YouTube',pinterest:'Pinterest'}[p] || p));
            const tipParts = [];
            if (platLabels.length) tipParts.push('Plataformas: ' + platLabels.join(', '));
            if (fbIds.length) tipParts.push('FB: ' + fbIds.map(id => `${fbName(String(id))} (${id})`).join(', '));
            if (gIds.length) tipParts.push('Google: ' + gIds.map(id => `${gName(String(id))} (${id})`).join(', '));
            const tip = tipParts.join(' · ').replace(/"/g, '&quot;');
            const accNote = (fbIds.length || gIds.length) ? `<span class="sales-prod-acc">${fbIds.length ? 'FB·'+fbIds.length : ''}${fbIds.length && gIds.length ? ' ' : ''}${gIds.length ? 'G·'+gIds.length : ''}</span>` : '';
            return `<span class="sales-prod-plats" title="${tip}">${html}${accNote}</span>`;
        };
        const productCellItems = (o) => {
            const orderCC = (o.shipping_address?.country_code || '').toUpperCase();
            return (o.line_items || []).map(li => {
                const lp = localFor(li.product_id, li.title);
                const title = `${_esc(li.title || '—')} ×${li.quantity}`;
                if (lp) {
                    // Open the campaign for THIS order's country (falls back to the generic link)
                    const campUrl = _buildCampaignUrl(lp, orderCC);
                    if (campUrl) {
                        const hasCountry = lp.campaignUrlsByCountry && lp.campaignUrlsByCountry[orderCC];
                        const tip = hasCountry ? `Abrir campanha de ${_esc(lp.name)} — ${orderCC} (nova guia)` : `Abrir campanha de ${_esc(lp.name)} em nova guia`;
                        return `<a class="sales-prod-link" href="${campUrl.replace(/"/g, '&quot;')}" target="_blank" rel="noopener" title="${tip}">${title}${platMiniIcons(lp)}</a>`;
                    }
                    return `<span class="sales-prod-link" data-map-product="${lp.id}" title="Ver campanhas de ${_esc(lp.name)}">${title}${platMiniIcons(lp)}</span>`;
                }
                return title;
            }).join('<br>');
        };

        const slice = orders.slice(0, _state.displayed);
        tbody.innerHTML = slice.map(o => {
            const addr = o.shipping_address || {};
            const tz = (window.CountryTZ?.tzForOrder?.(addr)) || null;
            const items = productCellItems(o);
            const totalQty = (o.line_items || []).reduce((s, li) => s + (li.quantity || 0), 0);
            const status = o.financial_status || 'PAID';
            const country = addr.country_code ? `${addr.country_code}` : (addr.country || '—');
            const city = addr.city || '—';
            const tzNote = tz ? `<span class="sales-tz-note">${_tzShort(tz)}</span>` : '<span class="sales-tz-note sales-tz-warn">tz?</span>';
            return `<tr>
                <td><strong>${_esc(o.name)}</strong></td>
                <td>${_fmtInTz(o.created_at, _state.shopTz)}</td>
                <td>${tz ? _fmtInTz(o.created_at, tz) : '—'} ${tzNote}</td>
                <td>${_esc(country)}</td>
                <td>${_esc(city)}</td>
                <td class="sales-items-cell">${items}</td>
                <td class="num">${_fmtNumber(totalQty)}</td>
                <td class="num">${_fmtMoney(o.total_price, o.currency)}</td>
                <td><span class="sales-status sales-status-${String(status).toLowerCase()}">${_esc(status)}</span></td>
            </tr>`;
        }).join('');

        if (more) {
            const remaining = orders.length - _state.displayed;
            more.style.display = remaining > 0 ? '' : 'none';
            more.textContent = remaining > 0 ? `Mostrar mais (${remaining} restantes)` : '';
        }

        // Clickable product → Mapa de Ads (campaigns)
        tbody.querySelectorAll('.sales-prod-link[data-map-product]').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const pid = el.dataset.mapProduct;
                document.querySelectorAll('[data-tab="ad-hierarchy"]').forEach(b => b.click());
                setTimeout(() => {
                    if (typeof AdHierarchyModule !== 'undefined' && AdHierarchyModule.focusProduct) AdHierarchyModule.focusProduct(pid);
                }, 200);
            });
        });

        _updateSortIndicators();
    }

    function _populateFilters() {
        const orders = _state.orders;
        const ccSet = new Set((_state.countries || []).map(c => String(c).toUpperCase()));
        const productSel = document.getElementById('sales-product-filter');
        const citySel = document.getElementById('sales-city-filter');

        // País agora é multi-select (dropdown com checkboxes) — populado à parte
        _populateCountryDropdowns();

        if (productSel) {
            const products = new Map();
            for (const o of orders) {
                for (const li of (o.line_items || [])) {
                    if (li.product_id && !products.has(String(li.product_id))) {
                        products.set(String(li.product_id), li.title || `#${li.product_id}`);
                    }
                }
            }
            const sorted = [...products.entries()].sort((a, b) => a[1].localeCompare(b[1]));
            const cur = productSel.value;
            productSel.innerHTML = '<option value="">Todos</option>' + sorted.map(([id, n]) => `<option value="${id}">${_esc(n)}</option>`).join('');
            if (cur) productSel.value = cur;
        }

        if (citySel) {
            // Cities scoped to selected countries (all orders if no country filter)
            const base = ccSet.size ? orders.filter(o => ccSet.has((o.shipping_address?.country_code || '').toUpperCase())) : orders;
            const cities = new Map();
            for (const o of base) {
                const c = o.shipping_address?.city || '';
                if (c && !cities.has(c)) cities.set(c, c);
            }
            const sorted = [...cities.entries()].sort((a, b) => a[0].localeCompare(b[0]));
            const cur = citySel.value;
            citySel.innerHTML = '<option value="">Todas</option>' + sorted.map(([c]) => `<option value="${_esc(c)}">${_esc(c)}</option>`).join('');
            // Restore selection only if still valid in the new list
            if (cur && sorted.some(([c]) => c === cur)) {
                citySel.value = cur;
            } else {
                citySel.value = '';
                _state.cityFilter = '';
            }
        }

        // Ad account filter — list all FB + Google accounts across products (with names)
        const accSel = document.getElementById('sales-account-filter');
        if (accSel) {
            const localProducts = AppState.allProducts || AppState.products || [];
            const fbName = (id, p) => (p.fbAdAccountLabels && p.fbAdAccountLabels[id]) ||
                (typeof fbAdAccountName === 'function' ? fbAdAccountName(id, p.fbAdAccountLabels) : id);
            const gName = (id, p) => (p.googleAdAccountLabels && p.googleAdAccountLabels[id]) || id;
            const fbOpts = new Map(); // value -> label
            const gOpts = new Map();
            localProducts.forEach(p => {
                (p.fbAdAccountIds || []).forEach(id => { if (id) fbOpts.set('fb:' + id, fbName(String(id), p)); });
                (p.googleAdAccountIds || []).forEach(id => { if (id) gOpts.set('google:' + id, gName(String(id), p)); });
            });
            const cur = accSel.value;
            let html = '<option value="">Todas</option>';
            if (fbOpts.size) {
                html += '<optgroup label="Facebook">' + [...fbOpts.entries()].map(([v, n]) => `<option value="${v}">${_esc(n)}</option>`).join('') + '</optgroup>';
            }
            if (gOpts.size) {
                html += '<optgroup label="Google">' + [...gOpts.entries()].map(([v, n]) => `<option value="${v}">${_esc(n)}</option>`).join('') + '</optgroup>';
            }
            accSel.innerHTML = html;
            if (cur) accSel.value = cur;
        }

        // Mirror options into the compact segmentation bar (keeps both in sync)
        const _mirror = (mainId, mirId, allLabel, stateKey) => {
            const main = document.getElementById(mainId);
            const mir = document.getElementById(mirId);
            if (!main || !mir) return;
            // Clone main's options but relabel the first "Todos/Todas" with a clearer prefix
            mir.innerHTML = main.innerHTML;
            const first = mir.querySelector('option[value=""]');
            if (first) first.textContent = allLabel;
            mir.value = _state[stateKey] || '';
        };
        _mirror('sales-product-filter', 'sales-viz-product-filter', 'Produto: todos', 'productFilter');
        _mirror('sales-account-filter', 'sales-viz-account-filter', 'Conta: todas', 'accountFilter');

        // Keep top selects reflecting state too (in case set programmatically)
        if (productSel) productSel.value = _state.productFilter || '';
        if (citySel) citySel.value = _state.cityFilter || '';
        if (accSel) accSel.value = _state.accountFilter || '';
    }

    // Populate the País multi-select dropdowns (top + segmentation bar) from orders.
    function _populateCountryDropdowns() {
        const orders = _state.orders || [];
        const countries = new Map();
        for (const o of orders) {
            const cc = (o.shipping_address?.country_code || '').toUpperCase();
            const name = o.shipping_address?.country || cc;
            if (cc && !countries.has(cc)) countries.set(cc, name);
        }
        const sorted = [...countries.entries()].sort((a, b) => a[1].localeCompare(b[1]));
        const sel = new Set((_state.countries || []).map(c => String(c).toUpperCase()));
        document.querySelectorAll('.ms-dropdown[data-ms-target="country"]').forEach(wrap => {
            const list = wrap.querySelector('.ms-dropdown-list');
            const label = wrap.querySelector('.ms-dropdown-label');
            if (list) {
                list.innerHTML = sorted.length
                    ? sorted.map(([cc, n]) => `<label class="ms-dropdown-opt"><input type="checkbox" value="${cc}" ${sel.has(cc) ? 'checked' : ''}><span>${_esc(n)} (${cc})</span></label>`).join('')
                    : '<div class="ms-dropdown-empty">Sem países nos pedidos</div>';
            }
            if (label) {
                const compact = wrap.classList.contains('ms-dropdown-compact');
                const prefix = compact ? 'País: ' : '';
                if (sel.size === 0) label.textContent = compact ? 'País: todos' : 'Todos';
                else if (sel.size === 1) label.textContent = prefix + [...sel][0];
                else label.textContent = prefix + `${[...sel][0]} +${sel.size - 1}`;
            }
        });
    }

    // ── Load orders ──────────────────────────────────────────────
    async function _loadOrders(force = false) {
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured?.()) {
            _state.orders = [];
            _state.loaded = true;
            _applyFilters();
            _renderSummary();
            _renderTable();
            return;
        }
        _state.loading = true;
        // Show loading state on the refresh button
        const refreshBtn = document.getElementById('btn-sales-refresh');
        if (refreshBtn) {
            refreshBtn.dataset.origHtml = refreshBtn.dataset.origHtml || refreshBtn.innerHTML;
            refreshBtn.innerHTML = '<i data-lucide="loader-2" style="width:13px;height:13px;animation:spin 1s linear infinite"></i> Carregando…';
            refreshBtn.disabled = true;
            if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
        }
        try {
            // Pull shop info for TZ + currency
            try {
                const cfg = ShopifyModule.getConfig?.();
                _state.shopTz = cfg?.shopTimezone || 'UTC';
                _state.shopName = cfg?.shopName || '';
                _state.currency = cfg?.shopCurrency || '';
            } catch {}

            const orders = await ShopifyModule.fetchOrders(_state.from, _state.to, { force });
            _state.orders = orders || [];
            _state.loaded = true;
            _applyFilters();
            _populateFilters();
            _renderSummary();
            _renderTable();
            _renderCalculator();
            _renderPatterns();
            _renderShopTzBadge();
            _refreshActiveViz();
        } catch (err) {
            console.error('[sales] load error', err);
            if (typeof showToast === 'function') showToast('Falha ao buscar vendas: ' + err.message, 'error');
        } finally {
            _state.loading = false;
            const btn = document.getElementById('btn-sales-refresh');
            if (btn && btn.dataset.origHtml) {
                btn.innerHTML = btn.dataset.origHtml;
                btn.disabled = false;
                if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
            }
        }
    }

    function _renderShopTzBadge() {
        const el = document.getElementById('sales-shop-tz');
        if (!el) return;
        if (_state.shopTz && _state.shopName) {
            el.textContent = `${_state.shopName} · ${_tzShort(_state.shopTz)}`;
        } else if (_state.shopTz) {
            el.textContent = _tzShort(_state.shopTz);
        } else {
            el.textContent = '';
        }
    }

    // ── CSV export ───────────────────────────────────────────────
    function _exportCsv() {
        const orders = _state.filtered;
        if (!orders.length) { if (typeof showToast === 'function') showToast('Nada para exportar', 'error'); return; }
        const cols = ['Pedido', 'Hora loja', 'Hora cliente', 'TZ cliente', 'País', 'Estado', 'Cidade', 'Produtos', 'Qtd', 'Valor', 'Moeda', 'Status'];
        const lines = [cols.map(_csvEsc).join(',')];
        for (const o of orders) {
            const addr = o.shipping_address || {};
            const tz = window.CountryTZ?.tzForOrder?.(addr) || '';
            const items = (o.line_items || []).map(li => `${li.title} x${li.quantity}`).join('; ');
            const qty = (o.line_items || []).reduce((s, li) => s + (li.quantity || 0), 0);
            lines.push([
                o.name,
                _fmtInTz(o.created_at, _state.shopTz),
                tz ? _fmtInTz(o.created_at, tz) : '',
                tz,
                addr.country || '',
                addr.province || '',
                addr.city || '',
                items,
                qty,
                o.total_price || 0,
                o.currency || '',
                o.financial_status || '',
            ].map(_csvEsc).join(','));
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `vendas-${_state.from || 'all'}-${_state.to || 'all'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function _csvEsc(v) {
        const s = String(v ?? '');
        if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
        return s;
    }

    // ── Dashboard widget ─────────────────────────────────────────
    let _dashState = { loading: false, lastFetched: 0 };
    const DASH_CACHE_MS = 60 * 1000; // throttle dashboard fetches to 1/min

    async function renderDashWidget(force = false) {
        const body = document.getElementById('dash-sales-widget');
        if (!body) return;
        const wrap = document.getElementById('dash-sales-body');
        if (!wrap) return;

        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured?.()) {
            wrap.innerHTML = '<p class="imp-hint" style="padding:1rem 0">Conecte o Shopify em Diagnóstico para ver vendas em tempo real.</p>';
            return;
        }

        if (_dashState.loading) return;
        const now = Date.now();
        if (!force && now - _dashState.lastFetched < DASH_CACHE_MS && wrap.dataset.rendered === '1') return;

        _dashState.loading = true;
        wrap.innerHTML = '<p class="imp-hint" style="padding:1rem 0">Carregando vendas…</p>';

        try {
            const cfg = ShopifyModule.getConfig?.() || {};
            const shopTz = cfg.shopTimezone || 'UTC';
            const currency = cfg.shopCurrency || 'BRL';

            // Compute today + last 7 days in shop TZ
            const today = _todayInTz(shopTz);
            const weekAgo = _addDaysISO(today, -6);
            const orders = await ShopifyModule.fetchOrders(weekAgo, today);

            // Bucket by date in shop TZ
            const byDay = new Map();
            for (let i = 0; i < 7; i++) {
                const d = _addDaysISO(today, -i);
                byDay.set(d, { date: d, count: 0, revenueUSD: 0 });
            }
            for (const o of (orders || [])) {
                const d = _toShopDate(o.created_at, shopTz);
                if (!byDay.has(d)) continue;
                const e = byDay.get(d);
                e.count++;
                const v = parseFloat(o.total_price) || 0;
                e.revenueUSD += (typeof convertToUSD === 'function') ? convertToUSD(v, o.currency || 'USD') : v;
            }

            const todayBucket = byDay.get(today);
            const todayOrders = (orders || []).filter(o => _toShopDate(o.created_at, shopTz) === today);
            const yesterday = _addDaysISO(today, -1);
            const yesterdayBucket = byDay.get(yesterday);

            // Hour pico hoje
            const byHour = new Array(24).fill(0);
            for (const o of todayOrders) {
                const h = _hourInTz(o.created_at, shopTz);
                if (h >= 0 && h < 24) byHour[h]++;
            }
            let peakHour = -1;
            for (let h = 0; h < 24; h++) if (byHour[h] > 0 && (peakHour < 0 || byHour[h] > byHour[peakHour])) peakHour = h;

            // Top país hoje (or last 7d if no orders today)
            const orderSet = todayOrders.length ? todayOrders : (orders || []);
            const byCountry = new Map();
            for (const o of orderSet) {
                const c = o.shipping_address?.country_code || o.shipping_address?.country || '—';
                byCountry.set(c, (byCountry.get(c) || 0) + 1);
            }
            const topCountry = [...byCountry.entries()].sort((a, b) => b[1] - a[1])[0];

            // Sparkline normalisation
            const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
            const maxCount = Math.max(...days.map(d => d.count), 1);

            // Today vs yesterday delta
            const deltaPct = (yesterdayBucket?.count > 0) ? Math.round(((todayBucket.count - yesterdayBucket.count) / yesterdayBucket.count) * 100) : null;

            // Breakeven progress (if calc has data)
            let breakevenLine = '';
            const calc = _state.calc;
            if (calc.spend > 0) {
                const auto = (() => {
                    // reuse autoMargin logic on todayOrders
                    const tmpFiltered = _state.filtered;
                    _state.filtered = todayOrders; _state.shopTz = shopTz;
                    const r = _autoMarginPerSale();
                    _state.filtered = tmpFiltered;
                    return r;
                })();
                const marginUSD = (calc.marginOverride != null && !isNaN(calc.marginOverride))
                    ? ((typeof convertToUSD === 'function') ? convertToUSD(calc.marginOverride, calc.spendCurrency || 'BRL') : calc.marginOverride)
                    : (auto ? auto.marginUSD : null);
                const spendUSD = (typeof convertToUSD === 'function') ? convertToUSD(calc.spend, calc.spendCurrency || 'BRL') : calc.spend;
                if (marginUSD != null && marginUSD > 0 && spendUSD > 0) {
                    const need = Math.ceil(spendUSD / marginUSD);
                    const remaining = Math.max(0, need - todayBucket.count);
                    const pct = need > 0 ? Math.min(999, (todayBucket.count / need) * 100) : 0;
                    const color = pct >= 100 ? '#059669' : (pct >= 60 ? '#2563eb' : (pct >= 30 ? '#d97706' : '#dc2626'));
                    breakevenLine = `<div class="dash-sales-be">
                        <span>Breakeven hoje: <strong>${todayBucket.count}/${need}</strong> (${pct.toFixed(0)}%)${remaining ? ` · faltam <strong>${remaining}</strong>` : ' · ✓'}</span>
                        <div class="dash-sales-be-bar"><div style="width:${Math.min(100, pct)}%;background:${color}"></div></div>
                    </div>`;
                }
            }

            const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
            const sparkline = days.map(d => {
                const ratio = d.count / maxCount;
                const hpct = Math.max(6, ratio * 100);
                const wd = dayNames[new Date(d.date + 'T12:00:00').getDay()];
                const isToday = d.date === today;
                return `<div class="dash-spark-bar ${isToday ? 'dash-spark-today' : ''}" title="${wd} ${d.date}: ${d.count} pedidos">
                    <span class="dash-spark-bar-count">${d.count}</span>
                    <div class="dash-spark-bar-fill" style="height:${hpct}%"></div>
                    <span class="dash-spark-bar-lbl">${wd}</span>
                </div>`;
            }).join('');

            const fmtMoney = (usd) => {
                const v = (typeof convertCurrency === 'function') ? convertCurrency(usd, 'USD', currency) : usd;
                try { return v.toLocaleString('pt-BR', { style: 'currency', currency }); }
                catch { return currency + ' ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2 }); }
            };

            wrap.innerHTML = `
                <div class="dash-sales-row">
                    <div class="dash-sales-stat">
                        <span class="dash-sales-lbl">Pedidos hoje</span>
                        <span class="dash-sales-val">${todayBucket.count}</span>
                        ${deltaPct != null ? `<span class="dash-sales-delta ${deltaPct >= 0 ? 'pos' : 'neg'}">${deltaPct >= 0 ? '+' : ''}${deltaPct}% vs ontem</span>` : '<span class="dash-sales-delta dim">—</span>'}
                    </div>
                    <div class="dash-sales-stat">
                        <span class="dash-sales-lbl">Receita hoje</span>
                        <span class="dash-sales-val">${fmtMoney(todayBucket.revenueUSD)}</span>
                    </div>
                    <div class="dash-sales-stat">
                        <span class="dash-sales-lbl">Hora pico hoje</span>
                        <span class="dash-sales-val">${peakHour >= 0 ? `${String(peakHour).padStart(2,'0')}h` : '—'}</span>
                        ${peakHour >= 0 ? `<span class="dash-sales-delta dim">${byHour[peakHour]} pedidos</span>` : ''}
                    </div>
                    <div class="dash-sales-stat">
                        <span class="dash-sales-lbl">Top país${todayOrders.length ? ' hoje' : ' (7d)'}</span>
                        <span class="dash-sales-val">${topCountry?.[0] || '—'}</span>
                        ${topCountry ? `<span class="dash-sales-delta dim">${topCountry[1]} pedidos</span>` : ''}
                    </div>
                </div>
                ${breakevenLine}
                <div class="dash-sales-spark">
                    <div class="dash-spark-title">Pedidos — últimos 7 dias</div>
                    <div class="dash-spark-bars">${sparkline}</div>
                </div>`;
            wrap.dataset.rendered = '1';
            _dashState.lastFetched = Date.now();
        } catch (err) {
            console.error('[sales-dash] error', err);
            wrap.innerHTML = `<p class="sales-warn">Falha ao carregar: ${err.message}</p>`;
        } finally {
            _dashState.loading = false;
        }
    }

    function _todayInTz(tz) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const y = parts.find(p => p.type === 'year').value;
        const m = parts.find(p => p.type === 'month').value;
        const d = parts.find(p => p.type === 'day').value;
        return `${y}-${m}-${d}`;
    }
    function _addDaysISO(iso, n) {
        const [y, m, d] = iso.split('-').map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        dt.setUTCDate(dt.getUTCDate() + n);
        return dt.toISOString().slice(0, 10);
    }
    function _toShopDate(iso, tz) {
        try {
            const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
            const y = parts.find(p => p.type === 'year').value;
            const m = parts.find(p => p.type === 'month').value;
            const d = parts.find(p => p.type === 'day').value;
            return `${y}-${m}-${d}`;
        } catch { return null; }
    }
    function _hourInTz(iso, tz) {
        try { return parseInt(new Date(iso).toLocaleString('en-US', { timeZone: tz, hour: '2-digit', hour12: false }), 10); }
        catch { return -1; }
    }

    function _bindDashWidget() {
        document.getElementById('btn-dash-sales-refresh')?.addEventListener('click', () => renderDashWidget(true));
        document.getElementById('btn-dash-sales-open')?.addEventListener('click', () => {
            document.querySelector('.tab-btn[data-tab="vendas"]')?.click();
        });
    }

    // ── Viz state ─────────────────────────────────────────────────
    let _vizMode = 'tabela';
    let _calMonth = new Date().getMonth();
    let _calYear = new Date().getFullYear();
    let _chartRefs = { orders: null, revenue: null, aov: null, items: null };
    let _globeInstance = null;
    let _globeLoaded = false;

    const COUNTRY_CENTROIDS = {
        US:[39.8,-98.6],BR:[-14.2,-51.9],GB:[55.4,-3.4],DE:[51.2,10.4],FR:[46.2,2.2],
        CA:[56.1,-106.3],AU:[-25.3,133.8],JP:[36.2,138.3],IN:[20.6,78.9],MX:[23.6,-102.6],
        IT:[41.9,12.5],ES:[40.5,-3.7],PT:[39.4,-8.2],NL:[52.1,5.3],BE:[50.5,4.5],
        AR:[-38.4,-63.6],CL:[-35.7,-71.5],CO:[4.6,-74.1],PE:[-9.2,-75.0],
        SE:[60.1,18.6],NO:[60.5,8.5],DK:[56.3,9.5],FI:[61.9,25.7],
        PL:[51.9,19.1],AT:[47.5,14.6],CH:[46.8,8.2],IE:[53.1,-7.7],
        ZA:[-30.6,22.9],KR:[35.9,127.8],NZ:[-40.9,174.9],SG:[1.4,103.8],
        AE:[23.4,53.8],SA:[23.9,45.1],IL:[31.1,34.8],EG:[26.8,30.8],
        NG:[9.1,8.7],KE:[-0.02,37.9],GH:[7.9,-1.0],TH:[15.9,100.9],
        PH:[12.9,121.8],MY:[4.2,101.9],ID:[-0.8,113.9],VN:[14.1,108.3],
        TW:[23.7,121.0],HK:[22.4,114.1],RU:[61.5,105.3],TR:[39.0,35.2],
        RO:[45.9,25.0],CZ:[49.8,15.5],HU:[47.2,19.5],GR:[39.1,21.8],
        HR:[45.1,15.2],BG:[42.7,25.5],SK:[48.7,19.7],SI:[46.2,14.8],
        LT:[55.2,23.9],LV:[56.9,24.1],EE:[58.6,25.0],CY:[35.1,33.4],
        MT:[35.9,14.4],LU:[49.8,6.1],IS:[65.0,-19.0],UA:[48.4,31.2],
    };

    function _refreshActiveViz() {
        if (_vizMode === 'calendario') _renderCalendarView();
        else if (_vizMode === 'globo') _renderGlobeView();
        else if (_vizMode === 'graficos') _renderChartsView();
    }

    function _setVizMode(mode) {
        _vizMode = mode;
        document.querySelectorAll('.sales-viz-tab').forEach(t => t.classList.toggle('active', t.dataset.viz === mode));
        const tableWrap = document.getElementById('sales-viz-tabela');
        if (tableWrap) tableWrap.style.display = mode === 'tabela' ? '' : 'none';
        ['calendario', 'globo', 'graficos', 'comparador'].forEach(p => {
            const el = document.getElementById('sales-viz-' + p);
            if (el) el.style.display = p === mode ? '' : 'none';
        });
        if (mode === 'calendario') _renderCalendarView();
        if (mode === 'globo') _renderGlobeView();
        if (mode === 'graficos') _renderChartsView();
        if (window.lucide?.createIcons) lucide.createIcons();
    }

    // ── Calendar View ────────────────────────────────────────────
    function _renderCalendarView() {
        const titleEl = document.getElementById('sales-cal-title');
        const gridEl = document.getElementById('sales-cal-grid');
        if (!titleEl || !gridEl) return;

        const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        titleEl.textContent = `${monthNames[_calMonth]} ${_calYear}`;

        const firstDay = new Date(_calYear, _calMonth, 1).getDay();
        const daysInMonth = new Date(_calYear, _calMonth + 1, 0).getDate();
        const todayStr = _todayISO();

        const byDay = new Map();
        for (const o of _state.filtered) {
            const d = _orderDateInShopTz(o.created_at);
            if (!d) continue;
            const [y, m] = d.split('-').map(Number);
            if (y !== _calYear || m !== _calMonth + 1) continue;
            const e = byDay.get(d) || { count: 0, revenue: 0 };
            e.count++;
            e.revenue += Number(o.total_price) || 0;
            byDay.set(d, e);
        }

        const maxCount = Math.max(...[...byDay.values()].map(e => e.count), 1);

        const dayLabels = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
        let html = dayLabels.map(d => `<div class="sales-cal-dayname">${d}</div>`).join('');

        for (let i = 0; i < firstDay; i++) html += '<div class="sales-cal-cell empty"></div>';

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${_calYear}-${String(_calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const e = byDay.get(dateStr);
            const count = e?.count || 0;
            const rev = e?.revenue || 0;
            const ratio = maxCount ? count / maxCount : 0;
            const heat = count === 0 ? 0 : ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
            const isToday = dateStr === todayStr;
            html += `<div class="sales-cal-cell heat-${heat}${isToday ? ' today' : ''}">
                <div class="sales-cal-day">${day}</div>
                <div class="sales-cal-count">${count || ''}</div>
                ${count ? `<div class="sales-cal-rev">${_fmtMoney(rev)}</div>` : ''}
            </div>`;
        }
        gridEl.innerHTML = html;
    }

    // ── Globe View ───────────────────────────────────────────────
    function _loadGlobeScript() {
        return new Promise((resolve, reject) => {
            if (window.Globe) return resolve();
            const s = document.createElement('script');
            s.src = 'https://unpkg.com/globe.gl@2.27.2/dist/globe.gl.min.js';
            s.onload = resolve;
            s.onerror = () => reject(new Error('Falha ao carregar globe.gl'));
            document.head.appendChild(s);
        });
    }

    async function _renderGlobeView() {
        const container = document.getElementById('sales-globe-container');
        const legend = document.getElementById('sales-globe-legend');
        if (!container) return;

        const byCountry = new Map();
        for (const o of _state.filtered) {
            const cc = (o.shipping_address?.country_code || '').toUpperCase();
            if (!cc) continue;
            const name = o.shipping_address?.country || cc;
            const e = byCountry.get(cc) || { name, count: 0, revenue: 0 };
            e.count++;
            e.revenue += Number(o.total_price) || 0;
            byCountry.set(cc, e);
        }

        const points = [];
        for (const [cc, e] of byCountry) {
            const coords = COUNTRY_CENTROIDS[cc];
            if (!coords) continue;
            points.push({ lat: coords[0], lng: coords[1], cc, name: e.name, count: e.count, revenue: e.revenue });
        }

        if (legend) {
            const sorted = [...byCountry.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8);
            legend.innerHTML = sorted.map(([cc, e]) =>
                `<div class="sales-globe-legend-item"><div class="sales-globe-legend-dot"></div>${_esc(e.name)} — ${e.count}</div>`
            ).join('');
        }

        if (!points.length) {
            container.innerHTML = '<div class="sales-globe-loading">Sem dados de localização no período.</div>';
            return;
        }

        try {
            if (!_globeLoaded) {
                await _loadGlobeScript();
                _globeLoaded = true;
            }
            container.querySelector('.sales-globe-loading')?.remove();

            const maxC = Math.max(...points.map(p => p.count), 1);

            if (_globeInstance) {
                _globeInstance
                    .pointsData(points)
                    .pointAltitude(d => 0.02 + (d.count / maxC) * 0.35);
                // Auto-foca no top país
                const top = points.slice().sort((a, b) => b.count - a.count)[0];
                if (top) _globeInstance.pointOfView({ lat: top.lat, lng: top.lng, altitude: 2 }, 1500);
                return;
            }

            // Carrega geometria de países pra estilo hex (Shopify-like)
            let countries = null;
            try {
                const geoRes = await fetch('https://unpkg.com/three-globe/example/datasets/ne_110m_admin_0_countries.geojson');
                countries = await geoRes.json();
            } catch (e) {
                console.warn('[Globe] falha carregar geojson:', e);
            }

            const isDark = document.documentElement.getAttribute('data-theme') !== 'light';

            _globeInstance = Globe()(container)
                .backgroundColor('rgba(0,0,0,0)')
                .width(container.clientWidth)
                .height(container.clientHeight)
                .showGlobe(true)
                .showAtmosphere(true)
                .atmosphereColor(isDark ? '#a78bfa' : '#7c3aed')
                .atmosphereAltitude(0.18)
                .pointsData(points)
                .pointLat('lat')
                .pointLng('lng')
                .pointAltitude(d => 0.02 + (d.count / maxC) * 0.35)
                .pointRadius(d => 0.4 + (d.count / maxC) * 1.4)
                .pointColor(() => isDark ? '#ec4899' : '#7c3aed')
                .pointLabel(d => `<div style="background:#0f0f17;color:#fff;padding:6px 10px;border-radius:6px;border:1px solid rgba(139,92,246,0.4);font-size:12px"><b>${d.name}</b><br>${d.count} pedidos<br>${_fmtMoney(d.revenue)}</div>`);

            // Cor sólida do globo (sem textura de Terra) — estilo Shopify
            try {
                const THREE = window.THREE || (_globeInstance.scene && _globeInstance.scene().constructor && (window.THREE = _globeInstance.scene().__THREE__));
                if (window.THREE) {
                    _globeInstance.globeMaterial(new window.THREE.MeshBasicMaterial({
                        color: isDark ? 0x14141d : 0xe8efff,
                        transparent: true,
                        opacity: isDark ? 0.65 : 0.9,
                    }));
                }
            } catch {}

            // Hex polygons (countries) — efeito de pontilhado igual Shopify
            if (countries?.features) {
                _globeInstance
                    .hexPolygonsData(countries.features)
                    .hexPolygonResolution(3)
                    .hexPolygonMargin(0.3)
                    .hexPolygonUseDots(true)
                    .hexPolygonColor(() => isDark ? 'rgba(167, 139, 250, 0.55)' : 'rgba(124, 58, 237, 0.55)');
            }

            // Foca no país com mais pedidos
            const top = points.slice().sort((a, b) => b.count - a.count)[0];
            if (top) {
                setTimeout(() => {
                    try { _globeInstance.pointOfView({ lat: top.lat, lng: top.lng, altitude: 2 }, 1500); } catch {}
                }, 100);
            }

            // Auto-rotate suave
            try {
                const controls = _globeInstance.controls();
                if (controls) {
                    controls.autoRotate = true;
                    controls.autoRotateSpeed = 0.4;
                    controls.enableZoom = true;
                }
            } catch {}

            const ro = new ResizeObserver(() => {
                if (_globeInstance && container.clientWidth) {
                    _globeInstance.width(container.clientWidth).height(container.clientHeight);
                }
            });
            ro.observe(container);
        } catch (err) {
            console.error('[Globe] error:', err);
            container.innerHTML = `<div class="sales-globe-loading">Erro: ${err.message}</div>`;
        }
    }

    // ── Charts View ──────────────────────────────────────────────
    function _themeColor(varName, fallback) {
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || fallback;
    }

    function _renderChartsView() {
        const orders = _state.filtered;
        const byDay = new Map();
        for (const o of orders) {
            const d = _orderDateInShopTz(o.created_at);
            if (!d) continue;
            const e = byDay.get(d) || { count: 0, revenue: 0, items: 0 };
            e.count++;
            e.revenue += Number(o.total_price) || 0;
            e.items += (o.line_items || []).reduce((s, li) => s + (li.quantity || 0), 0);
            byDay.set(d, e);
        }

        const dates = [...byDay.keys()].sort();
        const labels = dates.map(d => { const [, m, day] = d.split('-'); return `${day}/${m}`; });

        const datasets = {
            orders: dates.map(d => byDay.get(d).count),
            revenue: dates.map(d => +byDay.get(d).revenue.toFixed(2)),
            aov: dates.map(d => { const e = byDay.get(d); return e.count ? +(e.revenue / e.count).toFixed(2) : 0; }),
            items: dates.map(d => byDay.get(d).items),
        };

        const cBlue = _themeColor('--blue', '#6cb6ff');
        const cGreen = _themeColor('--green', '#4bce97');
        const cYellow = _themeColor('--yellow', '#e2b203');
        const cPurple = _themeColor('--purple', '#b39eff');
        const gridColor = _themeColor('--chart-grid', 'rgba(128,128,128,0.1)');
        const tickColor = _themeColor('--chart-tick', '#8f95a8');

        const chartConfig = (key, data, color, isMoney) => ({
            type: 'line',
            data: {
                labels,
                datasets: [{
                    data,
                    borderColor: color,
                    backgroundColor: color + '18',
                    fill: true,
                    tension: 0.3,
                    pointRadius: dates.length > 60 ? 0 : 3,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { maxTicksLimit: 12, font: { size: 10 }, color: tickColor } },
                    y: {
                        beginAtZero: true,
                        grid: { color: gridColor },
                        ticks: isMoney ? {
                            callback: v => _fmtMoney(v),
                            font: { size: 10 },
                            color: tickColor,
                        } : { font: { size: 10 }, color: tickColor },
                    }
                },
                interaction: { mode: 'index', intersect: false },
            }
        });

        const build = (canvasId, key, data, color, isMoney) => {
            const canvas = document.getElementById(canvasId);
            if (!canvas) return;
            if (_chartRefs[key]) { _chartRefs[key].destroy(); _chartRefs[key] = null; }
            _chartRefs[key] = new Chart(canvas, chartConfig(key, data, color, isMoney));
        };

        build('sales-chart-orders', 'orders', datasets.orders, cBlue, false);
        build('sales-chart-revenue', 'revenue', datasets.revenue, cGreen, true);
        build('sales-chart-aov', 'aov', datasets.aov, cYellow, true);
        build('sales-chart-items', 'items', datasets.items, cPurple, false);
    }

    // ── Comparator ───────────────────────────────────────────────
    function _runComparator() {
        const aFrom = document.getElementById('sales-comp-a-from')?.value;
        const aTo = document.getElementById('sales-comp-a-to')?.value;
        const bFrom = document.getElementById('sales-comp-b-from')?.value;
        const bTo = document.getElementById('sales-comp-b-to')?.value;
        const wrap = document.getElementById('sales-comp-results');
        if (!wrap || !aFrom || !aTo || !bFrom || !bTo) {
            if (wrap) wrap.innerHTML = '<div class="sales-comp-empty"><i data-lucide="git-compare-arrows" style="width:32px;height:32px"></i>Preencha os dois períodos e clique em Comparar.</div>';
            if (window.lucide?.createIcons) lucide.createIcons();
            return;
        }

        const collect = (from, to) => {
            const result = { orders: 0, revenue: 0, items: 0 };
            for (const o of _state.orders) {
                const d = _orderDateInShopTz(o.created_at);
                if (!d || d < from || d > to) continue;
                result.orders++;
                result.revenue += Number(o.total_price) || 0;
                result.items += (o.line_items || []).reduce((s, li) => s + (li.quantity || 0), 0);
            }
            result.aov = result.orders ? result.revenue / result.orders : 0;
            return result;
        };

        const a = collect(aFrom, aTo);
        const b = collect(bFrom, bTo);

        if (a.orders === 0 && b.orders === 0) {
            wrap.innerHTML = '<div class="sales-comp-empty"><i data-lucide="inbox" style="width:32px;height:32px"></i>Sem pedidos nos períodos selecionados.<br>Conecte o Shopify ou ajuste as datas.</div>';
            if (window.lucide?.createIcons) lucide.createIcons();
            return;
        }

        const delta = (va, vb) => {
            if (vb === 0 && va === 0) return { pct: 0, cls: 'neutral' };
            if (vb === 0) return { pct: 999, cls: 'pos' };
            const p = ((va - vb) / vb) * 100;
            return { pct: p, cls: p > 0 ? 'pos' : p < 0 ? 'neg' : 'neutral' };
        };

        const metrics = [
            { label: 'Pedidos', aVal: _fmtNumber(a.orders), bVal: _fmtNumber(b.orders), d: delta(a.orders, b.orders) },
            { label: 'Receita', aVal: _fmtMoney(a.revenue), bVal: _fmtMoney(b.revenue), d: delta(a.revenue, b.revenue) },
            { label: 'Itens', aVal: _fmtNumber(a.items), bVal: _fmtNumber(b.items), d: delta(a.items, b.items) },
            { label: 'Ticket médio', aVal: _fmtMoney(a.aov), bVal: _fmtMoney(b.aov), d: delta(a.aov, b.aov) },
        ];

        wrap.innerHTML = metrics.map(m => `
            <div class="sales-comp-card">
                <div class="sales-comp-label">${m.label}</div>
                <div class="sales-comp-vals">
                    <div class="sales-comp-val">${m.aVal}<small>Período A</small></div>
                    <div class="sales-comp-val">${m.bVal}<small>Período B</small></div>
                </div>
                <span class="sales-comp-delta ${m.d.cls}">${m.d.pct >= 0 ? '+' : ''}${m.d.pct.toFixed(1)}%</span>
            </div>
        `).join('');
    }

    // ── Init ─────────────────────────────────────────────────────
    function init() {
        if (window._salesInited) return;
        window._salesInited = true;

        _loadCalc();
        _setQuickPeriod(30);
        _renderSummary();
        _renderTable();
        _bindCalculator();
        _renderCalculator();
        _bindPatternsToggle();
        _renderPatterns();
        // "Ver Tudo" button on Madgicx-style ranking → toggle expand inline
        document.getElementById('btn-sales-mdgx-ranking-all')?.addEventListener('click', () => {
            _mdgxShowAll = !_mdgxShowAll;
            _renderMdgxRanking();
        });
        _bindDashWidget();
        // Render dashboard widget after a tick so ShopifyModule has init'd
        setTimeout(() => renderDashWidget(false), 800);

        // Period filter — Shopify-style range picker (matches Diário/Diagnóstico)
        // Auto-applies on every date change (no need to click "Atualizar")
        const _autoReloadOnDateChange = () => {
            const startEl = document.getElementById('sales-date-start');
            const endEl = document.getElementById('sales-date-end');
            const start = startEl?.value || '';
            const end = endEl?.value || _todayISO();
            const newFrom = start || _daysAgoISO(29);
            const newTo = end || _todayISO();
            // Skip if range didn't actually change (avoid double-fetch)
            if (newFrom === _state.from && newTo === _state.to && _state.loaded) return;
            _state.from = newFrom;
            _state.to = newTo;
            const fromEl = document.getElementById('sales-date-from');
            const toEl = document.getElementById('sales-date-to');
            if (fromEl) fromEl.value = _state.from;
            if (toEl) toEl.value = _state.to;
            // Invalidate previous-period cache (Madgicx ranking comparator)
            _mdgxPrevCache = { key: '', orders: null };
            _loadOrders();
        };

        if (typeof RangePicker !== 'undefined') {
            RangePicker.init('sales-date', {
                defaultPreset: '30',
                onChange: _autoReloadOnDateChange,
            });
            // Sync initial state from picker (defaultPreset '30' set silently)
            const sIni = document.getElementById('sales-date-start')?.value;
            const eIni = document.getElementById('sales-date-end')?.value;
            if (sIni) _state.from = sIni;
            if (eIni) _state.to = eIni;
            const fromEl = document.getElementById('sales-date-from');
            const toEl = document.getElementById('sales-date-to');
            if (fromEl) fromEl.value = _state.from;
            if (toEl) toEl.value = _state.to;
        }

        // Safety net: listen for direct changes on hidden date inputs (covers manual edits,
        // programmatic updates, browser autofill, etc) to guarantee auto-refresh.
        ['sales-date-start', 'sales-date-end', 'sales-date-from', 'sales-date-to'].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('change', _autoReloadOnDateChange);
        });
        // Also listen to preset buttons directly as belt-and-suspenders
        document.querySelectorAll('.sales-date-preset').forEach(btn => {
            btn.addEventListener('click', () => setTimeout(_autoReloadOnDateChange, 50));
        });
        document.getElementById('sales-date-apply')?.addEventListener('click', () => {
            setTimeout(_autoReloadOnDateChange, 50);
        });
        document.getElementById('btn-sales-refresh')?.addEventListener('click', () => _loadOrders(true));
        document.getElementById('btn-sales-export')?.addEventListener('click', _exportCsv);
        // Unified filter setter — keeps top filters + the compact segmentation bar in sync
        const _renderAll = () => {
            _applyFilters();
            _populateFilters(); // refresh dependent lists (e.g. cities) + mirror both bars + country dropdowns
            _renderSummary(); _renderTable(); _renderCalculator(); _renderPatterns(); _refreshActiveViz();
        };
        const _setFilter = (type, value) => {
            if (type === 'product') { _state.productFilter = value; }
            else if (type === 'city') { _state.cityFilter = value; }
            else if (type === 'account') { _state.accountFilter = value; }
            _renderAll();
        };
        // Top filters (Produto/Cidade/Conta = single select)
        document.getElementById('sales-product-filter')?.addEventListener('change', (e) => _setFilter('product', e.target.value));
        document.getElementById('sales-city-filter')?.addEventListener('change', (e) => _setFilter('city', e.target.value));
        document.getElementById('sales-account-filter')?.addEventListener('change', (e) => _setFilter('account', e.target.value));
        // Compact segmentation bar (next to the table) — same state, same renders
        document.getElementById('sales-viz-product-filter')?.addEventListener('change', (e) => _setFilter('product', e.target.value));
        document.getElementById('sales-viz-account-filter')?.addEventListener('change', (e) => _setFilter('account', e.target.value));
        document.getElementById('sales-seg-clear')?.addEventListener('click', () => {
            _state.countries = []; _state.productFilter = ''; _state.cityFilter = ''; _state.accountFilter = '';
            _renderAll();
        });

        // País — multi-select dropdowns (top + segmentation bar) with checkboxes
        const _onCountryChange = () => { _state.cityFilter = ''; _renderAll(); };
        document.querySelectorAll('.ms-dropdown[data-ms-target="country"]').forEach(wrap => {
            const btn = wrap.querySelector('.ms-dropdown-btn');
            const panel = wrap.querySelector('.ms-dropdown-panel');
            const list = wrap.querySelector('.ms-dropdown-list');
            btn?.addEventListener('click', (e) => {
                e.stopPropagation();
                const isOpen = panel.style.display !== 'none';
                document.querySelectorAll('.ms-dropdown[data-ms-target="country"] .ms-dropdown-panel').forEach(p => p.style.display = 'none');
                panel.style.display = isOpen ? 'none' : '';
            });
            // checkbox toggle (delegated — list innerHTML is rebuilt on each populate)
            list?.addEventListener('change', (e) => {
                const cb = e.target.closest('input[type="checkbox"]');
                if (!cb) return;
                const cc = cb.value.toUpperCase();
                const set = new Set((_state.countries || []).map(c => String(c).toUpperCase()));
                if (cb.checked) set.add(cc); else set.delete(cc);
                _state.countries = [...set];
                _onCountryChange();
            });
            wrap.querySelector('[data-ms-none]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                _state.countries = [];
                _onCountryChange();
            });
        });
        // Close country dropdowns when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.ms-dropdown[data-ms-target="country"]')) {
                document.querySelectorAll('.ms-dropdown[data-ms-target="country"] .ms-dropdown-panel').forEach(p => p.style.display = 'none');
            }
        });
        document.getElementById('btn-sales-load-more')?.addEventListener('click', () => {
            _state.displayed += PAGE_SIZE;
            _renderTable();
        });

        // Sortable column headers
        document.querySelectorAll('.sales-table th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const key = th.dataset.sort;
                if (_state.sortKey === key) {
                    _state.sortDir = _state.sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    _state.sortKey = key;
                    // Default direction: desc for date/value/numeric, asc for text
                    const numericKeys = ['created_at', 'total_price', 'items', 'name', 'customer_local'];
                    _state.sortDir = numericKeys.includes(key) ? 'desc' : 'asc';
                }
                _applyFilters();
                _renderTable();
            });
        });
        _updateSortIndicators();

        // Viz toggle tabs
        document.querySelectorAll('.sales-viz-tab').forEach(btn => {
            btn.addEventListener('click', () => _setVizMode(btn.dataset.viz));
        });
        // Calendar nav
        document.getElementById('sales-cal-prev')?.addEventListener('click', () => {
            _calMonth--;
            if (_calMonth < 0) { _calMonth = 11; _calYear--; }
            _renderCalendarView();
        });
        document.getElementById('sales-cal-next')?.addEventListener('click', () => {
            _calMonth++;
            if (_calMonth > 11) { _calMonth = 0; _calYear++; }
            _renderCalendarView();
        });
        // Comparator
        document.getElementById('btn-sales-compare')?.addEventListener('click', _runComparator);
        // Default comparator dates (last 30d vs previous 30d)
        const compATo = document.getElementById('sales-comp-a-to');
        const compAFrom = document.getElementById('sales-comp-a-from');
        const compBTo = document.getElementById('sales-comp-b-to');
        const compBFrom = document.getElementById('sales-comp-b-from');
        if (compATo) compATo.value = _todayISO();
        if (compAFrom) compAFrom.value = _daysAgoISO(29);
        if (compBTo) compBTo.value = _daysAgoISO(30);
        if (compBFrom) compBFrom.value = _daysAgoISO(59);

        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (t) => {
                if (t === 'vendas') {
                    if (window.lucide?.createIcons) lucide.createIcons();
                    if (!_state.loaded && !_state.loading) _loadOrders();
                } else if (t === 'dashboard') {
                    if (window.lucide?.createIcons) lucide.createIcons();
                    renderDashWidget(false);
                }
            });
        }
    }

    return { init, renderDashWidget, _state };
})();

document.addEventListener('DOMContentLoaded', () => SalesModule.init());
