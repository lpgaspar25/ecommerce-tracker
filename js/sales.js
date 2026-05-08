/* ===========================
   Sales & Patterns — order-level history with dual-timezone display
   =========================== */

const SalesModule = (() => {
    const PAGE_SIZE = 100;
    const CALC_KEY = 'etracker_sales_calc';

    let _state = {
        orders: [],
        filtered: [],
        from: '',
        to: '',
        countryFilter: '',
        productFilter: '',
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
        meta.innerHTML = `
            <div class="sales-calc-meta-row">
                <span>Vendas atuais: <strong>${_fmtNumber(actualSales)}</strong></span>
                <span>Receita: <strong>${_fmtMoney(_convertFromUSD(actualRevenueUSD, displayCcy), displayCcy)}</strong></span>
                <span>Ticket médio: <strong>${_fmtMoney(_convertFromUSD(ticketUSD, displayCcy), displayCcy)}</strong></span>
            </div>
            <div class="sales-calc-meta-row">${marginNote}</div>`;

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
        if (window.lucide?.createIcons) lucide.createIcons();
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
    function _applyFilters() {
        const cf = (_state.countryFilter || '').toUpperCase();
        const pf = String(_state.productFilter || '');
        _state.filtered = _state.orders.filter(o => {
            if (cf) {
                const cc = (o.shipping_address?.country_code || '').toUpperCase();
                if (cc !== cf) return false;
            }
            if (pf) {
                const has = (o.line_items || []).some(li => String(li.product_id || '') === pf);
                if (!has) return false;
            }
            return true;
        });
        _state.displayed = PAGE_SIZE;
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

        const slice = orders.slice(0, _state.displayed);
        tbody.innerHTML = slice.map(o => {
            const addr = o.shipping_address || {};
            const tz = (window.CountryTZ?.tzForOrder?.(addr)) || null;
            const items = (o.line_items || []).map(li => `${li.title || '—'} ×${li.quantity}`).join('<br>');
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
    }

    function _populateFilters() {
        const orders = _state.orders;
        const countrySel = document.getElementById('sales-country-filter');
        const productSel = document.getElementById('sales-product-filter');

        if (countrySel) {
            const countries = new Map();
            for (const o of orders) {
                const cc = (o.shipping_address?.country_code || '').toUpperCase();
                const name = o.shipping_address?.country || cc;
                if (cc && !countries.has(cc)) countries.set(cc, name);
            }
            const sorted = [...countries.entries()].sort((a, b) => a[1].localeCompare(b[1]));
            const cur = countrySel.value;
            countrySel.innerHTML = '<option value="">Todos</option>' + sorted.map(([cc, n]) => `<option value="${cc}">${_esc(n)} (${cc})</option>`).join('');
            if (cur) countrySel.value = cur;
        }

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
        } catch (err) {
            console.error('[sales] load error', err);
            if (typeof showToast === 'function') showToast('Falha ao buscar vendas: ' + err.message, 'error');
        } finally {
            _state.loading = false;
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
        _bindDashWidget();
        // Render dashboard widget after a tick so ShopifyModule has init'd
        setTimeout(() => renderDashWidget(false), 800);

        // Period filter — Shopify-style range picker (matches Diário/Diagnóstico)
        if (typeof RangePicker !== 'undefined') {
            RangePicker.init('sales-date', {
                defaultPreset: '30',
                onChange: () => {
                    const startEl = document.getElementById('sales-date-start');
                    const endEl = document.getElementById('sales-date-end');
                    const start = startEl?.value || '';
                    const end = endEl?.value || _todayISO();
                    _state.from = start || _daysAgoISO(29);
                    _state.to = end || _todayISO();
                    const fromEl = document.getElementById('sales-date-from');
                    const toEl = document.getElementById('sales-date-to');
                    if (fromEl) fromEl.value = _state.from;
                    if (toEl) toEl.value = _state.to;
                    _loadOrders();
                }
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
        document.getElementById('btn-sales-refresh')?.addEventListener('click', () => _loadOrders(true));
        document.getElementById('btn-sales-export')?.addEventListener('click', _exportCsv);
        document.getElementById('sales-country-filter')?.addEventListener('change', (e) => {
            _state.countryFilter = e.target.value;
            _applyFilters(); _renderSummary(); _renderTable(); _renderCalculator(); _renderPatterns();
        });
        document.getElementById('sales-product-filter')?.addEventListener('change', (e) => {
            _state.productFilter = e.target.value;
            _applyFilters(); _renderSummary(); _renderTable(); _renderCalculator(); _renderPatterns();
        });
        document.getElementById('btn-sales-load-more')?.addEventListener('click', () => {
            _state.displayed += PAGE_SIZE;
            _renderTable();
        });

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
