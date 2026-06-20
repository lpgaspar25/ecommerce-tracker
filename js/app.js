/* ===========================
   App.js — Core initialization, tab navigation, event bus, utilities
   Multi-store support
   =========================== */

// ---- Storage Manager: frees space when localStorage is full ----
// Purges only REGENERABLE caches (rebuilt from network/derived data) in priority order.
const StorageManager = {
    // Keys safe to drop — they get rebuilt on demand. Heaviest / most-disposable first.
    _purgeable: [
        'etracker_shopify_orders_day_cache',
        'etracker_shopify_orders_cache',
        'etracker_creative_metrics',
        'etracker_ai_generations',
        'etracker_adl_uploads',
        'etracker_usage_data',
        'etracker_recent_edits',
        'etracker_funnel_snapshots',
        'etracker_importer_sessions',
    ],
    _sizeOf(key) {
        try { const v = localStorage.getItem(key); return v ? v.length : 0; } catch { return 0; }
    },
    usageBytes() {
        let total = 0;
        try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); total += k.length + this._sizeOf(k); } } catch {}
        return total * 2; // UTF-16 ~2 bytes/char
    },
    // Free space by removing purgeable caches + any *_backup* keys. Returns chars freed.
    reclaim() {
        let freed = 0;
        // 1) Old backup snapshots (any key containing "backup")
        try {
            const backups = [];
            for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && /backup/i.test(k)) backups.push(k); }
            backups.forEach(k => { freed += this._sizeOf(k); try { localStorage.removeItem(k); } catch {} });
        } catch {}
        // 2) Regenerable caches
        this._purgeable.forEach(k => {
            const sz = this._sizeOf(k);
            if (sz > 0) { freed += sz; try { localStorage.removeItem(k); } catch {} }
        });
        return freed;
    },
    // Run fn (a localStorage write). On QuotaExceeded, reclaim space and retry once.
    withReclaim(fn, label) {
        try { fn(); return true; }
        catch (e) {
            const freed = this.reclaim();
            try {
                fn();
                if (freed > 0 && typeof showToast === 'function') {
                    showToast(`Espaço liberado (${Math.round(freed/1024)} KB de cache) — salvo com sucesso.`, 'success');
                }
                return true;
            } catch (e2) {
                console.error('[StorageManager] still full after reclaim', label || '', e2);
                return false;
            }
        }
    },
};
window.StorageManager = StorageManager;

// ---- Event Bus ----
const EventBus = {
    _listeners: {},
    on(event, cb) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(cb);
    },
    off(event, cb) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(fn => fn !== cb);
    },
    emit(event, data) {
        if (!this._listeners[event]) return;
        this._listeners[event].forEach(cb => cb(data));
    }
};

// ---- State ----
const AppState = {
    // Store management
    stores: [],
    currentStoreId: localStorage.getItem('currentStoreId') || '',

    // All data (unfiltered)
    allProducts: [],
    allGoals: [],
    allDiary: [],
    allCreatives: [],
    allCreativeMetrics: [],
    allProjects: [],

    // Filtered by current store (these are used by all modules)
    products: [],
    goals: [],
    diary: [],
    creatives: [],
    creativeMetrics: [],
    projects: [],

    exchangeRate: null,
    exchangeRateOverride: null,
    exchangeRates: null,        // { BRL: 5.20, GBP: 0.79, EUR: 0.92 }
    exchangeRatesOverride: null, // manual overrides per currency
    sheetsConnected: false,
    theme: localStorage.getItem('theme') || 'dark',
    config: {
        spreadsheetId: localStorage.getItem('spreadsheetId') || '',
        clientId: localStorage.getItem('clientId') || '',
        apiKey: localStorage.getItem('apiKey') || '',
        googleAdsSyncUrl: localStorage.getItem('googleAdsSyncUrl') || '',
        googleAdsSyncToken: localStorage.getItem('googleAdsSyncToken') || ''
    }
};

const STORE_ALL_ID = '__ALL__';
const MAX_STORES = 5;

// ---- Store Management ----
function getCurrentStoreId() {
    return AppState.currentStoreId;
}

function isAllStoresSelected() {
    return AppState.currentStoreId === STORE_ALL_ID;
}

function getCurrentStoreName() {
    if (isAllStoresSelected()) return 'Todas as lojas';
    const store = AppState.stores.find(s => s.id === AppState.currentStoreId);
    return store ? store.name : '';
}

function getStoreNameById(storeId) {
    const store = AppState.stores.find(s => s.id === storeId);
    return store ? store.name : '';
}

function ensureStoreSetup() {
    AppState.stores = Array.isArray(AppState.stores) ? AppState.stores.filter(s => s && s.id && s.name) : [];

    if (AppState.stores.length === 0) {
        AppState.stores = [{ id: generateId('store'), name: 'Minha Loja', status: 'ativo' }];
    }

    if (AppState.stores.length > MAX_STORES) {
        AppState.stores = AppState.stores.slice(0, MAX_STORES);
    }

    const validIds = new Set(AppState.stores.map(s => s.id));
    const isValidCurrent = AppState.currentStoreId === STORE_ALL_ID || validIds.has(AppState.currentStoreId);
    if (!isValidCurrent) {
        AppState.currentStoreId = AppState.stores[0].id;
    }

    localStorage.setItem('etracker_stores', JSON.stringify(AppState.stores));
    localStorage.setItem('currentStoreId', AppState.currentStoreId);
}

function normalizeAllDataStoreIds() {
    const fallbackStoreId = AppState.stores[0]?.id || '';
    if (!fallbackStoreId) return;

    // Defense in depth: apply tombstones to every load path so deleted products never come back
    AppState.allProducts = (AppState.allProducts || []).filter(p => {
        if (typeof ProductsModule !== 'undefined' && ProductsModule.isTombstoned) {
            return !ProductsModule.isTombstoned(p);
        }
        return true;
    });
    AppState.allProducts = AppState.allProducts.map(item => ({
        ...item,
        storeId: item.storeId || fallbackStoreId,
        language: item.language || item.country || 'Ingles'
    }));
    AppState.allGoals = (AppState.allGoals || []).map(item => ({
        ...item,
        storeId: item.storeId || fallbackStoreId
    }));
    AppState.allDiary = (AppState.allDiary || []).map(item => ({
        ...item,
        storeId: item.storeId || fallbackStoreId
    }));
}

