/* ===========================
   Lançamento de Produto — modo dentro do Estúdio de Produto.
   Cria um produto do zero (ou clonando um produto-molde da loja), importa
   fotos (upload manual ou galeria de fornecedor via extensão Chrome), monta
   a descrição em blocos texto+imagem (do zero por IA, ou copiando a
   estrutura do molde), herda o brinde do molde, guarda um rascunho e publica
   de verdade na Shopify (productCreate + staged upload, reaproveitando
   ImporterModule.publishProduct — liberado no allowlist do Worker na Fase 2).

   Publica ACTIVE mas sem publicar em nenhum canal de venda (decisão do
   usuário) — fica pronto pra revisão manual antes de ir ao ar.

   Armazenamento: fotos (MediaStore) e rascunhos (KVStore) ficam no
   IndexedDB, nunca inline em base64 no localStorage — é o mesmo problema de
   quota que já resolvemos no Laboratório. A descrição só ganha <img> com URL
   real na hora de publicar; antes disso (rascunho, prévia) é tudo referência
   pro IndexedDB.
   =========================== */

const LancamentoModule = (() => {
    const PROXY_URL = 'https://swipe-media-proxy.lucasmedia.workers.dev';
    const MAX_FOTOS_VISAO = 8; // teto de fotos mandadas pra IA de visão (custo/payload)
    const RASCUNHOS_KEY = 'etracker_lancamentos';

    const _state = {
        passoAtual: 1,
        base: 'zero', // 'zero' | 'molde'
        moldeProductId: '',
        moldeDetalhes: null, // resultado de ShopifyModule.fetchProductDetails
        titulo: '',
        fotos: [], // { id, mediaId, thumb, origem }
        blocos: [], // { tipo:'texto', html } | { tipo:'imagem', fotoId }
        brinde: { incluir: false, titulo: '', html: '' },
        _brindeSugerido: false,
        rascunhoId: '',
        rascunhoCriadoEm: '',
        shopifyProductId: '',
        shopifyHandle: '',
    };

    let _previewUrls = [];

    function init() {
        _bindModoToggle();
        _bindStepper();
        _bindPasso1();
        _bindPasso2();
        _bindPasso3();
        _bindPasso4();
        _bindPasso5();
        _bindMensagensExtensao();

        KVStore.get(RASCUNHOS_KEY).then(lista => _atualizarBadgeRascunhos((lista || []).length)).catch(() => {});

        // A extensão manda ?modo=lancamento ao abrir/focar a aba — troca de
        // modo na hora, mesmo antes das fotos da galeria chegarem.
        const modo = new URLSearchParams(location.search).get('modo');
        if (modo === 'lancamento') _alternarModo('lancamento');
    }

    // ── Alternador Produto existente / Lançar produto novo ──────────────
    function _bindModoToggle() {
        document.querySelectorAll('.studio-modo-btn').forEach(btn => {
            btn.addEventListener('click', () => _alternarModo(btn.dataset.modo));
        });
    }

    function _alternarModo(modo) {
        document.querySelectorAll('.studio-modo-btn').forEach(b => b.classList.toggle('is-active', b.dataset.modo === modo));
        document.getElementById('studio-modo-produto')?.classList.toggle('hidden', modo !== 'produto');
        document.getElementById('studio-modo-lancamento')?.classList.toggle('hidden', modo !== 'lancamento');
        document.getElementById('studio-modo-rascunhos')?.classList.toggle('hidden', modo !== 'rascunhos');
        if (modo === 'rascunhos') _renderRascunhos();
        _icones();
    }

    // ── Wizard: stepper + navegação ──────────────────────────────────────
    function _bindStepper() {
        document.querySelectorAll('.lanc-step').forEach(btn => {
            btn.addEventListener('click', () => _irParaPasso(parseInt(btn.dataset.step, 10)));
        });
        document.querySelectorAll('[data-lanc-voltar]').forEach(btn => {
            btn.addEventListener('click', () => _irParaPasso(parseInt(btn.dataset.lancVoltar, 10)));
        });
        document.querySelectorAll('[data-lanc-avancar]').forEach(btn => {
            btn.addEventListener('click', () => _irParaPasso(parseInt(btn.dataset.lancAvancar, 10)));
        });
    }

    function _irParaPasso(n) {
        if (!n) return;
        _state.passoAtual = n;
        document.querySelectorAll('.lanc-painel').forEach(p => {
            p.classList.toggle('hidden', parseInt(p.dataset.painel, 10) !== n);
        });
        document.querySelectorAll('.lanc-step').forEach(s => {
            const passo = parseInt(s.dataset.step, 10);
            s.classList.toggle('is-active', passo === n);
            s.classList.toggle('is-done', passo < n);
        });
        if (n === 3) _prepararPasso3();
        if (n === 4) _prepararPasso4();
        if (n === 5) _prepararPasso5();
        _icones();
    }

    // ── Passo 1: Base ─────────────────────────────────────────────────
    function _bindPasso1() {
        document.getElementById('lanc-base-zero')?.addEventListener('click', () => _selecionarBase('zero'));
        document.getElementById('lanc-base-molde')?.addEventListener('click', () => _selecionarBase('molde'));
        document.getElementById('lanc-titulo')?.addEventListener('input', (e) => { _state.titulo = e.target.value; });
        document.getElementById('lanc-titulo-ia')?.addEventListener('click', () => _gerarNomesProduto());
        document.getElementById('lanc-passo1-avancar')?.addEventListener('click', () => {
            if (!_state.titulo.trim()) { showToast('Dá um nome pro produto novo primeiro', 'error'); return; }
            if (_state.base === 'molde' && !_state.moldeProductId) { showToast('Escolha um produto-molde', 'error'); return; }
            _irParaPasso(2);
        });
    }

    // Sugestão de nome com IA (LAUNCH-01) — usa o que já foi digitado como
    // tema/semente e, se a base for um molde, o produto-molde como
    // referência de categoria/marca. Sem nada digitado e sem molde, gera
    // nomes genéricos vendáveis mesmo assim (o usuário troca por outro).
    async function _gerarNomesProduto() {
        const box = document.getElementById('lanc-titulo-sugestoes');
        const btn = document.getElementById('lanc-titulo-ia');
        if (!box) return;
        box.classList.remove('hidden');
        box.innerHTML = `<div class="lanc-titulo-sug-status"><i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i> Gerando sugestões…</div>`;
        _icones();
        if (btn) btn.disabled = true;
        try {
            const tema = (_state.titulo || document.getElementById('lanc-titulo')?.value || '').trim();
            const molde = _state.base === 'molde' ? _state.moldeDetalhes : null;
            const contexto = [
                tema ? `Ideia/tema atual digitado pelo usuário: "${tema}" — gere variações e refinamentos DESSE tema, não troque de produto.` : 'Nada foi digitado ainda — sugira nomes genéricos vendáveis pra um produto novo de dropshipping.',
                molde ? `Produto usado como molde/inspiração: "${molde.title}"${molde.productType ? ` (categoria: ${molde.productType})` : ''}${molde.vendor ? ` (marca: ${molde.vendor})` : ''}.` : '',
            ].filter(Boolean).join('\n');

            const sistema = `Você sugere nomes de produtos pra uma loja de dropshipping, focados em conversão — chamativos, específicos e vendáveis, nunca genéricos ("Produto Incrível", "Item Especial" são ruins) nem clickbait enganoso. Responda em português do Brasil, em JSON: {"nomes": ["nome 1", "nome 2", "nome 3", "nome 4", "nome 5"]}. Cada nome até 70 caracteres.`;

            const txt = await _openaiJson(sistema, [{ role: 'user', content: contexto }], 500);
            const plano = _extrairJson(txt);
            const nomes = Array.isArray(plano.nomes) ? plano.nomes.filter(Boolean) : [];
            if (!nomes.length) throw new Error('A IA não devolveu sugestões — tente de novo.');

            box.innerHTML = `
                <div class="lanc-titulo-sug-lista">
                    ${nomes.map(n => `<button type="button" class="lanc-titulo-sug-item" data-nome="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('')}
                </div>
                <button type="button" class="lanc-link-btn" id="lanc-titulo-sug-regerar">Gerar outras sugestões</button>
            `;
            box.querySelectorAll('[data-nome]').forEach(item => {
                item.addEventListener('click', () => {
                    const campo = document.getElementById('lanc-titulo');
                    campo.value = item.dataset.nome;
                    _state.titulo = item.dataset.nome;
                    box.classList.add('hidden');
                    box.innerHTML = '';
                });
            });
            box.querySelector('#lanc-titulo-sug-regerar')?.addEventListener('click', () => _gerarNomesProduto());
        } catch (e) {
            box.innerHTML = `<div class="lanc-titulo-sug-erro">Erro: ${escapeHtml(e.message)}</div>`;
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    function _selecionarBase(tipo) {
        _state.base = tipo;
        document.getElementById('lanc-base-zero')?.classList.toggle('is-active', tipo === 'zero');
        document.getElementById('lanc-base-molde')?.classList.toggle('is-active', tipo === 'molde');
        const picker = document.getElementById('lanc-molde-picker');
        if (tipo === 'molde') {
            picker?.classList.remove('hidden');
            _carregarProdutosDaLoja();
        } else {
            picker?.classList.add('hidden');
        }
    }

    async function _carregarProdutosDaLoja() {
        const container = document.getElementById('lanc-molde-select-picker');
        if (!container || container.dataset.carregado === '1' || typeof ProductPicker === 'undefined') return;
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
            _setMoldeStatus('Conecte a Shopify (Configurações → Integrações) pra usar um produto da loja como molde.', 'error');
            return; // não marca carregado — permite tentar de novo depois de conectar
        }
        _setMoldeStatus('Carregando produtos da loja…');
        try {
            await ProductPicker.render(container, {
                source: 'shopify',
                instancia: 'lancamento-molde',
                selectedId: _state.moldeProductId || null,
                placeholder: 'Buscar produto da loja por nome ou SKU…',
                onSelect: (item) => _selecionarMolde(item.id),
            });
            container.dataset.carregado = '1'; // só marca carregado depois de um render OK — falha permite tentar de novo
            _setMoldeStatus('');
        } catch (e) {
            _setMoldeStatus('Erro ao carregar produtos: ' + e.message, 'error');
        }
    }

    async function _selecionarMolde(id) {
        _state.moldeProductId = id;
        _state.moldeDetalhes = null;
        if (!id) { _setMoldeStatus(''); return; }
        _setMoldeStatus('Lendo o produto…');
        try {
            const det = await ShopifyModule.fetchProductDetails([id]);
            const d = det[id];
            if (!d) { _setMoldeStatus('Não consegui ler esse produto.', 'error'); return; }
            _state.moldeDetalhes = d;
            const temImgNaDescricao = /<img/i.test(d.descriptionHtml || '');
            _setMoldeStatus(`"${d.title}" · ${d.images.length} foto(s)${temImgNaDescricao ? ' · descrição já tem imagens intercaladas (bom sinal pro brinde)' : ''}`);
        } catch (e) {
            _setMoldeStatus('Erro: ' + e.message, 'error');
        }
    }

    function _setMoldeStatus(msg, tipo) {
        const el = document.getElementById('lanc-molde-status');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = tipo === 'error' ? 'var(--danger, #ef4444)' : '';
    }

    // ── Passo 2: Fotos ────────────────────────────────────────────────
    function _bindPasso2() {
        document.getElementById('lanc-upload-btn')?.addEventListener('click', () => document.getElementById('lanc-upload')?.click());
        document.getElementById('lanc-upload')?.addEventListener('change', async (e) => {
            const files = [...(e.target.files || [])];
            e.target.value = '';
            for (const f of files) await _adicionarFoto(f, 'upload');
        });
        document.getElementById('lanc-editar-todas')?.addEventListener('click', () => _abrirEditorIA(_state.fotos.map(f => f.id)));
        document.getElementById('lanc-passo2-avancar')?.addEventListener('click', () => {
            if (!_state.fotos.length) { showToast('Adicione ao menos uma foto', 'error'); return; }
            _irParaPasso(3);
        });
        _bindGerarFotosIA();
    }

    // Comprime, guarda o blob cheio no IndexedDB (MediaStore) e mantém só
    // uma miniatura pequena em memória — nunca base64 grande em localStorage.
    async function _adicionarFoto(blobOuArquivo, origem) {
        const id = 'lancfoto_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        _renderFotoCarregando();
        try {
            const cheia = await comprimirImagem(blobOuArquivo, 2400, 0.9, { formato: 'image/webp' });
            const mediaId = 'lancamento_' + id;
            await MediaStore.put(mediaId, cheia.blob, { type: cheia.blob.type, name: id + '.webp' });
            const mini = await comprimirImagem(cheia.blob, 320, 0.7, { formato: 'image/webp' });
            const thumb = await _blobParaDataUrl(mini.blob);
            _state.fotos.push({ id, mediaId, thumb, origem });
        } catch (e) {
            console.error('[Lançamento] falha ao adicionar foto:', e);
        }
        _renderFotosGrid();
    }

    async function _removerFoto(id) {
        const idx = _state.fotos.findIndex(f => f.id === id);
        if (idx < 0) return;
        const [f] = _state.fotos.splice(idx, 1);
        try { await MediaStore.del(f.mediaId); } catch {}
        _renderFotosGrid();
    }

    function _renderFotoCarregando() {
        const grid = document.getElementById('lanc-fotos-grid');
        if (!grid) return;
        const div = document.createElement('div');
        div.className = 'lanc-foto-carregando';
        div.innerHTML = '<i data-lucide="loader-2" style="width:16px;height:16px;animation:spin 1s linear infinite"></i>';
        grid.appendChild(div);
        _icones();
    }

    function _renderFotosGrid() {
        const grid = document.getElementById('lanc-fotos-grid');
        if (!grid) return;
        grid.innerHTML = _state.fotos.map(f => {
            const processando = _fotosProcessando.has(f.id);
            const erro = _fotosComErro.get(f.id);
            return `
            <div class="lanc-foto-item${f.editada ? ' is-editada' : ''}${processando ? ' is-processando' : ''}${erro ? ' is-erro' : ''}" data-id="${f.id}">
                <img src="${f.thumb}" alt="" data-ampliar="${f.id}" title="Ampliar">
                ${processando ? `<div class="lanc-foto-carregando-overlay"><i data-lucide="loader-2" style="width:16px;height:16px;animation:spin 1s linear infinite"></i></div>` : ''}
                ${erro ? `<div class="lanc-foto-erro-badge" title="${escapeHtml(erro)}"><i data-lucide="alert-triangle" style="width:11px;height:11px"></i></div>` : ''}
                <span class="lanc-foto-origem">${escapeHtml(f.origem)}${f.editada ? ' · IA' : ''}</span>
                <div class="lanc-foto-acoes">
                    <button type="button" data-editar-uma="${f.id}" title="Editar com IA"><i data-lucide="wand-2" style="width:12px;height:12px"></i></button>
                    ${f._original ? `<button type="button" data-desfazer="${f.id}" title="Desfazer edição"><i data-lucide="rotate-ccw" style="width:12px;height:12px"></i></button>` : ''}
                </div>
                <button type="button" class="lanc-foto-del" data-remover="${f.id}" title="Remover"><i data-lucide="x" style="width:11px;height:11px"></i></button>
            </div>`;
        }).join('');
        grid.querySelectorAll('[data-remover]').forEach(btn => {
            btn.addEventListener('click', () => _removerFoto(btn.dataset.remover));
        });
        grid.querySelectorAll('[data-editar-uma]').forEach(btn => {
            btn.addEventListener('click', () => _abrirEditorIA([btn.dataset.editarUma]));
        });
        grid.querySelectorAll('[data-desfazer]').forEach(btn => {
            btn.addEventListener('click', () => _desfazerEdicao(btn.dataset.desfazer));
        });
        grid.querySelectorAll('[data-ampliar]').forEach(img => {
            img.addEventListener('click', async () => {
                const f = _state.fotos.find(x => x.id === img.dataset.ampliar);
                const url = f && await MediaStore.getObjectUrl(f.mediaId);
                if (url && typeof abrirImagemAmpliada === 'function') abrirImagemAmpliada(url, f.origem);
            });
        });
        // "Editar todas" só faz sentido quando há foto.
        const btnLote = document.getElementById('lanc-editar-todas');
        if (btnLote) btnLote.style.display = _state.fotos.length ? '' : 'none';
        _icones();
    }

    // ── Gerar fotos com IA (LAUNCH-02 Parte B) ──────────────────────────
    // Diferente do editor acima (que EDITA fotos já adicionadas), isto GERA
    // fotos novas a partir de uma foto-base (imagem do molde, uma foto já
    // adicionada, ou um upload) cruzada com cenário × um-ou-mais ângulos —
    // cada combinação vira uma chamada separada ao ImageAI, e cada saída
    // entra em _state.fotos pelo mesmo _adicionarFoto usado no upload manual.
    let _fonteGerarSelecionada = null; // { tipo:'molde'|'existente'|'upload', dado: url|fotoId|File }

    function _bindGerarFotosIA() {
        document.getElementById('lanc-gerar-fotos-toggle')?.addEventListener('click', () => {
            const corpo = document.getElementById('lanc-gerar-fotos-corpo');
            const chevron = document.getElementById('lanc-gerar-fotos-chevron');
            if (!corpo) return;
            const abrindo = corpo.classList.contains('hidden');
            corpo.classList.toggle('hidden');
            if (chevron) chevron.style.transform = abrindo ? 'rotate(180deg)' : '';
            if (abrindo) { _renderGerarFonte(); _renderGerarAngulos(); _renderGerarCenarioSugestoes(); }
        });
        document.getElementById('lanc-gerar-upload')?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            _fonteGerarSelecionada = { tipo: 'upload', dado: f };
            _renderGerarFonte();
        });
        document.getElementById('lanc-gerar-angulos-todos')?.addEventListener('click', () => {
            document.querySelectorAll('#lanc-gerar-angulos input').forEach(cb => { cb.checked = true; });
        });
        document.getElementById('lanc-gerar-descricao-lib')?.addEventListener('click', () => {
            const campo = document.getElementById('lanc-gerar-descricao');
            window.PromptTemplates?.open({
                prefill: campo.value,
                onUse: (texto) => { campo.value = texto; campo.focus(); },
            });
        });
        document.getElementById('lanc-gerar-fotos-btn')?.addEventListener('click', () => _gerarFotosIA());
    }

    // Foto-base: imagens do molde (se a base do produto for um molde),
    // fotos já adicionadas no Passo 2, e um tile de upload — tudo num grid
    // só pra não obrigar o usuário a decidir "de onde vem" antes de gerar.
    function _renderGerarFonte() {
        const box = document.getElementById('lanc-gerar-fonte');
        if (!box) return;
        const fontes = [];
        if (_state.base === 'molde' && _state.moldeDetalhes?.images?.length) {
            _state.moldeDetalhes.images.forEach(img => fontes.push({ tipo: 'molde', dado: img.url, thumb: img.url, rotulo: 'Molde' }));
        }
        _state.fotos.forEach(f => fontes.push({ tipo: 'existente', dado: f.id, thumb: f.thumb, rotulo: f.origem || 'Foto' }));

        // Mantém a seleção atual se ainda existir na lista; senão cai pra
        // primeira fonte disponível (upload nunca "some" da lista sozinho).
        if (_fonteGerarSelecionada && _fonteGerarSelecionada.tipo !== 'upload') {
            const aindaExiste = fontes.some(f => f.tipo === _fonteGerarSelecionada.tipo && f.dado === _fonteGerarSelecionada.dado);
            if (!aindaExiste) _fonteGerarSelecionada = fontes[0] ? { tipo: fontes[0].tipo, dado: fontes[0].dado } : null;
        } else if (!_fonteGerarSelecionada && fontes[0]) {
            _fonteGerarSelecionada = { tipo: fontes[0].tipo, dado: fontes[0].dado };
        }

        box.innerHTML = fontes.map(f => `
            <button type="button" class="lanc-gerar-fonte-item${_fonteGerarSelecionada?.tipo === f.tipo && _fonteGerarSelecionada?.dado === f.dado ? ' is-ativa' : ''}" data-fonte-tipo="${f.tipo}" data-fonte-dado="${escapeHtml(String(f.dado))}">
                <img src="${escapeHtml(f.thumb)}" alt="">
                <span>${escapeHtml(f.rotulo)}</span>
            </button>
        `).join('') + `
            <button type="button" class="lanc-gerar-fonte-item lanc-gerar-fonte-upload${_fonteGerarSelecionada?.tipo === 'upload' ? ' is-ativa' : ''}" id="lanc-gerar-fonte-upload-btn">
                <i data-lucide="upload" style="width:16px;height:16px"></i>
                <span>${_fonteGerarSelecionada?.tipo === 'upload' ? (_fonteGerarSelecionada.dado.name || 'Enviada') : 'Enviar foto'}</span>
            </button>
        `;
        box.querySelectorAll('[data-fonte-tipo]').forEach(btn => {
            btn.addEventListener('click', () => {
                _fonteGerarSelecionada = { tipo: btn.dataset.fonteTipo, dado: btn.dataset.fonteDado };
                _renderGerarFonte();
            });
        });
        box.querySelector('#lanc-gerar-fonte-upload-btn')?.addEventListener('click', () => document.getElementById('lanc-gerar-upload')?.click());
        if (!fontes.length && !_fonteGerarSelecionada) {
            box.insertAdjacentHTML('afterbegin', `<p class="lanc-hint" style="margin:0 0 0.4rem">Sem fotos ainda — envie uma pra usar como base.</p>`);
        }
        _icones();
    }

    function _renderGerarAngulos() {
        const box = document.getElementById('lanc-gerar-angulos');
        if (!box || box.dataset.pronto) return;
        box.innerHTML = ANGULOS_CAMERA_LANC.map(a => `
            <label class="studio-preset">
                <input type="checkbox" value="${a.id}">
                ${escapeHtml(a.label)}
            </label>`).join('');
        box.dataset.pronto = '1';
        _icones();
    }

    function _renderGerarCenarioSugestoes() {
        const dl = document.getElementById('lanc-gerar-cenario-sugestoes');
        if (dl && !dl.dataset.pronto) {
            dl.innerHTML = SUGESTOES_CENARIO.map(s => `<option value="${escapeHtml(s)}">`).join('');
            dl.dataset.pronto = '1';
        }
        const chips = document.getElementById('lanc-gerar-cenario-chips');
        if (chips && !chips.dataset.pronto) {
            chips.innerHTML = SUGESTOES_CENARIO.map(s => `<button type="button" class="lanc-cenario-chip" data-sug="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('');
            chips.querySelectorAll('[data-sug]').forEach(chip => {
                chip.addEventListener('click', () => {
                    const campo = document.getElementById('lanc-gerar-cenario');
                    campo.value = chip.dataset.sug;
                    campo.focus();
                });
            });
            chips.dataset.pronto = '1';
        }
    }

    async function _blobDaFonteGerar() {
        if (!_fonteGerarSelecionada) return null;
        if (_fonteGerarSelecionada.tipo === 'upload') return _fonteGerarSelecionada.dado;
        if (_fonteGerarSelecionada.tipo === 'molde') return await bytesDaImagem(_fonteGerarSelecionada.dado);
        if (_fonteGerarSelecionada.tipo === 'existente') {
            const foto = _state.fotos.find(f => f.id === _fonteGerarSelecionada.dado);
            if (!foto) return null;
            const rec = await MediaStore.get(foto.mediaId);
            return rec?.blob || null;
        }
        return null;
    }

    async function _gerarFotosIA() {
        const btn = document.getElementById('lanc-gerar-fotos-btn');
        const prog = document.getElementById('lanc-gerar-prog');
        const fill = document.getElementById('lanc-gerar-fill');
        const status = document.getElementById('lanc-gerar-status');
        const cenario = document.getElementById('lanc-gerar-cenario')?.value.trim() || '';
        const descricao = document.getElementById('lanc-gerar-descricao')?.value.trim() || '';
        const angulosIds = [...document.querySelectorAll('#lanc-gerar-angulos input:checked')].map(i => i.value);
        const angulos = ANGULOS_CAMERA_LANC.filter(a => angulosIds.includes(a.id));

        if (!cenario && !descricao && !angulos.length) {
            showToast('Descreva um cenário, marque um ângulo, ou escreva o que quer mudar', 'error');
            return;
        }
        let baseBlob;
        try {
            baseBlob = await _blobDaFonteGerar();
        } catch (e) {
            showToast('Erro ao ler a foto-base: ' + e.message, 'error');
            return;
        }
        if (!baseBlob) {
            showToast('Escolha uma foto-base primeiro (molde, foto já adicionada, ou envie uma nova)', 'error');
            return;
        }

        const combinacoes = angulos.length ? angulos : [null];
        if (btn) btn.disabled = true;
        if (prog) prog.style.display = '';
        let ok = 0, falhas = 0;
        const ctx = _state.titulo || '';

        for (let i = 0; i < combinacoes.length; i++) {
            const angulo = combinacoes[i];
            if (status) status.textContent = `Gerando ${i + 1} de ${combinacoes.length}…`;
            if (fill) fill.style.width = `${Math.round((i / combinacoes.length) * 100)}%`;
            try {
                let prompt = cenario
                    ? ImageAI.promptCenario(cenario, ctx)
                    : _promptLivre(descricao || 'adjust the photo following the requested camera angle', ctx);
                if (angulo) prompt += ` ${angulo.instrucao}`;
                const gerado = await ImageAI.editar(baseBlob, prompt, {
                    formato: 'image/webp', compressao: 92,
                    provedor: _provedorImagemLanc(), modelo: _modeloImagemLanc() || undefined,
                });
                await _adicionarFoto(gerado, angulo ? `Gerada · ${angulo.label}` : 'Gerada por IA');
                ok++;
            } catch (e) {
                console.error('[Lançamento] gerar foto falhou:', e);
                falhas++;
            }
        }
        if (fill) fill.style.width = '100%';
        if (btn) btn.disabled = false;
        const msg = falhas ? `${ok} gerada(s), ${falhas} falhou(ram).` : `${ok} foto(s) gerada(s).`;
        if (status) status.textContent = msg;
        showToast(falhas ? `${ok} gerada(s), ${falhas} com erro` : `${ok} foto(s) gerada(s)`, falhas ? 'warning' : 'success');
    }

    function _blobParaDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onloadend = () => resolve(String(r.result || ''));
            r.onerror = () => reject(new Error('Falha ao ler a imagem'));
            r.readAsDataURL(blob);
        });
    }

    // ── IA — mesmo padrão do Estúdio (js/studio.js): gpt-4o, response_format
    // json_object, chave lida do AIAdGenerator com fallback pro localStorage ──
    function _chaveOpenAI() {
        return (window.AIAdGenerator?._getOpenAIKey?.()) || localStorage.getItem('openai_api_key') || '';
    }

    async function _openaiJson(system, mensagens, maxTokens = 3000) {
        const key = _chaveOpenAI();
        if (!key) throw new Error('Configure a chave OpenAI (AI Generations → API Keys)');
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
                model: 'gpt-4o', max_tokens: maxTokens, temperature: 0.8,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: system }, ...mensagens],
            }),
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `HTTP ${res.status}`); }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }

    // Vision multi-imagem — studio.js só tem versão de UMA imagem (_visaoIA);
    // aqui precisamos mandar VÁRIAS fotos do produto de uma vez.
    async function _openaiVisaoMulti(system, texto, imagens) {
        const key = _chaveOpenAI();
        if (!key) throw new Error('Configure a chave OpenAI (AI Generations → API Keys)');
        const content = [{ type: 'text', text: texto }];
        imagens.forEach(img => content.push({ type: 'image_url', image_url: { url: `data:${img.mediaType};base64,${img.base64}`, detail: 'low' } }));
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
                model: 'gpt-4o', max_tokens: 2500,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: system }, { role: 'user', content }],
            }),
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `HTTP ${res.status}`); }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }

    // A IA às vezes embrulha o JSON em ```json — desembrulha antes do parse.
    function _extrairJson(texto) {
        let t = String(texto || '').trim();
        const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (cerca) t = cerca[1].trim();
        const ini = t.search(/[{[]/);
        if (ini > 0) t = t.slice(ini);
        const fim = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
        if (fim >= 0) t = t.slice(0, fim + 1);
        return JSON.parse(t);
    }

    // ── Passo 3: Descrição em blocos ─────────────────────────────────────
    // A copy é do CLIENTE da loja, não da UI — o idioma é o da loja (a
    // Ambreux vende em inglês), nunca "português porque o app é em português".
    // Esse era o bug: os prompts forçavam PT-BR e traduziam o molde inglês.
    const IDIOMAS_COPY = [
        { id: 'en', nome: 'Inglês', instrucao: 'English (British)' },
        { id: 'pt', nome: 'Português', instrucao: 'Portuguese (Brazil)' },
        { id: 'es', nome: 'Espanhol', instrucao: 'Spanish' },
        { id: 'fr', nome: 'Francês', instrucao: 'French' },
        { id: 'de', nome: 'Alemão', instrucao: 'German' },
        { id: 'it', nome: 'Italiano', instrucao: 'Italian' },
        { id: 'nl', nome: 'Holandês', instrucao: 'Dutch' },
    ];

    const SISTEMA_BLOCOS_ZERO = `Você escreve a descrição de um produto de e-commerce no formato de LANDING PAGE: uma sequência de blocos que alternam texto de venda curto e direto com as fotos reais do produto.
Você recebe várias fotos do produto, nesta ordem (índice 0, 1, 2...), e o contexto do produto.
Devolva APENAS um JSON: {"blocos": [{"tipo":"texto","html":"<h3>...</h3><p>...</p>"}, {"tipo":"imagem","indiceFoto":0}, ...]}
Regras: alterne texto e imagem, nunca dois blocos do mesmo tipo seguidos; USE TODAS as fotos recebidas, uma vez cada, sem repetir indiceFoto; html usa só <h3>, <p>, <strong>, <ul>, <li> (nada de <script>/<style>/atributos); escreva olhando o que aparece de fato em cada foto pra escrever o texto vizinho com precisão; comece com bloco de texto.
IDIOMA: escreva TODO o texto no idioma pedido pelo usuário. Este texto é para o cliente final da loja — não use português a menos que seja explicitamente pedido.`;

    const SISTEMA_BLOCOS_MOLDE = `Você adapta a descrição de um produto de e-commerce existente para um produto NOVO, mantendo a MESMA estrutura e o MESMO tom — só troca o conteúdo.
Você recebe uma lista de blocos de texto (índice + html original, tirados de outro produto) e o nome do produto novo. Reescreva CADA bloco falando do produto novo, mantendo a mesma estrutura de tags HTML e tamanho aproximado.
IDIOMA — REGRA CRÍTICA: escreva no idioma pedido pelo usuário. Quando o pedido for "manter o idioma original", responda EXATAMENTE no mesmo idioma do html original recebido e NÃO TRADUZA nada. Traduzir a copy de uma loja que vende em inglês para português quebraria a loja.
Devolva APENAS um JSON: {"blocos": [{"indice": 0, "html": "..."}, {"indice": 2, "html": "..."}]}`;

    // Detecta o idioma do molde só pra escolher o padrão do seletor — o
    // usuário sempre pode trocar. Palavras funcionais distintivas: as comuns
    // entre PT e ES ("de", "para") não servem pra separar os dois.
    function _detectarIdioma(html) {
        const txt = ' ' + String(html || '').replace(/<[^>]+>/g, ' ').toLowerCase().replace(/\s+/g, ' ') + ' ';
        const marcas = {
            en: [' the ', ' and ', ' with ', ' your ', ' this ', ' of ', ' for '],
            pt: [' você ', ' seu ', ' sua ', ' não ', ' com ', ' mais ', ' são '],
            es: [' el ', ' los ', ' las ', ' con ', ' su ', ' más ', ' que '],
            fr: [' le ', ' les ', ' avec ', ' votre ', ' pour ', ' des '],
            de: [' und ', ' mit ', ' für ', ' die ', ' der ', ' das '],
            it: [' il ', ' con ', ' per ', ' della ', ' che ', ' una '],
            nl: [' het ', ' een ', ' met ', ' voor ', ' van ', ' uw '],
        };
        let melhor = '', pontos = 0;
        for (const [id, lista] of Object.entries(marcas)) {
            const n = lista.reduce((s, p) => s + (txt.split(p).length - 1), 0);
            if (n > pontos) { pontos = n; melhor = id; }
        }
        return pontos >= 3 ? melhor : '';
    }

    function _idiomaEscolhido() {
        return document.getElementById('lanc-desc-idioma')?.value || 'en';
    }

    function _instrucaoIdioma() {
        const id = _idiomaEscolhido();
        if (id === 'original') return 'Mantenha o idioma original do texto recebido — NÃO traduza.';
        const item = IDIOMAS_COPY.find(x => x.id === id);
        return `Escreva em ${item ? item.instrucao : 'English (British)'}.`;
    }

    function _bindPasso3() {
        document.getElementById('lanc-desc-modo-ia')?.addEventListener('click', () => { _marcarDescModo('ia'); _gerarBlocosDoZero(); });
        document.getElementById('lanc-desc-modo-molde')?.addEventListener('click', () => { _marcarDescModo('molde'); _gerarBlocosDoMolde(); });
        document.getElementById('lanc-blocos-add-texto')?.addEventListener('click', () => _adicionarBlocoManual('texto'));
        document.getElementById('lanc-blocos-add-imagem')?.addEventListener('click', () => _adicionarBlocoManual('imagem'));
        // Marca que o usuário escolheu à mão — a detecção automática não
        // sobrescreve mais a partir daqui.
        document.getElementById('lanc-desc-idioma')?.addEventListener('change', (e) => { e.target.dataset.tocado = '1'; });
        document.getElementById('lanc-passo3-avancar')?.addEventListener('click', () => {
            if (!_state.blocos.length) { showToast('Gere ou monte a descrição primeiro', 'error'); return; }
            _irParaPasso(4);
        });
    }

    // "Copiar o molde" só aparece se o usuário veio de um molde no Passo 1.
    function _prepararPasso3() {
        // Cobre voltar do Passo 2 depois de subir/remover foto lá — o trilho
        // não se atualiza sozinho porque só é redesenhado dentro de _renderBlocos.
        _renderTrilho();

        const temMolde = !!(_state.base === 'molde' && _state.moldeDetalhes);
        document.getElementById('lanc-desc-modo-molde')?.classList.toggle('hidden', !temMolde);

        // Adivinha o idioma da loja pelo molde e pré-seleciona — só na
        // primeira vez, pra não desfazer uma escolha manual do usuário.
        const sel = document.getElementById('lanc-desc-idioma');
        if (sel && temMolde && !sel.dataset.tocado) {
            const detectado = _detectarIdioma(_state.moldeDetalhes.descriptionHtml);
            if (detectado) {
                sel.value = detectado;
                _setDescStatus(`Idioma do molde detectado: ${(IDIOMAS_COPY.find(i => i.id === detectado) || {}).nome || detectado}. Troque acima se quiser outro.`);
            }
        }
    }

    function _marcarDescModo(modo) {
        document.getElementById('lanc-desc-modo-ia')?.classList.toggle('is-active', modo === 'ia');
        document.getElementById('lanc-desc-modo-molde')?.classList.toggle('is-active', modo === 'molde');
    }

    function _setDescStatus(msg, tipo) {
        const el = document.getElementById('lanc-desc-status');
        if (!el) return;
        el.textContent = msg || '';
        el.style.color = tipo === 'error' ? 'var(--danger, #ef4444)' : '';
    }

    // Tira QUALQUER <img> de um bloco de texto. Defesa em profundidade contra
    // o pior defeito possível aqui: uma foto do produto-MOLDE sobrar no HTML
    // e o produto novo nascer publicado com a imagem do produto errado.
    // Pode entrar por 3 caminhos — parser deixando passar, a IA copiando a
    // tag ao "manter a estrutura", ou o fallback que devolve o html original.
    function _semImagens(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = String(html || '');
        tpl.content.querySelectorAll('img, picture, source, svg, script, style, iframe, noscript, link, meta').forEach(el => el.remove());
        // Remover a TAG não basta: `style="background-image:url(cdn-do-molde/foto.jpg)"`
        // num <div> comum também é uma imagem do produto errado vazando — só
        // que via CSS, não via <img>. Tira TODO atributo de risco (on*, src,
        // href, data-*) de todo elemento; do `style` (que mantemos — é onde
        // mora o alinhamento centralizado que o molde real usa bastante)
        // tira especificamente qualquer url(...).
        tpl.content.querySelectorAll('*').forEach(el => {
            [...el.attributes].forEach(a => {
                if (a.name === 'style') {
                    const limpo = a.value.replace(/url\([^)]*\)/gi, '');
                    if (limpo.trim()) el.setAttribute('style', limpo); else el.removeAttribute('style');
                } else {
                    el.removeAttribute(a.name);
                }
            });
        });
        return tpl.innerHTML;
    }

    // A IA erra a chave e a caixa do "tipo" com frequência (image/Imagem/img,
    // ou "type" no lugar de "tipo"). Antes isso caía no ramo de texto e o
    // bloco era DESCARTADO em silêncio — a descrição saía sem imagem nenhuma
    // e o status ainda dizia "N blocos gerados".
    function _ehBlocoImagem(b) {
        const t = String(b?.tipo ?? b?.type ?? '').toLowerCase();
        return t === 'imagem' || t === 'image' || t === 'img' || t === 'foto' || t === 'photo';
    }

    function _indiceFotoDe(b, total) {
        const bruto = b?.indiceFoto ?? b?.indice ?? b?.index ?? b?.foto ?? b?.i;
        let n = parseInt(bruto, 10);
        if (!Number.isFinite(n)) return null;
        // Modelo às vezes devolve 1-based; se estourar o range, tenta n-1.
        if (n >= total && n - 1 < total) n = n - 1;
        return (n >= 0 && n < total) ? n : null;
    }

    async function _gerarBlocosDoZero() {
        if (!_state.fotos.length) { showToast('Adicione fotos no passo anterior primeiro', 'error'); return; }
        _setDescStatus('Gerando com IA…');
        try {
            const usadas = _state.fotos.slice(0, MAX_FOTOS_VISAO);
            if (_state.fotos.length > MAX_FOTOS_VISAO) {
                console.warn(`[Lançamento] usando só as ${MAX_FOTOS_VISAO} primeiras de ${_state.fotos.length} fotos na geração por IA.`);
            }
            const imagens = [];
            for (const f of usadas) {
                const rec = await MediaStore.get(f.mediaId);
                if (!rec?.blob) continue;
                const base64 = (await _blobParaDataUrl(rec.blob)).split(',')[1];
                imagens.push({ base64, mediaType: rec.blob.type || 'image/webp' });
            }
            const contexto = `Produto: ${_state.titulo || 'produto novo'}.\nIdioma: ${_instrucaoIdioma()}\nVocê recebeu ${imagens.length} foto(s) — use todas.`;
            const txt = await _openaiVisaoMulti(SISTEMA_BLOCOS_ZERO, contexto, imagens);
            const parsed = _extrairJson(txt);
            let proxima = 0; // fallback: distribui em ordem, não empilha na foto 0
            const gerados = (parsed.blocos || parsed.bloco || []).map(b => {
                if (_ehBlocoImagem(b)) {
                    const idx = _indiceFotoDe(b, usadas.length);
                    const foto = usadas[idx !== null ? idx : Math.min(proxima++, usadas.length - 1)];
                    return { tipo: 'imagem', fotoId: foto ? foto.id : null };
                }
                return { tipo: 'texto', html: _semImagens(b.html || b.texto || '') };
            }).filter(b => b.tipo !== 'texto' || !!b.html);
            if (!gerados.length) throw new Error('A IA não devolveu blocos válidos');
            _state.blocos = gerados;
            _renderBlocos();
            _setDescStatus(`${gerados.length} blocos gerados — edite à vontade.`);
        } catch (e) {
            _setDescStatus('Erro: ' + e.message, 'error');
        }
    }

    async function _gerarBlocosDoMolde() {
        if (!_state.moldeDetalhes) { showToast('Nenhum molde selecionado', 'error'); return; }
        _setDescStatus('Lendo a estrutura do molde…');
        try {
            const esqueleto = _dividirEmBlocos(_state.moldeDetalhes.descriptionHtml);
            if (!esqueleto.length) throw new Error('O molde não tem descrição pra copiar a estrutura');
            const blocosTexto = esqueleto.map((b, i) => ({ ...b, _i: i })).filter(b => b.tipo === 'texto');
            const reescritos = {};
            if (blocosTexto.length) {
                _setDescStatus('Reescrevendo o texto pro novo produto…');
                const lista = blocosTexto.map(b => `{"indice": ${b._i}, "html": ${JSON.stringify(b.html)}}`).join(',\n');
                const prompt = `Produto-molde: "${_state.moldeDetalhes.title}". Produto novo: "${_state.titulo}".\nIdioma: ${_instrucaoIdioma()}\nBlocos originais:\n[${lista}]`;
                const txt = await _openaiJson(SISTEMA_BLOCOS_MOLDE, [{ role: 'user', content: prompt }]);
                const parsed = _extrairJson(txt);
                (parsed.blocos || []).forEach(b => { reescritos[b.indice] = b.html; });
            }
            // Ordem igual à do molde; texto reescrito, imagem atribuída por
            // ordem às fotos que o usuário trouxe (dá pra trocar no editor).
            let idxFoto = 0;
            const finais = esqueleto.map((b, i) => {
                if (b.tipo === 'imagem') {
                    const foto = _state.fotos[idxFoto++];
                    return { tipo: 'imagem', fotoId: foto ? foto.id : null };
                }
                // _semImagens é obrigatório aqui: `reescritos[i] || b.html` cai
                // no HTML ORIGINAL do molde quando a IA pula um índice, e esse
                // html pode carregar <img> do produto-molde junto.
                return { tipo: 'texto', html: _semImagens(reescritos[i] || b.html) };
            });
            _state.blocos = finais;
            _renderBlocos();
            _setDescStatus(`${finais.length} blocos montados a partir do molde — edite à vontade.`);
        } catch (e) {
            _setDescStatus('Erro: ' + e.message, 'error');
        }
    }

    // Divide um HTML de descrição em blocos texto/imagem — usado pra copiar a
    // ESTRUTURA do molde (o texto é reescrito depois pela IA; imagem vira
    // posição a preencher com as fotos do produto novo).
    //
    // Percorre a árvore INTEIRA, não só os filhos de primeiro nível: descrição
    // real de Shopify vem de editor WYSIWYG e é muito aninhada — no molde do
    // usuário as 3 <img> estavam dentro de <div><p><img> e <span><strong><img>,
    // a 2-4 níveis de profundidade. A versão anterior só olhava o topo e por
    // isso não achava imagem nenhuma (era o bug de "as fotos não entraram").
    function _dividirEmBlocos(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = String(html || '');
        const blocos = [];
        let buffer = '';

        const flush = () => {
            const limpo = buffer.trim();
            buffer = '';
            if (!limpo) return;
            // Descarta sobra de editor (spans/divs vazios, <br> solto): sem
            // texto visível, vira um bloco vazio inútil no editor.
            const aux = document.createElement('template');
            aux.innerHTML = limpo;
            if (aux.content.textContent.trim()) blocos.push({ tipo: 'texto', html: limpo });
        };

        const walk = (node) => {
            node.childNodes.forEach(n => {
                if (n.nodeType === Node.TEXT_NODE) { buffer += n.textContent; return; }
                if (n.nodeType !== Node.ELEMENT_NODE) return;
                if (n.tagName === 'IMG') { flush(); blocos.push({ tipo: 'imagem' }); return; }
                if (['META', 'SCRIPT', 'STYLE', 'LINK'].includes(n.tagName)) return;
                // Só desce se houver imagem lá dentro; senão preserva o HTML
                // do elemento inteiro (mantém <ul>, <h2>, formatação etc.).
                if (n.querySelector && n.querySelector('img')) { walk(n); return; }
                buffer += n.outerHTML;
            });
        };

        walk(tpl.content);
        flush();
        return blocos;
    }

    // ── Editor da descrição ──────────────────────────────────────────────
    // Redesenhado depois do 1º uso real: o editor antigo era uma pilha de
    // cartões onde (a) todo bloco novo nascia NO FIM e só subia de posição um
    // clique de seta por vez, (b) a foto era escolhida num <select> cujas
    // opções eram "yupoo · a3f9c" (ilegível — o usuário não sabe qual foto é),
    // e (c) qualquer mudança reescrevia a lista inteira, matando o cursor.
    // Agora: trilho de fotos sempre visível + ponto de inserção. Clicar numa
    // foto do trilho joga ela EXATAMENTE onde o ponto está.

    // Onde o próximo bloco entra (índice entre 0 e blocos.length).
    let _ponto = 0;
    // Quando o usuário clica numa imagem do documento, o próximo clique no
    // trilho TROCA aquela foto em vez de inserir uma nova.
    let _trocandoIdx = null;

    // Puxa o texto dos contenteditable pro estado ANTES de qualquer
    // re-render — senão o que foi digitado e ainda não deu blur se perde.
    function _sincronizarTextos() {
        document.querySelectorAll('#lanc-blocos-lista [data-bloco-texto]').forEach(el => {
            const i = parseInt(el.dataset.blocoTexto, 10);
            if (_state.blocos[i] && _state.blocos[i].tipo === 'texto') _state.blocos[i].html = el.innerHTML;
        });
    }

    function _adicionarBlocoManual(tipo) {
        _sincronizarTextos();
        const bloco = tipo === 'texto'
            ? { tipo: 'texto', html: '<p></p>' }
            : { tipo: 'imagem', fotoId: _proximaFotoNaoUsada() };
        // Inserir desloca todo índice >= _ponto — sem isso, uma troca pendente
        // (_trocandoIdx) passaria a apontar pro bloco errado.
        if (_trocandoIdx !== null && _trocandoIdx >= _ponto) _trocandoIdx++;
        _state.blocos.splice(_ponto, 0, bloco);   // entra NO PONTO, não no fim
        _ponto++;
        _renderBlocos();
        if (tipo === 'texto') _focarBloco(_ponto - 1);
    }

    function _proximaFotoNaoUsada() {
        const usados = new Set(_state.blocos.filter(b => b.tipo === 'imagem').map(b => b.fotoId));
        return (_state.fotos.find(f => !usados.has(f.id)) || _state.fotos[0] || {}).id || null;
    }

    // Clique numa foto do trilho: troca a imagem selecionada, ou insere no ponto.
    function _usarFoto(fotoId) {
        _sincronizarTextos();
        // Checa o tipo, não só a existência: se o índice guardado passou a
        // apontar pra um bloco de TEXTO (deslocado por remoção/movimento em
        // outro lugar), gravar fotoId nele seria um campo órfão e silencioso.
        if (_trocandoIdx !== null && _state.blocos[_trocandoIdx]?.tipo === 'imagem') {
            _state.blocos[_trocandoIdx].fotoId = fotoId;
            _trocandoIdx = null;
        } else {
            _trocandoIdx = null;
            _state.blocos.splice(_ponto, 0, { tipo: 'imagem', fotoId });
            _ponto++;
        }
        _renderBlocos();
    }

    // Distribui de uma vez todas as fotos que ainda não entraram, intercalando
    // depois de cada bloco de texto — resolve num clique o caso que era o mais
    // caro no editor antigo (colocar N fotos uma a uma).
    function _encaixarRestantes() {
        _sincronizarTextos();
        const usados = new Set(_state.blocos.filter(b => b.tipo === 'imagem').map(b => b.fotoId));
        const sobrando = _state.fotos.filter(f => !usados.has(f.id));
        if (!sobrando.length) return;
        // Reconstrói o array inteiro abaixo — qualquer troca pendente perderia
        // o alvo certo, então descarta em vez de arriscar apontar errado.
        _trocandoIdx = null;
        const saida = [];
        let i = 0;
        _state.blocos.forEach(b => {
            saida.push(b);
            if (b.tipo === 'texto' && i < sobrando.length) saida.push({ tipo: 'imagem', fotoId: sobrando[i++].id });
        });
        while (i < sobrando.length) saida.push({ tipo: 'imagem', fotoId: sobrando[i++].id });
        _state.blocos = saida;
        _ponto = saida.length;
        _renderBlocos();
        showToast(`${sobrando.length} foto(s) encaixada(s)`, 'success');
    }

    function _focarBloco(i) {
        const el = document.querySelector(`#lanc-blocos-lista [data-bloco-texto="${i}"]`);
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        const r = document.createRange();
        r.selectNodeContents(el); r.collapse(false);
        sel.removeAllRanges(); sel.addRange(r);
    }

    // Trilho de fotos: a foto É o botão. Some o <select> de ids ilegíveis.
    function _renderTrilho() {
        const el = document.getElementById('lanc-trilho');
        if (!el) return;
        const usados = new Set(_state.blocos.filter(b => b.tipo === 'imagem').map(b => b.fotoId));
        const sobrando = _state.fotos.filter(f => !usados.has(f.id)).length;
        el.innerHTML = `
            <div class="lanc-trilho-head">
                <span>${_trocandoIdx !== null ? 'Clique na foto que vai entrar no lugar' : 'Clique numa foto pra inserir onde está a linha'}</span>
                <span class="lanc-trilho-contador">${_state.fotos.length - sobrando} de ${_state.fotos.length} usadas</span>
                ${sobrando ? `<button type="button" class="btn btn-secondary btn-sm" id="lanc-encaixar">Encaixar as ${sobrando} restantes</button>` : ''}
            </div>
            <div class="lanc-trilho-fotos">
                ${_state.fotos.map((f, n) => `
                    <button type="button" class="lanc-trilho-foto${usados.has(f.id) ? ' is-usada' : ''}" data-usar-foto="${f.id}" title="${escapeHtml(f.origem)}">
                        <img src="${f.thumb}" alt="">
                        <span class="lanc-trilho-num">${n + 1}</span>
                    </button>`).join('') || '<span class="lanc-hint">Nenhuma foto — volte ao passo Fotos.</span>'}
            </div>`;
        el.classList.toggle('is-trocando', _trocandoIdx !== null);
        el.querySelectorAll('[data-usar-foto]').forEach(b => b.addEventListener('click', () => _usarFoto(b.dataset.usarFoto)));
        document.getElementById('lanc-encaixar')?.addEventListener('click', _encaixarRestantes);
        _icones();
    }

    function _renderBlocos() {
        const lista = document.getElementById('lanc-blocos-lista');
        if (!lista) return;
        if (_ponto > _state.blocos.length) _ponto = _state.blocos.length;

        const linha = (i) => `<div class="lanc-ponto${i === _ponto ? ' is-ativo' : ''}" data-ponto="${i}"><span>inserir aqui</span></div>`;

        let html = linha(0);
        _state.blocos.forEach((b, i) => {
            if (b.tipo === 'texto') {
                html += `<div class="lanc-bl" data-idx="${i}">
                    ${_acoesHtml(i)}
                    <div class="lanc-rich lanc-bl-texto" contenteditable="true" data-bloco-texto="${i}">${b.html || ''}</div>
                </div>`;
            } else {
                const foto = _state.fotos.find(f => f.id === b.fotoId);
                const processando = foto && _fotosProcessando.has(foto.id);
                const erro = foto && _fotosComErro.get(foto.id);
                html += `<div class="lanc-bl lanc-bl-img${_trocandoIdx === i ? ' is-trocando' : ''}${processando ? ' is-processando' : ''}${erro ? ' is-erro' : ''}" data-idx="${i}">
                    ${_acoesHtml(i)}
                    ${foto
                        ? `<img src="${foto.thumb}" alt="" data-trocar="${i}" title="Clique pra trocar a foto">`
                        : `<div class="lanc-bl-semfoto" data-trocar="${i}">Sem foto — clique e escolha no trilho</div>`}
                    ${processando ? `<div class="lanc-foto-carregando-overlay"><i data-lucide="loader-2" style="width:18px;height:18px;animation:spin 1s linear infinite"></i></div>` : ''}
                    ${erro ? `<div class="lanc-foto-erro-badge" title="${escapeHtml(erro)}"><i data-lucide="alert-triangle" style="width:12px;height:12px"></i></div>` : ''}
                </div>`;
            }
            html += linha(i + 1);
        });
        lista.innerHTML = html || linha(0);

        lista.querySelectorAll('[data-ponto]').forEach(el => {
            el.addEventListener('click', () => { _ponto = parseInt(el.dataset.ponto, 10); _trocandoIdx = null; _pintarPonto(); _renderTrilho(); });
        });
        lista.querySelectorAll('[data-bloco-texto]').forEach(el => {
            // Clicar dentro de um texto move o ponto pra logo depois dele —
            // é o "onde eu estou" natural pra próxima inserção.
            el.addEventListener('focus', () => { _ponto = parseInt(el.dataset.blocoTexto, 10) + 1; _trocandoIdx = null; _pintarPonto(); _renderTrilho(); });
            el.addEventListener('blur', () => {
                const i = parseInt(el.dataset.blocoTexto, 10);
                if (_state.blocos[i]) _state.blocos[i].html = el.innerHTML;
            });
        });
        lista.querySelectorAll('[data-trocar]').forEach(el => {
            el.addEventListener('click', () => _alternarTroca(parseInt(el.dataset.trocar, 10)));
        });
        lista.querySelectorAll('[data-trocar-foto]').forEach(btn => {
            btn.addEventListener('click', () => _alternarTroca(parseInt(btn.dataset.trocarFoto, 10)));
        });
        lista.querySelectorAll('[data-add-foto-apos]').forEach(btn => {
            btn.addEventListener('click', () => {
                _sincronizarTextos();
                const novoIdx = parseInt(btn.dataset.addFotoApos, 10) + 1;
                if (_trocandoIdx !== null && _trocandoIdx >= novoIdx) _trocandoIdx++;
                if (_ponto >= novoIdx) _ponto++;
                _state.blocos.splice(novoIdx, 0, { tipo: 'imagem', fotoId: _proximaFotoNaoUsada() });
                _renderBlocos();
            });
        });
        lista.querySelectorAll('[data-mover]').forEach(btn => {
            btn.addEventListener('click', () => _moverBloco(parseInt(btn.dataset.idx, 10), btn.dataset.mover === 'cima' ? -1 : 1));
        });
        lista.querySelectorAll('[data-remover-bloco]').forEach(btn => {
            btn.addEventListener('click', () => {
                _sincronizarTextos();
                const idx = parseInt(btn.dataset.removerBloco, 10);
                // Remover desloca tudo depois de idx pra trás em 1 — ajusta ou
                // descarta a troca pendente pra não migrar pro bloco vizinho.
                if (_trocandoIdx !== null) {
                    if (_trocandoIdx === idx) _trocandoIdx = null;
                    else if (_trocandoIdx > idx) _trocandoIdx--;
                }
                _state.blocos.splice(idx, 1);
                _renderBlocos(); _renderTrilho();
            });
        });
        lista.querySelectorAll('[data-editar-foto]').forEach(btn => {
            btn.addEventListener('click', () => {
                const b = _state.blocos[parseInt(btn.dataset.editarFoto, 10)];
                if (b?.fotoId) _abrirEditorIA([b.fotoId]);
                else showToast('Esse bloco ainda não tem foto — escolha uma antes de editar com IA', 'error');
            });
        });
        _renderTrilho();
        _icones();
    }

    // Só repinta a linha ativa — não redesenha o documento (não mata o cursor).
    function _pintarPonto() {
        document.querySelectorAll('#lanc-blocos-lista [data-ponto]').forEach(el => {
            el.classList.toggle('is-ativo', parseInt(el.dataset.ponto, 10) === _ponto);
        });
    }

    function _acoesHtml(i) {
        const b = _state.blocos[i];
        return `<div class="lanc-bl-acoes">
            ${b?.tipo === 'imagem' ? `
                <button type="button" data-editar-foto="${i}" title="Editar com IA"><i data-lucide="wand-2" style="width:13px;height:13px"></i></button>
                <button type="button" data-trocar-foto="${i}" title="Substituir foto"><i data-lucide="image" style="width:13px;height:13px"></i></button>
                <button type="button" data-add-foto-apos="${i}" title="Adicionar foto aqui"><i data-lucide="image-plus" style="width:13px;height:13px"></i></button>
            ` : ''}
            <button type="button" data-mover="cima" data-idx="${i}" title="Mover pra cima"><i data-lucide="chevron-up" style="width:13px;height:13px"></i></button>
            <button type="button" data-mover="baixo" data-idx="${i}" title="Mover pra baixo"><i data-lucide="chevron-down" style="width:13px;height:13px"></i></button>
            <button type="button" data-remover-bloco="${i}" title="Remover"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
        </div>`;
    }

    // Compartilhado pelo clique na própria foto E pelo botão "Substituir foto"
    // — os dois entram no mesmo modo de troca (clique numa foto do trilho).
    function _alternarTroca(i) {
        _trocandoIdx = (_trocandoIdx === i) ? null : i;
        _renderBlocos(); _renderTrilho();
    }

    function _moverBloco(i, delta) {
        const j = i + delta;
        if (j < 0 || j >= _state.blocos.length) return;
        _sincronizarTextos();
        // Swap troca as posições i/j — segue a troca pendente junto.
        if (_trocandoIdx === i) _trocandoIdx = j;
        else if (_trocandoIdx === j) _trocandoIdx = i;
        const tmp = _state.blocos[i]; _state.blocos[i] = _state.blocos[j]; _state.blocos[j] = tmp;
        _renderBlocos();
    }

    // ── Edição de foto por IA (uma, várias ou todas) ────────────────────
    // Regrava no MESMO mediaId: MediaStore.put é upsert, então todo bloco da
    // descrição que aponta pra essa foto herda a edição sem precisar mexer em
    // nada. A original fica guardada em `_original` pra dar Desfazer.
    const PRESETS_EDICAO = [
        {
            id: 'fundo-branco', label: 'Fundo branco', icone: 'square',
            descricao: 'Recorta local (sem IA) e põe fundo branco puro',
            // Recorte por SEGMENTAÇÃO local (@imgly/background-removal, WASM,
            // roda no navegador) + achatamento em canvas: dá branco EXATO e,
            // ao contrário de pedir "recorte" pra um modelo generativo, é
            // MATEMATICAMENTE incapaz de alterar um pixel do produto — não
            // redesenha nada, só classifica fundo/objeto. Sem custo de API.
            executar: async (blob) => {
                const recortado = await ImageAI.removerFundoLocal(blob);
                return await ImageAI.achatarSobreCor(recortado, '#FFFFFF');
            },
            // Só cai aqui se o recorte local falhar (lib não carregou, foto
            // incomum) — voltamos pro caminho antigo via IA generativa.
            alternativa: async (blob, ctx) => {
                const recortado = await ImageAI.editar(blob, ImageAI.promptRecorte(ctx), {
                    provedor: 'openai', background: 'transparent', formato: 'image/png',
                });
                return await ImageAI.achatarSobreCor(recortado, '#FFFFFF');
            },
        },
        {
            id: 'fundo-transparente', label: 'Fundo transparente', icone: 'layers',
            descricao: 'Recorta local (sem IA) e deixa o fundo vazio (PNG)',
            executar: async (blob) => ImageAI.removerFundoLocal(blob),
            alternativa: async (blob, ctx) => ImageAI.editar(blob, ImageAI.promptRecorte(ctx), {
                provedor: 'openai', background: 'transparent', formato: 'image/png',
            }),
        },
        {
            id: 'melhorar', label: 'Melhorar qualidade', icone: 'sparkles',
            descricao: 'Tira ruído e borrão, recupera detalhe (IA)',
            executar: async (blob, ctx) => ImageAI.editar(blob, ImageAI.promptMelhoria(ctx), {
                formato: 'image/webp', compressao: 92,
                provedor: _provedorImagemLanc(), modelo: _modeloImagemLanc() || undefined,
            }),
        },
        {
            // Não roda direto ao clicar — abre o painel de cenário (chips +
            // texto) igual ao "Gerar produto em uso" do Estúdio de Produto.
            id: 'cenario', label: 'Cenário', icone: 'image', especial: 'cenario',
            descricao: 'Produto em uso ou sobre uma superfície (IA)',
        },
    ];

    // Mesma lista de sugestões do Estúdio de Produto (js/products.js,
    // abrirGerarCenario) — em inglês porque os modelos de imagem respondem
    // melhor nesse idioma pra descrição de cena.
    const SUGESTOES_CENARIO = [
        "being held in a person's hand, outdoors",
        'on top of a rustic wooden table',
        'on top of a white marble countertop',
        'being worn by an adult model, natural light',
        'on top of a car dashboard',
        'on a beach towel with sand and sea in the background',
    ];

    // Mesmos ângulos de câmera do Estúdio de Produto (js/studio.js,
    // ANGULOS_CAMERA) — duplicado aqui de propósito (mesmo padrão já usado
    // por SUGESTOES_CENARIO acima) pra não acoplar a ordem de carregamento
    // dos scripts.
    const ANGULOS_CAMERA_LANC = [
        { id: 'frontal',  label: 'Frontal',        instrucao: 'Camera angle: straight-on frontal view, camera at the product\'s own height.' },
        { id: '3-4-esq',  label: '3/4 esquerdo',   instrucao: 'Camera angle: three-quarter view shot from the front-left of the product.' },
        { id: '3-4-dir',  label: '3/4 direito',    instrucao: 'Camera angle: three-quarter view shot from the front-right of the product.' },
        { id: 'lateral',  label: 'Lateral',         instrucao: 'Camera angle: direct side profile, 90 degrees from the front.' },
        { id: 'traseiro', label: 'Traseiro',        instrucao: 'Camera angle: shot from directly behind, showing the back of the product.' },
        { id: 'superior', label: 'Superior (topo)', instrucao: 'Camera angle: top-down flat-lay view, camera positioned directly above the product.' },
        { id: 'macro',    label: 'Detalhe / macro', instrucao: 'Camera angle: extreme close-up macro shot focused on the product\'s texture, material and finish.' },
        { id: 'em-uso',   label: 'Em uso',          instrucao: 'Camera angle: the product actively being used, in a natural and realistic context.' },
        { id: 'packshot', label: 'Packshot',        instrucao: 'Camera angle: clean isolated packshot, centered, no distracting elements, catalogue style.' },
    ];

    // Formatos de saída pro editor de fotos (opcional — "Formato original"
    // deixa a IA decidir, igual ao comportamento de sempre).
    const DIMENSOES_LANC = [
        { id: '1x1',  label: 'Quadrado 1:1',  w: 1080, h: 1080, ar: '1:1' },
        { id: '9x16', label: 'Story 9:16',    w: 1080, h: 1920, ar: '9:16' },
        { id: '4x5',  label: 'Feed 4:5',      w: 1080, h: 1350, ar: '4:5' },
        { id: '16x9', label: 'Paisagem 16:9', w: 1920, h: 1080, ar: '16:9' },
    ];

    // Provedor/modelo de IA escolhido pro editor de fotos — mesma chave de
    // localStorage que Produtos/Estúdio já usam (studio_img_provider/
    // studio_img_modelo), pra não pedir a mesma escolha 3 vezes no app.
    function _provedorImagemLanc() {
        return document.getElementById('lanc-img-provider')?.value || localStorage.getItem('studio_img_provider') || 'auto';
    }
    function _modeloImagemLanc() {
        return document.getElementById('lanc-img-modelo')?.value || localStorage.getItem('studio_img_modelo') || '';
    }
    function _seletorProvedorHtml() {
        const provedorSalvo = localStorage.getItem('studio_img_provider') || 'auto';
        const modeloSalvo = localStorage.getItem('studio_img_modelo') || '';
        const opcaoModelo = (id) => `<option value="${id}" ${id === modeloSalvo ? 'selected' : ''}>${ImageAI.NOMES_MODELO[id] || id}</option>`;
        return `
            <div class="lanc-provider-row">
                <select id="lanc-img-provider" class="input input-sm" title="Qual IA gera/melhora as imagens (só usada em 'Melhorar qualidade' e ajuste personalizado)">
                    <option value="auto" ${provedorSalvo === 'auto' ? 'selected' : ''}>Automático (Gemini → OpenAI)</option>
                    <option value="gemini" ${provedorSalvo === 'gemini' ? 'selected' : ''}>Google · Gemini Image</option>
                    <option value="openai" ${provedorSalvo === 'openai' ? 'selected' : ''}>OpenAI · GPT Image</option>
                </select>
                <select id="lanc-img-modelo" class="input input-sm" title="Fixar uma versão específica (só vale com um provedor escolhido ao lado)">
                    <option value="">Padrão (recomendado)</option>
                    <optgroup label="OpenAI" data-provedor="openai">${ImageAI.MODELOS_OPENAI.map(opcaoModelo).join('')}</optgroup>
                    <optgroup label="Google Gemini" data-provedor="gemini">${ImageAI.MODELOS_GEMINI.map(opcaoModelo).join('')}</optgroup>
                </select>
            </div>`;
    }
    function _wireSeletorProvedor(ov) {
        const provSel = ov.querySelector('#lanc-img-provider');
        const modSel = ov.querySelector('#lanc-img-modelo');
        const sincronizar = () => {
            if (!modSel) return;
            const auto = provSel?.value === 'auto';
            modSel.disabled = auto;
            [...modSel.querySelectorAll('optgroup')].forEach(g => { g.hidden = auto || g.dataset.provedor !== provSel.value; });
            const opt = modSel.selectedOptions[0];
            if (auto || (opt?.parentElement?.tagName === 'OPTGROUP' && opt.parentElement.hidden)) modSel.value = '';
        };
        provSel?.addEventListener('change', () => { localStorage.setItem('studio_img_provider', provSel.value); sincronizar(); });
        modSel?.addEventListener('change', () => localStorage.setItem('studio_img_modelo', modSel.value));
        sincronizar();
    }

    let _edicaoCancelada = false;
    // Estado de carregamento/erro POR FOTO (LAUNCH-05) — a mesma foto pode
    // aparecer na grade do Passo 2 e em blocos do Passo 3 ao mesmo tempo,
    // então rastreia por fotoId e os dois lugares refletem juntos.
    const _fotosProcessando = new Set();
    const _fotosComErro = new Map();

    function _abrirEditorIA(fotoIds) {
        const preSelecionadas = new Set((fotoIds && fotoIds.length) ? fotoIds : _state.fotos.map(f => f.id));
        if (!_state.fotos.length) { showToast('Não há fotos pra editar', 'error'); return; }
        // Sem isso, abrir o editor duas vezes empilha overlays: o seletor de
        // preset pega o elemento errado (do overlay antigo) e a edição
        // silenciosamente não bate na foto que o usuário está vendo.
        document.querySelectorAll('.lanc-ov').forEach(el => el.remove());

        // Lê os checkboxes AO VIVO — "editar 1"/"editar todas" só define o
        // estado inicial marcado; o usuário pode ajustar antes de aplicar.
        const _fotosSelecionadas = (ov) => [...ov.querySelectorAll('[data-foto-check]:checked')].map(el => el.dataset.fotoCheck);

        const ov = document.createElement('div');
        ov.className = 'lanc-ov';
        ov.innerHTML = `
            <div class="lanc-ov-caixa">
                <h3><i data-lucide="wand-2" style="width:16px;height:16px;vertical-align:-3px"></i> Editar fotos com IA</h3>
                <p class="lanc-hint">Fundo branco/transparente rodam localmente, sem custo. Melhorar qualidade, cenário e ajuste personalizado usam IA paga — a original fica guardada, dá pra desfazer.</p>
                <div class="lanc-editor-fotos-head">
                    <span>Fotos <strong id="lanc-editor-fotos-count">${preSelecionadas.size}</strong> de ${_state.fotos.length} selecionadas</span>
                    <span>
                        <button type="button" class="lanc-link-btn" id="lanc-editor-fotos-todas">Todas</button>
                        · <button type="button" class="lanc-link-btn" id="lanc-editor-fotos-nenhuma">Nenhuma</button>
                    </span>
                </div>
                <div class="lanc-editor-fotos-grid">
                    ${_state.fotos.map(f => `
                        <label class="lanc-editor-foto-item">
                            <input type="checkbox" data-foto-check="${f.id}" ${preSelecionadas.has(f.id) ? 'checked' : ''}>
                            <img src="${f.thumb}" alt="">
                        </label>`).join('')}
                </div>
                ${_seletorProvedorHtml()}
                <div class="lanc-preset-grid">
                    ${PRESETS_EDICAO.map(p => `
                        <button type="button" class="lanc-preset" data-preset="${p.id}">
                            <i data-lucide="${p.icone}" style="width:16px;height:16px"></i>
                            <strong>${p.label}</strong><span>${p.descricao}</span>
                        </button>`).join('')}
                </div>
                <div class="lanc-avancado" id="lanc-avancado">
                    <span style="font-size:0.78rem;color:var(--text-muted)">Opções avançadas — valem pra Cenário e Ajuste personalizado</span>
                    <div class="lanc-avancado-row">
                        <div class="lanc-avancado-ref">
                            <input type="file" id="lanc-ref-file" accept="image/*" hidden>
                            <button type="button" class="btn btn-secondary btn-sm" id="lanc-ref-btn"><i data-lucide="image-plus" style="width:13px;height:13px"></i> Foto de referência</button>
                            <img id="lanc-ref-preview" alt="" class="lanc-ref-preview" style="display:none">
                            <button type="button" class="btn-icon" id="lanc-ref-remover" style="display:none" title="Remover referência"><i data-lucide="x" style="width:13px;height:13px"></i></button>
                        </div>
                        <select id="lanc-editor-angulo" class="input input-sm" title="Ângulo de câmera (opcional)">
                            <option value="">Ângulo automático</option>
                            ${ANGULOS_CAMERA_LANC.map(a => `<option value="${a.id}">${escapeHtml(a.label)}</option>`).join('')}
                        </select>
                        <select id="lanc-editor-aspecto" class="input input-sm" title="Formato/proporção de saída (opcional)">
                            <option value="">Formato original</option>
                            ${DIMENSOES_LANC.map(d => `<option value="${d.id}">${escapeHtml(d.label)}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="lanc-cenario-painel" id="lanc-cenario-painel" style="display:none">
                    <label for="lanc-cenario-texto" style="font-size:0.78rem;color:var(--text-muted)">Onde/como o produto aparece (funciona melhor em inglês)</label>
                    <div class="prompt-lib-row">
                        <input type="text" id="lanc-cenario-texto" class="input" placeholder="ex.: on top of a wooden table" list="lanc-cenario-sugestoes">
                        <button type="button" class="btn btn-secondary btn-sm" id="lanc-cenario-lib" title="Biblioteca de prompts"><i data-lucide="library" style="width:14px;height:14px"></i></button>
                    </div>
                    <datalist id="lanc-cenario-sugestoes">${SUGESTOES_CENARIO.map(s => `<option value="${escapeHtml(s)}">`).join('')}</datalist>
                    <div class="lanc-cenario-chips">${SUGESTOES_CENARIO.map(s => `<button type="button" class="lanc-cenario-chip" data-sug="${escapeHtml(s)}">${escapeHtml(s)}</button>`).join('')}</div>
                    <button type="button" class="btn btn-primary btn-sm" id="lanc-cenario-aplicar">Gerar cenário</button>
                </div>
                <label for="lanc-prompt-livre" style="margin-top:0.7rem;display:block;font-size:0.78rem;color:var(--text-muted)">Ou descreva o que quer mudar</label>
                <div class="lanc-prompt-row">
                    <input type="text" id="lanc-prompt-livre" class="input" placeholder="Ex.: deixar o fundo cinza claro, tirar a mão que segura o produto">
                    <button type="button" class="btn btn-secondary" id="lanc-prompt-lib" title="Biblioteca de prompts"><i data-lucide="library" style="width:14px;height:14px"></i></button>
                    <button type="button" class="btn btn-primary" id="lanc-prompt-ok">Aplicar</button>
                </div>
                <div class="bulk-progress" id="lanc-edit-prog" style="display:none"><div class="bulk-progress-bar"><div class="bulk-progress-fill" id="lanc-edit-fill"></div></div></div>
                <div id="lanc-edit-status" class="lanc-fotos-status"></div>
                <div class="lanc-ov-acoes">
                    <button type="button" class="btn btn-secondary" id="lanc-edit-fechar">Fechar</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        _wireSeletorProvedor(ov);
        ov.addEventListener('click', (e) => { if (e.target === ov) _fecharEditorIA(ov); });
        ov.querySelector('#lanc-edit-fechar').addEventListener('click', () => _fecharEditorIA(ov));

        const contadorEl = ov.querySelector('#lanc-editor-fotos-count');
        const atualizarContador = () => { contadorEl.textContent = _fotosSelecionadas(ov).length; };
        ov.querySelectorAll('[data-foto-check]').forEach(cb => cb.addEventListener('change', atualizarContador));
        ov.querySelector('#lanc-editor-fotos-todas').addEventListener('click', () => {
            ov.querySelectorAll('[data-foto-check]').forEach(cb => cb.checked = true);
            atualizarContador();
        });
        ov.querySelector('#lanc-editor-fotos-nenhuma').addEventListener('click', () => {
            ov.querySelectorAll('[data-foto-check]').forEach(cb => cb.checked = false);
            atualizarContador();
        });

        const _exigirSelecao = () => {
            const alvos = _fotosSelecionadas(ov);
            if (!alvos.length) showToast('Selecione ao menos uma foto', 'error');
            return alvos;
        };

        // Opções avançadas (STUDIO-09) — foto de referência, ângulo de
        // câmera e formato/proporção, usadas por Cenário e Ajuste
        // personalizado. Não valem pra fundo branco/transparente/melhorar
        // qualidade: são operações locais ou de restauração da MESMA foto,
        // não geração/recomposição — anexar referência ou trocar ângulo ali
        // não faz sentido e reabriria a brecha de alterar o produto à toa.
        let _refBlobEditor = null;
        const refBtn = ov.querySelector('#lanc-ref-btn');
        const refFile = ov.querySelector('#lanc-ref-file');
        const refPreview = ov.querySelector('#lanc-ref-preview');
        const refRemover = ov.querySelector('#lanc-ref-remover');
        refBtn?.addEventListener('click', () => refFile.click());
        refFile?.addEventListener('change', () => {
            const f = refFile.files?.[0];
            if (!f) return;
            _refBlobEditor = f;
            refPreview.src = URL.createObjectURL(f);
            refPreview.style.display = '';
            refRemover.style.display = '';
        });
        refRemover?.addEventListener('click', () => {
            _refBlobEditor = null;
            refFile.value = '';
            refPreview.style.display = 'none';
            refRemover.style.display = 'none';
        });

        // Monta prompt final + opções do ImageAI.editar a partir do prompt
        // base (já pronto) e do que estiver marcado nas opções avançadas.
        const _comOpcoesAvancadas = (promptBase) => {
            const anguloId = ov.querySelector('#lanc-editor-angulo')?.value || '';
            const angulo = ANGULOS_CAMERA_LANC.find(a => a.id === anguloId);
            const dimId = ov.querySelector('#lanc-editor-aspecto')?.value || '';
            const dim = DIMENSOES_LANC.find(d => d.id === dimId);
            const prompt = angulo ? `${promptBase} ${angulo.instrucao}` : promptBase;
            const opts = {
                formato: 'image/webp', compressao: 92,
                provedor: _provedorImagemLanc(), modelo: _modeloImagemLanc() || undefined,
                ...(dim ? { largura: dim.w, altura: dim.h, aspectRatio: dim.ar } : {}),
            };
            return { prompt, opts };
        };

        ov.querySelectorAll('[data-preset]').forEach(b => {
            b.addEventListener('click', () => {
                const p = PRESETS_EDICAO.find(x => x.id === b.dataset.preset);
                if (!p) return;
                if (p.especial === 'cenario') {
                    ov.querySelector('#lanc-cenario-painel').style.display = '';
                    ov.querySelector('#lanc-cenario-texto')?.focus();
                    return;
                }
                const alvos = _exigirSelecao();
                if (alvos.length) _aplicarEdicao(alvos, p, ov);
            });
        });

        const campoCenario = ov.querySelector('#lanc-cenario-texto');
        ov.querySelectorAll('.lanc-cenario-chip').forEach(chip => {
            chip.addEventListener('click', () => { campoCenario.value = chip.dataset.sug; campoCenario.focus(); });
        });
        const aplicarCenario = () => {
            const texto = campoCenario.value.trim();
            if (!texto) { showToast('Descreva o cenário', 'error'); campoCenario.focus(); return; }
            const alvos = _exigirSelecao();
            if (!alvos.length) return;
            _aplicarEdicao(alvos, {
                label: 'Cenário',
                executar: async (blob, ctx) => {
                    let promptBase = ImageAI.promptCenario(texto, ctx);
                    let entrada = blob;
                    if (_refBlobEditor) {
                        entrada = [_refBlobEditor, blob];
                        promptBase = `Use the two provided images. THE FIRST IMAGE is a style/composition reference — copy its scene, lighting and framing. THE SECOND IMAGE is the real product photo. ${promptBase} Keep the product from the second image completely unchanged — same shape, colour, material, branding, logos and text.`;
                    }
                    const { prompt, opts } = _comOpcoesAvancadas(promptBase);
                    return ImageAI.editar(entrada, prompt, opts);
                },
            }, ov);
        };
        ov.querySelector('#lanc-cenario-aplicar').addEventListener('click', aplicarCenario);
        campoCenario.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aplicarCenario(); } });
        ov.querySelector('#lanc-cenario-lib')?.addEventListener('click', () => {
            window.PromptTemplates?.open({
                prefill: campoCenario.value,
                onUse: (texto) => { campoCenario.value = texto; campoCenario.focus(); },
            });
        });

        const aplicarLivre = () => {
            const texto = ov.querySelector('#lanc-prompt-livre').value.trim();
            // Descrição só é obrigatória se não tiver referência nem ângulo —
            // com uma das duas, já é instrução suficiente (LAUNCH-02).
            const anguloSelecionado = !!ov.querySelector('#lanc-editor-angulo')?.value;
            const temInstrucaoSuficiente = !!_refBlobEditor || anguloSelecionado;
            if (!texto && !temInstrucaoSuficiente) {
                showToast('Escreva o que você quer mudar, ou anexe uma referência/ângulo', 'error');
                return;
            }
            const alvos = _exigirSelecao();
            if (!alvos.length) return;
            _aplicarEdicao(alvos, {
                label: 'Ajuste personalizado',
                executar: async (blob, ctx) => {
                    let promptBase = texto
                        ? _promptLivre(texto, ctx)
                        : `Using the provided product photo, adjust it following the reference image and/or camera angle instruction given. Keep everything else in the image exactly the same, preserving the original style, lighting and composition. The product itself must remain completely unchanged — identical shape, proportions, colour, materials, branding, logos, text and markings.${ctx ? ` The product is: ${ctx}.` : ''}`;
                    let entrada = blob;
                    if (_refBlobEditor) {
                        entrada = [_refBlobEditor, blob];
                        promptBase = `Use the two provided images. THE FIRST IMAGE is a style/composition reference — copy its scene, lighting and framing. THE SECOND IMAGE is the real product photo. ${promptBase} Keep the product from the second image completely unchanged — same shape, colour, material, branding, logos and text.`;
                    }
                    const { prompt, opts } = _comOpcoesAvancadas(promptBase);
                    return ImageAI.editar(entrada, prompt, opts);
                },
            }, ov);
        };
        ov.querySelector('#lanc-prompt-ok').addEventListener('click', aplicarLivre);
        ov.querySelector('#lanc-prompt-livre').addEventListener('keydown', (e) => { if (e.key === 'Enter') aplicarLivre(); });
        ov.querySelector('#lanc-prompt-lib')?.addEventListener('click', () => {
            const campo = ov.querySelector('#lanc-prompt-livre');
            window.PromptTemplates?.open({
                prefill: campo.value,
                onUse: (texto) => { campo.value = texto; campo.focus(); },
            });
        });
        _icones();
    }

    function _fecharEditorIA(ov) {
        _edicaoCancelada = true;
        ov.remove();
    }

    // Pedido livre do usuário + as travas de preservação do produto, que ele
    // não vai escrever mas sem as quais o modelo redesenha o produto.
    function _promptLivre(pedido, contexto) {
        return `Using the provided product photo, apply this change: ${pedido}.`
            + ` Keep everything else in the image exactly the same, preserving the original style, lighting and composition.`
            + ` The product itself must remain completely unchanged — identical shape, proportions, colour, materials, branding, logos, text and markings.`
            + ` Do not crop, zoom or rotate the product, and do not add any text or logo that is not already on it.`
            + (contexto ? ` The product is: ${contexto}.` : '');
    }

    async function _aplicarEdicao(fotoIds, preset, ov) {
        _edicaoCancelada = false;
        const prog = ov.querySelector('#lanc-edit-prog');
        const fill = ov.querySelector('#lanc-edit-fill');
        const status = ov.querySelector('#lanc-edit-status');
        prog.style.display = '';
        let ok = 0, falhas = 0;

        for (let i = 0; i < fotoIds.length; i++) {
            if (_edicaoCancelada) break;
            const foto = _state.fotos.find(f => f.id === fotoIds[i]);
            if (!foto) continue;
            status.textContent = `${preset.label} — ${i + 1} de ${fotoIds.length}…`;
            fill.style.width = `${Math.round((i / fotoIds.length) * 100)}%`;
            _fotosProcessando.add(foto.id);
            _fotosComErro.delete(foto.id);
            _renderFotosGrid();
            if (_state.passoAtual === 3) _renderBlocos();
            try {
                const rec = await MediaStore.get(foto.mediaId);
                if (!rec?.blob) throw new Error('foto não encontrada');
                // Guarda a original UMA vez (segunda edição não sobrescreve o
                // ponto de restauração original).
                if (!foto._original) {
                    const origId = foto.mediaId + '_orig';
                    await MediaStore.put(origId, rec.blob, { type: rec.blob.type });
                    foto._original = origId;
                }
                const ctx = _state.titulo || '';
                let saida;
                try {
                    saida = await preset.executar(rec.blob, ctx);
                } catch (e1) {
                    if (!preset.alternativa) throw e1;
                    console.warn('[Lançamento] preset principal falhou, usando alternativa:', e1.message);
                    saida = await preset.alternativa(rec.blob, ctx);
                }
                // Gera a miniatura ANTES de gravar no MediaStore: se
                // comprimirImagem/_blobParaDataUrl falhar aqui, nada foi
                // persistido ainda — sem isso, uma falha NESTE passo deixava o
                // MediaStore com a foto editada mas a UI (foto.thumb/editada)
                // com a antiga, e uma nova tentativa editava em cima da edição
                // que a UI dizia ter falhado.
                const mini = await comprimirImagem(saida, 320, 0.7, { formato: 'image/webp' });
                const thumbDataUrl = await _blobParaDataUrl(mini.blob);
                // Upsert no MESMO mediaId: todos os blocos que usam essa foto
                // passam a mostrar a versão editada automaticamente.
                await MediaStore.put(foto.mediaId, saida, { type: saida.type });
                foto.thumb = thumbDataUrl;
                foto.editada = true;
                if (typeof RecentEdits !== 'undefined') {
                    RecentEdits.add({
                        prompt: preset.label || 'Edição de foto',
                        thumb: thumbDataUrl,
                        origem: 'Lançamento',
                        tipo: preset.label || '',
                        produto: _state.titulo || '',
                    });
                }
                ok++;
                _fotosProcessando.delete(foto.id);
                _renderFotosGrid();
                if (_state.passoAtual === 3) _renderBlocos();
            } catch (e) {
                falhas++;
                console.error('[Lançamento] edição falhou:', e);
                status.textContent = 'Erro: ' + String(e.message).slice(0, 160);
                _fotosProcessando.delete(foto.id);
                _fotosComErro.set(foto.id, String(e.message).slice(0, 160));
                _renderFotosGrid();
                if (_state.passoAtual === 3) _renderBlocos();
            }
        }
        fill.style.width = '100%';
        if (!_edicaoCancelada) {
            status.textContent = falhas
                ? `${ok} foto(s) editada(s), ${falhas} falhou(ram).`
                : `${ok} foto(s) editada(s).`;
            showToast(falhas ? `${ok} editada(s), ${falhas} com erro` : `${ok} foto(s) editada(s)`, falhas ? 'warning' : 'success');
        }
    }

    // Volta a foto pra versão antes da edição por IA.
    async function _desfazerEdicao(fotoId) {
        const foto = _state.fotos.find(f => f.id === fotoId);
        if (!foto?._original) return;
        try {
            const rec = await MediaStore.get(foto._original);
            if (!rec?.blob) throw new Error('original não encontrada');
            await MediaStore.put(foto.mediaId, rec.blob, { type: rec.blob.type });
            const mini = await comprimirImagem(rec.blob, 320, 0.7, { formato: 'image/webp' });
            foto.thumb = await _blobParaDataUrl(mini.blob);
            foto.editada = false;
            _renderFotosGrid();
            if (_state.passoAtual === 3) _renderBlocos();
            showToast('Foto restaurada', 'success');
        } catch (e) {
            showToast('Não consegui restaurar: ' + e.message, 'error');
        }
    }

    // ── Passo 4: Brinde ───────────────────────────────────────────────
    function _bindPasso4() {
        document.getElementById('lanc-brinde-incluir')?.addEventListener('change', (e) => {
            _state.brinde.incluir = e.target.checked;
            document.getElementById('lanc-brinde-editor')?.classList.toggle('hidden', !e.target.checked);
        });
        document.getElementById('lanc-brinde-titulo')?.addEventListener('input', (e) => { _state.brinde.titulo = e.target.value; });
        document.getElementById('lanc-brinde-texto')?.addEventListener('blur', (e) => { _state.brinde.html = e.target.innerHTML; });
    }

    // Só sugere uma vez por sessão do wizard — não sobrescreve edição do usuário.
    function _prepararPasso4() {
        if (_state._brindeSugerido) return;
        _state._brindeSugerido = true;
        if (!_state.moldeDetalhes) return;
        const trecho = _detectarBrindeNoMolde(_state.moldeDetalhes.descriptionHtml);
        if (!trecho) return;
        _state.brinde = { incluir: true, titulo: trecho.titulo || 'Brinde', html: trecho.html || '' };
        const chk = document.getElementById('lanc-brinde-incluir');
        if (chk) chk.checked = true;
        document.getElementById('lanc-brinde-editor')?.classList.remove('hidden');
        const tituloEl = document.getElementById('lanc-brinde-titulo');
        if (tituloEl) tituloEl.value = _state.brinde.titulo;
        const textoEl = document.getElementById('lanc-brinde-texto');
        if (textoEl) textoEl.innerHTML = _state.brinde.html;
        const status = document.getElementById('lanc-brinde-status');
        if (status) status.textContent = 'Herdado do molde — confira e ajuste antes de continuar.';
    }

    // Acha a seção de brinde no molde. Trabalha em cima dos BLOCOS já
    // divididos (mesmo parser da descrição) em vez dos filhos crus do HTML:
    // pegar "o elemento que cita brinde + tudo depois" trazia metade do
    // documento junto, porque num HTML aninhado o "elemento" do topo é um
    // <div> gigante com o resto da página dentro.
    function _detectarBrindeNoMolde(html) {
        if (!html) return null;
        // Loja em inglês raramente escreve "brinde"/"gift": no molde do
        // usuário a seção é "Accessories that come with the glasses".
        const regex = /brinde|b[oô]nus|gift|free\b|gr[aá]tis|acompanha|inclu[íi]d|included|accessories|comes? with|you (?:also )?(?:get|receive)/i;
        const bloco = _dividirEmBlocos(html).find(b => b.tipo === 'texto' && regex.test(b.html));
        if (!bloco) return null;

        const tpl = document.createElement('template');
        tpl.innerHTML = bloco.html;
        const filhos = [...tpl.content.children];

        // Ancora no elemento que DE FATO casou com a regex — pegar o primeiro
        // heading do bloco daria o título de outra seção (no molde real,
        // "Unforgettable experience", que vem depois dos acessórios).
        let ini = filhos.findIndex(el => regex.test(el.textContent || ''));
        if (ini < 0) ini = 0;

        // Vai até o próximo heading grande, que já é outra seção.
        let fim = filhos.length;
        for (let i = ini + 1; i < filhos.length; i++) {
            if (/^H[1-3]$/.test(filhos[i].tagName)) { fim = i; break; }
        }
        const trecho = filhos.slice(ini, fim);
        if (!trecho.length) return null;

        // Título = primeira linha do elemento âncora (não o textContent
        // inteiro, que juntaria a lista de itens dentro do título).
        const ancora = trecho[0].cloneNode(true);
        let titulo = (ancora.textContent || '').split('\n').map(l => l.trim()).find(Boolean) || '';
        titulo = titulo.replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').slice(0, 70);

        // Tira só o pedaço que virou título, de dentro do âncora — remover o
        // âncora inteiro levaria junto o conteúdo que interessa (no molde
        // real, a lista "Cleaning cloth / test cards / Original case" mora
        // no mesmo <div> do cabeçalho "Accessories that come with...").
        const norm = (s) => String(s || '').replace(/\s+/g, ' ').replace(/[:：]\s*$/, '').trim();
        if (norm(ancora.textContent) !== norm(titulo)) {
            const alvo = [...ancora.children].find(el => norm(el.textContent).startsWith(norm(titulo)));
            if (alvo) alvo.remove();
        } else {
            ancora.innerHTML = ''; // o âncora era só o título
        }

        // O corpo NÃO repete o título — ele já tem campo próprio no editor.
        const partes = [];
        if (ancora.textContent.trim()) partes.push(ancora.outerHTML);
        trecho.slice(1).forEach(el => partes.push(el.outerHTML));
        return { titulo: titulo || 'Brinde', html: partes.join('') };
    }

    // ── Passo 5: Revisar ──────────────────────────────────────────────
    function _bindPasso5() {
        document.getElementById('lanc-salvar-rascunho')?.addEventListener('click', () => _salvarRascunho());
        document.getElementById('lanc-publicar-shopify')?.addEventListener('click', () => _publicarNaShopify());
    }

    function _prepararPasso5() {
        _renderResumo();
        _renderPreviewFinal();
    }

    function _renderResumo() {
        const el = document.getElementById('lanc-revisar-resumo');
        if (!el) return;
        const baseTxt = _state.base === 'molde' ? `Molde: ${_state.moldeDetalhes?.title || '—'}` : 'Do zero';
        el.innerHTML = `
            <div><strong>Nome:</strong> ${escapeHtml(_state.titulo || '—')}</div>
            <div><strong>Base:</strong> ${escapeHtml(baseTxt)}</div>
            <div><strong>Fotos:</strong> ${_state.fotos.length}</div>
            <div><strong>Blocos:</strong> ${_state.blocos.length}</div>
            <div><strong>Brinde:</strong> ${_state.brinde.incluir ? escapeHtml(_state.brinde.titulo || 'sim') : 'não incluído'}</div>`;
    }

    // Prévia usa URLs de blob do IndexedDB — nunca fica salva assim (blob:
    // só vale nesta sessão); é só pra mostrar como vai ficar antes de salvar.
    async function _renderPreviewFinal() {
        const el = document.getElementById('lanc-revisar-preview');
        if (!el) return;
        _revogarPreviewUrls();
        el.innerHTML = '<p class="lanc-hint">Carregando prévia…</p>';
        const partes = [];
        for (const b of _state.blocos) {
            // _semImagens aqui também: um bloco de texto editado à mão pode ter
            // recebido um <img> colado direto da página do molde (paste rico
            // num contenteditable não passa por nenhum outro filtro).
            if (b.tipo === 'texto') { partes.push(_semImagens(b.html || '')); continue; }
            const foto = _state.fotos.find(f => f.id === b.fotoId);
            if (!foto) { partes.push('<p class="lanc-hint">[bloco de imagem sem foto escolhida]</p>'); continue; }
            const url = await MediaStore.getObjectUrl(foto.mediaId);
            if (url) { _previewUrls.push(url); partes.push(`<img src="${url}" alt="">`); }
        }
        if (_state.brinde.incluir) {
            // brinde.html normalmente vem de um recorte bruto do HTML do molde
            // (_detectarBrindeNoMolde) — sem isso a prévia dispararia um
            // request de verdade pra imagem do produto errado.
            partes.push(`<div class="lanc-preview-brinde"><h3>${escapeHtml(_state.brinde.titulo || 'Brinde')}</h3>${_semImagens(_state.brinde.html || '')}</div>`);
        }
        el.innerHTML = partes.join('') || '<p class="lanc-hint">Nada pra mostrar ainda — volte e monte a descrição.</p>';
        _icones();
    }

    function _revogarPreviewUrls() {
        _previewUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch {} });
        _previewUrls = [];
    }

    // Guarda o estado do lançamento inteiro no KVStore (IndexedDB) — nunca no
    // localStorage. O produto "de verdade" só nasce quando publicar (Fase 2);
    // até lá isto é só um rascunho recuperável, upsert pelo mesmo id.
    async function _salvarRascunho() {
        if (!_state.titulo.trim()) { showToast('Dá um nome pro produto antes de salvar', 'error'); return; }
        const btn = document.getElementById('lanc-salvar-rascunho');
        if (btn) btn.disabled = true;
        try {
            const agora = new Date().toISOString();
            // Grava uma cópia SANITIZADA no IndexedDB — não mexe em _state.blocos
            // (o editor continua mostrando exatamente o que o usuário digitou),
            // mas o que fica em disco não pode carregar <img>/URL do molde.
            const blocosSalvos = _state.blocos.map(b => b.tipo === 'texto' ? { ...b, html: _semImagens(b.html || '') } : b);
            const brindeSalvo = { ..._state.brinde, html: _semImagens(_state.brinde.html || '') };
            const rascunho = {
                id: _state.rascunhoId || ('lanc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
                titulo: _state.titulo,
                base: _state.base,
                moldeProductId: _state.moldeProductId,
                moldeTitulo: _state.moldeDetalhes?.title || '',
                fotos: _state.fotos,
                blocos: blocosSalvos,
                brinde: brindeSalvo,
                passoAtual: _state.passoAtual,
                criadoEm: _state.rascunhoCriadoEm || agora,
                atualizadoEm: agora,
            };
            _state.rascunhoId = rascunho.id;
            _state.rascunhoCriadoEm = rascunho.criadoEm;

            const lista = (await KVStore.get(RASCUNHOS_KEY)) || [];
            const idx = lista.findIndex(r => r.id === rascunho.id);
            if (idx >= 0) lista[idx] = rascunho; else lista.unshift(rascunho);
            await KVStore.set(RASCUNHOS_KEY, lista);
            _atualizarBadgeRascunhos(lista.length);

            const status = document.getElementById('lanc-revisar-status');
            if (status) status.textContent = `Rascunho salvo às ${new Date().toLocaleTimeString('pt-BR')}.`;
            showToast('Rascunho salvo', 'success');
        } catch (e) {
            showToast('Erro ao salvar rascunho: ' + e.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ── Rascunhos: listar, buscar, retomar, duplicar, excluir (LAUNCH-07) ──
    let _rascunhosCarregados = false;

    function _atualizarBadgeRascunhos(qtd) {
        const badge = document.getElementById('lanc-rascunhos-badge');
        if (!badge) return;
        badge.textContent = String(qtd);
        badge.classList.toggle('hidden', qtd === 0);
    }

    async function _renderRascunhos() {
        const lista = document.getElementById('lanc-rascunhos-lista');
        if (!lista) return;
        if (!_rascunhosCarregados) {
            document.getElementById('lanc-rascunhos-busca')?.addEventListener('input', () => _renderRascunhos());
            document.getElementById('lanc-rascunhos-filtro')?.addEventListener('change', () => _renderRascunhos());
            _rascunhosCarregados = true;
        }

        const todos = ((await KVStore.get(RASCUNHOS_KEY)) || []).slice()
            .sort((a, b) => (b.atualizadoEm || '').localeCompare(a.atualizadoEm || ''));
        _atualizarBadgeRascunhos(todos.length);

        const busca = (document.getElementById('lanc-rascunhos-busca')?.value || '').toLowerCase().trim();
        const filtroBase = document.getElementById('lanc-rascunhos-filtro')?.value || '';
        const filtrados = todos.filter(r =>
            (!busca || (r.titulo || '').toLowerCase().includes(busca))
            && (!filtroBase || r.base === filtroBase));

        if (!filtrados.length) {
            lista.innerHTML = `<div class="adhub-empty" style="padding:2.5rem 0">
                <i data-lucide="file-clock" style="width:36px;height:36px;color:var(--text-muted)"></i>
                <h3>${todos.length ? 'Nenhum resultado' : 'Nenhum rascunho salvo ainda'}</h3>
                <p>${todos.length ? 'Tente outro termo ou filtro.' : 'Rascunhos salvos no Passo 5 (Revisar) aparecem aqui.'}</p>
            </div>`;
            _icones();
            return;
        }

        const PASSOS = ['', 'Base', 'Fotos', 'Descrição', 'Brinde', 'Revisar'];
        lista.innerHTML = filtrados.map(r => `
            <div class="lanc-rascunho-card" data-id="${r.id}">
                <div class="lanc-rascunho-info">
                    <strong>${escapeHtml(r.titulo || '(sem nome)')}</strong>
                    <div class="lanc-rascunho-meta">
                        ${r.base === 'molde' ? `<span class="lanc-tag"><i data-lucide="copy" style="width:10px;height:10px"></i> ${escapeHtml(r.moldeTitulo || 'molde')}</span>` : '<span class="lanc-tag">Do zero</span>'}
                        <span class="lanc-tag">${r.fotos?.length || 0} foto(s)</span>
                        <span class="lanc-tag">Passo ${r.passoAtual || 1}/5 · ${PASSOS[r.passoAtual] || 'Base'}</span>
                        <span class="lanc-rascunho-data">${_tempoRelativo(r.atualizadoEm)}</span>
                    </div>
                </div>
                <div class="lanc-rascunho-acoes">
                    <button type="button" class="btn btn-sm btn-primary" data-continuar="${r.id}"><i data-lucide="play" style="width:12px;height:12px"></i> Continuar</button>
                    <button type="button" class="btn btn-sm btn-secondary" data-duplicar="${r.id}" title="Duplicar"><i data-lucide="copy" style="width:12px;height:12px"></i></button>
                    <button type="button" class="btn btn-sm btn-secondary" data-excluir-rascunho="${r.id}" title="Excluir"><i data-lucide="trash-2" style="width:12px;height:12px"></i></button>
                </div>
            </div>`).join('');

        lista.querySelectorAll('[data-continuar]').forEach(btn => {
            btn.addEventListener('click', () => _continuarRascunho(btn.dataset.continuar));
        });
        lista.querySelectorAll('[data-duplicar]').forEach(btn => {
            btn.addEventListener('click', () => _duplicarRascunho(btn.dataset.duplicar));
        });
        lista.querySelectorAll('[data-excluir-rascunho]').forEach(btn => {
            btn.addEventListener('click', () => _excluirRascunho(btn.dataset.excluirRascunho));
        });
        _icones();
    }

    function _tempoRelativo(iso) {
        if (!iso) return '';
        const diff = (Date.now() - new Date(iso).getTime()) / 1000;
        if (diff < 60) return 'agora';
        if (diff < 3600) return Math.floor(diff / 60) + 'm atrás';
        if (diff < 86400) return Math.floor(diff / 3600) + 'h atrás';
        return Math.floor(diff / 86400) + 'd atrás';
    }

    // Retoma um rascunho exatamente no passo em que foi salvo — hidrata cada
    // painel na mão porque _irParaPasso() só troca a visibilidade; quem
    // desenha o conteúdo de cada passo a partir do _state é cada função
    // _render*/_preparar* específica (nem todas rodam sozinhas ao navegar).
    async function _continuarRascunho(id) {
        const lista = (await KVStore.get(RASCUNHOS_KEY)) || [];
        const r = lista.find(x => x.id === id);
        if (!r) { showToast('Rascunho não encontrado', 'error'); return; }

        _state.titulo = r.titulo || '';
        _state.base = r.base || 'zero';
        _state.moldeProductId = r.moldeProductId || '';
        _state.moldeDetalhes = null;
        _state.fotos = r.fotos || [];
        _state.blocos = r.blocos || [];
        _state.brinde = r.brinde || { incluir: false, titulo: '', html: '' };
        _state._brindeSugerido = true; // já resolvido — não deixa o auto-sugerir do molde sobrescrever
        _state.rascunhoId = r.id;
        _state.rascunhoCriadoEm = r.criadoEm || '';

        _alternarModo('lancamento');

        // Passo 1
        const tituloEl = document.getElementById('lanc-titulo');
        if (tituloEl) tituloEl.value = _state.titulo;
        _selecionarBase(_state.base);
        if (_state.base === 'molde' && _state.moldeProductId) {
            // _carregarProdutosDaLoja já lê _state.moldeProductId (setado acima)
            // como selectedId do picker — nasce com o molde certo pré-selecionado.
            await _carregarProdutosDaLoja();
            _selecionarMolde(_state.moldeProductId); // não bloqueia — só refaz moldeDetalhes/status em segundo plano
        }

        // Passo 2
        _renderFotosGrid();

        // Passo 3
        _renderBlocos();
        _renderTrilho();

        // Passo 4
        const chk = document.getElementById('lanc-brinde-incluir');
        if (chk) chk.checked = _state.brinde.incluir;
        document.getElementById('lanc-brinde-editor')?.classList.toggle('hidden', !_state.brinde.incluir);
        const brTitulo = document.getElementById('lanc-brinde-titulo');
        if (brTitulo) brTitulo.value = _state.brinde.titulo || '';
        const brTexto = document.getElementById('lanc-brinde-texto');
        if (brTexto) brTexto.innerHTML = _state.brinde.html || '';

        _irParaPasso(r.passoAtual || 1);
        showToast(`Retomando "${r.titulo}" — passo ${r.passoAtual || 1} de 5`, 'success');
    }

    async function _duplicarRascunho(id) {
        const lista = (await KVStore.get(RASCUNHOS_KEY)) || [];
        const original = lista.find(x => x.id === id);
        if (!original) return;
        const agora = new Date().toISOString();
        const copia = { ...original, id: 'lanc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            titulo: original.titulo + ' (cópia)', criadoEm: agora, atualizadoEm: agora };
        lista.unshift(copia);
        await KVStore.set(RASCUNHOS_KEY, lista);
        showToast('Rascunho duplicado', 'success');
        _renderRascunhos();
    }

    async function _excluirRascunho(id) {
        if (!confirm('Excluir este rascunho? As fotos enviadas continuam guardadas, só o rascunho some.')) return;
        const lista = ((await KVStore.get(RASCUNHOS_KEY)) || []).filter(r => r.id !== id);
        await KVStore.set(RASCUNHOS_KEY, lista);
        _renderRascunhos();
    }

    // Publica de verdade: sobe cada foto ÚNICA usada (em bloco e/ou galeria)
    // uma vez só, monta a descrição final com URLs reais da Shopify (nunca
    // blob:/base64) e cria o produto via ImporterModule.publishProduct —
    // mesmo fluxo productCreate + staged upload que o Importador já usa.
    // Sai ACTIVE mas sem publicar em canal nenhum (decisão já confirmada
    // pelo usuário) — fica pronto pra revisão manual na Shopify.
    async function _publicarNaShopify() {
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
            showToast('Conecte a Shopify primeiro (loja → Configurações → Integrações)', 'error');
            return;
        }
        if (typeof ImporterModule === 'undefined') {
            showToast('Módulo de publicação indisponível — recarregue a página', 'error');
            return;
        }
        if (!_state.titulo.trim()) { showToast('Dá um nome pro produto antes de publicar', 'error'); return; }
        if (!_state.blocos.length) { showToast('Monte a descrição primeiro', 'error'); return; }

        const shop = ShopifyModule.getConfig();
        const btn = document.getElementById('lanc-publicar-shopify');
        const status = document.getElementById('lanc-revisar-status');
        const setStatus = (msg, tipo) => {
            if (!status) return;
            status.textContent = msg;
            status.style.color = tipo === 'error' ? 'var(--danger, #ef4444)' : '';
        };
        if (btn) btn.disabled = true;

        try {
            // 1) Sobe cada foto ÚNICA (usada em bloco de descrição e/ou na
            // galeria) uma única vez — reaproveita a mesma URL nos dois lugares.
            const idsUsados = new Set(_state.fotos.map(f => f.id));
            _state.blocos.forEach(b => { if (b.tipo === 'imagem' && b.fotoId) idsUsados.add(b.fotoId); });
            const handle = _handleSimples(_state.titulo);
            const urlPorFotoId = {};
            let feitas = 0;
            for (const fotoId of idsUsados) {
                const foto = _state.fotos.find(f => f.id === fotoId);
                if (!foto) continue;
                const rec = await MediaStore.get(foto.mediaId);
                if (!rec?.blob) continue;
                feitas++;
                setStatus(`Subindo fotos pra Shopify — ${feitas}/${idsUsados.size}…`);
                urlPorFotoId[fotoId] = await ImporterModule.shopifyStagedUploadImage(shop, rec.blob, `${handle}-${feitas}.webp`);
            }

            // 2) Monta a descrição final com <img> apontando pra URL real.
            setStatus('Montando a descrição…');
            // _semImagens de novo aqui, na fronteira da publicação: é o último
            // ponto antes de virar produto na loja, e uma <img> do molde que
            // escapasse até aqui seria publicada como se fosse do produto novo.
            const partes = _state.blocos.map(b => {
                if (b.tipo === 'texto') return _semImagens(b.html || '');
                const url = urlPorFotoId[b.fotoId];
                return url ? `<img src="${url}" alt="">` : '';
            });
            if (_state.brinde.incluir) {
                partes.push(`<div><h3>${escapeHtml(_state.brinde.titulo || 'Brinde')}</h3>${_semImagens(_state.brinde.html || '')}</div>`);
            }

            // 3) Cria o produto (status default de publishProduct já é ACTIVE
            // — não passamos publishablePublish em canal nenhum de propósito).
            setStatus('Criando o produto na Shopify…');
            const payload = {
                title: _state.titulo,
                body: partes.join(''),
                vendor: _state.moldeDetalhes?.vendor || '',
                type: _state.moldeDetalhes?.productType || '',
                tags: '',
                options: [],
                variants: [{ optionValues: [], price: 0, compareAt: 0, sku: '', cost: 0, barcode: '' }],
                images: _state.fotos.map(f => ({ src: urlPorFotoId[f.id], alt: '' })).filter(im => im.src),
                handle,
            };
            const criado = await ImporterModule.publishProduct(shop, payload);

            _state.shopifyProductId = criado.id;
            _state.shopifyHandle = criado.handle;
            showToast('Produto criado na Shopify', 'success');
            // _salvarRascunho() mexe no mesmo texto de status — chama ANTES
            // e sobrescreve por último, senão a confirmação da publicação
            // (a mais importante) some debaixo do "rascunho salvo".
            await _salvarRascunho();
            setStatus(`Publicado — handle "${criado.handle}". Preço e estoque ainda precisam ser ajustados na Shopify; o produto está ACTIVE mas não publicado em nenhum canal de venda.`);
        } catch (e) {
            setStatus('Erro: ' + e.message, 'error');
            showToast('Falha ao publicar: ' + String(e.message).slice(0, 160), 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    }

    // ── Recepção da extensão (galeria de fornecedor: Yupoo etc.) ────────
    function _bindMensagensExtensao() {
        window.addEventListener('message', async (e) => {
            if (e.origin !== location.origin) return;
            const d = e.data;
            if (!d || d.source !== 'etracker-extension' || d.type !== 'gallery-import-data') return;
            const galerias = d.galleries || [];
            if (!galerias.length) return;
            _alternarModo('lancamento');
            _irParaPasso(2);
            for (const g of galerias) await _receberGaleria(g);
        });
    }

    // Baixa cada foto da galeria (fetch direto; se o CDN do fornecedor
    // bloquear CORS, cai pro Worker media-proxy, que baixa server-side).
    async function _baixarImagemDeUrl(url) {
        try {
            const r = await fetch(url, { mode: 'cors' });
            if (r.ok) return await r.blob();
        } catch {}
        const r2 = await fetch(`${PROXY_URL}/?action=proxy&url=${encodeURIComponent(url)}`);
        if (!r2.ok) throw new Error(`HTTP ${r2.status}`);
        return await r2.blob();
    }

    async function _receberGaleria(g) {
        const status = document.getElementById('lanc-fotos-status');
        if (!_state.titulo && g.title) {
            _state.titulo = g.title;
            const tituloEl = document.getElementById('lanc-titulo');
            if (tituloEl && !tituloEl.value) tituloEl.value = g.title;
        }
        let ok = 0;
        for (let i = 0; i < g.images.length; i++) {
            if (status) status.textContent = `Baixando fotos de ${g.site} — ${i + 1}/${g.images.length}…`;
            try {
                const blob = await _baixarImagemDeUrl(g.images[i].src);
                await _adicionarFoto(blob, g.site);
                ok++;
            } catch (e) {
                console.warn('[Lançamento] falha ao baixar foto do fornecedor:', g.images[i].src, e);
            }
        }
        if (status) status.textContent = ok
            ? `${ok} foto(s) importada(s) de ${g.site}.`
            : `Não consegui baixar as fotos de ${g.site}.`;
        if (ok && typeof showToast === 'function') showToast(`${ok} foto(s) importada(s) do fornecedor (${g.site})`, 'success');
    }

    function _icones() {
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    }

    return { init, _state };
})();

window.LancamentoModule = LancamentoModule;
document.addEventListener('DOMContentLoaded', () => LancamentoModule.init());
