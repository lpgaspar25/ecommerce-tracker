/* ==============================================================
   Gerar Modelo — cria fotos da MESMA pessoa em vários ângulos e zooms.

   O usuário sobe 1+ fotos de um modelo; a ferramenta gera novas fotos
   dessa mesma pessoa nos ângulos/enquadramentos que ele marcar.

   Por que mandar TODAS as fotos de referência: a doc dos dois provedores
   (ver memória apis-geracao-imagem) confirma multi-imagem — OpenAI aceita
   até 16 em `image[]`, Gemini aceita várias parts. Quanto mais ângulos da
   mesma pessoa o modelo vê, mais fiel fica o rosto. Não existe campo pra
   dizer "isto é o sujeito": o papel de cada imagem vai no TEXTO do prompt.

   Armazenamento espelha o RefBank: blob pesado no IndexedDB (MediaStore),
   índice leve (thumb + metadados) no localStorage — nunca base64 grande no
   localStorage, que estoura a cota. Chaveado por loja.

   O modelo é salvo automaticamente na PRIMEIRA geração bem-sucedida: as
   imagens são pagas, perder por falta de "salvar" seria inaceitável.
   ============================================================== */

const ModelGenModule = (() => {
    const TAB = 'gerar-modelo';
    const INDEX_KEY = 'etracker_modelos';
    const CFG_KEY = 'etracker_modelgen_cfg';
    const BANCO_KEY = 'etracker_mg_banco';   // cenários e roupas do usuário
    const MAX_REFS = 8;   // OpenAI aceita 16, mas acima de ~8 só encarece

    // ── Ângulos de câmera (pessoa, não produto) ──
    const ANGULOS = [
        { id: 'frontal', label: 'Frontal', icone: 'user',
          instrucao: 'Camera angle: straight-on frontal view at eye level; the person faces the camera directly.' },
        { id: '3-4-esq', label: '3/4 esquerdo', icone: 'user',
          instrucao: "Camera angle: three-quarter view from the person's front-left; head and body turned roughly 45 degrees away from the lens." },
        { id: '3-4-dir', label: '3/4 direito', icone: 'user',
          instrucao: "Camera angle: three-quarter view from the person's front-right; head and body turned roughly 45 degrees away from the lens." },
        { id: 'perfil-esq', label: 'Perfil esquerdo', icone: 'user',
          instrucao: 'Camera angle: full left side profile, 90 degrees to the camera.' },
        { id: 'perfil-dir', label: 'Perfil direito', icone: 'user',
          instrucao: 'Camera angle: full right side profile, 90 degrees to the camera.' },
        { id: 'costas', label: 'De costas', icone: 'rotate-3d',
          instrucao: 'Camera angle: shot from directly behind the person, showing the back; the face is not visible.' },
        { id: 'baixo', label: 'De baixo', icone: 'move-up',
          instrucao: 'Camera angle: low angle, camera positioned below eye level looking slightly upward at the person.' },
        { id: 'cima', label: 'De cima', icone: 'move-down',
          instrucao: 'Camera angle: high angle, camera positioned above eye level looking slightly down at the person.' },
    ];

    // ── Enquadramentos (o "zoom") ──
    const ENQUADRAMENTOS = [
        { id: 'close', label: 'Close (rosto)', dica: 'Rosto preenchendo o quadro',
          instrucao: 'Framing: tight close-up portrait — the face fills most of the frame, cropped just below the chin and above the hair.' },
        { id: 'busto', label: 'Busto', dica: 'Cabeça e ombros',
          instrucao: 'Framing: bust shot — head and shoulders portrait, cropped at mid-chest.' },
        { id: 'meio', label: 'Meio corpo', dica: 'Da cintura pra cima',
          instrucao: 'Framing: medium shot — the person framed from the waist up.' },
        { id: 'americano', label: 'Plano americano', dica: 'Da coxa pra cima',
          instrucao: 'Framing: American shot — the person framed from mid-thigh up.' },
        { id: 'inteiro', label: 'Corpo inteiro', dica: 'Cabeça aos pés',
          instrucao: 'Framing: full-body shot — the entire person visible from head to feet, with a little margin around them.' },
    ];

    // ── Cenários / fundos predefinidos ──
    // "paris" é o street style do print de referência: parede de pedra clara,
    // calçada estreita, luz natural — o fundo que mais aparece em criativo de
    // moda/acessório que viraliza.
    const CENARIOS = [
        { id: 'manter', label: 'Manter o da foto', dica: 'Não muda o cenário',
          instrucao: 'Keep a background consistent with the reference photos.' },
        { id: 'paris', label: 'Rua parisiense', dica: 'Pedra clara, street style',
          instrucao: 'Location: a narrow European city street (Parisian style) — a pale cream limestone building wall with visible block seams, a white painted door or shutter, and a stone pavement. Candid street-style photograph in soft natural daylight, shot from across the street.' },
        { id: 'estudio', label: 'Estúdio neutro', dica: 'Cinza liso',
          instrucao: 'Background: seamless neutral light-grey photography studio backdrop with soft, even studio lighting.' },
        { id: 'branco', label: 'Fundo branco', dica: 'Catálogo',
          instrucao: 'Background: clean seamless pure white studio background with bright, even lighting.' },
        { id: 'loft', label: 'Loft minimalista', dica: 'Interior claro',
          instrucao: 'Location: a bright minimalist interior with plain off-white walls, warm wooden floor and soft window light falling across the person.' },
        { id: 'cafe', label: 'Café / bistrô', dica: 'Mesa europeia',
          instrucao: 'Location: a charming European café terrace with small bistro tables and chairs, warm natural light, softly blurred background.' },
        { id: 'urbano', label: 'Urbano moderno', dica: 'Vidro e concreto',
          instrucao: 'Location: a modern city setting with glass and concrete architecture, clean lines, natural daylight, softly blurred background.' },
        { id: 'natureza', label: 'Natureza / parque', dica: 'Verde desfocado',
          instrucao: 'Location: an outdoor park with greenery and trees, natural daylight, background softly blurred with shallow depth of field.' },
        { id: 'praia', label: 'Praia / costa', dica: 'Luz dourada',
          instrucao: 'Location: a coastal setting with sand and sea, warm golden-hour sunlight, soft natural haze.' },
        { id: 'quarto', label: 'Quarto aconchegante', dica: 'Luz suave',
          instrucao: 'Location: a cosy, tastefully decorated bedroom or living room with soft diffused daylight and neutral tones.' },
        { id: 'noite', label: 'Cidade à noite', dica: 'Luzes desfocadas',
          instrucao: 'Location: a city street at night, warm bokeh from shop windows and street lights behind the person, cinematic low-light look.' },
    ];

    // ── Roupas / looks predefinidos ──
    const ROUPAS = [
        { id: 'manter', label: 'Manter a da foto', dica: 'Mesma roupa',
          instrucao: 'Keep exactly the same clothing, outfit and accessories as in the reference photos.' },
        { id: 'casual-chic', label: 'Casual chic', dica: 'Camisa branca + calça preta',
          instrucao: 'Outfit: an oversized crisp white shirt or shirt-jacket worn loose, with high-waisted wide-leg black trousers and minimal flat sandals.' },
        { id: 'basico', label: 'Básico', dica: 'Camiseta + jeans',
          instrucao: 'Outfit: a plain well-fitted white t-shirt with classic blue jeans and simple white sneakers.' },
        { id: 'social', label: 'Social / alfaiataria', dica: 'Blazer',
          instrucao: 'Outfit: a tailored blazer over a simple top with matching tailored trousers, polished and professional.' },
        { id: 'streetwear', label: 'Streetwear', dica: 'Moletom + jeans',
          instrucao: 'Outfit: an oversized hoodie or sweatshirt with relaxed denim and chunky sneakers, casual street style.' },
        { id: 'verao', label: 'Verão', dica: 'Vestido leve',
          instrucao: 'Outfit: a light flowing summer dress in a neutral tone, with simple sandals.' },
        { id: 'fitness', label: 'Fitness', dica: 'Legging + top',
          instrucao: 'Outfit: matching athletic leggings and a fitted sports top, clean modern activewear.' },
        { id: 'noite', label: 'Noite / festa', dica: 'Elegante',
          instrucao: 'Outfit: an elegant evening outfit in a dark refined tone, styled for a night out.' },
        { id: 'inverno', label: 'Inverno', dica: 'Casaco + tricô',
          instrucao: 'Outfit: a structured wool coat over a knitted sweater, with long trousers and boots.' },
    ];

    const FORMATOS = [
        { id: '4x5', label: 'Retrato 4:5', w: 1080, h: 1350, ar: '4:5' },
        { id: '1x1', label: 'Quadrado 1:1', w: 1080, h: 1080, ar: '1:1' },
        { id: '9x16', label: 'Story 9:16', w: 1080, h: 1920, ar: '9:16' },
        { id: '3x4', label: 'Clássico 3:4', w: 1080, h: 1440, ar: '3:4' },
    ];

    // Combos prontos — evita o usuário marcar 40 imagens sem querer.
    const PACKS = {
        essencial: { angulos: ['frontal', '3-4-esq', '3-4-dir'], zooms: ['busto', 'inteiro'], cenarios: ['estudio'], roupas: ['manter'] },
        catalogo: { angulos: ['frontal', '3-4-esq', '3-4-dir', 'perfil-esq', 'costas'], zooms: ['busto', 'meio', 'inteiro'], cenarios: ['branco'], roupas: ['manter'] },
        rosto: { angulos: ['frontal', '3-4-esq', '3-4-dir', 'perfil-esq', 'perfil-dir'], zooms: ['close'], cenarios: ['estudio'], roupas: ['manter'] },
        // "Street style": o formato do criativo de referência — mesma modelo
        // andando na rua, corpo inteiro e plano americano, vários looks.
        street: { angulos: ['perfil-esq', '3-4-esq', 'frontal'], zooms: ['inteiro', 'americano'], cenarios: ['paris'], roupas: ['casual-chic'] },
    };

    const _state = {
        refs: [],            // { id, blob, thumb, nome }
        modeloId: null,      // id do modelo salvo (criado na 1ª geração)
        fotos: [],           // fotos do modelo atual (do índice)
        angulos: new Set(['frontal', '3-4-esq', '3-4-dir']),
        zooms: new Set(['busto', 'inteiro']),
        cenarios: new Set(['estudio']),
        roupas: new Set(['manter']),
        gerando: false,
        progresso: { feito: 0, total: 0, atual: '' },
        inited: false,
    };

    let _cfg = { formato: '4x5', extra: '' };

    // ══════════════════════════════════════════════════════════
    //  Persistência (índice leve no localStorage, blob no IndexedDB)
    // ══════════════════════════════════════════════════════════

    function _storeId() {
        return (typeof getWritableStoreId === 'function' ? getWritableStoreId() : '') || '_global';
    }
    function _index() {
        try { return JSON.parse(localStorage.getItem(INDEX_KEY) || '{}'); } catch { return {}; }
    }
    function _saveIndex(ix) {
        const gravar = () => localStorage.setItem(INDEX_KEY, JSON.stringify(ix));
        try {
            if (window.StorageManager?.withReclaim) StorageManager.withReclaim(gravar);
            else gravar();
        } catch (e) {
            console.warn('[GerarModelo] índice não salvou:', e.message);
            if (typeof showToast === 'function') showToast('Armazenamento cheio — não consegui salvar o modelo.', 'error');
        }
    }
    function listModelos() {
        const arr = _index()[_storeId()] || [];
        return arr.slice().sort((a, b) => String(b.criadoEm || '').localeCompare(String(a.criadoEm || '')));
    }
    function _modelo(id) {
        return (_index()[_storeId()] || []).find(m => m.id === id) || null;
    }
    function _gravarModelo(rec) {
        const ix = _index();
        const sid = _storeId();
        ix[sid] = ix[sid] || [];
        const i = ix[sid].findIndex(m => m.id === rec.id);
        if (i >= 0) ix[sid][i] = rec; else ix[sid].unshift(rec);
        _saveIndex(ix);
    }
    function _loadCfg() {
        try { _cfg = { ..._cfg, ...(JSON.parse(localStorage.getItem(CFG_KEY) || '{}')) }; } catch {}
    }
    function _saveCfg() {
        try { localStorage.setItem(CFG_KEY, JSON.stringify(_cfg)); } catch {}
    }

    // ── Banco do usuário: cenários e roupas próprios, reutilizáveis entre
    //    modelos. Mesma regra: thumb no localStorage, blob no IndexedDB.
    function _banco() {
        let b;
        try { b = JSON.parse(localStorage.getItem(BANCO_KEY) || '{}'); } catch { b = {}; }
        const sid = _storeId();
        b[sid] = b[sid] || { cenarios: [], roupas: [] };
        b[sid].cenarios = b[sid].cenarios || [];
        b[sid].roupas = b[sid].roupas || [];
        return { todo: b, meu: b[sid] };
    }
    function _saveBanco(todo) {
        const gravar = () => localStorage.setItem(BANCO_KEY, JSON.stringify(todo));
        try {
            if (window.StorageManager?.withReclaim) StorageManager.withReclaim(gravar);
            else gravar();
        } catch (e) { console.warn('[GerarModelo] banco não salvou:', e.message); }
    }
    function cenariosCustom() { return _banco().meu.cenarios; }
    function roupasCustom() { return _banco().meu.roupas; }

    // Cenário próprio = uma FOTO do lugar. Vai como imagem de referência
    // extra na geração (o papel dela é explicado no texto do prompt).
    async function _addCenarioCustom(file, rotulo) {
        const { blob } = await comprimirImagem(file, 1400, 0.9, { formato: 'image/webp' });
        const thumb = await comprimirImagemParaDataUrl(blob, 200, 0.6, { formato: 'image/webp' });
        const id = 'cc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const mediaId = 'mgcen_' + id;
        await MediaStore.put(mediaId, blob, { type: blob.type || 'image/webp' });
        const { todo, meu } = _banco();
        meu.cenarios.unshift({ id, label: rotulo || 'Meu cenário', mediaId, thumb, criadoEm: new Date().toISOString() });
        _saveBanco(todo);
        return id;
    }

    // Roupa própria: descrição em texto e/ou foto da peça (serve pra bolsa,
    // óculos, qualquer item que a modelo deva usar/carregar).
    async function _addRoupaCustom({ texto, file, rotulo }) {
        const id = 'rc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        let mediaId = '', thumb = '';
        if (file) {
            const { blob } = await comprimirImagem(file, 1200, 0.9, { formato: 'image/webp' });
            thumb = await comprimirImagemParaDataUrl(blob, 200, 0.6, { formato: 'image/webp' });
            mediaId = 'mgrou_' + id;
            await MediaStore.put(mediaId, blob, { type: blob.type || 'image/webp' });
        }
        const { todo, meu } = _banco();
        meu.roupas.unshift({
            id, label: rotulo || (texto ? texto.slice(0, 28) : 'Minha roupa'),
            texto: texto || '', mediaId, thumb, criadoEm: new Date().toISOString(),
        });
        _saveBanco(todo);
        return id;
    }

    async function _removerCustom(tipo, id) {
        const { todo, meu } = _banco();
        const arr = tipo === 'cen' ? meu.cenarios : meu.roupas;
        const rec = arr.find(x => x.id === id);
        if (rec?.mediaId) { try { await MediaStore.del(rec.mediaId); } catch {} }
        if (tipo === 'cen') meu.cenarios = arr.filter(x => x.id !== id);
        else meu.roupas = arr.filter(x => x.id !== id);
        _saveBanco(todo);
        _state.cenarios.delete(id); _state.roupas.delete(id);
        render();
    }

    // Resolve um id (predefinido ou custom) para o objeto usado na geração.
    function _cenarioPorId(id) {
        const fixo = CENARIOS.find(c => c.id === id);
        if (fixo) return { ...fixo, custom: false };
        const c = cenariosCustom().find(x => x.id === id);
        return c ? { id: c.id, label: c.label, mediaId: c.mediaId, custom: true } : null;
    }
    function _roupaPorId(id) {
        const fixa = ROUPAS.find(r => r.id === id);
        if (fixa) return { ...fixa, custom: false };
        const r = roupasCustom().find(x => x.id === id);
        return r ? { id: r.id, label: r.label, texto: r.texto, mediaId: r.mediaId, custom: true } : null;
    }

    // ══════════════════════════════════════════════════════════
    //  Prompt — a trava de identidade é o coração da feature
    // ══════════════════════════════════════════════════════════

    // Monta o prompt de UM take. `refFundo`/`refRoupa` indicam se há foto de
    // cenário/roupa junto — nesse caso o TEXTO precisa dizer o papel de cada
    // imagem, porque nenhuma das duas APIs tem campo pra isso (a doc manda
    // separar por texto, e no Gemini as imagens vêm na ordem enviada).
    function _promptDe(angulo, zoom, cenario, roupa, refFundo, refRoupa) {
        cenario = cenario || CENARIOS[0];
        roupa = roupa || ROUPAS[0];

        // A ordem aqui TEM que ser a mesma em que os blobs são enviados.
        const papeis = [];
        let n = 0;
        if (refFundo) { n++; papeis.push(`IMAGE ${n} is a LOCATION reference: reproduce this place, its architecture, materials, colours and lighting as the background of the new photo. Do NOT copy any person from it.`); }
        if (refRoupa) { n++; papeis.push(`IMAGE ${n} is a GARMENT/ITEM reference: the person must wear or carry this exact item, keeping its shape, colour, material, hardware and any branding identical.`); }
        const refsTxt = n
            ? `You are given ${n + 1}+ reference images. ${papeis.join(' ')} ALL THE REMAINING IMAGES show the SAME person — that person is the subject of the new photograph.`
            : 'Using the provided reference photo(s), which all show the SAME person, generate ONE new photorealistic photograph of that exact same person.';

        const roupaTxt = roupa.custom
            ? (refRoupa
                ? (roupa.texto ? `Outfit: ${roupa.texto}.` : 'Dress the person in the referenced garment/item.')
                : `Outfit: ${roupa.texto || roupa.label}.`)
            : roupa.instrucao;
        const cenarioTxt = cenario.custom
            ? 'Place the person naturally in the referenced location, with lighting and perspective that match that place.'
            : cenario.instrucao;
        // Trocar a roupa não pode virar licença pra mudar o corpo/rosto.
        const guardaRoupa = roupa.id === 'manter' ? '' : " Changing the outfit must NOT change the person's face, hair, skin tone or body proportions.";

        return [
            refsTxt,
            // Identidade: o modelo "embeleza" por padrão — é preciso proibir explicitamente.
            'IDENTITY LOCK — the person must be instantly recognisable as the same individual:'
            + ' keep the same face shape and bone structure, the same eyes (shape and colour), eyebrows, nose, lips, jawline and ears,'
            + ' the same skin tone and complexion including freckles, moles, scars and skin texture,'
            + ' the same hair colour, length and hairstyle, the same facial hair, the same body type and build,'
            + ' and the same apparent age, gender and ethnicity.'
            + ' Do NOT beautify, slim down, de-age, smooth the skin or idealise the face. Do NOT invent a different or merely similar-looking person.',
            roupaTxt + guardaRoupa,
            angulo.instrucao,
            zoom.instrucao,
            cenarioTxt,
            'Photorealistic photography with natural skin texture and visible pores, realistic lighting and shadows, sharp focus on the subject, professional camera look.',
            'Output a single clean photograph: no collage, no grid, no split panels, no borders, no text, no captions, no watermark and no logo.',
            String(_cfg.extra || '').trim(),
        ].filter(Boolean).join(' ');
    }

    // ══════════════════════════════════════════════════════════
    //  Referências (upload)
    // ══════════════════════════════════════════════════════════

    async function _addArquivos(fileList) {
        const arquivos = [...(fileList || [])].filter(f => /^image\//.test(f.type));
        if (!arquivos.length) return;
        const cabem = Math.max(0, MAX_REFS - _state.refs.length);
        if (!cabem) { _toast(`Máximo de ${MAX_REFS} fotos de referência.`, 'warning'); return; }

        for (const f of arquivos.slice(0, cabem)) {
            try {
                // Comprime: referência gigante só encarece o upload sem ganho de fidelidade.
                const { blob } = await comprimirImagem(f, 1400, 0.92, { formato: 'image/webp' });
                const thumb = await comprimirImagemParaDataUrl(blob, 220, 0.6, { formato: 'image/webp' });
                _state.refs.push({ id: 'r_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), blob, thumb, nome: f.name || 'foto' });
            } catch (e) {
                console.warn('[GerarModelo] falhou ao ler', f.name, e);
                _toast(`Não consegui ler "${f.name}".`, 'error');
            }
        }
        if (arquivos.length > cabem) _toast(`Usei ${cabem} foto(s) — o limite é ${MAX_REFS}.`, 'info');
        render();
    }

    // ══════════════════════════════════════════════════════════
    //  Geração
    // ══════════════════════════════════════════════════════════

    // Cada take é um cruzamento ângulo × zoom × cenário × roupa.
    function _combos() {
        const angs = ANGULOS.filter(a => _state.angulos.has(a.id));
        const zooms = ENQUADRAMENTOS.filter(z => _state.zooms.has(z.id));
        const cens = [..._state.cenarios].map(_cenarioPorId).filter(Boolean);
        const rous = [..._state.roupas].map(_roupaPorId).filter(Boolean);
        if (!angs.length && !zooms.length && !cens.length && !rous.length) return [];
        // Eixo vazio vira um padrão sensato em vez de zerar tudo.
        const A = angs.length ? angs : [ANGULOS[0]];
        const Z = zooms.length ? zooms : [ENQUADRAMENTOS[2]];
        const C = cens.length ? cens : [{ ...CENARIOS[0], custom: false }];
        const R = rous.length ? rous : [{ ...ROUPAS[0], custom: false }];
        const out = [];
        A.forEach(a => Z.forEach(z => C.forEach(c => R.forEach(r =>
            out.push({ angulo: a, zoom: z, cenario: c, roupa: r })))));
        return out;
    }

    // Blobs de cenário/roupa custom, buscados uma vez só por geração.
    async function _blobDeMedia(mediaId, cache) {
        if (!mediaId) return null;
        if (cache.has(mediaId)) return cache.get(mediaId);
        let b = null;
        try { b = (await MediaStore.get(mediaId))?.blob || null; } catch {}
        cache.set(mediaId, b);
        return b;
    }

    async function gerar() {
        if (_state.gerando) return;
        if (!_state.refs.length) { _toast('Envie ao menos uma foto do modelo.', 'error'); return; }

        const combos = _combos();
        if (!combos.length) { _toast('Escolha ao menos um ângulo ou enquadramento.', 'error'); return; }

        const prov = document.getElementById('mg-provider')?.value || (window.ImageAI?.provedorPadrao?.() || 'openai');
        const modelo = document.getElementById('mg-modelo')?.value || '';
        if (window.ImageAI?.temChave && !ImageAI.temChave(prov)) {
            _toast('Configure a chave de imagem em AI Generations → API Keys.', 'error');
            return;
        }

        const fmt = FORMATOS.find(f => f.id === _cfg.formato) || FORMATOS[0];
        const refBlobs = _state.refs.map(r => r.blob);

        // Captura o nome ANTES do render() abaixo: ele reconstrói o header e
        // zeraria o que o usuário acabou de digitar.
        _state.nomePendente = (document.getElementById('mg-nome')?.value || '').trim();

        _state.gerando = true;
        _state.progresso = { feito: 0, total: combos.length, atual: '' };
        render();

        let ok = 0;
        const cacheMedia = new Map();
        for (const { angulo, zoom, cenario, roupa } of combos) {
            const rotulo = [angulo.label, zoom.label, cenario.id !== 'manter' ? cenario.label : null,
                            roupa.id !== 'manter' ? roupa.label : null].filter(Boolean).join(' · ');
            _state.progresso.atual = rotulo;
            _renderProgresso();
            try {
                // ORDEM IMPORTA: os blobs vão na mesma sequência que _promptDe
                // descreve ("IMAGE 1 é o cenário, IMAGE 2 é a peça, o resto é a pessoa").
                const bFundo = cenario.custom ? await _blobDeMedia(cenario.mediaId, cacheMedia) : null;
                const bRoupa = roupa.custom ? await _blobDeMedia(roupa.mediaId, cacheMedia) : null;
                const entrada = [bFundo, bRoupa, ...refBlobs].filter(Boolean);

                const prompt = _promptDe(angulo, zoom, cenario, roupa, !!bFundo, !!bRoupa);
                const blob = await ImageAI.editar(entrada, prompt, {
                    provedor: prov,
                    modelo: modelo || undefined,
                    largura: fmt.w, altura: fmt.h, aspectRatio: fmt.ar,
                    formato: 'image/webp', compressao: 92,
                });
                await _guardarFoto(blob, angulo, zoom, prompt, cenario, roupa, rotulo);
                ok++;
            } catch (err) {
                console.error('[GerarModelo] falhou:', rotulo, err);
                _toast(`${rotulo}: ${String(err.message || err).slice(0, 110)}`, 'error');
            }
            _state.progresso.feito++;
            _renderProgresso();
        }

        _state.gerando = false;
        render();
        if (ok) _toast(`${ok} de ${combos.length} foto(s) gerada(s).`, 'success');
    }

    // Salva no IndexedDB + índice. Cria o modelo na primeira foto que der certo.
    async function _guardarFoto(blob, angulo, zoom, prompt, cenario, roupa, rotulo) {
        if (!_state.modeloId) await _criarModelo();
        const rec = _modelo(_state.modeloId);
        if (!rec) throw new Error('modelo não encontrado no índice');

        const id = 'mf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const mediaId = 'modelgen_' + id;
        await MediaStore.put(mediaId, blob, { type: blob.type || 'image/webp', name: `${angulo.id}-${zoom.id}.webp` });
        const thumb = await comprimirImagemParaDataUrl(blob, 320, 0.62, { formato: 'image/webp' });

        rec.fotos = rec.fotos || [];
        rec.fotos.unshift({
            id, mediaId, thumb,
            anguloId: angulo.id, zoomId: zoom.id,
            cenarioId: cenario?.id || '', roupaId: roupa?.id || '',
            label: rotulo || `${angulo.label} · ${zoom.label}`,
            prompt, criadoEm: new Date().toISOString(),
        });
        _gravarModelo(rec);
        _state.fotos = rec.fotos;

        if (window.RecentEdits?.add) {
            try { RecentEdits.add({ prompt: `${angulo.label} · ${zoom.label}`, thumb, origem: 'Gerar Modelo', tipo: rec.nome || 'Modelo' }); } catch {}
        }
    }

    // Guarda também as REFERÊNCIAS: sem elas não dá pra gerar mais ângulos
    // depois sem o usuário reenviar tudo.
    async function _criarModelo() {
        const id = 'mdl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
        const refs = [];
        for (const r of _state.refs) {
            const mediaId = 'modelref_' + r.id;
            try {
                await MediaStore.put(mediaId, r.blob, { type: r.blob.type || 'image/webp' });
                refs.push({ id: r.id, mediaId, thumb: r.thumb });
            } catch (e) { console.warn('[GerarModelo] ref não salvou:', e.message); }
        }
        const nome = _state.nomePendente
            || (document.getElementById('mg-nome')?.value || '').trim()
            || `Modelo ${listModelos().length + 1}`;
        _gravarModelo({ id, nome, refs, fotos: [], criadoEm: new Date().toISOString() });
        _state.modeloId = id;
        _state.fotos = [];
        return id;
    }

    async function carregarModelo(id) {
        const rec = _modelo(id);
        if (!rec) return;
        _state.modeloId = id;
        _state.fotos = rec.fotos || [];
        // Recarrega os blobs das referências pra poder gerar mais ângulos.
        _state.refs = [];
        for (const r of (rec.refs || [])) {
            try {
                const m = await MediaStore.get(r.mediaId);
                if (m?.blob) _state.refs.push({ id: r.id, blob: m.blob, thumb: r.thumb, nome: 'ref' });
            } catch {}
        }
        render();
        _toast(`Modelo "${rec.nome}" carregado.`, 'success');
    }

    async function excluirModelo(id) {
        const rec = _modelo(id);
        if (!rec) return;
        if (!confirm(`Excluir o modelo "${rec.nome}" e suas ${(rec.fotos || []).length} foto(s)?`)) return;
        for (const f of (rec.fotos || [])) { try { await MediaStore.del(f.mediaId); } catch {} }
        for (const r of (rec.refs || [])) { try { await MediaStore.del(r.mediaId); } catch {} }
        const ix = _index(); const sid = _storeId();
        ix[sid] = (ix[sid] || []).filter(m => m.id !== id);
        _saveIndex(ix);
        if (_state.modeloId === id) { _state.modeloId = null; _state.fotos = []; }
        render();
        _toast('Modelo excluído.', 'success');
    }

    function novoModelo() {
        _state.modeloId = null;
        _state.refs = [];
        _state.fotos = [];
        render();
    }

    async function _baixar(foto) {
        try {
            const m = await MediaStore.get(foto.mediaId);
            if (!m?.blob) throw new Error('imagem não encontrada');
            const url = URL.createObjectURL(m.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${_slug(_modelo(_state.modeloId)?.nome || 'modelo')}-${foto.anguloId}-${foto.zoomId}.webp`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
        } catch (e) { _toast('Falha ao baixar: ' + e.message, 'error'); }
    }

    async function _abrir(foto) {
        try {
            const m = await MediaStore.get(foto.mediaId);
            if (!m?.blob) return;
            const url = URL.createObjectURL(m.blob);
            const ov = document.createElement('div');
            ov.className = 'mg-lightbox';
            ov.innerHTML = `<img src="${url}" alt="${_esc(foto.label)}"><div class="mg-lightbox-cap">${_esc(foto.label)}</div>`;
            ov.addEventListener('click', () => { ov.remove(); URL.revokeObjectURL(url); });
            document.body.appendChild(ov);
        } catch {}
    }

    // Manda a foto gerada pro banco de referências, pra reusar no Estúdio.
    async function _paraRefBank(foto) {
        if (!window.RefBank?.add) { _toast('Banco de referências indisponível.', 'error'); return; }
        try {
            const m = await MediaStore.get(foto.mediaId);
            if (!m?.blob) throw new Error('imagem não encontrada');
            await RefBank.add(m.blob, { rotulo: `${_modelo(_state.modeloId)?.nome || 'Modelo'} · ${foto.label}`, origem: 'Gerar Modelo' });
            _toast('Enviado ao banco de referências.', 'success');
        } catch (e) { _toast('Falha: ' + e.message, 'error'); }
    }

    // ══════════════════════════════════════════════════════════
    //  Render
    // ══════════════════════════════════════════════════════════

    function render() {
        const root = document.getElementById('gerar-modelo-root');
        if (!root) return;
        const combos = _combos();
        root.innerHTML =
            _headerHtml() +
            '<div class="mg-grid">' +
                '<div class="mg-col-esq">' + _refsHtml() + _opcoesHtml() + '</div>' +
                '<div class="mg-col-dir">' + _selecaoHtml(combos) + '</div>' +
            '</div>' +
            _resultadosHtml() +
            _meusModelosHtml();
        _wire(root);
        if (window.lucide) { try { lucide.createIcons(); } catch {} }
    }

    function _headerHtml() {
        const rec = _state.modeloId ? _modelo(_state.modeloId) : null;
        return `
        <div class="section-header mg-header">
            <div>
                <h2 class="section-title" style="margin:0"><i data-lucide="user-round-search" style="width:20px;height:20px;vertical-align:-3px"></i> Gerar Modelo</h2>
                <p class="section-subtitle" style="margin:.25rem 0 0">Envie fotos de um modelo e gere a mesma pessoa em vários ângulos e enquadramentos.</p>
            </div>
            <div class="mg-header-acoes">
                <input type="text" id="mg-nome" class="input input-sm" placeholder="Nome do modelo" value="${_esc(rec?.nome || _state.nomePendente || '')}" style="width:170px">
                ${_state.modeloId ? '<button class="btn btn-secondary btn-sm" id="mg-novo"><i data-lucide="plus" style="width:14px;height:14px"></i> Novo</button>' : ''}
            </div>
        </div>`;
    }

    function _refsHtml() {
        const itens = _state.refs.map(r => `
            <div class="mg-ref" data-ref="${r.id}">
                <img src="${r.thumb}" alt="${_esc(r.nome)}">
                <button class="mg-ref-x" data-del-ref="${r.id}" title="Remover"><i data-lucide="x" style="width:12px;height:12px"></i></button>
            </div>`).join('');
        const podeMais = _state.refs.length < MAX_REFS;
        return `
        <div class="mg-card">
            <div class="mg-card-head">
                <span class="mg-card-title"><i data-lucide="images" style="width:15px;height:15px;vertical-align:-2px"></i> Fotos do modelo</span>
                <span class="mg-card-hint">${_state.refs.length}/${MAX_REFS}</span>
            </div>
            <p class="mg-help">Quanto mais ângulos diferentes da mesma pessoa você enviar, mais fiel fica o rosto.</p>
            <div class="mg-refs">
                ${itens}
                ${podeMais ? `<label class="mg-ref-add" for="mg-file"><i data-lucide="plus" style="width:18px;height:18px"></i><span>Adicionar</span></label>` : ''}
            </div>
            <input type="file" id="mg-file" accept="image/*" multiple hidden>
        </div>`;
    }

    function _opcoesHtml() {
        const provs = [['openai', 'OpenAI'], ['gemini', 'Google Gemini'], ['higgsfield', 'Higgsfield'], ['codex', 'Codex (local · ChatGPT)']];
        const provAtual = (window.ImageAI?.provedorPadrao?.() || 'openai');
        return `
        <div class="mg-card">
            <div class="mg-card-head"><span class="mg-card-title"><i data-lucide="sliders-horizontal" style="width:15px;height:15px;vertical-align:-2px"></i> Opções</span></div>
            <div class="mg-campos">
                <label class="mg-campo"><span>Formato</span>
                    <select id="mg-formato" class="input input-sm">
                        ${FORMATOS.map(f => `<option value="${f.id}" ${_cfg.formato === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}
                    </select></label>
                <label class="mg-campo"><span>Gerar com</span>
                    <select id="mg-provider" class="input input-sm">
                        ${provs.map(([v, l]) => `<option value="${v}" ${provAtual === v ? 'selected' : ''}>${l}</option>`).join('')}
                    </select></label>
                <label class="mg-campo"><span>Versão</span>
                    <select id="mg-modelo" class="input input-sm"><option value="">Padrão (mais recente)</option></select></label>
            </div>
            <label class="mg-campo" style="margin-top:.6rem"><span>Instrução extra (opcional)</span>
                <input type="text" id="mg-extra" class="input input-sm" placeholder="ex.: expressão séria, luz de fim de tarde" value="${_esc(_cfg.extra)}"></label>
        </div>`;
    }

    function _selecaoHtml(combos) {
        const chip = (item, tipo, ativo) => `
            <button type="button" class="mg-chip ${ativo ? 'mg-chip-on' : ''}" data-tipo="${tipo}" data-id="${item.id}">
                <span>${item.label}</span>${item.dica ? `<small>${item.dica}</small>` : ''}
            </button>`;
        const n = combos.length;
        return `
        <div class="mg-card mg-card-sel">
            <div class="mg-card-head">
                <span class="mg-card-title"><i data-lucide="grid-2x2" style="width:15px;height:15px;vertical-align:-2px"></i> O que gerar</span>
                <span class="mg-packs">
                    <button type="button" class="mg-pack" data-pack="essencial">Essencial</button>
                    <button type="button" class="mg-pack" data-pack="catalogo">Catálogo</button>
                    <button type="button" class="mg-pack" data-pack="street">Street style</button>
                    <button type="button" class="mg-pack" data-pack="rosto">Só rosto</button>
                    <button type="button" class="mg-pack" data-pack="limpar">Limpar</button>
                </span>
            </div>

            <div class="mg-grupo-lbl">Ângulos</div>
            <div class="mg-chips">${ANGULOS.map(a => chip(a, 'ang', _state.angulos.has(a.id))).join('')}</div>

            <div class="mg-grupo-lbl">Enquadramento (zoom)</div>
            <div class="mg-chips">${ENQUADRAMENTOS.map(z => chip(z, 'zoom', _state.zooms.has(z.id))).join('')}</div>

            <div class="mg-grupo-lbl">Cenário / fundo</div>
            <div class="mg-chips">
                ${CENARIOS.map(c => chip(c, 'cen', _state.cenarios.has(c.id))).join('')}
                ${cenariosCustom().map(c => `
                    <button type="button" class="mg-chip mg-chip-foto ${_state.cenarios.has(c.id) ? 'mg-chip-on' : ''}" data-tipo="cen" data-id="${c.id}">
                        ${c.thumb ? `<img src="${c.thumb}" alt="">` : ''}<span>${_esc(c.label)}</span><small>Meu cenário</small>
                        <i class="mg-chip-x" data-del-custom="cen:${c.id}" data-lucide="x"></i>
                    </button>`).join('')}
                <label class="mg-chip mg-chip-add" for="mg-cen-file"><i data-lucide="image-plus" style="width:14px;height:14px"></i><span>Adicionar fundo</span></label>
            </div>
            <input type="file" id="mg-cen-file" accept="image/*" hidden>

            <div class="mg-grupo-lbl">Roupa / look</div>
            <div class="mg-chips">
                ${ROUPAS.map(r => chip(r, 'rou', _state.roupas.has(r.id))).join('')}
                ${roupasCustom().map(r => `
                    <button type="button" class="mg-chip mg-chip-foto ${_state.roupas.has(r.id) ? 'mg-chip-on' : ''}" data-tipo="rou" data-id="${r.id}">
                        ${r.thumb ? `<img src="${r.thumb}" alt="">` : ''}<span>${_esc(r.label)}</span><small>${r.mediaId ? 'Foto da peça' : 'Minha descrição'}</small>
                        <i class="mg-chip-x" data-del-custom="rou:${r.id}" data-lucide="x"></i>
                    </button>`).join('')}
                <button type="button" class="mg-chip mg-chip-add" id="mg-rou-add"><i data-lucide="shirt" style="width:14px;height:14px"></i><span>Adicionar roupa</span></button>
            </div>

            <div class="mg-gerar-barra">
                <div class="mg-contagem">
                    <b>${n}</b> ${n === 1 ? 'imagem' : 'imagens'} ${n ? `<span class="mg-dim">(${(_state.angulos.size || 1)} âng × ${(_state.zooms.size || 1)} zoom × ${(_state.cenarios.size || 1)} cenário${_state.cenarios.size === 1 ? '' : 's'} × ${(_state.roupas.size || 1)} roupa${_state.roupas.size === 1 ? '' : 's'})</span>` : ''}
                    ${n > 12 ? '<span class="mg-aviso"><i data-lucide="alert-triangle" style="width:12px;height:12px;vertical-align:-1px"></i> cada imagem é uma chamada paga</span>' : ''}
                </div>
                <button class="btn btn-primary" id="mg-gerar" ${_state.gerando || !n || !_state.refs.length ? 'disabled' : ''}>
                    ${_state.gerando ? '<span class="app-spinner"></span> Gerando…' : '<i data-lucide="sparkles" style="width:15px;height:15px"></i> Gerar ' + (n || '') + ' foto' + (n === 1 ? '' : 's')}
                </button>
            </div>
            <div id="mg-progresso">${_progressoHtml()}</div>
        </div>`;
    }

    function _progressoHtml() {
        if (!_state.gerando) return '';
        const { feito, total, atual } = _state.progresso;
        const pct = total ? Math.round((feito / total) * 100) : 0;
        return `<div class="mg-prog">
            <div class="mg-prog-bar"><div class="mg-prog-fill" style="width:${pct}%"></div></div>
            <div class="mg-prog-txt">${feito}/${total} · ${_esc(atual || '')}</div>
        </div>`;
    }
    function _renderProgresso() {
        const el = document.getElementById('mg-progresso');
        if (el) el.innerHTML = _progressoHtml();
    }

    function _resultadosHtml() {
        if (!_state.fotos.length) return '';
        const rec = _modelo(_state.modeloId);
        const cards = _state.fotos.map(f => `
            <figure class="mg-foto" data-foto="${f.id}">
                <img src="${f.thumb}" alt="${_esc(f.label)}" loading="lazy">
                <figcaption>${_esc(f.label)}</figcaption>
                <div class="mg-foto-acoes">
                    <button data-abrir="${f.id}" title="Ampliar"><i data-lucide="maximize-2" style="width:13px;height:13px"></i></button>
                    <button data-baixar="${f.id}" title="Baixar"><i data-lucide="download" style="width:13px;height:13px"></i></button>
                    <button data-ref="${f.id}" title="Enviar ao banco de referências"><i data-lucide="bookmark-plus" style="width:13px;height:13px"></i></button>
                </div>
            </figure>`).join('');
        return `
        <div class="mg-card mg-resultados">
            <div class="mg-card-head">
                <span class="mg-card-title"><i data-lucide="layout-grid" style="width:15px;height:15px;vertical-align:-2px"></i> ${_esc(rec?.nome || 'Modelo')} — ${_state.fotos.length} foto(s)</span>
            </div>
            <div class="mg-fotos">${cards}</div>
        </div>`;
    }

    function _meusModelosHtml() {
        const lista = listModelos();
        if (!lista.length) return '';
        return `
        <div class="mg-card">
            <div class="mg-card-head"><span class="mg-card-title"><i data-lucide="users" style="width:15px;height:15px;vertical-align:-2px"></i> Meus modelos</span></div>
            <div class="mg-modelos">
                ${lista.map(m => `
                    <div class="mg-modelo ${m.id === _state.modeloId ? 'mg-modelo-on' : ''}" data-modelo="${m.id}">
                        <img src="${(m.refs?.[0]?.thumb) || (m.fotos?.[0]?.thumb) || ''}" alt="">
                        <div class="mg-modelo-info">
                            <b>${_esc(m.nome)}</b>
                            <small>${(m.fotos || []).length} foto(s)</small>
                        </div>
                        <button class="mg-modelo-x" data-del-modelo="${m.id}" title="Excluir"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                    </div>`).join('')}
            </div>
        </div>`;
    }

    // ══════════════════════════════════════════════════════════
    //  Wiring
    // ══════════════════════════════════════════════════════════

    function _wire(root) {
        root.querySelector('#mg-file')?.addEventListener('change', e => { _addArquivos(e.target.files); e.target.value = ''; });
        root.querySelectorAll('[data-del-ref]').forEach(b => b.addEventListener('click', () => {
            _state.refs = _state.refs.filter(r => r.id !== b.dataset.delRef); render();
        }));
        root.querySelector('#mg-novo')?.addEventListener('click', novoModelo);

        // Nome: guarda sempre (sobrevive ao re-render) e renomeia o modelo já salvo.
        root.querySelector('#mg-nome')?.addEventListener('input', e => {
            _state.nomePendente = e.target.value.trim();
        });
        root.querySelector('#mg-nome')?.addEventListener('change', e => {
            const novo = e.target.value.trim();
            _state.nomePendente = novo;
            if (_state.modeloId && novo) {
                const rec = _modelo(_state.modeloId);
                if (rec && rec.nome !== novo) {
                    rec.nome = novo;
                    _gravarModelo(rec);
                    render();
                    _toast('Modelo renomeado.', 'success');
                }
            }
        });

        const SETS = { ang: 'angulos', zoom: 'zooms', cen: 'cenarios', rou: 'roupas' };
        root.querySelectorAll('.mg-chip[data-tipo]').forEach(b => b.addEventListener('click', e => {
            if (e.target.closest('[data-del-custom]')) return;   // o X exclui, não seleciona
            const set = _state[SETS[b.dataset.tipo]];
            if (!set) return;
            if (set.has(b.dataset.id)) set.delete(b.dataset.id); else set.add(b.dataset.id);
            render();
        }));
        root.querySelectorAll('[data-del-custom]').forEach(x => x.addEventListener('click', async e => {
            e.stopPropagation();
            const [tipo, id] = x.dataset.delCustom.split(':');
            if (confirm('Excluir este item do seu banco?')) await _removerCustom(tipo, id);
        }));

        // Cenário próprio (foto do lugar)
        root.querySelector('#mg-cen-file')?.addEventListener('change', async e => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            const nome = (prompt('Nome deste cenário:', f.name.replace(/\.[^.]+$/, '')) || '').trim();
            if (nome === '') return;
            try {
                const id = await _addCenarioCustom(f, nome);
                _state.cenarios.add(id);
                render(); _toast('Cenário adicionado.', 'success');
            } catch (err) { _toast('Falha ao adicionar cenário: ' + err.message, 'error'); }
        });

        // Roupa própria: descrição e/ou foto da peça
        root.querySelector('#mg-rou-add')?.addEventListener('click', () => _abrirNovaRoupa());

        root.querySelectorAll('.mg-pack').forEach(b => b.addEventListener('click', () => {
            const p = b.dataset.pack;
            if (p === 'limpar') { _state.angulos.clear(); _state.zooms.clear(); _state.cenarios.clear(); _state.roupas.clear(); }
            else if (PACKS[p]) {
                _state.angulos = new Set(PACKS[p].angulos);
                _state.zooms = new Set(PACKS[p].zooms);
                _state.cenarios = new Set(PACKS[p].cenarios || ['estudio']);
                _state.roupas = new Set(PACKS[p].roupas || ['manter']);
            }
            render();
        }));

        const salvarCfg = () => {
            _cfg.formato = root.querySelector('#mg-formato')?.value || _cfg.formato;
            _cfg.extra = (root.querySelector('#mg-extra')?.value || '').trim();
            _saveCfg();
        };
        ['#mg-formato', '#mg-extra'].forEach(sel =>
            root.querySelector(sel)?.addEventListener('change', salvarCfg));

        root.querySelector('#mg-provider')?.addEventListener('change', () => _preencherModelos(root));
        _preencherModelos(root);

        root.querySelector('#mg-gerar')?.addEventListener('click', () => { salvarCfg(); gerar(); });

        root.querySelectorAll('[data-abrir]').forEach(b => b.addEventListener('click', () => {
            const f = _state.fotos.find(x => x.id === b.dataset.abrir); if (f) _abrir(f);
        }));
        root.querySelectorAll('[data-baixar]').forEach(b => b.addEventListener('click', () => {
            const f = _state.fotos.find(x => x.id === b.dataset.baixar); if (f) _baixar(f);
        }));
        root.querySelectorAll('[data-ref]').forEach(b => b.addEventListener('click', () => {
            const f = _state.fotos.find(x => x.id === b.dataset.ref); if (f) _paraRefBank(f);
        }));

        root.querySelectorAll('[data-modelo]').forEach(el => el.addEventListener('click', e => {
            if (e.target.closest('[data-del-modelo]')) return;
            carregarModelo(el.dataset.modelo);
        }));
        root.querySelectorAll('[data-del-modelo]').forEach(b => b.addEventListener('click', e => {
            e.stopPropagation(); excluirModelo(b.dataset.delModelo);
        }));
    }

    // Modal de roupa própria: descrição, foto da peça, ou os dois. A foto
    // serve pra qualquer item que a modelo use ou carregue (bolsa, óculos…).
    function _abrirNovaRoupa() {
        let modal = document.getElementById('mg-roupa-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'mg-roupa-modal';
            modal.className = 'ca-modal-overlay';
            document.body.appendChild(modal);
        }
        modal.classList.remove('hidden');
        modal.innerHTML = `<div class="ca-modal" style="max-width:460px">
            <div class="ca-modal-head">
                <div class="ca-modal-title">Adicionar roupa / peça</div>
                <button class="ca-modal-close" id="mgr-x"><i data-lucide="x" style="width:18px;height:18px"></i></button>
            </div>
            <label class="mg-campo" style="margin-bottom:.7rem"><span>Descrição</span>
                <input type="text" id="mgr-txt" class="input input-sm" placeholder="ex.: camisa branca oversized com calça preta wide leg"></label>
            <label class="mg-campo" style="margin-bottom:.7rem"><span>Foto da peça (opcional)</span>
                <input type="file" id="mgr-file" class="input input-sm" accept="image/*"></label>
            <p class="mg-help">Com foto, a peça é reproduzida fielmente (serve pra bolsa, óculos, qualquer item). Só com texto, a IA interpreta a descrição.</p>
            <div style="display:flex;gap:.5rem;justify-content:flex-end">
                <button class="btn btn-secondary btn-sm" id="mgr-cancel">Cancelar</button>
                <button class="btn btn-primary btn-sm" id="mgr-ok">Adicionar</button>
            </div>
        </div>`;
        const fechar = () => modal.classList.add('hidden');
        modal.querySelector('#mgr-x').addEventListener('click', fechar);
        modal.querySelector('#mgr-cancel').addEventListener('click', fechar);
        modal.querySelector('#mgr-ok').addEventListener('click', async () => {
            const texto = (modal.querySelector('#mgr-txt').value || '').trim();
            const file = modal.querySelector('#mgr-file').files?.[0] || null;
            if (!texto && !file) { _toast('Escreva uma descrição ou escolha uma foto.', 'error'); return; }
            try {
                const id = await _addRoupaCustom({ texto, file, rotulo: texto || (file?.name || '').replace(/\.[^.]+$/, '') });
                _state.roupas.add(id);
                fechar(); render(); _toast('Roupa adicionada.', 'success');
            } catch (err) { _toast('Falha: ' + err.message, 'error'); }
        });
        if (window.lucide) { try { lucide.createIcons(); } catch {} }
    }

    // Popula as versões do provedor escolhido (mesma lista do ImageAI).
    function _preencherModelos(root) {
        const sel = root.querySelector('#mg-modelo');
        const prov = root.querySelector('#mg-provider')?.value || 'openai';
        if (!sel || !window.ImageAI) return;
        const lista = prov === 'gemini' ? (ImageAI.MODELOS_GEMINI || [])
            : prov === 'higgsfield' ? (ImageAI.MODELOS_HIGGSFIELD || [])
            : prov === 'codex' ? []   // versão é decidida no servidor local
            : (ImageAI.MODELOS_OPENAI || []);
        sel.innerHTML = '<option value="">Padrão (mais recente)</option>'
            + lista.map(m => `<option value="${m}">${_esc((ImageAI.NOMES_MODELO || {})[m] || m)}</option>`).join('');
    }

    // ══════════════════════════════════════════════════════════

    function _toast(msg, tipo) { if (typeof showToast === 'function') showToast(msg, tipo); }
    function _esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function _slug(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'modelo';
    }

    function init() {
        if (_state.inited) return;
        _state.inited = true;
        _loadCfg();
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', tab => { if (tab === TAB) render(); });
            EventBus.on('storeChanged', () => { novoModelo(); });
        }
        if (document.getElementById('tab-' + TAB)?.classList.contains('active')) render();
    }

    return {
        init, render, gerar, listModelos, carregarModelo, excluirModelo, novoModelo,
        ANGULOS, ENQUADRAMENTOS, CENARIOS, ROUPAS, FORMATOS,
        cenariosCustom, roupasCustom,
        _state, _promptDe, _combos,
    };
})();

window.ModelGenModule = ModelGenModule;
