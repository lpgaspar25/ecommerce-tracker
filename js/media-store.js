/* ===========================
   MediaStore — IndexedDB blob storage for creative media (images + videos)
   Keeps heavy bytes OUT of localStorage (no quota issues). The app stores only
   a small `mediaId` reference + a tiny base64 thumbnail in localStorage.
   =========================== */

const MediaStore = (() => {
    const DB_NAME = 'etracker_media';
    const STORE = 'media';
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
                    db.createObjectStore(STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return _dbPromise;
    }

    // Store a Blob/File under id with optional metadata. Returns id.
    async function put(id, blob, meta = {}) {
        const db = await _open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put({ id, blob, type: blob.type || meta.type || '', name: meta.name || '', ...meta });
            tx.oncomplete = () => resolve(id);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('abort'));
        });
    }

    // Get the raw record { id, blob, type, name, ... } or null.
    async function get(id) {
        if (!id) return null;
        const db = await _open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const rq = tx.objectStore(STORE).get(id);
            rq.onsuccess = () => resolve(rq.result || null);
            rq.onerror = () => reject(rq.error);
        });
    }

    // Get an object URL for the stored blob (caller must revoke when done). Null if missing.
    async function getObjectUrl(id) {
        try {
            const rec = await get(id);
            if (!rec || !rec.blob) return null;
            return URL.createObjectURL(rec.blob);
        } catch { return null; }
    }

    async function del(id) {
        if (!id) return false;
        try {
            const db = await _open();
            return await new Promise((resolve) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete(id);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch { return false; }
    }

    // List all stored ids (for housekeeping / orphan cleanup).
    async function keys() {
        try {
            const db = await _open();
            return await new Promise((resolve) => {
                const tx = db.transaction(STORE, 'readonly');
                const rq = tx.objectStore(STORE).getAllKeys();
                rq.onsuccess = () => resolve(rq.result || []);
                rq.onerror = () => resolve([]);
            });
        } catch { return []; }
    }

    return {
        put, get, getObjectUrl, del, keys,
        isSupported: () => !!window.indexedDB,
    };
})();

if (typeof window !== 'undefined') window.MediaStore = MediaStore;