function filterDataByStore() {
    const storeId = AppState.currentStoreId;
    if (!storeId) {
        AppState.products = [];
        AppState.goals = [];
        AppState.diary = [];
        return;
    }

    if (storeId === STORE_ALL_ID) {
        AppState.products = [...AppState.allProducts];
        AppState.goals = [...AppState.allGoals];
        AppState.diary = [...AppState.allDiary];
        AppState.creatives = [...(AppState.allCreatives || [])];
        AppState.creativeMetrics = [...(AppState.allCreativeMetrics || [])];
        AppState.projects = [...(AppState.allProjects || [])];
    } else {
        AppState.products = AppState.allProducts.filter(p => p.storeId === storeId);
        AppState.goals = AppState.allGoals.filter(g => g.storeId === storeId);
        AppState.diary = AppState.allDiary.filter(d => d.storeId === storeId);
        AppState.creatives = (AppState.allCreatives || []).filter(c => c.storeId === storeId);
        AppState.creativeMetrics = (AppState.allCreativeMetrics || []).filter(m => m.storeId === storeId);
        AppState.projects = (AppState.allProjects || []).filter(p => p.storeId === storeId);
    }
}

function switchStore(storeId) {
    if (storeId !== STORE_ALL_ID && !AppState.stores.some(s => s.id === storeId)) {
        storeId = AppState.stores[0]?.id || '';
    }
    AppState.currentStoreId = storeId;
    localStorage.setItem('currentStoreId', storeId);
    filterDataByStore();
    populateProductDropdowns();
    renderStoreSelector();
    EventBus.emit('storeChanged', storeId);
    EventBus.emit('dataLoaded');
}

function addStore(name) {
    if (AppState.stores.length >= MAX_STORES) {
        showToast(`Limite atingido: máximo de ${MAX_STORES} lojas`, 'error');
        return null;
    }

    const store = { id: generateId('store'), name, status: 'ativo' };
    AppState.stores.push(store);
    localStorage.setItem('etracker_stores', JSON.stringify(AppState.stores));
    if (AppState.sheetsConnected && SheetsAPI.TABS.STORES) {
        SheetsAPI.appendRow(SheetsAPI.TABS.STORES, SheetsAPI.storeToRow(store));
    }
    renderStoreSelector();
    return store;
}

function deleteStore(id) {
    if (AppState.stores.length <= 1) {
        showToast('Você precisa manter pelo menos 1 loja.', 'error');
        return;
    }

    const idx = AppState.stores.findIndex(s => s.id === id);
    if (idx >= 0) {
        AppState.stores.splice(idx, 1);
        localStorage.setItem('etracker_stores', JSON.stringify(AppState.stores));
        if (AppState.sheetsConnected && SheetsAPI.TABS.STORES) {
            SheetsAPI.deleteRowById(SheetsAPI.TABS.STORES, id);
        }
        if (AppState.currentStoreId === id) {
            const firstStore = AppState.stores.find(s => s.status === 'ativo') || AppState.stores[0];
            switchStore(firstStore ? firstStore.id : '');
        }
        renderStoreSelector();
    }
}

function renameStore(id, newName) {
    const store = AppState.stores.find(s => s.id === id);
    if (!store || !newName.trim()) return;
    store.name = newName.trim();
    localStorage.setItem('etracker_stores', JSON.stringify(AppState.stores));
    if (AppState.sheetsConnected && SheetsAPI.TABS.STORES) {
        SheetsAPI.updateRowById(SheetsAPI.TABS.STORES, id, SheetsAPI.storeToRow(store));
    }
    renderStoreSelector();
}

function toggleStoreStatus(id) {
    const store = AppState.stores.find(s => s.id === id);
    if (!store) return;
    const activeStores = AppState.stores.filter(s => s.status === 'ativo');
    if (store.status === 'ativo' && activeStores.length <= 1) {
        showToast('Pelo menos 1 loja precisa estar ativa.', 'error');
        return;
    }
    store.status = store.status === 'ativo' ? 'desativado' : 'ativo';
    localStorage.setItem('etracker_stores', JSON.stringify(AppState.stores));
    if (AppState.sheetsConnected && SheetsAPI.TABS.STORES) {
        SheetsAPI.updateRowById(SheetsAPI.TABS.STORES, id, SheetsAPI.storeToRow(store));
    }
    if (store.status === 'desativado' && AppState.currentStoreId === id) {
        const firstActive = AppState.stores.find(s => s.status === 'ativo');
        if (firstActive) switchStore(firstActive.id);
    }
    renderStoreSelector();
}

function renderStoreSelector() {
    const select = document.getElementById('store-selector');
    if (!select) return;

    ensureStoreSetup();

    const currentVal = AppState.currentStoreId;
    select.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = STORE_ALL_ID;
    allOpt.textContent = 'TODAS';
    select.appendChild(allOpt);

    AppState.stores.forEach(store => {
        const opt = document.createElement('option');
        opt.value = store.id;
        if (store.status === 'desativado') {
            opt.textContent = store.name + ' (desativada)';
            opt.style.color = '#8a8a8a';
        } else {
            opt.textContent = store.name;
        }
        select.appendChild(opt);
    });

    select.value = currentVal;
}

function initStoreManagement() {
    const select = document.getElementById('store-selector');
    if (select) {
        select.addEventListener('change', (e) => {
            switchStore(e.target.value);
        });
    }

    // Store management modal
    const btnManage = document.getElementById('btn-manage-stores');
    if (btnManage) {
        btnManage.addEventListener('click', () => {
            renderStoreList();
            openModal('store-modal');
        });
    }

    // Add store form
    const addBtn = document.getElementById('btn-add-store');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const input = document.getElementById('new-store-name');
            const name = input.value.trim();
            if (name) {
                const store = addStore(name);
                if (!store) return;
                input.value = '';
                renderStoreList();
                // Auto-select new store
                switchStore(store.id);
                showToast(`Loja "${name}" criada!`, 'success');
            }
        });
    }

    // Enter key on store name input
    const input = document.getElementById('new-store-name');
    if (input) {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('btn-add-store').click();
            }
        });
    }
}

