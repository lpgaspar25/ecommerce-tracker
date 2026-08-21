/* ===========================
   Páginas A/B — biblioteca de páginas de produto por produto.

   Cada produto pode ter VÁRIAS páginas salvas (3, 4, 8…) pra teste A/B. Cada
   página guarda: nome, custo, preço, variantes (editáveis), descrição em
   blocos (texto+imagem, igual ao Lançamento) e fotos de capa. Tudo fica salvo
   NO APP (IndexedDB) — nada vai ao ar sozinho. O usuário lista, compara,
   edita, marca uma como ativa e publica na Shopify quando quiser.

   Onde vive: gerenciado pela aba Produtos (botão "Páginas A/B" no menu de cada
   produto) e editável pelo Estúdio (fluxo Lançamento) via
   LancamentoModule.editarPaginaAB().

   Armazenamento: metadados das páginas em KVStore (chave 'etracker_ab_pages'),
   nunca no localStorage (evita o teto de ~5MB). Fotos ficam no MediaStore
   (blobs) referenciadas por mediaId — o MESMO shape que o LancamentoModule usa
   em _state.fotos ({ id, mediaId, thumb, origem }), pra o hand-off pro editor
   do Estúdio ser trivial.
   =========================== */

const ABPagesModule = (() => {
    const STORE_KEY = 'etracker_ab_pages';
    const MOEDAS = ['USD', 'BRL', 'EUR', 'GBP', 'AUD', 'CAD'];

    let _pages = null;        // cache em memória (array) — null = ainda não carregado
    let _loadPromise = null;
    let _managerProductId = null;
    let _thumbUrls = [];      // objectURLs abertos no manager (revogados ao fechar)

    // ── Persistência ──────────────────────────────────────────────────────
    async function _ensureLoaded() {
        if (_pages) return _pages;
        if (_loadPromise) return _loadPromise;
        _loadPromise = (async () => {
            try {
                _pages = (await KVStore.get(STORE_KEY)) || [];
            } catch (e) {
                console.warn('[ABPages] falha ao carregar', e);
                _pages = [];
            }
            if (!Array.isArray(_pages)) _pages = [];
            return _pages;
        })();
        return _loadPromise;
    }

    async function _persist() {
        try {
            await KVStore.set(STORE_KEY, _pages || []);
        } catch (e) {
            console.warn('[ABPages] falha ao salvar', e);
            if (typeof showToast === 'function') showToast('Não consegui salvar as páginas A/B.', 'error');
        }
    }

    function _findProduct(productId) {
        return (AppState.allProducts || []).find(p => p.id === productId) || null;
    }

    // ── Modelo ────────────────────────────────────────────────────────────
    function _novaPagina(productId, dados = {}) {
        const prod = _findProduct(productId);
        return {
            id: generateId('abpage'),
            productId,
            storeId: (prod && prod.storeId) || AppState.currentStoreId || '',
            nome: dados.nome || (prod ? prod.name : '') || 'Nova página',
            custo: Number(dados.custo) || (prod ? Number(prod.cost) || 0 : 0),
            custoMoeda: dados.custoMoeda || (prod && prod.costCurrency) || (prod && prod.priceCurrency) || 'USD',
            preco: Number(dados.preco) || (prod ? Number(prod.price) || 0 : 0),
            precoMoeda: dados.precoMoeda || (prod && prod.priceCurrency) || 'USD',
            compareAt: Number(dados.compareAt) || 0,
            opcaoNome: dados.opcaoNome || 'Opção',
            variantes: Array.isArray(dados.variantes) ? dados.variantes.map(_normalizarVariante) : [],
            blocos: Array.isArray(dados.blocos) ? dados.blocos : [],
            fotos: Array.isArray(dados.fotos) ? dados.fotos : [],   // { id, mediaId, thumb, origem }
            // Snapshot no formato-de-produto (usado pelas abas Chrome do editor
            // de produto). Quando presente, é a fonte de verdade da página.
            dados: (dados.dados && typeof dados.dados === 'object') ? dados.dados : null,
            capaFotoId: dados.capaFotoId || '',
            descricaoHtml: dados.descricaoHtml || '',                // cache de preview quando não há blocos
            ativa: false,
            origem: dados.origem || 'manual',                        // 'manual' | 'produto' | 'variacao' | 'molde'
            criadoEm: new Date().toISOString(),
            atualizadoEm: new Date().toISOString(),
        };
    }

    function _normalizarVariante(v) {
        return {
            id: v.id || generateId('abvar'),
            nome: (v.nome || '').trim(),
            preco: Number(v.preco) || 0,
            custo: Number(v.custo) || 0,
            sku: (v.sku || '').trim(),
        };
    }

    // ── API pública de dados ──────────────────────────────────────────────
    async function getForProduct(productId) {
        await _ensureLoaded();
        return _pages
            .filter(p => p.productId === productId)
            .sort((a, b) => (b.ativa ? 1 : 0) - (a.ativa ? 1 : 0)
                || (b.atualizadoEm || '').localeCompare(a.atualizadoEm || ''));
    }

    async function countForProduct(productId) {
        await _ensureLoaded();
        return _pages.filter(p => p.productId === productId).length;
    }

    async function save(page) {
        await _ensureLoaded();
        page.atualizadoEm = new Date().toISOString();
        const idx = _pages.findIndex(p => p.id === page.id);
        if (idx >= 0) _pages[idx] = page; else _pages.unshift(page);
        await _persist();
        if (typeof EventBus !== 'undefined') EventBus.emit('abPagesChanged', page.productId);
        return page;
    }

    async function saveMany(pages) {
        await _ensureLoaded();
        const now = new Date().toISOString();
        pages.forEach(page => {
            page.atualizadoEm = now;
            const idx = _pages.findIndex(p => p.id === page.id);
            if (idx >= 0) _pages[idx] = page; else _pages.unshift(page);
        });
        await _persist();
        if (typeof EventBus !== 'undefined' && pages[0]) EventBus.emit('abPagesChanged', pages[0].productId);
        return pages;
    }

    async function getById(id) {
        await _ensureLoaded();
        return _pages.find(p => p.id === id) || null;
    }

    async function remove(id) {
        await _ensureLoaded();
        const page = _pages.find(p => p.id === id);
        _pages = _pages.filter(p => p.id !== id);
        await _persist();
        if (typeof EventBus !== 'undefined' && page) EventBus.emit('abPagesChanged', page.productId);
    }

    async function setActive(productId, pageId) {
        await _ensureLoaded();
        _pages.forEach(p => {
            if (p.productId === productId) p.ativa = (p.id === pageId);
        });
        await _persist();
        if (typeof EventBus !== 'undefined') EventBus.emit('abPagesChanged', productId);
    }

    async function duplicate(id) {
        await _ensureLoaded();
        const original = _pages.find(p => p.id === id);
        if (!original) return null;
        const copia = JSON.parse(JSON.stringify(original));
        copia.id = generateId('abpage');
        copia.nome = original.nome + ' (cópia)';
        copia.ativa = false;
        copia.criadoEm = copia.atualizadoEm = new Date().toISOString();
        // variantes ganham ids próprios pra não colidir com a original
        copia.variantes = (copia.variantes || []).map(v => ({ ...v, id: generateId('abvar') }));
        _pages.unshift(copia);
        await _persist();
        if (typeof EventBus !== 'undefined') EventBus.emit('abPagesChanged', copia.productId);
        return copia;
    }

    // Cria uma página semeada a partir dos dados do próprio produto (nome,
    // preço, custo, descrição e fotos). Importa as fotos base64 do produto pro
    // MediaStore pra ficarem editáveis no Estúdio como qualquer outra foto.
    async function createFromProduct(productId) {
        const prod = _findProduct(productId);
        if (!prod) return null;
        const fotos = [];
        const imgs = (prod.images || []).slice(0, 8);
        for (const img of imgs) {
            const src = img.dataUrl || img.url;
            if (!src) continue;
            try {
                const blob = await _srcParaBlob(src);
                if (!blob) continue;
                const mediaId = generateId('abmedia');
                await MediaStore.put(mediaId, blob, { name: img.name || '' });
                const thumb = await _blobParaThumb(blob);
                fotos.push({ id: generateId('abfoto'), mediaId, thumb, origem: 'Produto' });
            } catch (e) {
                console.warn('[ABPages] falha ao importar foto do produto', e);
            }
        }
        const blocos = [];
        if (prod.description) blocos.push({ tipo: 'texto', html: _semScript(prod.description) });
        const page = _novaPagina(productId, {
            nome: prod.name,
            custo: Number(prod.cost) || 0,
            custoMoeda: prod.costCurrency || prod.priceCurrency || 'USD',
            preco: Number(prod.price) || 0,
            precoMoeda: prod.priceCurrency || 'USD',
            variantes: (prod.shopifyVariants || []).map(v => ({
                nome: v.title || '', preco: Number(v.price) || Number(prod.price) || 0, custo: 0, sku: v.sku || '',
            })),
            blocos,
            fotos,
            capaFotoId: fotos[0]?.id || '',
            descricaoHtml: prod.description || '',
            origem: 'produto',
        });
        await save(page);
        return page;
    }

    // ── Helpers de imagem ─────────────────────────────────────────────────
    async function _srcParaBlob(src) {
        if (!src) return null;
        if (typeof src === 'string' && src.startsWith('data:')) {
            const res = await fetch(src);
            return await res.blob();
        }
        // URL remota (CDN Shopify) — tenta baixar; se CORS bloquear, ignora.
        try {
            const res = await fetch(src, { mode: 'cors' });
            if (res.ok) return await res.blob();
        } catch {}
        return null;
    }

    function _blobParaThumb(blob) {
        // Miniatura base64 pequena pra caber inline no objeto da página (sem
        // estourar cota) — mesma ideia dos thumbs do Lançamento.
        return new Promise((resolve) => {
            try {
                const url = URL.createObjectURL(blob);
                const img = new Image();
                img.onload = () => {
                    const max = 240;
                    let { width, height } = img;
                    if (width > height && width > max) { height = height * max / width; width = max; }
                    else if (height > max) { width = width * max / height; height = max; }
                    const cv = document.createElement('canvas');
                    cv.width = width; cv.height = height;
                    cv.getContext('2d').drawImage(img, 0, 0, width, height);
                    URL.revokeObjectURL(url);
                    try { resolve(cv.toDataURL('image/webp', 0.7)); } catch { resolve(''); }
                };
                img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
                img.src = url;
            } catch { resolve(''); }
        });
    }

    // Remove <script>/on*-handlers de um HTML de descrição herdado (defesa
    // básica — a descrição do produto pode ter vindo de import externo).
    function _semScript(html) {
        return String(html || '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/ on\w+="[^"]*"/gi, '')
            .replace(/ on\w+='[^']*'/gi, '');
    }

    function _esc(s) { return escapeHtml(s); }

    // ── Gerenciador (aba Produtos) ────────────────────────────────────────
    async function openManager(productId) {
        _managerProductId = productId;
        const prod = _findProduct(productId);
        if (!prod) { if (typeof showToast === 'function') showToast('Produto não encontrado.', 'error'); return; }

        document.getElementById('ab-pages-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'ab-pages-modal';
        modal.className = 'modal ab-modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content ab-modal-content">
                <div class="modal-header">
                    <h3><i data-lucide="git-compare" style="width:18px;height:18px;vertical-align:-3px"></i> Páginas A/B — ${_esc(prod.name)}</h3>
                    <button class="btn-close" id="ab-close">&times;</button>
                </div>
                <div class="ab-body" id="ab-body">
                    <p class="ab-hint">${window.loadingHTML ? window.loadingHTML('Carregando páginas…') : 'Carregando…'}</p>
                </div>
            </div>`;
        document.body.appendChild(modal);
        _icones();

        const close = () => { _revogarThumbs(); modal.remove(); };
        document.getElementById('ab-close')?.addEventListener('click', close);
        modal.querySelector('.modal-overlay')?.addEventListener('click', close);
        // Edições de campo salvam silenciosamente no blur (sem re-render, pra
        // não colapsar variantes/scroll no meio da digitação). Ações
        // estruturais (add/remover/duplicar/ativar) chamam _renderManager().

        await _renderManager();
    }

    async function _renderManager() {
        const body = document.getElementById('ab-body');
        if (!body) return;
        _revogarThumbs();
        const productId = _managerProductId;
        const pages = await getForProduct(productId);

        const toolbar = `
            <div class="ab-toolbar">
                <div class="ab-toolbar-left">
                    <button type="button" class="btn btn-secondary btn-sm" id="ab-nova"><i data-lucide="plus" style="width:13px;height:13px"></i> Página em branco</button>
                    <button type="button" class="btn btn-secondary btn-sm" id="ab-do-produto"><i data-lucide="copy" style="width:13px;height:13px"></i> A partir deste produto</button>
                </div>
                <div class="ab-toolbar-right">
                    <span class="ab-gerar-label">Gerar variações (A/B) no Estúdio:</span>
                    ${[3, 4, 8].map(n => `<button type="button" class="btn btn-primary btn-sm ab-gerar" data-qtd="${n}">${n}</button>`).join('')}
                </div>
            </div>`;

        let listHtml;
        if (!pages.length) {
            listHtml = `<div class="ab-empty">
                <i data-lucide="layout-template" style="width:38px;height:38px;color:var(--text-muted)"></i>
                <h4>Nenhuma página salva ainda</h4>
                <p>Crie uma página em branco, copie deste produto, ou gere 3/4/8 variações com IA no Estúdio. Todas ficam salvas aqui pra você trocar quando quiser.</p>
            </div>`;
        } else {
            listHtml = `<div class="ab-cards">${(await Promise.all(pages.map(_renderCard))).join('')}</div>`;
        }

        body.innerHTML = toolbar + listHtml;
        _icones();
        _bindManager(body, productId);
    }

    async function _renderCard(page) {
        const capa = page.fotos.find(f => f.id === page.capaFotoId) || page.fotos[0];
        let capaSrc = capa?.thumb || '';
        if (!capaSrc && capa?.mediaId) {
            const url = await MediaStore.getObjectUrl(capa.mediaId);
            if (url) { _thumbUrls.push(url); capaSrc = url; }
        }
        // Página criada pelo editor de produto (só tem .dados) — usa a 1ª imagem.
        if (!capaSrc && page.dados && Array.isArray(page.dados.images) && page.dados.images[0]) {
            capaSrc = page.dados.images[0].dataUrl || page.dados.images[0].url || '';
        }
        // Páginas do editor têm o conteúdo em .dados (não em fotos/blocos).
        const temImg = page.dados && Array.isArray(page.dados.images) ? page.dados.images.length : 0;
        const temDesc = page.dados && page.dados.description ? 1 : 0;
        const nVar = (page.variantes || []).length;
        const nFotos = (page.fotos || []).length || temImg;
        const nBlocos = (page.blocos || []).length || (page.descricaoHtml || temDesc ? 1 : 0);
        return `
        <div class="ab-card ${page.ativa ? 'ab-card-ativa' : ''}" data-id="${page.id}">
            <div class="ab-card-capa">
                ${capaSrc ? `<img src="${_esc(capaSrc)}" alt="" loading="lazy">` : '<span class="ab-card-capa-vazia"><i data-lucide="image"></i></span>'}
                ${page.ativa ? '<span class="ab-badge-ativa"><i data-lucide="check" style="width:11px;height:11px"></i> Ativa</span>' : ''}
            </div>
            <div class="ab-card-corpo">
                <label class="ab-field">
                    <span>Nome</span>
                    <input type="text" class="input input-sm ab-in" data-campo="nome" value="${_esc(page.nome)}">
                </label>
                <div class="ab-field-row">
                    <label class="ab-field">
                        <span>Preço</span>
                        <div class="ab-money">
                            <input type="number" step="0.01" min="0" class="input input-sm ab-in" data-campo="preco" value="${Number(page.preco) || 0}">
                            <select class="input input-sm ab-in ab-moeda" data-campo="precoMoeda">${_moedaOpts(page.precoMoeda)}</select>
                        </div>
                    </label>
                    <label class="ab-field">
                        <span>Custo</span>
                        <div class="ab-money">
                            <input type="number" step="0.01" min="0" class="input input-sm ab-in" data-campo="custo" value="${Number(page.custo) || 0}">
                            <select class="input input-sm ab-in ab-moeda" data-campo="custoMoeda">${_moedaOpts(page.custoMoeda)}</select>
                        </div>
                    </label>
                </div>
                <details class="ab-variantes" ${nVar ? '' : ''}>
                    <summary><i data-lucide="list" style="width:12px;height:12px;vertical-align:-2px"></i> Variantes (${nVar})</summary>
                    ${_renderVariantesEditor(page)}
                </details>
                <div class="ab-card-meta">
                    <span title="Fotos de capa/galeria"><i data-lucide="image" style="width:12px;height:12px;vertical-align:-2px"></i> ${nFotos}</span>
                    <span title="Blocos de descrição"><i data-lucide="file-text" style="width:12px;height:12px;vertical-align:-2px"></i> ${nBlocos}</span>
                </div>
            </div>
            <div class="ab-card-acoes">
                ${page.ativa ? '' : '<button type="button" class="btn btn-secondary btn-sm ab-ativar" title="Marcar como página ativa"><i data-lucide="check-circle" style="width:13px;height:13px"></i> Tornar ativa</button>'}
                <button type="button" class="btn btn-secondary btn-sm ab-editar" title="Abrir esta página como aba no editor de produto"><i data-lucide="pencil" style="width:13px;height:13px"></i> Editar</button>
                <button type="button" class="btn btn-secondary btn-sm ab-publicar" title="Publicar esta página na Shopify"><i data-lucide="upload-cloud" style="width:13px;height:13px"></i> Publicar</button>
                <button type="button" class="btn-icon ab-duplicar" title="Duplicar"><i data-lucide="copy" style="width:13px;height:13px"></i></button>
                <button type="button" class="btn-icon ab-excluir" title="Excluir"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
            </div>
        </div>`;
    }

    function _renderVariantesEditor(page) {
        const rows = (page.variantes || []).map(v => `
            <tr data-vid="${v.id}">
                <td><input type="text" class="input input-sm ab-var-in" data-vcampo="nome" value="${_esc(v.nome)}" placeholder="Ex.: Preto / M"></td>
                <td><input type="number" step="0.01" min="0" class="input input-sm ab-var-in" data-vcampo="preco" value="${Number(v.preco) || 0}"></td>
                <td><input type="number" step="0.01" min="0" class="input input-sm ab-var-in" data-vcampo="custo" value="${Number(v.custo) || 0}"></td>
                <td><input type="text" class="input input-sm ab-var-in" data-vcampo="sku" value="${_esc(v.sku)}" placeholder="SKU"></td>
                <td><button type="button" class="btn-icon ab-var-remover" title="Remover variante"><i data-lucide="x" style="width:12px;height:12px"></i></button></td>
            </tr>`).join('');
        return `
            <div class="ab-var-wrap">
                <table class="ab-var-table">
                    <thead><tr><th>Variante</th><th>Preço</th><th>Custo</th><th>SKU</th><th></th></tr></thead>
                    <tbody class="ab-var-body">${rows || '<tr class="ab-var-vazia"><td colspan="5">Sem variantes — o preço/custo acima valem pro produto todo.</td></tr>'}</tbody>
                </table>
                <button type="button" class="btn btn-secondary btn-sm ab-var-add"><i data-lucide="plus" style="width:12px;height:12px"></i> Adicionar variante</button>
            </div>`;
    }

    function _moedaOpts(sel) {
        return MOEDAS.map(m => `<option value="${m}" ${m === sel ? 'selected' : ''}>${m}</option>`).join('');
    }

    function _bindManager(body, productId) {
        body.querySelector('#ab-nova')?.addEventListener('click', async () => {
            const page = _novaPagina(productId, {});
            await save(page);
            _renderManager();
        });
        body.querySelector('#ab-do-produto')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget; btn.disabled = true;
            try { await createFromProduct(productId); } finally { btn.disabled = false; }
            _renderManager();
        });
        body.querySelectorAll('.ab-gerar').forEach(btn => {
            btn.addEventListener('click', () => {
                const qtd = parseInt(btn.dataset.qtd, 10);
                if (typeof LancamentoModule === 'undefined' || !LancamentoModule.gerarVariacoesParaProduto) {
                    showToast('Módulo de Lançamento indisponível — recarregue a página.', 'error');
                    return;
                }
                _revogarThumbs();
                document.getElementById('ab-pages-modal')?.remove();
                LancamentoModule.gerarVariacoesParaProduto(productId, qtd);
            });
        });

        // Ações por card
        body.querySelectorAll('.ab-card').forEach(card => {
            const id = card.dataset.id;
            const getPage = async () => (await _ensureLoaded(), _pages.find(p => p.id === id));

            // Campos simples (nome/preço/custo/moedas) — salva no blur/change
            card.querySelectorAll('.ab-in').forEach(inp => {
                inp.addEventListener('change', async () => {
                    const page = await getPage(); if (!page) return;
                    const campo = inp.dataset.campo;
                    page[campo] = (campo === 'preco' || campo === 'custo' || campo === 'compareAt')
                        ? (parseFloat(inp.value) || 0) : inp.value;
                    await save(page);
                });
            });

            // Variantes
            const rebindVar = () => _bindVariantes(card, id);
            rebindVar();

            card.querySelector('.ab-ativar')?.addEventListener('click', async () => {
                await setActive(productId, id); _renderManager();
            });
            card.querySelector('.ab-duplicar')?.addEventListener('click', async () => {
                await duplicate(id); _renderManager();
            });
            card.querySelector('.ab-excluir')?.addEventListener('click', async () => {
                const page = await getPage();
                if (!confirm(`Excluir a página "${page?.nome || ''}"? As fotos continuam guardadas.`)) return;
                await remove(id); _renderManager();
            });
            card.querySelector('.ab-editar')?.addEventListener('click', () => {
                if (typeof ProductsModule === 'undefined' || !ProductsModule.openProductEditorOnPage) {
                    showToast('Editor de produto indisponível — recarregue a página.', 'error');
                    return;
                }
                _revogarThumbs();
                document.getElementById('ab-pages-modal')?.remove();
                ProductsModule.openProductEditorOnPage(productId, id);
            });
            card.querySelector('.ab-publicar')?.addEventListener('click', async (e) => {
                const btn = e.currentTarget; btn.disabled = true;
                try { await publish(id); } finally { btn.disabled = false; }
            });
        });
    }

    function _bindVariantes(card, pageId) {
        const getPage = async () => (await _ensureLoaded(), _pages.find(p => p.id === pageId));

        card.querySelectorAll('.ab-var-in').forEach(inp => {
            inp.addEventListener('change', async () => {
                const page = await getPage(); if (!page) return;
                const vid = inp.closest('tr').dataset.vid;
                const v = (page.variantes || []).find(x => x.id === vid);
                if (!v) return;
                const c = inp.dataset.vcampo;
                v[c] = (c === 'preco' || c === 'custo') ? (parseFloat(inp.value) || 0) : inp.value;
                await save(page);
            });
        });
        card.querySelectorAll('.ab-var-remover').forEach(btn => {
            btn.addEventListener('click', async () => {
                const page = await getPage(); if (!page) return;
                const vid = btn.closest('tr').dataset.vid;
                page.variantes = (page.variantes || []).filter(x => x.id !== vid);
                await save(page);
                _renderManager();
            });
        });
        card.querySelector('.ab-var-add')?.addEventListener('click', async () => {
            const page = await getPage(); if (!page) return;
            if (!Array.isArray(page.variantes)) page.variantes = [];
            page.variantes.push(_normalizarVariante({ nome: '' }));
            await save(page);
            _renderManager();
        });
    }

    // ── Snapshot no formato-de-produto (abas Chrome do editor de produto) ──
    function _blobParaDataUrl(blob) {
        return new Promise((res) => {
            try {
                const r = new FileReader();
                r.onload = () => res(r.result);
                r.onerror = () => res('');
                r.readAsDataURL(blob);
            } catch { res(''); }
        });
    }

    // Devolve os dados da página no MESMO formato do formulário do editor de
    // produto (o que ProductsModule._getFormData() produz). Se a página já tem
    // .dados, é ele; senão converte o legado (blocos/fotos/preço/custo).
    async function getEditorData(page) {
        if (!page) return null;
        const prod = _findProduct(page.productId);
        if (page.dados && typeof page.dados === 'object') {
            const d = JSON.parse(JSON.stringify(page.dados));
            d.id = page.productId;
            d.storeId = page.storeId || d.storeId || '';
            // Variantes da Shopify são read-only e vivem no produto — herda pra
            // a aba mostrar a seção Variantes igual à aba Original.
            if (!d.shopifyVariants && prod) d.shopifyVariants = prod.shopifyVariants || [];
            if (!d.shopifyOptions && prod) d.shopifyOptions = prod.shopifyOptions || [];
            return d;
        }
        // Descrição: blocos → HTML (imagens do MediaStore viram <img> base64)
        let descHtml = '';
        if (Array.isArray(page.blocos) && page.blocos.length) {
            const parts = [];
            for (const b of page.blocos) {
                if (b.tipo === 'texto') { parts.push(_semScript(b.html || '')); continue; }
                if (b.tipo === 'imagem' && b.fotoId) {
                    const f = (page.fotos || []).find(x => x.id === b.fotoId);
                    if (f && f.mediaId) {
                        const rec = await MediaStore.get(f.mediaId);
                        if (rec && rec.blob) { const u = await _blobParaDataUrl(rec.blob); if (u) parts.push(`<img src="${u}" alt="">`); }
                    }
                }
            }
            descHtml = parts.join('');
        } else {
            descHtml = _semScript(page.descricaoHtml || '');
        }
        // Fotos → imagens base64 (formato do editor: { dataUrl, name })
        const images = [];
        for (const f of (page.fotos || [])) {
            if (f && f.mediaId) {
                const rec = await MediaStore.get(f.mediaId);
                if (rec && rec.blob) { const u = await _blobParaDataUrl(rec.blob); if (u) { images.push({ dataUrl: u, name: f.origem || '' }); continue; } }
            }
            if (f && f.thumb) images.push({ dataUrl: f.thumb, name: f.origem || '' });
        }
        return {
            id: page.productId,
            name: page.nome || '',
            description: descHtml,
            price: Number(page.preco) || 0, priceCurrency: page.precoMoeda || 'USD',
            cost: Number(page.custo) || 0, costCurrency: page.custoMoeda || 'USD',
            tax: prod ? Number(prod.tax) || 0 : 0,
            variableCosts: prod ? Number(prod.variableCosts) || 0 : 0,
            cpa: 0, cpaCurrency: page.precoMoeda || 'USD',
            status: 'ativo', vendor: (prod && prod.vendor) || '', sku: '', tags: [],
            countryPrices: [], images, translations: {},
            languages: prod ? (prod.languages || []) : [],
            platforms: prod ? (prod.platforms || []) : [],
            fbAdAccountIds: prod ? (prod.fbAdAccountIds || []) : [],
            googleAdAccountIds: prod ? (prod.googleAdAccountIds || []) : [],
            fbAdAccountLabels: prod ? (prod.fbAdAccountLabels || {}) : {},
            googleAdAccountLabels: prod ? (prod.googleAdAccountLabels || {}) : {},
            campaignGroupUrl: prod ? (prod.campaignGroupUrl || '') : '',
            pageUrl: prod ? (prod.pageUrl || '') : '',
            shopifyVariants: prod ? (prod.shopifyVariants || []) : [],
            shopifyOptions: prod ? (prod.shopifyOptions || []) : [],
            storeId: page.storeId || '',
        };
    }

    // Cria uma página a partir de um snapshot no formato-de-produto (o "+" das
    // abas Chrome duplica a aba atual com estes dados).
    async function createFromDados(productId, nome, dados) {
        await _ensureLoaded();
        const page = _novaPagina(productId, {
            nome: nome || (dados && dados.name) || 'Nova página',
            preco: dados ? Number(dados.price) || 0 : 0,
            precoMoeda: (dados && dados.priceCurrency) || 'USD',
            custo: dados ? Number(dados.cost) || 0 : 0,
            custoMoeda: (dados && dados.costCurrency) || 'USD',
            origem: 'editor',
        });
        page.dados = dados ? JSON.parse(JSON.stringify(dados)) : null;
        await save(page);
        return page;
    }

    // Grava o snapshot de edição de volta na página, espelhando os campos que o
    // gerenciador mostra (nome/preço/custo). meta: { nome, ativa }.
    async function saveEditorData(pageId, dados, meta = {}) {
        await _ensureLoaded();
        const page = _pages.find(p => p.id === pageId);
        if (!page) return null;
        page.dados = dados ? JSON.parse(JSON.stringify(dados)) : null;
        page.nome = (meta.nome != null) ? meta.nome : ((dados && dados.name) || page.nome);
        if (dados) {
            page.preco = Number(dados.price) || 0;
            page.precoMoeda = dados.priceCurrency || page.precoMoeda || 'USD';
            page.custo = Number(dados.cost) || 0;
            page.custoMoeda = dados.costCurrency || page.custoMoeda || 'USD';
        }
        if (meta.ativa != null) page.ativa = !!meta.ativa;
        await save(page);
        return page;
    }

    // ── Publicação na Shopify (reaproveita o fluxo do Importador) ──────────
    async function publish(pageId) {
        const page = await getById(pageId);
        if (!page) return;
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured || !ShopifyModule.isConfigured()) {
            showToast('Conecte a Shopify primeiro (Loja → Integrações).', 'error');
            return;
        }
        if (typeof ImporterModule === 'undefined' || !ImporterModule.publishProduct) {
            showToast('Módulo de publicação indisponível — recarregue a página.', 'error');
            return;
        }
        if (!page.nome || !page.nome.trim()) { showToast('Dê um nome à página antes de publicar.', 'error'); return; }

        const shop = ShopifyModule.getConfig();
        const handle = _handle(page.nome);
        showToast('Publicando página na Shopify…', 'info');
        try {
            // Fonte de verdade: se a página tem .dados (criada/editada pelas abas
            // do editor de produto), publica a partir DELE — senão o caminho
            // legado (blocos/fotos no MediaStore). Sem isso, páginas do editor
            // sairiam SEM descrição nem imagens na Shopify.
            const usaDados = !!(page.dados && typeof page.dados === 'object');
            let body, images;
            if (usaDados) {
                const d = page.dados;
                body = _semScript(d.description || '');
                images = [];
                let i = 0;
                for (const im of (d.images || [])) {
                    const src = im && (im.dataUrl || im.url);
                    if (!src) continue;
                    i++;
                    try {
                        const blob = await _srcParaBlob(src);
                        if (!blob) continue;
                        const url = await ImporterModule.shopifyStagedUploadImage(shop, blob, `${handle}-${i}.webp`);
                        if (url) images.push({ src: url, alt: '' });
                    } catch (e) { console.warn('[ABPages] upload de imagem (dados) falhou', e); }
                }
            } else {
                // Sobe cada foto única (MediaStore) uma vez e monta a descrição por blocos.
                const urlPorFotoId = {};
                const idsUsados = new Set((page.fotos || []).map(f => f.id));
                (page.blocos || []).forEach(b => { if (b.tipo === 'imagem' && b.fotoId) idsUsados.add(b.fotoId); });
                let i = 0;
                for (const fid of idsUsados) {
                    const foto = (page.fotos || []).find(f => f.id === fid);
                    if (!foto || !foto.mediaId) continue;
                    const rec = await MediaStore.get(foto.mediaId);
                    if (!rec?.blob) continue;
                    i++;
                    urlPorFotoId[fid] = await ImporterModule.shopifyStagedUploadImage(shop, rec.blob, `${handle}-${i}.webp`);
                }
                if ((page.blocos || []).length) {
                    body = page.blocos.map(b => {
                        if (b.tipo === 'texto') return _semScript(b.html || '');
                        const url = urlPorFotoId[b.fotoId];
                        return url ? `<img src="${url}" alt="">` : '';
                    }).join('');
                } else {
                    body = _semScript(page.descricaoHtml || '');
                }
                images = (page.fotos || []).map(f => ({ src: urlPorFotoId[f.id], alt: '' })).filter(im => im.src);
            }

            // Variantes → payload (mantém a lista editável se houver; senão uma
            // variante padrão com preço/custo da página ou do snapshot .dados).
            const precoBase = Number(page.preco) || (page.dados ? Number(page.dados.price) || 0 : 0);
            const custoBase = Number(page.custo) || (page.dados ? Number(page.dados.cost) || 0 : 0);
            let options = [];
            let variants;
            if ((page.variantes || []).length) {
                options = [page.opcaoNome || 'Opção'];
                variants = page.variantes.map(v => ({
                    optionValues: [v.nome || 'Padrão'],
                    price: Number(v.preco) || precoBase,
                    compareAt: Number(page.compareAt) || 0,
                    sku: v.sku || '',
                    cost: Number(v.custo) || custoBase,
                    barcode: '',
                }));
            } else {
                variants = [{
                    optionValues: [],
                    price: precoBase,
                    compareAt: Number(page.compareAt) || 0,
                    sku: (page.dados && page.dados.sku) || '', cost: custoBase, barcode: '',
                }];
            }

            const prod = _findProduct(page.productId);
            const payload = {
                title: page.nome,
                body,
                vendor: (page.dados && page.dados.vendor) || (prod && prod.vendor) || '',
                type: '',
                tags: (page.dados && Array.isArray(page.dados.tags)) ? page.dados.tags.join(',') : '',
                options,
                variants,
                images,
                handle,
            };
            const criado = await ImporterModule.publishProduct(shop, payload);
            page.shopifyProductId = criado.id;
            page.shopifyHandle = criado.handle;
            await save(page);
            if (typeof ProductsModule !== 'undefined' && ProductsModule.upsertFromShopify) {
                ProductsModule.upsertFromShopify(criado, { title: page.nome, price: precoBase, image: images[0]?.src || '' });
            }
            showToast(`Página "${page.nome}" publicada (handle ${criado.handle}). Está ACTIVE, sem canal de venda — revise na Shopify.`, 'success');
        } catch (e) {
            console.warn('[ABPages] publish falhou', e);
            showToast('Falha ao publicar: ' + String(e.message || e).slice(0, 160), 'error');
        }
    }

    function _handle(nome) {
        return String(nome || 'produto').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'produto';
    }

    function _icones() { if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {} }

    function _revogarThumbs() {
        _thumbUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
        _thumbUrls = [];
    }

    function init() { /* nada a montar no boot — o manager é sob demanda */ }

    return {
        init,
        openManager,
        getForProduct,
        countForProduct,
        getById,
        save,
        saveMany,
        remove,
        setActive,
        duplicate,
        createFromProduct,
        publish,
        // Snapshot no formato-de-produto (abas Chrome do editor de produto)
        getEditorData,
        createFromDados,
        saveEditorData,
        // fábrica exposta pro Estúdio salvar variações geradas como páginas
        _novaPagina,
        _blobParaThumb,
    };
})();

if (typeof window !== 'undefined') window.ABPagesModule = ABPagesModule;
if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => ABPagesModule.init());
