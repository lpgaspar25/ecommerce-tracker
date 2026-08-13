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

    const FUNDOS = [
        { id: 'manter', label: 'Manter o da foto', instrucao: 'Keep a background consistent with the reference photos.' },
        { id: 'estudio', label: 'Estúdio neutro', instrucao: 'Background: seamless neutral light-grey photography studio backdrop with soft, even studio lighting.' },
        { id: 'branco', label: 'Fundo branco', instrucao: 'Background: clean seamless pure white studio background with bright, even lighting.' },
        { id: 'externo', label: 'Externo (natural)', instrucao: 'Background: natural outdoor daylight setting, softly blurred with shallow depth of field.' },
        { id: 'lifestyle', label: 'Lifestyle (casa/urbano)', instrucao: 'Background: tasteful lifestyle setting (modern interior or urban street), softly blurred so the person stays the focus.' },
    ];

    const FORMATOS = [
        { id: '4x5', label: 'Retrato 4:5', w: 1080, h: 1350, ar: '4:5' },
        { id: '1x1', label: 'Quadrado 1:1', w: 1080, h: 1080, ar: '1:1' },
        { id: '9x16', label: 'Story 9:16', w: 1080, h: 1920, ar: '9:16' },
        { id: '3x4', label: 'Clássico 3:4', w: 1080, h: 1440, ar: '3:4' },
    ];

    // Combos prontos — evita o usuário marcar 40 imagens sem querer.
    const PACKS = {
        essencial: { angulos: ['frontal', '3-4-esq', '3-4-dir'], zooms: ['busto', 'inteiro'] },
        catalogo: { angulos: ['frontal', '3-4-esq', '3-4-dir', 'perfil-esq', 'costas'], zooms: ['busto', 'meio', 'inteiro'] },
        rosto: { angulos: ['frontal', '3-4-esq', '3-4-dir', 'perfil-esq', 'perfil-dir'], zooms: ['close'] },
    };

    const _state = {
        refs: [],            // { id, blob, thumb, nome }
        modeloId: null,      // id do modelo salvo (criado na 1ª geração)
        fotos: [],           // fotos do modelo atual (do índice)
        angulos: new Set(['frontal', '3-4-esq', '3-4-dir']),
        zooms: new Set(['busto', 'inteiro']),
        gerando: false,
        progresso: { feito: 0, total: 0, atual: '' },
        inited: false,
    };

    let _cfg = { fundo: 'estudio', formato: '4x5', roupa: 'manter', extra: '' };

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

    // ══════════════════════════════════════════════════════════
    //  Prompt — a trava de identidade é o coração da feature
    // ══════════════════════════════════════════════════════════

    function _promptDe(angulo, zoom) {
        const fundo = FUNDOS.find(f => f.id === _cfg.fundo) || FUNDOS[1];
        const roupa = _cfg.roupa === 'manter'
            ? 'Keep exactly the same clothing, outfit, accessories and hairstyle as in the reference photos.'
            : (String(_cfg.roupa || '').trim()
                ? `Clothing: ${String(_cfg.roupa).trim()}. Keep the person's face and hair unchanged.`
                : 'Keep the same clothing as in the reference photos.');

        return [
            'Using the provided reference photo(s), which all show the SAME person, generate ONE new photorealistic photograph of that exact same person.',
            // Identidade: o modelo "embeleza" por padrão — é preciso proibir explicitamente.
            'IDENTITY LOCK — the person must be instantly recognisable as the same individual:'
            + ' keep the same face shape and bone structure, the same eyes (shape and colour), eyebrows, nose, lips, jawline and ears,'
            + ' the same skin tone and complexion including freckles, moles, scars and skin texture,'
            + ' the same hair colour, length and hairstyle, the same facial hair, the same body type and build,'
            + ' and the same apparent age, gender and ethnicity.'
            + ' Do NOT beautify, slim down, de-age, smooth the skin or idealise the face. Do NOT invent a different or merely similar-looking person.',
            roupa,
            angulo.instrucao,
            zoom.instrucao,
            fundo.instrucao,
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

    function _combos() {
        const angs = ANGULOS.filter(a => _state.angulos.has(a.id));
        const zooms = ENQUADRAMENTOS.filter(z => _state.zooms.has(z.id));
        if (!angs.length && !zooms.length) return [];
        // Só ângulo marcado → usa meio corpo; só zoom marcado → usa frontal.
        const A = angs.length ? angs : [ANGULOS[0]];
        const Z = zooms.length ? zooms : [ENQUADRAMENTOS[2]];
        const out = [];
        A.forEach(a => Z.forEach(z => out.push({ angulo: a, zoom: z })));
        return out;
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
        for (const { angulo, zoom } of combos) {
            _state.progresso.atual = `${angulo.label} · ${zoom.label}`;
            _renderProgresso();
            try {
                const prompt = _promptDe(angulo, zoom);
                const blob = await ImageAI.editar(refBlobs, prompt, {
                    provedor: prov,
                    modelo: modelo || undefined,
                    largura: fmt.w, altura: fmt.h, aspectRatio: fmt.ar,
                    formato: 'image/webp', compressao: 92,
                });
                await _guardarFoto(blob, angulo, zoom, prompt);
                ok++;
            } catch (err) {
                console.error('[GerarModelo] falhou:', angulo.label, zoom.label, err);
                _toast(`${angulo.label} · ${zoom.label}: ${String(err.message || err).slice(0, 110)}`, 'error');
            }
            _state.progresso.feito++;
            _renderProgresso();
        }

        _state.gerando = false;
        render();
        if (ok) _toast(`${ok} de ${combos.length} foto(s) gerada(s).`, 'success');
    }

    // Salva no IndexedDB + índice. Cria o modelo na primeira foto que der certo.
    async function _guardarFoto(blob, angulo, zoom, prompt) {
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
            label: `${angulo.label} · ${zoom.label}`,
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
                <input type="text" id="mg-nome" class="input input-sm" placeholder="Nome do modelo" value="${_esc(rec?.nome || '')}" style="width:170px">
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
        const provs = [['openai', 'OpenAI'], ['gemini', 'Google Gemini'], ['higgsfield', 'Higgsfield']];
        const provAtual = (window.ImageAI?.provedorPadrao?.() || 'openai');
        return `
        <div class="mg-card">
            <div class="mg-card-head"><span class="mg-card-title"><i data-lucide="sliders-horizontal" style="width:15px;height:15px;vertical-align:-2px"></i> Opções</span></div>
            <div class="mg-campos">
                <label class="mg-campo"><span>Cenário / fundo</span>
                    <select id="mg-fundo" class="input input-sm">
                        ${FUNDOS.map(f => `<option value="${f.id}" ${_cfg.fundo === f.id ? 'selected' : ''}>${f.label}</option>`).join('')}
                    </select></label>
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
            <label class="mg-campo" style="margin-top:.6rem"><span>Roupa</span>
                <input type="text" id="mg-roupa" class="input input-sm" placeholder="manter (deixe vazio) ou descreva: camiseta branca lisa"
                       value="${_cfg.roupa === 'manter' ? '' : _esc(_cfg.roupa)}"></label>
            <label class="mg-campo" style="margin-top:.5rem"><span>Instrução extra (opcional)</span>
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
                    <button type="button" class="mg-pack" data-pack="rosto">Só rosto</button>
                    <button type="button" class="mg-pack" data-pack="limpar">Limpar</button>
                </span>
            </div>

            <div class="mg-grupo-lbl">Ângulos</div>
            <div class="mg-chips">${ANGULOS.map(a => chip(a, 'ang', _state.angulos.has(a.id))).join('')}</div>

            <div class="mg-grupo-lbl">Enquadramento (zoom)</div>
            <div class="mg-chips">${ENQUADRAMENTOS.map(z => chip(z, 'zoom', _state.zooms.has(z.id))).join('')}</div>

            <div class="mg-gerar-barra">
                <div class="mg-contagem">
                    <b>${n}</b> ${n === 1 ? 'imagem' : 'imagens'} ${n ? `<span class="mg-dim">(${(_state.angulos.size || 1)} ângulo${_state.angulos.size === 1 ? '' : 's'} × ${(_state.zooms.size || 1)} zoom${_state.zooms.size === 1 ? '' : 's'})</span>` : ''}
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

        root.querySelectorAll('.mg-chip').forEach(b => b.addEventListener('click', () => {
            const set = b.dataset.tipo === 'ang' ? _state.angulos : _state.zooms;
            if (set.has(b.dataset.id)) set.delete(b.dataset.id); else set.add(b.dataset.id);
            render();
        }));
        root.querySelectorAll('.mg-pack').forEach(b => b.addEventListener('click', () => {
            const p = b.dataset.pack;
            if (p === 'limpar') { _state.angulos.clear(); _state.zooms.clear(); }
            else if (PACKS[p]) { _state.angulos = new Set(PACKS[p].angulos); _state.zooms = new Set(PACKS[p].zooms); }
            render();
        }));

        const salvarCfg = () => {
            _cfg.fundo = root.querySelector('#mg-fundo')?.value || _cfg.fundo;
            _cfg.formato = root.querySelector('#mg-formato')?.value || _cfg.formato;
            const roupa = (root.querySelector('#mg-roupa')?.value || '').trim();
            _cfg.roupa = roupa || 'manter';
            _cfg.extra = (root.querySelector('#mg-extra')?.value || '').trim();
            _saveCfg();
        };
        ['#mg-fundo', '#mg-formato', '#mg-roupa', '#mg-extra'].forEach(sel =>
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

    // Popula as versões do provedor escolhido (mesma lista do ImageAI).
    function _preencherModelos(root) {
        const sel = root.querySelector('#mg-modelo');
        const prov = root.querySelector('#mg-provider')?.value || 'openai';
        if (!sel || !window.ImageAI) return;
        const lista = prov === 'gemini' ? (ImageAI.MODELOS_GEMINI || [])
            : prov === 'higgsfield' ? (ImageAI.MODELOS_HIGGSFIELD || [])
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
        ANGULOS, ENQUADRAMENTOS, FUNDOS, FORMATOS,
        _state, _promptDe, _combos,
    };
})();

window.ModelGenModule = ModelGenModule;