function renderStoreList() {
    const container = document.getElementById('store-list');
    if (!container) return;

    if (AppState.stores.length === 0) {
        container.innerHTML = '<p class="text-muted">Nenhuma loja cadastrada.</p>';
        return;
    }

    const isActive = (s) => s.status !== 'desativado';

    container.innerHTML = AppState.stores.map(store => {
        const isCurrent = store.id === AppState.currentStoreId;
        const active = isActive(store);
        const statusBadge = active
            ? '<span class="store-status-badge status-ativo">Ativa</span>'
            : '<span class="store-status-badge status-desativado">Desativada</span>';
        const toggleIcon = active ? '<i data-lucide="pause" style="width:14px;height:14px;vertical-align:-2px"></i>' : '▶';
        const toggleTitle = active ? 'Desativar' : 'Ativar';

        return `<div class="store-list-item ${isCurrent ? 'active' : ''} ${!active ? 'disabled' : ''}">
            <div class="store-list-main">
                <input type="text" class="store-name-input" value="${escapeHtml(store.name)}" data-store-id="${store.id}">
                ${statusBadge}
            </div>
            <div class="store-list-actions">
                ${!isCurrent && active ? `<button class="btn btn-secondary btn-sm btn-select-store" data-store-id="${store.id}" title="Selecionar">Usar</button>` : ''}
                <button class="btn-icon btn-toggle-store" data-store-id="${store.id}" title="${toggleTitle}">${toggleIcon}</button>
                <button class="btn-icon btn-delete-store" data-store-id="${store.id}" title="Excluir"><i data-lucide="trash-2" style="width:14px;height:14px;vertical-align:-2px"></i>️</button>
            </div>
        </div>`;
    }).join('');

    // Rename on input (debounced)
    let renameTimers = {};
    container.querySelectorAll('.store-name-input').forEach(input => {
        input.addEventListener('input', () => {
            const id = input.dataset.storeId;
            clearTimeout(renameTimers[id]);
            renameTimers[id] = setTimeout(() => {
                renameStore(id, input.value);
            }, 500);
        });
    });

    container.querySelectorAll('.btn-select-store').forEach(btn => {
        btn.addEventListener('click', () => {
            switchStore(btn.dataset.storeId);
            renderStoreList();
        });
    });

    container.querySelectorAll('.btn-toggle-store').forEach(btn => {
        btn.addEventListener('click', () => {
            toggleStoreStatus(btn.dataset.storeId);
            renderStoreList();
        });
    });

    container.querySelectorAll('.btn-delete-store').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.storeId;
            const store = AppState.stores.find(s => s.id === id);
            if (!store) return;
            if (!confirm(`Excluir loja "${store.name}"? Os dados associados permanecerão salvos.`)) return;
            deleteStore(id);
            renderStoreList();
        });
    });
}

// ---- Tab Navigation ----
function initTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.dataset.tab;

            tabBtns.forEach(b => b.classList.remove('active'));
            tabPanels.forEach(p => p.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(`tab-${targetTab}`).classList.add('active');

            EventBus.emit('tabChanged', targetTab);
        });
    });

    // Profile dropdown: Mineração entry (tab btn is hidden in the nav)
    const btnProfileMineracao = document.getElementById('btn-profile-mineracao');
    if (btnProfileMineracao) {
        btnProfileMineracao.addEventListener('click', () => {
            document.getElementById('profile-dropdown')?.classList.remove('open');
            const miningTabBtn = document.querySelector('.tab-btn[data-tab="mineracao"]');
            if (miningTabBtn) miningTabBtn.click();
        });
    }
}

// ---- Theme ----
function updateThemeToggleButton(theme) {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;

    if (theme === 'light') {
        btn.innerHTML = '<i data-lucide="sun" style="width:16px;height:16px"></i>';
        btn.title = 'Tema claro (clique para noturno)';
        btn.setAttribute('aria-label', 'Tema claro ativo.');
    } else {
        btn.innerHTML = '<i data-lucide="moon" style="width:16px;height:16px"></i>';
        btn.title = 'Tema noturno (clique para claro)';
        btn.setAttribute('aria-label', 'Tema noturno ativo.');
    }
}

function applyTheme(theme, options = {}) {
    const normalized = theme === 'light' ? 'light' : 'dark';
    AppState.theme = normalized;
    document.documentElement.setAttribute('data-theme', normalized);
    if (document.body) {
        document.body.setAttribute('data-theme', normalized);
    }

    if (options.persist !== false) {
        localStorage.setItem('theme', normalized);
    }

    updateThemeToggleButton(normalized);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const selector = document.getElementById('theme-selector');
    if (selector && selector.value !== normalized) {
        selector.value = normalized;
    }

    EventBus.emit('themeChanged', normalized);
}

function initTheme() {
    const initial = AppState.theme === 'light' ? 'light' : 'dark';
    applyTheme(initial, { persist: false });

    const btn = document.getElementById('btn-theme-toggle');
    if (btn) {
        btn.addEventListener('click', () => {
            const targetTheme = AppState.theme === 'light' ? 'dark' : 'light';
            applyTheme(targetTheme, { persist: true });
        });
    }

    const selector = document.getElementById('theme-selector');
    if (selector) {
        selector.value = initial;
        selector.addEventListener('change', (e) => {
            const targetTheme = e.target.value === 'light' ? 'light' : 'dark';
            applyTheme(targetTheme, { persist: true });
        });
    }
}

// ---- Privacy Mode (hide sensitive names for screen recordings) ----
const PRIVACY_KEY = 'etracker_privacy_mode';

