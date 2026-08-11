/* ===========================
   NavMap — mapa de navegação compacto (NAV-02)
   Botão flutuante num canto da tela que abre uma visão geral de todos os
   módulos/subseções, com a localização atual destacada e busca pra ir
   direto a qualquer um. Lê a lista de destinos DIRETO do menu lateral
   (nunca duplica a lista à mão) — assim nunca fica desatualizado, e já
   respeita a ordem que o usuário escolheu em NAV-01.
   =========================== */
const NavMap = (() => {

    function init() {
        if (document.readyState !== 'loading') _setup();
        else document.addEventListener('DOMContentLoaded', _setup);
    }

    function _setup() {
        document.getElementById('btn-nav-map')?.addEventListener('click', _abrir);
        document.getElementById('nav-map-close')?.addEventListener('click', _fechar);
        document.querySelector('#nav-map-panel .nav-map-overlay')?.addEventListener('click', _fechar);
        document.getElementById('nav-map-busca')?.addEventListener('input', (e) => _render(e.target.value));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !document.getElementById('nav-map-panel')?.classList.contains('hidden')) _fechar();
        });
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', () => {
                if (!document.getElementById('nav-map-panel')?.classList.contains('hidden')) _render(_buscaAtual());
            });
        }
    }

    function _buscaAtual() {
        return document.getElementById('nav-map-busca')?.value || '';
    }

    // Lê a estrutura direto do menu lateral (mesma fonte de verdade),
    // respeitando a ordem atual (já reordenada, se o usuário mexeu em
    // Configurações → Ordem do menu).
    function _lerDestinos() {
        const destinos = [];
        document.querySelectorAll('.app-sidebar > .sidebar-link[data-tab]').forEach(link => {
            destinos.push({ tab: link.dataset.tab, label: link.querySelector('span')?.textContent.trim() || link.dataset.tab, grupo: '', icone: link.querySelector('[data-lucide]')?.dataset.lucide || 'circle' });
        });
        document.querySelectorAll('.app-sidebar > .sidebar-group').forEach(group => {
            const grupoLabel = group.querySelector('.sidebar-group-header span')?.textContent.trim() || '';
            group.querySelectorAll('.sidebar-link[data-tab]').forEach(link => {
                destinos.push({ tab: link.dataset.tab, label: link.querySelector('span')?.textContent.trim() || link.dataset.tab, grupo: grupoLabel, icone: link.querySelector('[data-lucide]')?.dataset.lucide || 'circle' });
            });
        });
        return destinos;
    }

    function _esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function _render(termo) {
        const lista = document.getElementById('nav-map-lista');
        if (!lista) return;
        const q = (termo || '').trim().toLowerCase();
        const atual = document.querySelector('.tab-btn.active')?.dataset.tab || '';
        const destinos = _lerDestinos().filter(d => !q || d.label.toLowerCase().includes(q) || d.grupo.toLowerCase().includes(q));

        if (!destinos.length) {
            lista.innerHTML = `<p class="nav-map-vazio">Nenhum módulo encontrado pra "${_esc(termo)}".</p>`;
            return;
        }

        // Agrupa mantendo a ordem de leitura (Map preserva ordem de inserção)
        const porGrupo = new Map();
        destinos.forEach(d => {
            const chave = d.grupo || '__solto__';
            if (!porGrupo.has(chave)) porGrupo.set(chave, []);
            porGrupo.get(chave).push(d);
        });

        lista.innerHTML = [...porGrupo.entries()].map(([grupo, itens]) => `
            ${grupo !== '__solto__' ? `<div class="nav-map-grupo-label">${_esc(grupo)}</div>` : ''}
            <div class="nav-map-grid">
                ${itens.map(d => `
                    <button type="button" class="nav-map-item${d.tab === atual ? ' is-atual' : ''}" data-ir="${_esc(d.tab)}">
                        <i data-lucide="${_esc(d.icone)}" style="width:15px;height:15px"></i>
                        <span>${_esc(d.label)}</span>
                        ${d.tab === atual ? '<span class="nav-map-aqui">aqui</span>' : ''}
                    </button>
                `).join('')}
            </div>
        `).join('');

        lista.querySelectorAll('[data-ir]').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.ir;
                document.querySelector(`.tab-btn[data-tab="${tab}"]`)?.click();
                document.querySelector(`.sidebar-link[data-tab="${tab}"]`)?.classList.add('active');
                _fechar();
            });
        });
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    }

    function _abrir() {
        const busca = document.getElementById('nav-map-busca');
        if (busca) busca.value = '';
        _render('');
        document.getElementById('nav-map-panel')?.classList.remove('hidden');
        setTimeout(() => busca?.focus(), 30);
    }

    function _fechar() {
        document.getElementById('nav-map-panel')?.classList.add('hidden');
    }

    return { init };
})();

NavMap.init();
