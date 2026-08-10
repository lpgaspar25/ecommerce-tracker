/* ===========================
   RefBank — banco de fotos de referência reutilizáveis
   Guarda imagens que o usuário quer reaproveitar como REFERÊNCIA de estilo/
   composição/dimensão ao editar ou gerar fotos por IA (ex.: uma foto de
   óculos com o enquadramento/escala certos, pra aplicar num produto novo).

   Armazenamento espelha o resto do app: o BLOB pesado vai pro IndexedDB
   (MediaStore), e só um índice leve (thumb + metadados) fica no localStorage
   — nunca base64 grande no localStorage, que estoura a cota.

   Chaveado por LOJA (getWritableStoreId): cada loja tem seu próprio banco,
   alinhado com a decisão de "tudo separado por loja". Sem loja definida cai
   num balde '_global'.
   =========================== */
const RefBank = (() => {
    const INDEX_KEY = 'etracker_ref_bank';

    function _storeId() {
        return (typeof getWritableStoreId === 'function' ? getWritableStoreId() : '') || '_global';
    }
    function _index() {
        try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}'); } catch { return {}; }
    }
    function _save(ix) {
        try { localStorage.setItem(INDEX_KEY, JSON.stringify(ix)); } catch (e) { console.warn('[RefBank] não consegui salvar o índice:', e.message); }
    }

    // Refs da loja atual, mais recentes primeiro.
    function list() {
        const arr = _index()[_storeId()] || [];
        return arr.slice().sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
    }

    async function add(blob, meta = {}) {
        if (!blob || typeof MediaStore === 'undefined' || !MediaStore.isSupported()) return null;
        const id = 'ref_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const mediaId = 'refbank_' + id;
        await MediaStore.put(mediaId, blob, { type: blob.type });
        let thumb = '';
        try {
            thumb = await comprimirImagemParaDataUrl(blob, 220, 0.6, { formato: 'image/webp' });
        } catch (e) { console.warn('[RefBank] thumb falhou:', e.message); }
        const rec = {
            id, mediaId, thumb,
            rotulo: meta.rotulo || 'Referência',
            origem: meta.origem || '',
            criadoEm: new Date().toISOString(),
        };
        const ix = _index();
        const sid = _storeId();
        ix[sid] = ix[sid] || [];
        ix[sid].unshift(rec);
        _save(ix);
        return rec;
    }

    // Blob cheio de uma ref (pra usar como referência na IA).
    async function getBlob(id) {
        const rec = list().find(x => x.id === id);
        if (!rec || typeof MediaStore === 'undefined') return null;
        const m = await MediaStore.get(rec.mediaId);
        return m?.blob || null;
    }

    async function remove(id) {
        const ix = _index();
        const sid = _storeId();
        const arr = ix[sid] || [];
        const rec = arr.find(x => x.id === id);
        if (!rec) return;
        try { if (typeof MediaStore !== 'undefined') await MediaStore.del(rec.mediaId); } catch {}
        ix[sid] = arr.filter(x => x.id !== id);
        _save(ix);
    }

    return { list, add, getBlob, remove };
})();
window.RefBank = RefBank;
