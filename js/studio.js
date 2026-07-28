/* ===========================
   Studio.js — Estúdio de Produto
   Foto de produto por IA, página de produto (título/bullets/descrição/FAQ)
   e copy interativo com preview ao vivo.

   O diferencial daqui: os ângulos e hooks usados nos prompts NÃO são
   inventados — saem dos criativos que já rodaram, ranqueados por CPA real.
   =========================== */

const StudioModule = (() => {

    const STORAGE_KEY = 'etracker_studio_v1';

    const _state = {
        productId: '',
        // { fotoBase, fotos: [{id, mediaId, thumb, preset, prompt}], pagina: {...}, chat: [] }
        porProduto: {},
        gerando: false,
        _urls: [],          // object URLs a revogar
    };

    // Cenários prontos. O texto é o prompt real mandado ao gpt-image-1.
    const PRESETS_FOTO = [
        { id: 'estudio',   label: 'Estúdio branco', icone: 'lightbulb',
          prompt: 'Place this exact product on a clean seamless white studio background with soft diffused lighting and a subtle natural shadow beneath it. Keep the product itself completely unchanged — same shape, colour, material, branding and proportions. Professional e-commerce product photography, sharp focus, high resolution.' },
        { id: 'lifestyle', label: 'Lifestyle (casa UK)', icone: 'home',
          prompt: 'Place this exact product in a tasteful modern British home interior setting with warm natural window light. Keep the product itself completely unchanged — same shape, colour, material, branding and proportions. Lifestyle editorial photography, shallow depth of field, realistic reflections and shadows.' },
        { id: 'mao',       label: 'Na mão / em uso', icone: 'hand',
          prompt: 'Show this exact product being held naturally in a person\'s hand, realistic skin tones, neutral background, natural daylight. Keep the product itself completely unchanged — same shape, colour, material, branding and proportions. Photorealistic, sharp focus on the product.' },
        { id: 'modelo',    label: 'Com modelo', icone: 'user',
          prompt: 'Show this exact product being worn or used by an adult model in a natural, candid pose. Keep the product itself completely unchanged — same shape, colour, material, branding and proportions. Editorial lifestyle photography, natural light, the product clearly visible and in focus.' },
        { id: 'detalhe',   label: 'Macro / detalhe', icone: 'zoom-in',
          prompt: 'Extreme close-up macro shot of this exact product showing its material texture and build quality. Keep the product itself completely unchanged. Studio lighting, very sharp focus, shallow depth of field.' },
        { id: 'externo',   label: 'Ambiente externo', icone: 'sun',
          prompt: 'Place this exact product in an outdoor urban setting during golden hour with warm directional sunlight. Keep the product itself completely unchanged — same shape, colour, material, branding and proportions. Photorealistic lifestyle photography.' },
    ];

    // ══════════════════════════════════════════════════════════════
    //  Persistência
    // ══════════════════════════════════════════════════════════════

    function _load() {
        try {
            const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            if (raw && typeof raw === 'object') _state.porProduto = raw.porProduto || {};
        } catch (e) { console.warn('[Studio] load falhou:', e); }
    }

    function _save() {
        const gravar = () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ porProduto: _state.porProduto }));
        try {
            if (window.StorageManager?.withReclaim) StorageManager.withReclaim(gravar);
            else gravar();
        } catch (e) {
            console.warn('[Studio] save falhou:', e);
            if (typeof showToast === 'function') showToast('Não consegui salvar o estúdio: armazenamento cheio.', 'error');
        }
    }

    function _dados(pid) {
        if (!_state.porProduto[pid]) {
            _state.porProduto[pid] = { fotoBase: '', fotos: [], pagina: null, chat: [] };
        }
        return _state.porProduto[pid];
    }

    // ══════════════════════════════════════════════════════════════
    //  MINERADOR DE ÂNGULOS VALIDADOS
    //  Varre os criativos, cruza com as métricas reais e ranqueia os
    //  ângulos/hooks por CPA. É o que separa esta ferramenta de um
    //  gerador de copy genérico: ela sabe o que já vendeu.
    // ══════════════════════════════════════════════════════════════

    function getTopAngles(productId = null, limite = 6) {
        const criativos = (AppState.allCreatives || []).filter(c => !productId || c.productId === productId);
        if (!criativos.length) return [];

        const porAngulo = new Map();
        criativos.forEach(c => {
            const CM = window.CreativesModule || (typeof CreativesModule !== 'undefined' ? CreativesModule : null);
            const stats = CM?.getCreativeStats?.(c.id);
            // Sem métrica não dá pra afirmar que funciona — entra só como candidato.
            const chave = (c.angle || '').trim() || (c.hookType || '').trim();
            if (!chave) return;
            let a = porAngulo.get(chave.toLowerCase());
            if (!a) {
                a = { rotulo: chave, gasto: 0, compras: 0, criativos: 0, vencedores: 0, hooks: new Set() };
                porAngulo.set(chave.toLowerCase(), a);
            }
            a.criativos++;
            if (c.status === 'winner') a.vencedores++;
            if (c.hookText) a.hooks.add(c.hookText);
            if (stats) { a.gasto += stats.totalSpend; a.compras += stats.totalConversions; }
        });

        return [...porAngulo.values()]
            .map(a => ({
                rotulo: a.rotulo,
                cpa: a.compras > 0 ? a.gasto / a.compras : null,
                gasto: a.gasto,
                compras: a.compras,
                criativos: a.criativos,
                vencedores: a.vencedores,
                hooks: [...a.hooks].slice(0, 3),
                // Ângulo com venda real vem primeiro; depois os marcados como winner.
                provado: a.compras > 0 || a.vencedores > 0,
            }))
            .sort((x, y) => {
                if (x.provado !== y.provado) return x.provado ? -1 : 1;
                if (x.cpa != null && y.cpa != null) return x.cpa - y.cpa;
                if (x.cpa != null) return -1;
                if (y.cpa != null) return 1;
                return y.criativos - x.criativos;
            })
            .slice(0, limite);
    }

    // Resumo textual dos ângulos, para injetar no prompt da IA.
    function _contextoDeAngulos(productId) {
        const tops = getTopAngles(productId, 5).filter(a => a.provado);
        if (!tops.length) return '';
        const linhas = tops.map(a => {
            const perf = a.cpa != null
                ? `CPA real ${a.cpa.toFixed(2)} em ${a.compras} vendas`
                : `${a.vencedores} criativo(s) marcados como vencedores`;
            const hook = a.hooks[0] ? ` Exemplo de hook que funcionou: "${a.hooks[0]}".` : '';
            return `- "${a.rotulo}" (${perf}).${hook}`;
        });
        return `\n\nÂNGULOS QUE JÁ COMPROVADAMENTE VENDERAM ESTE PRODUTO (use-os como base, do melhor para o pior):\n${linhas.join('\n')}`;
    }

    // ══════════════════════════════════════════════════════════════
    //  Fontes de imagem do produto
    // ══════════════════════════════════════════════════════════════

    function _fontesDeImagem(productId) {
        const fontes = [];
        const p = (AppState.allProducts || []).find(x => x.id === productId);
        if (p?.shopifyImage) fontes.push({ url: p.shopifyImage, origem: 'Shopify' });

        // Imagens que vieram da captura do fornecedor (extensão / importador)
        try {
            const sess = JSON.parse(localStorage.getItem('etracker_importer_sessions') || '[]');
            const nome = (p?.name || '').toLowerCase();
            sess.flatMap(s => s.products || []).forEach(prod => {
                if (!nome || !String(prod.title || '').toLowerCase().includes(nome.slice(0, 12))) return;
                (prod.images || []).slice(0, 4).forEach(im => {
                    if (im.src) fontes.push({ url: im.src, origem: 'Fornecedor' });
                });
            });
        } catch { /* sessões do importador são opcionais */ }

        // Criativos com mídia já salva
        (AppState.allCreatives || [])
            .filter(c => c.productId === productId && (c.mediaThumb || c.imageUrl))
            .slice(0, 6)
            .forEach(c => fontes.push({ url: c.mediaThumb || c.imageUrl, origem: 'Criativo', mediaId: c.mediaId || '' }));

        // Dedupe por URL
        const vistos = new Set();
        return fontes.filter(f => !vistos.has(f.url) && vistos.add(f.url));
    }

    // ══════════════════════════════════════════════════════════════
    //  GERAÇÃO DE FOTO (gpt-image-1 edits, a partir da foto real)
    // ══════════════════════════════════════════════════════════════

    async function _urlParaBlobPng(url, maxDim = 1024) {
        let blob;
        if (url.startsWith('data:') || url.startsWith('blob:')) {
            blob = await (await fetch(url)).blob();
        } else {
            const r = await fetch(url, { mode: 'cors' });
            if (!r.ok) throw new Error('Não consegui baixar a imagem base (CORS?). Baixe e suba o arquivo.');
            blob = await r.blob();
        }
        // gpt-image-1 exige PNG/WebP e limite de tamanho
        const bitmap = await createImageBitmap(blob);
        const escala = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * escala);
        canvas.height = Math.round(bitmap.height * escala);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await new Promise(res => canvas.toBlob(res, 'image/png'));
    }

    async function gerarFotos(presetIds, extra = '') {
        const pid = _state.productId;
        if (!pid) { showToast('Escolha um produto primeiro', 'error'); return; }
        const d = _dados(pid);
        if (!d.fotoBase) { showToast('Escolha a foto base do produto', 'error'); return; }

        const chave = window.AIAdGenerator?._getOpenAIKey?.() || localStorage.getItem('openai_api_key') || '';
        if (!chave) { showToast('Configure a chave OpenAI em AI Generations', 'error'); return; }

        const presets = PRESETS_FOTO.filter(p => presetIds.includes(p.id));
        if (!presets.length) { showToast('Escolha ao menos um cenário', 'error'); return; }

        _state.gerando = true;
        _renderFotos();

        let base;
        try {
            base = await _urlParaBlobPng(d.fotoBase);
        } catch (err) {
            _state.gerando = false; _renderFotos();
            showToast(err.message, 'error');
            return;
        }

        let ok = 0;
        for (const preset of presets) {
            try {
                const prompt = extra ? `${preset.prompt} ${extra}` : preset.prompt;
                const blob = await _editarImagem(base, prompt, chave);
                const id = 'sf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
                const mediaId = 'studio_' + id;
                await MediaStore.put(mediaId, blob, { type: blob.type, name: `${preset.id}.png` });
                const thumb = await _miniatura(blob);
                d.fotos.unshift({ id, mediaId, thumb, preset: preset.id, presetLabel: preset.label,
                                  prompt, criadoEm: new Date().toISOString() });
                ok++;
                _save();
                _renderFotos();
            } catch (err) {
                console.error('[Studio] geração falhou:', err);
                showToast(`${preset.label}: ${String(err.message).slice(0, 120)}`, 'error');
            }
        }

        _state.gerando = false;
        _renderFotos();
        if (ok) showToast(`${ok} foto(s) gerada(s)`, 'success');
    }

    async function _editarImagem(blob, prompt, apiKey) {
        const fd = new FormData();
        fd.append('model', 'gpt-image-1');
        fd.append('image', blob, 'produto.png');
        fd.append('prompt', prompt);
        fd.append('size', '1024x1024');
        fd.append('quality', 'high');
        fd.append('n', '1');
        const r = await fetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey },
            body: fd,
        });
        if (!r.ok) throw new Error((await r.text()).slice(0, 200));
        const data = await r.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) throw new Error('Resposta sem imagem');
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        return new Blob([arr], { type: 'image/png' });
    }

    async function _miniatura(blob, maxDim = 320) {
        const bitmap = await createImageBitmap(blob);
        const escala = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * escala);
        canvas.height = Math.round(bitmap.height * escala);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/webp', 0.6);
    }

    // ══════════════════════════════════════════════════════════════
    //  CLAUDE — gerador de página e copy interativo
    // ══════════════════════════════════════════════════════════════

    async function _claude(system, mensagens, maxTokens = 3000) {
        const key = localStorage.getItem('anthropic_api_key') || '';
        if (!key) throw new Error('Configure a chave Anthropic (Ad Hub → chave da Anthropic)');
        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-api-key': key,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-5',
                max_tokens: maxTokens,
                system,
                messages: mensagens,
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
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

    // Dossiê do produto: tudo que a ferramenta já sabe vira contexto do prompt.
    function _dossie(pid) {
        const p = (AppState.allProducts || []).find(x => x.id === pid);
        if (!p) return '';
        const partes = [`Produto: ${p.name}`];
        if (p.price) partes.push(`Preço de venda: ${p.price} ${p.priceCurrency || ''}`);
        if (p.description) partes.push(`Descrição atual: ${String(p.description).slice(0, 800)}`);
        if (p.vendor) partes.push(`Fornecedor: ${p.vendor}`);

        // Texto do fornecedor capturado pelo importador
        try {
            const sess = JSON.parse(localStorage.getItem('etracker_importer_sessions') || '[]');
            const nome = (p.name || '').toLowerCase().slice(0, 12);
            const achado = sess.flatMap(s => s.products || [])
                .find(x => nome && String(x.title || '').toLowerCase().includes(nome));
            if (achado?.body) {
                const limpo = String(achado.body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                if (limpo) partes.push(`Texto do fornecedor: ${limpo.slice(0, 1200)}`);
            }
        } catch { /* opcional */ }

        return partes.join('\n');
    }

    const SISTEMA_PAGINA = `Você é um copywriter de resposta direta especializado em páginas de produto de e-commerce que convertem no Reino Unido.
Escreva em INGLÊS BRITÂNICO (o público é UK), com tom claro, específico e sem exagero publicitário vazio.
Regras: nunca mencione AliExpress, China, dropshipping ou prazos de entrega longos. Não invente certificações, prêmios ou números de clientes. Foque em benefício concreto e na dor que o produto resolve.
Responda APENAS com JSON válido, sem markdown e sem texto antes ou depois, neste formato exato:
{"titulo":"...","subtitulo":"...","bullets":["...","...","...","...","..."],"descricaoHtml":"<p>...</p>","faq":[{"p":"...","r":"..."}],"garantia":"...","cta":"..."}
- titulo: até 70 caracteres, com o benefício principal
- subtitulo: uma linha de apoio
- bullets: exatamente 5, cada um começando com o benefício
- descricaoHtml: HTML simples (só <p>, <h3>, <ul>, <li>, <strong>), estruturado como problema, solução, prova e garantia
- faq: 5 a 8 perguntas reais de quem hesita antes de comprar
- cta: texto curto do botão`;

    async function gerarPagina() {
        const pid = _state.productId;
        if (!pid) { showToast('Escolha um produto primeiro', 'error'); return; }

        const btn = document.getElementById('studio-gerar-pagina');
        const orig = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i> Gerando…'; }

        try {
            const prompt = `${_dossie(pid)}${_contextoDeAngulos(pid)}\n\nEscreva a página de produto completa.`;
            const txt = await _claude(SISTEMA_PAGINA, [{ role: 'user', content: prompt }]);
            const pagina = _extrairJson(txt);

            const d = _dados(pid);
            d.pagina = { ...pagina, geradoEm: new Date().toISOString() };
            d.chat = [];
            _save();
            _renderPagina();

            // Alimenta a biblioteca de copy para reuso em anúncios
            if (window.CopyLibrary?.add) {
                CopyLibrary.add('product_headline', pagina.titulo, ['studio']);
                (pagina.bullets || []).forEach(b => CopyLibrary.add('product_bullet', b, ['studio']));
            }
            showToast('Página gerada', 'success');
        } catch (err) {
            console.error('[Studio] gerarPagina:', err);
            showToast('Falha: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {} }
        }
    }

    // ── Copy interativo: refina em conversa, preview atualiza ao vivo ──
    async function enviarChat(mensagem) {
        const pid = _state.productId;
        const d = _dados(pid);
        if (!d.pagina) { showToast('Gere a página primeiro', 'error'); return; }
        const texto = String(mensagem || '').trim();
        if (!texto) return;

        d.chat.push({ papel: 'user', texto });
        _renderChat(true);

        try {
            const sistema = `${SISTEMA_PAGINA}

Você está REFINANDO uma página que já existe. O usuário pede ajustes em português; você aplica e devolve a página INTEIRA no mesmo formato JSON, com apenas os trechos pedidos alterados. Preserve o resto exatamente como está.`;
            const historico = d.chat.slice(-8).map(m => ({
                role: m.papel === 'user' ? 'user' : 'assistant',
                content: m.papel === 'user' ? m.texto : JSON.stringify(m.pagina || {}),
            }));
            const prompt = `Página atual:\n${JSON.stringify(d.pagina)}\n\n${_dossie(pid)}${_contextoDeAngulos(pid)}\n\nPedido: ${texto}`;
            const txt = await _claude(sistema, [...historico.slice(0, -1), { role: 'user', content: prompt }]);
            const nova = _extrairJson(txt);

            d.pagina = { ...nova, geradoEm: d.pagina.geradoEm, editadoEm: new Date().toISOString() };
            d.chat.push({ papel: 'ia', texto: 'Página atualizada.', pagina: nova });
            _save();
            _renderPagina();
            _renderChat();
        } catch (err) {
            d.chat.push({ papel: 'ia', texto: 'Falhou: ' + err.message, erro: true });
            _renderChat();
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  EXPORTAR CSV DA SHOPIFY
    //  Caminho que funciona hoje, sem depender de scope novo.
    // ══════════════════════════════════════════════════════════════

    function _csvCampo(v) {
        const s = String(v ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    function _handle(nome) {
        return String(nome || 'produto').toLowerCase().normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '').slice(0, 60) || 'produto';
    }

    function _corpoHtml(pagina) {
        if (!pagina) return '';
        const partes = [];
        if (pagina.subtitulo) partes.push(`<p><strong>${pagina.subtitulo}</strong></p>`);
        if (pagina.bullets?.length) {
            partes.push('<ul>' + pagina.bullets.map(b => `<li>${b}</li>`).join('') + '</ul>');
        }
        if (pagina.descricaoHtml) partes.push(pagina.descricaoHtml);
        if (pagina.garantia) partes.push(`<h3>Our guarantee</h3><p>${pagina.garantia}</p>`);
        if (pagina.faq?.length) {
            partes.push('<h3>FAQ</h3>' + pagina.faq.map(f => `<p><strong>${f.p}</strong><br>${f.r}</p>`).join(''));
        }
        return partes.join('\n');
    }

    function exportarCsv() {
        const pid = _state.productId;
        const p = (AppState.allProducts || []).find(x => x.id === pid);
        if (!p) { showToast('Escolha um produto', 'error'); return; }
        const d = _dados(pid);
        if (!d.pagina) { showToast('Gere a página antes de exportar', 'error'); return; }

        const handle = _handle(d.pagina.titulo || p.name);
        // Cabeçalho oficial de importação de produtos da Shopify
        const cols = ['Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
                      'Option1 Name', 'Option1 Value', 'Variant SKU', 'Variant Inventory Policy',
                      'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price',
                      'Variant Requires Shipping', 'Variant Taxable', 'Image Src', 'Image Position',
                      'Image Alt Text', 'Status'];

        const preco = Number(p.price) || 0;
        const linhas = [cols.join(',')];

        // Imagens: só URLs públicas entram no CSV. As fotos geradas por IA
        // vivem no IndexedDB (blob), que a Shopify não consegue buscar —
        // elas saem no ZIP separado para subir à mão.
        const imagensPublicas = _fontesDeImagem(pid)
            .filter(f => /^https?:/.test(f.url)).map(f => f.url).slice(0, 10);

        linhas.push([
            handle, d.pagina.titulo || p.name, _corpoHtml(d.pagina), p.vendor || '', p.type || '',
            'studio', 'TRUE', 'Title', 'Default Title', p.sku || '', 'deny', 'manual',
            preco.toFixed(2), '', 'TRUE', 'TRUE',
            imagensPublicas[0] || '', imagensPublicas[0] ? '1' : '', d.pagina.titulo || p.name, 'draft',
        ].map(_csvCampo).join(','));

        // Linhas extras só com imagem (padrão da Shopify para múltiplas fotos)
        imagensPublicas.slice(1).forEach((url, i) => {
            const linha = new Array(cols.length).fill('');
            linha[0] = handle;
            linha[16] = url;
            linha[17] = String(i + 2);
            linhas.push(linha.map(_csvCampo).join(','));
        });

        const blob = new Blob(['﻿' + linhas.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `shopify-${handle}.csv`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);

        const geradas = d.fotos.length;
        showToast(geradas
            ? `CSV exportado. As ${geradas} foto(s) geradas por IA precisam ser baixadas e subidas à mão — a Shopify não acessa arquivos locais.`
            : 'CSV exportado — importe em Shopify → Produtos → Importar.', 'success');
    }

    // ══════════════════════════════════════════════════════════════
    //  Interface
    // ══════════════════════════════════════════════════════════════

    function _esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function _icones() { if (window.lucide?.createIcons) try { lucide.createIcons(); } catch {} }

    function _preencherProdutos() {
        const sel = document.getElementById('studio-produto');
        if (!sel) return;
        const produtos = (AppState.allProducts || []).filter(p => p.status !== 'inativo');
        sel.innerHTML = '<option value="">-- Escolha o produto --</option>' +
            produtos.map(p => `<option value="${_esc(p.id)}"${p.id === _state.productId ? ' selected' : ''}>${_esc(p.name)}</option>`).join('');
    }

    function _renderAngulos() {
        const box = document.getElementById('studio-angulos');
        if (!box) return;
        const tops = getTopAngles(_state.productId, 6);
        if (!tops.length) {
            box.innerHTML = `<p class="studio-vazio">Nenhum ângulo registrado ainda. Preencha "Ângulo" e "Hook" nos criativos — o Estúdio usa os que já venderam para escrever a copy.</p>`;
            return;
        }
        box.innerHTML = tops.map(a => {
            const perf = a.cpa != null ? `CPA ${a.cpa.toFixed(2)} · ${a.compras} vendas`
                       : (a.vencedores ? `${a.vencedores} winner(s)` : `${a.criativos} criativo(s)`);
            return `<span class="studio-angulo ${a.provado ? 'studio-angulo-provado' : ''}" title="${_esc(a.hooks[0] || '')}">
                ${a.provado ? '<i data-lucide="check-circle-2" style="width:11px;height:11px;vertical-align:-1px"></i> ' : ''}${_esc(a.rotulo)}
                <em>${perf}</em></span>`;
        }).join('');
        _icones();
    }

    function _renderFontes() {
        const box = document.getElementById('studio-fontes');
        if (!box) return;
        const d = _dados(_state.productId);
        const fontes = _fontesDeImagem(_state.productId);
        if (!fontes.length) {
            box.innerHTML = `<p class="studio-vazio">Sem imagem deste produto. Suba uma abaixo, ou importe o produto pela extensão / Shopify.</p>`;
            return;
        }
        box.innerHTML = fontes.map(f => `
            <button type="button" class="studio-fonte ${d.fotoBase === f.url ? 'studio-fonte-ativa' : ''}" data-url="${_esc(f.url)}">
                <img src="${_esc(f.url)}" alt="" loading="lazy">
                <span>${_esc(f.origem)}</span>
            </button>`).join('');
        box.querySelectorAll('.studio-fonte').forEach(b => {
            b.addEventListener('click', () => {
                _dados(_state.productId).fotoBase = b.dataset.url;
                _save(); _renderFontes();
            });
        });
    }

    function _renderPresets() {
        const box = document.getElementById('studio-presets');
        if (!box || box.dataset.pronto) return;
        box.innerHTML = PRESETS_FOTO.map(p => `
            <label class="studio-preset">
                <input type="checkbox" value="${p.id}"${p.id === 'estudio' || p.id === 'lifestyle' ? ' checked' : ''}>
                <i data-lucide="${p.icone}" style="width:14px;height:14px"></i> ${_esc(p.label)}
            </label>`).join('');
        box.dataset.pronto = '1';
        _icones();
    }

    async function _renderFotos() {
        const box = document.getElementById('studio-fotos');
        if (!box) return;
        const d = _dados(_state.productId);
        const carregando = _state.gerando
            ? `<div class="studio-foto-carregando"><i data-lucide="loader-2" style="width:22px;height:22px;animation:spin 1s linear infinite"></i><span>Gerando…</span></div>` : '';

        if (!d.fotos.length && !_state.gerando) {
            box.innerHTML = `<p class="studio-vazio">Nenhuma foto gerada ainda. Escolha a foto base, marque os cenários e clique em "Gerar fotos".</p>`;
            return;
        }
        box.innerHTML = carregando + d.fotos.map(f => `
            <div class="studio-foto" data-id="${f.id}">
                <img src="${_esc(f.thumb)}" alt="${_esc(f.presetLabel || '')}" loading="lazy">
                <span class="studio-foto-tag">${_esc(f.presetLabel || f.preset)}</span>
                <div class="studio-foto-acoes">
                    <button class="btn-icon" data-acao="baixar" data-id="${f.id}" title="Baixar em resolução cheia"><i data-lucide="download" style="width:13px;height:13px"></i></button>
                    <button class="btn-icon" data-acao="criativo" data-id="${f.id}" title="Salvar em Meus Criativos"><i data-lucide="bookmark-plus" style="width:13px;height:13px"></i></button>
                    <button class="btn-icon" data-acao="excluir" data-id="${f.id}" title="Excluir"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                </div>
            </div>`).join('');
        _icones();

        box.querySelectorAll('button[data-acao]').forEach(b => {
            b.addEventListener('click', () => _acaoFoto(b.dataset.acao, b.dataset.id));
        });
    }

    async function _acaoFoto(acao, id) {
        const d = _dados(_state.productId);
        const f = d.fotos.find(x => x.id === id);
        if (!f) return;

        if (acao === 'baixar') {
            const url = await MediaStore.getObjectUrl(f.mediaId);
            if (!url) { showToast('Arquivo não encontrado', 'error'); return; }
            const a = document.createElement('a');
            a.href = url; a.download = `${_handle(f.presetLabel)}-${id}.png`; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 10000);

        } else if (acao === 'excluir') {
            await MediaStore.del(f.mediaId);
            d.fotos = d.fotos.filter(x => x.id !== id);
            _save(); _renderFotos();

        } else if (acao === 'criativo') {
            // Cópia própria do blob: excluir o criativo apaga a mídia dele.
            const rec = await MediaStore.get(f.mediaId);
            if (!rec?.blob) { showToast('Arquivo não encontrado', 'error'); return; }
            const novoId = 'media_st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            await MediaStore.put(novoId, rec.blob, { type: rec.blob.type, name: `${f.preset}.png` });

            const p = (AppState.allProducts || []).find(x => x.id === _state.productId);
            AppState.allCreatives = AppState.allCreatives || [];
            AppState.allCreatives.push({
                id: 'crtv_st_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5),
                productId: _state.productId,
                name: `${p?.name || 'Produto'} — ${f.presetLabel}`,
                type: 'Imagem', angle: '', hookText: '', hookType: '',
                platform: 'Meta Ads', status: 'ativo',
                launchDate: (typeof todayISO === 'function' ? todayISO() : new Date().toISOString().slice(0, 10)),
                primaryText: '', headline: '', adDescription: '',
                imageUrl: '', mediaId: novoId, mediaType: rec.blob.type || 'image/png',
                mediaThumb: f.thumb, mediaName: `${f.preset}.png`,
                variations: [],
                storeId: p?.storeId || (typeof getWritableStoreId === 'function' ? getWritableStoreId(_state.productId) : ''),
                createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
            });
            if (typeof filterDataByStore === 'function') filterDataByStore();
            LocalStore.save('creatives', AppState.allCreatives);
            EventBus.emit('creativesChanged');
            showToast('Salvo em Meus Criativos', 'success');
        }
    }

    function _renderPagina() {
        const box = document.getElementById('studio-preview');
        const acoes = document.getElementById('studio-pagina-acoes');
        if (!box) return;
        const d = _dados(_state.productId);
        if (acoes) acoes.style.display = d.pagina ? '' : 'none';

        if (!d.pagina) {
            box.innerHTML = `<div class="studio-vazio-grande">
                <i data-lucide="file-text" style="width:36px;height:36px;color:var(--text-muted)"></i>
                <p>Nenhuma página gerada ainda.</p>
                <p class="studio-vazio">A copy sai em inglês britânico e usa os ângulos que já venderam este produto.</p>
            </div>`;
            _icones();
            return;
        }

        const pg = d.pagina;
        const capa = d.fotos[0]?.thumb || _fontesDeImagem(_state.productId)[0]?.url || '';
        const p = (AppState.allProducts || []).find(x => x.id === _state.productId);
        box.innerHTML = `
            <div class="studio-pdp">
                ${capa ? `<img class="studio-pdp-img" src="${_esc(capa)}" alt="">` : ''}
                <div class="studio-pdp-txt">
                    <h2>${_esc(pg.titulo || '')}</h2>
                    ${pg.subtitulo ? `<p class="studio-pdp-sub">${_esc(pg.subtitulo)}</p>` : ''}
                    ${p?.price ? `<div class="studio-pdp-preco">${formatCurrency(p.price, p.priceCurrency || 'GBP')}</div>` : ''}
                    ${pg.bullets?.length ? `<ul class="studio-pdp-bullets">${pg.bullets.map(b => `<li>${_esc(b)}</li>`).join('')}</ul>` : ''}
                    ${pg.cta ? `<button class="btn btn-primary studio-pdp-cta" disabled>${_esc(pg.cta)}</button>` : ''}
                    ${pg.garantia ? `<p class="studio-pdp-garantia"><i data-lucide="shield-check" style="width:13px;height:13px;vertical-align:-2px"></i> ${_esc(pg.garantia)}</p>` : ''}
                </div>
            </div>
            <div class="studio-pdp-desc">${pg.descricaoHtml || ''}</div>
            ${pg.faq?.length ? `<div class="studio-pdp-faq"><h3>FAQ</h3>${pg.faq.map(f => `
                <details><summary>${_esc(f.p)}</summary><p>${_esc(f.r)}</p></details>`).join('')}</div>` : ''}`;
        _icones();
    }

    function _renderChat(pensando = false) {
        const box = document.getElementById('studio-chat');
        if (!box) return;
        const d = _dados(_state.productId);
        if (!d.chat.length && !pensando) {
            box.innerHTML = `<p class="studio-vazio">Peça ajustes em português: "deixa o título mais direto", "troca o bullet 3 para dor", "encurta a descrição".</p>`;
            return;
        }
        box.innerHTML = d.chat.map(m => `
            <div class="studio-msg studio-msg-${m.papel}${m.erro ? ' studio-msg-erro' : ''}">${_esc(m.texto)}</div>`).join('')
            + (pensando ? `<div class="studio-msg studio-msg-ia studio-msg-pensando"><i data-lucide="loader-2" style="width:13px;height:13px;animation:spin 1s linear infinite"></i> Reescrevendo…</div>` : '');
        box.scrollTop = box.scrollHeight;
        _icones();
    }

    function _selecionarProduto(pid) {
        _state.productId = pid;
        _renderAngulos(); _renderFontes(); _renderPresets();
        _renderFotos(); _renderPagina(); _renderChat();
    }

    function render() {
        _preencherProdutos();
        if (_state.productId) _selecionarProduto(_state.productId);
    }

    function init() {
        _load();

        document.getElementById('studio-produto')?.addEventListener('change', (e) => _selecionarProduto(e.target.value));

        document.getElementById('studio-gerar-fotos')?.addEventListener('click', () => {
            const ids = [...document.querySelectorAll('#studio-presets input:checked')].map(i => i.value);
            const extra = (document.getElementById('studio-foto-extra')?.value || '').trim();
            gerarFotos(ids, extra);
        });

        // Upload manual da foto base (quando o produto não tem imagem no app)
        document.getElementById('studio-upload-btn')?.addEventListener('click', () => document.getElementById('studio-upload')?.click());
        document.getElementById('studio-upload')?.addEventListener('change', async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f || !_state.productId) return;
            const r = new FileReader();
            r.onloadend = () => {
                _dados(_state.productId).fotoBase = r.result;
                _save();
                const box = document.getElementById('studio-fontes');
                if (box) box.insertAdjacentHTML('afterbegin',
                    `<button type="button" class="studio-fonte studio-fonte-ativa"><img src="${r.result}" alt=""><span>Upload</span></button>`);
                showToast('Foto base definida', 'success');
            };
            r.readAsDataURL(f);
        });

        document.getElementById('studio-gerar-pagina')?.addEventListener('click', () => gerarPagina());
        document.getElementById('studio-exportar-csv')?.addEventListener('click', () => exportarCsv());

        const enviar = () => {
            const inp = document.getElementById('studio-chat-input');
            if (!inp?.value.trim()) return;
            const txt = inp.value; inp.value = '';
            enviarChat(txt);
        };
        document.getElementById('studio-chat-enviar')?.addEventListener('click', enviar);
        document.getElementById('studio-chat-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
        });

        // Métricas novas mudam o ranking de ângulos
        if (typeof EventBus !== 'undefined') {
            EventBus.on('creativesChanged', () => { if (_state.productId) _renderAngulos(); });
            EventBus.on('productsChanged', () => _preencherProdutos());
            EventBus.on('tabChanged', (tab) => { if (tab === 'studio') render(); });
        }
    }

    return {
        STORAGE_KEY, PRESETS_FOTO, _state,
        init, render,
        getTopAngles, _contextoDeAngulos, _fontesDeImagem, _dossie,
        gerarFotos, gerarPagina, enviarChat, exportarCsv,
        _dados, _save, _load, _miniatura, _urlParaBlobPng, _editarImagem,
        _claude, _extrairJson, _corpoHtml, _handle,
        _renderFotos, _renderPagina, _renderChat, _renderAngulos, _selecionarProduto,
    };
})();

window.StudioModule = StudioModule;
document.addEventListener('DOMContentLoaded', () => StudioModule.init());
