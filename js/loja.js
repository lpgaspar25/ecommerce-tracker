// Loja — Código & Tema / Empresa & Site. Um "cofre" por loja pra guardar
// snippets de código Liquid/tema, dados cadastrais, domínio, redes sociais
// e imagens de referência (logo, documentos, capturas). Tudo no IndexedDB
// (KVStore/MediaStore) — nunca localStorage, e sempre escopado por loja
// (mesmo padrão de produtos/metas/diário: cada registro carrega storeId).
const LojaModule = (() => {
    const SNIPPETS_KEY = 'etracker_loja_snippets';
    const EMPRESA_KEY = 'etracker_loja_empresa';

    const TAGS_SNIPPET = [
        { id: 'secao', label: 'Seção' },
        { id: 'snippet', label: 'Snippet' },
        { id: 'css', label: 'CSS' },
        { id: 'js', label: 'JS' },
        { id: 'outro', label: 'Outro' },
    ];

    let _snippets = [];
    let _empresaMap = {};
    let _carregado = false;
    // Snippets abertos no momento (accordion) — nasce vazio: tudo começa
    // fechado, só mostrando o nome. Um snippet recém-criado entra aqui
    // pra abrir automático (senão o usuário criaria um card fechado e vazio).
    const _expandidos = new Set();

    async function _carregar() {
        if (_carregado) return;
        _snippets = (await KVStore.get(SNIPPETS_KEY)) || [];
        _empresaMap = (await KVStore.get(EMPRESA_KEY)) || {};
        _carregado = true;
    }

    function _icones() {
        if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {}
    }

    function _nomeDaLoja(storeId) {
        return AppState.stores?.find(s => s.id === storeId)?.name || '—';
    }

    function _agora() { return new Date().toISOString(); }

    // ── Código & Tema ────────────────────────────────────────────────────
    async function renderCodigo() {
        await _carregar();
        const panel = document.getElementById('tab-loja-codigo');
        if (!panel) return;
        const todas = isAllStoresSelected();
        const storeId = getCurrentStoreId();
        const lista = todas ? _snippets : _snippets.filter(s => s.storeId === storeId);

        panel.innerHTML = `
            <div class="section-header">
                <h2><i data-lucide="code-2" style="width:14px;height:14px;vertical-align:-2px"></i> Código & Tema</h2>
                <div><button class="btn btn-primary" id="loja-snip-add"><i data-lucide="plus" style="width:13px;height:13px;vertical-align:-2px"></i> Novo snippet</button></div>
            </div>
            <p class="loja-intro">
                Guarde aqui trechos de código Liquid, CSS ou JS do tema — seções, snippets, ajustes que você já fez — pra reaproveitar sem precisar abrir o editor de tema toda vez.
                ${todas ? ' Mostrando snippets de todas as lojas.' : ''}
            </p>
            <div id="loja-snip-list">${_renderSnippetsList(lista, todas)}</div>
        `;
        _wireCodigoEvents(storeId);
        _icones();
    }

    function _tagLabel(tagId) { return TAGS_SNIPPET.find(t => t.id === tagId)?.label || tagId; }

    function _renderSnippetsList(lista, todas) {
        if (!lista.length) return '<div class="loja-empty">Nenhum snippet salvo ainda. Clique em "Novo snippet" pra começar.</div>';
        return lista.map(s => {
            const aberto = _expandidos.has(s.id);
            return `
            <div class="loja-snippet-item${aberto ? ' is-aberto' : ''}" data-snip="${s.id}">
                <div class="loja-snippet-header">
                    <button type="button" class="loja-snippet-toggle" data-snip-toggle="${s.id}">
                        <i data-lucide="chevron-right" class="loja-snippet-chevron"></i>
                        <span class="loja-snippet-nome">${escapeHtml(s.nome) || 'Sem nome'}</span>
                        <span class="loja-tag-pill" data-tag="${s.tag}">${_tagLabel(s.tag)}</span>
                        ${todas ? `<span class="loja-store-badge">${escapeHtml(_nomeDaLoja(s.storeId))}</span>` : ''}
                    </button>
                    <button type="button" class="loja-row-x" data-snip-del="${s.id}" title="Remover">&times;</button>
                </div>
                <div class="loja-snippet-body">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Nome</label>
                            <input type="text" class="input" data-snip-field="nome" value="${escapeHtml(s.nome)}" placeholder="Nome do snippet">
                        </div>
                        <div class="form-group" style="flex:0 0 150px">
                            <label>Tipo</label>
                            <select class="input" data-snip-field="tag">
                                ${TAGS_SNIPPET.map(t => `<option value="${t.id}" ${s.tag === t.id ? 'selected' : ''}>${t.label}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group" style="flex:1 1 100%">
                            <label>Descrição</label>
                            <input type="text" class="input" data-snip-field="descricao" value="${escapeHtml(s.descricao)}" placeholder="Pra que serve esse código">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group" style="flex:1 1 100%">
                            <label>Código</label>
                            <textarea class="input loja-code-area" data-snip-field="codigo" placeholder="{% comment %} ... {% endcomment %}" spellcheck="false">${escapeHtml(s.codigo)}</textarea>
                        </div>
                    </div>
                </div>
            </div>
        `;
        }).join('');
    }

    function _wireCodigoEvents(storeId) {
        document.getElementById('loja-snip-add')?.addEventListener('click', async () => {
            const novo = {
                id: generateId('snip'), storeId, nome: '', descricao: '', tag: 'snippet', codigo: '',
                criadoEm: _agora(), atualizadoEm: _agora(),
            };
            _snippets.unshift(novo);
            _expandidos.add(novo.id); // recém-criado nasce aberto — senão seria um card fechado e vazio
            await KVStore.set(SNIPPETS_KEY, _snippets);
            renderCodigo();
        });

        const box = document.getElementById('loja-snip-list');
        // input (não só change): textarea de código se beneficia de salvar
        // sem depender do usuário lembrar de clicar em algo — mas sem
        // re-renderizar a cada tecla (isso mataria o cursor no meio da digitação).
        let _debounce = null;
        // Grava o valor em ambos os handlers (não só no 'input'): <select>
        // não garante disparar 'input' em toda troca — só 'change' — então
        // depender de um só handler pra escrever deixava o <select> de tag
        // com o valor sempre desatualizado.
        const _gravarCampo = (ev) => {
            const tgt = ev.target.closest('[data-snip-field]');
            if (!tgt) return null;
            const item = ev.target.closest('.loja-snippet-item');
            const s = _snippets.find(x => x.id === item?.dataset.snip);
            if (!s) return null;
            s[tgt.dataset.snipField] = tgt.value;
            s.atualizadoEm = _agora();
            // Nome digitado no corpo expandido — reflete no rótulo do cabeçalho
            // (que fica visível mesmo aberto) sem precisar re-renderizar tudo.
            if (tgt.dataset.snipField === 'nome') {
                const rotulo = item?.querySelector('.loja-snippet-nome');
                if (rotulo) rotulo.textContent = tgt.value || 'Sem nome';
            }
            return s;
        };
        box?.addEventListener('input', (ev) => {
            if (!_gravarCampo(ev)) return;
            clearTimeout(_debounce);
            _debounce = setTimeout(() => KVStore.set(SNIPPETS_KEY, _snippets), 400);
        });
        box?.addEventListener('change', (ev) => {
            if (!_gravarCampo(ev)) return;
            clearTimeout(_debounce);
            KVStore.set(SNIPPETS_KEY, _snippets);
        });
        box?.addEventListener('click', async (ev) => {
            const del = ev.target.closest('[data-snip-del]');
            if (del) {
                if (!confirm('Remover este snippet?')) return;
                _snippets = _snippets.filter(s => s.id !== del.dataset.snipDel);
                _expandidos.delete(del.dataset.snipDel);
                await KVStore.set(SNIPPETS_KEY, _snippets);
                renderCodigo();
                return;
            }
            const toggle = ev.target.closest('[data-snip-toggle]');
            if (toggle) {
                const id = toggle.dataset.snipToggle;
                if (_expandidos.has(id)) _expandidos.delete(id); else _expandidos.add(id);
                renderCodigo();
            }
        });
    }

    // ── Empresa & Site ───────────────────────────────────────────────────
    function _empresaVazia() {
        return {
            razaoSocial: '', companyNumber: '', enderecoRegistrado: '', dadosFiscais: '',
            dominio: '', temaAtivo: '', notasTecnicas: '',
            instagram: '', emailSuporte: '', whatsapp: '', linkPoliticaPrivacidade: '', linkTermos: '',
            notasLivres: '', imagens: [],
        };
    }

    async function renderEmpresa() {
        await _carregar();
        const panel = document.getElementById('tab-loja-empresa');
        if (!panel) return;

        if (isAllStoresSelected()) {
            panel.innerHTML = `
                <div class="section-header"><h2><i data-lucide="briefcase" style="width:14px;height:14px;vertical-align:-2px"></i> Empresa & Site</h2></div>
                <div class="loja-empty">Selecione uma loja específica no topo da sidebar — dados de empresa e site são por loja.</div>
            `;
            return;
        }

        const storeId = getCurrentStoreId();
        const dados = _empresaMap[storeId] || _empresaVazia();

        panel.innerHTML = `
            <div class="section-header">
                <h2><i data-lucide="briefcase" style="width:14px;height:14px;vertical-align:-2px"></i> Empresa & Site</h2>
                <span id="loja-empresa-status" class="loja-save-status"></span>
            </div>
            <p class="loja-intro">Dados cadastrais, domínio, redes sociais e imagens da <strong>${escapeHtml(_nomeDaLoja(storeId))}</strong> — tudo num lugar só na hora de configurar app, suporte ou parceiro novo.</p>
            <div class="loja-grid">
                <div class="loja-card loja-card-wide">
                    <h3 class="loja-card-title"><i data-lucide="scale" style="width:14px;height:14px;vertical-align:-2px"></i> Dados legais</h3>
                    <div class="form-row">
                        <div class="form-group"><label>Razão social</label><input type="text" class="input" data-emp-field="razaoSocial" value="${escapeHtml(dados.razaoSocial)}" placeholder="Ex.: Ambreux Ltd"></div>
                        <div class="form-group"><label>Company number / CNPJ</label><input type="text" class="input" data-emp-field="companyNumber" value="${escapeHtml(dados.companyNumber)}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group" style="flex:1 1 100%"><label>Endereço registrado</label><input type="text" class="input" data-emp-field="enderecoRegistrado" value="${escapeHtml(dados.enderecoRegistrado)}"></div>
                    </div>
                    <div class="form-row">
                        <div class="form-group" style="flex:1 1 100%"><label>Dados fiscais adicionais</label><textarea class="input" data-emp-field="dadosFiscais" style="min-height:60px">${escapeHtml(dados.dadosFiscais)}</textarea></div>
                    </div>
                </div>

                <div class="loja-card">
                    <h3 class="loja-card-title"><i data-lucide="globe" style="width:14px;height:14px;vertical-align:-2px"></i> Domínio & técnico</h3>
                    <div class="form-group"><label>Domínio</label><input type="text" class="input" data-emp-field="dominio" value="${escapeHtml(dados.dominio)}" placeholder="getambreux.com"></div>
                    <div class="form-group"><label>Tema Shopify ativo</label><input type="text" class="input" data-emp-field="temaAtivo" value="${escapeHtml(dados.temaAtivo)}"></div>
                    <div class="form-group"><label>Notas técnicas / links de painéis</label><textarea class="input" data-emp-field="notasTecnicas" style="min-height:60px">${escapeHtml(dados.notasTecnicas)}</textarea></div>
                </div>

                <div class="loja-card">
                    <h3 class="loja-card-title"><i data-lucide="share-2" style="width:14px;height:14px;vertical-align:-2px"></i> Redes sociais & contato</h3>
                    <div class="form-group"><label>Instagram</label><input type="text" class="input" data-emp-field="instagram" value="${escapeHtml(dados.instagram)}"></div>
                    <div class="form-group"><label>E-mail de suporte</label><input type="text" class="input" data-emp-field="emailSuporte" value="${escapeHtml(dados.emailSuporte)}"></div>
                    <div class="form-group"><label>WhatsApp</label><input type="text" class="input" data-emp-field="whatsapp" value="${escapeHtml(dados.whatsapp)}"></div>
                    <div class="form-row">
                        <div class="form-group"><label>Link política de privacidade</label><input type="text" class="input" data-emp-field="linkPoliticaPrivacidade" value="${escapeHtml(dados.linkPoliticaPrivacidade)}"></div>
                        <div class="form-group"><label>Link termos de serviço</label><input type="text" class="input" data-emp-field="linkTermos" value="${escapeHtml(dados.linkTermos)}"></div>
                    </div>
                </div>

                <div class="loja-card loja-card-wide">
                    <h3 class="loja-card-title"><i data-lucide="file-text" style="width:14px;height:14px;vertical-align:-2px"></i> Notas livres</h3>
                    <textarea class="input" data-emp-field="notasLivres" style="min-height:90px" placeholder="Qualquer outra coisa que não encaixou nos campos acima...">${escapeHtml(dados.notasLivres)}</textarea>
                </div>

                <div class="loja-card loja-card-wide">
                    <h3 class="loja-card-title"><i data-lucide="image" style="width:14px;height:14px;vertical-align:-2px"></i> Imagens <span class="loja-pill">${(dados.imagens || []).length}</span></h3>
                    <p class="loja-card-hint">Logo, documentos, capturas de tela — qualquer imagem de referência da empresa ou do site.</p>
                    <div class="prod-image-upload-zone" id="loja-emp-img-zone">
                        <i data-lucide="image-plus" style="width:28px;height:28px;color:var(--text-muted)"></i>
                        <p>Arraste imagens ou clique para adicionar</p>
                    </div>
                    <input type="file" id="loja-emp-img-input" accept="image/*" multiple style="display:none">
                    <div class="prod-image-thumbs" id="loja-emp-img-thumbs" style="${(dados.imagens || []).length ? '' : 'display:none'}">
                        ${_renderImagensThumbs(dados.imagens || [])}
                    </div>
                </div>
            </div>
        `;
        _wireEmpresaEvents(storeId, dados);
        _icones();
    }

    function _renderImagensThumbs(imagens) {
        return imagens.map(img => `
            <div class="prod-image-thumb">
                <img src="${img.thumb}" alt="" title="${escapeHtml(img.nome)}">
                <button type="button" class="prod-image-remove" data-img-remover="${img.id}" title="Remover">&times;</button>
            </div>
        `).join('');
    }

    function _wireEmpresaEvents(storeId, dados) {
        const panel = document.getElementById('tab-loja-empresa');
        panel?.querySelectorAll('[data-emp-field]').forEach(el => {
            el.addEventListener('change', () => {
                dados[el.dataset.empField] = el.value;
                _salvarEmpresa(storeId, dados);
            });
        });

        const zone = document.getElementById('loja-emp-img-zone');
        const input = document.getElementById('loja-emp-img-input');
        zone?.addEventListener('click', () => input?.click());
        zone?.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('prod-image-drop-hover'); });
        zone?.addEventListener('dragleave', () => zone.classList.remove('prod-image-drop-hover'));
        zone?.addEventListener('drop', (e) => {
            e.preventDefault();
            zone.classList.remove('prod-image-drop-hover');
            _adicionarImagens(storeId, dados, [...(e.dataTransfer?.files || [])]);
        });
        input?.addEventListener('change', () => {
            _adicionarImagens(storeId, dados, [...input.files]);
            input.value = '';
        });

        document.getElementById('loja-emp-img-thumbs')?.addEventListener('click', (ev) => {
            const btn = ev.target.closest('[data-img-remover]');
            if (!btn) return;
            _removerImagem(storeId, dados, btn.dataset.imgRemover);
        });
    }

    async function _adicionarImagens(storeId, dados, files) {
        dados.imagens = dados.imagens || [];
        let algumaFalhou = false;
        for (const file of files) {
            if (!file.type?.startsWith('image/')) continue;
            try {
                const id = generateId('empimg');
                const mediaId = 'loja_empresa_' + storeId + '_' + id;
                const cheia = await comprimirImagem(file, 2000, 0.88, { formato: 'image/webp' });
                await MediaStore.put(mediaId, cheia.blob, { type: cheia.blob.type, name: id + '.webp' });
                const thumb = await comprimirImagemParaDataUrl(cheia.blob, 200, 0.7, { formato: 'image/webp' });
                dados.imagens.push({ id, mediaId, nome: file.name || '', thumb });
            } catch (e) {
                algumaFalhou = true;
                console.error('[Loja] falha ao adicionar imagem:', e);
            }
        }
        await _salvarEmpresa(storeId, dados);
        if (algumaFalhou) showToast('Uma ou mais imagens falharam ao processar', 'error');
        renderEmpresa();
    }

    async function _removerImagem(storeId, dados, imgId) {
        const idx = (dados.imagens || []).findIndex(i => i.id === imgId);
        if (idx < 0) return;
        const [img] = dados.imagens.splice(idx, 1);
        try { await MediaStore.del(img.mediaId); } catch {}
        await _salvarEmpresa(storeId, dados);
        renderEmpresa();
    }

    async function _salvarEmpresa(storeId, dados) {
        dados.atualizadoEm = _agora();
        _empresaMap[storeId] = dados;
        await KVStore.set(EMPRESA_KEY, _empresaMap);
        const el = document.getElementById('loja-empresa-status');
        if (el) el.textContent = 'Salvo às ' + new Date().toLocaleTimeString('pt-BR');
    }

    // ── Boot ─────────────────────────────────────────────────────────────
    function init() {
        if (typeof EventBus === 'undefined') return;
        EventBus.on('tabChanged', (tab) => {
            if (tab === 'loja-codigo') renderCodigo();
            if (tab === 'loja-empresa') renderEmpresa();
        });
        EventBus.on('storeChanged', () => {
            if (document.querySelector('#tab-loja-codigo.active')) renderCodigo();
            if (document.querySelector('#tab-loja-empresa.active')) renderEmpresa();
        });
        if (document.querySelector('#tab-loja-codigo.active')) renderCodigo();
        if (document.querySelector('#tab-loja-empresa.active')) renderEmpresa();
    }

    return { init, renderCodigo, renderEmpresa };
})();

window.LojaModule = LojaModule;
document.addEventListener('DOMContentLoaded', () => LojaModule.init());
