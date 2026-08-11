/* ===========================
   Pipeline.js — Kanban para ciclo completo de produto
   Fluxo: Ideia → Validação → Pesquisa → Ângulos & Hooks → Criativos
          → Página → Teste Ads → Otimização → Escala → Kill
   =========================== */

const PipelineModule = {
    STORAGE_KEY: 'pipeline_cards',

    COLUMNS: [
        { id: 'ideia', title: '1. Ideia', icon: '<i data-lucide="lightbulb" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        { id: 'validacao', title: '2. Validação', icon: '<i data-lucide="check-circle-2" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        { id: 'pesquisa', title: '3. Pesquisa', icon: '<i data-lucide="search" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        { id: 'angulos', title: '4. Ângulos & Hooks', icon: '<i data-lucide="brain" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        { id: 'criativos', title: '5. Criativos', icon: '<i data-lucide="clapperboard" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        { id: 'pagina', title: '6. Página', icon: '<i data-lucide="shopping-cart" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        { id: 'teste_ads', title: '7. Teste Ads', icon: '<i data-lucide="megaphone" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        { id: 'otimizacao', title: '8. Otimização', icon: '<i data-lucide="settings" style="width:14px;height:14px;vertical-align:-2px"></i>️' },
        { id: 'escala', title: '9. Escala', icon: '<i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i>' },
        { id: 'kill', title: '10. Kill', icon: '<i data-lucide="skull" style="width:14px;height:14px;vertical-align:-2px"></i>' }
    ],
    FLOW_LABELS: {
        ideia: 'Ideia',
        validacao: 'Validação',
        pesquisa: 'Pesquisa',
        angulos: 'Ângulos',
        criativos: 'Criativos',
        pagina: 'Página',
        teste_ads: 'Teste',
        otimizacao: 'Otimização',
        escala: 'Escala',
        kill: 'Kill'
    },

    TAGS: [
        { id: 'winner', label: 'Winner', color: 'green' },
        { id: 'high-margin', label: 'High Margin', color: 'teal' },
        { id: 'trending', label: 'Trending', color: 'orange' },
        { id: 'saturated', label: 'Saturado', color: 'red' },
        { id: 'hook-forte', label: 'Hook forte', color: 'blue' },
        { id: 'hook-fraco', label: 'Hook fraco', color: 'red' },
        { id: 'ctr-bom', label: 'CTR bom', color: 'teal' },
        { id: 'sem-vendas', label: 'Sem vendas', color: 'red' },
        { id: 'escalando', label: 'Escalando', color: 'green' }
    ],

    DEACTIVATION_REASONS: [
        { id: 'not-validated', label: 'Não validou' },
        { id: 'low-margin', label: 'Margem ruim' },
        { id: 'high-cpa', label: 'CPA alto demais' },
        { id: 'no-sales', label: 'Sem vendas' },
        { id: 'creative-fatigue', label: 'Criativo saturado' },
        { id: 'other', label: 'Outro motivo' }
    ],

    CHECKLISTS: {
        ideia: {
            title: '1️⃣ Ideia',
            sections: [
                {
                    title: 'Objetivo',
                    subtitle: 'Registrar oportunidades de produto',
                    fields: [
                        { id: 'fonte', label: 'Fonte (TikTok / Amazon / Ads Library)', type: 'text', placeholder: 'Ex: TikTok Creative Center' },
                        { id: 'link_fornecedor', label: 'Link fornecedor', type: 'url', placeholder: 'https://...' },
                        { id: 'preco_fornecedor', label: 'Preço fornecedor', type: 'text', placeholder: 'Ex: 6,90 USD' },
                        { id: 'observacao', label: 'Observação', type: 'textarea', rows: 3, placeholder: 'Resumo da oportunidade...' }
                    ],
                    items: [
                        { id: 'ideia-problema-claro', label: 'Problema claro' },
                        { id: 'ideia-produto-leve', label: 'Produto leve' },
                        { id: 'ideia-preco-bom', label: 'Preço bom' },
                        { id: 'ideia-demo-visual', label: 'Demo visual' }
                    ]
                }
            ]
        },
        validacao: {
            title: '2️⃣ Validação de Produto',
            sections: [
                {
                    title: 'Decisão de investimento',
                    fields: [
                        { id: 'problema_visivel', label: 'Problema visível', type: 'textarea', rows: 2, placeholder: 'Qual dor aparece no vídeo?' },
                        { id: 'transformacao_clara', label: 'Transformação clara', type: 'textarea', rows: 2, placeholder: 'Antes e depois bem definidos?' },
                        { id: 'demo_facil', label: 'Demo fácil', type: 'select', options: ['Sim', 'Não', 'Parcial'] },
                        { id: 'preco_ideal', label: 'Preço ideal', type: 'text', placeholder: 'Ex: 39,90' },
                        { id: 'margem_possivel', label: 'Margem possível', type: 'text', placeholder: 'Ex: 68%' },
                        { id: 'potencial_viral', label: 'Score potencial viral (0-10)', type: 'number', placeholder: 'Ex: 7' }
                    ],
                    warn: '<i data-lucide="alert-triangle" style="width:14px;height:14px;vertical-align:-2px"></i>️ Regra: se o score ficar abaixo de 6, considerar mover para Kill.'
                }
            ]
        },
        pesquisa: {
            title: '3️⃣ Pesquisa de Mercado',
            sections: [
                {
                    title: 'Coleta de dados e insights',
                    fields: [
                        { id: 'links_anuncios', label: 'Links de anúncios', type: 'textarea', rows: 3, placeholder: '1 link por linha' },
                        { id: 'links_concorrentes', label: 'Links de concorrentes', type: 'textarea', rows: 3, placeholder: '1 link por linha' },
                        { id: 'reviews_amazon', label: 'Reviews Amazon', type: 'textarea', rows: 3, placeholder: 'Principais comentários/reclamações' },
                        { id: 'reviews_aliexpress', label: 'Reviews AliExpress', type: 'textarea', rows: 3, placeholder: 'Principais comentários/reclamações' },
                        { id: 'dores', label: 'Dores', type: 'textarea', rows: 2, placeholder: 'Quais dores se repetem?' },
                        { id: 'desejos', label: 'Desejos', type: 'textarea', rows: 2, placeholder: 'Quais desejos se repetem?' },
                        { id: 'objecoes', label: 'Objeções', type: 'textarea', rows: 2, placeholder: 'Quais objeções bloqueiam compra?' }
                    ]
                }
            ]
        },
        angulos: {
            title: '4️⃣ Ângulos & Hooks',
            sections: [
                {
                    title: 'Mensagem de marketing',
                    fields: [
                        { id: 'angulo_1', label: 'Ângulo 1', type: 'textarea', rows: 2, placeholder: 'Ex: conveniência no dia a dia' },
                        { id: 'angulo_2', label: 'Ângulo 2', type: 'textarea', rows: 2, placeholder: 'Ex: economia de tempo' },
                        { id: 'angulo_3', label: 'Ângulo 3', type: 'textarea', rows: 2, placeholder: 'Ex: prova social / autoridade' },
                        { id: 'hooks', label: 'Hooks (meta: 10)', type: 'textarea', rows: 6, placeholder: '1 hook por linha' },
                        { id: 'promessa_principal', label: 'Transformação principal', type: 'textarea', rows: 2, placeholder: 'Promessa central do produto' },
                        { id: 'scripts_ia', label: 'Scripts base', type: 'textarea', rows: 5, placeholder: 'Scripts para criativos' }
                    ],
                    aiActions: [
                        { id: 'generate_angles', label: 'Gerar Ângulos', targetField: 'angulo_1' },
                        { id: 'generate_hooks', label: 'Gerar Hooks', targetField: 'hooks' },
                        { id: 'generate_scripts', label: 'Gerar Scripts', targetField: 'scripts_ia' }
                    ],
                    items: [
                        { id: 'angulos-3-definidos', label: '3 ângulos definidos' },
                        { id: 'angulos-10-hooks', label: '10 hooks escritos' }
                    ]
                }
            ]
        },
        criativos: {
            title: '5️⃣ Criativos',
            sections: [
                {
                    title: 'Produção',
                    fields: [
                        { id: 'tipo_criativo', label: 'Tipo criativo', type: 'text', placeholder: 'Ex: UGC, Demonstrativo, POV' },
                        { id: 'hook_principal', label: 'Hook principal', type: 'text', placeholder: 'Abertura principal' },
                        { id: 'estrutura', label: 'Estrutura', type: 'textarea', rows: 3, placeholder: 'Hook <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> Problema <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> Solução <i data-lucide="arrow-right" style="width:14px;height:14px;vertical-align:-2px"></i> CTA' },
                        { id: 'video', label: 'Vídeo (link ou referência)', type: 'textarea', rows: 2, placeholder: 'Links de vídeo ou nomes de arquivo' },
                        { id: 'qtd_criativos', label: 'Quantidade de criativos', type: 'number', placeholder: 'Meta 5-10' },
                        { id: 'hook_status', label: 'Status do hook', type: 'select', options: ['Hook forte', 'Hook fraco', 'Neutro'] }
                    ],
                    aiActions: [
                        { id: 'generate_scripts', label: 'Gerar Scripts', targetField: 'estrutura' }
                    ],
                    items: [
                        { id: 'criativos-5-hooks', label: 'Checklist: 5 hooks' },
                        { id: 'criativos-3-angulos', label: 'Checklist: 3 ângulos' },
                        { id: 'criativos-5-videos', label: 'Checklist: 5 vídeos' }
                    ]
                }
            ]
        },
        pagina: {
            title: '6️⃣ Página',
            sections: [
                {
                    title: 'Checklist da página',
                    fields: [
                        { id: 'link_pagina', label: 'Link da página', type: 'url', placeholder: 'https://...' }
                    ],
                    items: [
                        { id: 'pagina-hero', label: 'Hero' },
                        { id: 'pagina-beneficios', label: 'Benefícios' },
                        { id: 'pagina-demo', label: 'Demo' },
                        { id: 'pagina-reviews', label: 'Reviews' },
                        { id: 'pagina-oferta', label: 'Oferta' },
                        { id: 'pagina-faq', label: 'FAQ' }
                    ]
                }
            ]
        },
        teste_ads: {
            title: '7️⃣ Teste Ads',
            sections: [
                {
                    title: 'Métricas iniciais',
                    fields: [
                        { id: 'budget', label: 'Budget', type: 'text', placeholder: 'Ex: 150 USD/dia' },
                        { id: 'criativos_testados', label: 'Criativos testados', type: 'text', placeholder: 'Ex: 6' },
                        { id: 'ctr', label: 'CTR (%)', type: 'number', placeholder: 'Ex: 2.3' },
                        { id: 'cpc', label: 'CPC', type: 'text', placeholder: 'Ex: 0.78' },
                        { id: 'atc', label: 'ATC (%)', type: 'number', placeholder: 'Ex: 8.2' },
                        { id: 'vendas', label: 'Vendas', type: 'number', placeholder: 'Ex: 3' },
                        { id: 'roas', label: 'ROAS', type: 'number', placeholder: 'Ex: 1.9' }
                    ]
                }
            ]
        },
        otimizacao: {
            title: '8️⃣ Otimização',
            sections: [
                {
                    title: 'Próximas ações',
                    fields: [
                        { id: 'novo_criativo', label: 'Novo criativo', type: 'textarea', rows: 2, placeholder: 'O que será testado?' },
                        { id: 'novo_angulo', label: 'Novo ângulo', type: 'textarea', rows: 2, placeholder: 'Qual novo ângulo?' },
                        { id: 'novo_hook', label: 'Novo hook', type: 'textarea', rows: 2, placeholder: 'Qual nova abertura?' }
                    ],
                    items: [
                        { id: 'otim-hipotese', label: 'Hipótese definida para próximo teste' }
                    ]
                }
            ]
        },
        escala: {
            title: '9️⃣ Escala',
            sections: [
                {
                    title: 'Escala controlada',
                    fields: [
                        { id: 'cpa', label: 'CPA', type: 'text', placeholder: 'Ex: 18,30' },
                        { id: 'roas', label: 'ROAS', type: 'number', placeholder: 'Ex: 2.4' },
                        { id: 'budget_diario', label: 'Budget diário', type: 'text', placeholder: 'Ex: 500 USD' },
                        { id: 'mercados_ativos', label: 'Mercados ativos', type: 'textarea', rows: 2, placeholder: 'Ex: BR, MX, CO' }
                    ]
                }
            ]
        },
        kill: {
            title: '<i data-lucide="list-ordered" style="width:14px;height:14px;vertical-align:-2px"></i> Kill',
            sections: [
                {
                    title: 'Post-mortem',
                    fields: [
                        { id: 'falha', label: 'Por que falhou', type: 'textarea', rows: 2, placeholder: 'Principal motivo' },
                        { id: 'criativos_tentados', label: 'Criativos testados', type: 'textarea', rows: 2, placeholder: 'Resumo do que foi tentado' },
                        { id: 'licoes', label: 'Lições', type: 'textarea', rows: 3, placeholder: 'O que reaproveitar nos próximos produtos?' }
                    ]
                }
            ]
        }
    },

    cards: [],
    editingId: null,
    draggedId: null,
    checklistCardId: null,
    checklistColumnId: null,
    _pendingDeactivation: null,
    _supplierAutofillBusy: false,
    _modalPhotos: [],
    _modalCustomTags: [],
    PHOTO_MAX_COUNT: 6,
    PHOTO_MAX_WIDTH: 1200,
    PHOTO_MAX_BYTES: 280 * 1024,

    init() {
        if (!document.getElementById('kanban-board')) return;
        this.cards = this.load();
        this.migrateLegacyCards();
        this.bindEvents();
        this.render();
        if (typeof EventBus !== 'undefined') EventBus.emit('pipelineChanged');

        // Sync: when a product is created, auto-create pipeline card in "Ideia"
        if (typeof EventBus !== 'undefined') {
            EventBus.on('productsChanged', () => this._syncProductsToPipeline());
            // On data loaded, sync both directions
            EventBus.on('dataLoaded', () => {
                this._syncPipelineToProducts();
                this._syncProductsToPipeline();
            });
        }
    },

    // Sync existing pipeline cards -> Products (for cards that already exist but have no product)
    async _syncPipelineToProducts() {
        let synced = false;

        for (const card of this.cards) {
            if (card.columnId === 'kill') continue;

            // Already has a valid product linked
            const existingProduct = (AppState.allProducts || []).find(p => p.id === card.productId);
            if (existingProduct) continue;

            // Check if a product with the same name already exists in the same store
            const normalizedName = this._normalizeName(card.title);
            const sameNameProduct = (AppState.allProducts || []).find(p =>
                this._normalizeName(p.name) === normalizedName &&
                String(p.storeId || '') === String(card.storeId || getWritableStoreId() || '')
            );

            if (sameNameProduct) {
                // Link the card to the existing product
                card.productId = sameNameProduct.id;
                synced = true;
                continue;
            }

            // Create a new product from the pipeline card
            let targetStoreId = String(card.storeId || '').trim();
            if (!targetStoreId && typeof getWritableStoreId === 'function') {
                targetStoreId = String(getWritableStoreId() || '').trim();
            }
            if (!targetStoreId) continue;

            const supplierCostNum = Number(card?.supplier?.cost);
            const supplierCost = Number.isFinite(supplierCostNum) && supplierCostNum >= 0
                ? parseFloat(supplierCostNum.toFixed(2)) : 0;
            const supplierCurrency = this.normalizeCurrency(card?.supplier?.costCurrency || 'USD');
            const nowIso = new Date().toISOString();

            const product = {
                id: generateId('prod'),
                name: String(card.title || '').trim(),
                language: 'Ingles',
                price: 0,
                priceCurrency: 'USD',
                cost: supplierCost,
                costCurrency: supplierCurrency,
                tax: 0,
                variableCosts: 0,
                cpa: 0,
                cpaCurrency: supplierCurrency,
                status: 'ativo',
                storeId: targetStoreId,
                createdAt: nowIso,
                updatedAt: nowIso
            };

            AppState.allProducts = Array.isArray(AppState.allProducts) ? AppState.allProducts : [];
            AppState.allProducts.push(product);
            card.productId = product.id;
            card.storeId = targetStoreId;
            synced = true;
        }

        if (synced) {
            this.save();
            filterDataByStore();
            populateProductDropdowns();
            if (typeof ProductsModule !== 'undefined') ProductsModule.render();
            if (typeof EventBus !== 'undefined') EventBus.emit('productsChanged');
        }
    },

    _syncProductsToPipeline() {
        if (!Array.isArray(AppState?.allProducts)) return;
        let added = false;

        AppState.allProducts.forEach(product => {
            if (product.status !== 'ativo') return;
            // Check if any card already references this product
            const hasCard = this.cards.some(c =>
                c.productId === product.id ||
                (this._normalizeName(c.title) === this._normalizeName(product.name) &&
                 String(c.storeId || '') === String(product.storeId || ''))
            );
            if (hasCard) return;

            const nowIso = new Date().toISOString();
            const card = {
                id: generateId('pipe'),
                columnId: 'ideia',
                title: product.name,
                notes: '',
                endDate: '',
                tags: [],
                customTags: [],
                supplier: { url: '', cost: product.cost || 0, costCurrency: product.costCurrency || 'USD', functions: '', meta: '' },
                typedLinks: { product: '', final: '', copy: '', research: '' },
                extraLinks: [],
                videos: [],
                photos: [],
                checklists: {},
                productId: product.id,
                storeId: product.storeId || '',
                createdAt: nowIso,
                updatedAt: nowIso,
                order: this.cards.filter(c => c.columnId === 'ideia').length
            };
            this._normalizeCardSchema(card);
            this.initChecklist(card, 'ideia');
            this.cards.push(card);
            added = true;
        });

        if (added) {
            this.save();
            this.render();
        }
    },

    bindEvents() {
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };

        on('pipeline-btn-save', () => this.saveCard());
        on('pipeline-modal-close', () => closeModal('pipeline-modal'));
        on('pipeline-cancel', () => closeModal('pipeline-modal'));
        on('pipeline-btn-delete', () => this.deleteCard());
        on('btn-add-extra-link', () => this.addFieldRow('pipeline-extra-links-list', { mode: 'extra' }));
        on('btn-add-video', () => this.addFieldRow('pipeline-videos-list', 'https://youtube.com/...'));
        on('btn-add-tag', () => this.handleAddCustomTag());
        on('pipeline-supplier-autofill', () => this.handleSupplierAutofill());
        const photoInput = document.getElementById('pipeline-photo-input');
        if (photoInput) {
            photoInput.addEventListener('change', (event) => {
                this.handlePhotoInputChange(event);
            });
        }
        const newTagInput = document.getElementById('pipeline-new-tag');
        if (newTagInput) {
            newTagInput.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                this.handleAddCustomTag();
            });
        }
        on('btn-pipeline-csv', () => {
            closeModal('pipeline-modal');
            const diaryBtn = document.querySelector('[data-tab="diary"]');
            if (diaryBtn) diaryBtn.click();
        });

        on('pipeline-btn-checklist', () => {
            const card = this.cards.find(c => c.id === this.editingId);
            if (!card) return;
            closeModal('pipeline-modal');
            setTimeout(() => this.openChecklistModal(card.id, card.columnId), 180);
        });

        const form = document.getElementById('pipeline-form');
        if (form) {
            form.addEventListener('click', (event) => {
                const btn = event.target?.closest?.('[data-action="open-input-link"], [data-action="open-row-link"]');
                if (!btn) return;
                event.preventDefault();
                event.stopPropagation();

                if (btn.dataset.action === 'open-input-link') {
                    const inputId = String(btn.dataset.inputId || '').trim();
                    if (!inputId) return;
                    this._openLinkFromInput(document.getElementById(inputId));
                    return;
                }

                if (btn.dataset.action === 'open-row-link') {
                    const row = btn.closest('.field-row-extra');
                    const input = row?.querySelector?.('.field-row-url');
                    this._openLinkFromInput(input);
                }
            });
        }

        on('checklist-modal-close', () => this.closeChecklist());
        on('checklist-btn-done', () => this.closeChecklist());

        on('deactivate-modal-close', () => this.cancelDeactivation());
        on('deactivate-btn-cancel', () => this.cancelDeactivation());
        on('deactivate-btn-confirm', () => this.confirmDeactivation());

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            const pm = document.getElementById('pipeline-modal');
            const cm = document.getElementById('pipeline-checklist-modal');
            const dm = document.getElementById('pipeline-deactivate-modal');
            if (dm && !dm.classList.contains('hidden')) this.cancelDeactivation();
            else if (cm && !cm.classList.contains('hidden')) this.closeChecklist();
            else if (pm && !pm.classList.contains('hidden')) closeModal('pipeline-modal');
        });

        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (tab) => {
                if (tab === 'pipeline') this.render();
            });
        }
    },

    load() {
        try {
            const raw = JSON.parse(localStorage.getItem(this.STORAGE_KEY));
            if (Array.isArray(raw)) return raw;
            if (raw && Array.isArray(raw.cards)) return raw.cards;
            return [];
        } catch {
            return [];
        }
    },

    save() {
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify({ cards: this.cards }));
            if (typeof EventBus !== 'undefined') EventBus.emit('pipelineChanged');
            return true;
        } catch (error) {
            console.error('Falha ao salvar pipeline no localStorage', error);
            if (typeof showToast === 'function') {
                showToast('Não foi possível salvar. Limite local atingido, reduza fotos anexadas.', 'error');
            }
            return false;
        }
    },

    migrateLegacyCards() {
        const map = {
            ideias: 'ideia',
            pesquisa: 'pesquisa',
            criativo: 'criativos',
            testando: 'teste_ads',
            escala: 'escala',
            desativados: 'kill'
        };

        const validColumnIds = new Set(this.COLUMNS.map(c => c.id));
        let changed = false;

        this.cards.forEach(card => {
            if (!card || typeof card !== 'object') return;
            const mapped = map[card.columnId] || card.columnId;
            if (mapped !== card.columnId) {
                card.columnId = mapped;
                changed = true;
            }
            if (!validColumnIds.has(card.columnId)) {
                card.columnId = 'ideia';
                changed = true;
            }
            if (!card.checklists || typeof card.checklists !== 'object') {
                card.checklists = {};
                changed = true;
            }
            if (this._normalizeCardSchema(card)) {
                changed = true;
            }
            const def = this.CHECKLISTS[card.columnId];
            if (def) {
                this.initChecklist(card, card.columnId);
            }
        });

        if (changed) this.save();
    },

    render() {
        const board = document.getElementById('kanban-board');
        if (!board) return;
        board.innerHTML = '';
        let changed = false;
        const flowSummaryParts = [];

        this.COLUMNS.forEach(col => {
            const colCards = this.cards
                .filter(c => c.columnId === col.id)
                .sort((a, b) => (a.order || 0) - (b.order || 0));
            const flowLabel = this.FLOW_LABELS[col.id] || col.title;
            flowSummaryParts.push(`${flowLabel} (${colCards.length})`);

            const colEl = document.createElement('div');
            colEl.className = 'kanban-col' + (col.id === 'kill' ? ' kanban-col-deactivated' : '');

            const header = document.createElement('div');
            header.className = 'kanban-col-header';
            const count = colCards.length;
            const cardLabel = count === 1 ? 'card' : 'cards';
            header.innerHTML = `
                <div class="kanban-col-title">
                    <span class="kanban-col-title-text">${col.icon} ${col.title}</span>
                    <span class="kanban-col-count" title="${count} ${cardLabel}">${count}</span>
                </div>
                ${col.id !== 'kill' ? '<button class="kanban-col-add" title="Adicionar card">+</button>' : ''}
            `;
            const addBtn = header.querySelector('.kanban-col-add');
            if (addBtn) addBtn.addEventListener('click', () => this.openModal(col.id));
            colEl.appendChild(header);

            const container = document.createElement('div');
            container.className = 'kanban-cards';
            container.dataset.column = col.id;
            container.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });
            container.addEventListener('dragenter', (e) => {
                e.preventDefault();
                container.classList.add('drag-over');
            });
            container.addEventListener('dragleave', (e) => {
                if (!container.contains(e.relatedTarget)) container.classList.remove('drag-over');
            });
            container.addEventListener('drop', async (e) => {
                e.preventDefault();
                container.classList.remove('drag-over');
                try {
                    await this.handleDrop(col.id);
                } catch (err) {
                    showToast(`Falha ao mover card: ${err.message}`, 'error');
                }
            });

            colCards.forEach(card => {
                if (this._normalizeCardSchema(card)) changed = true;
                container.appendChild(this.renderCard(card, col.id));
            });
            colEl.appendChild(container);
            board.appendChild(colEl);
        });

        this.updateFlowSummary(flowSummaryParts);

        if (changed) this.save();
    },

    updateFlowSummary(parts) {
        const flowEl = document.getElementById('pipeline-flow-summary');
        if (!flowEl) return;
        const arrow = '<i data-lucide="arrow-right" style="width:12px;height:12px;vertical-align:-2px;color:var(--text-muted)"></i>';
        if (!Array.isArray(parts) || parts.length === 0) {
            const defaults = ['Ideia','Validação','Pesquisa','Ângulos','Criativos','Página','Teste','Otimização','Escala','Kill'];
            flowEl.innerHTML = defaults.join(' ' + arrow + ' ');
        } else {
            flowEl.innerHTML = parts.map(p => String(p).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))).join(' ' + arrow + ' ');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    },

    renderCard(card, columnId) {
        const el = document.createElement('div');
        el.className = 'kanban-card';
        el.draggable = true;
        el.dataset.cardId = card.id;

        const progress = this.getChecklistProgress(card, columnId);
        if (progress.total > 0 && progress.checked === progress.total) {
            el.classList.add('kanban-card-complete');
        }

        el.addEventListener('dragstart', (e) => {
            this.draggedId = card.id;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', card.id);
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            this.draggedId = null;
            document.querySelectorAll('.kanban-cards.drag-over').forEach(z => z.classList.remove('drag-over'));
        });
        el.addEventListener('click', () => this.openModal(columnId, card.id));

        const tagOptions = this.getTagOptions(card);
        const tagsHtml = (card.tags || []).map(tagId => {
            const t = tagOptions.find(x => x.id === tagId);
            return t ? `<span class="kanban-tag kanban-tag-${t.color}">${this.escapeHtml(t.label)}</span>` : '';
        }).join('');

        const statusBadges = this.getStatusBadges(card).map(b => (
            `<span class="kanban-status-badge ${b.tone}">${this.escapeHtml(b.label)}</span>`
        )).join('');

        const linkCount = this.getCardLinkCount(card);
        const videoCount = (card.videos || []).length;
        const photoCount = (card.photos || []).length;
        const functionsCount = this.countSupplierFunctions(card);
        const supplierCost = Number(card?.supplier?.cost);
        const hasSupplierCost = Number.isFinite(supplierCost) && supplierCost > 0;
        let meta = '';
        if (linkCount) meta += `<span><i data-lucide="link" style="width:14px;height:14px;vertical-align:-2px"></i> ${linkCount}</span>`;
        if (videoCount) meta += `<span><i data-lucide="clapperboard" style="width:14px;height:14px;vertical-align:-2px"></i> ${videoCount}</span>`;
        if (photoCount) meta += `<span><i data-lucide="image" style="width:14px;height:14px;vertical-align:-2px"></i>️ ${photoCount}</span>`;
        if (hasSupplierCost) {
            meta += `<span><i data-lucide="banknote" style="width:14px;height:14px;vertical-align:-2px"></i> ${this.escapeHtml(formatCurrency(supplierCost, this.normalizeCurrency(card?.supplier?.costCurrency || 'USD')))}</span>`;
        }
        if (functionsCount) meta += `<span><i data-lucide="settings" style="width:14px;height:14px;vertical-align:-2px"></i>️ ${functionsCount}</span>`;
        if (String(card?.endDate || '').trim()) {
            const overdue = this.isOverdueDate(card.endDate);
            meta += `<span class="kanban-meta-due${overdue ? ' overdue' : ''}"><i data-lucide="calendar" style="width:14px;height:14px;vertical-align:-2px"></i> ${this.escapeHtml(formatDate(card.endDate))}</span>`;
        }

        let killBadge = '';
        if (columnId === 'kill' && card.deactivationReason) {
            const reason = this.DEACTIVATION_REASONS.find(r => r.id === card.deactivationReason);
            if (reason) killBadge = `<span class="kanban-deactivate-reason">${this.escapeHtml(reason.label)}</span>`;
        }

        let progressHtml = '';
        if (progress.total > 0 && columnId !== 'kill') {
            const pct = Math.round((progress.checked / progress.total) * 100);
            progressHtml = `
                <div class="kanban-card-progress-wrap">
                    <div class="kanban-card-progress-bar" style="width:${pct}%"></div>
                </div>
                <div class="kanban-card-progress-text"><i data-lucide="check" style="width:14px;height:14px;vertical-align:-2px"></i> ${progress.checked}/${progress.total}</div>
            `;
        }

        let csvBtn = '';
        if (columnId === 'teste_ads') {
            csvBtn = '<button class="kanban-csv-link" data-action="csv"><i data-lucide="clipboard-list" style="width:14px;height:14px;vertical-align:-2px"></i> Diário</button>';
        }

        const linkActions = [];
        const addLinkAction = (label, url, icon = '<i data-lucide="link" style="width:14px;height:14px;vertical-align:-2px"></i>') => {
            const safeUrl = this._safeOpenUrl(url);
            if (!safeUrl) return;
            linkActions.push(
                `<a class="kanban-link-btn" data-action="open-link" data-link="${this.escapeHtml(safeUrl)}" href="${this.escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" title="${this.escapeHtml(label)}">${icon} ${this.escapeHtml(label)}</a>`
            );
        };
        addLinkAction('Produto', card?.typedLinks?.product || '', '<i data-lucide="shopping-cart" style="width:14px;height:14px;vertical-align:-2px"></i>');
        addLinkAction('Final', card?.typedLinks?.final || '', '<i data-lucide="target" style="width:14px;height:14px;vertical-align:-2px"></i>');
        addLinkAction('Copy', card?.typedLinks?.copy || '', '<i data-lucide="pencil" style="width:14px;height:14px;vertical-align:-2px"></i>️');
        addLinkAction('Pesquisa', card?.typedLinks?.research || '', '<i data-lucide="search" style="width:14px;height:14px;vertical-align:-2px"></i>');
        (Array.isArray(card?.extraLinks) ? card.extraLinks : []).forEach((item, idx) => {
            const label = String(item?.label || `Extra ${idx + 1}`).trim() || `Extra ${idx + 1}`;
            addLinkAction(label, item?.url || '', '<i data-lucide="link" style="width:14px;height:14px;vertical-align:-2px"></i>');
        });

        el.innerHTML = `
            ${tagsHtml ? `<div class="kanban-card-tags">${tagsHtml}</div>` : ''}
            ${statusBadges ? `<div class="kanban-status-badges">${statusBadges}</div>` : ''}
            ${killBadge}
            <div class="kanban-card-title">${this.escapeHtml(card.title)}</div>
            ${card.notes ? `<div class="kanban-card-notes">${this.escapeHtml(card.notes)}</div>` : ''}
            ${meta ? `<div class="kanban-card-meta">${meta}</div>` : ''}
            ${linkActions.length ? `<div class="kanban-link-actions">${linkActions.join('')}</div>` : ''}
            ${progressHtml}
            ${csvBtn}
        `;

        const csvBtnEl = el.querySelector('[data-action="csv"]');
        if (csvBtnEl) {
            csvBtnEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const diaryBtn = document.querySelector('[data-tab="diary"]');
                if (diaryBtn) diaryBtn.click();
            });
        }

        el.querySelectorAll('[data-action="open-link"]').forEach(link => {
            link.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });

        return el;
    },

    getStatusBadges(card) {
        const badges = [];

        const score = this.parseNumber(this.getChecklistField(card, 'validacao', 'potencial_viral'));
        if (score > 0) {
            if (score >= 7) badges.push({ label: `Potencial ${score.toFixed(1).replace('.', ',')}/10`, tone: 'green' });
            else if (score < 6) badges.push({ label: `Potencial ${score.toFixed(1).replace('.', ',')}/10`, tone: 'red' });
            else badges.push({ label: `Potencial ${score.toFixed(1).replace('.', ',')}/10`, tone: 'orange' });
        }

        const hookStatus = this.getChecklistField(card, 'criativos', 'hook_status');
        if (hookStatus === 'Hook forte') badges.push({ label: 'Hook forte', tone: 'blue' });
        if (hookStatus === 'Hook fraco') badges.push({ label: 'Hook fraco', tone: 'red' });

        const ctr = this.parseNumber(this.getChecklistField(card, 'teste_ads', 'ctr'));
        const vendas = this.parseNumber(this.getChecklistField(card, 'teste_ads', 'vendas'));
        const roas = this.parseNumber(this.getChecklistField(card, 'teste_ads', 'roas'));

        if (ctr >= 2) badges.push({ label: 'CTR bom', tone: 'teal' });
        if (ctr > 0 && vendas <= 0) badges.push({ label: 'Sem vendas', tone: 'red' });
        if (roas >= 2 || vendas >= 5) badges.push({ label: 'Escalando', tone: 'green' });

        return badges;
    },

    getChecklistProgress(card, columnId) {
        const stage = card?.checklists?.[columnId];
        if (!stage || !Array.isArray(stage.items)) return { checked: 0, total: 0 };
        const checked = stage.items.filter(i => i.checked).length;
        return { checked, total: stage.items.length };
    },

    async handleDrop(targetColumnId) {
        if (!this.draggedId) return;
        const card = this.cards.find(c => c.id === this.draggedId);
        if (!card) return;

        const previousColumn = card.columnId;

        if (targetColumnId === 'kill' && previousColumn !== 'kill') {
            this._pendingDeactivation = { cardId: card.id, fromColumn: previousColumn };
            this.openDeactivationModal(card);
            return;
        }

        this.moveCard(card, targetColumnId);

        if ((targetColumnId === 'angulos' || targetColumnId === 'teste_ads') && previousColumn !== targetColumnId) {
            await this._ensureProductForTestAds(card);
        }

        if (previousColumn !== targetColumnId && targetColumnId !== 'kill') {
            this.initChecklist(card, targetColumnId);
            this.save();
            this.openChecklistModal(card.id, targetColumnId);
        }
    },

    moveCard(card, targetColumnId) {
        card.columnId = targetColumnId;
        card.updatedAt = new Date().toISOString();
        const siblings = this.cards.filter(c => c.columnId === targetColumnId && c.id !== card.id);
        card.order = siblings.length ? Math.max(...siblings.map(c => c.order || 0)) + 1 : 0;
        this.save();
        this.render();
    },

    openDeactivationModal(card) {
        const nameEl = document.getElementById('deactivate-card-name');
        const select = document.getElementById('deactivate-reason');
        const notes = document.getElementById('deactivate-notes');
        if (!nameEl || !select || !notes) {
            this.moveCard(card, 'kill');
            return;
        }

        nameEl.textContent = card.title;
        select.innerHTML = '<option value="">Selecione o motivo...</option>';
        this.DEACTIVATION_REASONS.forEach(r => {
            select.innerHTML += `<option value="${r.id}">${this.escapeHtml(r.label)}</option>`;
        });
        notes.value = '';
        openModal('pipeline-deactivate-modal');
    },

    confirmDeactivation() {
        const pending = this._pendingDeactivation;
        if (!pending) return;

        const reasonEl = document.getElementById('deactivate-reason');
        const notesEl = document.getElementById('deactivate-notes');
        if (!reasonEl || !notesEl) return;

        const reason = reasonEl.value;
        if (!reason) {
            reasonEl.focus();
            return;
        }

        const card = this.cards.find(c => c.id === pending.cardId);
        if (!card) return;

        card.deactivationReason = reason;
        card.deactivationNotes = (notesEl.value || '').trim();
        this.moveCard(card, 'kill');

        this._pendingDeactivation = null;
        closeModal('pipeline-deactivate-modal');
    },

    cancelDeactivation() {
        this._pendingDeactivation = null;
        closeModal('pipeline-deactivate-modal');
    },

    initChecklist(card, columnId) {
        if (!card.checklists || typeof card.checklists !== 'object') card.checklists = {};
        const def = this.CHECKLISTS[columnId];
        if (!def) return;

        if (!card.checklists[columnId]) {
            card.checklists[columnId] = { items: [], fields: {} };
        }

        const stage = card.checklists[columnId];
        if (!Array.isArray(stage.items)) stage.items = [];
        if (!stage.fields || typeof stage.fields !== 'object') stage.fields = {};

        const expectedIds = def.sections.flatMap(section => (section.items || []).map(item => item.id));
        expectedIds.forEach(id => {
            if (!stage.items.find(it => it.id === id)) {
                stage.items.push({ id, checked: false });
            }
        });
    },

    getChecklistField(card, columnId, fieldId) {
        return String(card?.checklists?.[columnId]?.fields?.[fieldId] || '').trim();
    },

    openChecklistModal(cardId, columnId) {
        const card = this.cards.find(c => c.id === cardId);
        if (!card) return;
        const def = this.CHECKLISTS[columnId];
        if (!def) return;

        this.checklistCardId = cardId;
        this.checklistColumnId = columnId;
        this.initChecklist(card, columnId);
        const stage = card.checklists[columnId];

        const titleEl = document.getElementById('checklist-modal-title');
        const body = document.getElementById('checklist-modal-body');
        if (!titleEl || !body) return;

        titleEl.textContent = def.title;
        body.innerHTML = '';

        const progress = this.getChecklistProgress(card, columnId);
        const pct = progress.total > 0 ? Math.round((progress.checked / progress.total) * 100) : 0;
        body.innerHTML += `
            <div class="checklist-progress">
                <div class="checklist-progress-bar">
                    <div class="checklist-progress-fill" style="width:${pct}%"></div>
                </div>
                <span class="checklist-progress-text">${progress.checked}/${progress.total} concluídos</span>
            </div>
        `;

        if (columnId === 'teste_ads') {
            body.innerHTML += `
                <div class="checklist-import-box">
                    <div class="checklist-import-title">Importar métricas iniciais</div>
                    <div class="checklist-import-subtitle">Use o mesmo importador CSV/XLSX do Diagnóstico para preencher automaticamente.</div>
                    <div class="checklist-import-actions">
                        <button type="button" class="btn btn-secondary btn-sm" id="checklist-import-facebook-btn"><i data-lucide="download" style="width:14px;height:14px;vertical-align:-2px"></i> Importar CSV/XLSX</button>
                        <input type="file" id="checklist-import-facebook-input" accept=".csv,.xlsx,.xls" style="display:none;">
                    </div>
                </div>
            `;
        }

        def.sections.forEach(section => {
            const secEl = document.createElement('div');
            secEl.className = 'checklist-section';

            let html = `<div class="checklist-section-title">${this.escapeHtml(section.title)}</div>`;
            if (section.subtitle) html += `<div class="checklist-section-subtitle">${this.escapeHtml(section.subtitle)}</div>`;
            if (section.warn) html += `<div class="checklist-warn">${this.escapeHtml(section.warn)}</div>`;

            (section.items || []).forEach(item => {
                const saved = stage.items.find(i => i.id === item.id);
                const checked = saved ? saved.checked : false;
                html += `
                    <label class="checklist-item${checked ? ' checked' : ''}" data-item-id="${item.id}">
                        <input type="checkbox" ${checked ? 'checked' : ''}>
                        <span>${this.escapeHtml(item.label)}</span>
                    </label>
                `;
            });

            (section.fields || []).forEach(field => {
                html += '<div class="checklist-field">';
                html += `<label class="checklist-field-label">${this.escapeHtml(field.label)}</label>`;
                const val = String(stage.fields[field.id] || '');
                const placeholder = this.escapeHtml(field.placeholder || '');

                if (field.type === 'textarea') {
                    const rows = Number(field.rows || 3);
                    html += `<textarea class="checklist-textarea" data-field="${field.id}" rows="${rows}" placeholder="${placeholder}">${this.escapeHtml(val)}</textarea>`;
                } else if (field.type === 'select') {
                    html += `<select class="checklist-input" data-field="${field.id}">`;
                    html += '<option value="">Selecione...</option>';
                    (field.options || []).forEach(opt => {
                        const selected = val === opt ? 'selected' : '';
                        html += `<option value="${this.escapeHtml(opt)}" ${selected}>${this.escapeHtml(opt)}</option>`;
                    });
                    html += '</select>';
                } else {
                    const inputType = field.type === 'number' ? 'text' : (field.type || 'text');
                    html += `<input class="checklist-input" type="${inputType}" data-field="${field.id}" value="${this.escapeHtml(val)}" placeholder="${placeholder}">`;
                }
                html += '</div>';
            });

            if (section.aiActions && section.aiActions.length > 0) {
                html += '<div class="checklist-ai-actions">';
                section.aiActions.forEach(action => {
                    html += `<button type="button" class="btn btn-secondary btn-sm checklist-ai-btn" data-ai-action="${action.id}" data-target-field="${action.targetField}"><i data-lucide="sparkles" style="width:14px;height:14px;vertical-align:-2px"></i> ${this.escapeHtml(action.label)}</button>`;
                });
                html += '</div>';
            }

            if (section.hint) html += `<div class="checklist-hint"><i data-lucide="lightbulb" style="width:14px;height:14px;vertical-align:-2px"></i> ${this.escapeHtml(section.hint)}</div>`;

            secEl.innerHTML = html;
            body.appendChild(secEl);
        });

        body.querySelectorAll('.checklist-item input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const itemId = e.target.closest('.checklist-item').dataset.itemId;
                this.toggleChecklistItem(itemId, e.target.checked);
            });
        });

        body.querySelectorAll('[data-field]').forEach(input => {
            const evt = input.tagName === 'SELECT' ? 'change' : 'input';
            input.addEventListener(evt, (e) => {
                this.saveChecklistField(e.target.dataset.field, e.target.value);
            });
        });

        body.querySelectorAll('.checklist-ai-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.runAIGenerator(btn.dataset.aiAction, btn.dataset.targetField);
            });
        });

        if (columnId === 'teste_ads') {
            this.bindTestAdsImportControls(body);
        }

        openModal('pipeline-checklist-modal');
    },

    bindTestAdsImportControls(container) {
        const btn = container?.querySelector('#checklist-import-facebook-btn');
        const input = container?.querySelector('#checklist-import-facebook-input');
        if (!btn || !input) return;

        btn.addEventListener('click', () => input.click());
        input.addEventListener('change', async (event) => {
            const file = event?.target?.files?.[0];
            if (!file) return;
            await this.importTestAdsMetricsFromFile(file, btn);
            input.value = '';
        });
    },

    _formatChecklistNumber(value, maxFractionDigits = 2) {
        const n = Number(value);
        if (!Number.isFinite(n)) return '';
        return n.toLocaleString('pt-BR', {
            minimumFractionDigits: 0,
            maximumFractionDigits: maxFractionDigits
        });
    },

    mapImportedMetricsToTestAdsFields(imported) {
        const coverage = imported?.coverage || {};
        const clicks = Number(imported?.clicks || 0);
        const spend = Number(imported?.spend || 0);
        const purchases = Number(imported?.purchase || 0);
        const purchaseValue = Number(imported?.purchaseValue || 0);
        const cpc = clicks > 0 ? (spend / clicks) : 0;
        const roas = spend > 0 ? (purchaseValue / spend) : 0;

        const updates = {};

        if (coverage.spend) updates.budget = this._formatChecklistNumber(spend, 2);
        if (coverage.ctr) updates.ctr = this._formatChecklistNumber(imported?.ctr || 0, 2);
        if (coverage.atcRate) updates.atc = this._formatChecklistNumber(imported?.atcRate || 0, 2);
        if (coverage.purchase) updates.vendas = String(Math.round(purchases));
        if ((coverage.spend && coverage.clicks) || clicks > 0) updates.cpc = this._formatChecklistNumber(cpc, 2);
        if ((coverage.purchaseValue || coverage.spend) && spend > 0) updates.roas = this._formatChecklistNumber(roas, 2);

        return updates;
    },

    applyChecklistFieldBatch(updates) {
        const card = this.cards.find(c => c.id === this.checklistCardId);
        if (!card || !card.checklists || !card.checklists[this.checklistColumnId]) return 0;

        const stage = card.checklists[this.checklistColumnId];
        if (!stage.fields || typeof stage.fields !== 'object') stage.fields = {};

        let applied = 0;
        Object.entries(updates || {}).forEach(([field, value]) => {
            const normalized = String(value ?? '').trim();
            if (!normalized && normalized !== '0') return;
            stage.fields[field] = normalized;
            const input = document.querySelector(`#checklist-modal-body [data-field="${field}"]`);
            if (input) input.value = normalized;
            applied += 1;
        });

        if (applied > 0) this.save();
        return applied;
    },

    async importTestAdsMetricsFromFile(file, buttonEl = null) {
        if (!file) return;
        if (this.checklistColumnId !== 'teste_ads') return;
        if (typeof FunnelModule === 'undefined' || typeof FunnelModule.extractReportMetricsFromFile !== 'function') {
            showToast('Importador do Diagnóstico não está disponível nesta tela.', 'error');
            return;
        }

        const previousLabel = buttonEl ? buttonEl.textContent : '';
        if (buttonEl) {
            buttonEl.disabled = true;
            buttonEl.textContent = 'Importando...';
        }

        try {
            showToast('Lendo relatório do Teste Ads...', 'info');
            const result = await FunnelModule.extractReportMetricsFromFile(file);
            const imported = result?.imported;
            if (!imported) {
                throw new Error('Não foi possível extrair métricas do arquivo');
            }

            const updates = this.mapImportedMetricsToTestAdsFields(imported);
            const applied = this.applyChecklistFieldBatch(updates);

            if (applied > 0) {
                this.render();
                showToast(`Teste Ads preenchido com ${applied} métrica(s) do arquivo.`, 'success');
            } else {
                showToast('Importação parcial: não encontrei métricas suficientes para preencher o Teste Ads.', 'info');
            }

            const missing = Array.isArray(result?.missing) ? result.missing : [];
            if (missing.length > 0) {
                showToast(`Métricas ausentes no arquivo: ${missing.join(', ')}.`, 'info');
            }
        } catch (error) {
            showToast(`Erro ao importar no Teste Ads: ${error.message}`, 'error');
        } finally {
            if (buttonEl) {
                buttonEl.disabled = false;
                buttonEl.textContent = previousLabel || '<i data-lucide="download" style="width:14px;height:14px;vertical-align:-2px"></i> Importar CSV/XLSX';
            }
        }
    },

    runAIGenerator(action, targetField) {
        const card = this.cards.find(c => c.id === this.checklistCardId);
        if (!card) return;

        const product = card.title || 'produto';
        const problem = this.getChecklistField(card, 'validacao', 'problema_visivel')
            || this.getChecklistField(card, 'pesquisa', 'dores')
            || 'dor comum do público';
        const promise = this.getChecklistField(card, 'angulos', 'promessa_principal')
            || 'resultado rápido e visível';

        let content = '';
        if (action === 'generate_angles') {
            const base = [
                `Conveniência: ${product} resolve ${problem} com menos esforço.`,
                `Economia de tempo: faça em minutos o que levava horas.`,
                `Prova social: pessoas comuns usando ${product} com resultado visível.`,
                `Sem complicação: resultado sem técnica avançada.`,
                `Comparativo antes/depois: diferença visual imediata.`,
                `Custo-benefício: investimento baixo para ganho alto.`
            ];
            content = base.join('\n');
        } else if (action === 'generate_hooks') {
            const hooks = [
                `Você ainda sofre com ${problem}?`,
                `Eu testei isso por 7 dias e não esperava esse resultado.`,
                `Se você usa ${product}, precisa ver isso antes.`,
                `O erro que está travando suas vendas desse produto.`,
                `Olha o antes e depois em menos de 15 segundos.`,
                `Esse detalhe mudou o jogo nas campanhas.`,
                `Ninguém fala disso quando vende ${product}.`,
                `Por que esse criativo converte mais?`,
                `Resultado real, sem edição pesada.`,
                `Se eu começasse hoje, faria assim.`
            ];
            content = hooks.join('\n');
        } else if (action === 'generate_scripts') {
            const scripts = [
                `Script 1\nHook: "${problem}?"\nProblema: mostrar fricção real.\nSolução: apresentar ${product}.\nProva: antes/depois rápido.\nCTA: "Clique e veja agora."`,
                `Script 2\nHook: "3 erros com ${product}"\nProblema: mostrar erro comum.\nSolução: passo a passo curto.\nPromessa: ${promise}.\nCTA: "Testa hoje."`,
                `Script 3\nHook: "Eu não acreditava nisso"\nContexto: rotina comum.\nDemonstração: uso em tempo real.\nResultado: benefício principal.\nCTA: "Link na descrição."`
            ];
            content = scripts.join('\n\n');
        }

        if (!content) return;

        this.saveChecklistField(targetField, content, { rerender: false });

        const body = document.getElementById('checklist-modal-body');
        const targetInput = body ? body.querySelector(`[data-field="${targetField}"]`) : null;
        if (targetInput) targetInput.value = content;

        showToast('Conteúdo gerado e salvo no checklist.', 'success');
    },

    toggleChecklistItem(itemId, checked) {
        const card = this.cards.find(c => c.id === this.checklistCardId);
        if (!card || !card.checklists || !card.checklists[this.checklistColumnId]) return;

        const item = card.checklists[this.checklistColumnId].items.find(i => i.id === itemId);
        if (item) item.checked = checked;

        const label = document.querySelector(`.checklist-item[data-item-id="${itemId}"]`);
        if (label) label.classList.toggle('checked', checked);

        this.updateChecklistProgressUI(card, this.checklistColumnId);
        this.save();
        this.render();
    },

    updateChecklistProgressUI(card, columnId) {
        const progress = this.getChecklistProgress(card, columnId);
        const pct = progress.total > 0 ? Math.round((progress.checked / progress.total) * 100) : 0;
        const fillEl = document.querySelector('.checklist-progress-fill');
        const textEl = document.querySelector('.checklist-progress .checklist-progress-text');
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (textEl) textEl.textContent = `${progress.checked}/${progress.total} concluídos`;
    },

    saveChecklistField(fieldName, value, options = {}) {
        const card = this.cards.find(c => c.id === this.checklistCardId);
        if (!card || !card.checklists || !card.checklists[this.checklistColumnId]) return;
        const stage = card.checklists[this.checklistColumnId];
        if (!stage.fields || typeof stage.fields !== 'object') stage.fields = {};
        stage.fields[fieldName] = value;
        this.save();

        const shouldRerender = options.rerender !== false;
        if (shouldRerender) this.render();

        if (this.checklistColumnId === 'validacao' && fieldName === 'potencial_viral') {
            const score = this.parseNumber(value);
            if (score > 0 && score < 6) {
                showToast('Score abaixo de 6: considere mover o produto para Kill.', 'info');
            }
        }
    },

    closeChecklist() {
        this.checklistCardId = null;
        this.checklistColumnId = null;
        closeModal('pipeline-checklist-modal');
        this.render();
    },

    openModal(columnId, cardId = null) {
        this.editingId = cardId;
        const modal = document.getElementById('pipeline-modal');
        if (!modal) return;

        const clBtn = document.getElementById('pipeline-btn-checklist');
        const csvField = document.getElementById('pipeline-csv-field');

        if (cardId) {
            const card = this.cards.find(c => c.id === cardId);
            if (!card) return;
            this._normalizeCardSchema(card);

            document.getElementById('pipeline-modal-title').textContent = 'Editar Card';
            document.getElementById('pipeline-card-name').value = card.title || '';
            document.getElementById('pipeline-card-notes').value = card.notes || '';
            document.getElementById('pipeline-end-date').value = card.endDate || '';
            document.getElementById('pipeline-btn-delete').style.display = '';

            document.getElementById('pipeline-supplier-link').value = card.supplier?.url || '';
            document.getElementById('pipeline-supplier-cost').value = Number.isFinite(Number(card.supplier?.cost))
                ? String(card.supplier.cost)
                : '';
            document.getElementById('pipeline-supplier-currency').value = this.normalizeCurrency(card.supplier?.costCurrency || 'USD');
            document.getElementById('pipeline-product-functions').value = card.supplier?.functions || '';

            document.getElementById('pipeline-link-product').value = card.typedLinks?.product || '';
            document.getElementById('pipeline-link-final').value = card.typedLinks?.final || '';
            document.getElementById('pipeline-link-copy').value = card.typedLinks?.copy || '';
            document.getElementById('pipeline-link-research').value = card.typedLinks?.research || '';

            const extraLinksList = document.getElementById('pipeline-extra-links-list');
            extraLinksList.innerHTML = '';
            (card.extraLinks || []).forEach(link => {
                this.addFieldRow('pipeline-extra-links-list', {
                    mode: 'extra',
                    id: link.id,
                    label: link.label || '',
                    url: link.url || ''
                });
            });

            const videosList = document.getElementById('pipeline-videos-list');
            videosList.innerHTML = '';
            (card.videos || []).forEach(video => this.addFieldRow('pipeline-videos-list', 'https://youtube.com/...', video.url));
            if (!card.videos || card.videos.length === 0) this.addFieldRow('pipeline-videos-list', 'https://youtube.com/...');
            this._modalPhotos = (card.photos || []).map(photo => ({ ...photo }));
            this.renderPhotoList();
            const photoInput = document.getElementById('pipeline-photo-input');
            if (photoInput) photoInput.value = '';

            const hasChecklist = !!this.CHECKLISTS[card.columnId];
            if (clBtn) clBtn.style.display = hasChecklist ? '' : 'none';
            this._modalCustomTags = this.normalizeCustomTags(card.customTags || []);
            this.renderTagSelector(card.tags || [], this._modalCustomTags);
            const newTagInput = document.getElementById('pipeline-new-tag');
            if (newTagInput) newTagInput.value = '';
            if (csvField) csvField.style.display = card.columnId === 'teste_ads' ? '' : 'none';
            this.updateCardMetaInfo(card);

            modal.dataset.columnId = card.columnId;
            modal.dataset.storeId = card.storeId || '';
            modal.dataset.supplierMeta = JSON.stringify(card.supplier?.meta || {});
        } else {
            document.getElementById('pipeline-modal-title').textContent = 'Novo Card';
            document.getElementById('pipeline-card-name').value = '';
            document.getElementById('pipeline-card-notes').value = '';
            document.getElementById('pipeline-end-date').value = '';
            document.getElementById('pipeline-btn-delete').style.display = 'none';
            if (clBtn) clBtn.style.display = 'none';

            document.getElementById('pipeline-supplier-link').value = '';
            document.getElementById('pipeline-supplier-cost').value = '';
            document.getElementById('pipeline-supplier-currency').value = 'USD';
            document.getElementById('pipeline-product-functions').value = '';
            document.getElementById('pipeline-link-product').value = '';
            document.getElementById('pipeline-link-final').value = '';
            document.getElementById('pipeline-link-copy').value = '';
            document.getElementById('pipeline-link-research').value = '';

            document.getElementById('pipeline-extra-links-list').innerHTML = '';
            document.getElementById('pipeline-videos-list').innerHTML = '';
            this.addFieldRow('pipeline-videos-list', 'https://youtube.com/...');
            this._modalPhotos = [];
            this.renderPhotoList();
            const photoInput = document.getElementById('pipeline-photo-input');
            if (photoInput) photoInput.value = '';

            this._modalCustomTags = [];
            this.renderTagSelector([], this._modalCustomTags);
            const newTagInput = document.getElementById('pipeline-new-tag');
            if (newTagInput) newTagInput.value = '';
            if (csvField) csvField.style.display = columnId === 'teste_ads' ? '' : 'none';
            this.updateCardMetaInfo(null);

            modal.dataset.columnId = columnId;
            modal.dataset.storeId = (typeof getWritableStoreId === 'function' ? getWritableStoreId() : '') || '';
            modal.dataset.supplierMeta = '{}';
        }

        openModal('pipeline-modal');
        document.getElementById('pipeline-card-name').focus();
    },

    async saveCard() {
        const titleInput = document.getElementById('pipeline-card-name');
        const title = String(titleInput.value || '').trim();
        if (!title) {
            titleInput.focus();
            return;
        }

        const notes = String(document.getElementById('pipeline-card-notes').value || '').trim();
        const endDate = String(document.getElementById('pipeline-end-date').value || '').trim();
        const modal = document.getElementById('pipeline-modal');
        const columnId = modal.dataset.columnId || 'ideia';
        const modalStoreId = String(modal.dataset.storeId || '').trim();
        const supplierMeta = (() => {
            try {
                const parsed = JSON.parse(modal.dataset.supplierMeta || '{}');
                return parsed && typeof parsed === 'object' ? parsed : {};
            } catch {
                return {};
            }
        })();

        const supplierUrl = String(document.getElementById('pipeline-supplier-link').value || '').trim();
        const supplierCostRaw = String(document.getElementById('pipeline-supplier-cost').value || '').trim();
        const supplierCost = supplierCostRaw === '' ? null : this._parseLooseNumber(supplierCostRaw);
        const supplierCurrency = this.normalizeCurrency(document.getElementById('pipeline-supplier-currency').value || 'USD');
        const productFunctions = String(document.getElementById('pipeline-product-functions').value || '').trim();

        const typedLinks = {
            product: String(document.getElementById('pipeline-link-product').value || '').trim(),
            final: String(document.getElementById('pipeline-link-final').value || '').trim(),
            copy: String(document.getElementById('pipeline-link-copy').value || '').trim(),
            research: String(document.getElementById('pipeline-link-research').value || '').trim()
        };

        const extraLinks = [...document.querySelectorAll('#pipeline-extra-links-list .field-row-extra')]
            .map((row, idx) => {
                const label = String(row.querySelector('.field-row-label')?.value || '').trim();
                const url = String(row.querySelector('.field-row-url')?.value || '').trim();
                if (!url) return null;
                return {
                    id: row.dataset.linkId || `extra_${Date.now()}_${idx}`,
                    label: label || `Extra ${idx + 1}`,
                    url
                };
            })
            .filter(Boolean);

        const videos = [...document.querySelectorAll('#pipeline-videos-list input')]
            .map(i => i.value.trim())
            .filter(Boolean)
            .map(url => ({ url }));
        const rawPhotos = Array.isArray(this._modalPhotos)
            ? this._modalPhotos.map(photo => ({ ...photo }))
            : [];
        const photos = await this._syncPhotosToCloud(rawPhotos, {
            cardTitle: title,
            storeId: modalStoreId || (typeof getWritableStoreId === 'function' ? getWritableStoreId() : '')
        });
        this._modalPhotos = photos.map(photo => ({ ...photo }));
        this.renderPhotoList();

        const customTags = this.normalizeCustomTags(this._modalCustomTags);
        const allowedTagIds = new Set([...this.TAGS, ...customTags].map(tag => String(tag.id || '').trim()).filter(Boolean));
        const tags = [...document.querySelectorAll('.pipeline-tag-option.selected')]
            .map(el => String(el.dataset.tagId || '').trim())
            .filter(tagId => allowedTagIds.has(tagId));

        if (this.editingId) {
            const card = this.cards.find(c => c.id === this.editingId);
            if (!card) return;
            this._normalizeCardSchema(card);

            card.title = title;
            card.notes = notes;
            card.endDate = endDate;
            card.typedLinks = typedLinks;
            card.extraLinks = extraLinks;
            card.links = this._buildLegacyLinks(typedLinks, extraLinks);
            card.videos = videos;
            card.photos = photos;
            card.tags = tags;
            card.customTags = customTags;
            card.supplier = card.supplier || {};
            card.supplier.url = supplierUrl;
            card.supplier.cost = Number.isFinite(supplierCost) ? parseFloat(supplierCost.toFixed(2)) : null;
            card.supplier.costCurrency = supplierCurrency;
            card.supplier.functions = productFunctions;
            card.supplier.meta = {
                ...(card.supplier.meta || {}),
                ...supplierMeta
            };
            card.updatedAt = new Date().toISOString();
            card.storeId = card.storeId || modalStoreId || '';

            if (columnId === 'teste_ads') {
                await this._ensureProductForTestAds(card);
            }
        } else {
            const siblings = this.cards.filter(c => c.columnId === columnId);
            const newCard = {
                id: 'pipe_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                columnId,
                title,
                notes,
                endDate,
                storeId: modalStoreId || ((typeof getWritableStoreId === 'function' ? getWritableStoreId() : '') || ''),
                productId: '',
                supplier: {
                    url: supplierUrl,
                    cost: Number.isFinite(supplierCost) ? parseFloat(supplierCost.toFixed(2)) : null,
                    costCurrency: supplierCurrency,
                    functions: productFunctions,
                    meta: supplierMeta
                },
                typedLinks,
                extraLinks,
                links: this._buildLegacyLinks(typedLinks, extraLinks),
                videos,
                photos,
                tags,
                customTags,
                checklists: {},
                order: siblings.length,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            this.initChecklist(newCard, columnId);
            this.cards.push(newCard);

            if (columnId === 'teste_ads') {
                await this._ensureProductForTestAds(newCard);
            }
        }

        this.save();
        this.render();
        closeModal('pipeline-modal');
    },

    deleteCard() {
        if (!this.editingId) return;
        if (!confirm('Excluir este card?')) return;
        this.cards = this.cards.filter(c => c.id !== this.editingId);
        this.save();
        this.render();
        closeModal('pipeline-modal');
    },

    addFieldRow(containerId, placeholderOrOptions, value = '') {
        const list = document.getElementById(containerId);
        if (!list) return;

        if (typeof placeholderOrOptions === 'object' && placeholderOrOptions.mode === 'extra') {
            const opts = placeholderOrOptions || {};
            const row = document.createElement('div');
            row.className = 'field-row field-row-extra';
            row.dataset.linkId = opts.id || `extra_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            row.innerHTML = `
                <input type="text" class="field-row-label" placeholder="Rótulo (ex: Concorrente)" value="${this.escapeHtml(opts.label || '')}">
                <input type="url" class="field-row-url" placeholder="https://..." value="${this.escapeHtml(opts.url || '')}">
                <button type="button" class="field-row-open" data-action="open-row-link" title="Abrir link"><i data-lucide="trending-up" style="width:14px;height:14px;vertical-align:-2px"></i></button>
                <button type="button" class="field-row-remove" title="Remover">&times;</button>
            `;
            row.querySelector('.field-row-remove').addEventListener('click', () => row.remove());
            list.appendChild(row);
            return;
        }

        const placeholder = String(placeholderOrOptions || '');
        const row = document.createElement('div');
        row.className = 'field-row';
        row.innerHTML = `
            <input type="url" placeholder="${this.escapeHtml(placeholder)}" value="${this.escapeHtml(value)}">
            <button type="button" class="field-row-remove" title="Remover">&times;</button>
        `;
        row.querySelector('.field-row-remove').addEventListener('click', () => row.remove());
        list.appendChild(row);
    },

    normalizeCurrency(value) {
        const curr = String(value || '').trim().toUpperCase();
        if (['USD', 'BRL', 'EUR', 'GBP'].includes(curr)) return curr;
        return 'USD';
    },

    _normalizeCardSchema(card) {
        if (!card || typeof card !== 'object') return false;
        let changed = false;

        if (!Array.isArray(card.tags)) {
            card.tags = [];
            changed = true;
        }
        const normalizedSelectedTags = [...new Set(card.tags
            .map(tagId => String(tagId || '').trim())
            .filter(Boolean))];
        if (JSON.stringify(normalizedSelectedTags) !== JSON.stringify(card.tags)) {
            changed = true;
        }
        card.tags = normalizedSelectedTags;

        const normalizedCustomTags = this.normalizeCustomTags(card.customTags || []);
        if (JSON.stringify(normalizedCustomTags) !== JSON.stringify(card.customTags || [])) {
            changed = true;
        }
        card.customTags = normalizedCustomTags;

        const allowedTagIds = new Set([...this.TAGS, ...normalizedCustomTags].map(tag => String(tag.id || '').trim()).filter(Boolean));
        const filteredTags = card.tags.filter(tagId => allowedTagIds.has(tagId));
        if (JSON.stringify(filteredTags) !== JSON.stringify(card.tags)) {
            changed = true;
        }
        card.tags = filteredTags;

        if (!Array.isArray(card.videos)) {
            card.videos = [];
            changed = true;
        }
        const originalVideos = JSON.stringify(card.videos);
        const normalizedVideos = card.videos
            .map(item => {
                const url = String(typeof item === 'string' ? item : item?.url || '').trim();
                return url ? { url } : null;
            })
            .filter(Boolean);
        if (JSON.stringify(normalizedVideos) !== originalVideos) {
            changed = true;
        }
        card.videos = normalizedVideos;

        if (!Array.isArray(card.photos)) {
            card.photos = [];
            changed = true;
        }
        const normalizedPhotos = card.photos
            .map((item, idx) => {
                const dataUrl = String(typeof item === 'string' ? item : item?.dataUrl || '').trim();
                const driveFileId = String(item?.driveFileId || '').trim();
                const driveUrl = String(item?.driveUrl || '').trim();
                const previewUrl = String(item?.previewUrl || '').trim();
                const thumbnailUrl = String(item?.thumbnailUrl || '').trim();
                const hasDataUrl = !!dataUrl && /^data:image\//i.test(dataUrl);
                const hasDriveRef = !!driveFileId || !!driveUrl || !!previewUrl || !!thumbnailUrl;
                if (!hasDataUrl && !hasDriveRef) return null;
                const estimatedBytes = hasDataUrl ? this._estimateDataUrlBytes(dataUrl) : 0;
                return {
                    id: String(item?.id || `photo_${idx}_${Date.now()}`),
                    name: String(item?.name || `Foto ${idx + 1}`).trim(),
                    dataUrl: hasDataUrl ? dataUrl : '',
                    mimeType: String(item?.mimeType || '').trim(),
                    sizeBytes: Number(item?.sizeBytes) > 0 ? Number(item?.sizeBytes) : estimatedBytes,
                    createdAt: String(item?.createdAt || ''),
                    storage: String(item?.storage || (hasDriveRef ? 'drive' : 'local')),
                    driveFileId,
                    driveUrl,
                    previewUrl,
                    thumbnailUrl,
                    uploadedAt: String(item?.uploadedAt || ''),
                    cloudError: String(item?.cloudError || '')
                };
            })
            .filter(Boolean)
            .slice(0, this.PHOTO_MAX_COUNT);
        if (JSON.stringify(normalizedPhotos) !== JSON.stringify(card.photos)) {
            changed = true;
        }
        card.photos = normalizedPhotos;

        if (typeof card.productId !== 'string') {
            card.productId = '';
            changed = true;
        }
        if (typeof card.storeId !== 'string') {
            card.storeId = '';
            changed = true;
        }
        const normalizedEndDate = this.normalizeDateString(card.endDate);
        if (String(card.endDate || '').trim() !== normalizedEndDate) {
            changed = true;
        }
        card.endDate = normalizedEndDate;

        const nowIso = new Date().toISOString();
        const normalizedCreatedAt = this.normalizeIsoDateTime(card.createdAt) || this.normalizeIsoDateTime(card.updatedAt) || nowIso;
        if (String(card.createdAt || '') !== normalizedCreatedAt) {
            changed = true;
        }
        card.createdAt = normalizedCreatedAt;

        const normalizedUpdatedAt = this.normalizeIsoDateTime(card.updatedAt) || normalizedCreatedAt;
        if (String(card.updatedAt || '') !== normalizedUpdatedAt) {
            changed = true;
        }
        card.updatedAt = normalizedUpdatedAt;

        const legacyUrls = this._extractLegacyUrls(card.links);
        const typedDefaults = { product: '', final: '', copy: '', research: '' };
        const hadTypedLinksObject = !!card.typedLinks && typeof card.typedLinks === 'object' && !Array.isArray(card.typedLinks);
        if (!hadTypedLinksObject) {
            card.typedLinks = { ...typedDefaults };
            changed = true;
        }

        ['product', 'final', 'copy', 'research'].forEach((key, idx) => {
            const prev = String(card.typedLinks[key] || '').trim();
            if (hadTypedLinksObject) {
                if (card.typedLinks[key] !== prev) changed = true;
                card.typedLinks[key] = prev;
            } else {
                const fallback = legacyUrls[idx] || '';
                const next = prev || fallback;
                if (card.typedLinks[key] !== next) changed = true;
                card.typedLinks[key] = next;
            }
        });

        if (!Array.isArray(card.extraLinks)) {
            card.extraLinks = [];
            changed = true;
        }
        const normalizedExtras = [];
        card.extraLinks.forEach((item, idx) => {
            const url = String(item?.url || '').trim();
            if (!url) return;
            const label = String(item?.label || '').trim() || `Extra ${idx + 1}`;
            normalizedExtras.push({
                id: String(item?.id || `extra_${idx}_${Date.now()}`),
                label,
                url
            });
        });

        if (legacyUrls.length > 4 && normalizedExtras.length === 0) {
            legacyUrls.slice(4).forEach((url, idx) => {
                normalizedExtras.push({
                    id: `legacy_extra_${idx}_${Date.now()}`,
                    label: `Extra ${idx + 1}`,
                    url
                });
            });
            changed = true;
        }
        card.extraLinks = normalizedExtras;

        if (!card.supplier || typeof card.supplier !== 'object') {
            card.supplier = {};
            changed = true;
        }
        if (!card.supplier.meta || typeof card.supplier.meta !== 'object') {
            card.supplier.meta = {};
            changed = true;
        }

        const supplierUrl = String(card.supplier.url || '').trim();
        if (!supplierUrl && legacyUrls[0] && this._isAliExpressUrl(legacyUrls[0])) {
            card.supplier.url = legacyUrls[0];
            changed = true;
        } else {
            card.supplier.url = supplierUrl;
        }

        const previousCost = card.supplier.cost;
        const costNum = Number(card.supplier.cost);
        const normalizedCost = Number.isFinite(costNum) && costNum >= 0 ? parseFloat(costNum.toFixed(2)) : null;
        if ((previousCost ?? null) !== normalizedCost) {
            changed = true;
        }
        card.supplier.cost = normalizedCost;

        const previousCostCurrency = String(card.supplier.costCurrency || '').trim().toUpperCase();
        const normalizedCostCurrency = this.normalizeCurrency(card.supplier.costCurrency || 'USD');
        if (previousCostCurrency !== normalizedCostCurrency) {
            changed = true;
        }
        card.supplier.costCurrency = normalizedCostCurrency;

        const previousFunctions = String(card.supplier.functions || '');
        const normalizedFunctions = previousFunctions.trim();
        if (previousFunctions !== normalizedFunctions) {
            changed = true;
        }
        card.supplier.functions = normalizedFunctions;

        const rebuiltLegacy = this._buildLegacyLinks(card.typedLinks, card.extraLinks);
        const currentLegacy = this._extractLegacyUrls(card.links);
        if (rebuiltLegacy.length !== currentLegacy.length
            || rebuiltLegacy.some((item, idx) => item.url !== currentLegacy[idx])) {
            card.links = rebuiltLegacy;
            changed = true;
        }

        return changed;
    },

    _extractLegacyUrls(links) {
        if (!Array.isArray(links)) return [];
        return links
            .map(item => String(typeof item === 'string' ? item : item?.url || '').trim())
            .filter(Boolean);
    },

    _buildLegacyLinks(typedLinks, extraLinks) {
        const fixed = [typedLinks?.product, typedLinks?.final, typedLinks?.copy, typedLinks?.research]
            .map(v => String(v || '').trim())
            .filter(Boolean)
            .map(url => ({ url }));
        const extras = (extraLinks || [])
            .map(item => String(item?.url || '').trim())
            .filter(Boolean)
            .map(url => ({ url }));
        return [...fixed, ...extras];
    },

    _safeOpenUrl(url) {
        const value = String(url || '').trim();
        if (!value) return '';
        if (/^https?:\/\//i.test(value)) return value;
        return `https://${value.replace(/^\/+/, '')}`;
    },

    _openLinkFromInput(inputEl) {
        const raw = String(inputEl?.value || '').trim();
        const url = this._safeOpenUrl(raw);
        if (!url) {
            if (typeof showToast === 'function') showToast('Preencha um link válido para abrir.', 'info');
            inputEl?.focus?.();
            return;
        }
        window.open(url, '_blank', 'noopener,noreferrer');
    },

    getCardLinkCount(card) {
        if (!card) return 0;
        const typed = card.typedLinks || {};
        const fixedCount = ['product', 'final', 'copy', 'research']
            .reduce((acc, key) => acc + (String(typed[key] || '').trim() ? 1 : 0), 0);
        const extraCount = Array.isArray(card.extraLinks)
            ? card.extraLinks.filter(item => String(item?.url || '').trim()).length
            : 0;
        const supplierCount = String(card?.supplier?.url || '').trim() ? 1 : 0;
        return fixedCount + extraCount + supplierCount;
    },

    countSupplierFunctions(card) {
        const text = String(card?.supplier?.functions || '').trim();
        if (!text) return 0;
        return text.split('\n').map(line => line.trim()).filter(Boolean).length;
    },

    renderPhotoList() {
        const list = document.getElementById('pipeline-photo-list');
        if (!list) return;
        list.innerHTML = '';

        const photos = Array.isArray(this._modalPhotos) ? this._modalPhotos : [];
        if (photos.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'pipeline-photo-empty';
            empty.textContent = 'Nenhuma foto anexada.';
            list.appendChild(empty);
            return;
        }

        photos.forEach(photo => {
            const item = document.createElement('div');
            item.className = 'pipeline-photo-item';
            item.dataset.photoId = photo.id;

            const img = document.createElement('img');
            img.className = 'pipeline-photo-thumb';
            img.alt = photo.name || 'Foto';
            img.loading = 'lazy';
            const previewSrc = this._getPhotoPreviewSrc(photo);
            if (previewSrc) {
                img.src = previewSrc;
            } else {
                img.src = 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%22140%22%3E%3Crect width=%22240%22 height=%22140%22 fill=%22%23111a2d%22/%3E%3Ctext x=%2250%25%22 y=%2250%25%22 fill=%22%2394a3b8%22 text-anchor=%22middle%22 dominant-baseline=%22middle%22 font-family=%22Arial,sans-serif%22 font-size=%2214%22%3ESem preview%3C/text%3E%3C/svg%3E';
            }
            const openUrl = this._safeOpenUrl(photo?.driveUrl || photo?.previewUrl || '');
            if (openUrl) {
                img.style.cursor = 'pointer';
                img.title = 'Abrir imagem na nuvem';
                img.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    window.open(openUrl, '_blank', 'noopener,noreferrer');
                });
            }

            const footer = document.createElement('div');
            footer.className = 'pipeline-photo-footer';

            const name = document.createElement('span');
            name.className = 'pipeline-photo-name';
            name.textContent = photo.name || 'Foto';
            name.title = photo.name || 'Foto';
            if (photo.storage === 'drive') {
                name.innerHTML = `<i data-lucide="cloud" style="width:14px;height:14px;vertical-align:-2px"></i> ${name.textContent}`;
            }

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'pipeline-photo-remove';
            removeBtn.title = 'Remover foto';
            removeBtn.textContent = '×';
            removeBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                this._modalPhotos = photos.filter(itemPhoto => itemPhoto.id !== photo.id);
                this.renderPhotoList();
            });

            footer.appendChild(name);
            footer.appendChild(removeBtn);
            item.appendChild(img);
            item.appendChild(footer);
            list.appendChild(item);
        });
    },

    async handlePhotoInputChange(event) {
        const input = event?.target;
        if (!input || !input.files) return;
        const files = Array.from(input.files || []);
        if (files.length === 0) return;

        try {
            await this._addPhotosFromFiles(files);
        } finally {
            input.value = '';
        }
    },

    async _addPhotosFromFiles(files) {
        const modal = document.getElementById('pipeline-modal');
        if (!modal || modal.classList.contains('hidden')) return;

        this._modalPhotos = Array.isArray(this._modalPhotos) ? this._modalPhotos : [];
        const freeSlots = Math.max(0, this.PHOTO_MAX_COUNT - this._modalPhotos.length);
        if (freeSlots <= 0) {
            showToast(`Limite atingido: máximo de ${this.PHOTO_MAX_COUNT} fotos por card.`, 'info');
            return;
        }

        const queue = files.slice(0, freeSlots);
        if (files.length > freeSlots) {
            showToast(`Somente ${freeSlots} foto(s) puderam ser adicionadas neste card.`, 'info');
        }

        let added = 0;
        let skipped = 0;
        for (const file of queue) {
            if (!file || !String(file.type || '').startsWith('image/')) {
                skipped += 1;
                continue;
            }
            try {
                const attachment = await this._preparePhotoAttachment(file);
                if (!attachment) {
                    skipped += 1;
                    continue;
                }
                this._modalPhotos.push(attachment);
                added += 1;
            } catch (error) {
                console.warn('Falha ao processar imagem do pipeline', error);
                skipped += 1;
            }
        }

        this.renderPhotoList();
        if (added > 0) {
            showToast(`${added} foto(s) anexada(s).`, 'success');
        }
        if (skipped > 0) {
            showToast(`${skipped} arquivo(s) foram ignorados.`, 'info');
        }
    },

    async _preparePhotoAttachment(file) {
        const dataUrl = await this._fileToDataUrl(file);
        const optimized = await this._optimizeImageDataUrl(dataUrl, {
            maxWidth: this.PHOTO_MAX_WIDTH,
            maxBytes: this.PHOTO_MAX_BYTES
        });
        if (!optimized || !optimized.dataUrl) return null;

        return {
            id: `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: String(file.name || 'foto').trim(),
            dataUrl: optimized.dataUrl,
            mimeType: optimized.mimeType || String(file.type || 'image/jpeg'),
            sizeBytes: optimized.sizeBytes,
            createdAt: new Date().toISOString(),
            storage: 'local',
            driveFileId: '',
            driveUrl: '',
            previewUrl: '',
            thumbnailUrl: '',
            uploadedAt: '',
            cloudError: ''
        };
    },

    _fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
            reader.readAsDataURL(file);
        });
    },

    _loadImageFromDataUrl(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Arquivo de imagem inválido.'));
            img.src = dataUrl;
        });
    },

    async _optimizeImageDataUrl(dataUrl, options = {}) {
        const maxWidth = Number(options.maxWidth) || this.PHOTO_MAX_WIDTH;
        const maxBytes = Number(options.maxBytes) || this.PHOTO_MAX_BYTES;
        const image = await this._loadImageFromDataUrl(dataUrl);
        const scale = Math.min(1, maxWidth / (image.naturalWidth || maxWidth));
        const targetWidth = Math.max(1, Math.round((image.naturalWidth || maxWidth) * scale));
        const targetHeight = Math.max(1, Math.round((image.naturalHeight || maxWidth) * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);

        const qualitySteps = [0.86, 0.78, 0.7, 0.62, 0.54];
        let bestDataUrl = '';
        let bestBytes = Number.POSITIVE_INFINITY;
        for (const quality of qualitySteps) {
            const encoded = canvas.toDataURL('image/jpeg', quality);
            const bytes = this._estimateDataUrlBytes(encoded);
            if (bytes < bestBytes) {
                bestBytes = bytes;
                bestDataUrl = encoded;
            }
            if (bytes <= maxBytes) {
                return { dataUrl: encoded, sizeBytes: bytes, mimeType: 'image/jpeg' };
            }
        }

        if (!bestDataUrl || bestBytes > maxBytes) {
            showToast('Imagem muito grande. Use uma foto menor para anexar.', 'error');
            return null;
        }
        return { dataUrl: bestDataUrl, sizeBytes: bestBytes, mimeType: 'image/jpeg' };
    },

    _estimateDataUrlBytes(dataUrl) {
        const value = String(dataUrl || '');
        const idx = value.indexOf(',');
        const base64 = idx >= 0 ? value.slice(idx + 1) : value;
        return Math.ceil((base64.length * 3) / 4);
    },

    _getPhotoPreviewSrc(photo) {
        const dataUrl = String(photo?.dataUrl || '').trim();
        if (dataUrl && /^data:image\//i.test(dataUrl)) return dataUrl;

        const thumb = String(photo?.thumbnailUrl || '').trim();
        if (thumb) {
            return thumb.replace(/=s\d+(-c)?$/i, '=s640');
        }

        const preview = String(photo?.previewUrl || '').trim();
        if (preview) return preview;

        const fileId = String(photo?.driveFileId || '').trim();
        if (fileId) return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w1000`;
        return '';
    },

    _dataUrlToBlob(dataUrl) {
        const text = String(dataUrl || '').trim();
        const match = text.match(/^data:([^;]+);base64,(.+)$/i);
        if (!match) throw new Error('Formato de imagem inválido para upload.');
        const mimeType = match[1] || 'image/jpeg';
        const binary = atob(match[2]);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
        return new Blob([bytes], { type: mimeType });
    },

    _buildCloudPhotoFileName(cardTitle, photo, index = 0) {
        const safeTitle = String(cardTitle || 'produto')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || 'produto';
        const baseName = String(photo?.name || '').trim().replace(/\.[a-z0-9]+$/i, '');
        const safeName = baseName
            .toLowerCase()
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 28) || `foto-${index + 1}`;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${safeTitle}__${safeName}__${stamp}.jpg`;
    },

    async _syncPhotosToCloud(photos, context = {}) {
        const list = Array.isArray(photos) ? photos.map(photo => ({ ...photo })) : [];
        if (list.length === 0) return list;
        if (!AppState?.sheetsConnected || typeof SheetsAPI === 'undefined' || typeof SheetsAPI.uploadPipelinePhotoBlob !== 'function') {
            return list;
        }

        const pendingIndexes = [];
        list.forEach((photo, idx) => {
            const alreadyCloud = String(photo?.driveFileId || '').trim();
            const localData = String(photo?.dataUrl || '').trim();
            if (!alreadyCloud && localData && /^data:image\//i.test(localData)) {
                pendingIndexes.push(idx);
            }
        });
        if (pendingIndexes.length === 0) return list;

        let uploaded = 0;
        let failed = 0;
        for (const idx of pendingIndexes) {
            const photo = list[idx];
            try {
                const blob = this._dataUrlToBlob(photo.dataUrl);
                const upload = await SheetsAPI.uploadPipelinePhotoBlob(blob, {
                    fileName: this._buildCloudPhotoFileName(context.cardTitle, photo, idx),
                    cardTitle: context.cardTitle,
                    storeId: context.storeId
                });
                list[idx] = {
                    ...photo,
                    storage: 'drive',
                    driveFileId: String(upload?.fileId || ''),
                    driveUrl: String(upload?.viewUrl || ''),
                    previewUrl: String(upload?.previewUrl || ''),
                    thumbnailUrl: String(upload?.thumbnailUrl || ''),
                    mimeType: String(upload?.mimeType || photo?.mimeType || 'image/jpeg'),
                    sizeBytes: Number(upload?.sizeBytes || photo?.sizeBytes || 0),
                    uploadedAt: new Date().toISOString(),
                    cloudError: upload?.permissionWarning ? String(upload.permissionWarning) : '',
                    dataUrl: upload?.isPublic ? '' : String(photo?.dataUrl || '')
                };
                uploaded += 1;
            } catch (err) {
                failed += 1;
                list[idx] = {
                    ...photo,
                    storage: 'local',
                    cloudError: err?.message || 'Falha ao enviar para nuvem'
                };
                console.warn('Falha ao enviar foto do pipeline para nuvem:', err);
            }
        }

        if (uploaded > 0) {
            showToast(`${uploaded} foto(s) enviada(s) para nuvem.`, 'success');
        }
        if (failed > 0) {
            showToast(`${failed} foto(s) ficaram locais por falha no upload para nuvem.`, 'info');
        }

        return list;
    },

    _normalizeAliExpressUrl(url) {
        const normalized = this._safeOpenUrl(url);
        let parsed;
        try {
            parsed = new URL(normalized);
        } catch {
            return null;
        }
        const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
        if (!host.includes('aliexpress.com')) return null;

        const productId = this._extractAliExpressProductId(parsed);
        if (productId) parsed.pathname = `/item/${productId}.html`;

        parsed.hash = '';
        return parsed;
    },

    _isAliExpressUrl(url) {
        return !!this._normalizeAliExpressUrl(url);
    },

    _extractAliExpressProductId(parsedUrl) {
        if (!parsedUrl) return '';
        const pathMatch = String(parsedUrl.pathname || '').match(/\/item\/(\d+)\.html/i);
        if (pathMatch?.[1]) return pathMatch[1];

        const searchParams = parsedUrl.searchParams;
        const candidateKeys = ['x_object_id', '_p_origin_prod', 'itemId', 'item_id', 'productId', 'product_id'];
        for (const key of candidateKeys) {
            const raw = String(searchParams.get(key) || '').trim();
            const match = raw.match(/(\d{8,})/);
            if (match?.[1]) return match[1];
        }

        // fallback: look for a long numeric token anywhere in query string
        const all = decodeURIComponent(String(parsedUrl.search || ''));
        const tokenMatch = all.match(/(\d{10,})/);
        return tokenMatch?.[1] || '';
    },

    _extractAliExpressLocal(url) {
        const parsed = this._normalizeAliExpressUrl(url);
        if (!parsed) return null;

        const productId = this._extractAliExpressProductId(parsed);
        const result = {
            canonicalUrl: parsed.toString(),
            productId,
            cost: null,
            functions: [],
            sources: []
        };

        const pdpNpi = parsed.searchParams.get('pdp_npi') || '';
        const decodedNpi = (() => {
            try {
                return decodeURIComponent(pdpNpi);
            } catch {
                return pdpNpi;
            }
        })();
        const parts = decodedNpi.split('!').map(part => part.trim()).filter(Boolean);
        const currencyIdx = parts.findIndex(part => /^[A-Z]{3}$/.test(part));
        if (currencyIdx >= 0) {
            const curr = this.normalizeCurrency(parts[currencyIdx]);
            const first = this._parseLooseNumber(parts[currencyIdx + 1] || '');
            const second = this._parseLooseNumber(parts[currencyIdx + 2] || '');
            const bestValue = second > 0 ? second : (first > 0 ? first : 0);
            if (bestValue > 0) {
                result.cost = { value: parseFloat(bestValue.toFixed(2)), currency: curr };
                result.sources.push('url_param_pdp_npi');
            }
        }

        return result;
    },

    async _fetchAliExpressBackend(url) {
        const baseUrl = String(AppState?.config?.googleAdsSyncUrl || '').trim().replace(/\/$/, '');
        const token = String(AppState?.config?.googleAdsSyncToken || '').trim();
        const candidates = [];
        if (baseUrl) candidates.push(baseUrl);
        const sameOrigin = String(window?.location?.origin || '').trim().replace(/\/$/, '');
        if (sameOrigin && !candidates.includes(sameOrigin)) candidates.push(sameOrigin);
        if (candidates.length === 0) return null;

        let lastError = null;
        for (const candidate of candidates) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
                const headers = { 'Content-Type': 'application/json' };
                if (token) headers['x-sync-token'] = token;

                const res = await fetch(`${candidate}/suppliers/aliexpress/extract`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ url }),
                    signal: controller.signal
                });

                const payload = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const message = payload?.error || `HTTP ${res.status}`;
                    throw new Error(message);
                }
                return payload;
            } catch (error) {
                lastError = error;
            } finally {
                clearTimeout(timer);
            }
        }
        throw lastError || new Error('Backend indisponível.');
    },

    _applySupplierAutofill(data, options = {}) {
        const emptyOnly = options.emptyOnly !== false;
        const linkInput = document.getElementById('pipeline-supplier-link');
        const costInput = document.getElementById('pipeline-supplier-cost');
        const currencyInput = document.getElementById('pipeline-supplier-currency');
        const functionsInput = document.getElementById('pipeline-product-functions');
        if (!linkInput || !costInput || !currencyInput || !functionsInput) return { filled: 0 };

        let filled = 0;
        const canonicalUrl = String(data?.canonicalUrl || '').trim();
        if (canonicalUrl && (!emptyOnly || !String(linkInput.value || '').trim())) {
            linkInput.value = canonicalUrl;
            filled += 1;
        }

        const parsedCost = Number(data?.cost?.value);
        if (Number.isFinite(parsedCost) && parsedCost > 0) {
            const current = String(costInput.value || '').trim();
            const isEmptyCost = !current || this._parseLooseNumber(current) <= 0;
            if (!emptyOnly || isEmptyCost) {
                costInput.value = parsedCost.toFixed(2);
                currencyInput.value = this.normalizeCurrency(data?.cost?.currency || currencyInput.value || 'USD');
                filled += 1;
            }
        }

        const functions = Array.isArray(data?.functions)
            ? data.functions.map(item => String(item || '').trim()).filter(Boolean)
            : String(data?.functions || '').split('\n').map(item => item.trim()).filter(Boolean);
        if (functions.length > 0) {
            const current = String(functionsInput.value || '').trim();
            if (!emptyOnly || !current) {
                functionsInput.value = functions.join('\n');
                filled += 1;
            }
        }

        return { filled };
    },

    async handleSupplierAutofill() {
        if (this._supplierAutofillBusy) return;
        const btn = document.getElementById('pipeline-supplier-autofill');
        const linkInput = document.getElementById('pipeline-supplier-link');
        if (!linkInput || !btn) return;

        const rawUrl = String(linkInput.value || '').trim();
        if (!rawUrl) {
            showToast('Informe o link do fornecedor primeiro.', 'error');
            linkInput.focus();
            return;
        }

        const normalizedUrl = this._normalizeAliExpressUrl(rawUrl);
        if (!normalizedUrl) {
            showToast('No momento, o auto preenchimento suporta apenas links do AliExpress.', 'error');
            return;
        }

        const productId = this._extractAliExpressProductId(normalizedUrl);
        if (!productId) {
            showToast('Link inválido para auto preenchimento. Use o link do produto (formato .../item/1234567890.html).', 'error');
            return;
        }
        if (String(linkInput.value || '').trim() !== normalizedUrl.toString()) {
            linkInput.value = normalizedUrl.toString();
        }

        this._supplierAutofillBusy = true;
        btn.disabled = true;
        btn.classList.add('loading');
        btn.textContent = '...';

        let filledCount = 0;
        const warnings = [];
        const sources = new Set();
        const mergedData = {
            canonicalUrl: '',
            cost: null,
            functions: []
        };
        const meta = {
            provider: 'aliexpress',
            productId: '',
            title: '',
            canonicalUrl: '',
            sources: [],
            warnings: [],
            updatedAt: new Date().toISOString()
        };
        try {
            const mergeCandidateData = (payload) => {
                if (!payload || typeof payload !== 'object') return;
                const canonical = String(payload.canonicalUrl || '').trim();
                if (canonical) mergedData.canonicalUrl = canonical;

                const value = Number(payload?.cost?.value);
                if (Number.isFinite(value) && value > 0) {
                    mergedData.cost = {
                        value: parseFloat(value.toFixed(2)),
                        currency: this.normalizeCurrency(payload?.cost?.currency || 'USD')
                    };
                }

                const fnList = Array.isArray(payload?.functions)
                    ? payload.functions.map(item => String(item || '').trim()).filter(Boolean)
                    : String(payload?.functions || '').split('\n').map(item => item.trim()).filter(Boolean);
                if (fnList.length > 0) {
                    mergedData.functions = fnList;
                }
            };

            const localData = this._extractAliExpressLocal(normalizedUrl.toString());
            if (localData) {
                const applied = this._applySupplierAutofill(localData, { emptyOnly: true });
                filledCount += applied.filled;
                mergeCandidateData(localData);
                if (localData.productId) meta.productId = localData.productId;
                if (localData.canonicalUrl) meta.canonicalUrl = localData.canonicalUrl;
                (localData.sources || []).forEach(src => sources.add(String(src)));
            }

            try {
                const backend = await this._fetchAliExpressBackend(normalizedUrl.toString());
                const backendData = backend?.data || {};
                if (backendData && Object.keys(backendData).length > 0) {
                    const applied = this._applySupplierAutofill(backendData, { emptyOnly: true });
                    filledCount += applied.filled;
                    mergeCandidateData(backendData);
                    if (backendData.productId) meta.productId = String(backendData.productId);
                    if (backendData.title) meta.title = String(backendData.title);
                    if (backendData.canonicalUrl) meta.canonicalUrl = String(backendData.canonicalUrl);
                    (backendData.sources || []).forEach(src => sources.add(String(src)));
                }
                (backend?.warnings || []).forEach(w => warnings.push(String(w)));
            } catch (err) {
                warnings.push(`Backend opcional indisponível: ${err.message}`);
            }

            meta.sources = [...sources];
            meta.warnings = warnings.slice(0, 6);
            const modal = document.getElementById('pipeline-modal');
            if (modal) {
                let prevMeta = {};
                try {
                    prevMeta = JSON.parse(modal.dataset.supplierMeta || '{}') || {};
                } catch {
                    prevMeta = {};
                }
                modal.dataset.supplierMeta = JSON.stringify({ ...prevMeta, ...meta });
            }

            if (filledCount <= 0) {
                const hasCandidate = !!mergedData.canonicalUrl
                    || (Number(mergedData?.cost?.value) > 0)
                    || (Array.isArray(mergedData.functions) && mergedData.functions.length > 0);
                if (hasCandidate) {
                    const overwrite = confirm(
                        'Os campos já possuem valor. Deseja sobrescrever com os dados do link do AliExpress?'
                    );
                    if (overwrite) {
                        const forced = this._applySupplierAutofill(mergedData, { emptyOnly: false });
                        filledCount += forced.filled;
                    }
                }
            }

            if (filledCount > 0) {
                showToast(`Campos preenchidos automaticamente (${filledCount}).`, 'success');
            } else {
                const detail = warnings[0] ? ` ${warnings[0]}` : '';
                const hasPdpNpi = !!normalizedUrl.searchParams.get('pdp_npi');
                if (!hasPdpNpi) {
                    showToast(`Este link não traz preço na URL (sem pdp_npi). Para preencher custo automaticamente, configure o extrator de backend (Google Ads Sync URL) ou use um link do AliExpress com pdp_npi.${detail}`, 'info');
                } else {
                    showToast(`Importação parcial: não encontrei dados suficientes para preencher automaticamente.${detail}`, 'info');
                }
            }
        } finally {
            this._supplierAutofillBusy = false;
            btn.disabled = false;
            btn.classList.remove('loading');
            btn.textContent = 'Auto';
        }
    },

    _normalizeName(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ');
    },

    async _ensureProductForTestAds(card) {
        if (!card) return false;
        this._normalizeCardSchema(card);

        const existingById = (AppState?.allProducts || []).find(p => p.id === card.productId);
        if (existingById) return true;

        let targetStoreId = String(card.storeId || '').trim();
        if (!targetStoreId && typeof getWritableStoreId === 'function') {
            targetStoreId = String(getWritableStoreId() || '').trim();
        }

        if (!targetStoreId) {
            showToast('Selecione uma loja específica para criar o produto automaticamente.', 'error');
            return false;
        }

        card.storeId = targetStoreId;
        const normalizedName = this._normalizeName(card.title);
        const sameName = (AppState?.allProducts || []).find(p => {
            return this._normalizeName(p.name) === normalizedName && String(p.storeId || '') === targetStoreId;
        });

        if (sameName) {
            const createDuplicate = confirm(
                `Já existe um produto com o nome "${sameName.name}" nesta loja.\n\nOK = criar produto duplicado.\nCancelar = vincular este card ao produto existente.`
            );
            if (!createDuplicate) {
                card.productId = sameName.id;
                card.updatedAt = new Date().toISOString();
                this.save();
                this.render();
                showToast('Card vinculado ao produto existente.', 'info');
                return true;
            }
        }

        const supplierCostNum = Number(card?.supplier?.cost);
        const supplierCost = Number.isFinite(supplierCostNum) && supplierCostNum >= 0
            ? parseFloat(supplierCostNum.toFixed(2))
            : 0;
        const supplierCurrency = this.normalizeCurrency(card?.supplier?.costCurrency || 'USD');
        const nowIso = new Date().toISOString();

        const product = {
            id: generateId('prod'),
            name: String(card.title || '').trim(),
            language: 'Ingles',
            price: 0,
            priceCurrency: 'USD',
            cost: supplierCost,
            costCurrency: supplierCurrency,
            tax: 0,
            variableCosts: 0,
            cpa: 0,
            cpaCurrency: supplierCurrency,
            status: 'ativo',
            storeId: targetStoreId,
            createdAt: nowIso,
            updatedAt: nowIso
        };

        AppState.allProducts = Array.isArray(AppState.allProducts) ? AppState.allProducts : [];
        AppState.allProducts.push(product);

        if (AppState.sheetsConnected && typeof SheetsAPI !== 'undefined') {
            try {
                await SheetsAPI.appendRow(SheetsAPI.TABS.PRODUCTS, SheetsAPI.productToRow(product));
            } catch (err) {
                showToast(`Produto criado localmente, mas falhou no Sheets: ${err.message}`, 'error');
            }
        }

        card.productId = product.id;
        card.updatedAt = new Date().toISOString();

        filterDataByStore();
        populateProductDropdowns();
        if (typeof EventBus !== 'undefined') EventBus.emit('productsChanged');

        this.save();
        this.render();
        showToast(`Produto "${product.name}" criado automaticamente em Produtos.`, 'success');
        return true;
    },

    getTagOptions(card) {
        const custom = this.normalizeCustomTags(card?.customTags || []);
        return [...this.TAGS, ...custom];
    },

    normalizeCustomTags(tags) {
        const allowedColors = new Set(['red', 'orange', 'green', 'blue', 'purple', 'teal', 'pink']);
        const list = Array.isArray(tags) ? tags : [];
        const seenIds = new Set();
        const seenLabels = new Set();
        const normalized = [];

        list.forEach((tag, idx) => {
            const label = String(tag?.label || '').trim();
            if (!label) return;
            const normalizedLabel = label.toLowerCase();
            if (seenLabels.has(normalizedLabel)) return;
            seenLabels.add(normalizedLabel);

            const idBase = String(tag?.id || '').trim();
            const id = idBase || `custom_tag_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
            if (seenIds.has(id)) return;
            seenIds.add(id);

            const colorRaw = String(tag?.color || '').trim().toLowerCase();
            const color = allowedColors.has(colorRaw) ? colorRaw : 'purple';
            normalized.push({ id, label, color });
        });

        return normalized;
    },

    normalizeDateString(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
        const date = new Date(raw);
        if (!Number.isFinite(date.getTime())) return '';
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 10);
    },

    normalizeIsoDateTime(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        const parsed = new Date(raw);
        if (!Number.isFinite(parsed.getTime())) return '';
        return parsed.toISOString();
    },

    formatDateTime(value) {
        const iso = this.normalizeIsoDateTime(value);
        if (!iso) return '--';
        const date = new Date(iso);
        return date.toLocaleString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    },

    isOverdueDate(dateStr) {
        const normalized = this.normalizeDateString(dateStr);
        if (!normalized) return false;
        return normalized < todayISO();
    },

    getSelectedTagIdsFromModal() {
        return [...document.querySelectorAll('.pipeline-tag-option.selected')]
            .map(el => String(el.dataset.tagId || '').trim())
            .filter(Boolean);
    },

    handleAddCustomTag() {
        const input = document.getElementById('pipeline-new-tag');
        const labelRaw = String(input?.value || '').trim();
        if (!labelRaw) {
            input?.focus();
            return;
        }

        const selectedIds = this.getSelectedTagIdsFromModal();
        const allTags = [...this.TAGS, ...this._modalCustomTags];
        const existing = allTags.find(tag => String(tag?.label || '').trim().toLowerCase() === labelRaw.toLowerCase());
        if (existing) {
            if (!selectedIds.includes(existing.id)) selectedIds.push(existing.id);
            this.renderTagSelector(selectedIds, this._modalCustomTags);
            if (input) {
                input.value = '';
                input.focus();
            }
            return;
        }

        const customTag = {
            id: `custom_tag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            label: labelRaw,
            color: 'purple'
        };
        this._modalCustomTags = this.normalizeCustomTags([...(this._modalCustomTags || []), customTag]);
        selectedIds.push(customTag.id);
        this.renderTagSelector(selectedIds, this._modalCustomTags);

        if (input) {
            input.value = '';
            input.focus();
        }
        if (typeof showToast === 'function') showToast('Tag adicionada ao card.', 'success');
    },

    renderTagSelector(selectedTags = [], customTags = []) {
        const container = document.getElementById('pipeline-tag-selector');
        if (!container) return;
        container.innerHTML = '';

        const selectedSet = new Set((Array.isArray(selectedTags) ? selectedTags : [])
            .map(tagId => String(tagId || '').trim())
            .filter(Boolean));

        const tagOptions = [...this.TAGS, ...this.normalizeCustomTags(customTags)];
        tagOptions.forEach(tag => {
            const el = document.createElement('span');
            const color = String(tag.color || 'purple').toLowerCase();
            const safeColor = ['red', 'orange', 'green', 'blue', 'purple', 'teal', 'pink'].includes(color) ? color : 'purple';
            const tagId = String(tag.id || '').trim();
            el.className = `pipeline-tag-option kanban-tag kanban-tag-${safeColor}${selectedSet.has(tagId) ? ' selected' : ''}`;
            el.dataset.tagId = tagId;
            el.textContent = String(tag.label || '').trim() || 'Tag';
            el.addEventListener('click', () => el.classList.toggle('selected'));
            container.appendChild(el);
        });
    },

    updateCardMetaInfo(card) {
        const createdEl = document.getElementById('pipeline-created-at-text');
        const updatedEl = document.getElementById('pipeline-updated-at-text');
        if (!createdEl || !updatedEl) return;
        if (!card) {
            createdEl.textContent = 'Criado em: será registrado ao salvar.';
            updatedEl.textContent = 'Atualizado em: --';
            return;
        }
        createdEl.textContent = `Criado em: ${this.formatDateTime(card.createdAt)}`;
        updatedEl.textContent = `Atualizado em: ${this.formatDateTime(card.updatedAt || card.createdAt)}`;
    },

    _parseLooseNumber(value) {
        const raw = String(value || '').trim();
        if (!raw) return 0;
        const cleaned = raw.replace(/[^0-9,.-]/g, '');
        if (!cleaned) return 0;
        const hasComma = cleaned.includes(',');
        const hasDot = cleaned.includes('.');
        if (hasComma && hasDot) {
            const lastComma = cleaned.lastIndexOf(',');
            const lastDot = cleaned.lastIndexOf('.');
            if (lastComma > lastDot) {
                const normalized = cleaned.replace(/\./g, '').replace(',', '.');
                const n = parseFloat(normalized);
                return Number.isFinite(n) ? n : 0;
            }
            const normalized = cleaned.replace(/,/g, '');
            const n = parseFloat(normalized);
            return Number.isFinite(n) ? n : 0;
        }
        if (hasComma && !hasDot) {
            const normalized = cleaned.replace(',', '.');
            const n = parseFloat(normalized);
            return Number.isFinite(n) ? n : 0;
        }
        const n = parseFloat(cleaned);
        return Number.isFinite(n) ? n : 0;
    },

    parseNumber(value) {
        const raw = String(value || '').trim();
        if (!raw) return 0;
        const normalized = raw
            .replace(/\s+/g, '')
            .replace(/\./g, '')
            .replace(',', '.')
            .replace(/[^0-9.-]/g, '');
        const n = parseFloat(normalized);
        return Number.isFinite(n) ? n : 0;
    },

    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }
};

document.addEventListener('DOMContentLoaded', () => PipelineModule.init());
