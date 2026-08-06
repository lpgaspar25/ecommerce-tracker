/* ===========================
   KVStore — IndexedDB genérico pra dado JSON estruturado (não-blob).
   Existe pra tirar do localStorage as chaves que só crescem (histórico de
   testes do Laboratório, cache de pedidos por dia da Shopify) — localStorage
   tem teto fixo de ~5-10MB por site; IndexedDB escala com o disco livre.
   Guarda o valor já desserializado (sem JSON.stringify/parse manual).
   =========================== */

const KVStore = (() => {
    const DB_NAME = 'etracker_kv';
    const STORE = 'kv';
    const VERSION = 1;
    let _dbPromise = null;

    function _open() {
        if (_dbPromise) return _dbPromise;
        _dbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) { reject(new Error('IndexedDB indisponível')); return; }
            let req;
            try { req = indexedDB.open(DB_NAME, VERSION); }
            catch (e) { reject(e); return; }
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'key' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return _dbPromise;
    }

    // Retorna o valor guardado, ou `fallback` se a chave não existe.
    async function get(key, fallback = null) {
        const db = await _open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const rq = tx.objectStore(STORE).get(key);
            rq.onsuccess = () => resolve(rq.result ? rq.result.value : fallback);
            rq.onerror = () => reject(rq.error);
        });
    }

    async function set(key, value) {
        const db = await _open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put({ key, value });
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('abort'));
        });
    }

    async function del(key) {
        const db = await _open();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    }

    // Lista as chaves guardadas; `prefix` filtra (usado pra achar backups).
    async function keys(prefix) {
        try {
            const db = await _open();
            return await new Promise((resolve) => {
                const tx = db.transaction(STORE, 'readonly');
                const rq = tx.objectStore(STORE).getAllKeys();
                rq.onsuccess = () => resolve((rq.result || []).filter(k => !prefix || String(k).startsWith(prefix)));
                rq.onerror = () => resolve([]);
            });
        } catch { return []; }
    }

    return {
        get, set, del, keys,
        isSupported: () => !!window.indexedDB,
    };
})();

if (typeof window !== 'undefined') window.KVStore = KVStore;
