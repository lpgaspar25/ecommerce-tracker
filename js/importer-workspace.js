/* Importer Workspace — operational catalog workflow. */
const ImporterWorkspacePreview = {
    enabled: false,
    previewRequested: false,
    step: 'source',
    observer: null,

    init() {
        const params = new URLSearchParams(location.search);
        this.previewRequested = params.get('importerPreview') === '1';
        this.enabled = params.get('legacyImporter') !== '1';
        if (!this.enabled) return;
        const panel = document.getElementById('tab-importador');
        if (!panel || typeof ImporterModule === 'undefined') return;
        panel.classList.add('iw-active');
        this._build(panel);
        this._bind();
        setTimeout(() => {
            if (this.previewRequested && typeof UXShell !== 'undefined' && typeof UXShell.navigate === 'function') UXShell.navigate('importador');
            else if (this.previewRequested) document.querySelector('.tab-btn[data-tab="importador"], .sidebar-link[data-tab="importador"]')?.click();
            this.refresh();
        }, 700);
    },

    _build(panel) {
        const oldHeader = panel.querySelector(':scope > .section-header');
        const sourceBar = panel.querySelector(':scope > .imp-source-bar');
        const sourcePanes = [...panel.querySelectorAll(':scope > .imp-source-pane')];
        const toolbar = document.getElementById('imp-toolbar');
        const products = document.getElementById('imp-products');
        if (!oldHeader || !sourceBar || !toolbar || !products) return;

        const workspace = document.createElement('div');
        workspace.id = 'importer-workspace-preview';
        workspace.innerHTML = `
          <header class="iw-hero">
            <div class="iw-heading">
              <div class="iw-eyebrow"><span></span> CENTRAL DE CATÁLOGO <b>NOVO WORKSPACE</b></div>
              <h2>Traga, prepare e publique produtos</h2>
              <p>Um fluxo único para importar, revisar e enviar à loja — sem perder nenhuma ferramenta.</p>
            </div>
            <div class="iw-hero-actions">
              <button class="iw-btn iw-btn-ghost" data-proxy="btn-imp-sessions"><i data-lucide="history"></i> Trabalhos salvos</button>
              <button class="iw-btn iw-btn-ghost" data-proxy="btn-imp-shops"><i data-lucide="store"></i> Lojas</button>
              <button class="iw-btn iw-btn-primary" data-iw-action="continue">Continuar <i data-lucide="arrow-right"></i></button>
            </div>
          </header>
          <div class="iw-stepper" role="tablist" aria-label="Etapas do importador">
            ${this._stepButton('source', '01', 'Origem', 'Escolha de onde vêm os produtos', true)}
            ${this._stepButton('review', '02', 'Revisar', 'Confira conteúdo e variantes')}
            ${this._stepButton('prepare', '03', 'Preparar', 'Imagens, idioma e marca')}
            ${this._stepButton('publish', '04', 'Publicar', 'Destino e confirmação')}
          </div>
          <div class="iw-layout">
            <main class="iw-main">
              <section class="iw-stage active" data-iw-stage="source">
                <div class="iw-stage-head"><div><span>ETAPA 1</span><h3>Como você quer trazer os produtos?</h3><p>Escolha uma fonte. Nada é publicado nesta etapa.</p></div><div class="iw-safe"><i data-lucide="shield-check"></i> Origens intactas</div></div>
                <div class="iw-source-slot"></div>
              </section>
              <section class="iw-stage" data-iw-stage="review">
                <div class="iw-stage-head"><div><span>ETAPA 2</span><h3>Revise antes de preparar</h3><p>Selecione os produtos e abra apenas os que precisam de ajuste.</p></div><button class="iw-text-btn" data-proxy="btn-imp-clear">Limpar fila</button></div>
                <div class="iw-review-tools"></div>
                <div class="iw-products-slot"></div>
                <div class="iw-demo-list"></div>
              </section>
              <section class="iw-stage" data-iw-stage="prepare">
                <div class="iw-stage-head"><div><span>ETAPA 3</span><h3>Prepare em massa ou individualmente</h3><p>As ferramentas atuam somente nos produtos selecionados.</p></div><div class="iw-selection-pill"><strong data-iw-selected>0</strong> selecionados</div></div>
                <div class="iw-tool-grid">
                  ${this._toolCard('languages','Traduzir conteúdo','Título, descrição e SEO nos idiomas escolhidos','imp-lang-btn')}
                  ${this._toolCard('image-down','Comprimir imagens','WebP otimizado antes do envio','imp-compress-toggle')}
                  ${this._toolCard('wand-sparkles','Trocar marca','Ajuste textos e marcas visuais','btn-imp-rebrand')}
                  ${this._toolCard('pencil-ruler','Editar produto','Conteúdo, fotos, variantes e preços','iw-open-review')}
                </div>
                <div class="iw-prepare-note"><i data-lucide="info"></i><span>Você continua podendo editar cada produto separadamente na etapa Revisar.</span></div>
              </section>
              <section class="iw-stage" data-iw-stage="publish">
                <div class="iw-stage-head"><div><span>ETAPA 4</span><h3>Confirme o destino</h3><p>Revise o resumo final antes de criar ou atualizar produtos.</p></div><div class="iw-safe"><i data-lucide="lock-keyhole"></i> Publicação controlada</div></div>
                <div class="iw-publish-grid">
                  <div class="iw-publish-config"><span>LOJA DE DESTINO</span><div class="iw-shop-slot"></div><span>MODO DE PUBLICAÇÃO</span><div class="iw-mode-slot"></div></div>
                  <div class="iw-summary"><span>RESUMO</span><div><small>Produtos</small><strong data-iw-selected>0</strong></div><div><small>Imagens</small><strong data-iw-images>0</strong></div><div><small>Idiomas</small><strong data-iw-langs>0</strong></div><div><small>Otimização</small><strong data-iw-compress>Desligada</strong></div></div>
                </div>
                <div class="iw-publish-action"><div><strong>Pronto para publicar?</strong><span>A ferramenta mostrará o progresso e preservará os produtos de origem.</span></div><div class="iw-publish-btn-slot"></div></div>
              </section>
            </main>
            <aside class="iw-ops">
              <div class="iw-ops-title"><span><i data-lucide="activity"></i></span><div><small>OPERAÇÕES</small><strong>Estado do trabalho</strong></div><b data-iw-status>Em preparo</b></div>
              <div class="iw-progress-ring"><div><strong data-iw-ready>25%</strong><span>pronto</span></div></div>
              <div class="iw-checklist">
                <button data-iw-goto="source"><i data-lucide="check"></i><span><strong>Origem escolhida</strong><small data-iw-source>CSV Shopify</small></span></button>
                <button data-iw-goto="review"><i data-lucide="package-check"></i><span><strong>Produtos carregados</strong><small data-iw-products>0 na fila</small></span></button>
                <button data-iw-goto="prepare"><i data-lucide="sparkles"></i><span><strong>Preparação</strong><small data-iw-preparation>Aguardando seleção</small></span></button>
                <button data-iw-goto="publish"><i data-lucide="store"></i><span><strong>Destino</strong><small data-iw-destination>Escolha uma loja</small></span></button>
              </div>
              <div class="iw-ops-foot"><i data-lucide="save"></i><span>O trabalho fica salvo automaticamente neste navegador.</span></div>
            </aside>
          </div>`;

        oldHeader.after(workspace);
        oldHeader.classList.add('iw-original-header');
        const sourceSlot = workspace.querySelector('.iw-source-slot');
        sourceSlot.append(sourceBar, ...sourcePanes);
        workspace.querySelector('.iw-review-tools').append(toolbar);
        workspace.querySelector('.iw-products-slot').append(products);

        const shop = document.getElementById('imp-target-shop');
        const mode = document.getElementById('imp-publish-mode');
        const publish = document.getElementById('imp-publish-btn');
        if (shop) workspace.querySelector('.iw-shop-slot').append(shop);
        if (mode) workspace.querySelector('.iw-mode-slot').append(mode);
        if (publish) workspace.querySelector('.iw-publish-btn-slot').append(publish);
        if (this.previewRequested) this._renderDemo();
    },

    _stepButton(id, number, title, copy, active = false) {
        return `<button class="iw-step ${active ? 'active' : ''}" data-iw-goto="${id}" role="tab"><span>${number}</span><div><strong>${title}</strong><small>${copy}</small></div><i data-lucide="chevron-right"></i></button>`;
    },

    _toolCard(icon, title, copy, action) {
        return `<button class="iw-tool" data-iw-tool="${action}"><span><i data-lucide="${icon}"></i></span><div><strong>${title}</strong><small>${copy}</small></div><i data-lucide="arrow-up-right"></i></button>`;
    },

    _renderDemo() {
        const root = document.querySelector('.iw-demo-list');
        if (!root) return;
        root.innerHTML = `
          <div class="iw-demo-label"><span>DEMONSTRAÇÃO LOCAL</span> Dados ilustrativos, não são salvos</div>
          ${[
            ['Sophia Bag — Black','6 fotos','3 variantes','Revisado'],
            ['Sophia Bag — Canvas','7 fotos','3 variantes','Ajustar SEO'],
            ['Sophia Bag — Espresso','6 fotos','3 variantes','Revisado']
          ].map((p,i)=>`<article class="iw-demo-product"><label><input type="checkbox" ${i !== 1 ? 'checked' : ''}></label><div class="iw-demo-thumb">${String(i+1).padStart(2,'0')}</div><div><strong>${p[0]}</strong><span>${p[1]} · ${p[2]}</span></div><b class="${i===1?'warn':''}">${p[3]}</b><button data-iw-goto="review">Editar <i data-lucide="arrow-right"></i></button></article>`).join('')}`;
    },

    _bind() {
        document.querySelectorAll('[data-iw-goto]').forEach(btn => btn.addEventListener('click', () => this.setStep(btn.dataset.iwGoto)));
        document.querySelector('[data-iw-action="continue"]')?.addEventListener('click', () => {
            const order = ['source','review','prepare','publish'];
            this.setStep(order[Math.min(order.length - 1, order.indexOf(this.step) + 1)]);
        });
        document.querySelectorAll('[data-proxy]').forEach(btn => btn.addEventListener('click', () => document.getElementById(btn.dataset.proxy)?.click()));
        document.querySelectorAll('[data-iw-tool]').forEach(btn => btn.addEventListener('click', () => {
            const action = btn.dataset.iwTool;
            if (action === 'iw-open-review') return this.setStep('review');
            if (action === 'imp-compress-toggle') {
                const toggle = document.getElementById(action); if (toggle) { toggle.checked = !toggle.checked; toggle.dispatchEvent(new Event('change')); }
                return this.refresh();
            }
            document.getElementById(action)?.click();
        }));
        document.querySelectorAll('input[name="imp-source"]').forEach(r => r.addEventListener('change', () => this.refresh()));
        ['imp-target-shop','imp-publish-mode','imp-compress-toggle','imp-select-all'].forEach(id => document.getElementById(id)?.addEventListener('change', () => setTimeout(() => this.refresh(), 30)));
        const products = document.getElementById('imp-products');
        this.observer = new MutationObserver(() => this.refresh());
        if (products) this.observer.observe(products, { childList: true, subtree: true });
    },

    setStep(step) {
        if (!['source','review','prepare','publish'].includes(step)) return;
        this.step = step;
        document.querySelectorAll('.iw-stage').forEach(s => s.classList.toggle('active', s.dataset.iwStage === step));
        document.querySelectorAll('.iw-step').forEach(s => s.classList.toggle('active', s.dataset.iwGoto === step));
        const labels = { source:'Escolher origem', review:'Continuar', prepare:'Revisar publicação', publish:'Tudo revisado' };
        const button = document.querySelector('[data-iw-action="continue"]');
        if (button) button.innerHTML = `${labels[step]} <i data-lucide="arrow-right"></i>`;
        this.refresh();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    refresh() {
        if (!this.enabled) return;
        const state = ImporterModule._state || {};
        const products = Array.isArray(state.rawProducts) ? state.rawProducts : [];
        const usingDemo = this.previewRequested && products.length === 0;
        const selected = usingDemo ? 2 : (state.selected?.size || 0);
        const selectedProducts = products.filter(p => state.selected?.has(p.id));
        const images = usingDemo ? 12 : selectedProducts.reduce((sum,p) => sum + (p.images?.length || 0), 0);
        const langs = usingDemo ? 2 : new Set(selectedProducts.flatMap(p => Object.keys(p.translations || {}))).size;
        const source = document.querySelector('input[name="imp-source"]:checked')?.value || 'csv';
        const shop = document.getElementById('imp-target-shop');
        const shopName = shop?.selectedOptions?.[0]?.textContent || '';
        const compress = !!document.getElementById('imp-compress-toggle')?.checked;
        document.querySelectorAll('[data-iw-selected]').forEach(el => el.textContent = selected);
        document.querySelector('[data-iw-images]')?.replaceChildren(document.createTextNode(String(images)));
        document.querySelector('[data-iw-langs]')?.replaceChildren(document.createTextNode(String(langs)));
        document.querySelector('[data-iw-compress]')?.replaceChildren(document.createTextNode(compress ? 'Ligada' : 'Desligada'));
        const sourceNames = { csv:'CSV Shopify', url:'URL da loja', extension:'Extensão Chrome' };
        document.querySelector('[data-iw-source]').textContent = sourceNames[source];
        document.querySelector('[data-iw-products]').textContent = `${usingDemo ? 3 : products.length} na fila${usingDemo ? ' · demonstração' : ''}`;
        document.querySelector('[data-iw-preparation]').textContent = selected ? `${selected} selecionados · ${images} imagens` : 'Aguardando seleção';
        document.querySelector('[data-iw-destination]').textContent = shop?.value ? shopName : 'Escolha uma loja';
        const checks = [true, usingDemo || products.length > 0, selected > 0, !!shop?.value];
        const ready = Math.round(checks.filter(Boolean).length / checks.length * 100);
        document.querySelector('[data-iw-ready]').textContent = `${ready}%`;
        document.querySelector('.iw-progress-ring')?.style.setProperty('--iw-ready', `${ready * 3.6}deg`);
        document.querySelector('[data-iw-status]').textContent = usingDemo ? 'Demonstração' : ready === 100 ? 'Pronto' : products.length ? 'Em preparo' : 'Aguardando';
        document.querySelector('.iw-demo-list')?.classList.toggle('hidden', !usingDemo);
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
};

document.addEventListener('DOMContentLoaded', () => setTimeout(() => ImporterWorkspacePreview.init(), 0));
