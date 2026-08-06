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
            ${todas ? '' : _renderAgenteBox()}
            <p class="loja-intro">
                Guarde aqui trechos de código Liquid, CSS ou JS do tema — seções, snippets, ajustes que você já fez — pra reaproveitar sem precisar abrir o editor de tema toda vez.
                ${todas ? ' Mostrando snippets de todas as lojas.' : ''}
            </p>
            <div id="loja-snip-list">${_renderSnippetsList(lista, todas)}</div>
        `;
        _wireCodigoEvents(storeId);
        if (!todas) _wireAgenteEvents();
        _icones();
    }

    // ── Agente de Loja (Fase 1) ──────────────────────────────────────────
    // Pede em texto livre, a IA propõe um plano (produto + campos a mudar),
    // SEMPRE mostra preview antes de tocar na loja de verdade — nunca aplica
    // direto. A IA só decide O QUÊ mudar; quem monta e executa a mutation
    // exata é este código, nunca uma query/mutation gerada pela IA.
    const STATUS_LABELS = { ACTIVE: 'Ativo', DRAFT: 'Rascunho', ARCHIVED: 'Arquivado' };
    const CAMPO_LABELS = { title: 'Título', status: 'Status', price: 'Preço', templateSuffix: 'Template' };

    const SISTEMA_AGENTE = `Você ajuda a operar uma loja Shopify. Recebe um pedido em português e uma lista de produtos existentes (id, título, status, preço). Sua tarefa é identificar QUAL produto da lista o pedido se refere e QUAIS campos mudar.

Responda em JSON:
{
  "entendimento": "frase curta em pt-BR resumindo o que você entendeu",
  "produtoId": "id EXATO de um produto da lista fornecida, ou null se não achar um correspondente claro",
  "confianca": "alta" | "media" | "baixa",
  "mudancas": [ { "campo": "title"|"status"|"price"|"templateSuffix", "valor": "..." } ]
}

