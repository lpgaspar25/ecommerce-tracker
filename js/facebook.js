/* ===========================
   Facebook.js — Facebook Ads API Integration
   Fetches campaign insights and maps to products
   =========================== */

const FacebookAds = {
    API_VERSION: 'v22.0',
    BASE_URL: 'https://graph.facebook.com',

    // Config persistida em localStorage
    // adAccounts: [{ id, name }]   — várias contas do mesmo perfil FB
    // activeAdAccountId: id da conta selecionada como "ativa"
    config: (() => {
        const accessToken = localStorage.getItem('fb_access_token') || '';
        let adAccounts = [];
        try { adAccounts = JSON.parse(localStorage.getItem('fb_ad_accounts') || '[]') || []; } catch { adAccounts = []; }
        let activeAdAccountId = localStorage.getItem('fb_active_ad_account_id') || '';

        // Migração do formato antigo (1 ad account)
        const legacyId = localStorage.getItem('fb_ad_account_id') || '';
        if (legacyId && adAccounts.length === 0) {
            adAccounts = [{ id: legacyId, name: 'Conta principal' }];
            activeAdAccountId = legacyId;
            localStorage.setItem('fb_ad_accounts', JSON.stringify(adAccounts));
            localStorage.setItem('fb_active_ad_account_id', activeAdAccountId);
        }
        if (!activeAdAccountId && adAccounts.length > 0) activeAdAccountId = adAccounts[0].id;

        return { accessToken, adAccounts, activeAdAccountId };
    })(),

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
        return !!(this.config.accessToken && this.config.adAccounts.length > 0 && this.config.activeAdAccountId);
    },

    activeAccount() {
        return (this.config.adAccounts || []).find(a => a.id === this.config.activeAdAccountId) || null;
    },

    // Conveniência: ID da conta ativa (compatibilidade com chamadas antigas)
    get activeAdAccountId() { return this.config.activeAdAccountId; },

    // ---- Persistência ----
    saveConfig() {
        localStorage.setItem('fb_access_token', this.config.accessToken);
        localStorage.setItem('fb_ad_accounts', JSON.stringify(this.config.adAccounts || []));
        localStorage.setItem('fb_active_ad_account_id', this.config.activeAdAccountId || '');
        // Mantém compatibilidade com leitura antiga
        localStorage.setItem('fb_ad_account_id', this.config.activeAdAccountId || '');

        // Salvar no Sheets Config tab se conectado
        if (AppState.sheetsConnected) {
            SheetsAPI.saveConfig('fb_ad_accounts', JSON.stringify(this.config.adAccounts || []));
            SheetsAPI.saveConfig('fb_active_ad_account_id', this.config.activeAdAccountId || '');
            // Token não vai pro Sheets por segurança
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
                this.config.accessToken = document.getElementById('fb-access-token').value.trim();

                // Lê seleção de contas no modal (checkboxes preenchidos via _populateAccountList)
                const checks = [...document.querySelectorAll('#fb-account-list input[type="checkbox"]:checked')];
                if (checks.length > 0) {
                    this.config.adAccounts = checks.map(c => ({
                        id: c.value,
                        name: c.dataset.name || c.value
                    }));
                    if (!this.config.adAccounts.some(a => a.id === this.config.activeAdAccountId)) {
                        this.config.activeAdAccountId = this.config.adAccounts[0].id;
                    }
                } else {
                    // Fallback: pega do input "manual" (ID único, modo legado)
                    const manual = document.getElementById('fb-ad-account-id')?.value.trim().replace(/^act_/, '');
                    if (manual) {
                        const existing = this.config.adAccounts.find(a => a.id === manual);
                        if (!existing) this.config.adAccounts = [{ id: manual, name: 'Conta principal' }];
                        this.config.activeAdAccountId = manual;
                    }
                }

                if (!this.config.adAccounts.length) {
                    showToast('Adicione pelo menos uma conta de anúncio', 'error');
                    return;
                }

                this.saveConfig();
                this._updateStatusBadge();
                this._renderActiveAccountSelector();
                closeModal('fb-config-modal');
                showToast(`Facebook conectado · ${this.config.adAccounts.length} conta(s)`, 'success');
            });
        }

        // Botão: Buscar minhas contas no FB (descoberta via API)
        const btnDiscover = document.getElementById('fb-discover-accounts');
        if (btnDiscover) {
            btnDiscover.addEventListener('click', async () => {
                const tokenInput = document.getElementById('fb-access-token');
                const token = tokenInput?.value.trim();
                if (!token) { showToast('Cole o Access Token primeiro', 'error'); return; }
                this.config.accessToken = token;
                btnDiscover.disabled = true;
                btnDiscover.textContent = 'Buscando…';
                try {
                    const accounts = await this.fetchMyAdAccounts();
                    this._populateAccountList(accounts);
                    showToast(`${accounts.length} conta(s) encontrada(s)`, 'success');
                } catch (err) {
                    showToast('Falha: ' + err.message, 'error');
                } finally {
                    btnDiscover.disabled = false;
                    btnDiscover.textContent = 'Buscar minhas contas';
                }
            });
        }

        // Botão: Configurar Facebook
        const btnConfig = document.getElementById('btn-fb-config');
        if (btnConfig) {
            btnConfig.addEventListener('click', () => {
                document.getElementById('fb-access-token').value = this.config.accessToken;
                const manual = document.getElementById('fb-ad-account-id');
                if (manual) manual.value = this.config.activeAdAccountId || '';
                // Re-popula lista com o que já temos salvo (todas marcadas)
                if ((this.config.adAccounts || []).length > 0) {
                    this._populateAccountList(this.config.adAccounts, /*allChecked*/ true);
                } else {
                    const list = document.getElementById('fb-account-list');
                    if (list) list.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);padding:0.5rem">Cole o token e clique em "Buscar minhas contas" para listar suas contas de anúncio.</p>';
                }
                openModal('fb-config-modal');
            });
        }

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

        // Update status on load
        this._updateStatusBadge();
        this._renderActiveAccountSelector();
    },

    _updateStatusBadge() {
        const badge = document.getElementById('fb-status');
        if (!badge) return;
        if (this.isConnected()) {
            const n = this.config.adAccounts.length;
            const active = this.activeAccount();
            badge.textContent = n === 1
                ? `FB · ${active?.name || 'conectado'}`
                : `FB · ${n} contas`;
            badge.className = 'status-badge status-connected';
            badge.title = active ? `Conta ativa: ${active.name} (${active.id})` : '';
        } else {
            badge.textContent = 'FB Desconectado';
            badge.className = 'status-badge status-disconnected';
            badge.title = '';
        }
    },

    _populateAccountList(accounts, allChecked = false) {
        const list = document.getElementById('fb-account-list');
        if (!list) return;
        if (!accounts || accounts.length === 0) {
            list.innerHTML = '<p style="font-size:0.8rem;color:var(--text-muted);padding:0.5rem">Nenhuma conta retornada.</p>';
            return;
        }
        const tracked = new Set((this.config.adAccounts || []).map(a => a.id));
        list.innerHTML = accounts.map(a => {
            const checked = allChecked || tracked.has(a.id) ? 'checked' : '';
            const meta = [a.currency, a.timezone].filter(Boolean).join(' · ');
            return `<label class="fb-account-item">
                <input type="checkbox" value="${this._esc(a.id)}" data-name="${this._esc(a.name)}" ${checked}>
                <span class="fb-account-name">${this._esc(a.name)}</span>
                <span class="fb-account-meta">${this._esc(a.id)}${meta ? ' · ' + this._esc(meta) : ''}</span>
            </label>`;
        }).join('');
    },

    // ---- API: Listar todas as ad accounts do perfil (descoberta) ----
    async fetchMyAdAccounts() {
        if (!this.config.accessToken) throw new Error('Cole o Access Token primeiro');
        const url = `${this.BASE_URL}/${this.API_VERSION}/me/adaccounts`
            + `?access_token=${this.config.accessToken}`
            + `&fields=id,account_id,name,account_status,currency,timezone_name`
            + `&limit=200`;

        const res = await fetch(url);
        const data = await res.json();
        if (data.error) {
            this._handleApiError(data.error);
            throw new Error(data.error.message);
        }
        // Normaliza: id é "act_xxx", account_id é o numérico que usamos
        return (data.data || []).map(a => ({
            id: a.account_id || String(a.id || '').replace(/^act_/, ''),
            name: a.name || `(sem nome) ${a.account_id || ''}`,
            currency: a.currency || '',
            status: a.account_status,
            timezone: a.timezone_name || ''
        }));
    },

    // ---- API: Buscar campanhas da conta ativa ----
    async fetchCampaigns() {
        if (!this.isConnected()) throw new Error('Facebook não configurado');
        const accountId = this.config.activeAdAccountId;

        const url = `${this.BASE_URL}/${this.API_VERSION}/act_${accountId}/campaigns`
            + `?access_token=${this.config.accessToken}`
            + `&fields=id,name,status,effective_status`
            + `&filtering=${encodeURIComponent('[{"field":"effective_status","operator":"IN","value":["ACTIVE","PAUSED"]}]')}`
            + `&limit=200`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.error) {
            this._handleApiError(data.error);
            throw new Error(data.error.message);
        }

        return data.data || [];
    },

    // ---- API: Buscar insights de campanhas mapeadas a um produto (na conta ativa) ----
    async fetchProductInsights(productId, dateRange) {
        if (!this.isConnected()) throw new Error('Facebook não configurado');
        const accountId = this.config.activeAdAccountId;

        const campaignIds = (this._accountMap()[productId]) || [];
        if (!campaignIds || campaignIds.length === 0) {
            throw new Error('Nenhuma campanha mapeada para este produto na conta ativa');
        }

        const since = dateRange?.since || todayISO();
        const until = dateRange?.until || todayISO();

        const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
        const filtering = encodeURIComponent(JSON.stringify([
            { field: 'campaign.id', operator: 'IN', value: campaignIds }
        ]));

        const url = `${this.BASE_URL}/${this.API_VERSION}/act_${accountId}/insights`
            + `?access_token=${this.config.accessToken}`
            + `&fields=impressions,clicks,spend,actions,action_values`
            + `&level=campaign`
            + `&time_range=${timeRange}`
            + `&filtering=${filtering}`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.error) {
            this._handleApiError(data.error);
            throw new Error(data.error.message);
        }

        return this._aggregateInsights(data.data || []);
    },

    // ---- Agregar dados de múltiplas campanhas ----
    _aggregateInsights(rows) {
        const totals = {
            impressions: 0,
            clicks: 0,
            spend: 0,
            viewContent: 0,
            addToCart: 0,
            checkout: 0,
            purchase: 0,
            purchaseValue: 0
        };

        rows.forEach(row => {
            totals.impressions += parseInt(row.impressions) || 0;
            totals.clicks += parseInt(row.clicks) || 0;
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
        if (error.code === 190) {
            // Token expirado ou inválido
            showToast('Token do Facebook expirado. Gere um novo token.', 'error');
            this._updateStatusBadge();
        } else if (error.code === 100) {
            showToast('ID da conta de anúncio inválido. Verifique a configuração.', 'error');
        } else {
            console.error('Facebook API Error:', error);
        }
    },

    // ---- UI: Campaign Mapper ----
    openCampaignMapper(productId) {
        if (!this.isConnected()) {
            showToast('Configure o Facebook Ads primeiro', 'error');
            return;
        }
        if (!productId) {
            showToast('Selecione um produto primeiro', 'error');
            return;
        }

        document.getElementById('fb-campaigns-title').innerHTML =
            `Mapear Campanhas <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> ${getProductName(productId)}`;
        document.getElementById('fb-campaigns-loading').style.display = 'block';
        document.getElementById('fb-campaigns-list').innerHTML = '';
        openModal('fb-campaigns-modal');

        this.fetchCampaigns().then(campaigns => {
            document.getElementById('fb-campaigns-loading').style.display = 'none';
            const mapped = (this._accountMap()[productId]) || [];
            const listEl = document.getElementById('fb-campaigns-list');

            if (campaigns.length === 0) {
                listEl.innerHTML = '<p style="padding:1rem;text-align:center;color:var(--text-muted)">Nenhuma campanha encontrada nesta conta.</p>';
                return;
            }

            listEl.innerHTML = campaigns.map(c => `
                <label class="fb-campaign-item">
                    <input type="checkbox" value="${c.id}" ${mapped.includes(c.id) ? 'checked' : ''}>
                    <span class="fb-campaign-name">${c.name}</span>
                    <span class="fb-campaign-status status-fb-${c.effective_status.toLowerCase()}">${c.effective_status}</span>
                </label>
            `).join('');
        }).catch(err => {
            document.getElementById('fb-campaigns-loading').style.display = 'none';
            document.getElementById('fb-campaigns-list').innerHTML =
                `<p class="text-error">Erro: ${err.message}</p>`;
        });

        // Save handler
        document.getElementById('fb-campaigns-save').onclick = () => {
            const checked = [...document.querySelectorAll('#fb-campaigns-list input:checked')]
                .map(el => el.value);
            const acctMap = this._accountMap();
            acctMap[productId] = checked;
            this.saveCampaignMap();
            const acctName = this.activeAccount()?.name || this.config.activeAdAccountId;
            closeModal('fb-campaigns-modal');
            showToast(`${checked.length} campanha(s) mapeada(s) em ${acctName}`, 'success');
        };
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