function applyPrivacyMode(enabled, options = {}) {
    document.body.classList.toggle('privacy-mode', !!enabled);
    if (options.persist !== false) {
        try { localStorage.setItem(PRIVACY_KEY, enabled ? '1' : '0'); } catch {}
    }
    // Create / remove privacy banner as DOM so it can use Lucide icons
    let banner = document.getElementById('privacy-banner');
    if (enabled) {
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'privacy-banner';
            banner.className = 'privacy-banner';
            banner.innerHTML = '<i data-lucide="lock" style="width:11px;height:11px;vertical-align:-1px"></i> Modo privacidade ativo';
            document.body.appendChild(banner);
        }
    } else if (banner) {
        banner.remove();
    }
    const btn = document.getElementById('btn-privacy-toggle');
    if (btn) {
        btn.classList.toggle('active', !!enabled);
        btn.classList.toggle('btn-primary', !!enabled);
        btn.classList.toggle('btn-secondary', !enabled);
        btn.innerHTML = enabled
            ? '<i data-lucide="eye-off" style="width:14px;height:14px"></i>'
            : '<i data-lucide="eye" style="width:14px;height:14px"></i>';
        btn.title = enabled
            ? 'Modo privacidade ATIVO — nomes ocultos. Clique para mostrar.'
            : 'Modo privacidade (ocultar nomes de loja, produtos e campanhas)';
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function initPrivacyMode() {
    let enabled = false;
    try { enabled = localStorage.getItem(PRIVACY_KEY) === '1'; } catch {}
    applyPrivacyMode(enabled, { persist: false });

    const btn = document.getElementById('btn-privacy-toggle');
    if (btn) {
        btn.addEventListener('click', () => {
            const next = !document.body.classList.contains('privacy-mode');
            applyPrivacyMode(next);
        });
    }
}

document.addEventListener('DOMContentLoaded', initPrivacyMode);

// ---- Notifications (deadlines) ----
const NotificationsModule = {
    _isOpen: false,

    init() {
        const wrap = document.getElementById('notifications-wrap');
        const btn = document.getElementById('btn-notifications');
        const panel = document.getElementById('notifications-panel');
        const list = document.getElementById('notifications-list');
        if (!wrap || !btn || !panel || !list) return;

        btn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            this.toggle();
        });

        list.addEventListener('click', (event) => {
            const itemEl = event.target.closest('.notification-item');
            if (!itemEl) return;
            const tab = itemEl.getAttribute('data-tab');
            if (tab) {
                const tabBtn = document.querySelector(`.tab-btn[data-tab="${tab}"]`);
                if (tabBtn) tabBtn.click();
            }
            this.close();
        });

        document.addEventListener('click', (event) => {
            if (!this._isOpen) return;
            if (!wrap.contains(event.target)) this.close();
        });

        EventBus.on('dataLoaded', () => this.refresh());
        EventBus.on('goalsChanged', () => this.refresh());
        EventBus.on('diaryChanged', () => this.refresh());
        EventBus.on('storeChanged', () => this.refresh());
        EventBus.on('pipelineChanged', () => this.refresh());

        this.refresh();
    },

    toggle() {
        const panel = document.getElementById('notifications-panel');
        if (!panel) return;
        this._isOpen = !this._isOpen;
        panel.classList.toggle('open', this._isOpen);
    },

    close() {
        const panel = document.getElementById('notifications-panel');
        if (!panel) return;
        this._isOpen = false;
        panel.classList.remove('open');
    },

    _daysDiffFromToday(dateStr) {
        if (!dateStr) return 0;
        const today = new Date(todayISO() + 'T00:00:00');
        const target = new Date(String(dateStr) + 'T00:00:00');
        return Math.round((target - today) / (1000 * 60 * 60 * 24));
    },

    _dueLabel(diffDays) {
        if (diffDays < 0) {
            const d = Math.abs(diffDays);
            return d === 1 ? 'Atrasado 1 dia' : `Atrasado ${d} dias`;
        }
        if (diffDays === 0) return 'Vence hoje';
        if (diffDays === 1) return 'Vence amanhã';
        return `Vence em ${diffDays} dias`;
    },

    _toneFromDiff(diffDays) {
        if (diffDays < 0) return 'overdue';
        if (diffDays === 0) return 'today';
        return 'upcoming';
    },

    _getPipelineCards() {
        if (typeof PipelineModule !== 'undefined' && Array.isArray(PipelineModule.cards)) {
            return PipelineModule.cards;
        }
        try {
            const raw = JSON.parse(localStorage.getItem('pipeline_cards') || '{}');
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.cards)) return raw.cards;
        } catch {
            return [];
        }
        return [];
    },

    _buildItems() {
        const items = [];
        const showStore = isAllStoresSelected();
        const selectedStoreId = AppState.currentStoreId;

        (AppState.goals || []).forEach(goal => {
            if (!goal || goal.status !== 'ativa' || !goal.endDate) return;
            const diffDays = this._daysDiffFromToday(goal.endDate);
            const storeName = showStore ? getStoreNameById(goal.storeId) : '';
            const sub = [`Final: ${formatDate(goal.endDate)}`];
            if (storeName) sub.push(`Loja: ${storeName}`);
            items.push({
                id: `goal_${goal.id}`,
                tab: 'goals',
                date: goal.endDate,
                diffDays,
                tone: this._toneFromDiff(diffDays),
                title: `Meta: ${getProductName(goal.productId)}`,
                subtitle: sub.join(' • ')
            });
        });

        (AppState.diary || []).forEach(entry => {
            if (!entry || !entry.isTest || !entry.testEndDate) return;
            const validation = String(entry.testValidation || '').trim().toLowerCase();
            if (validation === 'validado') return;

            const diffDays = this._daysDiffFromToday(entry.testEndDate);
            const storeName = showStore ? getStoreNameById(entry.storeId) : '';
            const validationLabel = validation === 'nao_validado' ? 'Não validado' : 'Pendente';
            const sub = [`Final: ${formatDate(entry.testEndDate)}`, `Status: ${validationLabel}`];
            if (storeName) sub.push(`Loja: ${storeName}`);

            items.push({
                id: `test_${entry.id}`,
                tab: 'diary',
                date: entry.testEndDate,
                diffDays,
                tone: this._toneFromDiff(diffDays),
                title: `Teste: ${getProductName(entry.productId)}`,
                subtitle: sub.join(' • ')
            });
        });

        const pipelineStageLabels = {
            ideia: 'Ideia',
            validacao: 'Validação',
            pesquisa: 'Pesquisa',
            angulos: 'Ângulos',
            criativos: 'Criativos',
            pagina: 'Página',
            teste_ads: 'Teste Ads',
            otimizacao: 'Otimização',
            escala: 'Escala',
            kill: 'Kill'
        };

        this._getPipelineCards().forEach(card => {
            if (!card || !card.endDate) return;
            if (String(card.columnId || '').trim() === 'kill') return;
            if (!showStore && selectedStoreId && selectedStoreId !== STORE_ALL_ID) {
                const cardStoreId = String(card.storeId || '').trim();
                if (cardStoreId && cardStoreId !== selectedStoreId) return;
            }

            const diffDays = this._daysDiffFromToday(card.endDate);
            const stageLabel = pipelineStageLabels[String(card.columnId || '').trim()] || 'Pipeline';
            const storeName = showStore ? getStoreNameById(card.storeId) : '';
            const subtitleParts = [`Etapa: ${stageLabel}`, `Final: ${formatDate(card.endDate)}`];
            if (storeName) subtitleParts.push(`Loja: ${storeName}`);

            items.push({
                id: `pipeline_${card.id}`,
                tab: 'pipeline',
                date: card.endDate,
                diffDays,
                tone: this._toneFromDiff(diffDays),
                title: `Pipeline: ${String(card.title || 'Card sem nome')}`,
                subtitle: subtitleParts.join(' • ')
            });
        });

        return items.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.title.localeCompare(b.title);
        });
    },

    refresh() {
        const countEl = document.getElementById('notifications-count');
        const summaryEl = document.getElementById('notifications-summary');
        const listEl = document.getElementById('notifications-list');
        if (!countEl || !summaryEl || !listEl) return;

        const items = this._buildItems();
        const count = items.length;

        if (count > 0) {
            countEl.textContent = String(count > 99 ? '99+' : count);
            countEl.style.display = 'inline-block';
        } else {
            countEl.style.display = 'none';
        }

        summaryEl.textContent = count === 1 ? '1 item' : `${count} itens`;

        if (count === 0) {
            listEl.innerHTML = '<div class="notifications-empty">Nenhum prazo pendente no momento.</div>';
            return;
        }

        listEl.innerHTML = items.map(item => `
            <button type="button" class="notification-item ${item.tone}" data-tab="${item.tab}">
                <div class="notification-item-title">${escapeHtml(item.title)}</div>
                <div class="notification-item-meta">
                    <span class="notification-item-sub">${escapeHtml(item.subtitle)}</span>
                    <span class="notification-item-due">${this._dueLabel(item.diffDays)}</span>
                </div>
            </button>
        `).join('');
    }
};

