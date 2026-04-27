/* ===========================
   Goals.js — Goal management with progress tracking
   =========================== */

const GoalsModule = {
    // Get REAL CPA from diary data (last 14 days) instead of the target CPA from product
    _getRealCpa(productId) {
        const today = todayISO();
        const d = new Date();
        d.setDate(d.getDate() - 13);
        const startDate = d.toISOString().split('T')[0];

        const entries = (AppState.diary || []).filter(e =>
            e.productId === productId && e.date >= startDate && e.date <= today && !e.isCampaign && e.sales > 0
        );

        if (entries.length === 0) return null; // No real data, will fall back to product CPA

        let totalBudget = 0, totalSales = 0;
        entries.forEach(e => {
            totalBudget += convertToUSD(e.budget, e.budgetCurrency);
            totalSales += e.sales;
        });

        return totalSales > 0 ? { cpa: totalBudget / totalSales, currency: 'USD' } : null;
    },

    init() {
        document.getElementById('btn-add-goal').addEventListener('click', () => this.openForm());
        document.getElementById('goal-form').addEventListener('submit', (e) => this.handleSubmit(e));
        document.getElementById('goal-cancel').addEventListener('click', () => closeModal('goal-modal'));

        // Live preview
        ['goal-product', 'goal-target', 'goal-currency', 'goal-start', 'goal-end'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => this.updatePreview());
        });

        EventBus.on('dataLoaded', () => this.render());
        EventBus.on('diaryChanged', () => this.render());
        EventBus.on('productsChanged', () => this.render());
        EventBus.on('rateUpdated', () => this.render());
    },

    openForm(goal = null) {
        const title = document.getElementById('goal-modal-title');
        const form = document.getElementById('goal-form');
        form.reset();

        if (goal) {
            title.textContent = 'Editar Meta';
            document.getElementById('goal-id').value = goal.id;
            document.getElementById('goal-product').value = goal.productId;
            document.getElementById('goal-target').value = goal.dailyTarget;
            document.getElementById('goal-currency').value = goal.currency;
            document.getElementById('goal-start').value = goal.startDate;
            document.getElementById('goal-end').value = goal.endDate;
        } else {
            title.textContent = 'Nova Meta';
            document.getElementById('goal-id').value = '';
            document.getElementById('goal-start').value = todayISO();
        }

        this.updatePreview();
        openModal('goal-modal');
    },

    updatePreview() {
        const productId = document.getElementById('goal-product').value;
        const target = parseFloat(document.getElementById('goal-target').value) || 0;
        const currency = document.getElementById('goal-currency').value;
        const startDate = document.getElementById('goal-start').value;
        const endDate = document.getElementById('goal-end').value;

        const daysEl = document.getElementById('preview-goal-days');
        const totalEl = document.getElementById('preview-goal-total');
        const salesEl = document.getElementById('preview-goal-sales');
        const budgetEl = document.getElementById('preview-goal-budget');

        if (!startDate || !endDate || target <= 0) {
            daysEl.textContent = '-- dias';
            totalEl.textContent = '--';
            salesEl.textContent = '--';
            budgetEl.textContent = '--';
            return;
        }

        const days = daysBetween(startDate, endDate);
        daysEl.textContent = `${days} dias`;
        totalEl.textContent = formatDualCurrency(target * days, currency);

        // Calculate sales needed using REAL CPA from diary
        if (productId && productId !== 'todos') {
            const product = getProductById(productId);
            if (product) {
                const realCpaData = this._getRealCpa(productId);
                const cpaVal = realCpaData ? realCpaData.cpa : convertToUSD(product.cpa, product.cpaCurrency);
                const cpaCur = realCpaData ? 'USD' : product.cpaCurrency;

                const profitPerSale = calculateProfitPerSale(product, cpaCur, cpaVal);
                const targetUSD = convertToUSD(target, currency);
                const profitUSD = profitPerSale;

                if (profitUSD > 0) {
                    const salesNeeded = Math.ceil(targetUSD / profitUSD);
                    const budgetNeeded = salesNeeded * cpaVal;

                    salesEl.textContent = `${salesNeeded} vendas`;
                    budgetEl.textContent = formatDualCurrency(budgetNeeded, 'USD');
                } else {
                    salesEl.textContent = 'Lucro negativo!';
                    budgetEl.textContent = '--';
                }
            }
        } else {
            salesEl.textContent = 'Selecione um produto';
            budgetEl.textContent = '--';
        }
    },

    async handleSubmit(e) {
        e.preventDefault();
        const goalId = document.getElementById('goal-id').value || generateId('meta');
        const selectedProductId = document.getElementById('goal-product').value;
        const existingIdx = AppState.allGoals.findIndex(g => g.id === goalId);
        const existingGoal = existingIdx >= 0 ? AppState.allGoals[existingIdx] : null;

        let storeId = existingGoal?.storeId || getWritableStoreId(selectedProductId !== 'todos' ? selectedProductId : '');
        if (!storeId) {
            showToast('Selecione uma loja específica para salvar a meta.', 'error');
            return;
        }

        const data = {
            id: goalId,
            productId: selectedProductId,
            dailyTarget: parseFloat(document.getElementById('goal-target').value) || 0,
            currency: document.getElementById('goal-currency').value,
            startDate: document.getElementById('goal-start').value,
            endDate: document.getElementById('goal-end').value,
            status: existingGoal?.status || 'ativa',
            storeId
        };

        if (existingIdx >= 0) {
            AppState.allGoals[existingIdx] = data;
            if (AppState.sheetsConnected) {
                await SheetsAPI.updateRowById(SheetsAPI.TABS.GOALS, data.id, SheetsAPI.goalToRow(data));
            }
            showToast('Meta atualizada!', 'success');
        } else {
            AppState.allGoals.push(data);
            if (AppState.sheetsConnected) {
                await SheetsAPI.appendRow(SheetsAPI.TABS.GOALS, SheetsAPI.goalToRow(data));
            }
            showToast('Meta criada!', 'success');
        }

        filterDataByStore();
        closeModal('goal-modal');
        this.render();
        EventBus.emit('goalsChanged');
    },

    async deleteGoal(id) {
        if (!confirm('Excluir esta meta?')) return;

        const idx = AppState.allGoals.findIndex(g => g.id === id);
        if (idx >= 0) {
            AppState.allGoals.splice(idx, 1);
            if (AppState.sheetsConnected) {
                await SheetsAPI.deleteRowById(SheetsAPI.TABS.GOALS, id);
            }
            filterDataByStore();
            this.render();
            EventBus.emit('goalsChanged');
            showToast('Meta excluída', 'info');
        }
    },

    async toggleGoalStatus(id) {
        const goal = AppState.allGoals.find(g => g.id === id);
        if (!goal) return;

        goal.status = goal.status === 'ativa' ? 'pausada' : 'ativa';

        if (AppState.sheetsConnected) {
            await SheetsAPI.updateRowById(SheetsAPI.TABS.GOALS, goal.id, SheetsAPI.goalToRow(goal));
        }

        filterDataByStore();
        this.render();
        EventBus.emit('goalsChanged');
    },

    getGoalProgress(goal) {
        const today = todayISO();
        const totalDays = daysBetween(goal.startDate, goal.endDate);
        const remaining = daysRemaining(goal.endDate);

        // Get diary entries for this goal's period and product
        let entries = AppState.diary.filter(d => {
            if (d.isCampaign || d.parentId) return false;
            if (d.date < goal.startDate || d.date > goal.endDate) return false;
            if (goal.productId !== 'todos' && d.productId !== goal.productId) return false;
            return true;
        });

        // Calculate actual profit
        let totalProfit = 0;
        let totalSales = 0;
        let totalBudget = 0;
        let totalRevenue = 0;

        entries.forEach(entry => {
            const product = getProductById(entry.productId);
            if (!product) return;

            const revenueUSD = convertToUSD(entry.revenue, entry.revenueCurrency);
            const budgetUSD = convertToUSD(entry.budget, entry.budgetCurrency);
            const costUSD = convertToUSD(product.cost, product.costCurrency);

            const entryProfit = revenueUSD
                - (costUSD * entry.sales)
                - (revenueUSD * product.tax / 100)
                - (revenueUSD * product.variableCosts / 100)
                - budgetUSD;

            totalProfit += entryProfit;
            totalSales += entry.sales;
            totalBudget += budgetUSD;
            totalRevenue += revenueUSD;
        });

        const targetTotalUSD = convertToUSD(goal.dailyTarget, goal.currency) * totalDays;
        const progressPct = targetTotalUSD > 0 ? Math.min((totalProfit / targetTotalUSD) * 100, 100) : 0;

        const profitRemaining = targetTotalUSD - totalProfit;
        const profitPerDayNeeded = remaining.days > 0 ? profitRemaining / remaining.days : profitRemaining;
        const profitPerHourNeeded = remaining.totalHours > 0 ? profitRemaining / remaining.totalHours : profitRemaining;

        // Sales needed for remaining profit
        let salesRemaining = 0;
        let budgetPerDayNeeded = 0;

        if (goal.productId !== 'todos') {
            const product = getProductById(goal.productId);
            if (product) {
                const realCpaData = this._getRealCpa(goal.productId);
                const cpaVal = realCpaData ? realCpaData.cpa : convertToUSD(product.cpa, product.cpaCurrency);
                const cpaCur = realCpaData ? 'USD' : product.cpaCurrency;

                const profitPerSale = calculateProfitPerSale(product, cpaCur, cpaVal);
                if (profitPerSale > 0) {
                    salesRemaining = Math.ceil(profitRemaining / profitPerSale);
                    budgetPerDayNeeded = remaining.days > 0
                        ? (salesRemaining * cpaVal) / remaining.days
                        : salesRemaining * cpaVal;
                }
            }
        }

        // Determine track status
        const daysPassed = totalDays - remaining.days;
        const expectedPct = daysPassed > 0 ? (daysPassed / totalDays) * 100 : 0;
        let trackStatus = 'on-track';
        if (progressPct < expectedPct * 0.7) trackStatus = 'at-risk';
        else if (progressPct < expectedPct * 0.9) trackStatus = 'behind';

        return {
            totalDays, remaining, totalProfit, totalSales, totalBudget, totalRevenue,
            targetTotalUSD, progressPct, profitRemaining, profitPerDayNeeded,
            profitPerHourNeeded, salesRemaining, budgetPerDayNeeded, trackStatus
        };
    },

    render() {
        const container = document.getElementById('goals-list');
        const activeGoals = AppState.goals.filter(g => g.status === 'ativa');

        if (activeGoals.length === 0) {
            container.innerHTML = '<div class="empty-state" id="goals-empty"><p>Nenhuma meta criada. Clique em "+ Nova Meta" para definir seus objetivos.</p></div>';
            return;
        }

        container.innerHTML = activeGoals.map(goal => {
            const progress = this.getGoalProgress(goal);
            const productName = getProductName(goal.productId);

            return `<div class="goal-card">
                <div class="goal-card-header">
                    <div>
                        <div class="goal-card-title">${productName}</div>
                        <div class="goal-card-period">${formatDate(goal.startDate)} — ${formatDate(goal.endDate)}</div>
                    </div>
                    <div class="goal-card-actions">
                        <button class="btn btn-secondary btn-sm" onclick="GoalsModule.openForm(AppState.goals.find(g=>g.id==='${goal.id}'))">Editar</button>
                        <button class="btn btn-danger btn-sm" onclick="GoalsModule.deleteGoal('${goal.id}')">Excluir</button>
                    </div>
                </div>

                <div class="goal-progress-bar">
                    <div class="goal-progress-fill ${progress.trackStatus}" style="width:${Math.max(0, progress.progressPct).toFixed(1)}%"></div>
                </div>

                <div style="display:flex;justify-content:space-between;font-size:0.78rem;color:var(--text-muted);">
                    <span>${progress.progressPct.toFixed(1)}% concluído</span>
                    <span>Meta: ${formatCurrency(goal.dailyTarget, goal.currency)}/dia</span>
                </div>

                <div class="goal-stats">
                    <div class="goal-stat">
                        <label>Tempo Restante</label>
                        <span class="countdown">${progress.remaining.days}d ${progress.remaining.hours}h</span>
                    </div>
                    <div class="goal-stat">
                        <label>Lucro Acumulado</label>
                        <span style="color:${progress.totalProfit >= 0 ? 'var(--green)' : 'var(--red)'}">
                            ${formatCurrency(progress.totalProfit, 'USD')}
                        </span>
                    </div>
                    <div class="goal-stat">
                        <label>Falta por Dia</label>
                        <span>${formatDualCurrency(progress.profitPerDayNeeded, 'USD')}</span>
                    </div>
                    <div class="goal-stat">
                        <label>Falta por Hora</label>
                        <span>${formatCurrency(progress.profitPerHourNeeded, 'USD')}</span>
                    </div>
                    <div class="goal-stat">
                        <label>Vendas Faltantes</label>
                        <span>${progress.salesRemaining > 0 ? progress.salesRemaining : '--'}</span>
                    </div>
                    <div class="goal-stat">
                        <label>Orçamento/Dia Necessário</label>
                        <span>${progress.budgetPerDayNeeded > 0 ? formatDualCurrency(progress.budgetPerDayNeeded, 'USD') : '--'}</span>
                    </div>
                </div>
            </div>`;
        }).join('');
    }
};

document.addEventListener('DOMContentLoaded', () => GoalsModule.init());
