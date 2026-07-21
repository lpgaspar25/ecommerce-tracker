/* ===========================
   Facebook.js — Facebook Ads API Integration
   Fetches campaign insights and maps to products
   =========================== */

const FacebookAds = {
    API_VERSION: 'v22.0',
    BASE_URL: 'https://graph.facebook.com',

    // Config persistida em localStorage
    // profiles: [{ id, name, token }] — um por perfil/Business Manager do Facebook
    // adAccounts: [{ id, name, currency, profileId }] — cada conta pertence a um perfil
    // activeAdAccountId: id da conta selecionada como "ativa"
    config: (() => {
        let profiles = [];
        try { profiles = JSON.parse(localStorage.getItem('fb_profiles') || '[]') || []; } catch { profiles = []; }
        let adAccounts = [];
        try { adAccounts = JSON.parse(localStorage.getItem('fb_ad_accounts') || '[]') || []; } catch { adAccounts = []; }
        let activeAdAccountId = localStorage.getItem('fb_active_ad_account_id') || '';

        // Migração: token único antigo vira o primeiro perfil
        const legacyToken = localStorage.getItem('fb_access_token') || '';
        if (profiles.length === 0 && legacyToken) {
            profiles = [{ id: 'perfil-1', name: 'Perfil principal', token: legacyToken }];
        }
        // Migração do formato antigo (1 ad account)
        const legacyId = localStorage.getItem('fb_ad_account_id') || '';
        if (legacyId && adAccounts.length === 0) {
            adAccounts = [{ id: legacyId, name: 'Conta principal' }];
            activeAdAccountId = legacyId;
        }
        // Toda conta precisa de profileId — contas antigas herdam o primeiro perfil
        adAccounts = adAccounts.map(a => ({ ...a, profileId: a.profileId || (profiles[0]?.id || '') }));
        if (!activeAdAccountId && adAccounts.length > 0) activeAdAccountId = adAccounts[0].id;

        const cfg = { profiles, adAccounts, activeAdAccountId };
        // Compat: muitos módulos leem config.accessToken — resolve para o token
        // do perfil dono da conta ativa (e escreve nele também)
        Object.defineProperty(cfg, 'accessToken', {
            get() {
                const acc = (cfg.adAccounts || []).find(a => a.id === cfg.activeAdAccountId);
                const prof = (cfg.profiles || []).find(p => p.id === acc?.profileId) || (cfg.profiles || [])[0];
                return prof?.token || '';
            },
            set(v) {
                const acc = (cfg.adAccounts || []).find(a => a.id === cfg.activeAdAccountId);
                let prof = (cfg.profiles || []).find(p => p.id === acc?.profileId) || (cfg.profiles || [])[0];
                if (!prof) {
                    prof = { id: 'perfil-1', name: 'Perfil principal', token: '' };
                    cfg.profiles.push(prof);
                }
                prof.token = v || '';
            }
        });
        return cfg;
    })(),

    // Token do perfil dono de uma conta específica (multi-perfil)
    _tokenForAccount(accountId) {
        const acc = (this.config.adAccounts || []).find(a => a.id === accountId);
        const prof = (this.config.profiles || []).find(p => p.id === acc?.profileId)
            || (this.config.profiles || [])[0];
        return prof?.token || '';
    },

    // Mapeamento campanhas: { accountId: { productId: [campaignIds] } }
    campaignMap: (() => {
        let raw = {};
        try { raw = JSON.parse(localStorage.getItem('fb_campaign_map') || '{}') || {}; } catch { raw = {}; }
        // Migração: formato antigo era plano { productId: [campaignIds] }
        const isFlat = Object.values(raw).some(v => Array.isArray(v));
        if (isFlat) {
            const legacyId = localStorage.getItem('fb_ad_account_id') || '';
            if (legacyId) {
                raw = { [legacyId]: raw };
                localStorage.setItem('fb_campaign_map', JSON.stringify(raw));
            }
        }
        return raw;
    })(),

    // ---- Status ----
    isConnected() {
        const hasToken = (this.config.profiles || []).some(p => p.token);
        return !!(hasToken && this.config.adAccounts.length > 0 && this.config.activeAdAccountId);
    },

    activeAccount() {
        return (this.config.adAccounts || []).find(a => a.id === this.config.activeAdAccountId) || null;
    },

    activeAccountCurrency() {
        const acc = this.activeAccount();
        return (acc?.currency || '').toUpperCase() || 'USD';
    },

    // Atualiza currencies de contas que não têm (legacy) buscando da Graph API
    async ensureAccountCurrencies() {
        if (!this.config.accessToken) return;
        const missing = (this.config.adAccounts || []).filter(a => !a.currency);
        if (missing.length === 0) return;
        try {
            const all = await this.fetchMyAdAccounts();
            const byId = {};
            all.forEach(a => { byId[a.id] = a.currency || ''; });
            this.config.adAccounts = this.config.adAccounts.map(a => ({
                ...a,
                currency: a.currency || byId[a.id] || '',
            }));
            this.saveConfig();
        } catch (e) { console.warn('[FB] ensureAccountCurrencies', e); }
    },

    // Conveniência: ID da conta ativa (compatibilidade com chamadas antigas)
    get activeAdAccountId() { return this.config.activeAdAccountId; },

    // ---- Persistência ----
    saveConfig() {
        localStorage.setItem('fb_profiles', JSON.stringify(this.config.profiles || []));
        localStorage.setItem('fb_ad_accounts', JSON.stringify(this.config.adAccounts || []));
        localStorage.setItem('fb_active_ad_account_id', this.config.activeAdAccountId || '');
        // Mantém compatibilidade com leitura antiga (token do perfil ativo)
        localStorage.setItem('fb_access_token', this.config.accessToken || '');
        localStorage.setItem('fb_ad_account_id', this.config.activeAdAccountId || '');

        // Salvar no Sheets Config tab se conectado
        if (AppState.sheetsConnected) {
            SheetsAPI.saveConfig('fb_ad_accounts', JSON.stringify(this.config.adAccounts || []));
            SheetsAPI.saveConfig('fb_active_ad_account_id', this.config.activeAdAccountId || '');
            // Tokens não vão pro Sheets por segurança
        }
    },

    saveCampaignMap() {
        localStorage.setItem('fb_campaign_map', JSON.stringify(this.campaignMap));

        if (AppState.sheetsConnected) {
            SheetsAPI.saveConfig('fb_campaign_map', JSON.stringify(this.campaignMap));
        }
    },

    // Mapeamento de campanhas da conta ativa
    _accountMap() {
        const id = this.config.activeAdAccountId;
        if (!id) return {};
        if (!this.campaignMap[id]) this.campaignMap[id] = {};
        return this.campaignMap[id];
    },

    // ---- UI Init ----
    initUI() {
        // Config form submit
        const form = document.getElementById('fb-config-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this._syncEditProfilesFromDOM();
                const profiles = (this._editProfiles || []).filter(p => (p.token || '').trim());
                if (profiles.length === 0) {
                    showToast('Adicione pelo menos um perfil com Access Token', 'error');
                    return;
                }

                // Lê seleção de contas no modal (checkboxes preenchidos via _populateAccountList)
                const checks = [...document.querySelectorAll('#fb-account-list input[type="checkbox"]:checked')];
                let adAccounts = checks.map(c => ({
                    id: c.value,
                    name: c.dataset.name || c.value,
                    currency: c.dataset.currency || '',
                    profileId: c.dataset.profileId || profiles[0].id
                }));

                if (adAccounts.length === 0) {
                    // Fallback: pega do input "manual" (ID único, modo legado)
                    const manual = document.getElementById('fb-ad-account-id')?.value.trim().replace(/^act_/, '');
                    if (manual) adAccounts = [{ id: manual, name: 'Conta principal', currency: '', profileId: profiles[0].id }];
                }

                if (!adAccounts.length) {
                    showToast('Adicione pelo menos uma conta de anúncio', 'error');
                    return;
                }

                this.config.profiles = profiles.map(p => ({ id: p.id, name: (p.name || '').trim() || 'Perfil', token: p.token.trim() }));
                this.config.adAccounts = adAccounts;
                if (!adAccounts.some(a => a.id === this.config.activeAdAccountId)) {
                    this.config.activeAdAccountId = adAccounts[0].id;
                }

                this.saveConfig();
                this._updateStatusBadge();
                this._renderActiveAccountSelector();
                closeModal('fb-config-modal');
                showToast(`Facebook conectado · ${profiles.length} perfil(is) · ${adAccounts.length} conta(s)`, 'success');
            });
        }

        // Perfis: delegação de eventos (adicionar, remover, buscar contas)
        const profileList = document.getElementById('fb-profile-list');
        if (profileList) {
            profileList.addEventListener('input', () => this._syncEditProfilesFromDOM());
            profileList.addEventListener('click', async (e) => {
                const removeBtn = e.target.closest('[data-fb-remove-profile]');
                if (removeBtn) {
                    this._syncEditProfilesFromDOM();
                    const idx = parseInt(removeBtn.dataset.fbRemoveProfile, 10);
                    const prof = this._editProfiles[idx];
                    if (prof && (this.config.adAccounts || []).some(a => a.profileId === prof.id)) {
                        if (!confirm(`Remover o perfil "${prof.name}"? As contas dele saem da lista.`)) return;
                        // Remove checkboxes de contas deste perfil
                        document.querySelectorAll(`#fb-account-list input[data-profile-id="${CSS.escape(prof.id)}"]`)
                            .forEach(cb => cb.closest('.fb-account-item')?.remove());
                    }
                    this._editProfiles.splice(idx, 1);
                    this._renderProfileList();
                    return;
                }
                const discoverBtn = e.target.closest('[data-fb-discover]');
                if (discoverBtn) {
                    this._syncEditProfilesFromDOM();
                    const idx = parseInt(discoverBtn.dataset.fbDiscover, 10);
                    const prof = this._editProfiles[idx];
                    const token = (prof?.token || '').trim();
                    if (!token) { showToast('Cole o Access Token deste perfil primeiro', 'error'); return; }
                    discoverBtn.disabled = true;
                    discoverBtn.textContent = 'Buscando…';
                    try {
                        const accounts = await this.fetchMyAdAccounts(token);
                        this._populateAccountList(
                            accounts.map(a => ({ ...a, profileId: prof.id })),
                            false, true /* append: mantém contas de outros perfis */
                        );
                        showToast(`${accounts.length} conta(s) encontrada(s) em "${prof.name}"`, 'success');
                    } catch (err) {
                        showToast('Falha: ' + err.message, 'error');
                    } finally {
                        discoverBtn.disabled = false;
                        discoverBtn.innerHTML = '<i data-lucide="search" style="width:13px;height:13px;vertical-align:-2px"></i> Buscar contas';
                        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
                    }
                }
            });
        }
        const btnAddProfile = document.getElementById('fb-add-profile');
        if (btnAddProfile) {
            btnAddProfile.addEventListener('click', () => {
                this._syncEditProfilesFromDOM();
                const n = this._editProfiles.length + 1;
                this._editProfiles.push({ id: `perfil-${Date.now().toString(36)}`, name: `Perfil ${n}`, token: '' });
                this._renderProfileList();
                const items = document.querySelectorAll('#fb-profile-list .fb-profile-name');
                items[items.length - 1]?.focus();
            });
        }

        // Botão: Adicionar conta manualmente (incremental, várias permitidas)
        const btnAddManual = document.getElementById('fb-add-account-manual');
        if (btnAddManual) {
            btnAddManual.addEventListener('click', () => {
                const idInput = document.getElementById('fb-ad-account-id');
                const nameInput = document.getElementById('fb-ad-account-name');
                const id = (idInput?.value || '').trim().replace(/^act_/, '');
                const name = (nameInput?.value || '').trim() || `Conta ${id}`;
                if (!id || !/^\d+$/.test(id)) {
                    showToast('ID inválido — use só números (sem "act_")', 'error');
                    return;
                }
                this._syncEditProfilesFromDOM();
                const profSel = document.getElementById('fb-manual-profile');
                const profileId = profSel?.value || this._editProfiles[0]?.id || '';
                this._addManualAccountToList({ id, name, profileId });
                if (idInput) idInput.value = '';
                if (nameInput) nameInput.value = '';
                idInput?.focus();
            });
        }

        // Auto-sync: toggle, intervalo e "sincronizar agora"
        const autoChk = document.getElementById('fb-auto-sync-enabled');
        if (autoChk) {
            autoChk.addEventListener('change', () => {
                this.autoSync.enabled = autoChk.checked;
                showToast(autoChk.checked
                    ? `Sincronização automática ligada (a cada ${this.autoSync.intervalHours}h)`
                    : 'Sincronização automática desligada', 'info');
                if (autoChk.checked) this.maybeAutoSync();
            });
        }
        const autoHours = document.getElementById('fb-auto-sync-hours');
        if (autoHours) {
            autoHours.addEventListener('change', () => { this.autoSync.intervalHours = parseInt(autoHours.value, 10) || 6; });
        }
        const autoNow = document.getElementById('fb-auto-sync-now');
        if (autoNow) {
            autoNow.addEventListener('click', () => this.runAutoSync({ manual: true }));
        }

        // Botão: Configurar Facebook (dentro do Diagnóstico)
        const btnConfig = document.getElementById('btn-fb-config');
        if (btnConfig) btnConfig.addEventListener('click', () => this._openConfigModal());

        // Botão: Mapear Campanhas
        const btnMap = document.getElementById('btn-fb-map-campaigns');
        if (btnMap) {
            btnMap.addEventListener('click', () => {
                const productId = document.getElementById('funnel-product').value;
                this.openCampaignMapper(productId);
            });
        }

        // Botão: Importar do Facebook
        const btnFetch = document.getElementById('btn-fb-fetch');
        if (btnFetch) {
            btnFetch.addEventListener('click', () => {
                if (typeof FunnelModule !== 'undefined' && FunnelModule.loadFromFacebook) {
                    FunnelModule.loadFromFacebook();
                } else {
                    showToast('Módulo do Diagnóstico não carregado', 'error');
                }
            });
        }

        // Botão: Importar TODOS os produtos
        const btnFetchAll = document.getElementById('btn-fb-fetch-all');
        if (btnFetchAll) {
            btnFetchAll.addEventListener('click', () => {
                if (typeof FunnelModule !== 'undefined' && FunnelModule.loadAllProductsFromFacebook) {
                    FunnelModule.loadAllProductsFromFacebook();
                } else {
                    showToast('Módulo do Diagnóstico não carregado', 'error');
                }
            });
        }

        // Botão global: dropdown do perfil
        const btnGlobal = document.getElementById('btn-fb-global-config');
        if (btnGlobal) btnGlobal.addEventListener('click', () => this._openConfigModal());

        // Botão no Ad Launcher
        const btnAdl = document.getElementById('adl-btn-fb-config');
        if (btnAdl) btnAdl.addEventListener('click', () => this._openConfigModal());

        // Update status on load
        this._updateStatusBadge();
        this._renderActiveAccountSelector();
        this.initAutoSync();
    },

    _openConfigModal() {
        // Trabalha numa cópia — só persiste no "Conectar"
        this._editProfiles = (this.config.profiles || []).map(p => ({ ...p }));
        this._renderProfileList();

        const manual = document.getElementById('fb-ad-account-id');
        if (manual) manual.value = '';
        if ((this.config.adAccounts || []).length > 0) {
            this._populateAccountList(this.config.adAccounts, true);
        } else {
            const list = document.getElementById('fb-account-list');
            if (list) list.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);padding:0.5rem">Cole o token de um perfil e clique em "Buscar contas" para listar as contas de anúncio dele.</p>';
        }

        // Auto-sync: estado atual
        const autoChk = document.getElementById('fb-auto-sync-enabled');
        if (autoChk) autoChk.checked = this.autoSync.enabled;
        const autoHours = document.getElementById('fb-auto-sync-hours');
        if (autoHours) autoHours.value = String(this.autoSync.intervalHours);
        this._updateAutoSyncStatus();

        openModal('fb-config-modal');
    },

    // ---- UI: Perfis do Facebook (modal) ----
    _editProfiles: [],

    _renderProfileList() {
        const wrap = document.getElementById('fb-profile-list');
        if (!wrap) return;
        if (!this._editProfiles || this._editProfiles.length === 0) {
            this._editProfiles = [{ id: 'perfil-1', name: 'Perfil principal', token: '' }];
        }
        wrap.innerHTML = this._editProfiles.map((p, i) => `
            <div class="fb-profile-item" data-profile-idx="${i}">
                <div class="fb-profile-row">
                    <input type="text" class="input input-sm fb-profile-name" placeholder="Nome (ex: Perfil João)" value="${this._esc(p.name)}">
                    <button type="button" class="btn btn-sm btn-secondary" data-fb-discover="${i}"><i data-lucide="search" style="width:13px;height:13px;vertical-align:-2px"></i> Buscar contas</button>
                    ${this._editProfiles.length > 1 ? `<button type="button" class="btn-icon fb-profile-remove" data-fb-remove-profile="${i}" title="Remover perfil"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>` : ''}
                </div>
                <input type="password" class="input input-sm fb-profile-token" placeholder="Access Token deste perfil (long-lived)" value="${this._esc(p.token)}" autocomplete="off">
            </div>`).join('');
        this._renderManualProfileSelect();
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    },

    // Lê os inputs de nome/token de volta pro array de edição
    _syncEditProfilesFromDOM() {
        const items = document.querySelectorAll('#fb-profile-list .fb-profile-item');
        items.forEach(item => {
            const idx = parseInt(item.dataset.profileIdx, 10);
            if (!this._editProfiles[idx]) return;
            this._editProfiles[idx].name = item.querySelector('.fb-profile-name')?.value || '';
            this._editProfiles[idx].token = item.querySelector('.fb-profile-token')?.value || '';
        });
    },

    _renderManualProfileSelect() {
        const sel = document.getElementById('fb-manual-profile');
        if (!sel) return;
        sel.innerHTML = (this._editProfiles || []).map(p =>
            `<option value="${this._esc(p.id)}">${this._esc(p.name || p.id)}</option>`
        ).join('');
    },

    _updateStatusBadge() {
        const connected = this.isConnected();
        const n = connected ? this.config.adAccounts.length : 0;
        const active = connected ? this.activeAccount() : null;
        const label = connected
            ? (n === 1 ? `FB · ${active?.name || 'conectado'}` : `FB · ${n} contas`)
            : 'FB Desconectado';
        const cls = connected ? 'status-badge status-connected' : 'status-badge status-disconnected';

        // Badge dentro do Diagnóstico/Funil
        const badge = document.getElementById('fb-status');
        if (badge) { badge.textContent = label; badge.className = cls; badge.title = active ? `Conta ativa: ${active.name} (${active.id})` : ''; }

        // Badge no dropdown global
        const globalBadge = document.getElementById('fb-global-status');
        if (globalBadge) {
            globalBadge.textContent = connected ? 'Conectado' : 'Desconectado';
            globalBadge.className = cls + ' profile-dropdown-badge';
        }

        // Card no Ad Launcher
        this._updateAdLauncherCard();
    },

    _updateAdLauncherCard() {
        const statusText = document.getElementById('adl-fb-status-text');
        const accountsList = document.getElementById('adl-fb-accounts-list');
        if (!statusText) return;
        if (this.isConnected()) {
            const accounts = this.config.adAccounts || [];
            statusText.textContent = `${accounts.length} conta(s) conectada(s)`;
            statusText.style.color = 'var(--green)';
            if (accountsList) {
                accountsList.style.display = 'flex';
                accountsList.innerHTML = accounts.map(a =>
                    `<span class="adl-fb-account-pill${a.id === this.config.activeAdAccountId ? ' adl-fb-account-active' : ''}">
                        <i data-lucide="check-circle" style="width:11px;height:11px"></i> ${this._esc(a.name || a.id)}
                    </span>`
                ).join('');
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
            }
        } else {
            statusText.textContent = 'Desconectado — clique em Configurar';
            statusText.style.color = 'var(--text-muted)';
            if (accountsList) accountsList.style.display = 'none';
        }
    },

    // Adiciona uma conta manualmente à lista do modal (sem persistir até "Conectar")
    _addManualAccountToList({ id, name, profileId }) {
        const list = document.getElementById('fb-account-list');
        if (!list) return;
        // Remove placeholder se existir
        const placeholder = list.querySelector('p');
        if (placeholder) placeholder.remove();
        // Verifica duplicata
        const existing = list.querySelector(`input[type="checkbox"][value="${CSS.escape(id)}"]`);
        if (existing) {
            existing.checked = true;
            existing.closest('.fb-account-item')?.classList.add('fb-account-flash');
            setTimeout(() => existing.closest('.fb-account-item')?.classList.remove('fb-account-flash'), 600);
            showToast('Conta já está na lista — marcada', 'success');
            return;
        }
        const profName = (this._editProfiles || []).find(p => p.id === profileId)?.name || '';
        const html = `<label class="fb-account-item">
            <input type="checkbox" value="${this._esc(id)}" data-name="${this._esc(name)}" data-profile-id="${this._esc(profileId || '')}" checked>
            <span class="fb-account-name">${this._esc(name)}</span>
            ${profName ? `<span class="fb-account-profile">${this._esc(profName)}</span>` : ''}
            <span class="fb-account-meta">${this._esc(id)} · manual</span>
        </label>`;
        list.insertAdjacentHTML('beforeend', html);
        showToast(`Adicionada: ${name}`, 'success');
    },

    // append=true mantém itens já listados (contas de outros perfis)
    _populateAccountList(accounts, allChecked = false, append = false) {
        const list = document.getElementById('fb-account-list');
        if (!list) return;
        if (!accounts || accounts.length === 0) {
            if (!append) list.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);padding:0.5rem">Nenhuma conta retornada.</p>';
            return;
        }
        const tracked = new Set((this.config.adAccounts || []).map(a => a.id));
        const profileName = (pid) =>
            ((this._editProfiles || []).find(p => p.id === pid) || (this.config.profiles || []).find(p => p.id === pid))?.name || '';
        const rowHtml = (a) => {
            const checked = allChecked || tracked.has(a.id) ? 'checked' : '';
            const meta = [a.currency, a.timezone].filter(Boolean).join(' · ');
            // account_status: 1=ativa, 2=desativada, 3=cobrança pendente
            const statusFlag = a.status === 2 ? ' <span class="fb-account-disabled" title="Conta desativada pelo Facebook">desativada</span>'
                : a.status === 3 ? ' <span class="fb-account-disabled" title="Cobrança pendente">cobrança pendente</span>' : '';
            const profName = profileName(a.profileId);
            return `<label class="fb-account-item">
                <input type="checkbox" value="${this._esc(a.id)}" data-name="${this._esc(a.name)}" data-currency="${this._esc(a.currency || '')}" data-profile-id="${this._esc(a.profileId || '')}" ${checked}>
                <span class="fb-account-name">${this._esc(a.name)}</span>
                ${profName ? `<span class="fb-account-profile">${this._esc(profName)}</span>` : ''}
                <span class="fb-account-meta">${this._esc(a.id)}${meta ? ' · ' + this._esc(meta) : ''}${statusFlag}</span>
            </label>`;
        };

        if (append) {
            const placeholder = list.querySelector('p');
            if (placeholder) placeholder.remove();
            accounts.forEach(a => {
                const existing = list.querySelector(`input[type="checkbox"][value="${CSS.escape(a.id)}"]`);
                if (existing) return; // já listada (mesma conta em dois perfis: mantém o primeiro)
                list.insertAdjacentHTML('beforeend', rowHtml(a));
            });
        } else {
            list.innerHTML = accounts.map(rowHtml).join('');
        }
    },

    // ═══════════════════════════════════════════════════════════════
    //  Camada de API — rate-limit, backoff e fila única
    //  A Marketing API bloqueia contas que fazem rajadas de chamadas.
    //  Aqui todas as chamadas passam por uma fila serializada com
    //  espaçamento mínimo, backoff exponencial nos códigos de limite
    //  e cooldown automático quando os headers de uso ficam altos.
    //  O token vai no header Authorization (nunca na URL).
    // ═══════════════════════════════════════════════════════════════
    _queue: Promise.resolve(),
    _minSpacingMs: 400,
    _cooldownUntil: 0,
    _lastCallAt: 0,

    _isRateLimitError(err) {
        if (!err) return false;
        const code = Number(err.code);
        return code === 4 || code === 17 || code === 32 || code === 613
            || (code >= 80000 && code <= 80014) || err.is_transient === true;
    },

    async _apiFetch(pathOrUrl, { token, method = 'GET', body = null } = {}) {
        const run = async () => {
            const bearer = token || this.config.accessToken;
            if (!bearer) throw new Error('Facebook não configurado (sem token)');
            const url = pathOrUrl.startsWith('http')
                ? pathOrUrl
                : `${this.BASE_URL}/${this.API_VERSION}/${pathOrUrl}`;

            let delay = 1000;
            for (let attempt = 0; attempt <= 4; attempt++) {
                const waitUntil = Math.max(this._lastCallAt + this._minSpacingMs, this._cooldownUntil);
                const wait = waitUntil - Date.now();
                if (wait > 0) await new Promise(r => setTimeout(r, wait));
                this._lastCallAt = Date.now();

                const res = await fetch(url, {
                    method,
                    headers: { 'Authorization': `Bearer ${bearer}` },
                    body: body || undefined,
                });
                this._trackUsageHeaders(res);
                const data = await res.json().catch(() => ({}));

                if (data.error) {
                    if (this._isRateLimitError(data.error) && attempt < 4) {
                        const jitter = Math.random() * 500;
                        await new Promise(r => setTimeout(r, delay + jitter));
                        delay *= 2;
                        continue;
                    }
                    this._handleApiError(data.error);
                    const e = new Error(data.error.error_user_msg || data.error.message || 'Erro na API do Facebook');
                    e.fbError = data.error;
                    throw e;
                }
                return data;
            }
            throw new Error('Limite de chamadas do Facebook atingido — aguarde alguns minutos');
        };
        // Fila única: nunca dispara chamadas em paralelo contra a API
        const p = this._queue.then(run, run);
        this._queue = p.catch(() => {});
        return p;
    },

    // Lê os headers de uso da Meta e ajusta ritmo/cooldown antes de sermos bloqueados
    _trackUsageHeaders(res) {
        try {
            const parse = (h) => { try { return JSON.parse(res.headers.get(h) || 'null'); } catch { return null; } };
            let maxPct = 0;
            const app = parse('x-app-usage');
            if (app) maxPct = Math.max(maxPct, app.call_count || 0, app.total_cputime || 0, app.total_time || 0);
            const buc = parse('x-business-use-case-usage');
            if (buc) Object.values(buc).forEach(arr => (arr || []).forEach(u => {
                maxPct = Math.max(maxPct, u.call_count || 0, u.total_cputime || 0, u.total_time || 0);
                if (u.estimated_time_to_regain_access > 0) {
                    this._cooldownUntil = Date.now() + u.estimated_time_to_regain_access * 60 * 1000;
                }
            }));
            if (maxPct >= 90) this._cooldownUntil = Math.max(this._cooldownUntil, Date.now() + 60000);
            this._minSpacingMs = maxPct >= 75 ? 1500 : 400;
        } catch {}
    },

    // ---- API: Listar todas as ad accounts de um perfil (descoberta) ----
    async fetchMyAdAccounts(token) {
        const t = token || this.config.accessToken;
        if (!t) throw new Error('Cole o Access Token primeiro');
        const data = await this._apiFetch(
            `me/adaccounts?fields=id,account_id,name,account_status,currency,timezone_name&limit=200`,
            { token: t }
        );
        // Normaliza: id é "act_xxx", account_id é o numérico que usamos
        return (data.data || []).map(a => ({
            id: a.account_id || String(a.id || '').replace(/^act_/, ''),
            name: a.name || `(sem nome) ${a.account_id || ''}`,
            currency: a.currency || '',
            status: a.account_status,
            timezone: a.timezone_name || ''
        }));
    },

    // ---- API: Buscar campanhas de uma conta (default: ativa) ----
    // Inclui ACTIVE, PAUSED, ARCHIVED, DELETED, IN_PROCESS — pra permitir mapear
    // campanhas que foram desativadas/arquivadas mas que tiveram spend no período.
    // Traz também o spend dos últimos 30d na MESMA chamada (field expansion),
    // sem custo extra de rate limit.
    async fetchCampaigns(accountId) {
        if (!this.isConnected()) throw new Error('Facebook não configurado');
        const acct = accountId || this.config.activeAdAccountId;
        const token = this._tokenForAccount(acct);

        const params = new URLSearchParams({
            fields: 'id,name,status,effective_status,created_time,insights.date_preset(last_30d){spend}',
            filtering: '[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED","ARCHIVED","DELETED","IN_PROCESS","WITH_ISSUES"]}]',
            limit: '500',
        });
        const data = await this._apiFetch(`act_${acct}/campaigns?${params}`, { token });

        return (data.data || []).map(c => ({
            ...c,
            spend30d: parseFloat(c.insights?.data?.[0]?.spend || 0),
        }));
    },

    // ---- Buscar Ad Sets (Conjuntos) de uma campanha ----
    async fetchAdsetsForCampaign(campaignId) {
        if (!this.isConnected()) throw new Error('Facebook não configurado');
        if (!campaignId) return [];
        try {
            const data = await this._apiFetch(
                `${campaignId}/adsets?fields=id,name,status,effective_status,daily_budget,lifetime_budget,billing_event,optimization_goal,targeting&limit=500`
            );
            return data.data || [];
        } catch (e) {
            console.warn('[FB] fetchAdsetsForCampaign failed:', e);
            return [];
        }
    },

    // ---- Buscar Ads (Criativos) de um conjunto ----
    async fetchAdsForAdset(adsetId) {
        if (!this.isConnected()) throw new Error('Facebook não configurado');
        if (!adsetId) return [];
        try {
            const data = await this._apiFetch(
                `${adsetId}/ads?fields=id,name,status,effective_status,creative{id,name,thumbnail_url,object_story_spec,image_url,video_id}&limit=500`
            );
            return data.data || [];
        } catch (e) {
            console.warn('[FB] fetchAdsForAdset failed:', e);
            return [];
        }
    },

    // ---- Account-level totals (link clicks, spend, purchases) for a date range ----
    // Used for "Conversão FB" = compras ÷ cliques no link enviados pelos ads.
    async fetchAccountTotals(dateRange, accountId) {
        if (!this.isConnected()) return null;
        const acct = accountId || this.config.activeAdAccountId;
        const token = this._tokenForAccount(acct);
        const since = dateRange?.since;
        const until = dateRange?.until;
        if (!since || !until) return null;
        const params = new URLSearchParams({
            fields: 'spend,inline_link_clicks,clicks,impressions,actions,action_values',
            level: 'account',
            time_range: JSON.stringify({ since, until }),
            limit: '500',
        });
        const firstUrl = `${this.BASE_URL}/${this.API_VERSION}/act_${acct}/insights?${params}`;
        try {
            let totals = { spend: 0, linkClicks: 0, allClicks: 0, impressions: 0, purchases: 0, purchaseValue: 0 };
            let nextUrl = firstUrl;
            let safety = 0;
            while (nextUrl && safety < 20) {
                let data;
                try { data = await this._apiFetch(nextUrl, { token }); }
                catch { break; }
                (data.data || []).forEach(row => {
                    totals.spend += parseFloat(row.spend || 0);
                    totals.linkClicks += parseInt(row.inline_link_clicks || 0);
                    totals.allClicks += parseInt(row.clicks || 0);
                    totals.impressions += parseInt(row.impressions || 0);
                    (row.actions || []).forEach(a => {
                        if (a.action_type === 'offsite_conversion.fb_pixel_purchase') totals.purchases += parseInt(a.value) || 0;
                    });
                    (row.action_values || []).forEach(a => {
                        if (a.action_type === 'offsite_conversion.fb_pixel_purchase') totals.purchaseValue += parseFloat(a.value) || 0;
                    });
                });
                nextUrl = data.paging?.next || null;
                safety++;
            }
            return totals;
        } catch (e) {
            console.warn('[FB] fetchAccountTotals failed:', e);
            return null;
        }
    },

    // ---- API: Buscar insights de campanhas mapeadas a um produto ----
    async fetchProductInsights(productId, dateRange, accountId) {
        if (!this.isConnected()) throw new Error('Facebook não configurado');
        const acct = accountId || this.config.activeAdAccountId;
        const token = this._tokenForAccount(acct);

        const campaignIds = ((this.campaignMap[acct] || {})[productId]) || [];
        if (!campaignIds || campaignIds.length === 0) {
            throw new Error('Nenhuma campanha mapeada para este produto na conta ativa');
        }

        const since = dateRange?.since || todayISO();
        const until = dateRange?.until || todayISO();

        const params = new URLSearchParams({
            fields: 'impressions,clicks,inline_link_clicks,spend,cpc,cost_per_inline_link_click,actions,action_values',
            level: 'campaign',
            time_range: JSON.stringify({ since, until }),
            filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]),
            limit: '500',
        });
        const firstUrl = `${this.BASE_URL}/${this.API_VERSION}/act_${acct}/insights?${params}`;

        // Pagination: FB retorna 25 por página por padrão
        const allRows = [];
        let nextUrl = firstUrl;
        let safety = 0;
        while (nextUrl && safety < 20) {
            const data = await this._apiFetch(nextUrl, { token });
            if (Array.isArray(data.data)) allRows.push(...data.data);
            nextUrl = data.paging?.next || null;
            safety++;
        }

        return this._aggregateInsights(allRows);
    },

    // ---- Daily breakdown (time_increment=1) ----
    async fetchDailyInsights(productId, dateRange, accountId) {
        if (!this.isConnected()) return [];
        const acct = accountId || this.config.activeAdAccountId;
        const token = this._tokenForAccount(acct);
        const campaignIds = ((this.campaignMap[acct] || {})[productId]) || [];
        if (!campaignIds.length) return [];

        const since = dateRange?.since || todayISO();
        const until = dateRange?.until || todayISO();

        // BUGFIX: FB API retorna 25 dias por padrão. Para 30+ dias precisamos
        // de limit alto E paginação via cursor `paging.next`.
        const params = new URLSearchParams({
            fields: 'date_start,impressions,clicks,inline_link_clicks,spend,cpc,cost_per_inline_link_click,actions,action_values',
            level: 'account',
            time_increment: '1',
            time_range: JSON.stringify({ since, until }),
            filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: campaignIds }]),
            limit: '500',
        });
        const firstUrl = `${this.BASE_URL}/${this.API_VERSION}/act_${acct}/insights?${params}`;

        try {
            // Pagina até cobrir todos os dias do range
            const allRows = [];
            let nextUrl = firstUrl;
            let safety = 0;
            while (nextUrl && safety < 20) {
                let data;
                try { data = await this._apiFetch(nextUrl, { token }); }
                catch (err) { console.warn('[FacebookAds] fetchDailyInsights error:', err); break; }
                if (Array.isArray(data.data)) allRows.push(...data.data);
                nextUrl = data.paging?.next || null;
                safety++;
            }
            return allRows.map(row => {
                let viewContent = 0, addToCart = 0, checkout = 0, purchase = 0, purchaseValue = 0;
                (row.actions || []).forEach(a => {
                    const v = parseInt(a.value) || 0;
                    switch (a.action_type) {
                        case 'offsite_conversion.fb_pixel_view_content': viewContent += v; break;
                        case 'offsite_conversion.fb_pixel_add_to_cart': addToCart += v; break;
                        case 'offsite_conversion.fb_pixel_initiate_checkout': checkout += v; break;
                        case 'offsite_conversion.fb_pixel_purchase': purchase += v; break;
                    }
                });
                (row.action_values || []).forEach(a => {
                    if (a.action_type === 'offsite_conversion.fb_pixel_purchase') purchaseValue += parseFloat(a.value) || 0;
                });
                // Usar inline_link_clicks (cliques no link) que é o que Ads Manager mostra como CPC default
                const allClicks = parseInt(row.clicks) || 0;
                const linkClicks = parseInt(row.inline_link_clicks) || 0;
                return {
                    date: row.date_start,
                    impressions: parseInt(row.impressions) || 0,
                    // "clicks" = link clicks (alinha com FB Ads Manager)
                    clicks: linkClicks > 0 ? linkClicks : allClicks,
                    allClicks,
                    linkClicks,
                    spend: parseFloat(row.spend) || 0,
                    cpc: parseFloat(row.cost_per_inline_link_click || row.cpc) || 0,
                    viewContent,
                    addToCart,
                    checkout,
                    purchase,
                    purchaseValue,
                };
            }).sort((a, b) => a.date.localeCompare(b.date));
        } catch { return []; }
    },

    // ---- Agregar dados de múltiplas campanhas ----
    _aggregateInsights(rows) {
        const totals = {
            impressions: 0,
            clicks: 0,        // = linkClicks (alinhado com FB Ads Manager)
            allClicks: 0,     // todos os cliques (não usado pra CPC mas guardado)
            linkClicks: 0,
            spend: 0,
            viewContent: 0,
            addToCart: 0,
            checkout: 0,
            purchase: 0,
            purchaseValue: 0
        };

        rows.forEach(row => {
            totals.impressions += parseInt(row.impressions) || 0;
            const allC = parseInt(row.clicks) || 0;
            const linkC = parseInt(row.inline_link_clicks) || 0;
            totals.allClicks += allC;
            totals.linkClicks += linkC;
            // "clicks" canonical = link clicks (cai pra all clicks se link não disponível)
            totals.clicks += linkC > 0 ? linkC : allC;
            totals.spend += parseFloat(row.spend) || 0;

            // Extrair actions (funnel events)
            (row.actions || []).forEach(a => {
                const v = parseInt(a.value) || 0;
                switch (a.action_type) {
                    case 'offsite_conversion.fb_pixel_view_content':
                        totals.viewContent += v;
                        break;
                    case 'offsite_conversion.fb_pixel_add_to_cart':
                        totals.addToCart += v;
                        break;
                    case 'offsite_conversion.fb_pixel_initiate_checkout':
                        totals.checkout += v;
                        break;
                    case 'offsite_conversion.fb_pixel_purchase':
                        totals.purchase += v;
                        break;
                }
            });

            // Extrair action_values para receita
            (row.action_values || []).forEach(a => {
                if (a.action_type === 'offsite_conversion.fb_pixel_purchase') {
                    totals.purchaseValue += parseFloat(a.value) || 0;
                }
            });
        });

        // Calcular taxas (média ponderada via soma)
        const ctr = totals.impressions > 0
            ? (totals.clicks / totals.impressions) * 100 : 0;
        const viewPageRate = totals.clicks > 0
            ? (totals.viewContent / totals.clicks) * 100 : 0;
        const atcRate = totals.viewContent > 0
            ? (totals.addToCart / totals.viewContent) * 100 : 0;
        const checkoutRate = totals.addToCart > 0
            ? (totals.checkout / totals.addToCart) * 100 : 0;
        const saleRate = totals.checkout > 0
            ? (totals.purchase / totals.checkout) * 100 : 0;

        return {
            ...totals,
            ctr,
            viewPageRate,
            atcRate,
            checkoutRate,
            saleRate
        };
    },

    // ---- Error Handling ----
    _handleApiError(error) {
        const code = Number(error.code);
        if (code === 190) {
            // Token expirado ou inválido
            showToast('Token do Facebook expirado. Gere um novo token no perfil correspondente.', 'error');
            this._updateStatusBadge();
        } else if (code === 100) {
            showToast('ID da conta de anúncio inválido. Verifique a configuração.', 'error');
        } else if (code === 10 || code === 200 || code === 294) {
            showToast('Token sem permissão ads_read. Gere o token com as permissões ads_read e read_insights.', 'error');
        } else if (this._isRateLimitError(error)) {
            showToast('Facebook limitou as chamadas temporariamente. O app vai reduzir o ritmo — aguarde alguns minutos.', 'warning');
        } else if (code === 368) {
            showToast('O Facebook bloqueou temporariamente esta ação por política. Verifique a conta no Business Manager.', 'error');
        } else {
            console.error('Facebook API Error:', error);
        }
    },

    // ═══════════════════════════════════════════════════════════════
    //  Sincronização automática — puxa os últimos dias de todas as
    //  contas/produtos mapeados direto pro Diário, sem clique manual.
    //  Reimporta 3 dias pra capturar ajustes de atribuição do FB.
    // ═══════════════════════════════════════════════════════════════
    autoSync: {
        get enabled() { return localStorage.getItem('fb_auto_sync') === '1'; },
        set enabled(v) { localStorage.setItem('fb_auto_sync', v ? '1' : '0'); },
        get intervalHours() { return parseInt(localStorage.getItem('fb_auto_sync_hours') || '6', 10); },
        set intervalHours(v) { localStorage.setItem('fb_auto_sync_hours', String(v)); },
        get lastRun() { return parseInt(localStorage.getItem('fb_last_auto_sync') || '0', 10); },
        set lastRun(v) { localStorage.setItem('fb_last_auto_sync', String(v)); },
    },
    _autoSyncRunning: false,

    initAutoSync() {
        // Primeira checagem 20s após carregar (deixa o app terminar de subir),
        // depois checa a cada 15 min se o intervalo venceu
        setTimeout(() => this.maybeAutoSync(), 20000);
        setInterval(() => this.maybeAutoSync(), 15 * 60 * 1000);
    },

    async maybeAutoSync() {
        if (!this.autoSync.enabled || !this.isConnected()) return;
        const due = this.autoSync.lastRun + this.autoSync.intervalHours * 3600 * 1000;
        if (Date.now() < due) return;
        await this.runAutoSync();
    },

    async runAutoSync({ manual = false } = {}) {
        if (this._autoSyncRunning) { if (manual) showToast('Sincronização já em andamento…', 'info'); return; }
        if (!this.isConnected()) { if (manual) showToast('Configure o Facebook primeiro', 'error'); return; }
        this._autoSyncRunning = true;
        this._updateAutoSyncStatus('Sincronizando…');
        try {
            const d = new Date(); d.setDate(d.getDate() - 2);
            const range = { since: d.toISOString().split('T')[0], until: todayISO() };
            let okCount = 0, failCount = 0;

            for (const acct of (this.config.adAccounts || [])) {
                const map = this.campaignMap[acct.id] || {};
                const productIds = Object.keys(map).filter(pid => (map[pid] || []).length > 0);
                for (const pid of productIds) {
                    try {
                        const storeId = typeof getWritableStoreId === 'function' ? getWritableStoreId(pid) : null;
                        if (!storeId) continue;
                        const daily = await this.fetchDailyInsights(pid, range, acct.id);
                        if (!daily.length) continue;
                        if (typeof FunnelModule === 'undefined' || !FunnelModule._saveDailyToDiaryForProduct) continue;
                        // Grava no contexto da conta (moeda correta) sem persistir a troca
                        const prevActive = this.config.activeAdAccountId;
                        this.config.activeAdAccountId = acct.id;
                        try { await FunnelModule._saveDailyToDiaryForProduct(pid, daily, storeId); }
                        finally { this.config.activeAdAccountId = prevActive; }
                        okCount++;
                    } catch (e) {
                        failCount++;
                        console.warn('[FB AutoSync]', acct.id, pid, e);
                    }
                }
            }

            this.autoSync.lastRun = Date.now();
            this._updateAutoSyncStatus();
            if (manual || okCount > 0 || failCount > 0) {
                showToast(
                    `Facebook sincronizado: ${okCount} produto(s)${failCount ? ` · ${failCount} erro(s)` : ''}`,
                    failCount ? 'warning' : 'success'
                );
            }
        } finally {
            this._autoSyncRunning = false;
            this._updateAutoSyncStatus();
        }
    },

    _updateAutoSyncStatus(override) {
        const el = document.getElementById('fb-auto-sync-last');
        if (!el) return;
        if (override) { el.textContent = override; return; }
        const last = this.autoSync.lastRun;
        el.textContent = last
            ? `Última sync: ${new Date(last).toLocaleString('pt-BR')}`
            : 'Nunca sincronizado';
    },

    // ---- UI: Campaign Mapper ----
    openCampaignMapper(productId) {
        this._campaignFiltersWired = false; // reset so listeners re-attach on reopen
        if (!this.isConnected()) {
            showToast('Configure o Facebook Ads primeiro', 'error');
            return;
        }
        if (!productId) {
            showToast('Selecione um produto primeiro', 'error');
            return;
        }

        // Estado da sessão do modal — suporte multi-conta
        const accounts = this.config.adAccounts || [];
        const firstAccountId = this.config.activeAdAccountId || (accounts[0]?.id || '');
        const selectedByAccount = {};
        accounts.forEach(a => {
            const existing = (this.campaignMap[a.id] || {})[productId] || [];
            selectedByAccount[a.id] = new Set(existing);
        });

        this._mapperState = {
            productId,
            accountId: firstAccountId,         // aba/conta ativa no modal
            selectedByAccount,                  // Set<campaignId> por conta
            campaigns: [],                      // campanhas da conta ativa
        };

        // Popula seletores de conta/produto no toolbar
        this._renderMapperContextSelectors();
        this._updateMapperTitle();

        // Carrega campanhas da conta ativa
        this._loadCampaignsForMapper();

        // Save: persiste seleções de TODAS as contas
        document.getElementById('fb-campaigns-save').onclick = () => {
            const st = this._mapperState;
            if (!st) return;
            let totalMapped = 0;
            let accountsWithSel = 0;
            for (const [acctId, selSet] of Object.entries(st.selectedByAccount)) {
                if (!this.campaignMap[acctId]) this.campaignMap[acctId] = {};
                this.campaignMap[acctId][st.productId] = Array.from(selSet);
                if (selSet.size > 0) { totalMapped += selSet.size; accountsWithSel++; }
            }
            this.saveCampaignMap();
            const prodName = getProductName(st.productId) || st.productId;
            const acctLabel = accountsWithSel > 1 ? `${accountsWithSel} contas` : ((this.config.adAccounts.find(a => a.id === st.accountId)?.name) || st.accountId);
            closeModal('fb-campaigns-modal');
            showToast(`${totalMapped} campanha(s) mapeada(s) · ${prodName} · ${acctLabel}`, 'success');
        };
    },

    _loadCampaignsForMapper() {
        const st = this._mapperState;
        if (!st) return;
        document.getElementById('fb-campaigns-loading').style.display = 'block';
        document.getElementById('fb-campaigns-list').innerHTML = '';
        openModal('fb-campaigns-modal');

        this.fetchCampaigns(st.accountId).then(campaigns => {
            document.getElementById('fb-campaigns-loading').style.display = 'none';
            const listEl = document.getElementById('fb-campaigns-list');
            if (!campaigns.length) {
                listEl.innerHTML = '<p style="padding:1rem;text-align:center;color:var(--text-muted)">Nenhuma campanha encontrada nesta conta.</p>';
                return;
            }
            // Ordena por gasto recente (30d) — campanhas relevantes primeiro
            st.campaigns = campaigns.sort((a, b) =>
                (b.spend30d || 0) - (a.spend30d || 0) || (b.created_time || '').localeCompare(a.created_time || ''));
            // Garante Set existe para esta conta
            if (!st.selectedByAccount[st.accountId]) {
                st.selectedByAccount[st.accountId] = new Set();
            }
            this._renderCampaignList();
            this._wireCampaignFilters();
        }).catch(err => {
            document.getElementById('fb-campaigns-loading').style.display = 'none';
            document.getElementById('fb-campaigns-list').innerHTML =
                `<p class="text-error">Erro: ${err.message}</p>`;
        });
    },

    _updateMapperTitle() {
        const st = this._mapperState;
        const titleEl = document.getElementById('fb-campaigns-title');
        if (!titleEl || !st) return;
        const prodName = getProductName(st.productId) || st.productId;
        const acctName = (this.config.adAccounts.find(a => a.id === st.accountId)?.name) || st.accountId;
        titleEl.innerHTML = `Mapear Campanhas <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> ${this._esc(prodName)} <span style="color:var(--text-muted);font-size:0.85rem;font-weight:500"> · ${this._esc(acctName)}</span>`;
        if (typeof lucide !== 'undefined' && lucide.createIcons) { try { lucide.createIcons(); } catch {} }
    },

    _renderMapperContextSelectors() {
        const st = this._mapperState;
        const acctContainer = document.getElementById('fb-mapper-account');
        const prodSel = document.getElementById('fb-mapper-product');
        if (!acctContainer || !prodSel || !st) return;

        // Conta — substituir <select> por tabs de conta (multi-conta)
        const accounts = this.config.adAccounts || [];
        const tabsHtml = accounts.map(a => {
            const selSet = st.selectedByAccount[a.id] || new Set();
            const hasSel = selSet.size > 0;
            const isActive = a.id === st.accountId;
            return `<button type="button"
                class="fb-mapper-acct-tab ${isActive ? 'active' : ''} ${hasSel ? 'has-sel' : ''}"
                data-acct-tab="${this._esc(a.id)}"
                title="${this._esc(a.name)}">
                ${this._esc(a.name)}
                <span class="acct-sel-count">${selSet.size}</span>
            </button>`;
        }).join('');

        // Replace the select with tabs div (keep same #fb-mapper-account id on wrapper)
        const wrapper = acctContainer.closest('.fb-mapper-ctx-field') || acctContainer.parentElement;
        wrapper.innerHTML = `<label>Contas</label><div class="fb-mapper-acct-tabs">${tabsHtml}</div>`;

        // Re-wire tab clicks (delegation on wrapper)
        wrapper.addEventListener('click', (e) => {
            const tab = e.target.closest('[data-acct-tab]');
            if (!tab || !this._mapperState) return;
            this._mapperState.accountId = tab.dataset.acctTab;
            this._updateMapperTitle();
            this._loadCampaignsForMapper();
            // Update active state
            wrapper.querySelectorAll('.fb-mapper-acct-tab').forEach(t =>
                t.classList.toggle('active', t.dataset.acctTab === this._mapperState.accountId));
        });

        // Produto
        const products = (typeof AppState !== 'undefined' && AppState.products) ? AppState.products : [];
        prodSel.innerHTML = products.map(p =>
            `<option value="${this._esc(p.id)}" ${p.id === st.productId ? 'selected' : ''}>${this._esc(p.name)}</option>`
        ).join('');
        prodSel.onchange = () => {
            const newProductId = prodSel.value;
            st.productId = newProductId;
            // Rebuild selectedByAccount for new product
            accounts.forEach(a => {
                const existing = (this.campaignMap[a.id] || {})[newProductId] || [];
                st.selectedByAccount[a.id] = new Set(existing);
            });
            this._updateMapperTitle();
            this._renderCampaignList();
        };
    },

    // Atualiza badges de contagem nos tabs de conta
    _refreshAccountTabBadges() {
        const st = this._mapperState;
        if (!st) return;
        document.querySelectorAll('[data-acct-tab]').forEach(tab => {
            const acctId = tab.dataset.acctTab;
            const selSet = st.selectedByAccount[acctId] || new Set();
            tab.classList.toggle('has-sel', selSet.size > 0);
            const badge = tab.querySelector('.acct-sel-count');
            if (badge) badge.textContent = selSet.size;
        });
    },

    // Para uma campanha, retorna em quais OUTROS produtos da conta ativa ela está mapeada
    _campaignMappedToOthers(campaignId) {
        const st = this._mapperState;
        if (!st) return [];
        // Check saved map (persistent) for current account
        const map = this.campaignMap[st.accountId] || {};
        const others = [];
        for (const [pid, ids] of Object.entries(map)) {
            if (pid === st.productId) continue;
            if (Array.isArray(ids) && ids.includes(campaignId)) others.push(pid);
        }
        return others;
    },

    // ---- UI: Render lista de campanhas com busca/filtros ----
    _renderCampaignList() {
        const listEl = document.getElementById('fb-campaigns-list');
        const st = this._mapperState;
        if (!listEl || !st) return;
        const q = (document.getElementById('fb-campaigns-search')?.value || '').trim().toLowerCase();
        const showActive = !!document.getElementById('fb-campaigns-filter-active')?.checked;
        const showPaused = !!document.getElementById('fb-campaigns-filter-paused')?.checked;
        const showArchived = document.getElementById('fb-campaigns-filter-archived')?.checked !== false;
        const onlyMapped = !!document.getElementById('fb-campaigns-filter-mapped')?.checked;
        // Use per-account selection set
        if (!st.selectedByAccount[st.accountId]) st.selectedByAccount[st.accountId] = new Set();
        const selected = st.selectedByAccount[st.accountId];

        const filtered = (st.campaigns || []).filter(c => {
            const status = (c.effective_status || '').toUpperCase();
            const isActive = status === 'ACTIVE';
            const isPaused = status === 'PAUSED';
            const isArchived = !isActive && !isPaused;
            if (isActive && !showActive) return false;
            if (isPaused && !showPaused) return false;
            if (isArchived && !showArchived) return false;
            if (onlyMapped && !selected.has(c.id)) return false;
            if (q) {
                const hay = `${c.name || ''} ${status} ${c.id || ''}`.toLowerCase();
                const terms = q.split(/\s+/).filter(Boolean);
                if (!terms.every(t => hay.includes(t))) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            listEl.innerHTML = '<p style="padding:1.5rem;text-align:center;color:var(--text-muted)">Nenhuma campanha bate com o filtro.</p>';
        } else {
            const acctCurrency = (this.config.adAccounts.find(a => a.id === st.accountId)?.currency) || '';
            listEl.innerHTML = filtered.map(c => {
                const checked = selected.has(c.id) ? 'checked' : '';
                const status = (c.effective_status || '').toUpperCase();
                const others = this._campaignMappedToOthers(c.id);
                const otherBadge = others.length > 0
                    ? `<span class="fb-campaign-other" title="Já mapeada em ${others.map(p => getProductName(p) || p).join(', ')}"><i data-lucide="link-2" style="width:11px;height:11px;vertical-align:-1px"></i> ${others.length === 1 ? this._esc(getProductName(others[0]) || others[0]) : others.length + ' produtos'}</span>`
                    : '';
                const spendBadge = (c.spend30d || 0) > 0
                    ? `<span class="fb-campaign-spend" title="Gasto nos últimos 30 dias">${this._esc(acctCurrency)} ${c.spend30d.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} · 30d</span>`
                    : '<span class="fb-campaign-spend fb-campaign-spend-zero" title="Sem gasto nos últimos 30 dias">sem gasto 30d</span>';
                const amsUrl = `https://www.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(st.accountId)}&selected_campaign_ids=${encodeURIComponent(c.id)}`;
                return `<label class="fb-campaign-item">
                    <input type="checkbox" value="${this._esc(c.id)}" ${checked}>
                    <span class="fb-campaign-name">${this._highlightMatch(c.name || '', q)}</span>
                    ${otherBadge}
                    ${spendBadge}
                    <a class="fb-campaign-link" href="${amsUrl}" target="_blank" rel="noopener" title="Abrir no Ads Manager" onclick="event.stopPropagation()"><i data-lucide="external-link" style="width:12px;height:12px"></i></a>
                    <span class="fb-campaign-status status-fb-${status.toLowerCase()}">${this._esc(status)}</span>
                </label>`;
            }).join('');
        }

        // Atualiza contagem
        const countEl = document.getElementById('fb-campaigns-count');
        if (countEl) {
            const total = (st.campaigns || []).length;
            countEl.textContent = `${filtered.length}/${total}${selected.size > 0 ? ` · ${selected.size} marcadas` : ''}`;
        }

        const clearBtn = document.getElementById('fb-campaigns-search-clear');
        if (clearBtn) clearBtn.style.display = q ? '' : 'none';

        if (typeof lucide !== 'undefined' && lucide.createIcons) {
            try { lucide.createIcons(); } catch {}
        }
    },

    _wireCampaignFilters() {
        // Reset flag each time modal opens so event listeners are re-attached
        if (this._campaignFiltersWired) return;
        this._campaignFiltersWired = true;
        const search = document.getElementById('fb-campaigns-search');
        const clear = document.getElementById('fb-campaigns-search-clear');
        const activeChk = document.getElementById('fb-campaigns-filter-active');
        const pausedChk = document.getElementById('fb-campaigns-filter-paused');
        const archivedChk = document.getElementById('fb-campaigns-filter-archived');
        const mappedChk = document.getElementById('fb-campaigns-filter-mapped');

        let timer = null;
        const debouncedRender = () => {
            clearTimeout(timer);
            timer = setTimeout(() => this._renderCampaignList(), 80);
        };

        search?.addEventListener('input', debouncedRender);
        search?.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); search.value = ''; this._renderCampaignList(); }
        });
        clear?.addEventListener('click', (e) => { e.preventDefault(); search.value = ''; search.focus(); this._renderCampaignList(); });
        [activeChk, pausedChk, archivedChk, mappedChk].forEach(el => el?.addEventListener('change', () => this._renderCampaignList()));

        // Marcar/desmarcar todas as campanhas VISÍVEIS (respeitando busca/filtros)
        const setAllVisible = (checked) => {
            const st = this._mapperState;
            if (!st) return;
            if (!st.selectedByAccount[st.accountId]) st.selectedByAccount[st.accountId] = new Set();
            const sel = st.selectedByAccount[st.accountId];
            document.querySelectorAll('#fb-campaigns-list input[type="checkbox"]').forEach(cb => {
                cb.checked = checked;
                if (checked) sel.add(cb.value); else sel.delete(cb.value);
            });
            this._refreshAccountTabBadges();
            this._renderCampaignList();
        };
        document.getElementById('fb-campaigns-select-all')?.addEventListener('click', (e) => { e.preventDefault(); setAllVisible(true); });
        document.getElementById('fb-campaigns-select-none')?.addEventListener('click', (e) => { e.preventDefault(); setAllVisible(false); });

        // Captura toggle de checkbox e atualiza Set ao vivo (por conta)
        const listEl = document.getElementById('fb-campaigns-list');
        listEl?.addEventListener('change', (e) => {
            const cb = e.target;
            if (!cb?.matches('input[type="checkbox"]')) return;
            const st = this._mapperState;
            if (!st) return;
            if (!st.selectedByAccount[st.accountId]) st.selectedByAccount[st.accountId] = new Set();
            const sel = st.selectedByAccount[st.accountId];
            if (cb.checked) sel.add(cb.value); else sel.delete(cb.value);
            this._refreshAccountTabBadges();
            // Atualiza contagem
            if (mappedChk?.checked && !cb.checked) {
                this._renderCampaignList();
            } else {
                const countEl = document.getElementById('fb-campaigns-count');
                const total = (st.campaigns || []).length;
                const visible = listEl.querySelectorAll('.fb-campaign-item').length;
                if (countEl) countEl.textContent = `${visible}/${total}${sel.size > 0 ? ` · ${sel.size} marcadas` : ''}`;
            }
        });
    },

    _highlightMatch(text, q) {
        if (!q) return this._esc(text);
        const terms = q.split(/\s+/).filter(Boolean);
        let out = this._esc(text);
        terms.forEach(t => {
            const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
            out = out.replace(re, '<mark class="fb-search-hi">$1</mark>');
        });
        return out;
    },

    // ---- UI: Conta ativa selector ----
    _renderActiveAccountSelector() {
        const wrap = document.getElementById('fb-active-account-wrap');
        if (!wrap) return;
        const accounts = this.config.adAccounts || [];
        if (accounts.length === 0) {
            wrap.style.display = 'none';
            return;
        }
        wrap.style.display = '';
        const sel = document.getElementById('fb-active-account');
        if (!sel) return;
        const current = this.config.activeAdAccountId;
        sel.innerHTML = accounts.map(a =>
            `<option value="${a.id}" ${a.id === current ? 'selected' : ''}>${this._esc(a.name)} (${a.id})</option>`
        ).join('');
        sel.onchange = () => {
            this.config.activeAdAccountId = sel.value;
            this.saveConfig();
            this._updateStatusBadge();
            showToast(`Conta ativa: ${this.activeAccount()?.name || sel.value}`, 'success');
        };
    },

    _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
};
