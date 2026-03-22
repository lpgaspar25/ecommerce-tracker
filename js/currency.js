/* ===========================
   Currency.js — USD/BRL exchange rate via API + manual override
   =========================== */

const CurrencyModule = {
    _cacheTime: null,
    _cacheDuration: 60 * 60 * 1000, // 1 hour

    async fetchRate() {
        // Check cache
        if (this._cacheTime && (Date.now() - this._cacheTime) < this._cacheDuration && AppState.exchangeRate) {
            document.getElementById('exchange-rate').textContent = AppState.exchangeRate.toFixed(2);
            return;
        }

        try {
            const res = await fetch('https://open.er-api.com/v6/latest/USD');
            const data = await res.json();

            if (data.result === 'success' && data.rates && data.rates.BRL) {
                AppState.exchangeRate = data.rates.BRL;
                this._cacheTime = Date.now();

                if (!AppState.exchangeRateOverride) {
                    document.getElementById('exchange-rate').textContent = AppState.exchangeRate.toFixed(2);
                }

                EventBus.emit('rateUpdated', AppState.exchangeRate);

                // Persist to sheets if connected
                if (AppState.sheetsConnected) {
                    SheetsAPI.saveConfig('cotacao_usd_brl', AppState.exchangeRate.toString());
                }
            }
        } catch (err) {
            console.warn('Failed to fetch exchange rate:', err);

            // Try to load from localStorage as fallback
            const saved = localStorage.getItem('exchangeRate');
            if (saved) {
                AppState.exchangeRate = parseFloat(saved);
                document.getElementById('exchange-rate').textContent = AppState.exchangeRate.toFixed(2);
            } else {
                document.getElementById('exchange-rate').textContent = 'Erro';
            }
        }
    },

    // Save rate to localStorage as backup
    persist() {
        if (AppState.exchangeRate) {
            localStorage.setItem('exchangeRate', AppState.exchangeRate.toString());
        }
    }
};

// Persist on rate update
EventBus.on('rateUpdated', () => {
    CurrencyModule.persist();
});
