/* =========================================================
   RemoteCapturesModule — Recebe snapshots do BK Dashboard / Payoneer
   capturados pela extensão Chrome, persiste no IndexedDB (via MediaStore
   ou um wrapper próprio) e renderiza painel pro usuário revisar.

   Fluxo:
     extension/content/remote-capture.js → chrome.storage.queue →
     extension/content/app-bridge.js → window.postMessage('remote-capture-data') →
     este módulo → IndexedDB + UI
   ========================================================= */

const RemoteCapturesModule = (() => {
    const STORAGE_KEY = 'etracker_remote_captures_index'; // só índice leve em localStorage
    const DB_NAME = 'etracker_captures';
    const STORE_NAME = 'captures';
    const DB_VERSION = 1;

    let _captures = []; // índice leve em memória: [{id, plataforma, url, titulo, moeda, capturadoEm}]
    let _dbPromise = null;

    // ── IndexedDB (snapshot completo é pesado, vai pro IDB) ──
    function _openDb() {
        if (_dbPromise) return _dbPromise;
        _dbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('IndexedDB indisponível')); return; }
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return _dbPromise;
    }

    async function _saveSnapshot(id, snapshot) {
        const db = await _openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put({ id, ...snapshot });
            tx.oncomplete = () => resolve(id);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function _loadSnapshot(id) {
        const db = await _openDb();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const rq = tx.objectStore(STORE_NAME).get(id);
            rq.onsuccess = () => resolve(rq.result || null);
            rq.onerror = () => resolve(null);
        });
    }

    async function _deleteSnapshot(id) {
        const db = await _openDb();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(id);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    }

    // ── Índice leve em LocalStorage ─────────────────────────
    function _loadIndex() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            _captures = raw ? JSON.parse(raw) : [];
        } catch (e) { _captures = []; }
    }

    function _saveIndex() {
        try {
            const doSave = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(_captures));
            if (typeof StorageManager !== 'undefined' && StorageManager.withReclaim) {
                StorageManager.withReclaim(doSave, 'remote-captures-index');
            } else {
                doSave();
            }
        } catch (e) { console.error('captures index save failed', e); }
    }

    function _genId() { return 'cap_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

    /* =====================================================
       PARSER — interpreta o snapshot bruto e extrai números
       prontos pra Conciliação (lucro BK, saldo Payoneer,
       total pago em fornecedores Flowborder/Wiio).
       ===================================================== */

    // "R$ 68.365,12" | "£1,234.56" | "$123.45" | "229.435" → número
    function _parseMoney(str) {
        if (str == null) return null;
        let s = String(str).replace(/[^\d.,-]/g, '');
        if (!s || !/\d/.test(s)) return null;
        const neg = /-/.test(String(str));
        s = s.replace(/-/g, '');
        if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');       // pt-BR: 68.365,12
        else if (/\.\d{1,2}$/.test(s)) s = s.replace(/,/g, '');                     // en: 1,234.56
        else s = s.replace(/[.,]/g, '');                                            // inteiro: 229.435
        const n = parseFloat(s);
        return isFinite(n) ? (neg ? -n : n) : null;
    }

    const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const MESES_NOME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

    // Detecta o período (mês/ano) da captura: datas visíveis → nome do mês no texto → data da captura
    function _detectarPeriodo(snap) {
        const freq = {};
        (snap.datasVisiveis || []).forEach(d => {
            let m = null, y = null;
            let mm = d.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
            if (mm) { m = parseInt(mm[2], 10); y = parseInt(mm[3], 10); if (y < 100) y += 2000; }
            else { mm = d.match(/\b(\d{4})-(\d{2})-\d{2}\b/); if (mm) { y = parseInt(mm[1], 10); m = parseInt(mm[2], 10); } }
            if (m >= 1 && m <= 12 && y > 2000) { const k = m + '/' + y; freq[k] = (freq[k] || 0) + 1; }
        });
        const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0];
        if (top) { const [m, y] = top[0].split('/').map(Number); return { mes: m, ano: y, label: MESES_ABREV[m - 1] + '/' + y }; }
        const nm = (snap.textoResumo || '').match(new RegExp('\\b(' + MESES_NOME.join('|') + ')\\s+(?:de\\s+)?(\\d{4})\\b', 'i'));
        if (nm) { const m = MESES_NOME.indexOf(nm[1].toLowerCase()) + 1; return { mes: m, ano: +nm[2], label: MESES_ABREV[m - 1] + '/' + nm[2] }; }
        const d = new Date(snap.capturadoEm || Date.now());
        return { mes: d.getMonth() + 1, ano: d.getFullYear(), label: MESES_ABREV[d.getMonth()] + '/' + d.getFullYear() };
    }

    // Campos do BK Dashboard por label (primeiro match ganha = cards do topo)
    const BK_CAMPOS = [
        ['metaLucro',        /meta\s*de\s*lucro/i],
        ['lucro',            /^lucro\b/i],
        ['faturamento',      /faturamento/i],
        ['custoProduto',     /c\.?\s*(?:de\s*)?produto|custo\s*de\s*produto/i],
        ['custoMarketing',   /an[úu]ncios|custo\s*de\s*marketing/i],
        ['taxas',            /^taxas?\b/i],
        ['impostos',         /impostos?/i],
        ['chargeback',       /chargeback/i],
        ['reembolso',        /reembolso/i],
        ['custosAdicionais', /custos\s*adicionais/i],
        ['ticketMedio',      /ticket\s*m[ée]dio/i],
        ['cpa',              /^cpa\b/i],
    ];

    function _parseBk(snap) {
        const campos = {};
        (snap.valoresComLabel || []).forEach(v => {
            const label = (v.label || '').trim();
            if (!label) return;
            for (const [key, re] of BK_CAMPOS) {
                if (re.test(label) && campos[key] === undefined) {
                    const n = _parseMoney(v.valor);
                    if (n !== null) campos[key] = n;
                    break; // label casa com no máx. 1 campo (ordem importa: metaLucro antes de lucro)
                }
            }
        });
        delete campos.metaLucro; // só serviu pra não contaminar "lucro"
        return campos;
    }

    function _parsePayoneer(snap) {
        const cands = (snap.valoresComLabel || []).filter(v =>
            /balance|saldo|dispon[íi]vel|available/i.test(v.label || ''));
        // prioriza GBP (moeda funcional da operação)
        const gbp = cands.find(v => /£|GBP/.test(v.valor)) || cands[0];
        const out = {};
        if (gbp) { out.saldoGBP = _parseMoney(gbp.valor); out.saldoLabel = gbp.label; out.saldoRaw = gbp.valor; }
        return out;
    }

    // Flowborder / Wiio: soma pedidos das tabelas (valor = última célula monetária da linha)
    function _parseFornecedor(snap) {
        let totalUSD = 0, pedidos = 0, totalPagoUSD = 0, pedidosPagos = 0;
        (snap.tabelas || []).forEach(t => {
            (t.rows || []).forEach(row => {
                let valor = null;
                for (let i = row.length - 1; i >= 0; i--) {
                    if (/(?:US?\$|USD|\$)\s*[\d.,]+/.test(row[i])) { valor = _parseMoney(row[i]); break; }
                }
                if (valor === null || valor <= 0) return;
                totalUSD += valor; pedidos++;
                if (row.some(c => /\b(paid|pago|completed|conclu[íi]d|shipped|enviado)\b/i.test(c))) {
                    totalPagoUSD += valor; pedidosPagos++;
                }
            });
        });
        if (!pedidos) return {};
        return {
            totalUSD: +totalUSD.toFixed(2), pedidos,
            totalPagoUSD: +(pedidosPagos ? totalPagoUSD : totalUSD).toFixed(2),
            pedidosPagos: pedidosPagos || pedidos,
            statusDetectado: pedidosPagos > 0,
        };
    }

    // Snapshot bruto → objeto interpretado pronto pra Conciliação
    function parseSnapshot(snap) {
        if (!snap) return null;
        const periodo = _detectarPeriodo(snap);
        const base = { plataforma: snap.plataforma, periodoLabel: periodo.label, mes: periodo.mes, ano: periodo.ano, capturadoEm: snap.capturadoEm };
        if (snap.plataforma === 'bkdash') return { ...base, campos: _parseBk(snap) };
        if (snap.plataforma === 'payoneer') return { ...base, campos: _parsePayoneer(snap) };
        if (snap.plataforma === 'flowborder' || snap.plataforma === 'wiio') return { ...base, campos: _parseFornecedor(snap) };
        return null;
    }

    // Resumo de 1 linha pro card da lista
    function _resumoLinha(parsed) {
        if (!parsed || !parsed.campos) return '';
        const c = parsed.campos;
        const fmt = (v) => (v == null ? null : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        if (parsed.plataforma === 'bkdash' && c.lucro != null)
            return `Lucro R$ ${fmt(c.lucro)} · ${parsed.periodoLabel}`;
        if (parsed.plataforma === 'payoneer' && c.saldoGBP != null)
            return `Saldo £ ${fmt(c.saldoGBP)}`;
        if ((parsed.plataforma === 'flowborder' || parsed.plataforma === 'wiio') && c.totalPagoUSD != null)
            return `${c.pedidosPagos} pedido${c.pedidosPagos !== 1 ? 's' : ''} · $ ${fmt(c.totalPagoUSD)}${c.statusDetectado ? ' (pagos)' : ''}`;
        return '';
    }

    // Última captura de uma plataforma, já interpretada
    async function getLatestParsed(plataforma) {
        const entry = _captures.find(c => c.plataforma === plataforma);
        if (!entry) return null;
        const snap = await _loadSnapshot(entry.id);
        return snap ? parseSnapshot(snap) : null;
    }

    // ── Recebe captures vindas da extensão (postMessage) ──
    async function _onCapturesReceived(captures) {
        if (!Array.isArray(captures) || !captures.length) return;
        let novosCount = 0;
        for (const snap of captures) {
            const id = _genId();
            try {
                await _saveSnapshot(id, snap);
                const parsed = parseSnapshot(snap);
                _captures.unshift({
                    id,
                    plataforma: snap.plataforma || 'desconhecida',
                    url: snap.url || '',
                    titulo: snap.titulo || '',
                    moeda: snap.moeda || '',
                    capturadoEm: snap.capturadoEm || new Date().toISOString(),
                    tabelasCount: (snap.tabelas || []).length,
                    valoresCount: (snap.valoresComLabel || []).length,
                    resumo: _resumoLinha(parsed),
                });
                novosCount++;
                // Aplica direto na Conciliação (lucro BK, saldo Payoneer, fornecedores)
                try {
                    if (parsed && typeof ReconciliationModule !== 'undefined' && ReconciliationModule.applyCapture) {
                        ReconciliationModule.applyCapture(parsed);
                    }
                } catch (err) { console.error('applyCapture falhou', err); }
            } catch (err) {
                console.error('falha ao salvar snapshot', err);
            }
        }
        if (novosCount > 0) {
            _saveIndex();
            if (typeof showToast === 'function') {
                showToast(`<i data-lucide="check" style="width:13px;height:13px;vertical-align:-2px"></i> ${novosCount} captura${novosCount > 1 ? 's' : ''} recebida${novosCount > 1 ? 's' : ''} da extensão`, 'success');
            }
            if (typeof EventBus !== 'undefined') EventBus.emit('remoteCapturesChanged');
            render();
        }
    }

    // ── API pública pra outros módulos consumirem ──
    function listCaptures() { return _captures.slice(); }
    function getCapture(id) { return _loadSnapshot(id); }

    async function removeCapture(id) {
        _captures = _captures.filter(c => c.id !== id);
        _saveIndex();
        await _deleteSnapshot(id);
        if (typeof EventBus !== 'undefined') EventBus.emit('remoteCapturesChanged');
        render();
    }

    async function clearAll() {
        if (!confirm('Apagar TODAS as capturas? Esta ação não pode ser desfeita.')) return;
        const ids = _captures.map(c => c.id);
        _captures = [];
        _saveIndex();
        for (const id of ids) await _deleteSnapshot(id);
        if (typeof EventBus !== 'undefined') EventBus.emit('remoteCapturesChanged');
        render();
    }

    // ── Render ──────────────────────────────────────────────
    function _esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function _fmtDate(iso) {
        try { return new Date(iso).toLocaleString('pt-BR'); } catch { return iso; }
    }
    function _platBadge(p) {
        const map = {
            bkdash: '<span class="cap-plat cap-plat-bk">BK Dashboard</span>',
            payoneer: '<span class="cap-plat cap-plat-payoneer">Payoneer</span>',
            flowborder: '<span class="cap-plat cap-plat-flowborder">Flowborder</span>',
            wiio: '<span class="cap-plat cap-plat-wiio">Wiio</span>',
        };
        return map[p] || `<span class="cap-plat">${_esc(p)}</span>`;
    }

    function render() {
        const panel = document.getElementById('tab-captures');
        if (!panel) return;
        const total = _captures.length;
        const porPlataforma = _captures.reduce((acc, c) => {
            acc[c.plataforma] = (acc[c.plataforma] || 0) + 1;
            return acc;
        }, {});

        panel.innerHTML = `
            <div class="section-header">
                <h2><i data-lucide="download-cloud" style="width:14px;height:14px;vertical-align:-2px"></i> Capturas da extensão</h2>
                <div>
                    <button class="btn btn-secondary" id="cap-refresh-btn"><i data-lucide="refresh-cw" style="width:13px;height:13px;vertical-align:-2px"></i> Recarregar</button>
                    ${total > 0 ? `<button class="btn btn-danger" id="cap-clear-btn"><i data-lucide="trash-2" style="width:13px;height:13px;vertical-align:-2px"></i> Limpar tudo</button>` : ''}
                </div>
            </div>
            <p class="captures-intro">
                Snapshots de <strong>BK Dashboard</strong>, <strong>Payoneer</strong>, <strong>Flowborder</strong> e <strong>Wiio</strong> capturados pela extensão Chrome.
                Ao visitar essas páginas logado, a extensão <strong>captura sozinha 1x por dia</strong> — ou clique no botão flutuante <em>"Capturar p/ ETracker"</em> a qualquer momento.
                Lucro, saldos e pedidos pagos são aplicados automaticamente na <strong>Conciliação</strong>.
                ${total > 0 ? `<br><small style="color:var(--text-muted)">${total} captura${total > 1 ? 's' : ''} no total · ${Object.entries(porPlataforma).map(([p, n]) => `${n} ${p}`).join(' · ')}</small>` : ''}
            </p>

            ${total === 0 ? `
                <div class="captures-empty">
                    <div class="captures-empty-icon"><i data-lucide="inbox" style="width:48px;height:48px;color:var(--text-muted)"></i></div>
                    <h3>Sem capturas ainda</h3>
                    <p>Abra <a href="https://bkdash.com.br/app" target="_blank">BK Dashboard</a>, <a href="https://payoneer.com" target="_blank">Payoneer</a>, <a href="https://app.flowborder.com/CustomOrder/Pending" target="_blank">Flowborder</a> ou <a href="https://app.wiio.io/CustomOrder/Pending" target="_blank">Wiio</a>, faça login, e a extensão captura sozinha (ou clique no botão flutuante).</p>
                </div>
            ` : `
                <div class="captures-list">
                    ${_captures.map(c => `
                        <div class="capture-card" data-cap-id="${c.id}">
                            <div class="capture-card-header">
                                ${_platBadge(c.plataforma)}
                                <span class="capture-moeda">${_esc(c.moeda || '?')}</span>
                                <button class="capture-x" data-cap-del="${c.id}" title="Remover">&times;</button>
                            </div>
                            <div class="capture-title">${_esc(c.titulo || 'Sem título')}</div>
                            ${c.resumo ? `<div class="capture-resumo">${_esc(c.resumo)}</div>` : ''}
                            <div class="capture-url" title="${_esc(c.url)}">${_esc((c.url || '').slice(0, 80))}${c.url && c.url.length > 80 ? '…' : ''}</div>
                            <div class="capture-meta">
                                <span><i data-lucide="clock" style="width:11px;height:11px;vertical-align:-1px"></i> ${_fmtDate(c.capturadoEm)}</span>
                                <span><i data-lucide="table" style="width:11px;height:11px;vertical-align:-1px"></i> ${c.tabelasCount} tabela${c.tabelasCount !== 1 ? 's' : ''}</span>
                                <span><i data-lucide="dollar-sign" style="width:11px;height:11px;vertical-align:-1px"></i> ${c.valoresCount} valor${c.valoresCount !== 1 ? 'es' : ''}</span>
                            </div>
                            <div class="capture-actions">
                                <button class="btn btn-secondary btn-sm" data-cap-view="${c.id}"><i data-lucide="eye" style="width:13px;height:13px;vertical-align:-2px"></i> Ver detalhes</button>
                                <button class="btn btn-secondary btn-sm" data-cap-export="${c.id}"><i data-lucide="download" style="width:13px;height:13px;vertical-align:-2px"></i> Exportar JSON</button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            `}

            <!-- Modal de detalhes -->
            <div id="cap-detail-modal" class="modal hidden">
                <div class="modal-overlay" onclick="RemoteCapturesModule.closeDetail()"></div>
                <div class="modal-content" style="max-width:900px;max-height:88vh;overflow-y:auto">
                    <div class="modal-header">
                        <h3 id="cap-detail-title">Detalhes da captura</h3>
                        <button class="btn-close" onclick="RemoteCapturesModule.closeDetail()">&times;</button>
                    </div>
                    <div id="cap-detail-body"></div>
                </div>
            </div>
        `;

        _wireEvents();
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    }

    function _wireEvents() {
        const $ = id => document.getElementById(id);
        $('cap-refresh-btn')?.addEventListener('click', () => {
            // Pede pra extensao (app-bridge) re-puxar a fila de capturas
            try { window.postMessage({ source: 'etracker-app', type: 'request-ext-pull' }, location.origin); } catch (e) {}
            _loadIndex();
            render();
            if (typeof showToast === 'function') showToast('Buscando capturas da extensão…', 'info');
        });
        $('cap-clear-btn')?.addEventListener('click', () => clearAll());

        document.querySelectorAll('[data-cap-del]').forEach(b => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = b.dataset.capDel;
                if (confirm('Remover esta captura?')) removeCapture(id);
            });
        });
        document.querySelectorAll('[data-cap-view]').forEach(b => {
            b.addEventListener('click', () => openDetail(b.dataset.capView));
        });
        document.querySelectorAll('[data-cap-export]').forEach(b => {
            b.addEventListener('click', async () => {
                const id = b.dataset.capExport;
                const snap = await _loadSnapshot(id);
                if (!snap) return;
                const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `captura-${snap.plataforma || 'dados'}-${(snap.capturadoEm || '').slice(0,10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
            });
        });
    }

    async function openDetail(id) {
        const modal = document.getElementById('cap-detail-modal');
        const body = document.getElementById('cap-detail-body');
        const title = document.getElementById('cap-detail-title');
        if (!modal || !body) return;
        body.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted)">Carregando…</p>';
        modal.classList.remove('hidden');

        const snap = await _loadSnapshot(id);
        if (!snap) {
            body.innerHTML = '<p>Captura não encontrada.</p>';
            return;
        }
        title.textContent = `${snap.plataforma || 'Captura'} — ${_fmtDate(snap.capturadoEm)}`;

        const parsed = parseSnapshot(snap);
        const camposKeys = parsed && parsed.campos ? Object.keys(parsed.campos).filter(k => parsed.campos[k] != null && typeof parsed.campos[k] !== 'boolean') : [];
        const NOMES = {
            lucro: 'Lucro', faturamento: 'Faturamento', custoProduto: 'Custo de Produto',
            custoMarketing: 'Anúncios / Marketing', taxas: 'Taxas', impostos: 'Impostos',
            chargeback: 'Chargeback', reembolso: 'Reembolso', custosAdicionais: 'Custos Adicionais',
            ticketMedio: 'Ticket Médio', cpa: 'CPA', saldoGBP: 'Saldo (£)', saldoLabel: 'Label do saldo',
            saldoRaw: 'Valor bruto', totalUSD: 'Total ($)', pedidos: 'Pedidos', totalPagoUSD: 'Total pago ($)',
            pedidosPagos: 'Pedidos pagos',
        };

        body.innerHTML = `
            <div class="capture-detail-section">
                <div><strong>URL:</strong> <a href="${_esc(snap.url)}" target="_blank">${_esc(snap.url)}</a></div>
                <div><strong>Título:</strong> ${_esc(snap.titulo || '—')}</div>
                <div><strong>Moeda dominante:</strong> ${_esc(snap.moeda || '—')}</div>
            </div>

            ${camposKeys.length ? `
                <div class="capture-parsed">
                    <h4 class="capture-detail-h"><i data-lucide="zap" style="width:13px;height:13px;vertical-align:-2px"></i> Interpretação automática — ${_esc(parsed.periodoLabel)}</h4>
                    <table class="capture-detail-table">
                        <tbody>
                        ${camposKeys.map(k => `
                            <tr><td>${_esc(NOMES[k] || k)}</td><td class="capture-money">${typeof parsed.campos[k] === 'number' ? parsed.campos[k].toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : _esc(parsed.campos[k])}</td></tr>
                        `).join('')}
                        </tbody>
                    </table>
                    <button class="btn btn-primary btn-sm" id="cap-apply-btn" style="margin-top:.5rem">
                        <i data-lucide="zap" style="width:13px;height:13px;vertical-align:-2px"></i> Aplicar na Conciliação (${_esc(parsed.periodoLabel)})
                    </button>
                </div>
            ` : ''}

            ${(snap.valoresComLabel || []).length ? `
                <h4 class="capture-detail-h"><i data-lucide="dollar-sign" style="width:13px;height:13px;vertical-align:-2px"></i> Valores monetários encontrados (${snap.valoresComLabel.length})</h4>
                <table class="capture-detail-table">
                    <thead><tr><th>Label</th><th>Valor</th></tr></thead>
                    <tbody>
                    ${snap.valoresComLabel.slice(0, 60).map(v => `
                        <tr>
                            <td>${_esc(v.label || '—')}</td>
                            <td class="capture-money">${_esc(v.valor)}</td>
                        </tr>
                    `).join('')}
                    </tbody>
                </table>
            ` : ''}

            ${(snap.tabelas || []).length ? `
                <h4 class="capture-detail-h"><i data-lucide="bar-chart-3" style="width:13px;height:13px;vertical-align:-2px"></i> Tabelas encontradas (${snap.tabelas.length})</h4>
                ${snap.tabelas.slice(0, 3).map(t => `
                    <div class="capture-tab-block">
                        <table class="capture-detail-table">
                            <thead><tr>${(t.headers || []).map(h => `<th>${_esc(h)}</th>`).join('')}</tr></thead>
                            <tbody>
                                ${(t.rows || []).slice(0, 20).map(row => `
                                    <tr>${row.map(c => `<td>${_esc(c)}</td>`).join('')}</tr>
                                `).join('')}
                            </tbody>
                        </table>
                        ${t.rows.length > 20 ? `<small>Mostrando 20 de ${t.rows.length} linhas</small>` : ''}
                    </div>
                `).join('')}
            ` : ''}

            ${(snap.datasVisiveis || []).length ? `
                <h4 class="capture-detail-h"><i data-lucide="calendar" style="width:13px;height:13px;vertical-align:-2px"></i> Datas detectadas</h4>
                <div class="capture-dates">${snap.datasVisiveis.map(d => `<span class="capture-date-pill">${_esc(d)}</span>`).join('')}</div>
            ` : ''}

            <details style="margin-top:1.5rem">
                <summary style="cursor:pointer;color:var(--text-muted);font-size:0.85rem">Ver texto bruto (debug)</summary>
                <pre style="background:var(--bg-input);padding:0.75rem;border-radius:6px;font-size:0.7rem;max-height:300px;overflow:auto;margin-top:0.5rem">${_esc((snap.textoResumo || '').slice(0, 4000))}</pre>
            </details>
        `;
        document.getElementById('cap-apply-btn')?.addEventListener('click', () => {
            if (parsed && typeof ReconciliationModule !== 'undefined' && ReconciliationModule.applyCapture) {
                ReconciliationModule.applyCapture(parsed, { manual: true });
            } else if (typeof showToast === 'function') {
                showToast('Módulo de Conciliação não carregado.', 'error');
            }
        });
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    }

    function closeDetail() {
        document.getElementById('cap-detail-modal')?.classList.add('hidden');
    }

    // ── Init ───────────────────────────────────────────────
    function init() {
        _loadIndex();
        // Escuta mensagens da extensão via app-bridge
        window.addEventListener('message', (event) => {
            if (event.origin !== location.origin) return;
            const data = event.data;
            if (!data || data.source !== 'etracker-extension') return;
            if (data.type === 'remote-capture-data' && Array.isArray(data.captures)) {
                _onCapturesReceived(data.captures);
            }
        });
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (tab) => {
                if (tab === 'captures') render();
            });
        }
        if (document.querySelector('#tab-captures.active')) render();
    }

    return {
        init, render, listCaptures, getCapture, removeCapture, clearAll, openDetail, closeDetail,
        parseSnapshot, getLatestParsed,
    };
})();

if (typeof window !== 'undefined') window.RemoteCapturesModule = RemoteCapturesModule;