// ---- Modal Helpers ----
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('hidden');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('hidden');
}

function initModals() {
    document.querySelectorAll('.modal').forEach(modal => {
        const overlay = modal.querySelector('.modal-overlay');
        const closeBtn = modal.querySelector('.btn-close');

        if (overlay) {
            overlay.addEventListener('click', () => modal.classList.add('hidden'));
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
        }
    });

    document.querySelectorAll('[id$="-cancel"]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal) modal.classList.add('hidden');
        });
    });
}

// ---- Toast Notifications ----
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // Support embedded Lucide icon markup without allowing scripts
    const safe = String(message || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    toast.innerHTML = safe;
    container.appendChild(toast);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        toast.style.transition = '0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ---- Utility Functions ----
function generateId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function escapeHtml(raw) {
    return String(raw || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Real brand SVG icons (small, inline, 14px) so badges show the official logo
const BRAND_ICONS = {
    facebook: '<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#1877F2" d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    google: '<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.16c-.27 1.4-1.07 2.59-2.27 3.39v2.77h3.66c2.14-1.97 3.94-4.89 3.94-8.4z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.66-2.77c-1.02.69-2.32 1.1-3.94 1.1-3.03 0-5.6-2.05-6.52-4.82H1.83v3.03C3.81 21.45 7.6 24 12 24z"/><path fill="#FBBC05" d="M5.48 14.6c-.27-.69-.42-1.42-.42-2.16 0-.74.15-1.47.42-2.16V7.25H1.83C1.06 8.6.62 10.21.62 12c0 1.79.44 3.4 1.21 4.75l3.65-3.15z"/><path fill="#EA4335" d="M12 5.02c1.77 0 3.34.61 4.59 1.79l3.27-3.21C17.96 1.79 15.24.62 12 .62 7.6.62 3.81 3.17 1.83 6.79l3.65 3.03C6.4 7.07 8.97 5.02 12 5.02z"/></svg>',
    tiktok: '<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#25F4EE" d="M16.86 6.69V5.5c-.55-.08-1.11-.13-1.66-.16v1.27c.55.04 1.1.08 1.66.08z"/><path fill="#FE2C55" d="M14.2 9.4v8.34a3.62 3.62 0 0 1-5.85 2.85 3.62 3.62 0 0 0 6.13-2.6V9.65c-.1-.05-.2-.1-.28-.25z"/><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.3 0 .59.05.88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.81 20.4a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.85-.4z"/></svg>',
    instagram: '<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="ig-grad" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" stop-color="#feda75"/><stop offset="25%" stop-color="#fa7e1e"/><stop offset="50%" stop-color="#d62976"/><stop offset="75%" stop-color="#962fbf"/><stop offset="100%" stop-color="#4f5bd5"/></linearGradient></defs><path fill="url(#ig-grad)" d="M12 2.16c3.2 0 3.58.01 4.85.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.43.36 1.07.41 2.23.06 1.27.07 1.65.07 4.85s-.01 3.58-.07 4.85c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.43.16-1.07.36-2.23.41-1.27.06-1.65.07-4.85.07s-3.58-.01-4.85-.07c-1.17-.05-1.8-.25-2.23-.41a3.71 3.71 0 0 1-1.38-.9 3.71 3.71 0 0 1-.9-1.38c-.16-.43-.36-1.07-.41-2.23-.06-1.27-.07-1.65-.07-4.85s.01-3.58.07-4.85c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38a3.71 3.71 0 0 1 1.38-.9c.43-.16 1.07-.36 2.23-.41C8.42 2.17 8.8 2.16 12 2.16M12 0C8.74 0 8.33.01 7.05.07 5.78.13 4.9.33 4.14.63a5.87 5.87 0 0 0-2.13 1.38A5.87 5.87 0 0 0 .63 4.14C.33 4.9.13 5.78.07 7.05.01 8.33 0 8.74 0 12s.01 3.67.07 4.95c.06 1.28.26 2.15.56 2.91.31.79.74 1.46 1.38 2.1.64.64 1.31 1.07 2.1 1.38.76.3 1.64.5 2.91.56C8.33 23.99 8.74 24 12 24s3.67-.01 4.95-.07c1.28-.06 2.15-.26 2.91-.56a5.87 5.87 0 0 0 2.1-1.38 5.87 5.87 0 0 0 1.38-2.1c.3-.76.5-1.64.56-2.91.06-1.28.07-1.69.07-4.95s-.01-3.67-.07-4.95c-.06-1.28-.26-2.15-.56-2.91a5.87 5.87 0 0 0-1.38-2.1A5.87 5.87 0 0 0 19.86.63C19.1.33 18.22.13 16.95.07 15.67.01 15.26 0 12 0Z"/><path fill="url(#ig-grad)" d="M12 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8"/><circle fill="url(#ig-grad)" cx="18.41" cy="5.59" r="1.44"/></svg>',
    youtube: '<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    pinterest: '<svg class="brand-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#BD081C" d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.347-.09.375-.293 1.199-.334 1.363-.053.225-.172.273-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.357-.629-2.748-1.378l-.748 2.853c-.271 1.043-1.002 2.35-1.492 3.146C9.57 23.812 10.763 24 12.017 24c6.624 0 11.99-5.367 11.99-11.987C24.007 5.367 18.641.001 12.017.001z"/></svg>',
};

// Returns short label + brand icon HTML for a platform code
function platformBadgeHtml(code) {
    const map = {
        facebook:  { lbl:'Facebook', brand:'facebook' },
        google:    { lbl:'Google',   brand:'google' },
        tiktok:    { lbl:'TikTok',   brand:'tiktok' },
        instagram: { lbl:'Instagram', brand:'instagram' },
        youtube:   { lbl:'YouTube',   brand:'youtube' },
        pinterest: { lbl:'Pinterest', brand:'pinterest' },
    };
    const m = map[String(code).toLowerCase()];
    if (!m) return '';
    const icon = BRAND_ICONS[m.brand] || '';
    return `<span class="prod-platform-badge" title="${m.lbl}">${icon}${m.lbl}</span>`;
}

// Returns short label + flag for a language code
function langBadgeHtml(code) {
    const map = {
        'Ingles':           { lbl:'EN',  flag:'🇬🇧' },
        'Ingles Americano': { lbl:'EN-US', flag:'🇺🇸' },
        'Portugues':        { lbl:'PT',  flag:'🇧🇷' },
        'Espanhol':         { lbl:'ES',  flag:'🇪🇸' },
        'Frances':          { lbl:'FR',  flag:'🇫🇷' },
        'Alemao':           { lbl:'DE',  flag:'🇩🇪' },
        'Italiano':         { lbl:'IT',  flag:'🇮🇹' },
        'Holandes':         { lbl:'NL',  flag:'🇳🇱' },
        'Polones':          { lbl:'PL',  flag:'🇵🇱' },
        'Checol':           { lbl:'CZ',  flag:'🇨🇿' },
        'Dinamarques':      { lbl:'DK',  flag:'🇩🇰' },
        'Sueco':            { lbl:'SE',  flag:'🇸🇪' },
        'Noruegues':        { lbl:'NO',  flag:'🇳🇴' },
    };
    const m = map[code] || { lbl: code, flag: '' };
    return `<span class="prod-lang-badge" title="${code}">${m.flag} ${m.lbl}</span>`;
}

// Resolve FB ad account ID → human-readable name:
// 1. Per-product label (manual)
// 2. Connected FacebookAds account name
// 3. Shortened ID as fallback
function fbAdAccountName(id, labels) {
    const idStr = String(id);
    if (labels && typeof labels === 'object' && labels[idStr]) return labels[idStr];
    try {
        const accounts = (typeof FacebookAds !== 'undefined' && FacebookAds.config?.adAccounts) || [];
        const found = accounts.find(a => String(a.id) === idStr);
        if (found?.name) return found.name;
    } catch {}
    return idStr.length > 8 ? idStr.slice(0, 6) + '…' + idStr.slice(-3) : idStr;
}

// Resolve Google ad account ID → label or ID itself
function googleAdAccountName(id, labels) {
    const idStr = String(id);
    if (labels && typeof labels === 'object' && labels[idStr]) return labels[idStr];
    return idStr;
}

// One badge per ad account — shows the account NAME with real brand icon
function adAccountBadgeHtml(platform, id, fullId) {
    const map = {
        fb:     { brand:'facebook', cls:'prod-account-badge prod-acc-fb',     hint:'Conta Facebook Ads' },
        google: { brand:'google',   cls:'prod-account-badge prod-acc-google', hint:'Conta Google Ads' },
    };
    const m = map[platform];
    if (!m) return '';
    const title = fullId ? `${m.hint}: ${fullId}` : m.hint;
    const icon = BRAND_ICONS[m.brand] || '';
    return `<span class="${m.cls}" title="${escapeHtml(title)}">${icon}${escapeHtml(id)}</span>`;
}

// Returns the combined platform + language + ad-account badges for a product
function renderProductMetaBadges(product) {
    if (!product) return '';
    const platforms = Array.isArray(product.platforms) ? product.platforms : [];
    const languages = Array.isArray(product.languages)
        ? product.languages
        : (product.language ? [product.language] : []);
    const fbAccs = Array.isArray(product.fbAdAccountIds) ? product.fbAdAccountIds : [];
    const gAccs  = Array.isArray(product.googleAdAccountIds) ? product.googleAdAccountIds : [];
    if (!platforms.length && !languages.length && !fbAccs.length && !gAccs.length) return '';
    const platHtml = platforms.map(platformBadgeHtml).join('');
    const langHtml = languages.map(langBadgeHtml).join('');
    const fbLabels = product.fbAdAccountLabels || {};
    const gLabels  = product.googleAdAccountLabels || {};
    const fbHtml = fbAccs.map(id => adAccountBadgeHtml('fb', fbAdAccountName(id, fbLabels), id)).join('');
    const gHtml  = gAccs.map(id => adAccountBadgeHtml('google', googleAdAccountName(id, gLabels), id)).join('');
    return `<span class="prod-meta-badges">${platHtml}${langHtml}${fbHtml}${gHtml}</span>`;
}

function formatCurrency(value, currency = 'USD') {
    if (value == null || isNaN(value)) return '--';
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    switch (currency) {
        case 'BRL': return `R$${Number(value).toLocaleString('pt-BR', opts)}`;
        case 'GBP': return `£${Number(value).toLocaleString('en-GB', opts)}`;
        case 'EUR': return `€${Number(value).toLocaleString('de-DE', opts)}`;
        default:    return `$${Number(value).toLocaleString('en-US', opts)}`;
    }
}

function currencySymbol(currency) {
    switch (currency) {
        case 'BRL': return 'R$';
        case 'GBP': return '£';
        case 'EUR': return '€';
        default:    return '$';
    }
}

function formatDualCurrency(valueInBaseCurrency, baseCurrency) {
    const usd = convertToUSD(valueInBaseCurrency, baseCurrency);
    if (usd === valueInBaseCurrency && baseCurrency === 'USD') {
        // Show USD + BRL
        const brl = convertCurrency(usd, 'USD', 'BRL');
        return `${formatCurrency(usd, 'USD')} | ${formatCurrency(brl, 'BRL')}`;
    }
    // Show base currency + USD
    return `${formatCurrency(valueInBaseCurrency, baseCurrency)} | ${formatCurrency(usd, 'USD')}`;
}

function formatDualCurrencyHTML(valueInBaseCurrency, baseCurrency) {
    const usd = convertToUSD(valueInBaseCurrency, baseCurrency);
    if (baseCurrency === 'USD') {
        const brl = convertCurrency(usd, 'USD', 'BRL');
        return `<span class="dual-currency"><span class="primary">${formatCurrency(usd, 'USD')}</span><span class="secondary">${formatCurrency(brl, 'BRL')}</span></span>`;
    }
    return `<span class="dual-currency"><span class="primary">${formatCurrency(valueInBaseCurrency, baseCurrency)}</span><span class="secondary">${formatCurrency(usd, 'USD')}</span></span>`;
}

// Get rate: 1 USD = ? targetCurrency
function getExchangeRate(targetCurrency) {
    if (!targetCurrency || targetCurrency === 'BRL') {
        // Legacy path: returns USD→BRL rate
        const override = AppState.exchangeRatesOverride?.BRL;
        return override || AppState.exchangeRateOverride || AppState.exchangeRates?.BRL || AppState.exchangeRate;
    }
    if (targetCurrency === 'USD') return 1;
    const override = AppState.exchangeRatesOverride?.[targetCurrency];
    if (override) return override;
    return AppState.exchangeRates?.[targetCurrency] || null;
}

function convertToUSD(value, fromCurrency) {
    if (!fromCurrency || fromCurrency === 'USD') return value;
    const rate = getExchangeRate(fromCurrency);
    if (!rate) return value;
    return value / rate;
}

function convertToBRL(value, fromCurrency) {
    if (fromCurrency === 'BRL') return value;
    // Convert to USD first, then to BRL
    const usd = convertToUSD(value, fromCurrency);
    const brlRate = getExchangeRate('BRL');
    if (!brlRate) return usd;
    return usd * brlRate;
}

function convertCurrency(value, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return value;
    // Always go through USD as intermediate
    const usd = convertToUSD(value, fromCurrency);
    if (toCurrency === 'USD') return usd;
    const rate = getExchangeRate(toCurrency);
    if (!rate) return usd;
    return usd * rate;
}

function calculateProfitPerSale(product, cpaCurrency, cpaValue) {
    const price = convertToUSD(product.price, product.priceCurrency);
    const cost = convertToUSD(product.cost, product.costCurrency);
    const cpa = convertToUSD(cpaValue || product.cpa, cpaCurrency || product.cpaCurrency);
    const taxAmount = price * (product.tax / 100);
    const variableAmount = price * (product.variableCosts / 100);

    return price - cost - taxAmount - variableAmount - cpa;
}

function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
}

function daysBetween(start, end) {
    const s = new Date(start + 'T00:00:00');
    const e = new Date(end + 'T00:00:00');
    return Math.ceil((e - s) / (1000 * 60 * 60 * 24)) + 1;
}

function daysRemaining(endDate) {
    const now = new Date();
    const end = new Date(endDate + 'T23:59:59');
    const diff = end - now;
    if (diff <= 0) return { days: 0, hours: 0, totalHours: 0 };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    return { days, hours, totalHours: Math.floor(diff / (1000 * 60 * 60)) };
}

function todayISO() {
    // Use local date (not UTC) to avoid "Hoje" mismatch around timezone boundaries.
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().split('T')[0];
}

function getProductById(id) {
    return AppState.allProducts.find(p => p.id === id) || AppState.products.find(p => p.id === id);
}

function getProductName(id) {
    if (!id || id === '__STORE__') return 'Teste de Loja';
    const p = getProductById(id);
    return p ? p.name : (id === 'todos' ? 'Todos os Produtos' : 'Produto Removido');
}

// ---- Populate product dropdowns ----
function populateProductDropdowns() {
    // diary-product-filter virou multi-select (custom widget); ele é renderizado por DiaryModule
    if (window.DiaryModule?._renderProductMultiSelect) {
        try { window.DiaryModule._renderProductMultiSelect(); } catch {}
    }
    const selectors = [
        'goal-product', 'entry-product', 'calc-product',
        'dash-product-select',
        'funnel-product', 'creative-product-filter'
    ];

    const showStoreInLabel = isAllStoresSelected();

    selectors.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;

        const currentVal = select.value;

        // Keep first option(s) that are static (value="" or special values like __STORE__)
        const keepValues = new Set(['', 'todos', '__STORE__']);
        while (select.options.length > 0 && !keepValues.has(select.options[select.options.length - 1].value)) {
            select.remove(select.options.length - 1);
        }
        // Remove dynamic product options but keep static ones
        for (let i = select.options.length - 1; i >= 0; i--) {
            if (!keepValues.has(select.options[i].value)) {
                select.remove(i);
            }
        }

        AppState.products.forEach(p => {
            if (p.status === 'ativo') {
                const opt = document.createElement('option');
                opt.value = p.id;
                const storeSuffix = showStoreInLabel ? ` — ${getStoreNameById(p.storeId) || 'Loja'}` : '';
                opt.textContent = `${p.name}${storeSuffix}`;
                select.appendChild(opt);
            }
        });

        if (currentVal && [...select.options].some(o => o.value === currentVal)) {
            select.value = currentVal;
        }
    });
}

