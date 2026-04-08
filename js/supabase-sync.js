/* ===========================
   supabase-sync.js — Supabase Cloud Sync Module
   Full-screen login + profile avatar + cloud sync
   =========================== */

const SUPA_URL = 'https://clqsjcestdvmdxsemwdc.supabase.co';
const SUPA_KEY = 'sb_publishable_zFJQV-ChQ6vOxpYrYfN8UA_jNe7tJqQ';

const SupabaseSync = (() => {
    let _client = null;
    let _user = null;
    let _debounceTimers = {};

    function _debounce(key, fn, delay) {
        clearTimeout(_debounceTimers[key]);
        _debounceTimers[key] = setTimeout(fn, delay);
    }

    function _getClient() {
        if (_client) return _client;
        if (window.supabase && window.supabase.createClient) {
            _client = window.supabase.createClient(SUPA_URL, SUPA_KEY);
        }
        return _client;
    }

    // ── Row converters ──────────────────────────────────────────────────
    function _diaryToRow(e) {
        return {
            id: e.id, user_id: _user ? _user.id : null,
            store_id: e.storeId || e.store_id || null,
            product_id: e.productId || e.product_id || null,
            date: e.date || null,
            period_start: e.periodStart || e.period_start || null,
            period_end: e.periodEnd || e.period_end || null,
            budget: e.budget !== undefined ? e.budget : null,
            budget_currency: e.budgetCurrency || e.budget_currency || null,
            sales: e.sales !== undefined ? e.sales : null,
            revenue: e.revenue !== undefined ? e.revenue : null,
            revenue_currency: e.revenueCurrency || e.revenue_currency || null,
            cpa: e.cpa !== undefined ? e.cpa : null,
            cpc: e.cpc !== undefined ? e.cpc : null,
            platform: e.platform || null, notes: e.notes || null,
            impressions: e.impressions !== undefined ? e.impressions : null,
            page_views: e.pageViews || e.page_views || null,
            add_to_cart: e.addToCart || e.add_to_cart || null,
            checkout: e.checkout !== undefined ? e.checkout : null,
            product_history: e.productHistory !== undefined ? e.productHistory : (e.product_history !== undefined ? e.product_history : null),
            is_test: e.isTest !== undefined ? e.isTest : (e.is_test !== undefined ? e.is_test : null),
            test_end_date: e.testEndDate || e.test_end_date || null,
            test_validation: e.testValidation || e.test_validation || null,
            test_type: e.testType || e.test_type || null,
            creative_id: e.creativeId || e.creative_id || null,
            test_goal: e.testGoal || e.test_goal || null,
            parent_id: e.parentId || e.parent_id || null,
            campaign_name: e.campaignName || e.campaign_name || null,
            ad_name: e.adName || e.ad_name || null,
            is_campaign: e.isCampaign !== undefined ? e.isCampaign : (e.is_campaign !== undefined ? e.is_campaign : null),
        };
    }
    function _rowToDiary(r) {
        return {
            id: r.id, storeId: r.store_id, productId: r.product_id,
            date: r.date, periodStart: r.period_start, periodEnd: r.period_end,
            budget: r.budget, budgetCurrency: r.budget_currency,
            sales: r.sales, revenue: r.revenue, revenueCurrency: r.revenue_currency,
            cpa: r.cpa, cpc: r.cpc, platform: r.platform, notes: r.notes,
            impressions: r.impressions, pageViews: r.page_views,
            addToCart: r.add_to_cart, checkout: r.checkout,
            productHistory: r.product_history, isTest: r.is_test,
            testEndDate: r.test_end_date, testValidation: r.test_validation,
            testType: r.test_type, creativeId: r.creative_id, testGoal: r.test_goal,
            parentId: r.parent_id, campaignName: r.campaign_name, adName: r.ad_name, isCampaign: r.is_campaign,
        };
    }
    function _productToRow(p) {
        return {
            id: p.id, user_id: _user ? _user.id : null,
            store_id: p.storeId || p.store_id || null,
            name: p.name || null,
            price: p.price !== undefined ? p.price : null,
            price_currency: p.priceCurrency || p.price_currency || null,
            cost: p.cost !== undefined ? p.cost : null,
            cost_currency: p.costCurrency || p.cost_currency || null,
            tax: p.tax !== undefined ? p.tax : null,
            variable_costs: p.variableCosts !== undefined ? p.variableCosts : (p.variable_costs !== undefined ? p.variable_costs : null),
            cpa: p.cpa !== undefined ? p.cpa : null,
            cpa_currency: p.cpaCurrency || p.cpa_currency || null,
            status: p.status || null, language: p.language || null,
        };
    }
    function _rowToProduct(r) {
        return {
            id: r.id, storeId: r.store_id, name: r.name,
            price: r.price, priceCurrency: r.price_currency,
            cost: r.cost, costCurrency: r.cost_currency,
            tax: r.tax, variableCosts: r.variable_costs,
            cpa: r.cpa, cpaCurrency: r.cpa_currency,
            status: r.status, language: r.language,
        };
    }
    function _goalToRow(g) {
        return {
            id: g.id, user_id: _user ? _user.id : null,
            store_id: g.storeId || g.store_id || null,
            product_id: g.productId || g.product_id || null,
            daily_target: g.dailyTarget !== undefined ? g.dailyTarget : (g.daily_target !== undefined ? g.daily_target : null),
            currency: g.currency || null,
            start_date: g.startDate || g.start_date || null,
            end_date: g.endDate || g.end_date || null,
            status: g.status || null,
        };
    }
    function _rowToGoal(r) {
        return {
            id: r.id, storeId: r.store_id, productId: r.product_id,
            dailyTarget: r.daily_target, currency: r.currency,
            startDate: r.start_date, endDate: r.end_date, status: r.status,
        };
    }
    function _storeToRow(s) {
        return { id: s.id, user_id: _user ? _user.id : null, name: s.name || null, status: s.status || null };
    }
    function _rowToStore(r) {
        return { id: r.id, name: r.name, status: r.status };
    }

    // ── Login Screen ────────────────────────────────────────────────────
    function _showLoginScreen() {
        const el = document.getElementById('login-screen');
        if (el) el.classList.remove('hidden');
    }

    function _hideLoginScreen() {
        const el = document.getElementById('login-screen');
        if (el) el.classList.add('hidden');
    }

    // ── Profile UI ──────────────────────────────────────────────────────
    function _getInitial(email) {
        if (!email) return '?';
        return email.charAt(0).toUpperCase();
    }

    function _updateProfileUI() {
        const avatarInit = document.getElementById('profile-initial');
        const dropdownInit = document.getElementById('profile-dropdown-initial');
        const dropdownEmail = document.getElementById('profile-dropdown-email');
        const logoutBtn = document.getElementById('btn-supabase-logout');
        const syncBtn = document.getElementById('btn-profile-sync');

        if (_user) {
            const initial = _getInitial(_user.email);
            if (avatarInit) avatarInit.textContent = initial;
            if (dropdownInit) dropdownInit.textContent = initial;
            if (dropdownEmail) dropdownEmail.textContent = _user.email;
            if (logoutBtn) logoutBtn.style.display = '';
            if (syncBtn) syncBtn.style.display = '';
        } else {
            if (avatarInit) avatarInit.textContent = '?';
            if (dropdownInit) dropdownInit.textContent = '?';
            if (dropdownEmail) dropdownEmail.textContent = 'Não conectado';
            if (logoutBtn) logoutBtn.style.display = 'none';
            if (syncBtn) syncBtn.style.display = 'none';
        }
    }

    function _setupProfileDropdown() {
        const avatarBtn = document.getElementById('btn-profile-avatar');
        const dropdown = document.getElementById('profile-dropdown');
        if (!avatarBtn || !dropdown) return;

        avatarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });

        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== avatarBtn) {
                dropdown.classList.remove('open');
            }
        });
    }

    // ── Login form listeners ────────────────────────────────────────────
    function _setupLoginListeners() {
        const form = document.getElementById('login-form');
        const btnLogin = document.getElementById('sb-btn-login');
        const btnSignup = document.getElementById('sb-btn-signup');
        const btnSkip = document.getElementById('sb-btn-skip');
        const errEl = document.getElementById('sb-error');

        function _getCredentials() {
            return {
                email: (document.getElementById('sb-email') || {}).value || '',
                password: (document.getElementById('sb-password') || {}).value || ''
            };
        }

        function _showError(msg) {
            if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; }
        }
        function _clearError() {
            if (errEl) { errEl.textContent = ''; errEl.style.display = 'none'; }
        }

        // Form submit = login
        if (form) {
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                _clearError();
                const { email, password } = _getCredentials();
                if (!email || !password) { _showError('Preencha email e senha.'); return; }

                btnLogin.disabled = true;
                btnLogin.textContent = 'Entrando...';
                try {
                    await module.signIn(email, password);
                } catch (err) {
                    _showError(err.message || 'Erro ao entrar.');
                } finally {
                    btnLogin.disabled = false;
                    btnLogin.textContent = 'Entrar';
                }
            });
        }

        // Signup button
        if (btnSignup) {
            btnSignup.addEventListener('click', async () => {
                _clearError();
                const { email, password } = _getCredentials();
                if (!email || !password) { _showError('Preencha email e senha.'); return; }
                if (password.length < 6) { _showError('Senha precisa ter no mínimo 6 caracteres.'); return; }

                btnSignup.disabled = true;
                btnSignup.textContent = 'Criando...';
                try {
                    await module.signUp(email, password);
                } catch (err) {
                    _showError(err.message || 'Erro ao criar conta.');
                } finally {
                    btnSignup.disabled = false;
                    btnSignup.textContent = 'Criar conta gratuita';
                }
            });
        }

        // Skip = use locally
        if (btnSkip) {
            btnSkip.addEventListener('click', () => {
                _hideLoginScreen();
                localStorage.setItem('etracker_skip_login', '1');
                if (typeof showToast === 'function') showToast('Usando dados locais.', 'info');
            });
        }

        // Profile dropdown: Logout
        const btnLogout = document.getElementById('btn-supabase-logout');
        if (btnLogout) {
            btnLogout.addEventListener('click', async () => {
                document.getElementById('profile-dropdown')?.classList.remove('open');
                await module.signOut();
            });
        }

        // Profile dropdown: Sync now
        const btnSync = document.getElementById('btn-profile-sync');
        if (btnSync) {
            btnSync.addEventListener('click', async () => {
                document.getElementById('profile-dropdown')?.classList.remove('open');
                if (typeof showToast === 'function') showToast('Sincronizando...', 'info');
                await Promise.all([syncStores(), syncProducts(), syncGoals(), syncDiary()]);
                if (typeof showToast === 'function') showToast('Dados sincronizados!', 'success');
            });
        }
    }

    // ── Sync methods ────────────────────────────────────────────────────
    async function syncDiary() {
        const client = _getClient();
        if (!client || !_user) return;
        try {
            const rows = (AppState.allDiary || []).map(_diaryToRow);
            if (!rows.length) return;
            const { error } = await client.from('diary').upsert(rows, { onConflict: 'id' });
            if (error) {
                // If column doesn't exist, retry without it
                if (error.message && error.message.includes('test_goal')) {
                    console.warn('[Sync] test_goal column missing, retrying without it');
                    const cleanRows = rows.map(r => { const { test_goal, ...rest } = r; return rest; });
                    const { error: err2 } = await client.from('diary').upsert(cleanRows, { onConflict: 'id' });
                    if (err2) throw err2;
                } else {
                    throw error;
                }
            }
        } catch (err) { console.error('[Sync] diary:', err); }
    }

    async function syncProducts() {
        const client = _getClient();
        if (!client || !_user) return;
        try {
            const rows = (AppState.allProducts || []).map(_productToRow);
            if (!rows.length) return;
            const { error } = await client.from('products').upsert(rows, { onConflict: 'id' });
            if (error) throw error;
        } catch (err) { console.error('[Sync] products:', err); }
    }

    async function syncGoals() {
        const client = _getClient();
        if (!client || !_user) return;
        try {
            const rows = (AppState.allGoals || []).map(_goalToRow);
            if (!rows.length) return;
            const { error } = await client.from('goals').upsert(rows, { onConflict: 'id' });
            if (error) throw error;
        } catch (err) { console.error('[Sync] goals:', err); }
    }

    async function syncStores() {
        const client = _getClient();
        if (!client || !_user) return;
        try {
            const rows = (AppState.stores || []).map(_storeToRow);
            if (!rows.length) return;
            const { error } = await client.from('stores').upsert(rows, { onConflict: 'id' });
            if (error) throw error;
        } catch (err) { console.error('[Sync] stores:', err); }
    }

    // ── Load all from Supabase ──────────────────────────────────────────
    async function loadAll() {
        const client = _getClient();
        if (!client || !_user) return;

        // Check migration flag: force upload local data to Supabase
        const migrationPending = localStorage.getItem('etracker_migration_pending');
        if (migrationPending) {
            localStorage.removeItem('etracker_migration_pending');
            const hasLocal = (AppState.stores || []).length > 0
                || (AppState.allProducts || []).length > 0
                || (AppState.allDiary || []).length > 0;
            if (hasLocal) {
                if (typeof showToast === 'function') showToast('Enviando dados importados para a nuvem...', 'info');
                // Delete old remote data first
                try {
                    const uid = _user.id;
                    await Promise.all([
                        client.from('stores').delete().eq('user_id', uid),
                        client.from('products').delete().eq('user_id', uid),
                        client.from('goals').delete().eq('user_id', uid),
                        client.from('diary').delete().eq('user_id', uid),
                    ]);
                } catch (e) { console.warn('[Sync] cleanup:', e); }
                await Promise.all([syncStores(), syncProducts(), syncGoals(), syncDiary()]);
                if (typeof showToast === 'function') showToast('Dados enviados para a nuvem!', 'success');
            }
            return;
        }

        try {
            const uid = _user.id;
            const [storesRes, productsRes, goalsRes, diaryRes] = await Promise.all([
                client.from('stores').select('*').eq('user_id', uid),
                client.from('products').select('*').eq('user_id', uid),
                client.from('goals').select('*').eq('user_id', uid),
                client.from('diary').select('*').eq('user_id', uid),
            ]);

            const remoteStores = storesRes.data || [];
            const remoteProducts = productsRes.data || [];
            const remoteGoals = goalsRes.data || [];
            const remoteDiary = diaryRes.data || [];

            const isFirstTime = remoteStores.length === 0 && remoteProducts.length === 0
                && remoteGoals.length === 0 && remoteDiary.length === 0;

            if (isFirstTime) {
                const hasLocal = (AppState.stores || []).length > 0
                    || (AppState.allProducts || []).length > 0
                    || (AppState.allGoals || []).length > 0
                    || (AppState.allDiary || []).length > 0;
                if (hasLocal) {
                    if (typeof showToast === 'function') showToast('Enviando dados locais para a nuvem...', 'info');
                    await Promise.all([syncStores(), syncProducts(), syncGoals(), syncDiary()]);
                    if (typeof showToast === 'function') showToast('Dados enviados!', 'success');
                }
                return;
            }

            // Merge strategy: if local has more/different diary entries, push local to cloud
            // instead of overwriting. This prevents data loss when sync failed previously.
            const localDiaryCount = (AppState.allDiary || []).length;
            const remoteDiaryCount = remoteDiary.length;
            const localHasTestData = (AppState.allDiary || []).some(d => d.isTest && d.testGoal);
            const remoteHasTestData = remoteDiary.some(d => d.is_test && d.test_goal);

            const localIsNewer = localDiaryCount > remoteDiaryCount || (localHasTestData && !remoteHasTestData);

            if (localIsNewer) {
                // Local data is richer — push to cloud
                console.log('[Sync] Local data is newer/richer, uploading to cloud');
                await Promise.all([syncStores(), syncProducts(), syncGoals(), syncDiary()]);
                if (typeof showToast === 'function') showToast('Dados locais enviados para a nuvem.', 'success');
            } else {
                // Remote data is authoritative — use it
                if (remoteStores.length > 0) {
                    AppState.stores = remoteStores.map(_rowToStore);
                    if (typeof LocalStore !== 'undefined') LocalStore.save('stores', AppState.stores);
                }
                if (remoteProducts.length > 0) {
                    AppState.allProducts = remoteProducts.map(_rowToProduct);
                    if (typeof LocalStore !== 'undefined') LocalStore.save('products', AppState.allProducts);
                }
                if (remoteGoals.length > 0) {
                    AppState.allGoals = remoteGoals.map(_rowToGoal);
                    if (typeof LocalStore !== 'undefined') LocalStore.save('goals', AppState.allGoals);
                }
                if (remoteDiary.length > 0) {
                    AppState.allDiary = remoteDiary.map(_rowToDiary);
                    if (typeof LocalStore !== 'undefined') LocalStore.save('diary', AppState.allDiary);
                }
                if (typeof showToast === 'function') showToast('Dados sincronizados da nuvem.', 'success');
            }

            if (typeof ensureStoreSetup === 'function') ensureStoreSetup();
            if (typeof filterDataByStore === 'function') filterDataByStore();
            if (typeof renderStoreSelector === 'function') renderStoreSelector();
            if (typeof populateProductDropdowns === 'function') populateProductDropdowns();
            if (typeof EventBus !== 'undefined') EventBus.emit('dataLoaded');
        } catch (err) {
            console.error('[Sync] loadAll error:', err);
            if (typeof showToast === 'function') showToast('Erro ao carregar dados da nuvem.', 'error');
        }
    }

    // ── Public API ──────────────────────────────────────────────────────
    const module = {
        get isLoggedIn() { return !!_user; },
        get client() { return _getClient(); },

        async init() {
            const client = _getClient();
            if (!client) {
                console.warn('[Sync] Supabase SDK not loaded');
                // No SDK — just hide login screen if skipped before
                if (localStorage.getItem('etracker_skip_login')) _hideLoginScreen();
                return;
            }

            // Restore session
            try {
                const { data: { session } } = await client.auth.getSession();
                if (session && session.user) {
                    _user = session.user;
                }
            } catch (err) {
                console.warn('[Sync] Session restore failed:', err);
            }

            // Auth state listener
            client.auth.onAuthStateChange((_event, session) => {
                _user = session ? session.user : null;
                _updateProfileUI();
            });

            // Setup EventBus sync
            if (typeof EventBus !== 'undefined') {
                EventBus.on('diaryChanged', () => _debounce('diary', syncDiary, 1500));
                EventBus.on('productsChanged', () => _debounce('products', syncProducts, 1500));
                EventBus.on('goalsChanged', () => _debounce('goals', syncGoals, 1500));
            }

            // Setup UI
            _setupProfileDropdown();
            _setupLoginListeners();
            _updateProfileUI();

            if (_user) {
                // Already logged in — hide login, load data
                _hideLoginScreen();
                await loadAll();
            } else if (localStorage.getItem('etracker_skip_login')) {
                // Previously skipped login
                _hideLoginScreen();
            } else {
                // Show login screen
                _showLoginScreen();
            }
        },

        async signIn(email, password) {
            const client = _getClient();
            if (!client) throw new Error('Supabase não disponível.');
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            if (error) throw error;
            _user = data.user;
            _updateProfileUI();
            _hideLoginScreen();
            if (typeof showToast === 'function') showToast('Bem-vindo, ' + _getInitial(email) + '!', 'success');
            await loadAll();
        },

        async signUp(email, password) {
            throw new Error('Registro desabilitado. Acesso restrito.');
            const client = _getClient();
            if (!client) throw new Error('Supabase não disponível.');
            const { data, error } = await client.auth.signUp({ email, password });
            if (error) throw error;
            _user = data.user;
            _updateProfileUI();
            if (_user) {
                _hideLoginScreen();
                if (typeof showToast === 'function') showToast('Conta criada!', 'success');
                await loadAll();
            } else {
                if (typeof showToast === 'function') showToast('Verifique seu email para confirmar a conta.', 'info');
            }
        },

        async signOut() {
            const client = _getClient();
            if (!client) return;
            await client.auth.signOut();
            _user = null;
            _updateProfileUI();
            localStorage.removeItem('etracker_skip_login');
            _showLoginScreen();
            if (typeof showToast === 'function') showToast('Saiu da conta.', 'info');
        },

        loadAll,
        syncDiary: () => _debounce('diary', syncDiary, 1500),
        syncProducts: () => _debounce('products', syncProducts, 1500),
        syncGoals: () => _debounce('goals', syncGoals, 1500),
        syncStores: () => _debounce('stores', syncStores, 1500),
    };

    return module;
})();
