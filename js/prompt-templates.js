/* ===========================
   Prompt Templates Modal
   - Madgicx-curated templates + user's own
   =========================== */
(function () {
    const MADGICX_TEMPLATES = [
        {
            id: 'tpl_single_swap',
            name: 'Single Reference Image Swap',
            tags: ['visuals', 'concept'],
            description: 'Generate multiple ad visual concepts from a reference image.',
            prompt: 'Create an advertisement visual based on this reference image: [REFERENCE]. Maintain the composition, lighting, and product placement, but generate a fresh creative concept with vibrant colors and a clear focal point.',
            icon: 'image',
        },
        {
            id: 'tpl_multi_product',
            name: 'Multi-Product Reference Image Swap',
            tags: ['products', 'composition'],
            description: 'Replace multiple products in a reference image with your own product images.',
            prompt: 'Take the layout and composition of the reference image and replace each product slot with: [YOUR PRODUCT]. Keep the same lighting style, background, and overall mood.',
            icon: 'package',
        },
        {
            id: 'tpl_style_fusion',
            name: 'Multi-Reference Image Style Fusion',
            tags: ['style', 'fusion'],
            description: 'Combine selected elements (lighting, layout, background) from multiple reference images.',
            prompt: 'Fuse the lighting from reference 1, the layout from reference 2, and the background from reference 3 into a single advertisement composition for [PRODUCT]. Modern, premium, magazine-style.',
            icon: 'layers',
        },
        {
            id: 'tpl_messaging',
            name: 'Product Placement — Messaging & Communication Apps',
            tags: ['placement', 'context'],
            description: 'Place your product image into a user-described scene.',
            prompt: 'Place [PRODUCT] naturally into a scene where: [DESCRIBE SCENE]. Maintain photorealistic lighting and shadows. The product must look like it belongs in the environment, not pasted in.',
            icon: 'message-square',
        },
        {
            id: 'tpl_dynamic_ig',
            name: 'Dynamic Instagram Product Ad',
            tags: ['instagram', 'social'],
            description: 'Understand the product and contextually create an Ad for Instagram.',
            prompt: 'Create a vibrant Instagram-ready ad (1:1 square) for [PRODUCT]. Use bold colors, a clear hero shot, minimal text overlay, and a lifestyle context that matches the target audience. Aesthetic: modern, scroll-stopping, trendy.',
            icon: 'instagram',
        },
        {
            id: 'tpl_lifestyle',
            name: 'Lifestyle in Use',
            tags: ['lifestyle', 'people'],
            description: 'Show the product being used by a real person in a relatable lifestyle context.',
            prompt: 'Photograph [PRODUCT] in use by a [TARGET PERSONA] in a [SETTING]. Natural lighting, candid moment, lifestyle aesthetic. Emphasize the emotional benefit, not the product specs.',
            icon: 'users',
        },
        {
            id: 'tpl_before_after',
            name: 'Before / After Transformation',
            tags: ['transformation', 'proof'],
            description: 'Side-by-side visual showing the transformation the product enables.',
            prompt: 'Split-screen ad showing BEFORE (problem) and AFTER ([PRODUCT] solution) with subtle annotations. Clean, modern editorial style, high contrast between the two states.',
            icon: 'contrast',
        },
        {
            id: 'tpl_studio_shot',
            name: 'Studio Product Shot',
            tags: ['studio', 'product', 'clean'],
            description: 'Clean studio product photograph with controlled lighting and neutral background.',
            prompt: 'Professional studio product photograph of [PRODUCT] on a [BACKGROUND COLOR] seamless backdrop. Use [LIGHTING STYLE] (soft diffused softbox or dramatic side lighting). Sharp focus, shallow depth of field, 50mm lens, no distracting elements. Premium e-commerce style.',
            icon: 'camera',
        },
        {
            id: 'tpl_ugc',
            name: 'UGC Style Photo',
            tags: ['ugc', 'authentic', 'mobile'],
            description: 'Authentic mobile-shot user-generated content featuring the product.',
            prompt: 'Authentic UGC-style smartphone photograph of [PERSON] holding/using [PRODUCT] at [LOCATION]. Imperfect framing, natural lighting, slight motion blur, mobile camera aesthetic. Looks unstaged and real — like a satisfied customer Instagram post.',
            icon: 'smartphone',
        },
        {
            id: 'tpl_hero_banner',
            name: 'Hero Banner',
            tags: ['banner', 'hero', 'landing'],
            description: 'Wide composition for top-of-page banners and landing hero sections.',
            prompt: 'Cinematic wide hero banner (16:9) featuring [PRODUCT] with negative space on the left for headline overlay. Dramatic lighting, strong product hero shot, premium brand aesthetic, vibrant but controlled color palette. Suited for landing page or web banner ad.',
            icon: 'layout',
        },
    ];

    // Sugestões de categoria > subcategoria (backlog STUDIO-07). O usuário
    // pode digitar qualquer outra — isso só alimenta os datalists.
    const CATEGORIAS_SUGERIDAS = {
        'Imagem': ['Cenários', 'Edição'],
        'Copy': ['Títulos', 'Descrição'],
    };

    const PromptTemplates = {
        STORAGE_KEY: 'etracker_my_templates',
        _selected: null,
        _activeTab: 'madgicx',
        _onUse: null,     // callback(promptText) — quem chamou open() decide onde o texto vai
        _prefill: '',     // texto já digitado no campo de origem, usado no "+ Novo prompt"
        _editandoId: null,

        init() {
            if (document.readyState !== 'loading') this._setup();
            else document.addEventListener('DOMContentLoaded', () => this._setup());
        },

        _setup() {
            document.getElementById('templates-modal-close')?.addEventListener('click', () => this.close());
            document.getElementById('tpl-cancel')?.addEventListener('click', () => this.close());
            document.getElementById('tpl-use')?.addEventListener('click', () => this._useSelected());

            document.querySelectorAll('[data-tpl-tab]').forEach(btn => {
                btn.addEventListener('click', () => {
                    this._activeTab = btn.dataset.tplTab;
                    document.querySelectorAll('[data-tpl-tab]').forEach(b => b.classList.toggle('adhub-tab-active', b === btn));
                    this._fecharForm();
                    document.getElementById('tpl-mine-toolbar').style.display = this._activeTab === 'mine' ? 'flex' : 'none';
                    if (this._activeTab === 'mine') this._popularFiltroCategorias();
                    this._renderGrid();
                });
            });

            document.getElementById('tpl-search')?.addEventListener('input', () => this._renderGrid());
            document.getElementById('tpl-filtro-cat')?.addEventListener('change', () => this._renderGrid());
            document.getElementById('tpl-novo')?.addEventListener('click', () => this._abrirForm(null));
            document.getElementById('tpl-form-cancelar')?.addEventListener('click', () => this._fecharForm());
            document.getElementById('tpl-form-salvar')?.addEventListener('click', () => this._salvarForm());
            document.getElementById('tpl-form-categoria')?.addEventListener('input', (e) => this._popularSubcategorias(e.target.value));

            // Close on overlay click
            document.querySelector('#modal-prompt-templates .modal-overlay')?.addEventListener('click', () => this.close());
        },

        // opts: { onUse(promptText), prefill } — quando onUse é passado, "Usar
        // prompt" chama esse callback em vez do fluxo antigo (fixo no AI Generations).
        open(opts) {
            const modal = document.getElementById('modal-prompt-templates');
            if (!modal) return;
            this._onUse = opts?.onUse || null;
            this._prefill = opts?.prefill || '';
            this._selected = null;
            this._fecharForm();
            const useBtn = document.getElementById('tpl-use');
            if (useBtn) useBtn.disabled = true;
            document.getElementById('tpl-mine-toolbar').style.display = this._activeTab === 'mine' ? 'flex' : 'none';
            if (this._activeTab === 'mine') this._popularFiltroCategorias();
            modal.classList.remove('hidden');
            this._renderGrid();
            // Focus search
            setTimeout(() => document.getElementById('tpl-search')?.focus(), 50);
        },

        close() {
            document.getElementById('modal-prompt-templates')?.classList.add('hidden');
            this._fecharForm();
        },

        _getMyTemplates() {
            try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]'); }
            catch { return []; }
        },

        _salvarMeusTemplates(lista) {
            try { localStorage.setItem(this.STORAGE_KEY, JSON.stringify(lista)); return true; }
            catch (e) { console.warn('[PromptTemplates] falha ao salvar', e); return false; }
        },

        _popularFiltroCategorias() {
            const sel = document.getElementById('tpl-filtro-cat');
            if (!sel) return;
            const atual = sel.value;
            const cats = [...new Set(this._getMyTemplates().map(t => t.categoria).filter(Boolean))].sort();
            sel.innerHTML = `<option value="">Todas as categorias</option>` + cats.map(c => `<option value="${this._esc(c)}">${this._esc(c)}</option>`).join('');
            sel.value = cats.includes(atual) ? atual : '';
        },

        _popularSubcategorias(categoriaDigitada) {
            const dl = document.getElementById('tpl-subcategorias-sugeridas');
            if (!dl) return;
            const chave = Object.keys(CATEGORIAS_SUGERIDAS).find(c => c.toLowerCase() === (categoriaDigitada || '').trim().toLowerCase());
            const sugeridas = chave ? CATEGORIAS_SUGERIDAS[chave] : [];
            const usadas = this._getMyTemplates().filter(t => t.categoria === categoriaDigitada).map(t => t.subcategoria).filter(Boolean);
            const todas = [...new Set([...sugeridas, ...usadas])];
            dl.innerHTML = todas.map(s => `<option value="${this._esc(s)}">`).join('');
        },

        _renderGrid() {
            const grid = document.getElementById('tpl-grid');
            if (!grid) return;
            const search = (document.getElementById('tpl-search')?.value || '').toLowerCase();
            const filtroCat = document.getElementById('tpl-filtro-cat')?.value || '';
            let list = this._activeTab === 'madgicx' ? MADGICX_TEMPLATES : this._getMyTemplates();
            if (this._activeTab === 'mine' && filtroCat) list = list.filter(t => t.categoria === filtroCat);
            const filtered = !search ? list : list.filter(t => {
                const nome = (t.name || t.nome || '').toLowerCase();
                const desc = (t.description || t.prompt || '').toLowerCase();
                const tags = t.tags || [t.categoria, t.subcategoria].filter(Boolean);
                return nome.includes(search) || desc.includes(search) || tags.some(tg => tg.toLowerCase().includes(search));
            });

            if (!filtered.length) {
                if (this._activeTab === 'mine') {
                    grid.innerHTML = `<div class="adhub-empty" style="padding:2rem 0;grid-column:1/-1">
                        <i data-lucide="layout-template" style="width:36px;height:36px;color:var(--text-muted)"></i>
                        <h3>${search || filtroCat ? 'Nenhum resultado' : 'Sem prompts salvos ainda'}</h3>
                        <p>${search || filtroCat ? 'Tente outro termo ou categoria.' : 'Salve prompts que funcionam pra reutilizar depois.'}</p>
                    </div>`;
                } else {
                    grid.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:2rem 0;grid-column:1/-1">Nenhum template encontrado pra "${this._esc(search)}".</p>`;
                }
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch(e) {}
                return;
            }

            grid.innerHTML = filtered.map(t => this._activeTab === 'mine' ? this._cardHtmlMine(t) : this._cardHtmlMadgicx(t)).join('');
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch(e) {}

            grid.querySelectorAll('.tpl-card').forEach(card => {
                card.addEventListener('click', () => {
                    grid.querySelectorAll('.tpl-card').forEach(c => c.classList.remove('tpl-card-selected'));
                    card.classList.add('tpl-card-selected');
                    const id = card.dataset.tplId;
                    this._selected = filtered.find(t => t.id === id) || null;
                    const useBtn = document.getElementById('tpl-use');
                    if (useBtn) useBtn.disabled = !this._selected;
                });
                card.addEventListener('dblclick', () => {
                    const id = card.dataset.tplId;
                    this._selected = filtered.find(t => t.id === id) || null;
                    this._useSelected();
                });
            });

            grid.querySelectorAll('[data-tpl-editar]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const item = filtered.find(t => t.id === btn.dataset.tplEditar);
                    if (item) this._abrirForm(item);
                });
            });
            grid.querySelectorAll('[data-tpl-excluir]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._excluir(btn.dataset.tplExcluir);
                });
            });
        },

        _cardHtmlMadgicx(t) {
            return `<div class="tpl-card" data-tpl-id="${t.id}">
                <div class="tpl-card-icon"><i data-lucide="${t.icon || 'layout-template'}" style="width:20px;height:20px"></i></div>
                <div class="tpl-card-body">
                    <div class="tpl-card-name">${this._esc(t.name)}</div>
                    ${t.tags?.length ? `<div class="tpl-card-tags">${t.tags.map(tg => `<span class="tpl-tag">${this._esc(tg)}</span>`).join('')}</div>` : ''}
                    <div class="tpl-card-desc">${this._esc(t.description || '')}</div>
                </div>
            </div>`;
        },

        _cardHtmlMine(t) {
            const catTag = t.categoria ? `<span class="tpl-tag">${this._esc(t.categoria)}${t.subcategoria ? ' › ' + this._esc(t.subcategoria) : ''}</span>` : '';
            return `<div class="tpl-card" data-tpl-id="${t.id}">
                <div class="tpl-card-icon"><i data-lucide="sparkles" style="width:20px;height:20px"></i></div>
                <div class="tpl-card-body">
                    <div class="tpl-card-name">${this._esc(t.nome)}</div>
                    ${catTag ? `<div class="tpl-card-tags">${catTag}</div>` : ''}
                    <div class="tpl-card-desc">${this._esc(t.prompt)}</div>
                </div>
                <div class="tpl-card-actions">
                    <button type="button" class="btn-icon" data-tpl-editar="${t.id}" title="Editar"><i data-lucide="pencil" style="width:13px;height:13px"></i></button>
                    <button type="button" class="btn-icon" data-tpl-excluir="${t.id}" title="Excluir"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                </div>
            </div>`;
        },

        _abrirForm(item) {
            this._editandoId = item?.id || null;
            document.getElementById('tpl-form-id').value = item?.id || '';
            document.getElementById('tpl-form-nome').value = item?.nome || '';
            document.getElementById('tpl-form-categoria').value = item?.categoria || '';
            document.getElementById('tpl-form-subcategoria').value = item?.subcategoria || '';
            document.getElementById('tpl-form-prompt').value = item?.prompt || (item ? '' : this._prefill);
            const cats = [...new Set([...Object.keys(CATEGORIAS_SUGERIDAS), ...this._getMyTemplates().map(t => t.categoria).filter(Boolean)])];
            const dlCat = document.getElementById('tpl-categorias-sugeridas');
            if (dlCat) dlCat.innerHTML = cats.map(c => `<option value="${this._esc(c)}">`).join('');
            this._popularSubcategorias(item?.categoria || '');

            document.getElementById('tpl-form').style.display = 'flex';
            document.getElementById('tpl-grid').style.display = 'none';
            document.getElementById('tpl-search').style.display = 'none';
            document.getElementById('tpl-mine-toolbar').style.display = 'none';
            setTimeout(() => document.getElementById('tpl-form-nome')?.focus(), 30);
        },

        _fecharForm() {
            const form = document.getElementById('tpl-form');
            if (!form) return;
            form.style.display = 'none';
            document.getElementById('tpl-grid').style.display = '';
            document.getElementById('tpl-search').style.display = '';
            if (this._activeTab === 'mine') document.getElementById('tpl-mine-toolbar').style.display = 'flex';
            this._editandoId = null;
        },

        _salvarForm() {
            const nome = document.getElementById('tpl-form-nome').value.trim();
            const prompt = document.getElementById('tpl-form-prompt').value.trim();
            if (!nome || !prompt) { if (typeof showToast === 'function') showToast('Preencha nome e prompt', 'error'); return; }
            const categoria = document.getElementById('tpl-form-categoria').value.trim();
            const subcategoria = document.getElementById('tpl-form-subcategoria').value.trim();
            const lista = this._getMyTemplates();
            const id = document.getElementById('tpl-form-id').value || ('mt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5));
            const existente = lista.findIndex(t => t.id === id);
            const registro = { id, nome, categoria, subcategoria, prompt, criadoEm: existente >= 0 ? lista[existente].criadoEm : new Date().toISOString() };
            if (existente >= 0) lista[existente] = registro; else lista.unshift(registro);
            this._salvarMeusTemplates(lista);
            this._fecharForm();
            this._popularFiltroCategorias();
            this._renderGrid();
            if (typeof showToast === 'function') showToast(existente >= 0 ? 'Prompt atualizado' : 'Prompt salvo na biblioteca', 'success');
        },

        _excluir(id) {
            if (!confirm('Excluir este prompt da biblioteca?')) return;
            const lista = this._getMyTemplates().filter(t => t.id !== id);
            this._salvarMeusTemplates(lista);
            this._popularFiltroCategorias();
            this._renderGrid();
        },

        _useSelected() {
            if (!this._selected) return;
            const label = this._selected.name || this._selected.nome || '';
            if (this._onUse) {
                this._onUse(this._selected.prompt);
                this.close();
                if (typeof showToast === 'function') showToast(`Prompt "${label}" aplicado`, 'success');
                return;
            }
            const ta = document.getElementById('adhub-prompt-text');
            if (ta) {
                ta.value = this._selected.prompt;
                ta.dispatchEvent(new Event('input'));
                ta.focus();
            }
            this.close();
            if (typeof showToast === 'function') showToast(`Template "${label}" carregado`, 'success');
        },

        _esc(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.PromptTemplates = PromptTemplates;
    PromptTemplates.init();
})();
