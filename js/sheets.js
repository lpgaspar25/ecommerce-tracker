/* ===========================
   Sheets.js — Google Sheets API integration (CRUD)
   With robust error handling for OAuth and API errors
   =========================== */

const SheetsAPI = {
    tokenClient: null,
    SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
    TOKEN_STORAGE_KEY: 'etracker_google_access_token',
    PIPELINE_DRIVE_FOLDER_KEY: 'etracker_pipeline_drive_folder_id',
    _isManualConnect: false,

    TABS: {
        PRODUCTS: 'Produtos',
        GOALS: 'Metas',
        DIARY: 'Diario',
        CONFIG: 'Config',
        STORES: 'Lojas',
        GOOGLE_ADS_QUEUE: 'GoogleAdsQueue',
        GOOGLE_ADS_RUNS: 'GoogleAdsRuns',
        CREATIVES: 'Criativos',
        CREATIVE_METRICS: 'MetricasCriativos',
        PROJECTS: 'Projetos'
    },

    async init(manual = false) {
        const { clientId, apiKey, spreadsheetId } = AppState.config;
        this._isManualConnect = !!manual;

        if (!clientId || !apiKey) {
            showToast('Configure Client ID e API Key para conectar com sua conta Google.', 'error');
            return;
        }

        // Check if Google APIs are loaded
        if (typeof gapi === 'undefined') {
            showToast('Google API ainda carregando. Tente novamente em alguns segundos.', 'error');
            console.error('gapi is not loaded yet');
            return;
        }

        if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
            showToast('Google Identity Services ainda carregando. Tente novamente em alguns segundos.', 'error');
            console.error('google.accounts.oauth2 is not loaded yet');
            return;
        }

        try {
            if (manual) showToast('Conectando ao Google Sheets...', 'info');

            // Initialize gapi client
            await gapi.client.init({
                apiKey: apiKey,
                discoveryDocs: ['https://sheets.googleapis.com/$discovery/rest?version=v4'],
            });

            console.log('gapi.client initialized successfully');

            // Create token client with error handling
            this.tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: this.SCOPES,
                callback: (resp) => {
                    if (resp.error) {
                        console.error('OAuth callback error:', resp);
                        this._handleAuthError(resp);
                        return;
                    }
                    console.log('OAuth token received successfully');
                    if (resp.access_token) {
                        gapi.client.setToken({ access_token: resp.access_token });
                        this._storeAccessToken(resp);
                    }
                    this._onConnected();
                },
                error_callback: (err) => {
                    console.error('OAuth error_callback:', err);
                    this._handlePopupError(err);
                }
            });

            // Check for existing token or request new one
            if (gapi.client.getToken()) {
                console.log('Using existing token');
                this._onConnected();
            } else if (this._restoreStoredAccessToken()) {
                console.log('Using stored access token');
                this._onConnected();
            } else {
                const promptMode = manual ? 'consent' : '';
                console.log(`Requesting access token (prompt="${promptMode}")...`);
                this.tokenClient.requestAccessToken({ prompt: promptMode });
            }
        } catch (err) {
            console.error('Sheets init error:', err);
            this._handleInitError(err);
        }
    },

    _storeAccessToken(resp) {
        const accessToken = resp?.access_token;
        if (!accessToken) return;
        const expiresIn = Number(resp?.expires_in || 3600);
        const expiresAt = Date.now() + (expiresIn * 1000);
        const data = { accessToken, expiresAt };
        localStorage.setItem(this.TOKEN_STORAGE_KEY, JSON.stringify(data));
    },

    _restoreStoredAccessToken() {
        try {
            const raw = localStorage.getItem(this.TOKEN_STORAGE_KEY);
            if (!raw) return false;
            const parsed = JSON.parse(raw);
            if (!parsed?.accessToken || !parsed?.expiresAt) return false;
            if (Date.now() >= Number(parsed.expiresAt) - 30000) {
                localStorage.removeItem(this.TOKEN_STORAGE_KEY);
                return false;
            }
            gapi.client.setToken({ access_token: parsed.accessToken });
            return true;
        } catch (err) {
            console.warn('Stored token inválido, limpando...', err);
            localStorage.removeItem(this.TOKEN_STORAGE_KEY);
            return false;
        }
    },

    _handleAuthError(resp) {
        const errorMsg = resp.error_description || resp.error || 'Erro desconhecido';
        const currentOrigin = window.location.origin;

        // Silent auto-connect failures are expected when no active Google session exists.
        if (!this._isManualConnect && (
            resp.error === 'popup_closed_by_user' ||
            resp.error === 'popup_closed' ||
            resp.error === 'interaction_required' ||
            resp.error === 'login_required'
        )) {
            return;
        }

        if (resp.error === 'redirect_uri_mismatch') {
            showToast(`ERRO: redirect_uri_mismatch. No Google Cloud Console, adicione ${currentOrigin} (e localhost no ambiente local) nos URIs de redirecionamento autorizados do OAuth Client.`, 'error');
        } else if (resp.error === 'access_denied') {
            showToast('Acesso negado. Verifique se seu email está nos "Usuários de teste" da Tela de consentimento OAuth.', 'error');
        } else if (resp.error === 'invalid_client') {
            showToast('Client ID inválido. Verifique se copiou o Client ID correto do Google Cloud Console.', 'error');
        } else if (resp.error === 'invalid_scope') {
            showToast('Escopo inválido. Verifique se a Google Sheets API está habilitada no projeto.', 'error');
        } else {
            showToast(`Erro de autenticação: ${errorMsg}`, 'error');
        }
    },

    _handlePopupError(err) {
        const errorType = err.type || err.message || 'unknown';
        const host = window.location.host;

        if (!this._isManualConnect) return;

        if (errorType === 'popup_closed' || errorType === 'popup_closed_by_user') {
            showToast('Popup de autenticação fechado. Tente novamente.', 'info');
        } else if (errorType === 'popup_failed_to_open' || errorType === 'popup_blocked') {
            showToast(`Popup bloqueado pelo navegador. Permita popups para ${host} e tente novamente.`, 'error');
        } else {
            showToast(`Erro no popup: ${errorType}`, 'error');
        }
    },

    _handleInitError(err) {
        const msg = err.message || err.toString();

        if (msg.includes('API key')) {
            showToast('API Key inválida. Verifique se copiou a chave correta.', 'error');
        } else if (msg.includes('network') || msg.includes('fetch')) {
            showToast('Erro de rede. Verifique sua conexão com a internet.', 'error');
        } else {
            showToast(`Erro ao inicializar: ${msg}`, 'error');
        }
    },

    async _onConnected() {
        try {
            if (!AppState.config.spreadsheetId) {
                await this._createSpreadsheetForCurrentUser();
            }

            AppState.sheetsConnected = true;
            document.getElementById('sheets-status').textContent = 'Conectado';
            document.getElementById('sheets-status').className = 'status-badge status-connected';
            document.getElementById('btn-connect-sheets').textContent = 'Reconectar';
            if (this._isManualConnect) showToast('Google Sheets conectado!', 'success');

            // Ensure tabs exist
            await this._ensureTabs();

            // Load all data
            await this.loadAll();
        } catch (err) {
            console.error('Error in _onConnected:', err);
            showToast('Conectado, mas erro ao carregar dados. Verifique o Spreadsheet ID.', 'error');
        }
    },

    async _createSpreadsheetForCurrentUser() {
        try {
            showToast('Criando planilha na sua conta Google...', 'info');
            const now = new Date();
            const title = `E-commerce Tracker (${now.toLocaleDateString('pt-BR')})`;

            const res = await gapi.client.sheets.spreadsheets.create({
                resource: { properties: { title } }
            });

            const spreadsheetId = res?.result?.spreadsheetId;
            if (!spreadsheetId) {
                throw new Error('Não foi possível obter o ID da planilha criada.');
            }

            AppState.config.spreadsheetId = spreadsheetId;
            localStorage.setItem('spreadsheetId', spreadsheetId);
            showToast('Planilha criada automaticamente na nuvem!', 'success');
        } catch (err) {
            console.error('Error creating spreadsheet:', err);
            throw err;
        }
    },

    async _ensureTabs(allowAutoCreate = true) {
        try {
            const res = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: AppState.config.spreadsheetId
            });

            const existingTabs = res.result.sheets.map(s => s.properties.title);
            const needed = Object.values(this.TABS).filter(t => !existingTabs.includes(t));

            if (needed.length > 0) {
                await gapi.client.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: AppState.config.spreadsheetId,
                    resource: {
                        requests: needed.map(title => ({
                            addSheet: { properties: { title } }
                        }))
                    }
                });

                // Add headers
                const headerPromises = [];

                if (needed.includes(this.TABS.PRODUCTS)) {
                    headerPromises.push(this._writeRow(this.TABS.PRODUCTS, 1, [
                        'ID', 'Nome', 'Preco', 'MoedaPreco', 'Custo', 'MoedaCusto',
                        'Impostos%', 'CustosVar%', 'CPAAlvo', 'MoedaCPA', 'Status', 'LojaID', 'Idioma'
                    ]));
                }
                if (needed.includes(this.TABS.GOALS)) {
                    headerPromises.push(this._writeRow(this.TABS.GOALS, 1, [
                        'ID', 'ProdutoID', 'LucroAlvoDiario', 'Moeda', 'DataInicio', 'DataFim', 'Status', 'LojaID'
                    ]));
                }
                if (needed.includes(this.TABS.DIARY)) {
                    headerPromises.push(this._writeRow(this.TABS.DIARY, 1, [
                        'ID', 'Data', 'ProdutoID', 'Orcamento', 'MoedaOrcamento',
                        'Vendas', 'Receita', 'MoedaReceita', 'CPAReal', 'CPCReal', 'Plataforma', 'Notas',
                        'Impressoes', 'PageViews', 'AddToCart', 'Checkout', 'HistoricoProduto', 'LojaID', 'PeriodoInicio', 'PeriodoFim',
                        'Teste', 'TesteDataFim', 'TesteValidacao', 'TesteTipo', 'CriativoID', 'MetaTeste'
                    ]));
                }
                if (needed.includes(this.TABS.CONFIG)) {
                    headerPromises.push(this._writeRow(this.TABS.CONFIG, 1, [
                        'Chave', 'Valor', 'AtualizadoEm'
                    ]));
                }
                if (needed.includes(this.TABS.STORES)) {
                    headerPromises.push(this._writeRow(this.TABS.STORES, 1, [
                        'ID', 'Nome', 'Status'
                    ]));
                }
                if (needed.includes(this.TABS.GOOGLE_ADS_QUEUE)) {
                    headerPromises.push(this._writeRow(this.TABS.GOOGLE_ADS_QUEUE, 1, [
                        'ID', 'StoreID', 'ProductID', 'CustomerID', 'CampaignID', 'AdGroupID',
                        'AdName', 'FinalURL', 'HeadlinesJSON', 'DescriptionsJSON',
                        'MarketingImageAssetIDsJSON', 'SquareMarketingImageAssetIDsJSON', 'LogoImageAssetIDsJSON',
                        'YouTubeVideoAssetIDsJSON', 'CallToAction', 'DesiredState',
                        'GoogleAdID', 'LastPayloadHash', 'SyncStatus', 'LastSyncAt', 'LastError', 'UpdatedAt'
                    ]));
                }
                if (needed.includes(this.TABS.GOOGLE_ADS_RUNS)) {
                    headerPromises.push(this._writeRow(this.TABS.GOOGLE_ADS_RUNS, 1, [
                        'RunID', 'Mode', 'TriggeredBy', 'StartedAt', 'FinishedAt',
                        'RowsRead', 'RowsProcessed', 'RowsSuccess', 'RowsFailed', 'Status', 'ErrorSummary'
                    ]));
                }

                await Promise.all(headerPromises);
                console.log('Created tabs:', needed);
            }
        } catch (err) {
            console.error('Error ensuring tabs:', err);
            if (err.status === 404) {
                if (allowAutoCreate) {
                    showToast('Planilha não encontrada. Criando nova automaticamente...', 'info');
                    AppState.config.spreadsheetId = '';
                    localStorage.removeItem('spreadsheetId');
                    await this._createSpreadsheetForCurrentUser();
                    await this._ensureTabs(false);
                    return;
                }
                showToast('Planilha não encontrada. Verifique o Spreadsheet ID.', 'error');
            } else if (err.status === 403) {
                showToast('Sem permissão para acessar a planilha. Verifique se a planilha está compartilhada.', 'error');
            }
        }
    },

    async loadAll() {
        try {
            const res = await gapi.client.sheets.spreadsheets.values.batchGet({
                spreadsheetId: AppState.config.spreadsheetId,
                ranges: [
                    `${this.TABS.PRODUCTS}!A2:M`,
                    `${this.TABS.GOALS}!A2:H`,
                    `${this.TABS.DIARY}!A2:W`,
                    `${this.TABS.CONFIG}!A2:C`,
                    `${this.TABS.STORES}!A2:C`
                ]
            });

            const ranges = res.result.valueRanges;

            // Parse stores first
            AppState.stores = (ranges[4].values || []).map(row => ({
                id: row[0] || '',
                name: row[1] || '',
                status: row[2] || 'ativo'
            })).filter(store => store.id && store.name);
            if (AppState.stores.length === 0) {
                AppState.stores = JSON.parse(localStorage.getItem('etracker_stores') || '[]');
            }

            ensureStoreSetup();
            const fallbackStoreId = AppState.stores[0]?.id || '';

            // Parse products
            AppState.allProducts = (ranges[0].values || []).map(row => ({
                id: row[0] || '',
                name: row[1] || '',
                price: parseFloat(row[2]) || 0,
                priceCurrency: row[3] || 'USD',
                cost: parseFloat(row[4]) || 0,
                costCurrency: row[5] || 'USD',
                tax: parseFloat(row[6]) || 0,
                variableCosts: parseFloat(row[7]) || 0,
                cpa: parseFloat(row[8]) || 0,
                cpaCurrency: row[9] || 'USD',
                status: row[10] || 'ativo',
                storeId: row[11] || fallbackStoreId,
                language: row[12] || 'Ingles'
            }));

            // Parse goals
            AppState.allGoals = (ranges[1].values || []).map(row => ({
                id: row[0] || '',
                productId: row[1] || 'todos',
                dailyTarget: parseFloat(row[2]) || 0,
                currency: row[3] || 'BRL',
                startDate: row[4] || '',
                endDate: row[5] || '',
                status: row[6] || 'ativa',
                storeId: row[7] || fallbackStoreId
            }));

            // Parse diary
            AppState.allDiary = (ranges[2].values || []).map(row => {
                const date = row[1] || '';
                const notes = row[11] || '';
                const resolvedPeriod = this._resolveDiaryPeriod(date, row[18], row[19], notes);
                return {
                    id: row[0] || '',
                    date,
                    periodStart: resolvedPeriod.periodStart,
                    periodEnd: resolvedPeriod.periodEnd,
                    productId: row[2] || '',
                    budget: parseFloat(row[3]) || 0,
                    budgetCurrency: row[4] || 'USD',
                    sales: parseInt(row[5]) || 0,
                    revenue: parseFloat(row[6]) || 0,
                    revenueCurrency: row[7] || 'USD',
                    cpa: parseFloat(row[8]) || 0,
                    cpc: parseFloat(row[9]) || 0,
                    platform: row[10] || '',
                    notes,
                    impressions: parseInt(row[12]) || 0,
                    pageViews: parseInt(row[13]) || 0,
                    addToCart: parseInt(row[14]) || 0,
                    checkout: parseInt(row[15]) || 0,
                    productHistory: row[16] || '',
                    storeId: row[17] || fallbackStoreId,
                    isTest: ['sim', 'true', '1', 'yes'].includes(String(row[20] || '').trim().toLowerCase()),
                    testEndDate: row[21] || '',
                    testValidation: row[22] || ''
                };
            });

            normalizeAllDataStoreIds();
            filterDataByStore();
            renderStoreSelector();

            // Parse config
            const configRows = ranges[3].values || [];
            if (!AppState.exchangeRates) AppState.exchangeRates = { BRL: 5.20, GBP: 0.79, EUR: 0.92 };
            configRows.forEach(row => {
                if (row[0] === 'cotacao_usd_brl' && row[1]) {
                    const rate = parseFloat(row[1]);
                    if (rate > 0 && !AppState.exchangeRate) {
                        AppState.exchangeRate = rate;
                        AppState.exchangeRates.BRL = rate;
                    }
                }
                if (row[0] === 'cotacao_usd_gbp' && row[1]) {
                    const rate = parseFloat(row[1]);
                    if (rate > 0) AppState.exchangeRates.GBP = rate;
                }
                if (row[0] === 'cotacao_usd_eur' && row[1]) {
                    const rate = parseFloat(row[1]);
                    if (rate > 0) AppState.exchangeRates.EUR = rate;
                }
            });
            CurrencyModule._updateDisplay();

            LocalStore.save('stores', AppState.stores);
            LocalStore.save('products', AppState.allProducts);
            LocalStore.save('goals', AppState.allGoals);
            LocalStore.save('diary', AppState.allDiary);

            // Notify all modules
            populateProductDropdowns();
            EventBus.emit('dataLoaded');

            console.log(`Loaded: ${AppState.allProducts.length} products, ${AppState.allGoals.length} goals, ${AppState.allDiary.length} diary entries`);

        } catch (err) {
            console.error('Error loading data:', err);
            if (err.status === 404) {
                showToast('Planilha ou aba não encontrada. O sistema vai recriá-las.', 'error');
                await this._ensureTabs();
            } else {
                showToast('Erro ao carregar dados da planilha.', 'error');
            }
        }
    },

    // ---- CRUD Operations ----
    async appendRow(tab, data) {
        try {
            await gapi.client.sheets.spreadsheets.values.append({
                spreadsheetId: AppState.config.spreadsheetId,
                range: `${tab}!A:Z`,
                valueInputOption: 'RAW',
                resource: { values: [data] }
            });
        } catch (err) {
            console.error('Error appending row:', err);
            throw err;
        }
    },

    async _writeRow(tab, rowNum, data) {
        try {
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: AppState.config.spreadsheetId,
                range: `${tab}!A${rowNum}:Z${rowNum}`,
                valueInputOption: 'RAW',
                resource: { values: [data] }
            });
        } catch (err) {
            console.error('Error writing row:', err);
            throw err;
        }
    },

    async updateRowById(tab, id, data) {
        try {
            const res = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: AppState.config.spreadsheetId,
                range: `${tab}!A:A`
            });

            const ids = res.result.values || [];
            let rowIndex = -1;
            for (let i = 0; i < ids.length; i++) {
                if (ids[i][0] === id) {
                    rowIndex = i + 1; // 1-based
                    break;
                }
            }

            if (rowIndex > 0) {
                await this._writeRow(tab, rowIndex, data);
            }
        } catch (err) {
            console.error('Error updating row:', err);
            throw err;
        }
    },

    async deleteRowById(tab, id) {
        try {
            // Get sheet ID
            const metaRes = await gapi.client.sheets.spreadsheets.get({
                spreadsheetId: AppState.config.spreadsheetId
            });
            const sheet = metaRes.result.sheets.find(s => s.properties.title === tab);
            if (!sheet) return;

            const sheetId = sheet.properties.sheetId;

            // Find row index
            const res = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: AppState.config.spreadsheetId,
                range: `${tab}!A:A`
            });

            const ids = res.result.values || [];
            let rowIndex = -1;
            for (let i = 0; i < ids.length; i++) {
                if (ids[i][0] === id) {
                    rowIndex = i;
                    break;
                }
            }

            if (rowIndex >= 0) {
                await gapi.client.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: AppState.config.spreadsheetId,
                    resource: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId: sheetId,
                                    dimension: 'ROWS',
                                    startIndex: rowIndex,
                                    endIndex: rowIndex + 1
                                }
                            }
                        }]
                    }
                });
            }
        } catch (err) {
            console.error('Error deleting row:', err);
            throw err;
        }
    },

    async saveConfig(key, value) {
        try {
            const res = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: AppState.config.spreadsheetId,
                range: `${this.TABS.CONFIG}!A:A`
            });

            const keys = res.result.values || [];
            let rowIndex = -1;
            for (let i = 0; i < keys.length; i++) {
                if (keys[i][0] === key) {
                    rowIndex = i + 1;
                    break;
                }
            }

            const data = [key, value, new Date().toISOString()];

            if (rowIndex > 0) {
                await this._writeRow(this.TABS.CONFIG, rowIndex, data);
            } else {
                await this.appendRow(this.TABS.CONFIG, data);
            }
        } catch (err) {
            console.error('Error saving config:', err);
        }
    },

    _parsePtBrDateToISO(value) {
        const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (!match) return '';
        const [, dd, mm, yyyy] = match;
        return `${yyyy}-${mm}-${dd}`;
    },

    _extractDiagnosisPeriodFromNotes(notes) {
        const text = String(notes || '');
        const match = text.match(/Per[ií]odo do diagn[oó]stico:\s*(\d{2}\/\d{2}\/\d{4})\s*at[eé]\s*(\d{2}\/\d{2}\/\d{4})/i);
        if (!match) return null;
        const periodStart = this._parsePtBrDateToISO(match[1]);
        const periodEnd = this._parsePtBrDateToISO(match[2]);
        if (!periodStart || !periodEnd) return null;
        return { periodStart, periodEnd };
    },

    _resolveDiaryPeriod(date, periodStart, periodEnd, notes) {
        const parsed = this._extractDiagnosisPeriodFromNotes(notes);
        const resolvedStart = String(periodStart || parsed?.periodStart || date || '').trim();
        const resolvedEnd = String(periodEnd || parsed?.periodEnd || date || resolvedStart || '').trim();
        if (resolvedStart && resolvedEnd && resolvedStart <= resolvedEnd) {
            return { periodStart: resolvedStart, periodEnd: resolvedEnd };
        }
        return { periodStart: resolvedEnd || resolvedStart, periodEnd: resolvedStart || resolvedEnd };
    },

    // ---- Google Ads Queue / Runs ----
    async loadGoogleAdsQueue() {
        const res = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: AppState.config.spreadsheetId,
            range: `${this.TABS.GOOGLE_ADS_QUEUE}!A2:V`
        });

        return (res.result.values || []).map((row) => ({
            id: row[0] || '',
            storeId: row[1] || '',
            productId: row[2] || '',
            customerId: row[3] || '',
            campaignId: row[4] || '',
            adGroupId: row[5] || '',
            adName: row[6] || '',
            finalUrl: row[7] || '',
            headlinesJson: row[8] || '[]',
            descriptionsJson: row[9] || '[]',
            marketingImageAssetIdsJson: row[10] || '[]',
            squareMarketingImageAssetIdsJson: row[11] || '[]',
            logoImageAssetIdsJson: row[12] || '[]',
            youtubeVideoAssetIdsJson: row[13] || '[]',
            callToAction: row[14] || '',
            desiredState: row[15] || '',
            googleAdId: row[16] || '',
            lastPayloadHash: row[17] || '',
            syncStatus: row[18] || '',
            lastSyncAt: row[19] || '',
            lastError: row[20] || '',
            updatedAt: row[21] || ''
        }));
    },

    async upsertGoogleAdsQueue(item) {
        const payload = {
            ...item,
            updatedAt: new Date().toISOString()
        };

        const row = this.googleAdsQueueToRow(payload);
        const id = String(payload.id || '').trim();
        if (!id) throw new Error('GoogleAdsQueue: campo ID é obrigatório.');

        const res = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: AppState.config.spreadsheetId,
            range: `${this.TABS.GOOGLE_ADS_QUEUE}!A:A`
        });

        const ids = res.result.values || [];
        let rowIndex = -1;
        for (let i = 0; i < ids.length; i++) {
            if ((ids[i][0] || '') === id) {
                rowIndex = i + 1;
                break;
            }
        }

        if (rowIndex > 0) {
            await this._writeRow(this.TABS.GOOGLE_ADS_QUEUE, rowIndex, row);
            return;
        }

        await this.appendRow(this.TABS.GOOGLE_ADS_QUEUE, row);
    },

    async loadGoogleAdsRuns(limit = 20) {
        const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
        const res = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: AppState.config.spreadsheetId,
            range: `${this.TABS.GOOGLE_ADS_RUNS}!A2:K`
        });

        const rows = (res.result.values || []).map((row) => ({
            runId: row[0] || '',
            mode: row[1] || '',
            triggeredBy: row[2] || '',
            startedAt: row[3] || '',
            finishedAt: row[4] || '',
            rowsRead: parseInt(row[5]) || 0,
            rowsProcessed: parseInt(row[6]) || 0,
            rowsSuccess: parseInt(row[7]) || 0,
            rowsFailed: parseInt(row[8]) || 0,
            status: row[9] || '',
            errorSummary: row[10] || ''
        }));

        rows.sort((a, b) => String(b.finishedAt || b.startedAt).localeCompare(String(a.finishedAt || a.startedAt)));
        return rows.slice(0, safeLimit);
    },

    async appendGoogleAdsRun(run) {
        await this.appendRow(this.TABS.GOOGLE_ADS_RUNS, this.googleAdsRunToRow(run));
    },

    // ---- Drive helpers (Pipeline photos) ----
    getAccessToken() {
        try {
            const token = gapi?.client?.getToken?.();
            if (token?.access_token) return token.access_token;
            if (this._restoreStoredAccessToken()) {
                const restored = gapi?.client?.getToken?.();
                return restored?.access_token || '';
            }
        } catch (err) {
            console.warn('Erro ao obter token de acesso do Google:', err);
        }
        return '';
    },

    _escapeDriveQueryValue(value) {
        return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    },

    _sanitizeDriveName(value) {
        return String(value || '')
            .trim()
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .replace(/\s+/g, ' ')
            .slice(0, 120) || `arquivo_${Date.now()}`;
    },

    async _driveRequest(pathOrUrl, options = {}) {
        const accessToken = this.getAccessToken();
        if (!accessToken) {
            throw new Error('Sessão do Google expirada. Clique em "Reconectar" para continuar.');
        }

        const url = /^https?:\/\//i.test(pathOrUrl)
            ? pathOrUrl
            : `https://www.googleapis.com${pathOrUrl}`;

        const headers = new Headers(options.headers || {});
        headers.set('Authorization', `Bearer ${accessToken}`);

        const res = await fetch(url, {
            method: options.method || 'GET',
            headers,
            body: options.body
        });

        const contentType = String(res.headers.get('content-type') || '').toLowerCase();
        const payload = contentType.includes('application/json')
            ? await res.json().catch(() => null)
            : await res.text().catch(() => '');

        if (!res.ok) {
            const apiMsg = payload?.error?.message || payload?.error_description || payload?.error || '';
            let message = apiMsg || `Google Drive HTTP ${res.status}`;
            if (String(message).toLowerCase().includes('insufficient')) {
                message = 'Permissão do Drive ausente. Clique em "Reconectar" para conceder acesso ao Drive.';
            }
            throw new Error(message);
        }

        return payload;
    },

    async ensurePipelineDriveFolder() {
        const cachedId = localStorage.getItem(this.PIPELINE_DRIVE_FOLDER_KEY) || '';
        if (cachedId) {
            try {
                const current = await this._driveRequest(
                    `/drive/v3/files/${encodeURIComponent(cachedId)}?fields=id,name,mimeType,trashed`
                );
                if (current?.id && current?.mimeType === 'application/vnd.google-apps.folder' && !current?.trashed) {
                    return current.id;
                }
            } catch (err) {
                console.warn('Pasta de fotos cacheada inválida, tentando recriar/encontrar.', err);
            }
            localStorage.removeItem(this.PIPELINE_DRIVE_FOLDER_KEY);
        }

        const suffix = String(AppState?.config?.spreadsheetId || '').slice(0, 8) || 'default';
        const folderName = this._sanitizeDriveName(`EcommerceTracker Pipeline Fotos ${suffix}`);
        const q = [
            `mimeType='application/vnd.google-apps.folder'`,
            `trashed=false`,
            `name='${this._escapeDriveQueryValue(folderName)}'`
        ].join(' and ');
        const queryPath = `/drive/v3/files?q=${encodeURIComponent(q)}&spaces=drive&pageSize=10&fields=files(id,name)`;
        const found = await this._driveRequest(queryPath);
        const existing = Array.isArray(found?.files) ? found.files[0] : null;
        if (existing?.id) {
            localStorage.setItem(this.PIPELINE_DRIVE_FOLDER_KEY, existing.id);
            return existing.id;
        }

        const created = await this._driveRequest('/drive/v3/files?fields=id,name', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder'
            })
        });

        if (!created?.id) {
            throw new Error('Não foi possível criar pasta de fotos no Google Drive.');
        }
        localStorage.setItem(this.PIPELINE_DRIVE_FOLDER_KEY, created.id);
        return created.id;
    },

    async uploadPipelinePhotoBlob(blob, options = {}) {
        if (!(blob instanceof Blob)) {
            throw new Error('Arquivo de foto inválido para upload.');
        }

        const folderId = await this.ensurePipelineDriveFolder();
        const rawName = String(options.fileName || `pipeline_${Date.now()}.jpg`);
        const fileName = this._sanitizeDriveName(rawName);
        const mimeType = String(blob.type || options.mimeType || 'image/jpeg');

        const metadata = {
            name: fileName,
            mimeType,
            parents: [folderId]
        };
        const boundary = `etracker_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const multipartBody = new Blob([
            `--${boundary}\r\n`,
            'Content-Type: application/json; charset=UTF-8\r\n\r\n',
            JSON.stringify(metadata),
            '\r\n',
            `--${boundary}\r\n`,
            `Content-Type: ${mimeType}\r\n\r\n`,
            blob,
            '\r\n',
            `--${boundary}--`
        ]);

        const uploaded = await this._driveRequest(
            '/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink,webContentLink',
            {
                method: 'POST',
                headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
                body: multipartBody
            }
        );

        if (!uploaded?.id) {
            throw new Error('Google Drive não retornou o ID do arquivo enviado.');
        }

        let isPublic = false;
        let permissionWarning = '';
        try {
            await this._driveRequest(
                `/drive/v3/files/${encodeURIComponent(uploaded.id)}/permissions?sendNotificationEmail=false`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: 'reader', type: 'anyone' })
                }
            );
            isPublic = true;
        } catch (err) {
            permissionWarning = err.message || 'Sem permissão pública';
            console.warn('Não foi possível liberar permissão pública da imagem:', err);
        }

        let fileMeta = null;
        try {
            fileMeta = await this._driveRequest(
                `/drive/v3/files/${encodeURIComponent(uploaded.id)}?fields=id,name,mimeType,size,webViewLink,webContentLink,thumbnailLink`
            );
        } catch (err) {
            console.warn('Não foi possível obter metadados finais da imagem no Drive:', err);
        }

        const fileId = uploaded.id;
        const previewUrl = `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
        const thumbUrl = fileMeta?.thumbnailLink || `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1000`;

        return {
            fileId,
            name: fileMeta?.name || uploaded?.name || fileName,
            mimeType: fileMeta?.mimeType || uploaded?.mimeType || mimeType,
            sizeBytes: Number(fileMeta?.size || uploaded?.size || blob.size || 0),
            viewUrl: fileMeta?.webViewLink || uploaded?.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
            downloadUrl: fileMeta?.webContentLink || uploaded?.webContentLink || `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
            previewUrl,
            thumbnailUrl: thumbUrl,
            isPublic,
            permissionWarning
        };
    },

    // ---- Convenience: row converters ----
    productToRow(p) {
        return [
            p.id, p.name, p.price, p.priceCurrency, p.cost, p.costCurrency,
            p.tax, p.variableCosts, p.cpa, p.cpaCurrency, p.status, p.storeId || '', p.language || p.country || 'Ingles'
        ];
    },

    goalToRow(g) {
        return [
            g.id, g.productId, g.dailyTarget, g.currency,
            g.startDate, g.endDate, g.status, g.storeId || ''
        ];
    },

    diaryToRow(d) {
        return [
            d.id, d.date, d.productId, d.budget, d.budgetCurrency,
            d.sales, d.revenue, d.revenueCurrency, d.cpa, d.cpc,
            d.platform, d.notes,
            d.impressions || 0, d.pageViews || 0, d.addToCart || 0, d.checkout || 0,
            d.productHistory || '',
            d.storeId || '',
            d.periodStart || d.date || '',
            d.periodEnd || d.date || '',
            d.isTest ? 'Sim' : 'Nao',
            d.testEndDate || '',
            d.testValidation || '',
            d.testType || '',
            d.creativeId || '',
            d.testGoal || ''
        ];
    },

    creativeToRow(c) {
        return [
            c.id, c.productId, c.name, c.type, c.angle || '', c.hookText || '',
            c.hookType || '', c.platform || '', c.status || 'ativo',
            c.launchDate || '', c.primaryText || '', c.headline || '',
            c.adDescription || '', JSON.stringify(c.variations || []),
            c.storeId || '', c.createdAt || '', c.updatedAt || ''
        ];
    },

    creativeMetricToRow(m) {
        return [
            m.id, m.creativeId, m.date, m.spend, m.impressions, m.clicks,
            m.ctr, m.cpc, m.cpm, m.conversions, m.revenue, m.roas,
            m.currency || 'USD', m.storeId || ''
        ];
    },

    storeToRow(s) {
        return [s.id, s.name, s.status || 'ativo'];
    },

    googleAdsQueueToRow(q) {
        return [
            q.id || '',
            q.storeId || '',
            q.productId || '',
            q.customerId || '',
            q.campaignId || '',
            q.adGroupId || '',
            q.adName || '',
            q.finalUrl || '',
            q.headlinesJson || '[]',
            q.descriptionsJson || '[]',
            q.marketingImageAssetIdsJson || '[]',
            q.squareMarketingImageAssetIdsJson || '[]',
            q.logoImageAssetIdsJson || '[]',
            q.youtubeVideoAssetIdsJson || '[]',
            q.callToAction || '',
            q.desiredState || '',
            q.googleAdId || '',
            q.lastPayloadHash || '',
            q.syncStatus || '',
            q.lastSyncAt || '',
            q.lastError || '',
            q.updatedAt || new Date().toISOString()
        ];
    },

    googleAdsRunToRow(r) {
        return [
            r.runId || '',
            r.mode || '',
            r.triggeredBy || '',
            r.startedAt || '',
            r.finishedAt || '',
            r.rowsRead || 0,
            r.rowsProcessed || 0,
            r.rowsSuccess || 0,
            r.rowsFailed || 0,
            r.status || '',
            r.errorSummary || ''
        ];
    }
};

// ---- Fallback: LocalStorage if no Sheets ----
const LocalStore = {
    save(key, data) {
        localStorage.setItem(`etracker_${key}`, JSON.stringify(data));
    },
    load(key) {
        const raw = localStorage.getItem(`etracker_${key}`);
        return raw ? JSON.parse(raw) : null;
    }
};

// On app load, ALWAYS load from localStorage first (instant data).
// If Sheets is connected, loadAllData() will overwrite later when GAPI is ready.
document.addEventListener('DOMContentLoaded', () => {
    // Load from localStorage
    const storesFromLocal = JSON.parse(localStorage.getItem('etracker_stores') || '[]');
    AppState.stores = storesFromLocal.length > 0
        ? storesFromLocal
        : (LocalStore.load('stores') || []);
    ensureStoreSetup();

    AppState.allProducts = LocalStore.load('products') || [];
    AppState.allGoals = LocalStore.load('goals') || [];
    AppState.allDiary = LocalStore.load('diary') || [];
    AppState.allCreatives = LocalStore.load('creatives') || [];
    AppState.allCreativeMetrics = LocalStore.load('creative_metrics') || [];
    AppState.allProjects = LocalStore.load('projects') || [];

    // Migration v2: fix diary entries where BRL values were stored with budgetCurrency='USD'
    // (caused by import not detecting 'brl' in the spreadsheet header name)
    // Detects entries with CPA stored on the entry itself that matches budget/sales
    // (meaning the raw budget IS in the correct currency), but budgetCurrency='USD'
    // would cause the dashboard to incorrectly multiply by the exchange rate.
    if (!localStorage.getItem('_mig_fix_currency_v2')) {
        let fixed = 0;
        AppState.allDiary.forEach(e => {
            if (e.budgetCurrency === 'USD') {
                // If the entry has a pre-computed CPA that matches budget/sales,
                // the budget value was NOT converted — it's raw from the spreadsheet.
                // If the spreadsheet was in BRL, the budgetCurrency should be BRL.
                const rawCpa = (e.sales > 0) ? (e.budget / e.sales) : 0;
                const storedCpa = e.cpa || 0;
                const cpaMatch = storedCpa > 0 && Math.abs(rawCpa - storedCpa) < 0.1;
                // Also fix sub-entries (isCampaign) that inherited the wrong currency
                if (cpaMatch || e.isCampaign) {
                    e.budgetCurrency = 'BRL';
                    if (e.revenueCurrency === 'USD') e.revenueCurrency = 'BRL';
                    fixed++;
                }
            }
        });
        if (fixed > 0) {
            LocalStore.save('diary', AppState.allDiary);
            console.log('[Migration v2] Fixed ' + fixed + ' diary entries: budgetCurrency USD → BRL');
        }
        localStorage.setItem('_mig_fix_currency_v2', '1');
    }

    normalizeAllDataStoreIds();
    filterDataByStore();
    renderStoreSelector();

    populateProductDropdowns();
    EventBus.emit('dataLoaded');

    // Initialize Supabase cloud sync
    if (typeof SupabaseSync !== 'undefined') {
        SupabaseSync.init();
    }

    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') lucide.createIcons();
});

// Always save to localStorage as backup
EventBus.on('productsChanged', () => LocalStore.save('products', AppState.allProducts));
EventBus.on('goalsChanged', () => LocalStore.save('goals', AppState.allGoals));
EventBus.on('diaryChanged', () => LocalStore.save('diary', AppState.allDiary));
EventBus.on('creativesChanged', () => {
    LocalStore.save('creatives', AppState.allCreatives);
    LocalStore.save('creative_metrics', AppState.allCreativeMetrics);
});
EventBus.on('projectsChanged', () => LocalStore.save('projects', AppState.allProjects));
