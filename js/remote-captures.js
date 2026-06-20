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

    // ── Recebe captures vindas da extensão (postMessage) ──
    async function _onCapturesReceived(captures) {
        if (!Array.isArray(captures) || !captures.length) return;
        let novosCount = 0;
        for (const snap of captures) {
            const id = _genId();
            try {
                await _saveSnapshot(id, snap);
                _captures.unshift({
                    id,
                    plataforma: snap.plataforma || 'desconhecida',
                    url: snap.url || '',
                    titulo: snap.titulo || '',
                    moeda: snap.moeda || '',
                    capturadoEm: snap.capturadoEm || new Date().toISOString(),
                    tabelasCount: (snap.tabelas || []).length,
                    valoresCount: (snap.valoresComLabel || []).length,
                });
                novosCount++;
            } catch (err) {
                console.error('falha ao salvar snapshot', err);
            }
        }
        if (novosCount > 0) {
            _saveIndex();
            if (typeof showToast === 'function') {
                showToast(`✓ ${novosCount} captura${novosCount > 1 ? 's' : ''} recebida${novosCount > 1 ? 's' : ''} da extensão`, 'success');
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
                Snapshots do <strong>BK Dashboard</strong> e <strong>Payoneer</strong> capturados pela extensão Chrome.
                Pra capturar: instale a extensão, abra a página externa, e clique no botão flutuante <em>"Capturar p/ ETracker"</em>.
                ${total > 0 ? `<br><small style="color:var(--text-muted)">${total} captura${total > 1 ? 's' : ''} no total · ${Object.entries(porPlataforma).map(([p, n]) => `${n} ${p}`).join(' · ')}</small>` : ''}
            </p>

            ${total === 0 ? `
                <div class="captures-empty">
                    <div class="captures-empty-icon"><i data-lucide="inbox" style="width:48px;height:48px;color:var(--text-muted)"></i></div>
                    <h3>Sem capturas ainda</h3>
                    <p>Abra <a href="https://bkdash.com.br/app" target="_blank">BK Dashboard</a> ou <a href="https://payoneer.com" target="_blank">Payoneer</a>, faça login, e clique no botão flutuante da extensão pra fazer a 1ª captura.</p>
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
        $('cap-refresh-btn')?.addEventListener('click', () => { _loadIndex(); render(); });
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

        body.innerHTML = `
            <div class="capture-detail-section">
                <div><strong>URL:</strong> <a href="${_esc(snap.url)}" target="_blank">${_esc(snap.url)}</a></div>
                <div><strong>Título:</strong> ${_esc(snap.titulo || '—')}</div>
                <div><strong>Moeda dominante:</strong> ${_esc(snap.moeda || '—')}</div>
            </div>

            ${(snap.valoresComLabel || []).length ? `
                <h4 class="capture-detail-h">💰 Valores monetários encontrados (${snap.valoresComLabel.length})</h4>
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
                <h4 class="capture-detail-h">📊 Tabelas encontradas (${snap.tabelas.length})</h4>
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
                <h4 class="capture-detail-h">📅 Datas detectadas</h4>
                <div class="capture-dates">${snap.datasVisiveis.map(d => `<span class="capture-date-pill">${_esc(d)}</span>`).join('')}</div>
            ` : ''}

            <details style="margin-top:1.5rem">
                <summary style="cursor:pointer;color:var(--text-muted);font-size:0.85rem">Ver texto bruto (debug)</summary>
                <pre style="background:var(--bg-input);padding:0.75rem;border-radius:6px;font-size:0.7rem;max-height:300px;overflow:auto;margin-top:0.5rem">${_esc((snap.textoResumo || '').slice(0, 4000))}</pre>
            </details>
        `;
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
    };
})();

if (typeof window !== 'undefined') window.RemoteCapturesModule = RemoteCapturesModule;
