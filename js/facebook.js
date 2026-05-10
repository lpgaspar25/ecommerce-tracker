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
                this._addManualAccountToList({ id, name });
                if (idInput) idInput.value = '';
                if (nameInput) nameInput.value = '';
                idInput?.focus();
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

    // Adiciona uma conta manualmente à lista do modal (sem persistir até "Conectar")
    _addManualAccountToList({ id, name }) {
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
        const html = `<label class="fb-account-item">
            <input type="checkbox" value="${this._esc(id)}" data-name="${this._esc(name)}" checked>
            <span class="fb-account-name">${this._esc(name)}</span>
            <span class="fb-account-meta">${this._esc(id)} · manual</span>
        </label>`;
        list.insertAdjacentHTML('beforeend', html);
        showToast(`Adicionada: ${name}`, 'success');
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

        // Estado da sessão do modal — preserva marcações entre re-renders/filtros
        this._mapperState = {
            productId,
            accountId: this.config.activeAdAccountId,
            campaigns: [],
            // Set de IDs marcados (todos, visíveis ou não — fonte de verdade)
            selected: new Set(this._accountMap()[productId] || [])
        };

        // Popula seletores de conta/produto no toolbar
        this._renderMapperContextSelectors();
        this._updateMapperTitle();

        // Carrega campanhas da conta atual
        this._loadCampaignsForMapper();

        // Save: usa o set ao vivo, sem ler do DOM
        document.getElementById('fb-campaigns-save').onclick = () => {
            const st = this._mapperState;
            if (!st) return;
            // Salva no map da conta atualmente selecionada no modal
            const accountId = st.accountId;
            if (!this.campaignMap[accountId]) this.campaignMap[accountId] = {};
            this.campaignMap[accountId][st.productId] = Array.from(st.selected);
            this.saveCampaignMap();
            const acctName = (this.config.adAccounts.find(a => a.id === accountId)?.name) || accountId;
            const prodName = getProductName(st.productId) || st.productId;
            closeModal('fb-campaigns-modal');
            showToast(`${st.selected.size} campanha(s) mapeada(s) · ${prodName} · ${acctName}`, 'success');
        };
    },

    _loadCampaignsForMapper() {
        const st = this._mapperState;
        if (!st) return;
        document.getElementById('fb-campaigns-loading').style.display = 'block';
        document.getElementById('fb-campaigns-list').innerHTML = '';
        openModal('fb-campaigns-modal');

        // Salva ad account ativa temporariamente pra reusar fetchCampaigns
        const originalActive = this.config.activeAdAccountId;
        this.config.activeAdAccountId = st.accountId;

        this.fetchCampaigns().then(campaigns => {
            document.getElementById('fb-campaigns-loading').style.display = 'none';
            // Restaura conta ativa global (não persistida ainda)
            this.config.activeAdAccountId = originalActive;
            const listEl = document.getElementById('fb-campaigns-list');
            if (!campaigns.length) {
                listEl.innerHTML = '<p style="padding:1rem;text-align:center;color:var(--text-muted)">Nenhuma campanha encontrada nesta conta.</p>';
                return;
            }
            st.campaigns = campaigns;
            // Re-sincroniza seleção com mapeamento atual da conta+produto
            const mapping = (this.campaignMap[st.accountId] || {})[st.productId] || [];
            st.selected = new Set(mapping);
            this._renderCampaignList();
            this._wireCampaignFilters();
        }).catch(err => {
            this.config.activeAdAccountId = originalActive;
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
        const acctSel = document.getElementById('fb-mapper-account');
        const prodSel = document.getElementById('fb-mapper-product');
        if (!acctSel || !prodSel || !st) return;

        // Conta
        acctSel.innerHTML = (this.config.adAccounts || []).map(a =>
            `<option value="${this._esc(a.id)}" ${a.id === st.accountId ? 'selected' : ''}>${this._esc(a.name)}</option>`
        ).join('');
        acctSel.onchange = () => {
            st.accountId = acctSel.value;
            this._updateMapperTitle();
            this._loadCampaignsForMapper();
        };

        // Produto
        const products = (typeof AppState !== 'undefined' && AppState.products) ? AppState.products : [];
        prodSel.innerHTML = products.map(p =>
            `<option value="${this._esc(p.id)}" ${p.id === st.productId ? 'selected' : ''}>${this._esc(p.name)}</option>`
        ).join('');
        prodSel.onchange = () => {
            st.productId = prodSel.value;
            this._updateMapperTitle();
            // Reload selected set baseado em (conta atual, novo produto)
            const mapping = (this.campaignMap[st.accountId] || {})[st.productId] || [];
            st.selected = new Set(mapping);
            this._renderCampaignList();
        };
    },

    // Para uma campanha, retorna em quais OUTROS produtos da conta atual ela está mapeada
    _campaignMappedToOthers(campaignId) {
        const st = this._mapperState;
        if (!st) return [];
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
        const onlyMapped = !!document.getElementById('fb-campaigns-filter-mapped')?.checked;
        const selected = st.selected;

        const filtered = (st.campaigns || []).filter(c => {
            const status = (c.effective_status || '').toUpperCase();
            const isActive = status === 'ACTIVE';
            const isPaused = status === 'PAUSED';
            if (isActive && !showActive) return false;
            if (isPaused && !showPaused) return false;
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
            listEl.innerHTML = filtered.map(c => {
                const checked = selected.has(c.id) ? 'checked' : '';
                const status = (c.effective_status || '').toUpperCase();
                const others = this._campaignMappedToOthers(c.id);
                const otherBadge = others.length > 0
                    ? `<span class="fb-campaign-other" title="Já mapeada em ${others.map(p => getProductName(p) || p).join(', ')}"><i data-lucide="link-2" style="width:11px;height:11px;vertical-align:-1px"></i> ${others.length === 1 ? this._esc(getProductName(others[0]) || others[0]) : others.length + ' produtos'}</span>`
                    : '';
                return `<label class="fb-campaign-item">
                    <input type="checkbox" value="${this._esc(c.id)}" ${checked}>
                    <span class="fb-campaign-name">${this._highlightMatch(c.name || '', q)}</span>
                    ${otherBadge}
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
        if (this._campaignFiltersWired) return;
        this._campaignFiltersWired = true;
        const search = document.getElementById('fb-campaigns-search');
        const clear = document.getElementById('fb-campaigns-search-clear');
        const activeChk = document.getElementById('fb-campaigns-filter-active');
        const pausedChk = document.getElementById('fb-campaigns-filter-paused');
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
        [activeChk, pausedChk, mappedChk].forEach(el => el?.addEventListener('change', () => this._renderCampaignList()));

        // Captura toggle de checkbox e atualiza Set ao vivo
        const listEl = document.getElementById('fb-campaigns-list');
        listEl?.addEventListener('change', (e) => {
            const cb = e.target;
            if (!cb?.matches('input[type="checkbox"]')) return;
            const st = this._mapperState;
            if (!st) return;
            if (cb.checked) st.selected.add(cb.value); else st.selected.delete(cb.value);
            // Atualiza contagem (sem re-render se "só marcadas" não estiver ativo)
            if (mappedChk?.checked && !cb.checked) {
                this._renderCampaignList();
            } else {
                const countEl = document.getElementById('fb-campaigns-count');
                const total = (st.campaigns || []).length;
                const visible = listEl.querySelectorAll('.fb-campaign-item').length;
                if (countEl) countEl.textContent = `${visible}/${total}${st.selected.size > 0 ? ` · ${st.selected.size} marcadas` : ''}`;
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
