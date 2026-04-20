/* ===========================
   Facebook.js — Facebook Ads API Integration
   Fetches campaign insights and maps to products
   =========================== */

const FacebookAds = {
    API_VERSION: 'v22.0',
    BASE_URL: 'https://graph.facebook.com',

    // Config persistida em localStorage
    config: {
        accessToken: localStorage.getItem('fb_access_token') || '',
        adAccountId: localStorage.getItem('fb_ad_account_id') || ''
    },

    // Mapeamento produto → campanhas: { productId: [campaignId1, campaignId2, ...] }
    campaignMap: JSON.parse(localStorage.getItem('fb_campaign_map') || '{}'),

    // ---- Status ----
    isConnected() {
        return !!(this.config.accessToken && this.config.adAccountId);
    },

    // ---- Persistência ----
    saveConfig() {
        localStorage.setItem('fb_access_token', this.config.accessToken);
        localStorage.setItem('fb_ad_account_id', this.config.adAccountId);

        // Salvar no Sheets Config tab se conectado
        if (AppState.sheetsConnected) {
            SheetsAPI.saveConfig('fb_ad_account_id', this.config.adAccountId);
            // Token não vai pro Sheets por segurança
        }
    },

    saveCampaignMap() {
        localStorage.setItem('fb_campaign_map', JSON.stringify(this.campaignMap));

        if (AppState.sheetsConnected) {
            SheetsAPI.saveConfig('fb_campaign_map', JSON.stringify(this.campaignMap));
        }
    },

    // ---- UI Init ----
    initUI() {
        // Config form submit
        const form = document.getElementById('fb-config-form');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this.config.accessToken = document.getElementById('fb-access-token').value.trim();
                this.config.adAccountId = document.getElementById('fb-ad-account-id').value.trim().replace('act_', '');
                this.saveConfig();
                this._updateStatusBadge();
                closeModal('fb-config-modal');
                showToast('Facebook Ads configurado!', 'success');
            });
        }

        // Botão: Configurar Facebook
        const btnConfig = document.getElementById('btn-fb-config');
        if (btnConfig) {
            btnConfig.addEventListener('click', () => {
                document.getElementById('fb-access-token').value = this.config.accessToken;
                document.getElementById('fb-ad-account-id').value = this.config.adAccountId;
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
    },

    _updateStatusBadge() {
        const badge = document.getElementById('fb-status');
        if (!badge) return;
        if (this.isConnected()) {
            badge.textContent = 'FB Conectado';
            badge.className = 'status-badge status-connected';
        } else {
            badge.textContent = 'FB Desconectado';
            badge.className = 'status-badge status-disconnected';
        }
    },

    // ---- API: Buscar campanhas da conta ----
    async fetchCampaigns() {
        if (!this.isConnected()) throw new Error('Facebook não configurado');

        const url = `${this.BASE_URL}/${this.API_VERSION}/act_${this.config.adAccountId}/campaigns`
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

    // ---- API: Buscar insights de campanhas mapeadas a um produto ----
    async fetchProductInsights(productId, dateRange) {
        if (!this.isConnected()) throw new Error('Facebook não configurado');

        const campaignIds = this.campaignMap[productId];
        if (!campaignIds || campaignIds.length === 0) {
            throw new Error('Nenhuma campanha mapeada para este produto');
        }

        const since = dateRange?.since || todayISO();
        const until = dateRange?.until || todayISO();

        const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
        const filtering = encodeURIComponent(JSON.stringify([
            { field: 'campaign.id', operator: 'IN', value: campaignIds }
        ]));

        const url = `${this.BASE_URL}/${this.API_VERSION}/act_${this.config.adAccountId}/insights`
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
            const mapped = this.campaignMap[productId] || [];
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
            this.campaignMap[productId] = checked;
            this.saveCampaignMap();
            closeModal('fb-campaigns-modal');
            showToast(`${checked.length} campanha(s) mapeada(s)`, 'success');
        };
    }
};
