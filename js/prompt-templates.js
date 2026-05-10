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
    ];

    const PromptTemplates = {
        STORAGE_KEY: 'etracker_my_templates',
        _selected: null,
        _activeTab: 'madgicx',

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
                    this._renderGrid();
                });
            });

            document.getElementById('tpl-search')?.addEventListener('input', () => this._renderGrid());

            // Close on overlay click
            document.querySelector('#modal-prompt-templates .modal-overlay')?.addEventListener('click', () => this.close());
        },

        open() {
            const modal = document.getElementById('modal-prompt-templates');
            if (!modal) return;
            this._selected = null;
            const useBtn = document.getElementById('tpl-use');
            if (useBtn) useBtn.disabled = true;
            modal.classList.remove('hidden');
            this._renderGrid();
            // Focus search
            setTimeout(() => document.getElementById('tpl-search')?.focus(), 50);
        },

        close() {
            document.getElementById('modal-prompt-templates')?.classList.add('hidden');
        },

        _getMyTemplates() {
            try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]'); }
            catch { return []; }
        },

        _renderGrid() {
            const grid = document.getElementById('tpl-grid');
            if (!grid) return;
            const search = (document.getElementById('tpl-search')?.value || '').toLowerCase();
            const list = this._activeTab === 'madgicx' ? MADGICX_TEMPLATES : this._getMyTemplates();
            const filtered = !search ? list : list.filter(t =>
                t.name.toLowerCase().includes(search) ||
                (t.description || '').toLowerCase().includes(search) ||
                (t.tags || []).some(tg => tg.toLowerCase().includes(search))
            );

            if (!filtered.length) {
                if (this._activeTab === 'mine') {
                    grid.innerHTML = `<div class="adhub-empty" style="padding:2rem 0;grid-column:1/-1">
                        <i data-lucide="layout-template" style="width:36px;height:36px;color:var(--text-muted)"></i>
                        <h3>Sem templates ainda</h3>
                        <p>Salve prompts que funcionam pra reutilizar depois.</p>
                    </div>`;
                } else {
                    grid.innerHTML = `<p style="text-align:center;color:var(--text-muted);padding:2rem 0;grid-column:1/-1">Nenhum template encontrado pra "${this._esc(search)}".</p>`;
                }
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch(e) {}
                return;
            }

            grid.innerHTML = filtered.map(t => `
                <div class="tpl-card" data-tpl-id="${t.id}">
                    <div class="tpl-card-icon"><i data-lucide="${t.icon || 'layout-template'}" style="width:20px;height:20px"></i></div>
                    <div class="tpl-card-body">
                        <div class="tpl-card-name">${this._esc(t.name)}</div>
                        ${t.tags?.length ? `<div class="tpl-card-tags">${t.tags.map(tg => `<span class="tpl-tag">${this._esc(tg)}</span>`).join('')}</div>` : ''}
                        <div class="tpl-card-desc">${this._esc(t.description || '')}</div>
                    </div>
                </div>
            `).join('');
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
        },

        _useSelected() {
            if (!this._selected) return;
            const ta = document.getElementById('adhub-prompt-text');
            if (ta) {
                ta.value = this._selected.prompt;
                ta.dispatchEvent(new Event('input'));
                ta.focus();
            }
            this.close();
            if (typeof showToast === 'function') showToast(`Template "${this._selected.name}" carregado`, 'success');
        },

        _esc(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.PromptTemplates = PromptTemplates;
    PromptTemplates.init();
})();
