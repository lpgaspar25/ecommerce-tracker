/* ===========================
   ProductPicker — seletor de produto padronizado (STUDIO-03)
   Busca + miniatura + SKU + recentes + estado vazio, com 2 fontes:
   'local' (AppState.allProducts, já cadastrados no app) ou 'shopify'
   (catálogo ao vivo da loja conectada — usado no molde do Lançamento).
   Um componente, várias instâncias — cada uma recebe seu próprio
   container e uma chave (`instancia`) pra guardar "recentes" à parte.
   =========================== */
const ProductPicker = (() => {

    async function _itensDe(source) {
        if (source === 'shopify') {
            if (typeof ShopifyModule === 'undefined' || !ShopifyModule.isConfigured()) return null; // null = fonte indisponível
            const produtos = await ShopifyModule.fetchShopifyProducts();
            return (produtos || []).map(p => ({
                id: String(p.id), name: p.title || '(sem nome)',
                thumb: p.image?.src || p.images?.[0]?.src || '', sku: p.variants?.[0]?.sku || '',
            }));
        }
        const produtos = (AppState.allProducts || []).filter(p => p.status !== 'inativo');
        return produtos.map(p => ({
            id: String(p.id), name: p.name || '(sem nome)',
            thumb: (p.images || [])[0]?.dataUrl || (p.images || [])[0]?.url || '', sku: p.sku || '',
        }));
    }

    function _recentesKey(instancia) { return 'ppick_recentes_' + instancia; }
    function _lerRecentes(instancia) {
        try { return JSON.parse(localStorage.getItem(_recentesKey(instancia)) || '[]'); } catch { return []; }
    }
    function _gravarRecente(instancia, item) {
        const lista = _lerRecentes(instancia).filter(r => r.id !== item.id);
        lista.unshift({ id: item.id });
        try { localStorage.setItem(_recentesKey(instancia), JSON.stringify(lista.slice(0, 5))); } catch {}
    }

    function _esc(s) {
        return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // opts: { source: 'local'|'shopify', onSelect(item), selectedId, instancia, placeholder }
    async function render(container, opts) {
        if (!container) return;
        const instancia = opts.instancia || 'padrao';
        container.classList.add('ppick');
        container.innerHTML = `
            <div class="ppick-selecionado" hidden>
                <img class="ppick-thumb" alt="">
                <span class="ppick-item-sem-foto ppick-thumb-vazia" hidden></span>
                <span class="ppick-nome"></span>
                <button type="button" class="ppick-trocar">Trocar</button>
            </div>
            <div class="ppick-busca-box">
                <input type="text" class="input ppick-busca" placeholder="${_esc(opts.placeholder || 'Buscar produto por nome ou SKU…')}">
                <div class="ppick-lista" hidden></div>
            </div>
        `;

        const elSelecionado = container.querySelector('.ppick-selecionado');
        const elThumb = container.querySelector('.ppick-thumb');
        const elThumbVazia = container.querySelector('.ppick-thumb-vazia');
        const elNome = container.querySelector('.ppick-nome');
        const elBuscaBox = container.querySelector('.ppick-busca-box');
        const elBusca = container.querySelector('.ppick-busca');
        const elLista = container.querySelector('.ppick-lista');

        elLista.innerHTML = '<div class="ppick-vazio">' + window.loadingHTML('Carregando produtos…') + '</div>';
        elLista.hidden = false;

        const itens = await _itensDe(opts.source);
        // Se o container foi removido/re-renderizado enquanto a fonte
        // shopify carregava (fetch assíncrono), não mexe em nada morto.
        if (!container.isConnected) return;

        const mostrarSelecionado = (item) => {
            if (item.thumb) { elThumb.src = item.thumb; elThumb.hidden = false; elThumbVazia.hidden = true; }
            else { elThumb.hidden = true; elThumbVazia.hidden = false; }
            elNome.textContent = item.name;
            elSelecionado.hidden = false;
            elBuscaBox.hidden = true;
        };

        const mostrarBusca = () => {
            elSelecionado.hidden = true;
            elBuscaBox.hidden = false;
            elBusca.value = '';
            renderLista('');
            elBusca.focus();
        };

        const selecionar = (item) => {
            _gravarRecente(instancia, item);
            mostrarSelecionado(item);
            opts.onSelect?.(item);
        };

        const renderLista = (termo) => {
            if (itens === null) {
                elLista.innerHTML = `<div class="ppick-vazio">${opts.source === 'shopify' ? 'Conecte a Shopify (loja → Configurações → Integrações) pra escolher um produto de lá.' : 'Nenhum produto encontrado.'}</div>`;
                elLista.hidden = false;
                return;
            }
            if (!itens.length) {
                elLista.innerHTML = '<div class="ppick-vazio">Nenhum produto cadastrado ainda.</div>';
                elLista.hidden = false;
                return;
            }
            const q = termo.trim().toLowerCase();
            let mostrar = [];
            let tituloRecentes = false;
            if (!q) {
                const recentes = _lerRecentes(instancia).map(r => itens.find(i => i.id === r.id)).filter(Boolean);
                if (recentes.length) { mostrar = recentes; tituloRecentes = true; }
                else mostrar = itens.slice(0, 30);
            } else {
                mostrar = itens.filter(i => i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q)).slice(0, 30);
            }
            if (!mostrar.length) {
                elLista.innerHTML = `<div class="ppick-vazio">Nenhum resultado pra "${_esc(termo)}".</div>`;
            } else {
                elLista.innerHTML = (tituloRecentes ? '<div class="ppick-secao-label">Recentes</div>' : '') + mostrar.map(item => `
                    <button type="button" class="ppick-item" data-id="${_esc(item.id)}">
                        ${item.thumb ? `<img src="${_esc(item.thumb)}" alt="">` : '<span class="ppick-item-sem-foto"></span>'}
                        <span class="ppick-item-info"><strong>${_esc(item.name)}</strong>${item.sku ? `<small>${_esc(item.sku)}</small>` : ''}</span>
                    </button>`).join('');
                elLista.querySelectorAll('.ppick-item').forEach(btn => {
                    btn.addEventListener('click', () => {
                        const item = itens.find(i => i.id === btn.dataset.id);
                        if (item) selecionar(item);
                    });
                });
            }
            elLista.hidden = false;
        };

        elBusca.addEventListener('input', () => renderLista(elBusca.value));
        elBusca.addEventListener('focus', () => renderLista(elBusca.value));
        container.querySelector('.ppick-trocar').addEventListener('click', mostrarBusca);

        // Fecha a lista ao clicar fora — precisa desligar o listener antigo
        // a cada render() (senão empilha um por chamada, já que o mesmo
        // container costuma ser re-renderizado várias vezes na sessão).
        if (container._ppickFechar) document.removeEventListener('click', container._ppickFechar);
        const fechar = (e) => { if (!container.contains(e.target)) elLista.hidden = true; };
        container._ppickFechar = fechar;
        document.addEventListener('click', fechar);

        const inicial = opts.selectedId != null ? itens?.find(i => i.id === String(opts.selectedId)) : null;
        if (inicial) mostrarSelecionado(inicial);
        else mostrarBusca();
    }

    return { render };
})();
window.ProductPicker = ProductPicker;