Regras:
- "campo" só pode ser title, status, price ou templateSuffix — nunca invente outro campo.
- "status" só pode valer ACTIVE, DRAFT ou ARCHIVED (traduza "ativo"→ACTIVE, "rascunho"/"inativo"→DRAFT, "arquivado"→ARCHIVED).
- "price" é só o número, sem símbolo de moeda (ex.: "45.00").
- "templateSuffix" é o nome do template SEM o prefixo "product." nem extensão (ex.: pedido "usar o template x7-testecoments" → valor "x7-testecoments"). Se o pedido for pra REMOVER um template customizado (voltar ao padrão), valor null.
- Se o pedido não deixar claro qual produto da lista, ou não corresponder a nenhum, produtoId null e confianca "baixa" — não chute.
- Se o pedido pedir uma ação fora do escopo (editar código/Liquid, mexer em coleção, etc.), devolva mudancas vazio e explique em "entendimento" que isso ainda não é suportado.`;

    // ── Provedor de IA do Agente — chave e modelo PRÓPRIOS, independentes
    // da chave OpenAI compartilhada por Estúdio/Lançamento/Produtos. Cada
    // provedor guarda sua própria chave (localStorage, mesmo padrão já usado
    // no resto do app) e o modelo escolhido — nunca herda de outro lugar.
    const PROVEDORES_IA = [
        { id: 'openai', label: 'OpenAI', modeloPadrao: 'gpt-4o', placeholderChave: 'sk-...' },
        { id: 'anthropic', label: 'Claude (Anthropic)', modeloPadrao: 'claude-sonnet-5', placeholderChave: 'sk-ant-...' },
        { id: 'xai', label: 'Grok (xAI)', modeloPadrao: 'grok-2-latest', placeholderChave: 'xai-...' },
        { id: 'gemini', label: 'Gemini (Google)', modeloPadrao: 'gemini-2.5-flash', placeholderChave: 'AIza...' },
    ];
    const PROVEDOR_KEY = 'loja_agente_provedor';
    const MODELO_KEY_PREFIX = 'loja_agente_modelo_';
    const CHAVE_KEY_PREFIX = 'loja_agente_chave_';

    function _provedorInfo(id) { return PROVEDORES_IA.find(p => p.id === id) || PROVEDORES_IA[0]; }

    function _configIA() {
        const provedor = localStorage.getItem(PROVEDOR_KEY) || 'openai';
        const info = _provedorInfo(provedor);
        const modelo = localStorage.getItem(MODELO_KEY_PREFIX + provedor) || info.modeloPadrao;
        const chave = localStorage.getItem(CHAVE_KEY_PREFIX + provedor) || '';
        return { provedor, modelo, chave };
    }

    function _salvarProvedorIA(provedor) { localStorage.setItem(PROVEDOR_KEY, provedor); }
    function _salvarModeloIA(provedor, modelo) { localStorage.setItem(MODELO_KEY_PREFIX + provedor, modelo); }
    function _salvarChaveIA(provedor, chave) { localStorage.setItem(CHAVE_KEY_PREFIX + provedor, chave); }

    async function _chamarOpenAI(modelo, chave, system, userContent) {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + chave },
            body: JSON.stringify({
                model: modelo, max_tokens: 1200, temperature: 0.3,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
            }),
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `OpenAI HTTP ${res.status}`); }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }

    async function _chamarAnthropic(modelo, chave, system, userContent) {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json', 'x-api-key': chave,
                'anthropic-version': '2023-06-01',
                // Sem isso a Anthropic recusa CORS de chamada direta do navegador.
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({ model: modelo, max_tokens: 1200, system, messages: [{ role: 'user', content: userContent }] }),
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `Anthropic HTTP ${res.status}`); }
        const data = await res.json();
        return data.content?.[0]?.text || '';
    }

    async function _chamarXAI(modelo, chave, system, userContent) {
        // API da xAI é compatível com o formato da OpenAI (mesmo endpoint shape).
        const res = await fetch('https://api.x.ai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + chave },
            body: JSON.stringify({
                model: modelo, max_tokens: 1200, temperature: 0.3,
                messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
            }),
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `xAI HTTP ${res.status}`); }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }

    async function _chamarGemini(modelo, chave, system, userContent) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(chave)}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: userContent }] }],
                systemInstruction: { parts: [{ text: system }] },
                generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1200, temperature: 0.3 },
            }),
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `Gemini HTTP ${res.status}`); }
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    async function _pedirPlanoIA(system, userContent) {
        const { provedor, modelo, chave } = _configIA();
        if (!chave) throw new Error(`Configure a chave de API do provedor (${_provedorInfo(provedor).label}) no ícone de engrenagem, ao lado de "Pedir à IA".`);
        if (provedor === 'openai') return _chamarOpenAI(modelo, chave, system, userContent);
        if (provedor === 'anthropic') return _chamarAnthropic(modelo, chave, system, userContent);
        if (provedor === 'xai') return _chamarXAI(modelo, chave, system, userContent);
        if (provedor === 'gemini') return _chamarGemini(modelo, chave, system, userContent);
        throw new Error('Provedor de IA desconhecido: ' + provedor);
    }

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

    // Estado do plano pendente de confirmação (null enquanto não há nada proposto).
    let _agentePlano = null;

    function _renderAgenteBox() {
        const { provedor, modelo, chave } = _configIA();
        return `
            <div class="loja-card loja-agente">
                <div class="loja-agente-head">
                    <h3 class="loja-card-title"><i data-lucide="sparkles" style="width:14px;height:14px;vertical-align:-2px"></i> Pedir à IA</h3>
                    <button type="button" class="loja-copy-btn" id="loja-agente-config-btn" title="Configurar provedor de IA">
                        <i data-lucide="settings" style="width:14px;height:14px"></i>
                    </button>
                </div>
                <div class="loja-agente-config" id="loja-agente-config">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Provedor</label>
                            <select class="input" id="loja-agente-provedor">
                                ${PROVEDORES_IA.map(p => `<option value="${p.id}" ${p.id === provedor ? 'selected' : ''}>${p.label}</option>`).join('')}
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Modelo</label>
                            <input type="text" class="input" id="loja-agente-modelo" value="${escapeHtml(modelo)}" placeholder="${escapeHtml(_provedorInfo(provedor).modeloPadrao)}">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Chave da API (${escapeHtml(_provedorInfo(provedor).label)})</label>
                        <input type="password" class="input" id="loja-agente-chave" value="${escapeHtml(chave)}" placeholder="${escapeHtml(_provedorInfo(provedor).placeholderChave)}" autocomplete="off">
                    </div>
                    <p class="loja-card-hint">Chave só deste Agente — independente da chave OpenAI usada em Estúdio/Lançamento/Produtos.</p>
                </div>
                <p class="loja-card-hint">Descreva o que quer mudar num produto — preço, status, template. A IA propõe, você confirma antes de qualquer coisa ir pra loja de verdade.</p>
                <div class="loja-agente-input-row">
                    <textarea id="loja-agente-pedido" class="input" rows="2" placeholder="Ex.: atualizar o preço do Óculos Ferrari pra 45 e ativar o produto"></textarea>
                    <button type="button" class="btn btn-primary" id="loja-agente-enviar">Pedir</button>
                </div>
                <div id="loja-agente-resultado"></div>
            </div>
        `;
    }

    function _wireAgenteEvents() {
        document.getElementById('loja-agente-enviar')?.addEventListener('click', _processarPedidoAgente);

        document.getElementById('loja-agente-config-btn')?.addEventListener('click', () => {
            document.getElementById('loja-agente-config')?.classList.toggle('is-aberta');
        });

        const provSel = document.getElementById('loja-agente-provedor');
        const modeloInput = document.getElementById('loja-agente-modelo');
        const chaveInput = document.getElementById('loja-agente-chave');

        provSel?.addEventListener('change', () => {
            _salvarProvedorIA(provSel.value);
            // Troca de provedor: recarrega o card de config com o modelo/chave
            // JÁ salvos daquele provedor (cada um é independente).
            const cfg = _configIA();
            if (modeloInput) modeloInput.value = cfg.modelo;
            if (chaveInput) { chaveInput.value = cfg.chave; chaveInput.placeholder = _provedorInfo(cfg.provedor).placeholderChave; }
            const label = document.querySelector('#loja-agente-chave')?.closest('.form-group')?.querySelector('label');
            if (label) label.textContent = `Chave da API (${_provedorInfo(cfg.provedor).label})`;
        });
        modeloInput?.addEventListener('change', () => _salvarModeloIA(provSel.value, modeloInput.value.trim() || _provedorInfo(provSel.value).modeloPadrao));
        chaveInput?.addEventListener('change', () => _salvarChaveIA(provSel.value, chaveInput.value.trim()));
    }

    async function _processarPedidoAgente() {
        const campo = document.getElementById('loja-agente-pedido');
        const pedido = (campo?.value || '').trim();
        const resultado = document.getElementById('loja-agente-resultado');
        if (!pedido || !resultado) return;
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
            resultado.innerHTML = `<div class="loja-agente-erro">Conecte a Shopify primeiro (menu do perfil → Shopify).</div>`;
            return;
        }
        _agentePlano = null;
        resultado.innerHTML = `<div class="loja-agente-status"><i data-lucide="loader-2" class="loja-spin"></i> Buscando produtos da loja…</div>`;
        _icones();
        try {
            const produtos = await ShopifyModule.fetchShopifyProducts();
            const listaParaIA = produtos.slice(0, 150).map(p => ({
                id: p.id, titulo: p.title, status: p.status, precoMin: p.priceMin,
            }));
            resultado.innerHTML = `<div class="loja-agente-status"><i data-lucide="loader-2" class="loja-spin"></i> Pensando…</div>`;
            _icones();
            const txt = await _pedirPlanoIA(SISTEMA_AGENTE, `Pedido: """${pedido}"""\n\nProdutos existentes (JSON): ${JSON.stringify(listaParaIA)}`);
            const plano = _extrairJson(txt);
            await _montarPreviewPlano(plano, produtos, pedido);
        } catch (e) {
            resultado.innerHTML = `<div class="loja-agente-erro">Erro: ${escapeHtml(e.message)}</div>`;
        }
    }

    async function _montarPreviewPlano(plano, produtos, pedidoOriginal) {
        const resultado = document.getElementById('loja-agente-resultado');
        if (!resultado) return;
        const produto = produtos.find(p => String(p.id) === String(plano.produtoId));
        if (!produto || plano.confianca === 'baixa' || !plano.mudancas?.length) {
            resultado.innerHTML = `<div class="loja-agente-erro">
                ${escapeHtml(plano.entendimento || 'Não consegui identificar um produto claro nesse pedido.')}
                <br><small>Tente citar o nome exato do produto (ex.: "no produto Óculos Ferrari Portofino...").</small>
            </div>`;
            return;
        }

        const precisaTema = plano.mudancas.some(m => m.campo === 'templateSuffix');
        const precisaPreco = plano.mudancas.some(m => m.campo === 'price');
        const multiVariante = precisaPreco && produto.variants.length > 1;

        _agentePlano = { produto, mudancas: plano.mudancas, pedidoOriginal, temaId: null, variantId: produto.variants[0]?.id || null };

        const linhas = plano.mudancas.map(m => {
            if (m.campo === 'title') return `<li>${CAMPO_LABELS.title}: <s>${escapeHtml(produto.title)}</s> → <strong>${escapeHtml(m.valor)}</strong></li>`;
            if (m.campo === 'status') return `<li>${CAMPO_LABELS.status}: <s>${STATUS_LABELS[produto.status] || produto.status}</s> → <strong>${STATUS_LABELS[m.valor] || m.valor}</strong></li>`;
            if (m.campo === 'price') return `<li>${CAMPO_LABELS.price}: <s>${produto.currency} ${produto.priceMin.toFixed(2)}</s> → <strong>${produto.currency} ${Number(m.valor).toFixed(2)}</strong></li>`;
            if (m.campo === 'templateSuffix') return `<li>${CAMPO_LABELS.templateSuffix}: <strong id="loja-agente-template-label">carregando…</strong></li>`;
            return '';
        }).join('');

        resultado.innerHTML = `
            <div class="loja-plano">
                <div class="loja-plano-entendimento">${escapeHtml(plano.entendimento || '')}</div>
                <div class="loja-plano-produto"><i data-lucide="package" style="width:13px;height:13px;vertical-align:-2px"></i> ${escapeHtml(produto.title)}</div>
                <ul class="loja-plano-mudancas">${linhas}</ul>
                ${multiVariante ? `
                    <div class="form-group">
                        <label>Qual variante recebe o preço novo?</label>
                        <select class="input" id="loja-agente-variante">
                            ${produto.variants.map(v => `<option value="${v.id}">${escapeHtml(v.title || v.sku || v.id)} — ${produto.currency} ${v.price.toFixed(2)}</option>`).join('')}
                        </select>
                    </div>` : ''}
                ${precisaTema ? `
                    <div class="form-row">
                        <div class="form-group">
                            <label>Tema</label>
                            <select class="input" id="loja-agente-tema"><option>Carregando temas…</option></select>
                        </div>
                        <div class="form-group">
                            <label>Template</label>
                            <select class="input" id="loja-agente-template"><option>—</option></select>
                        </div>
                    </div>` : ''}
                <div class="loja-plano-acoes">
                    <button type="button" class="btn btn-secondary" id="loja-agente-cancelar">Cancelar</button>
                    <button type="button" class="btn btn-primary" id="loja-agente-aplicar">Aplicar mudanças</button>
                </div>
                <div id="loja-agente-status-final"></div>
            </div>
        `;
        _icones();

        document.getElementById('loja-agente-cancelar')?.addEventListener('click', () => {
            _agentePlano = null;
            resultado.innerHTML = '';
        });
        document.getElementById('loja-agente-variante')?.addEventListener('change', (e) => {
            if (_agentePlano) _agentePlano.variantId = e.target.value;
        });
        document.getElementById('loja-agente-aplicar')?.addEventListener('click', _aplicarPlanoAgente);

        if (precisaTema) await _carregarSeletorDeTema(plano.mudancas.find(m => m.campo === 'templateSuffix').valor);
    }

    async function _carregarSeletorDeTema(suffixSugerido) {
        const temaSel = document.getElementById('loja-agente-tema');
        const tplSel = document.getElementById('loja-agente-template');
        const label = document.getElementById('loja-agente-template-label');
        if (!temaSel || !tplSel) return;
        try {
            const temas = await ShopifyModule.fetchThemes();
            if (!temas.length) throw new Error('nenhum tema encontrado');
            temaSel.innerHTML = temas.map(t => `<option value="${t.id}">${escapeHtml(t.name)}${t.role === 'MAIN' ? ' (publicado)' : ''}</option>`).join('');
            const principal = temas.find(t => t.role === 'MAIN') || temas[0];
            temaSel.value = principal.id;
            if (_agentePlano) _agentePlano.temaId = principal.id;
            await _carregarTemplatesDoTema(principal.id, suffixSugerido);
            temaSel.addEventListener('change', () => {
                if (_agentePlano) _agentePlano.temaId = temaSel.value;
                _carregarTemplatesDoTema(temaSel.value, suffixSugerido);
            });
        } catch (e) {
            temaSel.innerHTML = `<option value="">Erro ao carregar temas</option>`;
            tplSel.innerHTML = `<option value="">—</option>`;
            if (label) label.textContent = suffixSugerido || 'padrão';
            const resultado = document.getElementById('loja-agente-resultado');
            const aviso = document.createElement('div');
            aviso.className = 'loja-agente-aviso';
            aviso.textContent = `Não consegui listar os temas (${e.message}). Se a loja ainda não foi reautorizada com o escopo de leitura de temas, reconecte a Shopify no menu do perfil. Vou usar o template "${suffixSugerido || 'padrão'}" digitado como veio no pedido.`;
            resultado?.appendChild(aviso);
        }
    }

    async function _carregarTemplatesDoTema(temaId, suffixSugerido) {
        const tplSel = document.getElementById('loja-agente-template');
        const label = document.getElementById('loja-agente-template-label');
        if (!tplSel) return;
        tplSel.innerHTML = `<option>Carregando…</option>`;
        try {
            const templates = await ShopifyModule.fetchProductTemplates(temaId);
            const opcoes = [{ suffix: null, filename: 'templates/product.json (padrão)' }, ...templates];
            tplSel.innerHTML = opcoes.map(t => `<option value="${t.suffix || ''}">${escapeHtml(t.suffix || 'Padrão')}</option>`).join('');
            const bate = opcoes.find(t => (t.suffix || '') === (suffixSugerido || ''));
            tplSel.value = bate ? (bate.suffix || '') : (opcoes[0].suffix || '');
            if (_agentePlano) _agentePlano.mudancas = _agentePlano.mudancas.map(m => m.campo === 'templateSuffix' ? { ...m, valor: tplSel.value || null } : m);
            if (label) label.textContent = tplSel.value || 'Padrão';
            tplSel.addEventListener('change', () => {
                if (_agentePlano) _agentePlano.mudancas = _agentePlano.mudancas.map(m => m.campo === 'templateSuffix' ? { ...m, valor: tplSel.value || null } : m);
                if (label) label.textContent = tplSel.value || 'Padrão';
            });
        } catch (e) {
            tplSel.innerHTML = `<option value="${escapeHtml(suffixSugerido || '')}">${escapeHtml(suffixSugerido || 'padrão')} (não confirmado)</option>`;
            if (label) label.textContent = suffixSugerido || 'padrão';
        }
    }

    async function _aplicarPlanoAgente() {
        if (!_agentePlano) return;
        const { produto, mudancas, variantId } = _agentePlano;
        const status = document.getElementById('loja-agente-status-final');
        const btn = document.getElementById('loja-agente-aplicar');
        if (btn) btn.disabled = true;
        if (status) status.innerHTML = `<div class="loja-agente-status"><i data-lucide="loader-2" class="loja-spin"></i> Aplicando…</div>`;
        _icones();
        try {
            const camposProduto = {};
            mudancas.forEach(m => { if (m.campo === 'title' || m.campo === 'status' || m.campo === 'templateSuffix') camposProduto[m.campo] = m.valor; });
            if (Object.keys(camposProduto).length) {
                await ShopifyModule.updateProductFields(produto.gid, camposProduto);
            }
            const precoMudanca = mudancas.find(m => m.campo === 'price');
            if (precoMudanca) {
                const variantGid = `gid://shopify/ProductVariant/${variantId}`;
                await ShopifyModule.updateVariantPrice(produto.gid, variantGid, precoMudanca.valor);
            }
            if (status) status.innerHTML = `<div class="loja-agente-sucesso"><i data-lucide="check" style="width:13px;height:13px;vertical-align:-2px"></i> Aplicado em "${escapeHtml(produto.title)}".</div>`;
            showToast('Mudanças aplicadas na Shopify', 'success');
            const campoPedido = document.getElementById('loja-agente-pedido');
            if (campoPedido) campoPedido.value = '';
            _agentePlano = null;
            _icones();
        } catch (e) {
            if (status) status.innerHTML = `<div class="loja-agente-erro">Falhou: ${escapeHtml(e.message)}</div>`;
            if (btn) btn.disabled = false;
        }
    }

    function _tagLabel(tagId) { return TAGS_SNIPPET.find(t => t.id === tagId)?.label || tagId; }

    function _slug(texto) {
        // ̀-ͯ = acentos combinantes depois do NFD — escrito em
        // escape hex de propósito (o caractere literal é invisível e some
        // silenciosamente em qualquer cópia/colagem).
        return String(texto || '')
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    }

    // Extensão do bloco de código no markdown — puramente cosmética (o
    // Liquid não tem highlighter próprio na maioria dos renderizadores, mas
    // "liquid" já é reconhecido por GitHub/VS Code).
    const LINGUAGEM_MD = { secao: 'liquid', snippet: 'liquid', css: 'css', js: 'javascript', outro: '' };

    function _baixarSnippetMarkdown(s) {
        const linguagem = LINGUAGEM_MD[s.tag] ?? '';
        const md = [
            `# ${s.nome || 'Sem nome'}`,
            '',
            `**Tipo:** ${_tagLabel(s.tag)}`,
            s.descricao ? `\n${s.descricao}` : '',
            '',
            '```' + linguagem,
            s.codigo || '',
            '```',
            '',
        ].join('\n');
        const blob = new Blob([md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${_slug(s.nome) || 'snippet'}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }

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
                    <button type="button" class="loja-copy-btn" data-snip-copiar="${s.id}" title="Copiar código">
                        <i data-lucide="copy" style="width:13px;height:13px"></i>
                    </button>
                    <button type="button" class="loja-copy-btn" data-snip-baixar="${s.id}" title="Baixar como Markdown">
                        <i data-lucide="download" style="width:13px;height:13px"></i>
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
                            <label>Caminho no tema <span style="font-weight:400;color:var(--text-muted)">(onde esse código vira arquivo — ex.: sections/nome-da-secao.liquid)</span></label>
                            <input type="text" class="input" data-snip-field="caminhoTema" value="${escapeHtml(s.caminhoTema || '')}" placeholder="sections/minha-secao.liquid ou snippets/meu-snippet.liquid">
                        </div>
                    </div>
                    <div class="form-row">
                        <div class="form-group" style="flex:1 1 100%">
                            <label>Código</label>
                            <textarea class="input loja-code-area" data-snip-field="codigo" placeholder="{% comment %} ... {% endcomment %}" spellcheck="false">${escapeHtml(s.codigo)}</textarea>
                        </div>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" data-snip-instalar="${s.id}">
                        <i data-lucide="upload" style="width:13px;height:13px;vertical-align:-2px"></i> Instalar no tema
                    </button>
                    <div class="loja-instalar-painel" id="loja-instalar-${s.id}" style="display:none">
                        <div class="form-group">
                            <label>Tema</label>
                            <select class="input" data-instalar-tema="${s.id}"><option>Carregando temas…</option></select>
                        </div>
                        <div class="loja-instalar-status" data-instalar-status="${s.id}"></div>
                        <ol class="loja-instalar-passos">
                            <li>Clique em <strong>Copiar código</strong>.</li>
                            <li>Clique em <strong>Abrir editor de código</strong> — abre o tema escolhido na Shopify, numa aba nova.</li>
                            <li>Na pasta indicada, crie (ou abra) o arquivo <code>${escapeHtml(s.caminhoTema || '(defina o caminho acima)')}</code>.</li>
                            <li>Cole (Cmd/Ctrl+V) e salve.</li>
                        </ol>
                        <div class="loja-instalar-acoes">
                            <button type="button" class="btn btn-secondary btn-sm" data-instalar-copiar="${s.id}">Copiar código</button>
                            <button type="button" class="btn btn-primary btn-sm" data-instalar-abrir="${s.id}">Abrir editor de código</button>
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
                id: generateId('snip'), storeId, nome: '', descricao: '', tag: 'snippet', codigo: '', caminhoTema: '',
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
            const copiar = ev.target.closest('[data-snip-copiar]');
            if (copiar) {
                const s = _snippets.find(x => x.id === copiar.dataset.snipCopiar);
                if (!s) return;
                try {
                    await navigator.clipboard.writeText(s.codigo || '');
                    showToast('Código copiado', 'success');
                } catch (e) {
                    showToast('Não consegui copiar: ' + e.message, 'error');
                }
                return;
            }
            const baixar = ev.target.closest('[data-snip-baixar]');
            if (baixar) {
                const s = _snippets.find(x => x.id === baixar.dataset.snipBaixar);
                if (s) _baixarSnippetMarkdown(s);
                return;
            }
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
                return;
            }
            const instalar = ev.target.closest('[data-snip-instalar]');
            if (instalar) { _abrirPainelInstalar(instalar.dataset.snipInstalar); return; }
        });
    }

    // ── Instalar no tema (fluxo GUIADO — nunca escreve na Shopify sozinho) ──
    // A Admin API tem uma mutation pra criar arquivo de tema (themeFilesUpsert),
    // mas ela exige uma "Protected Scope Exemption" da própria Shopify além do
    // escopo write_themes — aprovação manual, pode levar semanas, e há relatos
    // de ACCESS_DENIED mesmo depois de aprovada. Em vez de prometer algo que
    // pode nunca funcionar de verdade, o fluxo aqui é 100% funcional hoje:
    // copia o código certo, mostra o caminho certo, e leva direto pro editor
    // de código do tema escolhido — só falta colar e salvar.
    async function _abrirPainelInstalar(id) {
        const s = _snippets.find(x => x.id === id);
        if (!s) return;
        if (!s.caminhoTema?.trim()) {
            showToast('Preencha o "Caminho no tema" primeiro', 'error');
            document.querySelector(`[data-snip="${id}"] [data-snip-field="caminhoTema"]`)?.focus();
            return;
        }
        if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) {
            showToast('Conecte a Shopify primeiro (menu do perfil → Shopify)', 'error');
            return;
        }
        const painel = document.getElementById(`loja-instalar-${id}`);
        if (!painel) return;
        const estavaAberto = painel.style.display !== 'none';
        painel.style.display = estavaAberto ? 'none' : '';
        if (estavaAberto) return;

        const temaSel = painel.querySelector('[data-instalar-tema]');
        const status = painel.querySelector('[data-instalar-status]');
        temaSel.innerHTML = '<option>Carregando…</option>';
        try {
            const temas = await ShopifyModule.fetchThemes();
            if (!temas.length) throw new Error('nenhum tema encontrado');
            temaSel.innerHTML = temas.map(t => `<option value="${t.id}">${escapeHtml(t.name)}${t.role === 'MAIN' ? ' (publicado)' : ''}</option>`).join('');
            const principal = temas.find(t => t.role === 'MAIN') || temas[0];
            temaSel.value = principal.id;
            await _checarColisaoArquivo(temaSel.value, s.caminhoTema, status);
            temaSel.addEventListener('change', () => _checarColisaoArquivo(temaSel.value, s.caminhoTema, status));
        } catch (e) {
            temaSel.innerHTML = '<option value="">Erro ao carregar temas</option>';
            status.innerHTML = `<div class="loja-agente-aviso">Não consegui listar os temas (${escapeHtml(e.message)}). Se ainda não reautorizou a Shopify com o escopo de leitura de temas, reconecte no menu do perfil.</div>`;
        }

        painel.querySelector('[data-instalar-copiar]').onclick = async () => {
            try { await navigator.clipboard.writeText(s.codigo || ''); showToast('Código copiado', 'success'); }
            catch (e) { showToast('Não consegui copiar: ' + e.message, 'error'); }
        };
        painel.querySelector('[data-instalar-abrir]').onclick = async () => {
            try { await navigator.clipboard.writeText(s.codigo || ''); showToast('Código copiado — cole no editor que vai abrir', 'success'); } catch {}
            const shop = ShopifyModule.getConfig().shop;
            const temaNumerico = (temaSel.value || '').match(/\/(\d+)$/)?.[1];
            if (!shop || !temaNumerico) { showToast('Escolha um tema primeiro', 'error'); return; }
            window.open(`https://${shop}/admin/themes/${temaNumerico}/editor`, '_blank');
        };
        _icones();
    }

    async function _checarColisaoArquivo(temaId, caminho, statusEl) {
        if (!temaId || !statusEl) return;
        statusEl.innerHTML = `<div class="loja-agente-status"><i data-lucide="loader-2" class="loja-spin"></i> Checando se o arquivo já existe…</div>`;
        _icones();
        try {
            const arquivos = await ShopifyModule.fetchThemeFiles(temaId);
            const existe = arquivos.includes(caminho);
            statusEl.innerHTML = existe
                ? `<div class="loja-agente-aviso">Já existe um arquivo em <code>${escapeHtml(caminho)}</code> nesse tema — colar e salvar vai SUBSTITUIR o conteúdo dele.</div>`
                : `<div class="loja-agente-sucesso">Nenhum arquivo em <code>${escapeHtml(caminho)}</code> ainda nesse tema — vai ser um arquivo novo.</div>`;
        } catch (e) {
            statusEl.innerHTML = `<div class="loja-agente-aviso">Não consegui checar se o arquivo já existe (${escapeHtml(e.message)}) — confira manualmente antes de salvar.</div>`;
        }
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
