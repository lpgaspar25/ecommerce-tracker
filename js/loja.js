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

    function _chaveOpenAI() {
        return (window.AIAdGenerator?._getOpenAIKey?.()) || localStorage.getItem('openai_api_key') || '';
    }

    async function _openaiJson(system, mensagens, maxTokens = 1200) {
        const key = _chaveOpenAI();
        if (!key) throw new Error('Configure a chave OpenAI (AI Generations → API Keys)');
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
                model: 'gpt-4o', max_tokens: maxTokens, temperature: 0.3,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: system }, ...mensagens],
            }),
        });
        if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error?.message || `HTTP ${res.status}`); }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
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
        return `
            <div class="loja-card loja-agente">
                <h3 class="loja-card-title"><i data-lucide="sparkles" style="width:14px;height:14px;vertical-align:-2px"></i> Pedir à IA</h3>
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
            const txt = await _openaiJson(SISTEMA_AGENTE, [{
                role: 'user',
                content: `Pedido: """${pedido}"""\n\nProdutos existentes (JSON): ${JSON.stringify(listaParaIA)}`,
            }]);
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
