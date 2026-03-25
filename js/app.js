/* ===========================
   App.js — Core initialization, tab navigation, event bus, utilities
   Multi-store support
   =========================== */

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

    // Filtered by current store (these are used by all modules)
    products: [],
    goals: [],
    diary: [],
    creatives: [],
    creativeMetrics: [],

    exchangeRate: null,
    exchangeRateOverride: null,
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

    AppState.allProducts = (AppState.allProducts || []).map(item => ({
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
    } else {
        AppState.products = AppState.allProducts.filter(p => p.storeId === storeId);
        AppState.goals = AppState.allGoals.filter(g => g.storeId === storeId);
        AppState.diary = AppState.allDiary.filter(d => d.storeId === storeId);
        AppState.creatives = (AppState.allCreatives || []).filter(c => c.storeId === storeId);
        AppState.creativeMetrics = (AppState.allCreativeMetrics || []).filter(m => m.storeId === storeId);
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
        const toggleIcon = active ? '⏸' : '▶';
        const toggleTitle = active ? 'Desativar' : 'Ativar';

        return `<div class="store-list-item ${isCurrent ? 'active' : ''} ${!active ? 'disabled' : ''}">
            <div class="store-list-main">
                <input type="text" class="store-name-input" value="${escapeHtml(store.name)}" data-store-id="${store.id}">
                ${statusBadge}
            </div>
            <div class="store-list-actions">
                ${!isCurrent && active ? `<button class="btn btn-secondary btn-sm btn-select-store" data-store-id="${store.id}" title="Selecionar">Usar</button>` : ''}
                <button class="btn-icon btn-toggle-store" data-store-id="${store.id}" title="${toggleTitle}">${toggleIcon}</button>
                <button class="btn-icon btn-delete-store" data-store-id="${store.id}" title="Excluir">🗑️</button>
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
    toast.textContent = message;
    container.appendChild(toast);

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

function formatCurrency(value, currency = 'USD') {
    if (value == null || isNaN(value)) return '--';
    const opts = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    if (currency === 'BRL') {
        return `R$${Number(value).toLocaleString('pt-BR', opts)}`;
    }
    return `$${Number(value).toLocaleString('en-US', opts)}`;
}

function formatDualCurrency(valueInBaseCurrency, baseCurrency) {
    const rate = getExchangeRate();
    if (!rate) return formatCurrency(valueInBaseCurrency, baseCurrency);

    let usd, brl;
    if (baseCurrency === 'USD') {
        usd = valueInBaseCurrency;
        brl = valueInBaseCurrency * rate;
    } else {
        brl = valueInBaseCurrency;
        usd = valueInBaseCurrency / rate;
    }

    return `${formatCurrency(usd, 'USD')} | ${formatCurrency(brl, 'BRL')}`;
}

function formatDualCurrencyHTML(valueInBaseCurrency, baseCurrency) {
    const rate = getExchangeRate();
    if (!rate) return `<span class="dual-currency"><span class="primary">${formatCurrency(valueInBaseCurrency, baseCurrency)}</span></span>`;

    let usd, brl;
    if (baseCurrency === 'USD') {
        usd = valueInBaseCurrency;
        brl = valueInBaseCurrency * rate;
    } else {
        brl = valueInBaseCurrency;
        usd = valueInBaseCurrency / rate;
    }

    if (baseCurrency === 'USD') {
        return `<span class="dual-currency"><span class="primary">${formatCurrency(usd, 'USD')}</span><span class="secondary">${formatCurrency(brl, 'BRL')}</span></span>`;
    } else {
        return `<span class="dual-currency"><span class="primary">${formatCurrency(brl, 'BRL')}</span><span class="secondary">${formatCurrency(usd, 'USD')}</span></span>`;
    }
}

function getExchangeRate() {
    return AppState.exchangeRateOverride || AppState.exchangeRate;
}

function convertToUSD(value, fromCurrency) {
    if (fromCurrency === 'USD') return value;
    const rate = getExchangeRate();
    if (!rate) return value;
    return value / rate;
}

function convertToBRL(value, fromCurrency) {
    if (fromCurrency === 'BRL') return value;
    const rate = getExchangeRate();
    if (!rate) return value;
    return value * rate;
}

function convertCurrency(value, fromCurrency, toCurrency) {
    if (fromCurrency === toCurrency) return value;
    if (toCurrency === 'USD') return convertToUSD(value, fromCurrency);
    return convertToBRL(value, fromCurrency);
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
    const selectors = [
        'goal-product', 'entry-product', 'calc-product',
        'dash-product-select', 'diary-product-filter',
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
        document.getElementById('rate-value').value = getExchangeRate() || '';
        openModal('rate-modal');
    });

    document.getElementById('btn-refresh-rate').addEventListener('click', () => {
        AppState.exchangeRateOverride = null;
        CurrencyModule.fetchRate();
    });

    document.getElementById('rate-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const val = parseFloat(document.getElementById('rate-value').value);
        if (val > 0) {
            AppState.exchangeRateOverride = val;
            document.getElementById('exchange-rate').textContent = val.toFixed(2);
            showToast('Cotação manual aplicada', 'success');
            EventBus.emit('rateUpdated', val);
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
    FacebookAds.initUI();
    if (typeof GoogleAdsModule !== 'undefined' && GoogleAdsModule.init) {
        GoogleAdsModule.init();
    }
    if (typeof SwipeModule !== 'undefined') SwipeModule.init();
    if (typeof MiningModule !== 'undefined') MiningModule.init();
    if (typeof LabTestsModule !== 'undefined') LabTestsModule.init();

    // Load stores from localStorage
    AppState.stores = JSON.parse(localStorage.getItem('etracker_stores') || '[]');
    ensureStoreSetup();
    renderStoreSelector();
    filterDataByStore();

    const entryDate = document.getElementById('entry-date');
    if (entryDate) entryDate.value = todayISO();
});
