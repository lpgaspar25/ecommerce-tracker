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
        document.getElementById('studio-modo-produto')?.classList.toggle('hidden', modo === 'lancamento');
        document.getElementById('studio-modo-lancamento')?.classList.toggle('hidden', modo !== 'lancamento');
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
        document.getElementById('lanc-molde-select')?.addEventListener('change', (e) => _selecionarMolde(e.target.value));
        document.getElementById('lanc-passo1-avancar')?.addEventListener('click', () => {
            if (!_state.titulo.trim()) { showToast('Dá um nome pro produto novo primeiro', 'error'); return; }
            if (_state.base === 'molde' && !_state.moldeProductId) { showToast('Escolha um produto-molde', 'error'); return; }
            _irParaPasso(2);
        });
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
        const select = document.getElementById('lanc-molde-select');
        if (!select || select.dataset.carregado === '1') return;
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
            _setMoldeStatus('Conecte a Shopify (Configurações → Integrações) pra usar um produto da loja como molde.', 'error');
            return;
        }
        _setMoldeStatus('Carregando produtos da loja…');
        try {
            const produtos = await ShopifyModule.fetchShopifyProducts();
            select.innerHTML = '<option value="">-- Escolha um produto da loja --</option>'
                + produtos.map(p => `<option value="${p.id}">${escapeHtml(p.title)}</option>`).join('');
            select.dataset.carregado = '1';
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
        document.getElementById('lanc-passo2-avancar')?.addEventListener('click', () => {
            if (!_state.fotos.length) { showToast('Adicione ao menos uma foto', 'error'); return; }
            _irParaPasso(3);
        });
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
        grid.innerHTML = _state.fotos.map(f => `
            <div class="lanc-foto-item" data-id="${f.id}">
                <img src="${f.thumb}" alt="">
                <span class="lanc-foto-origem">${escapeHtml(f.origem)}</span>
                <button type="button" class="lanc-foto-del" data-remover="${f.id}" title="Remover"><i data-lucide="x" style="width:11px;height:11px"></i></button>
            </div>`).join('');
        grid.querySelectorAll('[data-remover]').forEach(btn => {
            btn.addEventListener('click', () => _removerFoto(btn.dataset.remover));
        });
        _icones();
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
    const SISTEMA_BLOCOS_ZERO = `Você escreve a descrição de um produto de e-commerce no formato de LANDING PAGE: uma sequência de blocos que alternam texto de venda curto e direto (em português do Brasil) com as fotos reais do produto.
Você recebe várias fotos do produto, nesta ordem (índice 0, 1, 2...), e o contexto do produto.
Devolva APENAS um JSON: {"blocos": [{"tipo":"texto","html":"<h3>...</h3><p>...</p>"}, {"tipo":"imagem","indiceFoto":0}, ...]}
Regras: alterne texto e imagem, nunca dois blocos do mesmo tipo seguidos; não repita indiceFoto; html usa só <h3>, <p>, <strong>, <ul>, <li> (nada de <script>/<style>/atributos); escreva olhando o que aparece de fato em cada foto pra escrever o texto vizinho com precisão; comece e termine com bloco de texto; entre 4 e 8 blocos no total.`;

    const SISTEMA_BLOCOS_MOLDE = `Você adapta a descrição de um produto de e-commerce existente para um produto NOVO, mantendo a MESMA estrutura e o MESMO tom — só troca o conteúdo.
Você recebe uma lista de blocos de texto (índice + html original, tirados de outro produto) e o nome do produto novo. Reescreva CADA bloco falando do produto novo, mantendo a mesma estrutura de tags HTML e tamanho aproximado, em português do Brasil.
Devolva APENAS um JSON: {"blocos": [{"indice": 0, "html": "..."}, {"indice": 2, "html": "..."}]}`;

    function _bindPasso3() {
        document.getElementById('lanc-desc-modo-ia')?.addEventListener('click', () => { _marcarDescModo('ia'); _gerarBlocosDoZero(); });
        document.getElementById('lanc-desc-modo-molde')?.addEventListener('click', () => { _marcarDescModo('molde'); _gerarBlocosDoMolde(); });
        document.getElementById('lanc-blocos-add-texto')?.addEventListener('click', () => _adicionarBlocoManual('texto'));
        document.getElementById('lanc-blocos-add-imagem')?.addEventListener('click', () => _adicionarBlocoManual('imagem'));
        document.getElementById('lanc-passo3-avancar')?.addEventListener('click', () => {
            if (!_state.blocos.length) { showToast('Gere ou monte a descrição primeiro', 'error'); return; }
            _irParaPasso(4);
        });
    }

    // "Copiar o molde" só aparece se o usuário veio de um molde no Passo 1.
    function _prepararPasso3() {
        document.getElementById('lanc-desc-modo-molde')?.classList.toggle('hidden', !(_state.base === 'molde' && _state.moldeDetalhes));
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
            const contexto = `Produto: ${_state.titulo || 'produto novo'}.`;
            const txt = await _openaiVisaoMulti(SISTEMA_BLOCOS_ZERO, contexto, imagens);
            const parsed = _extrairJson(txt);
            const gerados = (parsed.blocos || []).map(b => {
                if (b.tipo === 'imagem') {
                    const foto = usadas[b.indiceFoto];
                    return { tipo: 'imagem', fotoId: foto ? foto.id : (usadas[0]?.id || null) };
                }
                return { tipo: 'texto', html: b.html || '' };
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
                const prompt = `Produto-molde: "${_state.moldeDetalhes.title}". Produto novo: "${_state.titulo}".\nBlocos originais:\n[${lista}]`;
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
                return { tipo: 'texto', html: reescritos[i] || b.html };
            });
            _state.blocos = finais;
            _renderBlocos();
            _setDescStatus(`${finais.length} blocos montados a partir do molde — edite à vontade.`);
        } catch (e) {
            _setDescStatus('Erro: ' + e.message, 'error');
        }
    }

    // Divide um HTML de descrição em blocos texto/imagem pelos filhos de
    // primeiro nível — usado só pra copiar a ESTRUTURA do molde (o conteúdo
    // de texto é reescrito depois pela IA; imagem vira posição a preencher).
    function _dividirEmBlocos(html) {
        const tpl = document.createElement('template');
        tpl.innerHTML = String(html || '');
        const blocos = [];
        tpl.content.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent.trim()) blocos.push({ tipo: 'texto', html: `<p>${escapeHtml(node.textContent.trim())}</p>` });
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const imgsDentro = node.querySelectorAll ? node.querySelectorAll('img') : [];
            const soImagem = node.tagName === 'IMG' || (imgsDentro.length === 1 && !node.textContent.trim());
            if (soImagem) { blocos.push({ tipo: 'imagem' }); return; }
            if (node.outerHTML && node.outerHTML.trim()) blocos.push({ tipo: 'texto', html: node.outerHTML });
        });
        return blocos;
    }

    function _adicionarBlocoManual(tipo) {
        if (tipo === 'texto') _state.blocos.push({ tipo: 'texto', html: '<p>Novo texto…</p>' });
        else _state.blocos.push({ tipo: 'imagem', fotoId: _state.fotos[0]?.id || null });
        _renderBlocos();
    }

    function _renderBlocos() {
        const lista = document.getElementById('lanc-blocos-lista');
        if (!lista) return;
        lista.innerHTML = _state.blocos.map((b, i) => {
            if (b.tipo === 'texto') {
                return `<div class="lanc-bloco-item" data-idx="${i}">
                    <div class="lanc-bloco-cabecalho"><span class="lanc-bloco-tipo">Texto</span>${_blocoAcoesHtml(i)}</div>
                    <div class="lanc-rich" contenteditable="true" data-bloco-texto="${i}">${b.html || ''}</div>
                </div>`;
            }
            const foto = _state.fotos.find(f => f.id === b.fotoId);
            return `<div class="lanc-bloco-item" data-idx="${i}">
                <div class="lanc-bloco-cabecalho"><span class="lanc-bloco-tipo">Imagem</span>${_blocoAcoesHtml(i)}</div>
                <div class="lanc-bloco-imagem-corpo">
                    ${foto ? `<img src="${foto.thumb}" alt="">` : '<div class="lanc-foto-carregando" style="width:90px;height:90px">sem foto</div>'}
                    <select data-bloco-foto="${i}">
                        <option value="">-- Escolha uma foto --</option>
                        ${_state.fotos.map(f => `<option value="${f.id}" ${f.id === b.fotoId ? 'selected' : ''}>${escapeHtml(f.origem)} · ${f.id.slice(-5)}</option>`).join('')}
                    </select>
                </div>
            </div>`;
        }).join('');

        lista.querySelectorAll('[data-bloco-texto]').forEach(el => {
            el.addEventListener('blur', () => {
                const i = parseInt(el.dataset.blocoTexto, 10);
                if (_state.blocos[i]) _state.blocos[i].html = el.innerHTML;
            });
        });
        lista.querySelectorAll('[data-bloco-foto]').forEach(el => {
            el.addEventListener('change', () => {
                const i = parseInt(el.dataset.blocoFoto, 10);
                if (_state.blocos[i]) _state.blocos[i].fotoId = el.value || null;
                _renderBlocos();
            });
        });
        lista.querySelectorAll('[data-mover]').forEach(btn => {
            btn.addEventListener('click', () => _moverBloco(parseInt(btn.dataset.idx, 10), btn.dataset.mover === 'cima' ? -1 : 1));
        });
        lista.querySelectorAll('[data-remover-bloco]').forEach(btn => {
            btn.addEventListener('click', () => { _state.blocos.splice(parseInt(btn.dataset.removerBloco, 10), 1); _renderBlocos(); });
        });
        _icones();
    }

    function _blocoAcoesHtml(i) {
        return `<div class="lanc-bloco-acoes">
            <button type="button" data-mover="cima" data-idx="${i}" title="Mover pra cima"><i data-lucide="chevron-up" style="width:13px;height:13px"></i></button>
            <button type="button" data-mover="baixo" data-idx="${i}" title="Mover pra baixo"><i data-lucide="chevron-down" style="width:13px;height:13px"></i></button>
            <button type="button" data-remover-bloco="${i}" title="Remover"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
        </div>`;
    }

    function _moverBloco(i, delta) {
        const j = i + delta;
        if (j < 0 || j >= _state.blocos.length) return;
        const tmp = _state.blocos[i]; _state.blocos[i] = _state.blocos[j]; _state.blocos[j] = tmp;
        _renderBlocos();
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

    // Heurística: acha o primeiro elemento cujo texto cita brinde/bônus/gift
    // e pega ele + tudo depois como o bloco de brinde — é assim que a página
    // de referência do usuário estrutura (brinde é a última seção).
    function _detectarBrindeNoMolde(html) {
        if (!html) return null;
        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        const filhos = [...tpl.content.childNodes].filter(n => n.nodeType === Node.ELEMENT_NODE || (n.nodeType === Node.TEXT_NODE && n.textContent.trim()));
        const regex = /brinde|bônus|bonus|gift/i;
        const idx = filhos.findIndex(n => regex.test(n.textContent || ''));
        if (idx < 0) return null;
        const resto = filhos.slice(idx);
        const tituloEl = resto.find(n => n.nodeType === Node.ELEMENT_NODE && /^H[1-6]$/.test(n.tagName));
        const titulo = tituloEl ? tituloEl.textContent.trim() : (resto[0].textContent || '').trim().slice(0, 60);
        // O corpo NÃO repete o título — ele já tem campo próprio no editor;
        // montar de novo (aqui e no Passo 5) evita <h3> duplicado na prévia.
        const corpo = resto.filter(n => n !== tituloEl);
        const html2 = corpo.map(n => n.nodeType === Node.ELEMENT_NODE ? n.outerHTML : `<p>${escapeHtml(n.textContent)}</p>`).join('');
        return { titulo, html: html2 };
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
            if (b.tipo === 'texto') { partes.push(b.html || ''); continue; }
            const foto = _state.fotos.find(f => f.id === b.fotoId);
            if (!foto) { partes.push('<p class="lanc-hint">[bloco de imagem sem foto escolhida]</p>'); continue; }
            const url = await MediaStore.getObjectUrl(foto.mediaId);
            if (url) { _previewUrls.push(url); partes.push(`<img src="${url}" alt="">`); }
        }
        if (_state.brinde.incluir) {
            partes.push(`<div class="lanc-preview-brinde"><h3>${escapeHtml(_state.brinde.titulo || 'Brinde')}</h3>${_state.brinde.html || ''}</div>`);
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
            const rascunho = {
                id: _state.rascunhoId || ('lanc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
                titulo: _state.titulo,
                base: _state.base,
                moldeProductId: _state.moldeProductId,
                moldeTitulo: _state.moldeDetalhes?.title || '',
                fotos: _state.fotos,
                blocos: _state.blocos,
                brinde: _state.brinde,
                criadoEm: _state.rascunhoCriadoEm || agora,
                atualizadoEm: agora,
            };
            _state.rascunhoId = rascunho.id;
            _state.rascunhoCriadoEm = rascunho.criadoEm;

            const lista = (await KVStore.get(RASCUNHOS_KEY)) || [];
            const idx = lista.findIndex(r => r.id === rascunho.id);
            if (idx >= 0) lista[idx] = rascunho; else lista.unshift(rascunho);
            await KVStore.set(RASCUNHOS_KEY, lista);

            const status = document.getElementById('lanc-revisar-status');
            if (status) status.textContent = `Rascunho salvo às ${new Date().toLocaleTimeString('pt-BR')}.`;
            showToast('Rascunho salvo', 'success');
        } catch (e) {
            showToast('Erro ao salvar rascunho: ' + e.message, 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
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
            const partes = _state.blocos.map(b => {
                if (b.tipo === 'texto') return b.html || '';
                const url = urlPorFotoId[b.fotoId];
                return url ? `<img src="${url}" alt="">` : '';
            });
            if (_state.brinde.incluir) {
                partes.push(`<div><h3>${escapeHtml(_state.brinde.titulo || 'Brinde')}</h3>${_state.brinde.html || ''}</div>`);
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
