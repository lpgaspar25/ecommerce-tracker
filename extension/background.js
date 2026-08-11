/* Service worker — relays the queue to the app via tab messaging. */

const APP_URL_PATTERN = /^https:\/\/(?:[^.]+\.)?app-calculadora-lucas\.pages\.dev\//;
const GHPAGES_PATTERN = /^https:\/\/lpgaspar25\.github\.io\/ecommerce-tracker\//;
const LOCAL_PATTERN = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\//;

const QUEUE_KEY = 'etracker_ext_queue';

function isAppUrl(url) {
    return APP_URL_PATTERN.test(url) || GHPAGES_PATTERN.test(url) || LOCAL_PATTERN.test(url);
}

// When the app-bridge content script asks for queue, hand it over and clear.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!sender.tab || !isAppUrl(sender.tab.url || '')) {
        sendResponse({ error: 'unauthorized origin' });
        return true;
    }
    if (msg?.type === 'etracker-ext-pull-queue') {
        chrome.storage.local.get(QUEUE_KEY, (data) => {
            const queue = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
            sendResponse({ queue });
        });
        return true; // async
    }
    if (msg?.type === 'etracker-ext-clear-queue') {
        chrome.storage.local.set({ [QUEUE_KEY]: [] }, () => sendResponse({ ok: true }));
        return true;
    }
    sendResponse({ error: 'unknown' });
    return true;
});
