/* ===========================
   Ad Library — mostra os anúncios salvos na Mineração (Swipe File) e é a
   ponte pro resto do pipeline: daqui o usuário joga um anúncio num board de
   Saved Inspirations, ou manda direto pro Estúdio como criativo base.

   Lê SwipeModule._entries (mesma fonte do Swipe em Criativos) — const global,
   não vive em window, então usa o identificador bare com guarda.
   =========================== */
(function () {
    const AdLibrary = {
        _filtroTexto: '',
        _filtroFormato: '',

        init() {
            if (document.readyState !== 'loading') this._setup();
            else document.addEventListener('DOMContentLoaded', () => this._setup());
        },

        _setup() {
            document.getElementById('adlib-search')?.addEventListener('input', (e) => {
                this._filtroTexto = e.target.value.toLowerCase(); this._render();
            });
            document.getElementById('adlib-format')?.addEventListener('change', (e) => {
                this._filtroFormato = e.target.value; this._render();
            });

            document.getElementById('adlib-grid')?.addEventListener('click', (e) => {
                const usar = e.target.closest('[data-adlib-estudio]');
                if (usar) { this._usarNoEstudio(usar.dataset.adlibEstudio); return; }
                const salvar = e.target.closest('[data-adlib-inspo]');
                if (salvar) { this._enviarParaInspiracoes(salvar.dataset.adlibInspo); return; }
                const remover = e.target.closest('[data-adlib-remover]');
                if (remover) { this._remover(remover.dataset.adlibRemover); return; }
                const ampliar = e.target.closest('[data-adlib-ampliar]');
                if (ampliar) {
                    const ad = this._entries().find(x => x.id === ampliar.dataset.adlibAmpliar);
                    if (ad?.thumbnail && typeof abrirImagemAmpliada === 'function') abrirImagemAmpliada(ad.thumbnail, ad.title || '');
                    return;
                }
            });

            if (typeof EventBus !== 'undefined') {
                EventBus.on('tabChanged', (tab) => { if (tab === 'ad-library') this._render(); });
                EventBus.on('swipeChanged', () => this._render());
            }
        },

        _entries() {
            return (typeof SwipeModule !== 'undefined' && Array.isArray(SwipeModule._entries)) ? SwipeModule._entries : [];
        },

        _filtradas() {
            let lista = this._entries();
            if (this._filtroFormato) lista = lista.filter(e => (e.format || '') === this._filtroFormato);
            if (this._filtroTexto) {
                const t = this._filtroTexto;
                lista = lista.filter(e => [e.title, e.author, e.notes, e.body_orig, e.cta_orig]
                    .some(x => String(x || '').toLowerCase().includes(t)));
            }
            return lista;
        },

        _render() {
            const grid = document.getElementById('adlib-grid');
            const count = document.getElementById('adlib-count');
            if (!grid) return;
            const total = this._entries().length;
            const lista = this._filtradas();
            if (count) count.textContent = total ? `${total} salvo${total !== 1 ? 's' : ''}` : '';

            if (!total) {
                grid.innerHTML = `<div class="adhub-empty" style="padding:4rem 0;grid-column:1/-1">
                    <i data-lucide="library" style="width:48px;height:48px;color:var(--text-muted)"></i>
                    <h3>Nenhum anúncio salvo ainda</h3>
                    <p>Vá em <a href="#" class="sidebar-link" data-tab="mining" style="color:var(--accent)">Mineração</a>, busque anúncios e clique em <strong>Salvar no Swipe</strong>.</p>
                </div>`;
                if (window.lucide?.createIcons) try { lucide.createIcons(); } catch (e) {}
                return;
            }
            if (!lista.length) {
                grid.innerHTML = `<div class="adhub-empty" style="padding:3rem 0;grid-column:1/-1">
                    <i data-lucide="search-x" style="width:40px;height:40px;color:var(--text-muted)"></i>
                    <h3>Nada encontrado</h3><p>Tente outro termo ou formato.</p></div>`;
                if (window.lucide?.createIcons) try { lucide.createIcons(); } catch (e) {}
                return;
            }

            grid.innerHTML = lista.map(ad => this._cardHtml(ad)).join('');
            if (window.lucide?.createIcons) try { lucide.createIcons(); } catch (e) {}
        },

        _cardHtml(ad) {
            const thumb = ad.thumbnail || '';
            const isVideo = (ad.format || '') === 'video';
            return `<div class="adlib-card" data-id="${this._esc(ad.id)}">
                <div class="adlib-card-thumb">
                    ${thumb
                        ? `<img src="${this._esc(thumb)}" alt="" loading="lazy" data-adlib-ampliar="${this._esc(ad.id)}" style="cursor:zoom-in">`
                        : `<div class="adlib-card-noimg"><i data-lucide="image" style="width:26px;height:26px"></i></div>`}
                    ${isVideo ? '<span class="adlib-chip"><i data-lucide="play" style="width:10px;height:10px;vertical-align:-1px"></i> vídeo</span>' : ''}
                </div>
                <div class="adlib-card-body">
                    <strong class="adlib-card-title">${this._esc(ad.title || 'Anúncio')}</strong>
                    <span class="adlib-card-author">${this._esc(ad.author || '')}</span>
                    ${ad.notes ? `<p class="adlib-card-note">${this._esc(String(ad.notes).slice(0, 120))}</p>` : ''}
                    <div class="adlib-card-actions">
                        <button class="btn btn-primary btn-sm" data-adlib-estudio="${this._esc(ad.id)}" title="Importar como criativo base no Estúdio"><i data-lucide="palette" style="width:12px;height:12px;vertical-align:-2px"></i> Estúdio</button>
                        <button class="btn btn-secondary btn-sm" data-adlib-inspo="${this._esc(ad.id)}" title="Salvar num board de Saved Inspirations"><i data-lucide="bookmark" style="width:12px;height:12px;vertical-align:-2px"></i> Inspirações</button>
                        ${ad.url ? `<a href="${this._esc(ad.url)}" target="_blank" rel="noopener" class="btn-icon" title="Ver o anúncio original"><i data-lucide="external-link" style="width:13px;height:13px"></i></a>` : ''}
                        <button class="btn-icon" data-adlib-remover="${this._esc(ad.id)}" title="Remover do Swipe"><i data-lucide="trash-2" style="width:13px;height:13px"></i></button>
                    </div>
                </div>
            </div>`;
        },

        _enviarParaInspiracoes(adId) {
            const ad = this._entries().find(x => x.id === adId);
            if (!ad) return;
            if (typeof SavedInspirations === 'undefined') { showToast('Saved Inspirations não carregou.', 'error'); return; }
            if (!ad.thumbnail) { showToast('Este anúncio não tem imagem para salvar.', 'error'); return; }

            const item = { type: 'image', url: ad.thumbnail, thumbnail: ad.thumbnail, note: ad.title || ad.author || '' };
            const boards = SavedInspirations.listarBoards();

            const salvar = (boardId) => {
                const b = SavedInspirations.adicionarItem(boardId, item);
                showToast(`Salvo no board "${b.name}"`, 'success');
            };

            if (boards.length <= 1) { salvar(boards[0]?.id); return; }

            // 2+ boards → deixa escolher qual.
            this._pickBoard(boards, salvar);
        },

        _pickBoard(boards, aoEscolher) {
            const html = `
                <div id="adlib-board-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:10000;display:flex;align-items:center;justify-content:center">
                    <div style="background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;padding:1.1rem;width:min(360px,92vw);display:flex;flex-direction:column;gap:0.5rem">
                        <strong style="font-size:0.95rem">Salvar em qual board?</strong>
                        ${boards.map(b => `<button type="button" class="btn btn-secondary btn-sm" data-board="${this._esc(b.id)}" style="justify-content:flex-start;gap:0.5rem"><span style="width:10px;height:10px;border-radius:50%;background:${this._esc(b.color || '#8b5cf6')};display:inline-block"></span> ${this._esc(b.name)} <span style="margin-left:auto;color:var(--text-muted);font-size:0.72rem">${b.count}</span></button>`).join('')}
                    </div>
                </div>`;
            document.body.insertAdjacentHTML('beforeend', html);
            const ov = document.getElementById('adlib-board-overlay');
            ov.addEventListener('click', (e) => {
                if (e.target === ov) { ov.remove(); return; }
                const btn = e.target.closest('[data-board]');
                if (btn) { ov.remove(); aoEscolher(btn.dataset.board); }
            });
        },

        async _usarNoEstudio(adId) {
            const ad = this._entries().find(x => x.id === adId);
            if (!ad) return;
            if (!ad.thumbnail) { showToast('Este anúncio não tem imagem para usar como base.', 'error'); return; }
            if (typeof StudioModule === 'undefined' || !StudioModule.criarPadraoDeImagem) { showToast('Estúdio não carregou.', 'error'); return; }
            showToast('Enviando ao Estúdio — a IA está lendo o anúncio…', 'info');
            try {
                const blob = await bytesDaImagem(ad.thumbnail);
                const nome = (ad.title || ad.author || 'Inspiração').slice(0, 50);
                const file = new File([blob], nome.replace(/[^\w]+/g, '-').toLowerCase() + '.jpg', { type: blob.type || 'image/jpeg' });
                const p = await StudioModule.criarPadraoDeImagem(file, nome);
                document.querySelector('.sidebar-link[data-tab="studio"]')?.click();
                showToast(`Importado como padrão "${p.nome}" no Estúdio.`, 'success');
            } catch (e) {
                showToast('Falha ao importar: ' + String(e.message || e).slice(0, 140), 'error');
            }
        },

        _remover(adId) {
            if (typeof SwipeModule === 'undefined') return;
            const ad = this._entries().find(x => x.id === adId);
            if (!ad || !confirm(`Remover "${ad.title || 'anúncio'}" do Swipe?`)) return;
            SwipeModule._entries = SwipeModule._entries.filter(e => e.id !== adId);
            if (typeof SwipeModule._persist === 'function') SwipeModule._persist();
            if (typeof SwipeModule._renderGrid === 'function') { try { SwipeModule._renderGrid(); } catch {} }
            this._render();
        },

        _esc(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.AdLibrary = AdLibrary;
    AdLibrary.init();
})();
