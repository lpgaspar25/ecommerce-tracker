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
            // Send to the page (importer.js listens for this)
            window.postMessage({
                source: 'etracker-extension',
                type: 'importer-product-data',
                products: queue,
            }, location.origin);
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
})();
