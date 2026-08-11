/* ETracker scraper — popup logic. */

const APP_URL = 'https://app-calculadora-lucas.pages.dev';
const QUEUE_KEY = 'etracker_ext_queue';

const els = {
    status: document.getElementById('status'),
    preview: document.getElementById('preview'),
    title: document.getElementById('preview-title'),
    vendor: document.getElementById('preview-vendor'),
    price: document.getElementById('preview-price'),
    imgs: document.getElementById('preview-imgs'),
    img: document.getElementById('preview-img'),
    error: document.getElementById('error'),
    btnExtract: document.getElementById('btn-extract'),
    btnSend: document.getElementById('btn-send'),
    btnCollection: document.getElementById('btn-collection'),
    queueCount: document.getElementById('queue-count'),
    btnClearQueue: document.getElementById('btn-clear-queue'),
};

let _current = null;

function setStatus(text, kind = '') {
    els.status.textContent = text;
    els.status.className = 'status' + (kind ? ' ' + kind : '');
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
}

async function extract() {
    setStatus('Detectando…');
    els.preview.style.display = 'none';
    els.error.style.display = 'none';
    els.btnSend.disabled = true;
    els.btnCollection.style.display = 'none';
    _current = null;

    const tab = await getActiveTab();
    if (!tab?.id) { setStatus('Aba inválida', 'fail'); return; }

    let result;
    try {
        const [{ result: r }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/extractor.js'],
        });
        result = r;
    } catch (e) {
        setStatus('Erro ao injetar script: ' + e.message, 'fail');
        return;
    }
    if (!result || result.kind === 'none') {
        setStatus(result?.error || 'Nada detectado', 'fail');
        return;
    }
    if (result.kind === 'product') {
        const p = result.product;
        _current = { type: 'product', payload: p };
        renderPreview(p, result.product._source?.method);
        els.btnSend.disabled = false;
        // Allow capturing a collection if URL hints one
        if (/\/collections\//.test(tab.url || '')) {
            els.btnCollection.style.display = '';
        }
    } else if (result.kind === 'collection') {
        _current = { type: 'collection', payload: result };
        setStatus(`Coleção detectada · ${result.count} produtos`, 'ok');
        els.preview.style.display = 'none';
        els.btnSend.disabled = false;
        els.btnCollection.style.display = 'none';
    }
}

function renderPreview(p, method) {
    setStatus(`Produto detectado via ${method || '?'}`, 'ok');
    els.preview.style.display = '';
    els.img.src = p.images?.[0]?.src || '';
    els.img.alt = p.title || '';
    els.title.textContent = p.title || '—';
    els.vendor.textContent = p.vendor || '—';
    const price = p.variants?.[0]?.price || 0;
    const currency = p._source?.currency || '';
    els.price.textContent = price ? `${currency ? currency + ' ' : ''}${price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';
    els.imgs.textContent = `${p.images?.length || 0} imagens · ${p.variants?.length || 0} variante(s)`;
}

async function loadQueue() {
    const { [QUEUE_KEY]: q } = await chrome.storage.local.get(QUEUE_KEY);
    return Array.isArray(q) ? q : [];
}
async function saveQueue(q) {
    await chrome.storage.local.set({ [QUEUE_KEY]: q });
    renderQueueCount();
}
async function renderQueueCount() {
    const q = await loadQueue();
    els.queueCount.textContent = `${q.length} produto${q.length === 1 ? '' : 's'} na fila`;
}

async function sendToApp() {
    if (!_current) return;
    const queue = await loadQueue();
    if (_current.type === 'product') {
        queue.push(_current.payload);
    } else if (_current.type === 'collection') {
        for (const prod of _current.payload.products) queue.push(prod);
    }
    await saveQueue(queue);
    setStatus(`✓ Adicionado à fila (${queue.length})`, 'ok');

    // Open the importer tab to flush the queue
    const url = `${APP_URL}/?tab=importador&fromExt=1`;
    const tabs = await chrome.tabs.query({ url: APP_URL + '/*' });
    if (tabs.length) {
        await chrome.tabs.update(tabs[0].id, { active: true, url });
    } else {
        await chrome.tabs.create({ url });
    }
}

async function captureCollection() {
    setStatus('Buscando produtos da coleção…');
    const tab = await getActiveTab();
    if (!tab?.id) return;
    try {
        const [{ result }] = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: async () => {
                const m = location.pathname.match(/\/collections\/([^\/?#]+)/);
                if (!m) return null;
                const handle = m[1];
                const all = [];
                for (let page = 1; page <= 5; page++) {
                    const r = await fetch(`${location.origin}/collections/${handle}/products.json?limit=50&page=${page}`, { credentials: 'omit' });
                    if (!r.ok) break;
                    const j = await r.json();
                    const ps = j.products || [];
                    if (!ps.length) break;
                    all.push(...ps);
                    if (ps.length < 50) break;
                }
                return { handle, count: all.length, products: all };
            },
        });
        if (!result || !result.products?.length) { setStatus('Coleção vazia ou indisponível', 'fail'); return; }
        const collection = result;
        // Normalize payload
        _current = {
            type: 'collection',
            payload: {
                handle: collection.handle,
                count: collection.count,
                products: collection.products.map(p => ({
                    handle: p.handle,
                    title: p.title || '',
                    body: p.body_html || '',
                    vendor: p.vendor || '',
                    type: p.product_type || '',
                    tags: Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || ''),
                    published: !!p.published_at,
                    seoTitle: '', seoDescription: '',
                    status: 'active',
                    options: (p.options || []).map(o => o.name),
                    variants: (p.variants || []).map(v => ({
                        optionValues: [v.option1, v.option2, v.option3].filter(Boolean),
                        sku: v.sku || '', grams: v.grams || 0,
                        price: parseFloat(v.price) || 0,
                        compareAt: parseFloat(v.compare_at_price) || 0,
                        requiresShipping: !!v.requires_shipping, taxable: !!v.taxable,
                        barcode: v.barcode || '', cost: 0, weightUnit: 'g',
                    })),
                    images: (p.images || []).map(im => ({ src: im.src, position: im.position, alt: im.alt || '' })),
                    translations: {},
                    _source: { method: 'shopify-collection', url: location.href },
                })),
            },
        };
        setStatus(`Coleção: ${collection.count} produtos`, 'ok');
        els.preview.style.display = 'none';
        els.btnSend.disabled = false;
    } catch (e) {
        setStatus('Erro: ' + e.message, 'fail');
    }
}

els.btnExtract.addEventListener('click', extract);
els.btnSend.addEventListener('click', sendToApp);
els.btnCollection.addEventListener('click', captureCollection);
els.btnClearQueue.addEventListener('click', async () => {
    await saveQueue([]);
    setStatus('Fila limpa', 'warn');
});

document.addEventListener('DOMContentLoaded', () => {
    extract();
    renderQueueCount();
});
