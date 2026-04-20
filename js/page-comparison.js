/* ===========================
   Page Comparison Module
   Compare landing pages / funnels for the same product
   Detect cannibalization (one page growing at cost of another)
   =========================== */

const PageComparisonModule = (() => {
    let _selectedProductId = null;
    let _rangeDays = 14;

    // Get page label for a diary entry (fallbacks: pageLabel → campaignName → adName → 'Sem página')
    function _getPageLabel(entry) {
        return (entry.pageLabel || entry.campaignName || entry.adName || 'Sem página').trim() || 'Sem página';
    }

    function _setPageLabel(entryId, label) {
        const entries = AppState.allDiary || [];
        const entry = entries.find(e => e.id === entryId);
        if (!entry) return false;
        entry.pageLabel = (label || '').trim();
        if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
        if (typeof SupabaseSync !== 'undefined' && SupabaseSync.syncDiary) SupabaseSync.syncDiary();
        if (typeof EventBus !== 'undefined') EventBus.emit('diaryChanged');
        return true;
    }

    // Pearson correlation coefficient between two arrays
    function _correlation(a, b) {
        const n = Math.min(a.length, b.length);
        if (n < 2) return 0;
        let sumA = 0, sumB = 0, sumAB = 0, sumAA = 0, sumBB = 0;
        for (let i = 0; i < n; i++) {
            sumA += a[i]; sumB += b[i];
            sumAB += a[i] * b[i];
            sumAA += a[i] * a[i];
            sumBB += b[i] * b[i];
        }
        const denom = Math.sqrt((n * sumAA - sumA * sumA) * (n * sumBB - sumB * sumB));
        if (denom === 0) return 0;
        return (n * sumAB - sumA * sumB) / denom;
    }

    // Build comparison data for a product over N days
    function buildComparison(productId, days) {
        days = days || _rangeDays;
        const product = (AppState.allProducts || []).find(p => p.id === productId);
        if (!product) return null;

        const entries = (AppState.allDiary || []).filter(e => e.productId === productId);

        // Date range
        const end = new Date(); end.setHours(0, 0, 0, 0);
        const start = new Date(end); start.setDate(start.getDate() - days + 1);
        const dates = [];
        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            dates.push(d.toISOString().slice(0, 10));
        }

        // Group by page
        const pageMap = new Map(); // pageLabel → { entries: [], dailySales: [], dailyBudget: [], dailyRevenue: [] }
        for (const entry of entries) {
            if (!entry.date || entry.date < dates[0] || entry.date > dates[dates.length - 1]) continue;
            const label = _getPageLabel(entry);
            if (!pageMap.has(label)) {
                pageMap.set(label, {
                    label,
                    entries: [],
                    dailySales: Array(dates.length).fill(0),
                    dailyBudget: Array(dates.length).fill(0),
                    dailyRevenue: Array(dates.length).fill(0),
                });
            }
            const page = pageMap.get(label);
            page.entries.push(entry);
            const idx = dates.indexOf(entry.date);
            if (idx >= 0) {
                page.dailySales[idx] += Number(entry.sales) || 0;
                page.dailyBudget[idx] += Number(entry.budget) || 0;
                page.dailyRevenue[idx] += Number(entry.revenue) || 0;
            }
        }

        const pages = [...pageMap.values()];

        // Compute summary per page
        for (const p of pages) {
            p.totalSales = p.dailySales.reduce((s, v) => s + v, 0);
            p.totalBudget = p.dailyBudget.reduce((s, v) => s + v, 0);
            p.totalRevenue = p.dailyRevenue.reduce((s, v) => s + v, 0);
            p.cpa = p.totalSales > 0 ? p.totalBudget / p.totalSales : null;
            p.roas = p.totalBudget > 0 ? p.totalRevenue / p.totalBudget : null;

            // First half vs second half to detect trends
            const mid = Math.floor(p.dailySales.length / 2);
            p.firstHalfSales = p.dailySales.slice(0, mid).reduce((s, v) => s + v, 0);
            p.secondHalfSales = p.dailySales.slice(mid).reduce((s, v) => s + v, 0);
            p.trend = p.secondHalfSales - p.firstHalfSales; // positive = growing
        }

        // Overall totals
        const totalSales = pages.reduce((s, p) => s + p.totalSales, 0);
        const totalBudget = pages.reduce((s, p) => s + p.totalBudget, 0);
        const totalSalesFirstHalf = pages.reduce((s, p) => s + p.firstHalfSales, 0);
        const totalSalesSecondHalf = pages.reduce((s, p) => s + p.secondHalfSales, 0);
        const overallGrowth = totalSalesSecondHalf - totalSalesFirstHalf;

        // Cannibalization detection
        const cannibalizationPairs = [];
        if (pages.length >= 2) {
            for (let i = 0; i < pages.length; i++) {
                for (let j = i + 1; j < pages.length; j++) {
                    const corr = _correlation(pages[i].dailySales, pages[j].dailySales);
                    const bothActive = pages[i].totalSales > 0 && pages[j].totalSales > 0;
                    if (bothActive && corr < -0.3) {
                        cannibalizationPairs.push({
                            pageA: pages[i].label,
                            pageB: pages[j].label,
                            correlation: corr,
                            severity: corr < -0.6 ? 'high' : corr < -0.45 ? 'medium' : 'low',
                            pageATrend: pages[i].trend,
                            pageBTrend: pages[j].trend,
                        });
                    }
                }
            }
        }

        return {
            product,
            dates,
            pages: pages.sort((a, b) => b.totalSales - a.totalSales),
            totalSales,
            totalBudget,
            overallGrowth,
            totalSalesFirstHalf,
            totalSalesSecondHalf,
            cannibalizationPairs,
            hasCannibalization: cannibalizationPairs.length > 0,
        };
    }

    // ── SVG Chart: multi-line time series ──

    function _renderChart(data) {
        const { dates, pages } = data;
        if (!pages.length) return '<p style="color:var(--text-muted);padding:1rem">Sem dados no período.</p>';

        const width = 680;
        const height = 280;
        const pad = { top: 20, right: 20, bottom: 50, left: 50 };
        const W = width - pad.left - pad.right;
        const H = height - pad.top - pad.bottom;

        const maxY = Math.max(1, ...pages.flatMap(p => p.dailySales));
        const x = (i) => pad.left + (i / Math.max(1, dates.length - 1)) * W;
        const y = (v) => pad.top + H - (v / maxY) * H;

        const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6'];

        let svg = `<svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto" xmlns="http://www.w3.org/2000/svg">`;

        // Grid lines
        for (let i = 0; i <= 4; i++) {
            const gy = pad.top + (i / 4) * H;
            const val = maxY * (1 - i / 4);
            svg += `<line x1="${pad.left}" y1="${gy}" x2="${pad.left + W}" y2="${gy}" stroke="currentColor" stroke-width="0.5" opacity="0.1"/>`;
            svg += `<text x="${pad.left - 5}" y="${gy + 3}" text-anchor="end" fill="currentColor" font-size="10" opacity="0.5">${val.toFixed(0)}</text>`;
        }

        // X labels (show ~6 dates)
        const labelStep = Math.max(1, Math.floor(dates.length / 6));
        for (let i = 0; i < dates.length; i += labelStep) {
            const d = new Date(dates[i]);
            const lbl = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
            svg += `<text x="${x(i)}" y="${pad.top + H + 15}" text-anchor="middle" fill="currentColor" font-size="10" opacity="0.6">${lbl}</text>`;
        }

        // Lines
        pages.forEach((page, idx) => {
            const color = colors[idx % colors.length];
            const path = page.dailySales.map((v, i) => (i === 0 ? 'M' : 'L') + x(i) + ',' + y(v)).join(' ');
            svg += `<path d="${path}" fill="none" stroke="${color}" stroke-width="2"/>`;
            page.dailySales.forEach((v, i) => {
                svg += `<circle cx="${x(i)}" cy="${y(v)}" r="2" fill="${color}"/>`;
            });
        });

        // Legend
        pages.forEach((page, idx) => {
            const color = colors[idx % colors.length];
            const lx = pad.left + idx * 150;
            const ly = pad.top + H + 35;
            if (lx + 150 > width) return; // skip if overflow
            svg += `<rect x="${lx}" y="${ly - 8}" width="12" height="3" fill="${color}"/>`;
            svg += `<text x="${lx + 16}" y="${ly - 3}" fill="currentColor" font-size="11">${_escHtml(page.label.slice(0, 20))}</text>`;
        });

        svg += '</svg>';
        return svg;
    }

    // ── Modal ──

    function openModal(productId) {
        _selectedProductId = productId || _selectedProductId || (AppState.allProducts?.[0]?.id);

        const existing = document.getElementById('page-comparison-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'page-comparison-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="max-width:760px;max-height:92vh;overflow-y:auto">
                <div class="modal-header">
                    <h3><i data-lucide="git-compare" style="width:18px;height:18px"></i> Comparação de Páginas</h3>
                    <button class="btn-close" id="page-compare-close">&times;</button>
                </div>
                <div style="padding:1rem" id="page-compare-body">
                    <p style="color:var(--text-muted)">Carregando...</p>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        if (typeof lucide !== 'undefined') lucide.createIcons();

        const close = () => modal.remove();
        document.getElementById('page-compare-close')?.addEventListener('click', close);
        modal.querySelector('.modal-overlay')?.addEventListener('click', close);

        render();
    }

    function render() {
        const body = document.getElementById('page-compare-body');
        if (!body) return;

        const products = AppState.allProducts || [];
        if (!products.length) {
            body.innerHTML = '<p style="color:var(--text-muted)">Cadastre produtos primeiro.</p>';
            return;
        }

        const data = buildComparison(_selectedProductId, _rangeDays);
        if (!data) {
            body.innerHTML = '<p style="color:var(--red)">Produto não encontrado.</p>';
            return;
        }

        const pageCount = data.pages.length;
        const unassignedCount = data.pages.find(p => p.label === 'Sem página')?.entries.length || 0;

        let html = `
            <div class="pagecomp-controls">
                <div class="pagecomp-control">
                    <label class="label">Produto</label>
                    <select id="pagecomp-product" class="input">
                        ${products.map(p => `<option value="${p.id}" ${p.id === _selectedProductId ? 'selected' : ''}>${_escHtml(p.name)}</option>`).join('')}
                    </select>
                </div>
                <div class="pagecomp-control">
                    <label class="label">Período</label>
                    <select id="pagecomp-range" class="input">
                        <option value="7" ${_rangeDays === 7 ? 'selected' : ''}>Últimos 7 dias</option>
                        <option value="14" ${_rangeDays === 14 ? 'selected' : ''}>Últimos 14 dias</option>
                        <option value="30" ${_rangeDays === 30 ? 'selected' : ''}>Últimos 30 dias</option>
                        <option value="60" ${_rangeDays === 60 ? 'selected' : ''}>Últimos 60 dias</option>
                    </select>
                </div>
            </div>

            <div class="pagecomp-summary">
                <div class="pagecomp-stat">
                    <span class="pagecomp-stat-label">Páginas detectadas</span>
                    <span class="pagecomp-stat-value">${pageCount}</span>
                </div>
                <div class="pagecomp-stat">
                    <span class="pagecomp-stat-label">Vendas totais</span>
                    <span class="pagecomp-stat-value">${data.totalSales}</span>
                </div>
                <div class="pagecomp-stat ${data.overallGrowth >= 0 ? 'pagecomp-stat-up' : 'pagecomp-stat-down'}">
                    <span class="pagecomp-stat-label">Tendência geral</span>
                    <span class="pagecomp-stat-value">
                        ${data.overallGrowth >= 0 ? '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i>' : '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i>'} ${Math.abs(data.overallGrowth)}
                    </span>
                </div>
            </div>
        `;

        // Cannibalization warning
        if (data.hasCannibalization) {
            html += `
                <div class="pagecomp-warning">
                    <div class="pagecomp-warning-header">
                        <i data-lucide="alert-triangle" style="width:16px;height:16px"></i>
                        <strong>Canibalização detectada!</strong>
                    </div>
                    <div class="pagecomp-warning-body">
                        ${data.cannibalizationPairs.map(p => `
                            <div class="pagecomp-cannib-pair pagecomp-cannib-${p.severity}">
                                <span class="pagecomp-cannib-severity">${p.severity === 'high' ? 'ALTA' : p.severity === 'medium' ? 'MÉDIA' : 'BAIXA'}</span>
                                <div class="pagecomp-cannib-text">
                                    <strong>${_escHtml(p.pageA)}</strong>
                                    ${p.pageATrend > 0 ? '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i>' : p.pageATrend < 0 ? '<i data-lucide="trending-down" style="width:14px;height:14px;vertical-align:-2px"></i>' : '<i data-lucide="minus" style="width:14px;height:14px;vertical-align:-2px"></i>'}
                                    <i data-lucide="arrow-left-right" style="width:14px;height:14px;vertical-align:-2px"></i>
                                    <strong>${_escHtml(p.pageB)}</strong>
                                    ${p.pageBTrend > 0 ? '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i>' : p.pageBTrend < 0 ? '<i data-lucide="trending-down" style="width:14px;height:14px;vertical-align:-2px"></i>' : '<i data-lucide="minus" style="width:14px;height:14px;vertical-align:-2px"></i>'}
                                    <br>
                                    <span class="pagecomp-cannib-sub">Correlação: ${p.correlation.toFixed(2)} — quando uma sobe, a outra tende a cair.</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                    ${data.overallGrowth <= 0 ? `
                        <div class="pagecomp-cannib-verdict">
                            <i data-lucide="alert-triangle" style="width:14px;height:14px;vertical-align:-2px"></i>️ Vendas totais ${data.overallGrowth === 0 ? 'estagnadas' : 'caindo'} mesmo com múltiplas páginas — sinal forte de canibalização em vez de crescimento incremental.
                        </div>
                    ` : `
                        <div class="pagecomp-cannib-verdict pagecomp-cannib-ok">
                            <i data-lucide="check" style="width:14px;height:14px;vertical-align:-2px"></i> Apesar da correlação negativa, o total de vendas está crescendo (+${data.overallGrowth}).
                        </div>
                    `}
                </div>
            `;
        } else if (pageCount >= 2) {
            html += `
                <div class="pagecomp-ok">
                    <i data-lucide="check-circle-2" style="width:14px;height:14px;color:var(--success)"></i>
                    Nenhuma canibalização detectada. As páginas estão crescendo de forma independente.
                </div>
            `;
        }

        // Chart
        if (pageCount > 0) {
            html += `
                <div class="pagecomp-chart">
                    <h4>Vendas por dia</h4>
                    ${_renderChart(data)}
                </div>
            `;
        }

        // Pages breakdown
        if (pageCount > 0) {
            html += `
                <div class="pagecomp-pages">
                    <h4>Detalhes por página</h4>
                    <table class="pagecomp-table">
                        <thead>
                            <tr>
                                <th>Página</th>
                                <th>Vendas</th>
                                <th>Budget</th>
                                <th>CPA</th>
                                <th>ROAS</th>
                                <th>Tendência</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${data.pages.map(p => `
                                <tr>
                                    <td><strong>${_escHtml(p.label)}</strong></td>
                                    <td>${p.totalSales}</td>
                                    <td>R$ ${p.totalBudget.toFixed(2)}</td>
                                    <td>${p.cpa !== null ? 'R$ ' + p.cpa.toFixed(2) : '—'}</td>
                                    <td>${p.roas !== null ? p.roas.toFixed(2) + 'x' : '—'}</td>
                                    <td class="${p.trend > 0 ? 'trend-up' : p.trend < 0 ? 'trend-down' : ''}">
                                        ${p.trend > 0 ? '<i data-lucide="arrow-up" style="width:14px;height:14px;vertical-align:-2px"></i> +' + p.trend : p.trend < 0 ? '<i data-lucide="arrow-down" style="width:14px;height:14px;vertical-align:-2px"></i> ' + p.trend : '<i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> 0'}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            `;
        }

        // Unassigned entries — let user tag them
        if (unassignedCount > 0) {
            const unassigned = (AppState.allDiary || []).filter(e =>
                e.productId === _selectedProductId &&
                !e.pageLabel && !e.campaignName && !e.adName &&
                e.date >= data.dates[0] && e.date <= data.dates[data.dates.length - 1]
            );
            html += `
                <div class="pagecomp-unassigned">
                    <h4>
                        <i data-lucide="tag" style="width:14px;height:14px"></i>
                        Classificar entradas sem página (${unassigned.length})
                    </h4>
                    <p class="pagecomp-hint">Atribua um rótulo de página para cada entrada para refinar a análise.</p>
                    <div class="pagecomp-unassigned-list">
                        ${unassigned.map(e => `
                            <div class="pagecomp-unassigned-row">
                                <span class="pagecomp-un-date">${e.date}</span>
                                <span class="pagecomp-un-sales">${e.sales || 0} vendas · R$ ${(Number(e.budget) || 0).toFixed(2)}</span>
                                <input class="input input-sm pagecomp-un-input" data-eid="${e.id}"
                                    placeholder="Ex: Página A, Funnel 1..." value="${_escHtml(e.pageLabel || '')}">
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        body.innerHTML = html;
        if (typeof lucide !== 'undefined') lucide.createIcons();

        // Bind controls
        document.getElementById('pagecomp-product')?.addEventListener('change', (e) => {
            _selectedProductId = e.target.value;
            render();
        });
        document.getElementById('pagecomp-range')?.addEventListener('change', (e) => {
            _rangeDays = parseInt(e.target.value);
            render();
        });

        // Inline page label editing
        body.querySelectorAll('.pagecomp-un-input').forEach(inp => {
            inp.addEventListener('blur', (e) => {
                const eid = e.target.dataset.eid;
                const val = e.target.value;
                if (_setPageLabel(eid, val)) {
                    showToast('Página atribuída.', 'success');
                    render();
                }
            });
            inp.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') e.target.blur();
            });
        });
    }

    function _escHtml(str) {
        const el = document.createElement('span');
        el.textContent = str || '';
        return el.innerHTML;
    }

    function init() {
        document.getElementById('btn-page-comparison')?.addEventListener('click', () => openModal());
    }

    return {
        init,
        openModal,
        buildComparison,
        render,
    };
})();
