/* ===========================
   Currency.js — Multi-currency exchange rates (USD, BRL, GBP, EUR)
   All rates stored as: 1 USD = X (target currency)
   =========================== */

const CurrencyModule = {
    _cacheTime: null,
    _cacheDuration: 60 * 60 * 1000, // 1 hour

    async fetchRate() {
        // Check cache
        if (this._cacheTime && (Date.now() - this._cacheTime) < this._cacheDuration && AppState.exchangeRates) {
            this._updateDisplay();
            return;
        }

        try {
            const res = await fetch('https://open.er-api.com/v6/latest/USD');
            const data = await res.json();

            if (data.result === 'success' && data.rates) {
                AppState.exchangeRates = {
                    BRL: data.rates.BRL || 5.20,
                    GBP: data.rates.GBP || 0.79,
                    EUR: data.rates.EUR || 0.92
                };
                // Keep legacy field for backwards compat
                AppState.exchangeRate = AppState.exchangeRates.BRL;
                this._cacheTime = Date.now();

                this._updateDisplay();
                EventBus.emit('rateUpdated', AppState.exchangeRates);

                // Persist to sheets if connected
                if (AppState.sheetsConnected) {
                    SheetsAPI.saveConfig('cotacao_usd_brl', AppState.exchangeRates.BRL.toString());
                    SheetsAPI.saveConfig('cotacao_usd_gbp', AppState.exchangeRates.GBP.toString());
                    SheetsAPI.saveConfig('cotacao_usd_eur', AppState.exchangeRates.EUR.toString());
                }
            }
        } catch (err) {
            console.warn('Failed to fetch exchange rates:', err);

            // Try localStorage fallback
            const saved = localStorage.getItem('exchangeRates');
            if (saved) {
                try {
                    AppState.exchangeRates = JSON.parse(saved);
                    AppState.exchangeRate = AppState.exchangeRates.BRL;
                } catch (e) {
                    // Legacy single rate fallback
                    const oldRate = localStorage.getItem('exchangeRate');
                    if (oldRate) {
                        AppState.exchangeRates = { BRL: parseFloat(oldRate), GBP: 0.79, EUR: 0.92 };
                        AppState.exchangeRate = AppState.exchangeRates.BRL;
                    }
                }
                this._updateDisplay();
            } else {
                const el = document.getElementById('exchange-rate-brl');
                if (el) el.textContent = 'Erro';
            }
        }
    },

    _updateDisplay() {
        const rates = AppState.exchangeRatesOverride || AppState.exchangeRates;
        if (!rates) return;

        const elBrl = document.getElementById('exchange-rate-brl');
        const elGbp = document.getElementById('exchange-rate-gbp');
        const elEur = document.getElementById('exchange-rate-eur');
        // Legacy element
        const elLegacy = document.getElementById('exchange-rate');

        const oBrl = AppState.exchangeRatesOverride?.BRL;
        const oGbp = AppState.exchangeRatesOverride?.GBP;
        const oEur = AppState.exchangeRatesOverride?.EUR;

        if (elBrl) elBrl.textContent = (oBrl || rates.BRL).toFixed(2);
        if (elGbp) elGbp.textContent = (oGbp || rates.GBP).toFixed(4);
        if (elEur) elEur.textContent = (oEur || rates.EUR).toFixed(4);
        if (elLegacy) elLegacy.textContent = (oBrl || rates.BRL).toFixed(2);
    },

    // Save rates to localStorage as backup
    persist() {
        if (AppState.exchangeRates) {
            localStorage.setItem('exchangeRates', JSON.stringify(AppState.exchangeRates));
            // Legacy compat
            localStorage.setItem('exchangeRate', AppState.exchangeRates.BRL.toString());
        }
    }
};

// Persist on rate update
EventBus.on('rateUpdated', () => {
    CurrencyModule.persist();
});