function getWritableStoreId(productId = '') {
    if (AppState.currentStoreId && AppState.currentStoreId !== STORE_ALL_ID) {
        return AppState.currentStoreId;
    }
    if (productId) {
        const product = AppState.allProducts.find(p => p.id === productId);
        if (product?.storeId) return product.storeId;
    }
    // Fallback: use the first available store
    if (AppState.stores.length > 0) {
        return AppState.stores[0].id;
    }
    return '';
}

// ---- Config Modal ----
function initConfig() {
    const btn = document.getElementById('btn-connect-sheets');
    btn.addEventListener('click', () => {
        // If config already exists, connect directly with Google account.
        if (AppState.config.clientId && AppState.config.apiKey) {
            SheetsAPI.init(true);
            return;
        }

        document.getElementById('config-sheet-id').value = AppState.config.spreadsheetId;
        document.getElementById('config-client-id').value = AppState.config.clientId;
        document.getElementById('config-api-key').value = AppState.config.apiKey;
        openModal('config-modal');
    });

    document.getElementById('config-form').addEventListener('submit', (e) => {
        e.preventDefault();
        AppState.config.spreadsheetId = document.getElementById('config-sheet-id').value.trim();
        AppState.config.clientId = document.getElementById('config-client-id').value.trim();
        AppState.config.apiKey = document.getElementById('config-api-key').value.trim();

        localStorage.setItem('spreadsheetId', AppState.config.spreadsheetId);
        localStorage.setItem('clientId', AppState.config.clientId);
        localStorage.setItem('apiKey', AppState.config.apiKey);

        closeModal('config-modal');
        SheetsAPI.init(true);
    });
}

