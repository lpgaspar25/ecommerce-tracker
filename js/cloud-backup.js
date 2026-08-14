/* ================================================================
   Cloud Backup — portable account snapshot + authenticated media sync.
   Secrets are encrypted server-side; heavy blobs stay outside the snapshot.
   ================================================================ */
const CloudBackup = (() => {
    const API = '/api/cloud-backup';
    const MEDIA_API = '/api/cloud-media';
    const VERSION_KEY = 'etracker_cloud_snapshot_version';
    const DEVICE_KEY = 'etracker_cloud_device_id';
    const EXCLUDED_KEYS = /(^sb-|supabase|_cache|cache_|orders_cache|day_cache|etracker_skip_login|etracker_cloud_snapshot_version)/i;
    const state = { ready: false, syncing: false, lastSync: '', error: '', media: { uploaded: 0, downloaded: 0 } };
    let _timer = null;
    let _mediaQueue = Promise.resolve();
    let _restoringMedia = false;
    let _hooksInstalled = false;
    let _storageHookInstalled = false;

    function _syncModule() { return typeof SupabaseSync !== 'undefined' ? SupabaseSync : null; }
    function _appState() { return typeof AppState !== 'undefined' ? AppState : null; }

    function _deviceId() {
        let id = localStorage.getItem(DEVICE_KEY);
        if (!id) {
            id = `device_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
            localStorage.setItem(DEVICE_KEY, id);
        }
        return id;
    }

    async function _token() {
        const client = _syncModule()?.client;
        if (!client) return '';
        const { data } = await client.auth.getSession();
        return data?.session?.access_token || '';
    }

    async function _request(url, options = {}) {
        const token = await _token();
        if (!token) throw new Error('Entre na sua conta para usar o backup na nuvem');
        const response = await fetch(url, {
            ...options,
            headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` },
        });
        const contentType = response.headers.get('Content-Type') || '';
        if (!response.ok) {
            const body = contentType.includes('json') ? await response.json().catch(() => ({})) : {};
            throw new Error(body.error || `Nuvem respondeu ${response.status}`);
        }
        return response;
    }

    function _collectLocalStorage() {
        const data = {};
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key || EXCLUDED_KEYS.test(key)) continue;
            const value = localStorage.getItem(key);
            if (value != null) data[key] = value;
        }
        return data;
    }

    async function _collectKv() {
        const out = {};
        if (!window.KVStore?.isSupported?.()) return out;
        const keys = await KVStore.keys();
        for (const key of keys) {
            if (!key || EXCLUDED_KEYS.test(String(key))) continue;
            if (key === 'etracker_products' || key === 'etracker_diary') continue;
            try { out[key] = await KVStore.get(key, null); } catch {}
        }
        return out;
    }

    async function _collectSnapshot() {
        let fullProducts = null, fullDiary = null;
        try { fullProducts = await window.KVStore?.get?.('etracker_products', null); } catch {}
        try { fullDiary = await window.KVStore?.get?.('etracker_diary', null); } catch {}
        const app = _appState();
        return {
            schema: 1,
            deviceId: _deviceId(),
            capturedAt: new Date().toISOString(),
            localStorage: _collectLocalStorage(),
            kv: await _collectKv(),
            data: {
                stores: app?.stores || [],
                products: fullProducts || app?.allProducts || [],
                goals: app?.allGoals || [],
                diary: fullDiary || app?.allDiary || [],
                creatives: app?.allCreatives || [],
                creativeMetrics: app?.allCreativeMetrics || [],
                projects: app?.allProjects || [],
            },
        };
    }

    function _mergeArray(remote, local) {
        const out = [];
        const positions = new Map();
        [...(Array.isArray(remote) ? remote : []), ...(Array.isArray(local) ? local : [])].forEach((item, index) => {
            if (item == null) return;
            const id = item && typeof item === 'object' ? item.id : null;
            const key = id != null ? `id:${id}` : `value:${JSON.stringify(item)}:${index}`;
            if (positions.has(key)) out[positions.get(key)] = item;
            else { positions.set(key, out.length); out.push(item); }
        });
        return out;
    }

    function _mergeValue(remote, local) {
        if (Array.isArray(remote) || Array.isArray(local)) return _mergeArray(remote, local);
        if (local && typeof local === 'object') return { ...(remote || {}), ...local };
        return local !== undefined && local !== null && local !== '' ? local : remote;
    }

    function _mergeSnapshots(remote, local) {
        const data = {};
        const dataKeys = new Set([...Object.keys(remote?.data || {}), ...Object.keys(local?.data || {})]);
        dataKeys.forEach(key => { data[key] = _mergeValue(remote?.data?.[key], local?.data?.[key]); });

        const kv = {};
        const kvKeys = new Set([...Object.keys(remote?.kv || {}), ...Object.keys(local?.kv || {})]);
        kvKeys.forEach(key => { kv[key] = _mergeValue(remote?.kv?.[key], local?.kv?.[key]); });

        return {
            ...(remote || {}),
            schema: 1,
            capturedAt: new Date().toISOString(),
            deviceId: local?.deviceId || remote?.deviceId || _deviceId(),
            localStorage: { ...(remote?.localStorage || {}), ...(local?.localStorage || {}) },
            kv,
            data,
        };
    }

    function _dataFingerprint(snapshot) {
        const ids = [];
        Object.entries(snapshot?.data || {}).forEach(([key, value]) => {
            if (!Array.isArray(value)) return;
            value.forEach((item, index) => ids.push(`data:${key}:${item?.id ?? index}`));
        });
        Object.entries(snapshot?.kv || {}).forEach(([key, value]) => {
            if (!Array.isArray(value)) return;
            value.forEach((item, index) => ids.push(`kv:${key}:${item?.id ?? index}`));
        });
        Object.keys(snapshot?.localStorage || {}).forEach(key => ids.push(`ls:${key}`));
        return new Set(ids);
    }

    function _localHasUniqueData(remote, local) {
        const remoteIds = _dataFingerprint(remote);
        if ([..._dataFingerprint(local)].some(id => !remoteIds.has(id))) return true;
        const richness = value => {
            if (value == null || value === '') return 0;
            try {
                const parsed = typeof value === 'string' ? JSON.parse(value) : value;
                if (Array.isArray(parsed)) return parsed.length;
                if (parsed && Array.isArray(parsed.cards)) return parsed.cards.length;
                if (parsed && typeof parsed === 'object') return Object.keys(parsed).length;
            } catch {}
            return String(value).length > 2 ? 1 : 0;
        };
        return Object.entries(local?.localStorage || {}).some(([key, value]) =>
            richness(value) > richness(remote?.localStorage?.[key])
        );
    }

    async function _putSnapshot(snapshot) {
        const response = await _request(API, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(snapshot),
        });
        const result = await response.json();
        const version = result.updatedAt || new Date().toISOString();
        localStorage.setItem(VERSION_KEY, version);
        state.lastSync = version;
        return version;
    }

    async function backupNow({ quiet = false } = {}) {
        if (!_syncModule()?.isLoggedIn || state.syncing) return false;
        state.syncing = true; state.error = '';
        try {
            const snapshot = await _collectSnapshot();
            await _putSnapshot(snapshot);
            if (!quiet && typeof showToast === 'function') showToast('Conta salva na nuvem.', 'success');
            syncMedia().catch(error => console.warn('[CloudBackup] media:', error));
            return true;
        } catch (error) {
            state.error = String(error.message || error);
            console.error('[CloudBackup] backup:', error);
            if (!quiet && typeof showToast === 'function') showToast(`Falha no backup: ${state.error}`, 'error');
            return false;
        } finally { state.syncing = false; }
    }

    function schedule(delay = 1800) {
        if (!_syncModule()?.isLoggedIn) return;
        clearTimeout(_timer);
        _timer = setTimeout(() => backupNow({ quiet: true }), delay);
    }

    async function _applySnapshot(snapshot) {
        if (!snapshot || snapshot.schema !== 1) return false;
        const remoteVersion = snapshot.updatedAt || snapshot.capturedAt || '';
        const localVersion = localStorage.getItem(VERSION_KEY) || '';
        if (remoteVersion && localVersion === remoteVersion) return false;

        Object.entries(snapshot.localStorage || {}).forEach(([key, value]) => {
            if (key && !EXCLUDED_KEYS.test(key) && typeof value === 'string') localStorage.setItem(key, value);
        });
        if (window.KVStore?.isSupported?.()) {
            for (const [key, value] of Object.entries(snapshot.kv || {})) {
                if (key && !EXCLUDED_KEYS.test(key)) await KVStore.set(key, value);
            }
        }
        const data = snapshot.data || {};
        if (data.products) await KVStore.set('etracker_products', data.products);
        if (data.diary) await KVStore.set('etracker_diary', data.diary);
        if (typeof LocalStore !== 'undefined') {
            if (data.stores) LocalStore.save('stores', data.stores);
            if (data.goals) LocalStore.save('goals', data.goals);
            if (data.creatives) LocalStore.save('creatives', data.creatives);
            if (data.creativeMetrics) LocalStore.save('creative_metrics', data.creativeMetrics);
            if (data.projects) LocalStore.save('projects', data.projects);
        }
        localStorage.setItem(VERSION_KEY, remoteVersion);
        state.lastSync = remoteVersion;
        return true;
    }

    async function restoreOrSeed() {
        if (!_syncModule()?.isLoggedIn) return;
        try {
            const response = await _request(API);
            const { snapshot } = await response.json();
            if (!snapshot) {
                await backupNow({ quiet: true });
                return;
            }
            const local = await _collectSnapshot();
            let source = snapshot;
            // Limpar cookies pode zerar o navegador enquanto uma aba antiga
            // ainda guarda dados válidos em memória. Nunca deixe uma nuvem
            // incompleta apagar itens que existem localmente: mescle e grave
            // primeiro, preservando os dois lados.
            if (_localHasUniqueData(snapshot, local)) {
                source = _mergeSnapshots(snapshot, local);
                source.updatedAt = await _putSnapshot(source);
            }
            const changed = await _applySnapshot(source);
            if (changed) {
                sessionStorage.setItem('etracker_cloud_just_restored', '1');
                location.reload();
                return;
            }
            state.ready = true;
            syncMedia().catch(error => console.warn('[CloudBackup] media:', error));
        } catch (error) {
            state.error = String(error.message || error);
            console.error('[CloudBackup] restore:', error);
        }
    }

    async function _remoteMediaIndex() {
        const response = await _request(MEDIA_API);
        const data = await response.json();
        return Array.isArray(data.media) ? data.media : [];
    }

    async function _uploadMedia(id, record = null) {
        if (!id || !window.MediaStore) return;
        const rec = record || await MediaStore.get(id);
        if (!rec?.blob) return;
        await _request(`${MEDIA_API}?id=${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Media-Type': rec.blob.type || rec.type || '', 'X-Media-Name': encodeURIComponent(rec.name || id) },
            body: rec.blob,
        });
        state.media.uploaded++;
    }

    async function _downloadMedia(meta) {
        const response = await _request(`${MEDIA_API}?id=${encodeURIComponent(meta.id)}`);
        const blob = await response.blob();
        _restoringMedia = true;
        try { await MediaStore.put(meta.id, blob, { type: meta.type || blob.type, name: meta.name || meta.id }); }
        finally { _restoringMedia = false; }
        state.media.downloaded++;
    }

    async function syncMedia() {
        if (!_syncModule()?.isLoggedIn || !window.MediaStore?.isSupported?.()) return;
        const [remote, localIds] = await Promise.all([_remoteMediaIndex(), MediaStore.keys()]);
        const remoteMap = new Map(remote.map(item => [item.id, item]));
        const localSet = new Set(localIds.map(String));
        for (const id of localSet) if (!remoteMap.has(id)) await _uploadMedia(id);
        for (const meta of remote) if (!localSet.has(String(meta.id))) await _downloadMedia(meta);
    }

    function _installMediaHooks() {
        if (_hooksInstalled || !window.MediaStore) return;
        _hooksInstalled = true;
        const originalPut = MediaStore.put.bind(MediaStore);
        const originalDel = MediaStore.del.bind(MediaStore);
        MediaStore.put = async (id, blob, meta = {}) => {
            const result = await originalPut(id, blob, meta);
            if (!_restoringMedia && _syncModule()?.isLoggedIn) {
                _mediaQueue = _mediaQueue.then(() => _uploadMedia(id)).catch(error => console.warn('[CloudBackup] upload:', error));
                schedule();
            }
            return result;
        };
        MediaStore.del = async id => {
            const result = await originalDel(id);
            if (_syncModule()?.isLoggedIn) {
                _mediaQueue = _mediaQueue.then(() => _request(`${MEDIA_API}?id=${encodeURIComponent(id)}`, { method: 'DELETE' })).catch(() => {});
                schedule();
            }
            return result;
        };
    }

    function _installStorageHook() {
        if (_storageHookInstalled || typeof Storage === 'undefined') return;
        _storageHookInstalled = true;
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            const result = originalSetItem.call(this, key, value);
            if (this === localStorage && key && !EXCLUDED_KEYS.test(String(key))) schedule();
            return result;
        };
    }

    function _bindEvents() {
        if (typeof EventBus !== 'undefined') {
            ['diaryChanged','productsChanged','goalsChanged','creativesChanged','projectsChanged','storeChanged'].forEach(event => EventBus.on(event, () => schedule()));
        }
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') schedule(0); });
        window.addEventListener('online', () => schedule(300));
        setInterval(() => schedule(0), 60000);
    }

    async function init() {
        if (!_syncModule()?.isLoggedIn) return;
        _installMediaHooks();
        _installStorageHook();
        _bindEvents();
        await restoreOrSeed();
    }

    return { init, backupNow, restoreOrSeed, syncMedia, schedule, state };
})();

window.CloudBackup = CloudBackup;
