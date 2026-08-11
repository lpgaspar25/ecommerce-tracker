/* ===========================
   Saved Inspirations — boards de ads e referências
   =========================== */
(function () {
    const SavedInspirations = {
        STORAGE_KEY: 'etracker_boards',
        _activeBoard: null,

        init() {
            if (document.readyState !== 'loading') this._setup();
            else document.addEventListener('DOMContentLoaded', () => this._setup());
        },

        _setup() {
            document.getElementById('btn-new-board')?.addEventListener('click', () => this._openNewBoardModal());

            document.getElementById('modal-new-board-close')?.addEventListener('click', () => this._closeNewBoardModal());
            document.querySelector('#modal-new-board .modal-overlay')?.addEventListener('click', () => this._closeNewBoardModal());
            document.getElementById('new-board-form')?.addEventListener('submit', (e) => {
                e.preventDefault();
                this._createBoard();
            });
            document.getElementById('new-board-cancel')?.addEventListener('click', () => this._closeNewBoardModal());

            // Color preset buttons
            document.querySelectorAll('.board-color-preset').forEach(btn => {
                btn.addEventListener('click', () => {
                    const colorInput = document.getElementById('new-board-color');
                    if (colorInput) colorInput.value = btn.dataset.color;
                });
            });

            document.getElementById('modal-add-inspo-close')?.addEventListener('click', () => this._closeAddInspoModal());
            document.querySelector('#modal-add-inspo .modal-overlay')?.addEventListener('click', () => this._closeAddInspoModal());
            document.getElementById('add-inspo-form')?.addEventListener('submit', (e) => {
                e.preventDefault();
                this._addInspiration();
            });
            document.getElementById('add-inspo-cancel')?.addEventListener('click', () => this._closeAddInspoModal());

            // URL preview on paste
            document.getElementById('add-inspo-url')?.addEventListener('input', (e) => {
                const url = e.target.value.trim();
                const preview = document.getElementById('add-inspo-preview');
                if (!preview) return;
                if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)(\?.*)?$/i)) {
                    preview.innerHTML = `<img src="${url}" style="max-width:100%;max-height:120px;border-radius:6px;object-fit:contain" onerror="this.parentElement.innerHTML=''">`;
                } else {
                    try {
                        const host = new URL(url).hostname;
                        preview.innerHTML = `<span style="font-size:0.75rem;color:var(--text-muted)">${host}</span>`;
                    } catch { preview.innerHTML = ''; }
                }
            });

            document.getElementById('boards-tabs')?.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-board-tab]');
                if (btn && !e.target.closest('[data-delete-board]')) {
                    this._activeBoard = btn.dataset.boardTab === '__all' ? null : btn.dataset.boardTab;
                    this._renderTabs();
                    this._renderGrid();
                    return;
                }
                const del = e.target.closest('[data-delete-board]');
                if (del) { e.stopPropagation(); this._deleteBoard(del.dataset.deleteBoard); }
            });

            document.getElementById('boards-grid')?.addEventListener('click', (e) => {
                if (e.target.closest('[data-add-inspo]')) {
                    this._openAddInspoModal(e.target.closest('[data-add-inspo]').dataset.addInspo);
                    return;
                }
                if (e.target.closest('[data-delete-inspo]')) {
                    const btn = e.target.closest('[data-delete-inspo]');
                    this._deleteItem(btn.dataset.deleteInspo, btn.dataset.boardId);
                    return;
                }
                const usar = e.target.closest('[data-usar-estudio]');
                if (usar) { this._usarNoEstudio(usar.dataset.usarEstudio, usar.dataset.boardId); return; }
                const ampliar = e.target.closest('[data-ampliar-inspo]');
                if (ampliar) {
                    const it = this._acharItem(ampliar.dataset.ampliarInspo, ampliar.dataset.boardId);
                    if (it && typeof abrirImagemAmpliada === 'function') abrirImagemAmpliada(it.thumbnail || it.url, it.note || '');
                    return;
                }
                const boardCard = e.target.closest('[data-open-board]');
                if (boardCard) {
                    this._activeBoard = boardCard.dataset.openBoard;
                    this._renderTabs();
                    this._renderGrid();
                }
            });

            if (typeof EventBus !== 'undefined') {
                EventBus.on('tabChanged', (tab) => { if (tab === 'saved-inspirations') this._render(); });
            }
        },

        _load() {
            try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]'); }
            catch { return []; }
        },

        _save(boards) {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(boards));
        },

        _render() {
            this._renderTabs();
            this._renderGrid();
        },

        _renderTabs() {
            const el = document.getElementById('boards-tabs');
            if (!el) return;
            const boards = this._load();

            const allBtn = `<button class="boards-tab ${this._activeBoard === null ? 'boards-tab-active' : ''}" data-board-tab="__all">
                <i data-lucide="grid-3x3" style="width:11px;height:11px;margin-right:4px;vertical-align:-1px"></i>Todos
            </button>`;

            const boardBtns = boards.map(b => `
                <button class="boards-tab ${this._activeBoard === b.id ? 'boards-tab-active' : ''}" data-board-tab="${this._esc(b.id)}">
                    <span class="boards-tab-dot" style="background:${this._esc(b.color || '#8b5cf6')}"></span>
                    ${this._esc(b.name)}
                    <span class="boards-tab-count">${(b.items || []).length}</span>
                    <span class="boards-tab-del" data-delete-board="${this._esc(b.id)}" title="Deletar board">×</span>
                </button>
            `).join('');

            el.innerHTML = allBtn + boardBtns;
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch (e) {}
        },

        _renderGrid() {
            const el = document.getElementById('boards-grid');
            if (!el) return;
            const boards = this._load();

            if (this._activeBoard === null) {
                if (!boards.length) {
                    el.innerHTML = `<div class="adhub-empty" style="padding:4rem 0;grid-column:1/-1">
                        <i data-lucide="bookmark" style="width:48px;height:48px;color:var(--text-muted)"></i>
                        <h3>Nenhum board criado</h3>
                        <p>Crie um board para organizar suas inspirações de anúncios.</p>
                    </div>`;
                    if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch (e) {}
                    return;
                }
                el.innerHTML = boards.map(b => {
                    const items = b.items || [];
                    const thumbs = items.slice(0, 4).filter(i => i.thumbnail || (i.type === 'image' && i.url));
                    return `<div class="board-card" data-open-board="${this._esc(b.id)}">
                        <div class="board-card-cover" style="--board-color:${this._esc(b.color || '#8b5cf6')}">
                            ${thumbs.length ? thumbs.map(i => `<img src="${this._esc(i.thumbnail || i.url)}" alt="">`).join('') : `<i data-lucide="bookmark" style="width:28px;height:28px;color:${this._esc(b.color || '#8b5cf6')}"></i>`}
                        </div>
                        <div class="board-card-info">
                            <span class="board-card-name">${this._esc(b.name)}</span>
                            <span class="board-card-count">${items.length} item${items.length !== 1 ? 's' : ''}</span>
                        </div>
                    </div>`;
                }).join('');
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch (e) {}
                return;
            }

            const board = boards.find(b => b.id === this._activeBoard);
            if (!board) { this._activeBoard = null; this._renderGrid(); return; }

            const items = board.items || [];
            const addCard = `<div class="inspo-add-card" data-add-inspo="${this._esc(board.id)}">
                <i data-lucide="plus" style="width:22px;height:22px;color:var(--text-muted)"></i>
                <span>Adicionar</span>
            </div>`;

            if (!items.length) {
                el.innerHTML = `<div class="adhub-empty" style="padding:2rem 0;grid-column:1/-1">
                    <i data-lucide="image-plus" style="width:40px;height:40px;color:var(--text-muted)"></i>
                    <h3>Board vazio</h3>
                    <p>Adicione URLs de anúncios ou faça upload de imagens de referência.</p>
                </div>` + addCard;
                if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch (e) {}
                return;
            }

            el.innerHTML = items.map(item => this._inspoCardHtml(item, board.id)).join('') + addCard;
            if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch (e) {}
        },

        _inspoCardHtml(item, boardId) {
            const src = item.thumbnail || (item.type === 'image' && item.url) || '';
            const hasImg = !!src;
            const domain = item.type === 'url' && item.url ? (() => { try { return new URL(item.url).hostname; } catch { return ''; } })() : '';
            return `<div class="inspo-card">
                ${hasImg
                    ? `<div class="inspo-card-thumb"><img src="${this._esc(src)}" alt="" loading="lazy" data-ampliar-inspo="${this._esc(item.id)}" data-board-id="${this._esc(boardId)}" style="cursor:zoom-in"></div>`
                    : `<div class="inspo-card-link"><i data-lucide="link" style="width:20px;height:20px;color:var(--accent)"></i><span>${this._esc(domain || 'link')}</span></div>`
                }
                ${item.note ? `<div class="inspo-card-note">${this._esc(item.note)}</div>` : ''}
                ${hasImg ? `<button class="btn btn-primary btn-sm inspo-card-usar" data-usar-estudio="${this._esc(item.id)}" data-board-id="${this._esc(boardId)}" title="Importar este anúncio para o Estúdio como criativo base"><i data-lucide="palette" style="width:12px;height:12px;vertical-align:-2px"></i> Usar no Estúdio</button>` : ''}
                <div class="inspo-card-footer">
                    ${item.type === 'url' && item.url
                        ? `<a href="${this._esc(item.url)}" target="_blank" rel="noopener" class="inspo-card-url"><i data-lucide="external-link" style="width:11px;height:11px"></i>${this._esc(domain)}</a>`
                        : `<span class="inspo-card-url">imagem</span>`
                    }
                    <button class="btn-icon" data-delete-inspo="${this._esc(item.id)}" data-board-id="${this._esc(boardId)}" title="Remover">
                        <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                    </button>
                </div>
            </div>`;
        },

        _openNewBoardModal() {
            document.getElementById('modal-new-board')?.classList.remove('hidden');
            setTimeout(() => document.getElementById('new-board-name')?.focus(), 50);
        },

        _closeNewBoardModal() {
            document.getElementById('modal-new-board')?.classList.add('hidden');
            document.getElementById('new-board-form')?.reset();
        },

        _createBoard() {
            const name = (document.getElementById('new-board-name')?.value || '').trim();
            const color = document.getElementById('new-board-color')?.value || '#8b5cf6';
            if (!name) return;
            const boards = this._load();
            const id = 'board_' + Date.now();
            boards.push({ id, name, color, items: [], createdAt: new Date().toISOString() });
            this._save(boards);
            this._activeBoard = id;
            this._closeNewBoardModal();
            this._render();
            if (typeof showToast === 'function') showToast(`Board "${name}" criado!`, 'success');
        },

        _deleteBoard(id) {
            const boards = this._load();
            const board = boards.find(b => b.id === id);
            if (!board) return;
            if (!confirm(`Deletar board "${board.name}" e todos os ${(board.items || []).length} item(s)?`)) return;
            this._save(boards.filter(b => b.id !== id));
            if (this._activeBoard === id) this._activeBoard = null;
            this._render();
            if (typeof showToast === 'function') showToast('Board deletado', 'success');
        },

        _openAddInspoModal(boardId) {
            const modal = document.getElementById('modal-add-inspo');
            if (!modal) return;
            modal.dataset.boardId = boardId;
            modal.classList.remove('hidden');
            const preview = document.getElementById('add-inspo-preview');
            if (preview) preview.innerHTML = '';
            setTimeout(() => document.getElementById('add-inspo-url')?.focus(), 50);
        },

        _closeAddInspoModal() {
            const modal = document.getElementById('modal-add-inspo');
            if (modal) { modal.classList.add('hidden'); delete modal.dataset.boardId; }
            document.getElementById('add-inspo-form')?.reset();
            const preview = document.getElementById('add-inspo-preview');
            if (preview) preview.innerHTML = '';
        },

        _addInspiration() {
            const modal = document.getElementById('modal-add-inspo');
            if (!modal) return;
            const boardId = modal.dataset.boardId;
            if (!boardId) return;

            const url = (document.getElementById('add-inspo-url')?.value || '').trim();
            const note = (document.getElementById('add-inspo-note')?.value || '').trim();
            const file = document.getElementById('add-inspo-file')?.files?.[0];

            if (!url && !file) {
                if (typeof showToast === 'function') showToast('Cole uma URL ou selecione uma imagem', 'error');
                return;
            }

            const doSave = (item) => {
                const boards = this._load();
                const board = boards.find(b => b.id === boardId);
                if (!board) return;
                board.items.unshift(item);
                this._save(boards);
                this._closeAddInspoModal();
                this._renderGrid();
                this._renderTabs();
                if (typeof showToast === 'function') showToast('Inspiração adicionada!', 'success');
            };

            if (file) {
                const reader = new FileReader();
                reader.onload = () => doSave({
                    id: 'inspo_' + Date.now(),
                    type: 'image', url: reader.result, thumbnail: reader.result, note,
                    createdAt: new Date().toISOString(),
                });
                reader.readAsDataURL(file);
            } else {
                doSave({ id: 'inspo_' + Date.now(), type: 'url', url, thumbnail: null, note, createdAt: new Date().toISOString() });
            }
        },

        _acharItem(itemId, boardId) {
            const board = this._load().find(b => b.id === boardId);
            return board?.items.find(i => i.id === itemId) || null;
        },

        // Importa o anúncio salvo para o Estúdio como PADRÃO de criativo — a
        // IA lê a imagem e extrai o esqueleto do prompt, que depois pode ser
        // reaplicado a qualquer produto (o "criativo base" que o usuário pediu).
        async _usarNoEstudio(itemId, boardId) {
            const item = this._acharItem(itemId, boardId);
            if (!item) return;
            const src = item.thumbnail || item.url;
            if (!src) { if (typeof showToast === 'function') showToast('Esta inspiração não tem imagem.', 'error'); return; }
            if (typeof StudioModule === 'undefined' || !StudioModule.criarPadraoDeImagem) {
                if (typeof showToast === 'function') showToast('Estúdio não carregou. Recarregue a página.', 'error'); return;
            }
            if (typeof showToast === 'function') showToast('Enviando ao Estúdio — a IA está lendo o anúncio…', 'info');
            try {
                // bytesDaImagem (app.js) baixa data: e URL com CORS. Anúncio de
                // página (sem imagem baixável) cai no catch com aviso claro.
                const blob = await bytesDaImagem(src);
                const nome = (item.note || 'Inspiração').slice(0, 50);
                const file = new File([blob], nome.replace(/[^\w]+/g, '-').toLowerCase() + '.jpg', { type: blob.type || 'image/jpeg' });
                const p = await StudioModule.criarPadraoDeImagem(file, nome);
                // Vai pro Estúdio (o tabChanged re-renderiza os padrões).
                document.querySelector('.sidebar-link[data-tab="studio"]')?.click();
                if (typeof showToast === 'function') showToast(`Importado como padrão "${p.nome}" no Estúdio.`, 'success');
            } catch (e) {
                if (typeof showToast === 'function') showToast('Falha ao importar: ' + String(e.message || e).slice(0, 140), 'error');
            }
        },

        _deleteItem(itemId, boardId) {
            const boards = this._load();
            const board = boards.find(b => b.id === boardId);
            if (!board) return;
            board.items = board.items.filter(i => i.id !== itemId);
            this._save(boards);
            this._renderGrid();
            this._renderTabs();
        },

        // Público: lista os boards (para pickers em outras telas, ex.: Ad Library).
        listarBoards() {
            return this._load().map(b => ({ id: b.id, name: b.name, color: b.color, count: (b.items || []).length }));
        },

        // Público: adiciona um item a um board. Sem boardId (ou inexistente),
        // usa o 1º board, ou cria um "Inspirações" se não houver nenhum.
        adicionarItem(boardId, item) {
            const boards = this._load();
            let board = boards.find(b => b.id === boardId);
            if (!board) {
                if (boards.length) board = boards[0];
                else { board = { id: 'board_' + Date.now(), name: 'Inspirações', color: '#8b5cf6', items: [], createdAt: new Date().toISOString() }; boards.push(board); }
            }
            board.items.unshift({ id: 'inspo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5), createdAt: new Date().toISOString(), ...item });
            this._save(boards);
            // Se a aba estiver aberta, reflete na hora.
            if (document.getElementById('tab-saved-inspirations') && !document.getElementById('tab-saved-inspirations').classList.contains('hidden')) {
                try { this._render(); } catch {}
            }
            return board;
        },

        // Public: save a generated image to first board (or show picker)
        saveGeneratedImage(imageUrl, prompt) {
            const boards = this._load();
            if (!boards.length) {
                if (typeof showToast === 'function') showToast('Crie um board primeiro em Saved Inspirations', 'info');
                return;
            }
            const board = boards[0];
            board.items.unshift({
                id: 'inspo_' + Date.now(), type: 'image',
                url: imageUrl, thumbnail: imageUrl,
                note: (prompt || '').slice(0, 80),
                createdAt: new Date().toISOString(),
            });
            this._save(boards);
            if (typeof showToast === 'function') showToast(`Salvo em "${board.name}"`, 'success');
        },

        _esc(s) {
            return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
    };

    window.SavedInspirations = SavedInspirations;
    SavedInspirations.init();
})();