// ---- Exchange Rate Modal ----
function initRateModal() {
    document.getElementById('btn-edit-rate').addEventListener('click', () => {
        document.getElementById('rate-value-brl').value = getExchangeRate('BRL') || '';
        document.getElementById('rate-value-gbp').value = getExchangeRate('GBP') || '';
        document.getElementById('rate-value-eur').value = getExchangeRate('EUR') || '';
        openModal('rate-modal');
    });

    document.getElementById('btn-refresh-rate').addEventListener('click', () => {
        AppState.exchangeRateOverride = null;
        AppState.exchangeRatesOverride = null;
        CurrencyModule.fetchRate(true);
        if (typeof showToast === 'function') showToast('Cotações atualizadas', 'success');
    });

    document.getElementById('rate-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const brl = parseFloat(document.getElementById('rate-value-brl').value);
        const gbp = parseFloat(document.getElementById('rate-value-gbp').value);
        const eur = parseFloat(document.getElementById('rate-value-eur').value);

        const overrides = {};
        if (brl > 0) overrides.BRL = brl;
        if (gbp > 0) overrides.GBP = gbp;
        if (eur > 0) overrides.EUR = eur;

        if (Object.keys(overrides).length > 0) {
            AppState.exchangeRatesOverride = overrides;
            // Legacy compat
            if (overrides.BRL) AppState.exchangeRateOverride = overrides.BRL;
            CurrencyModule._updateDisplay();
            showToast('Cotações manuais aplicadas', 'success');
            EventBus.emit('rateUpdated', overrides);
        }
        closeModal('rate-modal');
    });
}

