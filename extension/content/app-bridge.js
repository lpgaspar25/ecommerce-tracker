/* Runs on the ETracker app pages. Pulls the queue from the extension and
   pushes products into the page via window.postMessage. */
(function () {
    if (window._etrackerBridgeLoaded) return;
    window._etrackerBridgeLoaded = true;

    function pull(force = false) {
        chrome.runtime.sendMessage({ type: 'etracker-ext-pull-queue' }, (resp) => {
            if (chrome.runtime.lastError) return;
            const queue = resp?.queue || [];
            if (!queue.length && !force) return;

            // Separa os tipos
            const captures = queue.filter(item => item && item.tipo === 'remote-capture');
            const products = queue.filter(item => !item || item.tipo !== 'remote-capture');

            // Produtos → módulo Importer (comportamento original)
            if (products.length || force) {
                window.postMessage({
                    source: 'etracker-extension',
                    type: 'importer-product-data',
                    products,
                }, location.origin);
            }

            // Capturas BK/Payoneer → módulo RemoteCaptures
            if (captures.length) {
                window.postMessage({
                    source: 'etracker-extension',
                    type: 'remote-capture-data',
                    captures,
                }, location.origin);
            }

            // Clear the queue once delivered
            if (queue.length) {
                chrome.runtime.sendMessage({ type: 'etracker-ext-clear-queue' }, () => {});
            }
        });
    }

    // On page load
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(() => pull(false), 400);
    } else {
        document.addEventListener('DOMContentLoaded', () => setTimeout(() => pull(false), 400));
    }

    // If URL has ?fromExt=1, force a pull
    if (location.search.includes('fromExt=1')) {
        setTimeout(() => pull(true), 600);
    }

    // A pagina (botao "Recarregar" do modulo Capturas) pode pedir um re-pull manual
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (event.origin !== location.origin) return;
        const d = event.data;
        if (d && d.source === 'etracker-app' && d.type === 'request-ext-pull') {
            pull(true);
        }
    });

    // Auto-pull quando a extensao grava algo novo na fila (captura feita em outra aba,
    // com o ETracker ja aberto). onChanged dispara em todos os contextos da extensao.
    try {
        if (chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local') return;
                const c = changes.etracker_ext_queue;
                if (c && Array.isArray(c.newValue) && c.newValue.length) {
                    setTimeout(() => pull(false), 150);
                }
            });
        }
    } catch (e) { /* noop */ }
})();
