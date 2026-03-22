/* ===========================
   GoogleAds.js — Manual sync controls for backend Cloud Run
   =========================== */

const GoogleAdsModule = {
    _pollTimer: null,
    _isSyncing: false,

    init() {
        const btnSync = document.getElementById('btn-gads-sync-now');
        if (btnSync) {
            btnSync.addEventListener('click', () => this.syncNow());
        }

        const btnConfig = document.getElementById('btn-gads-config');
        if (btnConfig) {
            btnConfig.addEventListener('click', () => this.configure());
        }

        EventBus.on('tabChanged', (tab) => {
            if (tab === 'diagnostico') {
                this.refreshRuns();
            }
        });

        this._renderStatus();
        this.refreshRuns();
    },

    configure() {
        const currentUrl = (AppState.config.googleAdsSyncUrl || '').trim();
        const currentToken = (AppState.config.googleAdsSyncToken || '').trim();
        const currentRequester = localStorage.getItem('googleAdsRequestedBy') || '';

        const url = window.prompt(
            'URL base do backend (ex: https://google-ads-sync-xxxx.run.app)',
            currentUrl
        );
        if (url === null) return;

        const token = window.prompt(
            'Token do sync manual (x-sync-token)',
            currentToken
        );
        if (token === null) return;

        const requester = window.prompt(
            'Identificador opcional (email/nome) para auditoria',
            currentRequester
        );
        if (requester === null) return;

        AppState.config.googleAdsSyncUrl = url.trim().replace(/\/$/, '');
        AppState.config.googleAdsSyncToken = token.trim();
        localStorage.setItem('googleAdsSyncUrl', AppState.config.googleAdsSyncUrl);
        localStorage.setItem('googleAdsSyncToken', AppState.config.googleAdsSyncToken);
        localStorage.setItem('googleAdsRequestedBy', requester.trim());

        this._renderStatus();
        showToast('Configuração do Google Ads Sync salva.', 'success');
    },

    _isConfigured() {
        return !!(AppState.config.googleAdsSyncUrl && AppState.config.googleAdsSyncToken);
    },

    _renderStatus(mode = '') {
        const badge = document.getElementById('gads-status');
        if (!badge) return;

        if (!this._isConfigured()) {
            badge.textContent = 'GAds Não Configurado';
            badge.className = 'status-badge status-disconnected';
            return;
        }

        if (mode === 'syncing') {
            badge.textContent = 'GAds Sincronizando';
            badge.className = 'status-badge status-warning';
            return;
        }

        if (mode === 'error') {
            badge.textContent = 'GAds Erro';
            badge.className = 'status-badge status-disconnected';
            return;
        }

        badge.textContent = 'GAds Configurado';
        badge.className = 'status-badge status-connected';
    },

    async syncNow() {
        if (!this._isConfigured()) {
            showToast('Configure o Google Ads Sync primeiro.', 'error');
            return;
        }

        if (this._isSyncing) {
            showToast('Sincronização já em andamento.', 'info');
            return;
        }

        this._isSyncing = true;
        this._renderStatus('syncing');

        const requestedBy = (localStorage.getItem('googleAdsRequestedBy') || '').trim() || 'app-user';
        const isAllStores = typeof isAllStoresSelected === 'function' ? isAllStoresSelected() : true;
        const storeId = isAllStores ? undefined : (typeof getCurrentStoreId === 'function' ? getCurrentStoreId() : undefined);

        const payload = {
            requestedBy,
            ...(storeId ? { storeId } : {})
        };

        try {
            const res = await this._fetchWithTimeout('/sync/manual', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-sync-token': AppState.config.googleAdsSyncToken
                },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const errText = await this._safeReadBody(res);
                throw new Error(`HTTP ${res.status} — ${errText}`);
            }

            const data = await res.json();
            showToast(`Sincronização disparada (run: ${data.runId})`, 'success');
            await this.refreshRuns();
            this._startPolling();
        } catch (err) {
            console.error('Google Ads sync manual error:', err);
            this._renderStatus('error');
            showToast(`Falha ao disparar sync: ${err.message}`, 'error');
        } finally {
            this._isSyncing = false;
            if (this._isConfigured()) this._renderStatus();
        }
    },

    _startPolling() {
        clearInterval(this._pollTimer);
        let ticks = 0;
        this._pollTimer = setInterval(async () => {
            ticks += 1;
            await this.refreshRuns(true);
            if (ticks >= 8) {
                clearInterval(this._pollTimer);
                this._pollTimer = null;
            }
        }, 3000);
    },

    async refreshRuns(silent = false) {
        const list = document.getElementById('gads-runs-list');
        if (!list) return;

        if (!this._isConfigured()) {
            list.innerHTML = '<p class="text-muted">Configure o backend para listar execuções.</p>';
            return;
        }

        try {
            const res = await this._fetchWithTimeout('/runs?limit=6', {
                method: 'GET',
                headers: {
                    'x-sync-token': AppState.config.googleAdsSyncToken
                }
            }, 12000);

            if (!res.ok) {
                const errText = await this._safeReadBody(res);
                throw new Error(`HTTP ${res.status} — ${errText}`);
            }

            const data = await res.json();
            this._renderRuns(Array.isArray(data?.runs) ? data.runs : []);
        } catch (err) {
            console.error('Google Ads runs fetch error:', err);
            if (!silent) {
                list.innerHTML = '<p class="text-muted">Não foi possível carregar execuções do backend.</p>';
                showToast('Falha ao consultar histórico de sync do Google Ads.', 'error');
            }
        }
    },

    _renderRuns(runs) {
        const list = document.getElementById('gads-runs-list');
        if (!list) return;

        if (!runs || runs.length === 0) {
            list.innerHTML = '<p class="text-muted">Nenhuma sincronização registrada.</p>';
            return;
        }

        list.innerHTML = runs.map(run => {
            const status = String(run.status || '').toUpperCase();
            const pillClass = status === 'SUCCESS'
                ? 'ok'
                : (status === 'RUNNING' || status === 'ACCEPTED' ? 'running' : 'error');

            const finishedAt = run.finishedAt || run.finished_at || run.startedAt || run.started_at;
            const when = finishedAt ? this._formatDateTime(finishedAt) : '--';

            const success = Number(run.rowsSuccess || run.rows_success || 0);
            const failed = Number(run.rowsFailed || run.rows_failed || 0);
            const processed = Number(run.rowsProcessed || run.rows_processed || 0);

            return `
                <div class="gads-run-item">
                    <div class="gads-run-meta">
                        <div class="gads-run-main">${this._escapeHtml(run.runId || run.run_id || 'sem-id')} • ${this._escapeHtml(String(run.mode || 'manual'))}</div>
                        <div class="gads-run-sub">${when} • Processadas: ${processed} • Sucesso: ${success} • Falhas: ${failed}</div>
                    </div>
                    <span class="gads-run-pill ${pillClass}">${this._escapeHtml(status || 'UNKNOWN')}</span>
                </div>
            `;
        }).join('');
    },

    _formatDateTime(value) {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '--';
        return d.toLocaleString('pt-BR');
    },

    _escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    },

    async _safeReadBody(res) {
        try {
            return (await res.text()).slice(0, 300);
        } catch (_) {
            return 'sem detalhes';
        }
    },

    async _fetchWithTimeout(path, options, timeoutMs = 15000) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const baseUrl = AppState.config.googleAdsSyncUrl.replace(/\/$/, '');
        try {
            return await fetch(`${baseUrl}${path}`, {
                ...options,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timer);
        }
    }
};
