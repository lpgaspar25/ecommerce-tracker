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
        padroes: [],          // padrões de criativo (esqueletos de prompt)
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
            if (raw && typeof raw === 'object') {
                _state.porProduto = raw.porProduto || {};
                _state.padroes = Array.isArray(raw.padroes) ? raw.padroes : [];
            }
        } catch (e) { console.warn('[Studio] load falhou:', e); }
    }

    function _save() {
        const gravar = () => localStorage.setItem(STORAGE_KEY,
            JSON.stringify({ porProduto: _state.porProduto, padroes: _state.padroes || [] }));
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

        // Fotos do próprio cadastro: as importadas da Shopify vêm como URL,
        // as que o usuário subiu vêm como dataUrl. Estas são a fonte principal
        // depois que o produto é importado com descrição/fotos/variantes.
        (p?.images || []).forEach(im => {
            const src = im.url || im.dataUrl;
            if (src) fontes.push({ url: src, origem: im.dataUrl ? 'Upload' : 'Produto' });
        });

        // Imagem específica de cada variante (cor/modelo) — é o que permite
        // gerar criativo por variante em vez de um só para o produto inteiro.
        (p?.shopifyVariants || []).forEach(v => {
            if (v.image) fontes.push({ url: v.image, origem: v.title || 'Variante' });
        });

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

        // A chave exigida depende do provedor escolhido — cobrar a da OpenAI
        // quando o usuário selecionou Gemini bloquearia sem motivo.
        const prov = _provedorImagem();
        const chave = prov === 'gemini' ? _chaveGoogle() : _chaveOpenAI();
        if (!chave) {
            showToast(prov === 'gemini'
                ? 'Configure a chave Google AI em AI Generations → API Keys'
                : 'Configure a chave OpenAI em AI Generations → API Keys', 'error');
            return;
        }

        // Um id pode ser um preset de texto (id cru) ou um cenário de
        // referência — um criativo que o usuário subiu, cujo AMBIENTE vamos
        // reaproveitar (id no formato "cen:<padraoId>").
        const presets = PRESETS_FOTO.filter(p => presetIds.includes(p.id));
        const cenariosRef = (presetIds || [])
            .filter(id => String(id).startsWith('cen:'))
            .map(id => (_state.padroes || []).find(p => p.id === id.slice(4)))
            .filter(Boolean);

        if (!presets.length && !cenariosRef.length) { showToast('Escolha ao menos um cenário', 'error'); return; }

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

        const m = d.marca;
        // A estética da marca entra no prompt da foto — senão a imagem sai
        // bonita mas sem nada a ver com a loja.
        const estetica = m ? ` Overall aesthetic: ${(m.tom?.adjetivos || []).join(', ')}. Art direction aimed at ${m.publico?.quem || 'the target buyer'}.` : '';
        // Contexto curto pro prompt de IMAGEM (o _dossie completo é longo
        // demais e vira ruído). Só o essencial pra identificar o produto.
        const prod = (AppState.allProducts || []).find(x => x.id === pid);
        const contexto = [prod?.name, prod?.vendor && `by ${prod.vendor}`].filter(Boolean).join(' ');

        let ok = 0;

        // 1) Cenários de texto (os presets fixos).
        for (const preset of presets) {
            try {
                const prompt = `${preset.prompt}${estetica}${extra ? ' ' + extra : ''}`;
                const blob = await _editarImagem(base, prompt, chave);
                await _guardarFoto(d, blob, preset.id, preset.label, prompt);
                ok++;
                _save(); _renderFotos();
            } catch (err) {
                console.error('[Studio] geração falhou:', err);
                showToast(`${preset.label}: ${String(err.message).slice(0, 120)}`, 'error');
            }
        }

        // 2) Cenários de referência: coloca o produto DENTRO da cena do criativo
        //    subido. Manda [cena, produto] — a ordem casa com "first/second
        //    image" do prompt.
        for (const cen of cenariosRef) {
            try {
                const cena = await _blobDoPadrao(cen);
                if (!cena) throw new Error('sem imagem de referência salva');
                const promptBase = (window.ImageAI?.promptCenaImagem?.(contexto))
                    || `Use the two provided images. THE FIRST IMAGE is a scene; THE SECOND IMAGE is a product. Place the product naturally into the scene, keeping it unchanged.`;
                const prompt = `${promptBase}${estetica}${extra ? ' ' + extra : ''}`;
                const blob = await _editarImagem([cena, base], prompt, chave);
                await _guardarFoto(d, blob, 'cen:' + cen.id, `Cenário: ${cen.nome}`, prompt);
                ok++;
                _save(); _renderFotos();
            } catch (err) {
                console.error('[Studio] cenário de referência falhou:', err);
                showToast(`Cenário "${cen.nome}": ${String(err.message).slice(0, 120)}`, 'error');
            }
        }

        _state.gerando = false;
        _renderFotos();
        if (ok) showToast(`${ok} foto(s) gerada(s)`, 'success');
    }

    // Grava uma foto gerada (blob → MediaStore + miniatura + registro).
    async function _guardarFoto(d, blob, preset, presetLabel, prompt) {
        const id = 'sf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const mediaId = 'studio_' + id;
        await MediaStore.put(mediaId, blob, { type: blob.type, name: `${_handle(presetLabel)}.png` });
        const thumb = await _miniatura(blob);
        d.fotos.unshift({ id, mediaId, thumb, preset, presetLabel, prompt, criadoEm: new Date().toISOString() });
    }

    function _b64ParaBlob(b64, tipo = 'image/png') {
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        return new Blob([arr], { type: tipo });
    }

    function _blobParaBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onloadend = () => resolve(String(r.result || '').split(',')[1] || '');
            r.onerror = () => reject(new Error('Falha ao ler a imagem'));
            r.readAsDataURL(blob);
        });
    }

    // Provedor escolhido na tela. Ambos EDITAM a foto real do produto —
    // gerar do zero inventaria outro produto, que é o que queremos evitar.
    function _provedorImagem() {
        return document.getElementById('studio-img-provider')?.value || 'openai';
    }

    // Aceita 1 ou 2 imagens. Com 2, a primeira é a referência de composição
    // e a segunda é o produto real — a doc dos dois provedores manda separar
    // esses papéis pelo TEXTO do prompt, não por campo da API.
    async function _editarImagem(blobs, prompt, apiKey, provedor) {
        const lista = Array.isArray(blobs) ? blobs.filter(Boolean) : [blobs];
        const prov = provedor || _provedorImagem();
        if (prov === 'gemini') return _editarComGemini(lista, prompt);
        return _editarComOpenAI(lista, prompt, apiKey || _chaveOpenAI());
    }

    async function _editarComOpenAI(blobs, prompt, apiKey) {
        if (!apiKey) throw new Error('Configure a chave OpenAI (AI Generations → API Keys)');
        const lista = Array.isArray(blobs) ? blobs : [blobs];
        const fd = new FormData();
        fd.append('model', 'gpt-image-1');
        // Múltiplas imagens usam o campo "image[]" repetido (até 16).
        if (lista.length > 1) {
            lista.forEach((b, i) => fd.append('image[]', b, `img${i + 1}.png`));
        } else {
            fd.append('image', lista[0], 'produto.png');
        }
        fd.append('prompt', prompt);
        fd.append('size', '1024x1024');
        fd.append('quality', 'high');
        // Default da API é "low" — com low o modelo reinterpreta o produto em
        // vez de preservá-lo, que é o oposto do que a feature precisa.
        fd.append('input_fidelity', 'high');
        fd.append('n', '1');
        const r = await fetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + apiKey },
            body: fd,
        });
        if (!r.ok) throw new Error('OpenAI: ' + (await r.text()).slice(0, 200));
        const data = await r.json();
        const b64 = data?.data?.[0]?.b64_json;
        if (!b64) throw new Error('OpenAI: resposta sem imagem');
        return _b64ParaBlob(b64);
    }

    // Ordem de tentativa. O gemini-2.5-flash-image (Nano Banana original) tem
    // desligamento anunciado para 02/10/2026, então fica só como último
    // recurso. O 3-pro é o único da família com referência de ESTILO, que é
    // exatamente o que o padrão de criativo é; o 3.1-flash é o substituto
    // oficial do depreciado e cobre bem múltiplas imagens.
    const MODELOS_GEMINI = ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

    async function _editarComGemini(blobs, prompt) {
        const key = _chaveGoogle();
        if (!key) throw new Error('Configure a chave Google AI (AI Generations → API Keys)');
        const lista = Array.isArray(blobs) ? blobs : [blobs];

        // Exemplos oficiais multi-imagem põem as IMAGENS antes do texto, para
        // que "first/second image" no prompt case com a ordem enviada.
        const parts = [];
        for (const b of lista) {
            parts.push({ inline_data: { mime_type: b.type || 'image/png', data: await _blobParaBase64(b) } });
        }
        parts.push({ text: prompt });

        let ultimoErro = '';
        for (const modelo of MODELOS_GEMINI) {
            const r = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${key}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: '2K' } },
                }),
            });
            if (!r.ok) {
                ultimoErro = (await r.text()).slice(0, 220);
                // Modelo indisponível para esta chave: tenta o próximo da lista.
                if (r.status === 404 || r.status === 403 || r.status === 400) continue;
                throw new Error('Gemini: ' + ultimoErro);
            }
            const data = await r.json();
            const partes = data?.candidates?.[0]?.content?.parts || [];
            const img = partes.find(p => p.inlineData?.data || p.inline_data?.data);
            const b64 = img?.inlineData?.data || img?.inline_data?.data;
            if (b64) return _b64ParaBlob(b64, img?.inlineData?.mimeType || 'image/png');
            // Respondeu só texto (recusa/segurança) — o motivo importa mais
            // que tentar outro modelo, que responderia igual.
            const txt = partes.map(p => p.text).filter(Boolean).join(' ').slice(0, 180);
            throw new Error('Gemini não devolveu imagem' + (txt ? `: ${txt}` : '.'));
        }
        throw new Error('Gemini: nenhum modelo de imagem disponível para esta chave. ' + ultimoErro);
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
    //  PADRÕES DE CRIATIVO
    //  O usuário sobe um criativo que JÁ validou; a IA olha a imagem e
    //  escreve o "esqueleto" do prompt que a produziu — com a marca e o
    //  produto trocados por marcadores. Assim o mesmo enquadramento,
    //  luz e clima podem ser reaplicados a qualquer outro produto.
    // ══════════════════════════════════════════════════════════════

    // Marcadores que o esqueleto DEVE usar no lugar do produto/marca reais.
    const MARCADORES = ['{PRODUTO}', '{DESCRICAO_PRODUTO}', '{MARCA}', '{HEADLINE}', '{SUBHEADLINE}', '{CTA}'];

    const SISTEMA_ESQUELETO = `Você analisa criativos publicitários de e-commerce e escreve o PROMPT que geraria aquela imagem num modelo de imagem por IA.

O prompt precisa ser um ESQUELETO REUTILIZÁVEL, não a descrição de um produto específico. Isso é o mais importante da tarefa.

REGRAS DO ESQUELETO:
1. Descreva em detalhe: enquadramento, posição e ângulo do produto, superfície/apoio, fundo, gradiente, partículas, direção e qualidade da luz, sombras, textura dos materiais, contraste, clima geral e onde ficam os elementos de marca e texto.
2. NUNCA cite a marca real, o nome do produto, cores específicas do produto nem detalhes exclusivos dele (logo, emblema, formato de lente). No lugar deles use EXATAMENTE estes marcadores:
   {PRODUTO} — o produto em si
   {DESCRICAO_PRODUTO} — características físicas do produto
   {MARCA} — nome da marca
   {HEADLINE} — título grande
   {SUBHEADLINE} — linha de apoio
   {CTA} — texto do botão
   Use apenas os marcadores que a imagem realmente pede. Se não há texto na imagem, não invente {HEADLINE}.
3. Mantenha SEMPRE uma instrução explícita de preservar a estrutura e os detalhes originais do produto, sem alterar cor, forma ou marcações — é o que impede o modelo de inventar outro produto.
4. Escreva em INGLÊS, num parágrafo corrido e denso, no estilo de prompt fotográfico profissional.
5. Não use markdown, não numere, não explique. Só o prompt.

Responda APENAS com JSON válido:
{"nomeSugerido":"...","esqueleto":"...","aspecto":"1:1|4:5|16:9","observacao":"..."}
- nomeSugerido: rótulo curto em português para este padrão (ex.: "Caixa preta com luz de cima")
- observacao: uma frase em português dizendo para que tipo de produto este padrão funciona melhor`;

    // Transcrição literal do produto ATUAL (diferente do esqueleto, que é
    // genérico). Nenhum modelo de edição de imagem garante preservar texto
    // fino sem que ele esteja escrito, palavra por palavra, no prompt — é a
    // orientação oficial tanto da OpenAI quanto do Google. Sem isso o modelo
    // "adivinha" (ex.: troca uma marcação real por "Polarized", que é comum
    // em óculos, ou inventa um logo que não existia na composição).
    const SISTEMA_MARCACOES = `Você transcreve, de forma literal e exata, todo texto e elemento gráfico de marca visível numa foto de produto.

Liste CADA texto impresso, gravado, em relevo ou bordado (nome de marca, modelo, selos como "Polarized"/"Waterproof", texto em etiquetas, zíperes, embalagem) exatamente como está escrito — sem traduzir, sem corrigir ortografia, sem completar. Se a palavra estiver cortada ou ilegível, transcreva só o que dá pra ler com certeza.

Responda APENAS com JSON válido:
{"marcacoes":[{"texto":"...","local":"..."}],"temTexto":true|false}
- texto: a palavra/frase exata, entre aspas no idioma original
- local: onde está (ex.: "haste direita do óculos", "tampa do estojo")
- temTexto: false e marcacoes:[] se a foto não tiver nenhum texto/logo visível`;

    async function _visaoIA(system, base64, mediaType, texto) {
        const key = _chaveOpenAI();
        if (!key) throw new Error('Configure a chave OpenAI (AI Generations → API Keys)');
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: 2000,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: [
                        { type: 'text', text: texto },
                        { type: 'image_url', image_url: { url: `data:${mediaType || 'image/jpeg'};base64,${base64}`, detail: 'high' } },
                    ] },
                ],
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }

    function _arquivoParaBase64(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onloadend = () => {
                const s = String(r.result || '');
                const virgula = s.indexOf(',');
                resolve({ base64: s.slice(virgula + 1), mediaType: (s.match(/^data:([^;]+);/) || [])[1] || 'image/jpeg', dataUrl: s });
            };
            r.onerror = () => reject(new Error('Não consegui ler o arquivo'));
            r.readAsDataURL(file);
        });
    }

    // Analisa um criativo validado e devolve o esqueleto de prompt.
    async function criarPadraoDeImagem(file, nomeManual, nicho, subnicho) {
        const { base64, mediaType, dataUrl } = await _arquivoParaBase64(file);
        const txt = await _visaoIA(SISTEMA_ESQUELETO, base64, mediaType,
            'Analise este criativo e escreva o esqueleto de prompt reutilizável, seguindo as regras.');
        const parsed = _extrairJson(txt);

        // Sem marcador nenhum o "esqueleto" é só a descrição daquele produto —
        // aplicá-lo a outro geraria a imagem do produto errado.
        const temMarcador = MARCADORES.some(m => String(parsed.esqueleto || '').includes(m));
        if (!temMarcador) throw new Error('A IA não gerou um esqueleto reutilizável (sem marcadores). Tente de novo.');

        const id = 'pad_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const thumb = await _miniatura(await _dataUrlParaBlob(dataUrl));
        let mediaId = '';
        if (window.MediaStore?.isSupported?.()) {
            try {
                mediaId = 'padrao_' + id;
                await MediaStore.put(mediaId, await _dataUrlParaBlob(dataUrl), { type: mediaType, name: `${id}.jpg` });
            } catch { mediaId = ''; }
        }

        const padrao = {
            id,
            nome: (nomeManual || '').trim() || parsed.nomeSugerido || 'Padrão sem nome',
            nicho: (nicho || '').trim(),
            subnicho: (subnicho || '').trim(),
            esqueleto: parsed.esqueleto,
            aspecto: parsed.aspecto || '1:1',
            observacao: parsed.observacao || '',
            marcadores: MARCADORES.filter(m => parsed.esqueleto.includes(m)),
            exemploThumb: thumb,
            exemploMediaId: mediaId,
            usos: 0,
            criadoEm: new Date().toISOString(),
        };
        _state.padroes = _state.padroes || [];
        _state.padroes.unshift(padrao);
        _save();
        return padrao;
    }

    async function _dataUrlParaBlob(dataUrl) {
        return await (await fetch(dataUrl)).blob();
    }

    // Lê literalmente o texto/logo visível na foto base ATUAL do produto.
    // Cacheado por produto e invalidado se a foto base mudar, pra não gastar
    // uma chamada de visão a cada geração com padrões diferentes.
    async function _marcacoesDoProduto(pid, base) {
        const d = _dados(pid);
        if (d._marcacoesCache && d._marcacoesCache.fonte === d.fotoBase) {
            return d._marcacoesCache.dados;
        }
        const base64 = await _blobParaBase64(base);
        const txt = await _visaoIA(SISTEMA_MARCACOES, base64, 'image/png',
            'Transcreva literalmente todo texto e logo visível nesta foto de produto.');
        const dados = _extrairJson(txt);
        d._marcacoesCache = { fonte: d.fotoBase, dados };
        return dados;
    }

    // Bloco final anexado ao prompt: trava o que já existe no produto real
    // pra IA não inventar substituto (ex.: "Polarized" no lugar do texto
    // real) nem acrescentar elemento gráfico que não estava no esqueleto.
    // `alvo` muda a forma de apontar o produto conforme o número de imagens.
    function _instrucaoPreservacao(marcacoes, alvo = 'the input photo') {
        const lista = (marcacoes?.marcacoes || [])
            .filter(m => m?.texto)
            .map(m => `"${m.texto}"${m.local ? ` (${m.local})` : ''}`);
        if (!lista.length) {
            return ` This is a photo edit of a real product, not a new illustration — do not add any text, logo, tag, plaque, or badge to the product that is not already visible in ${alvo}.`;
        }
        return ` This is a photo edit of a real product, not a new illustration. The product in ${alvo} already has these exact markings — reproduce every one character-for-character, in the same position, without translating, paraphrasing, or substituting them: ${lista.join(', ')}. Do not add any other text, logo, tag, plaque, or badge beyond what is listed here.`;
    }

    // Instrução de transferência de composição, usada quando mandamos as DUAS
    // imagens. Segue o padrão oficial dos dois provedores: separar os papéis
    // no texto ("the first image" / "the second image"), já que nenhuma das
    // APIs tem campo para dizer qual é estilo e qual é sujeito.
    function _instrucaoComposicao(marca) {
        const trocaMarca = marca
            ? ` Any brand name or logo that appears in the first image must be replaced with "${marca}" — never keep the original brand from the first image.`
            : ' Remove any brand name or logo that belongs to the first image; do not carry it over into the result.';
        return `Use the two provided images. THE FIRST IMAGE is a reference advertising creative: copy its composition, framing, camera angle, product placement, background, surface, lighting, shadows, colour grading and text layout as closely as possible. THE SECOND IMAGE is the real product this new creative is for. Rebuild the scene of the first image, but featuring the product from the second image — including its own case, pouch, cloth and accessories exactly as they appear in the second image, replacing the ones from the first image. The product from the second image must keep its exact shape, proportions, colour, materials and every marking unchanged; do not restyle it to look like the product in the first image.${trocaMarca} Scene described in detail: `;
    }

    // {DESCRICAO_PRODUTO} vai para um modelo de IMAGEM, então precisa conter
    // traço físico, não copy de venda. A descrição da Shopify é texto de
    // marketing ("PROTECT YOUR EYES WITH STYLE…") e o modelo desenhava aquilo
    // como texto na cena — por isso as opções/variantes vêm primeiro, que são
    // objetivas (cor, modelo), e o texto livre entra só higienizado.
    function _descricaoFisica(p) {
        const opcoes = (p?.shopifyOptions || [])
            .filter(o => !/^(title|tamanho|size)$/i.test(o.name || ''))
            .map(o => `${o.name}: ${o.values.join('/')}`)
            .join('; ');
        if (opcoes) return opcoes;

        const bruto = String(p?.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!bruto) return '';
        const frases = bruto.split(/(?<=[.!?])\s+/)
            // Fora headline gritada e chamada de venda — viram texto na imagem.
            .filter(f => f && !(f === f.toUpperCase() && f.length > 12))
            .filter(f => !/^(discover|shop|buy|get|protect|order|dont |don't )/i.test(f.trim()));
        let saida = '';
        for (const f of frases) {
            if ((saida + ' ' + f).trim().length > 180) break;
            saida = (saida + ' ' + f).trim();
        }
        return saida || frases[0] || '';
    }

    // Preenche os marcadores do esqueleto com os dados do produto/marca.
    function montarPromptDoPadrao(padrao, productId, extras = {}) {
        if (!padrao) return '';
        const p = (AppState.allProducts || []).find(x => x.id === productId);
        const d = _dados(productId);
        const marca = d.marca;
        const pagina = d.pagina;

        const valores = {
            '{PRODUTO}': extras.produto || p?.name || 'the product',
            '{DESCRICAO_PRODUTO}': extras.descricao || _descricaoFisica(p) || 'the product exactly as shown in the reference photo',
            '{MARCA}': extras.marca || marca?.nome || p?.vendor || '',
            '{HEADLINE}': extras.headline || pagina?.hero?.titulo || marca?.tagline || '',
            '{SUBHEADLINE}': extras.subheadline || pagina?.hero?.subtitulo || '',
            '{CTA}': extras.cta || pagina?.cta || 'Shop now',
        };

        let prompt = padrao.esqueleto;
        Object.entries(valores).forEach(([marc, val]) => {
            prompt = prompt.split(marc).join(val);
        });
        // Marcador sem valor deixaria a palavra crua no prompt final
        MARCADORES.forEach(m => { prompt = prompt.split(m).join(''); });
        return prompt.replace(/\s{2,}/g, ' ').trim();
    }

    // Recupera o criativo original do padrão. Padrões antigos (ou salvos sem
    // IndexedDB) só têm a miniatura — ela serve de referência de composição,
    // já que o produto real vem da outra imagem em alta resolução.
    async function _blobDoPadrao(padrao) {
        try {
            if (padrao.exemploMediaId && window.MediaStore?.isSupported?.()) {
                const rec = await MediaStore.get(padrao.exemploMediaId);
                if (rec?.blob) return rec.blob;
            }
            if (padrao.exemploThumb) return await _dataUrlParaBlob(padrao.exemploThumb);
        } catch (e) {
            console.warn('[Studio] não consegui carregar o criativo de referência:', e.message);
        }
        return null;
    }

    function _marcaDoProduto(pid) {
        const p = (AppState.allProducts || []).find(x => x.id === pid);
        return (_dados(pid).marca?.nome || p?.vendor || '').trim();
    }

    // Gera uma imagem aplicando o padrão à foto base do produto.
    async function gerarComPadrao(padraoId) {
        const pid = _state.productId;
        if (!pid) { showToast('Escolha um produto primeiro', 'error'); return; }
        const d = _dados(pid);
        if (!d.fotoBase) { showToast('Escolha a foto base do produto', 'error'); return; }
        const padrao = (_state.padroes || []).find(x => x.id === padraoId);
        if (!padrao) { showToast('Padrão não encontrado', 'error'); return; }

        // A chave exigida depende do provedor escolhido — cobrar a da OpenAI
        // quando o usuário selecionou Gemini bloquearia sem motivo.
        const prov = _provedorImagem();
        const chave = prov === 'gemini' ? _chaveGoogle() : _chaveOpenAI();
        if (!chave) {
            showToast(prov === 'gemini'
                ? 'Configure a chave Google AI em AI Generations → API Keys'
                : 'Configure a chave OpenAI em AI Generations → API Keys', 'error');
            return;
        }

        _state.gerando = true;
        _renderFotos();
        try {
            const base = await _urlParaBlobPng(d.fotoBase);
            // O criativo validado entra como PIXEL, não só como texto. Sem ele
            // a composição era reinventada a partir da descrição — que era o
            // motivo de o resultado não parecer com a referência.
            const referencia = await _blobDoPadrao(padrao);
            const marca = _marcaDoProduto(pid);

            let prompt = montarPromptDoPadrao(padrao, pid);
            if (referencia) prompt = _instrucaoComposicao(marca) + prompt;
            try {
                const marcacoes = await _marcacoesDoProduto(pid, base);
                prompt += _instrucaoPreservacao(marcacoes, referencia ? 'the second image' : 'the input photo');
            } catch (e) {
                // Sem a transcrição a geração segue, só sem a trava extra —
                // melhor gerar sem a proteção do que travar a feature toda.
                console.warn('[Studio] não consegui transcrever as marcações do produto:', e.message);
            }
            // Ordem importa: o prompt fala em "first/second image".
            const blob = await _editarImagem(referencia ? [referencia, base] : [base], prompt, chave);

            const id = 'sf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
            const mediaId = 'studio_' + id;
            await MediaStore.put(mediaId, blob, { type: blob.type, name: `${padrao.id}.png` });
            const thumb = await _miniatura(blob);
            d.fotos.unshift({ id, mediaId, thumb, preset: padrao.id, presetLabel: padrao.nome,
                              prompt, padraoId: padrao.id, comReferencia: !!referencia,
                              criadoEm: new Date().toISOString() });
            padrao.usos = (padrao.usos || 0) + 1;
            _save();
            showToast(`Gerado com o padrão "${padrao.nome}"`, 'success');
        } catch (err) {
            showToast('Falha: ' + String(err.message).slice(0, 140), 'error');
        } finally {
            _state.gerando = false;
            _renderFotos();
            _renderPadroes();
        }
    }

    // ══════════════════════════════════════════════════════════════
    //  CLAUDE — gerador de página e copy interativo
    // ══════════════════════════════════════════════════════════════

    // Chave da OpenAI — mesma que o AI Ad Hub já usa.
    function _chaveOpenAI() {
        return (window.AIAdGenerator?._getOpenAIKey?.()) || localStorage.getItem('openai_api_key') || '';
    }
    function _chaveGoogle() {
        return (window.AIAdGenerator?._getGoogleKey?.()) || localStorage.getItem('google_ai_api_key') || '';
    }

    // Texto pela OpenAI. Mantive o nome _claude nas chamadas antigas via alias
    // para não espalhar mudança por todo o módulo.
    async function _openai(system, mensagens, maxTokens = 3000) {
        const key = _chaveOpenAI();
        if (!key) throw new Error('Configure a chave OpenAI (AI Generations → API Keys)');
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
            body: JSON.stringify({
                model: 'gpt-4o',
                max_tokens: maxTokens,
                temperature: 0.8,
                response_format: { type: 'json_object' },
                messages: [{ role: 'system', content: system }, ...mensagens],
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `HTTP ${res.status}`);
        }
        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    }
    const _claude = _openai;   // alias: o resto do módulo segue chamando _claude

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

    // ── Camada de MARCA: é o que separa uma loja com personalidade de um
    //    catálogo genérico. Define para QUEM se fala antes de escrever a copy.
    const SISTEMA_MARCA = `Você cria identidades de marca para lojas de e-commerce premium no Reino Unido, no padrão de marcas como Elliot Vaughn e THEMASTER: nome próprio ou palavra curta e memorável, tom refinado e confiante, zero linguagem de "promoção imperdível".

A marca precisa ser FOCADA num público específico — não "todo mundo que gosta de X", mas uma pessoa concreta com um desejo e uma objeção reais.

Responda APENAS com JSON válido, sem markdown e sem nada antes ou depois:
{"nome":"...","tagline":"...","publico":{"quem":"...","idade":"...","desejo":"...","objecao":"...","gatilho":"..."},"tom":{"adjetivos":["...","...","..."],"faca":["...","...","..."],"naoFaca":["...","...","..."]},"paleta":{"primaria":"#hex","fundo":"#hex","texto":"#hex","destaque":"#hex"},"historia":"..."}
- nome: 1 a 2 palavras, pronunciável em inglês, sem número e sem hífen
- tagline: até 45 caracteres
- publico.quem: uma frase descrevendo a pessoa (profissão, contexto de vida)
- publico.desejo: o que ela quer sentir ao usar o produto
- publico.objecao: a razão real pela qual ela hesitaria em comprar
- publico.gatilho: o momento em que ela decide comprar
- tom.faca / tom.naoFaca: instruções concretas de escrita
- paleta: cores que combinam com o posicionamento (fundo claro ou escuro, à sua escolha)
- historia: 2 frases sobre por que a marca existe (sem inventar fundador real, prêmios ou datas)`;

    const SISTEMA_PAGINA = `Você é um copywriter de resposta direta para páginas de produto de e-commerce premium no Reino Unido, no padrão de lojas como Elliot Vaughn e THEMASTER.

Escreva em INGLÊS BRITÂNICO. Tom refinado e específico: descreva materiais, ajuste e uso real. Nada de "amazing", "best ever", pontos de exclamação ou urgência falsa.

PROIBIDO: mencionar AliExpress, China, dropshipping ou prazo longo; inventar certificações, prêmios, número de clientes vendidos ou avaliações; prometer resultado de saúde.

Responda APENAS com JSON válido, sem markdown e sem nada antes ou depois:
{"hero":{"titulo":"...","subtitulo":"...","badges":["...","...","..."]},"variantes":[{"nome":"...","descricao":"..."}],"bullets":["...","...","...","...","..."],"especificacoes":[{"campo":"...","valor":"..."}],"detalhes":[{"titulo":"...","texto":"..."}],"ofertas":[{"rotulo":"...","detalhe":"..."}],"garantia":{"titulo":"...","texto":"..."},"envio":{"titulo":"...","texto":"..."},"faq":[{"p":"...","r":"..."}],"descricaoHtml":"<p>...</p>","cta":"..."}

- hero.titulo: até 60 caracteres, o produto e seu caráter (não um slogan)
- hero.badges: 3 a 4 selos TÉCNICOS e verificáveis (ex.: "UV400 Protection", "Polarised Lenses", "Comfort Fit")
- variantes: 4 a 5 cores/opções com NOMES EVOCATIVOS no padrão do mercado premium (ex.: "Amber Honey", "Sage Olive", "Onyx Black") — nunca "Marrom", "Verde", "Preto"
- bullets: exatamente 5, cada um abrindo pelo benefício concreto
- especificacoes: 4 a 6 pares campo/valor plausíveis para o produto (medidas, material, peso)
- detalhes: 3 a 4 blocos de artesanato/construção que viram acordeão (ex.: "The hinge", "The lens")
- ofertas: 1 a 2 ofertas por quantidade (ex.: "50% off the second pair")
- faq: 5 a 8 perguntas reais de quem hesita — endereçando diretamente a objeção do público
- descricaoHtml: HTML simples (só <p>, <h3>, <ul>, <li>, <strong>): problema, solução, construção, para quem é
- cta: 2 a 4 palavras`;

    // Resumo da marca injetado em todo prompt seguinte — é o que dá
    // personalidade consistente da copy à foto.
    function _contextoDeMarca(pid) {
        const m = _dados(pid).marca;
        if (!m) return '';
        return `\n\nMARCA E PÚBLICO (obedeça rigorosamente):
Marca: ${m.nome} — "${m.tagline}"
Público: ${m.publico?.quem} (${m.publico?.idade}). Quer: ${m.publico?.desejo}. Hesita porque: ${m.publico?.objecao}. Compra quando: ${m.publico?.gatilho}.
Tom: ${(m.tom?.adjetivos || []).join(', ')}.
FAÇA: ${(m.tom?.faca || []).join(' / ')}
NÃO FAÇA: ${(m.tom?.naoFaca || []).join(' / ')}`;
    }

    async function gerarMarca() {
        const pid = _state.productId;
        if (!pid) { showToast('Escolha um produto primeiro', 'error'); return; }

        const btn = document.getElementById('studio-gerar-marca');
        const orig = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i> Criando…'; }

        try {
            const publicoAlvo = (document.getElementById('studio-publico')?.value || '').trim();
            const prompt = `${_dossie(pid)}${_contextoDeAngulos(pid)}` +
                (publicoAlvo ? `\n\nO público que eu quero atingir: ${publicoAlvo}` : '') +
                `\n\nCrie a identidade da marca desta loja.`;
            const marca = _extrairJson(await _claude(SISTEMA_MARCA, [{ role: 'user', content: prompt }], 2000));

            const d = _dados(pid);
            d.marca = { ...marca, geradoEm: new Date().toISOString() };
            _save();
            _renderMarca();
            showToast(`Marca "${marca.nome}" criada`, 'success');
        } catch (err) {
            console.error('[Studio] gerarMarca:', err);
            showToast('Falha: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; _icones(); }
        }
    }

    async function gerarPagina() {
        const pid = _state.productId;
        if (!pid) { showToast('Escolha um produto primeiro', 'error'); return; }

        const btn = document.getElementById('studio-gerar-pagina');
        const orig = btn?.innerHTML;
        if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" style="width:14px;height:14px;animation:spin 1s linear infinite"></i> Gerando…'; }

        try {
            const prompt = `${_dossie(pid)}${_contextoDeMarca(pid)}${_contextoDeAngulos(pid)}\n\nEscreva a página de produto completa.`;
            const txt = await _claude(SISTEMA_PAGINA, [{ role: 'user', content: prompt }], 4000);
            const pagina = _extrairJson(txt);

            const d = _dados(pid);
            d.pagina = { ...pagina, geradoEm: new Date().toISOString() };
            d.chat = [];
            _save();
            _renderPagina();

            // Alimenta a biblioteca de copy para reuso em anúncios
            if (window.CopyLibrary?.add) {
                if (pagina.hero?.titulo) CopyLibrary.add('product_headline', pagina.hero.titulo, ['studio']);
                (pagina.bullets || []).forEach(b => CopyLibrary.add('product_bullet', b, ['studio']));
            }
            showToast('Página gerada', 'success');
        } catch (err) {
            console.error('[Studio] gerarPagina:', err);
            showToast('Falha: ' + err.message, 'error');
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = orig; _icones(); }
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

    function _corpoHtml(pagina, marca) {
        if (!pagina) return '';
        const partes = [];
        const esc = (x) => String(x ?? '');
        if (pagina.hero?.subtitulo) partes.push(`<p><strong>${esc(pagina.hero.subtitulo)}</strong></p>`);
        if (pagina.hero?.badges?.length) {
            partes.push('<p>' + pagina.hero.badges.map(b => `<strong>${esc(b)}</strong>`).join(' &middot; ') + '</p>');
        }
        if (pagina.bullets?.length) {
            partes.push('<ul>' + pagina.bullets.map(b => `<li>${esc(b)}</li>`).join('') + '</ul>');
        }
        if (pagina.descricaoHtml) partes.push(pagina.descricaoHtml);
        if (pagina.especificacoes?.length) {
            partes.push('<h3>Product details</h3><ul>' +
                pagina.especificacoes.map(e => `<li><strong>${esc(e.campo)}:</strong> ${esc(e.valor)}</li>`).join('') + '</ul>');
        }
        if (pagina.detalhes?.length) {
            partes.push('<h3>Craftsmanship</h3>' +
                pagina.detalhes.map(x => `<p><strong>${esc(x.titulo)}</strong><br>${esc(x.texto)}</p>`).join(''));
        }
        if (pagina.garantia) partes.push(`<h3>${esc(pagina.garantia.titulo || 'Our guarantee')}</h3><p>${esc(pagina.garantia.texto || '')}</p>`);
        if (pagina.envio) partes.push(`<h3>${esc(pagina.envio.titulo || 'Shipping & returns')}</h3><p>${esc(pagina.envio.texto || '')}</p>`);
        if (pagina.faq?.length) {
            partes.push('<h3>FAQ</h3>' + pagina.faq.map(f => `<p><strong>${esc(f.p)}</strong><br>${esc(f.r)}</p>`).join(''));
        }
        if (marca?.historia) partes.push(`<h3>About ${esc(marca.nome)}</h3><p>${esc(marca.historia)}</p>`);
        // Sem quebra de linha: mantém cada produto numa única linha do CSV.
        // Com \n o campo continua válido (fica entre aspas), mas qualquer
        // planilha ou editor mostra o arquivo picotado na hora de conferir.
        return partes.join('');
    }

    function exportarCsv() {
        const pid = _state.productId;
        const p = (AppState.allProducts || []).find(x => x.id === pid);
        if (!p) { showToast('Escolha um produto', 'error'); return; }
        const d = _dados(pid);
        if (!d.pagina) { showToast('Gere a página antes de exportar', 'error'); return; }

        const tituloPg = d.pagina.hero?.titulo || d.pagina.titulo || p.name;
        const handle = _handle(tituloPg);
        // Cabeçalho oficial de importação de produtos da Shopify
        const cols = ['Handle', 'Title', 'Body (HTML)', 'Vendor', 'Type', 'Tags', 'Published',
                      'Option1 Name', 'Option1 Value', 'Variant SKU', 'Variant Inventory Policy',
                      'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price',
                      'Variant Requires Shipping', 'Variant Taxable', 'Image Src', 'Image Position',
                      'Image Alt Text', 'Status'];

        const preco = Number(p.price) || 0;
        const linhas = [cols.join(',')];
        // Cada variante vira uma linha; a Shopify agrupa pelo mesmo Handle.
        const variantes = (d.pagina.variantes || []).map(v => v.nome).filter(Boolean);
        if (!variantes.length) variantes.push('Default Title');

        // Imagens: só URLs públicas entram no CSV. As fotos geradas por IA
        // vivem no IndexedDB (blob), que a Shopify não consegue buscar —
        // elas saem no ZIP separado para subir à mão.
        const imagensPublicas = _fontesDeImagem(pid)
            .filter(f => /^https?:/.test(f.url)).map(f => f.url).slice(0, 10);

        linhas.push([
            handle, tituloPg, _corpoHtml(d.pagina, d.marca), d.marca?.nome || p.vendor || '', p.type || '',
            'studio', 'TRUE', variantes.length > 1 ? 'Colour' : 'Title', variantes[0], p.sku || '', 'deny', 'manual',
            preco.toFixed(2), '', 'TRUE', 'TRUE',
            imagensPublicas[0] || '', imagensPublicas[0] ? '1' : '', tituloPg, 'draft',
        ].map(_csvCampo).join(','));

        // Demais variantes: só as colunas de variante são preenchidas
        variantes.slice(1).forEach(nome => {
            const l = new Array(cols.length).fill('');
            l[0] = handle; l[7] = 'Colour'; l[8] = nome;
            l[10] = 'deny'; l[11] = 'manual'; l[12] = preco.toFixed(2);
            l[14] = 'TRUE'; l[15] = 'TRUE'; l[19] = 'draft';
            linhas.push(l.map(_csvCampo).join(','));
        });

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

    // Cenários de referência = os criativos subidos (Padrões), usados como
    // ambiente. Globais — aparecem para qualquer produto. Filtráveis por nicho
    // (o "catálogo"): escolher "Óculos de Sol" mostra só os desse nicho.
    function _renderCenariosRef() {
        const bloco = document.getElementById('studio-cenarios-ref-bloco');
        const grid = document.getElementById('studio-cenarios-ref');
        const filtro = document.getElementById('studio-cenarios-ref-cat');
        if (!bloco || !grid || !filtro) return;

        const todos = _state.padroes || [];
        if (!todos.length) { bloco.style.display = 'none'; return; }
        bloco.style.display = '';

        const nichos = [...new Set(todos.map(p => p.nicho).filter(Boolean))].sort();
        const catAtual = filtro.value;
        filtro.innerHTML = '<option value="">Todas as categorias</option>'
            + nichos.map(n => `<option value="${_esc(n)}">${_esc(n)}</option>`).join('');
        filtro.value = nichos.includes(catAtual) ? catAtual : '';
        if (!filtro._ligado) {
            filtro.addEventListener('change', () => _renderCenariosRef());
            filtro._ligado = true;
        }

        const lista = filtro.value ? todos.filter(p => p.nicho === filtro.value) : todos;
        // Preserva o que já estava marcado antes do re-render (troca de filtro).
        const marcados = new Set([...grid.querySelectorAll('input:checked')].map(i => i.value));

        grid.innerHTML = lista.map(p => {
            const val = 'cen:' + p.id;
            const sub = [p.nicho, p.subnicho].filter(Boolean).join(' · ');
            return `
            <label class="studio-cenario-ref ${marcados.has(val) ? 'is-on' : ''}">
                <input type="checkbox" value="${val}"${marcados.has(val) ? ' checked' : ''}>
                ${p.exemploThumb ? `<img src="${_esc(p.exemploThumb)}" alt="" loading="lazy">` : '<span class="studio-cenario-ref-sem"></span>'}
                <span class="studio-cenario-ref-nome">${_esc(p.nome)}</span>
                ${sub ? `<span class="studio-cenario-ref-cat">${_esc(sub)}</span>` : ''}
            </label>`;
        }).join('');

        // O studio-presets é lido junto no gerar; estes checkboxes vivem em
        // outro container, então marca/desmarca precisa refletir a classe.
        grid.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('change', () => inp.closest('.studio-cenario-ref')?.classList.toggle('is-on', inp.checked));
        });
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
                <img src="${_esc(f.thumb)}" alt="${_esc(f.presetLabel || '')}" loading="lazy" data-expandir="${f.id}">
                <span class="studio-foto-tag">${_esc(f.presetLabel || f.preset)}</span>
                <div class="studio-foto-acoes">
                    <button class="btn-icon" data-acao="capa" data-id="${f.id}" title="Definir como capa do produto"><i data-lucide="image" style="width:13px;height:13px"></i></button>
                    <button class="btn-icon" data-acao="baixar" data-id="${f.id}" title="Baixar em resolução cheia"><i data-lucide="download" style="width:13px;height:13px"></i></button>
                    <button class="btn-icon" data-acao="criativo" data-id="${f.id}" title="Salvar em Meus Criativos"><i data-lucide="bookmark-plus" style="width:13px;height:13px"></i></button>
                    <button class="btn-icon" data-acao="excluir" data-id="${f.id}" title="Excluir"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                </div>
            </div>`).join('');
        _icones();

        box.querySelectorAll('button[data-acao]').forEach(b => {
            b.addEventListener('click', () => _acaoFoto(b.dataset.acao, b.dataset.id));
        });
        box.querySelectorAll('img[data-expandir]').forEach(img => {
            img.style.cursor = 'zoom-in';
            img.addEventListener('click', () => _abrirLightbox(img.dataset.expandir));
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

        } else if (acao === 'capa') {
            const p = (AppState.allProducts || []).find(x => x.id === _state.productId);
            if (!p) { showToast('Produto não encontrado', 'error'); return; }
            const rec = await MediaStore.get(f.mediaId);
            if (!rec?.blob) { showToast('Arquivo não encontrado', 'error'); return; }
            // O modelo de imagem do produto guarda base64 direto (dataUrl) — é o
            // mesmo formato de quando o usuário sobe uma foto manualmente. Uma
            // foto gerada por IA costuma vir grande (1024×1024+); comprime antes
            // de virar a capa, senão pesa demais no localStorage.
            let dataUrl;
            try {
                dataUrl = await comprimirImagemParaDataUrl(rec.blob, 1500, 0.9);
            } catch (e) {
                showToast('Falha ao preparar a imagem: ' + e.message, 'error');
                return;
            }
            p.images = p.images || [];
            p.images.unshift({ dataUrl, name: `${_handle(f.presetLabel || p.name)}.jpg` });
            if (typeof LocalStore !== 'undefined') LocalStore.save('products', AppState.allProducts);
            if (typeof EventBus !== 'undefined') EventBus.emit('productsChanged');
            showToast(`Definida como capa de "${p.name}"`, 'success');

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
        const m = d.marca;
        const capa = d.fotos[0]?.thumb || _fontesDeImagem(_state.productId)[0]?.url || '';
        const galeria = d.fotos.slice(0, 4).map(f => f.thumb);
        const p = (AppState.allProducts || []).find(x => x.id === _state.productId);
        // A paleta da marca é aplicada ao preview: é assim que se vê se a
        // personalidade ficou de pé, não só o texto.
        const pal = m?.paleta || {};
        const estilo = pal.fundo
            ? `--pdp-bg:${pal.fundo};--pdp-txt:${pal.texto || '#111'};--pdp-cor:${pal.primaria || '#111'};--pdp-dest:${pal.destaque || pal.primaria || '#111'}`
            : '';

        box.innerHTML = `
          <div class="studio-pdp-wrap" style="${estilo}">
            ${m ? `<div class="studio-pdp-marca"><strong>${_esc(m.nome)}</strong><span>${_esc(m.tagline || '')}</span></div>` : ''}
            <div class="studio-pdp">
                <div class="studio-pdp-media">
                    ${capa ? `<img class="studio-pdp-img" src="${_esc(capa)}" alt="">` : '<div class="studio-pdp-img studio-pdp-sem"><i data-lucide="image" style="width:26px;height:26px"></i></div>'}
                    ${galeria.length > 1 ? `<div class="studio-pdp-mini">${galeria.map(t => `<img src="${_esc(t)}" alt="">`).join('')}</div>` : ''}
                </div>
                <div class="studio-pdp-txt">
                    <h2>${_esc(pg.hero?.titulo || pg.titulo || '')}</h2>
                    ${pg.hero?.subtitulo ? `<p class="studio-pdp-sub">${_esc(pg.hero.subtitulo)}</p>` : ''}
                    ${p?.price ? `<div class="studio-pdp-preco">${formatCurrency(p.price, p.priceCurrency || 'GBP')}</div>` : ''}

                    ${pg.variantes?.length ? `<div class="studio-pdp-vars">
                        <label>Colour</label>
                        <div class="studio-pdp-var-lista">${pg.variantes.map((v, i) => `
                            <button type="button" class="studio-pdp-var${i === 0 ? ' ativa' : ''}" title="${_esc(v.descricao || '')}">${_esc(v.nome)}</button>`).join('')}</div>
                    </div>` : ''}

                    ${pg.ofertas?.length ? `<div class="studio-pdp-ofertas">${pg.ofertas.map(o => `
                        <div class="studio-pdp-oferta"><strong>${_esc(o.rotulo)}</strong><span>${_esc(o.detalhe || '')}</span></div>`).join('')}</div>` : ''}

                    ${pg.cta ? `<button class="studio-pdp-cta" disabled>${_esc(pg.cta)}</button>` : ''}

                    ${pg.hero?.badges?.length ? `<div class="studio-pdp-badges">${pg.hero.badges.map(b => `
                        <span><i data-lucide="check" style="width:11px;height:11px"></i> ${_esc(b)}</span>`).join('')}</div>` : ''}

                    ${pg.bullets?.length ? `<ul class="studio-pdp-bullets">${pg.bullets.map(b => `<li>${_esc(b)}</li>`).join('')}</ul>` : ''}

                    ${pg.garantia ? `<p class="studio-pdp-garantia"><i data-lucide="shield-check" style="width:13px;height:13px;vertical-align:-2px"></i> <strong>${_esc(pg.garantia.titulo || '')}</strong> ${_esc(pg.garantia.texto || '')}</p>` : ''}
                    ${pg.envio ? `<p class="studio-pdp-garantia"><i data-lucide="truck" style="width:13px;height:13px;vertical-align:-2px"></i> <strong>${_esc(pg.envio.titulo || '')}</strong> ${_esc(pg.envio.texto || '')}</p>` : ''}
                </div>
            </div>

            ${pg.especificacoes?.length ? `<div class="studio-pdp-bloco"><h3>Product details</h3>
                <table class="studio-pdp-specs">${pg.especificacoes.map(e => `
                    <tr><td>${_esc(e.campo)}</td><td>${_esc(e.valor)}</td></tr>`).join('')}</table></div>` : ''}

            ${pg.detalhes?.length ? `<div class="studio-pdp-bloco"><h3>Craftsmanship</h3>
                ${pg.detalhes.map(x => `<details><summary>${_esc(x.titulo)}</summary><p>${_esc(x.texto)}</p></details>`).join('')}</div>` : ''}

            <div class="studio-pdp-desc">${pg.descricaoHtml || ''}</div>

            ${pg.faq?.length ? `<div class="studio-pdp-bloco"><h3>FAQ</h3>${pg.faq.map(f => `
                <details><summary>${_esc(f.p)}</summary><p>${_esc(f.r)}</p></details>`).join('')}</div>` : ''}
          </div>`;
        _icones();
    }

    function _renderPadroes() {
        const box = document.getElementById('studio-padroes');
        if (!box) return;
        const todos = _state.padroes || [];

        // Filtro por nicho — só faz sentido mostrar quando existe mais de um.
        const filtroSel = document.getElementById('studio-padroes-filtro-nicho');
        const filtroBox = filtroSel?.closest('.studio-padroes-filtro');
        const nichos = [...new Set(todos.map(p => p.nicho).filter(Boolean))].sort();
        if (filtroSel) {
            const atual = filtroSel.value;
            filtroSel.innerHTML = '<option value="">Todos os nichos</option>'
                + nichos.map(n => `<option value="${_esc(n)}">${_esc(n)}</option>`).join('');
            filtroSel.value = nichos.includes(atual) ? atual : '';
            if (filtroBox) filtroBox.style.display = nichos.length > 1 ? '' : 'none';
            if (!filtroSel._ligado) {
                filtroSel.addEventListener('change', () => _renderPadroes());
                filtroSel._ligado = true;
            }
        }
        const lista = filtroSel?.value ? todos.filter(p => p.nicho === filtroSel.value) : todos;

        if (!todos.length) {
            box.innerHTML = `<p class="studio-vazio">Nenhum padrão ainda. Suba um criativo que já validou — a IA lê a imagem e escreve o prompt que a gerou, trocando marca e produto por marcadores. Depois é só aplicar esse mesmo enquadramento a qualquer outro produto.</p>`;
            return;
        }
        if (!lista.length) {
            box.innerHTML = `<p class="studio-vazio">Nenhum padrão no nicho "${_esc(filtroSel.value)}".</p>`;
            return;
        }
        box.innerHTML = lista.map(p => `
            <div class="studio-padrao" data-id="${p.id}">
                ${p.exemploThumb ? `<img src="${_esc(p.exemploThumb)}" alt="" loading="lazy">` : '<div class="studio-padrao-sem"><i data-lucide="image" style="width:18px;height:18px"></i></div>'}
                <div class="studio-padrao-info">
                    <strong>${_esc(p.nome)}</strong>
                    ${p.nicho ? `<span class="studio-padrao-nicho"><i data-lucide="tag" style="width:11px;height:11px;vertical-align:-1px"></i> ${_esc(p.nicho)}${p.subnicho ? ' — ' + _esc(p.subnicho) : ''}</span>` : ''}
                    <small>${_esc(p.observacao || '')}</small>
                    <span class="studio-padrao-tags">
                        ${(p.marcadores || []).map(m => `<em>${_esc(m.replace(/[{}]/g, ''))}</em>`).join('')}
                        ${p.usos ? `<em class="studio-padrao-usos">${p.usos}× usado</em>` : ''}
                    </span>
                </div>
                <div class="studio-padrao-acoes">
                    <button class="btn btn-primary btn-sm" data-usar="${p.id}" title="Gerar uma foto deste produto usando este padrão">Aplicar</button>
                    <button class="btn-icon" data-ver="${p.id}" title="Ver o prompt gerado"><i data-lucide="file-text" style="width:13px;height:13px"></i></button>
                    <button class="btn-icon" data-del-padrao="${p.id}" title="Excluir padrão"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                </div>
            </div>`).join('');
        _icones();

        box.querySelectorAll('[data-usar]').forEach(b =>
            b.addEventListener('click', () => gerarComPadrao(b.dataset.usar)));
        box.querySelectorAll('[data-ver]').forEach(b =>
            b.addEventListener('click', () => _verPrompt(b.dataset.ver)));
        box.querySelectorAll('[data-del-padrao]').forEach(b =>
            b.addEventListener('click', async () => {
                const p = (_state.padroes || []).find(x => x.id === b.dataset.delPadrao);
                if (!p || !confirm(`Excluir o padrão "${p.nome}"?`)) return;
                if (p.exemploMediaId && window.MediaStore?.isSupported?.()) {
                    try { await MediaStore.del(p.exemploMediaId); } catch {}
                }
                _state.padroes = _state.padroes.filter(x => x.id !== p.id);
                _save(); _renderPadroes(); _renderCenariosRef();
            }));
    }

    // Mostra o esqueleto e como ele fica preenchido para o produto atual —
    // sem isso o padrão é uma caixa-preta e não dá para corrigir nada.
    function _verPrompt(padraoId) {
        const p = (_state.padroes || []).find(x => x.id === padraoId);
        if (!p) return;
        const preenchido = _state.productId ? montarPromptDoPadrao(p, _state.productId) : '';
        const html = `
            <div id="modal-padrao-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center">
                <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:1.25rem;width:min(720px,94vw);max-height:88vh;overflow:auto;display:flex;flex-direction:column;gap:0.85rem">
                    <strong style="font-size:1rem">${_esc(p.nome)}</strong>
                    <div>
                        <label style="font-size:0.75rem;font-weight:600;color:var(--text-secondary)">Esqueleto (com marcadores)</label>
                        <pre class="studio-prompt-pre">${_esc(p.esqueleto)}</pre>
                    </div>
                    ${preenchido ? `<div>
                        <label style="font-size:0.75rem;font-weight:600;color:var(--text-secondary)">Como fica para o produto selecionado</label>
                        <pre class="studio-prompt-pre">${_esc(preenchido)}</pre>
                    </div>` : '<p class="studio-vazio">Selecione um produto para ver o prompt preenchido.</p>'}
                    <div style="display:flex;gap:0.5rem;justify-content:flex-end">
                        <button id="padrao-copiar" class="btn btn-secondary btn-sm">Copiar esqueleto</button>
                        <button id="padrao-fechar" class="btn btn-primary btn-sm">Fechar</button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', html);
        const ov = document.getElementById('modal-padrao-overlay');
        const fechar = () => ov?.remove();
        document.getElementById('padrao-fechar')?.addEventListener('click', fechar);
        ov?.addEventListener('click', e => { if (e.target === ov) fechar(); });
        document.getElementById('padrao-copiar')?.addEventListener('click', () => {
            navigator.clipboard.writeText(p.esqueleto);
            showToast('Esqueleto copiado', 'success');
        });
    }

    async function _subirPadrao(file) {
        if (!file) return;
        const status = document.getElementById('studio-padrao-status');
        const nome = (document.getElementById('studio-padrao-nome')?.value || '').trim();
        const nicho = (document.getElementById('studio-padrao-nicho')?.value || '').trim();
        const subnicho = (document.getElementById('studio-padrao-subnicho')?.value || '').trim();
        if (status) status.innerHTML = '<i data-lucide="loader-2" style="width:13px;height:13px;animation:spin 1s linear infinite"></i> Analisando o criativo…';
        _icones();
        try {
            const p = await criarPadraoDeImagem(file, nome, nicho, subnicho);
            ['studio-padrao-nome', 'studio-padrao-nicho', 'studio-padrao-subnicho'].forEach(id => {
                const campo = document.getElementById(id);
                if (campo) campo.value = '';
            });
            if (status) status.textContent = '';
            _renderPadroes(); _renderCenariosRef();
            showToast(`Padrão "${p.nome}" criado a partir do criativo.`, 'success');
        } catch (err) {
            if (status) status.textContent = '';
            showToast('Falha: ' + (err.message || err), 'error');
        }
    }

    function _renderMarca() {
        const box = document.getElementById('studio-marca');
        if (!box) return;
        const m = _dados(_state.productId).marca;
        if (!m) {
            box.innerHTML = `<p class="studio-vazio">Sem marca definida. Descreva o público (ou deixe em branco) e clique em "Criar marca" — nome, tom de voz e paleta saem daqui e comandam toda a copy e as fotos.</p>`;
            return;
        }
        const pal = m.paleta || {};
        box.innerHTML = `
            <div class="studio-marca-topo">
                <div>
                    <strong class="studio-marca-nome">${_esc(m.nome)}</strong>
                    <span class="studio-marca-tag">${_esc(m.tagline || '')}</span>
                </div>
                <div class="studio-marca-cores">
                    ${['primaria', 'destaque', 'fundo', 'texto'].filter(k => pal[k]).map(k =>
                        `<span title="${k}: ${_esc(pal[k])}" style="background:${_esc(pal[k])}"></span>`).join('')}
                </div>
            </div>
            <div class="studio-marca-grid">
                <div><label>Público</label><p>${_esc(m.publico?.quem || '')} ${m.publico?.idade ? `(${_esc(m.publico.idade)})` : ''}</p></div>
                <div><label>Quer</label><p>${_esc(m.publico?.desejo || '')}</p></div>
                <div><label>Hesita porque</label><p>${_esc(m.publico?.objecao || '')}</p></div>
                <div><label>Compra quando</label><p>${_esc(m.publico?.gatilho || '')}</p></div>
            </div>
            <div class="studio-marca-tom">
                ${(m.tom?.adjetivos || []).map(a => `<span class="studio-angulo">${_esc(a)}</span>`).join('')}
            </div>`;
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
        _renderAngulos(); _renderMarca(); _renderFontes(); _renderPresets(); _renderPadroes(); _renderCenariosRef();
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
            // Presets de texto E cenários de referência (containers separados).
            const ids = [...document.querySelectorAll('#studio-presets input:checked, #studio-cenarios-ref input:checked')]
                .map(i => i.value);
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

        const selProv = document.getElementById('studio-img-provider');
        if (selProv) {
            selProv.value = localStorage.getItem('studio_img_provider') || 'openai';
            selProv.addEventListener('change', () => localStorage.setItem('studio_img_provider', selProv.value));
        }
        document.getElementById('studio-gerar-marca')?.addEventListener('click', () => gerarMarca());
        document.getElementById('studio-padrao-pick')?.addEventListener('click', () => document.getElementById('studio-padrao-input')?.click());
        document.getElementById('studio-padrao-input')?.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) _subirPadrao(f);
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

        // Lightbox das fotos geradas — mesmo padrão de fechar do lightbox de Criativos.
        document.getElementById('studio-lightbox-close')?.addEventListener('click', _fecharLightbox);
        document.getElementById('studio-media-lightbox')?.addEventListener('click', (e) => {
            if (e.target.id === 'studio-media-lightbox') _fecharLightbox();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('studio-media-lightbox')?.style.display === 'flex') _fecharLightbox();
        });
    }

    let _lightboxUrl = null;

    // Mostra a foto em resolução cheia (a grade só tem a miniatura webp). A
    // imagem real fica no IndexedDB — busca pelo mediaId na hora do clique.
    async function _abrirLightbox(fotoId) {
        const d = _dados(_state.productId);
        const f = (d.fotos || []).find(x => x.id === fotoId);
        if (!f) return;
        const box = document.getElementById('studio-media-lightbox');
        const body = document.getElementById('studio-lightbox-body');
        const cap = document.getElementById('studio-lightbox-caption');
        if (!box || !body) return;
        if (cap) cap.textContent = f.presetLabel || f.preset || '';
        body.innerHTML = '<div class="creative-lightbox-loading">Carregando…</div>';
        box.style.display = 'flex';

        if (_lightboxUrl) { try { URL.revokeObjectURL(_lightboxUrl); } catch {} _lightboxUrl = null; }
        const url = f.mediaId ? await MediaStore.getObjectUrl(f.mediaId) : '';
        const src = url || f.thumb;
        if (!src) { body.innerHTML = '<div class="creative-lightbox-loading">Sem imagem salva.</div>'; return; }
        if (url) _lightboxUrl = url;
        body.innerHTML = `<img src="${_esc(src)}" alt="${_esc(f.presetLabel || '')}" style="max-width:100%;max-height:80vh;border-radius:10px">`;
    }

    function _fecharLightbox() {
        const box = document.getElementById('studio-media-lightbox');
        const body = document.getElementById('studio-lightbox-body');
        if (body) body.innerHTML = '';
        if (box) box.style.display = 'none';
        if (_lightboxUrl) { try { URL.revokeObjectURL(_lightboxUrl); } catch {} _lightboxUrl = null; }
    }

    return {
        STORAGE_KEY, PRESETS_FOTO, _state,
        init, render,
        getTopAngles, _contextoDeAngulos, _fontesDeImagem, _dossie,
        gerarFotos, gerarMarca, gerarPagina, enviarChat, exportarCsv, _contextoDeMarca,
        _dados, _save, _load, _miniatura, _urlParaBlobPng, _editarImagem,
        _claude, _extrairJson, _corpoHtml, _handle,
        _renderFotos, _renderPagina, _renderChat, _renderAngulos, _renderMarca, _selecionarProduto,
        criarPadraoDeImagem, montarPromptDoPadrao, gerarComPadrao, _renderPadroes, MARCADORES,
    };
})();

window.StudioModule = StudioModule;
document.addEventListener('DOMContentLoaded', () => StudioModule.init());