// ---- Google API Callbacks (global) ----
let gapiInited = false;
let gisInited = false;

function gapiLoaded() {
    console.log('Google API (gapi) script loaded');
    gapi.load('client', () => {
        gapiInited = true;
        console.log('gapi.client ready');
        maybeAutoConnect();
    });
}

function gisLoaded() {
    gisInited = true;
    console.log('Google Identity Services (GIS) ready');
    maybeAutoConnect();
}

function maybeAutoConnect() {
    if (gapiInited && gisInited && AppState.config.clientId && AppState.config.apiKey) {
        console.log('Auto-connecting to Google Sheets...');
        SheetsAPI.init(false);
    }
}

function isGoogleReady() {
    return gapiInited && gisInited;
}

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    NotificationsModule.init();
    initTabs();
    initModals();
    initConfig();
    initRateModal();
    initStoreManagement();
    CurrencyModule.fetchRate();
    CurrencyModule.startAutoRefresh();
    FacebookAds.initUI();
    if (typeof GoogleAdsModule !== 'undefined' && GoogleAdsModule.init) {
        GoogleAdsModule.init();
    }
    if (typeof SwipeModule !== 'undefined') SwipeModule.init();
    if (typeof MiningModule !== 'undefined') MiningModule.init();
    if (typeof LabTestsModule !== 'undefined') LabTestsModule.init();
    if (typeof ProjectsModule !== 'undefined') ProjectsModule.init();
    if (typeof CRMModule !== 'undefined') CRMModule.init();
    if (typeof TeamModule !== 'undefined') TeamModule.init();
    if (typeof ShopifyModule !== 'undefined') ShopifyModule.init();
    if (typeof PageComparisonModule !== 'undefined') PageComparisonModule.init();
    if (typeof ScaleSimModule !== 'undefined') ScaleSimModule.init();
    if (typeof FiscalModule !== 'undefined') FiscalModule.init();
    if (typeof RemoteCapturesModule !== 'undefined') RemoteCapturesModule.init();

    // Load stores from localStorage
    AppState.stores = JSON.parse(localStorage.getItem('etracker_stores') || '[]');
    ensureStoreSetup();
    renderStoreSelector();
    filterDataByStore();

    const entryDate = document.getElementById('entry-date');
    if (entryDate) entryDate.value = todayISO();
});
