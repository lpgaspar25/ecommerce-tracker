/* ===========================
   OnboardingModule — Primeiros passos guiados
   - Checklist de conexões que AUTO-COMPLETA (lê o estado real de cada
     integração, não guarda "done" à mão).
   - Etapas diferentes por perfil: dono (todas as conexões) vs funcionário
     (só entrar + orientação — funcionário não configura conexões).
   - Botão fixo na linha de utilitários (acesso rápido) com badge de progresso
     (ex.: "3/8"); some quando tudo termina.
   =========================== */

const OnboardingModule = (() => {
    const DISMISS_KEY = 'etracker_onboarding_dismissed';   // concluído/dispensado → esconde o botão
    const ORIENT_KEY  = 'etracker_onboarding_orientado';   // funcionário viu a orientação
    const EQUIPE_KEY  = 'etracker_onboarding_equipe_ok';   // dono marcou "convidar equipe" como resolvido

    // ── detecções (as expressões que dizem se cada passo está feito) ──
    function _logado() {
        try { return (typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn) || !!localStorage.getItem('etracker_skip_login'); }
        catch { return false; }
    }
    function _lojaCustom() {
        // stores.length é sempre >=1 (ensureStoreSetup cria "Minha Loja"), então
        // só conta como feito se o usuário criou/renomeou de verdade.
        try { return Array.isArray(AppState.stores) && (AppState.stores.length > 1 || AppState.stores.some(s => s && s.name && s.name !== 'Minha Loja')); }
        catch { return false; }
    }
    function _shopifyOk()  { try { return !!(typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured && ShopifyModule.isConfigured()); } catch { return false; } }
    function _facebookOk() { try { return !!(typeof FacebookAds !== 'undefined' && FacebookAds.isConnected && FacebookAds.isConnected()); } catch { return false; } }
    function _googleAdsOk(){ try { return !!(typeof GoogleAdsModule !== 'undefined' && GoogleAdsModule._isConfigured && GoogleAdsModule._isConfigured()); } catch { return false; } }
    function _sheetsOk()   { try { return (typeof SheetsAPI !== 'undefined' && !!SheetsAPI.getAccessToken()) || (typeof AppState !== 'undefined' && AppState.sheetsConnected === true); } catch { return false; } }
    function _iaOk()       { try { return typeof AIAdGenerator !== 'undefined' && AIAdGenerator._PROVIDERS.some(p => !!AIAdGenerator._getKey(p.id)); } catch { return false; } }
    function _vinculoOk()  {
        try {
            const sid = localStorage.getItem('currentStoreId') || '';
            const map = JSON.parse(localStorage.getItem('etracker_shopify_links__' + sid) || '{}');
            return Object.keys(map).length > 0;
        } catch { return false; }
    }
    function _equipeOk()   {
        try {
            if (localStorage.getItem(EQUIPE_KEY)) return true;
            const t = JSON.parse(localStorage.getItem('etracker_team') || '[]');
            return Array.isArray(t) && t.length > 0;
        } catch { return false; }
    }

    // ── ações (abrem a tela de cada conexão) ──
    function _fechar() { try { closeModal('modal-onboarding'); } catch {} }
    function _clicar(id) { _fechar(); const el = document.getElementById(id); if (el) { try { el.click(); } catch {} } }
    function _irAba(tab) {
        _fechar();
        const b = document.querySelector('.tab-btn[data-tab="' + tab + '"]') || document.querySelector('.app-sidebar .sidebar-link[data-tab="' + tab + '"]');
        if (b) { try { b.click(); } catch {} }
    }
    function _abrirModal(id) { _fechar(); try { if (typeof openModal === 'function') openModal(id); } catch {} }

    // ── perfil (dono vs funcionário). Solo/offline cai como dono (correto). ──
    function _isDono() {
        try {
            if (typeof TeamModule === 'undefined') return true;
            const r = TeamModule.getCurrentRole ? TeamModule.getCurrentRole() : null;
            return (TeamModule.isOwner && TeamModule.isOwner()) || r === 'admin' || r === null;
        } catch { return true; }
    }

    function _passosDono() {
        return [
            { id: 'conta',     icon: 'user-check',        titulo: 'Entrar na sua conta',        desc: 'Crie um login (ou entre) pra salvar tudo na nuvem e acessar de qualquer lugar.',                 done: _logado,     acao: () => _clicar('btn-profile'),           botao: 'Entrar' },
            { id: 'loja',      icon: 'store',             titulo: 'Criar sua loja',             desc: 'Dê um nome à sua loja — dá pra ter várias e ver tudo separado por loja.',                        done: _lojaCustom, acao: () => _clicar('btn-manage-stores'),      botao: 'Criar' },
            { id: 'shopify',   icon: 'shopping-bag',      titulo: 'Conectar a Shopify',         desc: 'Traz vendas reais, pedidos e visitas da loja — a base do lucro e do CPA real.',                 done: _shopifyOk,  acao: () => { _fechar(); try { ShopifyModule.openConfigModal(); } catch {} }, botao: 'Conectar' },
            { id: 'facebook',  icon: 'megaphone',         titulo: 'Conectar o Facebook Ads',    desc: 'Gastos, campanhas e ROAS dos seus anúncios do Meta.',                                           done: _facebookOk, acao: () => _clicar('btn-fb-global-config'),   botao: 'Conectar' },
            { id: 'ia',        icon: 'sparkles',          titulo: 'Adicionar uma chave de IA',  desc: 'Gere copy, descrições e imagens com IA (OpenAI, Gemini, Claude ou Grok).',                      done: _iaOk,       acao: () => _abrirModal('api-keys-modal'),    botao: 'Adicionar' },
            { id: 'produtos',  icon: 'link-2',            titulo: 'Vincular produtos à Shopify', desc: 'Cruza seus lançamentos com as vendas reais da loja, produto a produto.',                       done: _vinculoOk,  acao: () => _irAba('products'),               botao: 'Vincular', opcional: true },
            { id: 'googleads', icon: 'circle-dollar-sign', titulo: 'Conectar o Google Ads',     desc: 'Traz gastos e campanhas do Google Ads (opcional).',                                             done: _googleAdsOk, acao: () => { _fechar(); try { GoogleAdsModule.configure(); } catch {} }, botao: 'Conectar', opcional: true },
            { id: 'sheets',    icon: 'table-2',           titulo: 'Conectar o Google Sheets',   desc: 'Backup e sincronização dos seus dados na nuvem (opcional).',                                    done: _sheetsOk,   acao: () => _clicar('btn-connect-sheets'),    botao: 'Conectar', opcional: true },
            { id: 'equipe',    icon: 'users',             titulo: 'Convidar sua equipe',        desc: 'Adicione funcionários com acesso controlado às abas (opcional).',                               done: _equipeOk,   acao: () => _clicar('btn-team-panel'),        botao: 'Convidar', opcional: true, pularKey: EQUIPE_KEY },
        ];
    }
    function _passosFuncionario() {
        return [
            { id: 'conta',      icon: 'user-check', titulo: 'Entrar na sua conta',  desc: 'Entre com o login que o dono criou pra você — assim acessa de qualquer lugar.',                             done: _logado,                                    acao: () => _clicar('btn-profile'), botao: 'Entrar' },
            { id: 'orientacao', icon: 'compass',    titulo: 'Conheça seu painel',    desc: 'Você vê as abas que o dono liberou pra você, no menu à esquerda. As conexões (Shopify, anúncios, chaves) ficam com o dono.', done: () => !!localStorage.getItem(ORIENT_KEY), acao: () => { try { localStorage.setItem(ORIENT_KEY, '1'); } catch {} _recalcular(); _renderPanel(); }, botao: 'Entendi' },
        ];
    }
    function _passos() { return _isDono() ? _passosDono() : _passosFuncionario(); }

    function _progresso() {
        const passos = _passos().map(p => ({ ...p, feito: (() => { try { return !!p.done(); } catch { return false; } })() }));
        const feitos = passos.filter(p => p.feito).length;
        return { feitos, total: passos.length, passos };
    }

    // ── badge no botão de acesso rápido ──
    function _renderBadge() {
        const btn = document.getElementById('btn-onboarding');
        if (!btn) return;
        if (localStorage.getItem(DISMISS_KEY)) { btn.classList.add('hidden'); return; }
        const badge = document.getElementById('onboarding-badge');
        const { feitos, total } = _progresso();
        if (feitos >= total) {
            // tudo pronto → some (e não volta a incomodar)
            btn.classList.add('hidden');
            try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
            return;
        }
        btn.classList.remove('hidden');
        if (badge) { badge.textContent = feitos + '/' + total; badge.style.display = ''; }
    }

    // ── painel (modal) ──
    function _renderPanel() {
        const box = document.getElementById('onboarding-steps');
        if (!box) return;
        const { feitos, total, passos } = _progresso();
        const pct = total ? Math.round((feitos / total) * 100) : 0;
        const cab = document.getElementById('onboarding-progress');
        if (cab) {
            cab.innerHTML =
                '<div class="onb-progress-top"><span>' + feitos + ' de ' + total + ' concluídos</span><span>' + pct + '%</span></div>' +
                '<div class="onb-progress-bar"><div class="onb-progress-fill" style="width:' + pct + '%"></div></div>';
        }
        box.innerHTML = passos.map((p, i) => {
            const acao = p.feito
                ? '<span class="onb-step-ok"><i data-lucide="check" style="width:15px;height:15px"></i></span>'
                : '<button type="button" class="btn btn-primary btn-sm onb-step-btn" data-onb-acao="' + i + '">' + p.botao + '</button>' +
                  (p.pularKey ? '<button type="button" class="onb-step-skip" data-onb-pular="' + i + '" title="Marcar como resolvido">pular</button>' : '');
            return '<div class="onb-step' + (p.feito ? ' onb-step-done' : '') + (p.opcional ? ' onb-step-opt' : '') + '">' +
                '<div class="onb-step-ico"><i data-lucide="' + p.icon + '" style="width:18px;height:18px"></i></div>' +
                '<div class="onb-step-txt"><div class="onb-step-titulo">' + p.titulo + (p.opcional ? ' <span class="onb-step-tag">opcional</span>' : '') + '</div>' +
                '<div class="onb-step-desc">' + p.desc + '</div></div>' +
                '<div class="onb-step-acao">' + acao + '</div></div>';
        }).join('');

        box.querySelectorAll('[data-onb-acao]').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = passos[parseInt(btn.dataset.onbAcao, 10)];
                if (p && typeof p.acao === 'function') p.acao();
            });
        });
        box.querySelectorAll('[data-onb-pular]').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = passos[parseInt(btn.dataset.onbPular, 10)];
                if (p && p.pularKey) { try { localStorage.setItem(p.pularKey, '1'); } catch {} _recalcular(); _renderPanel(); }
            });
        });
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    }

    function _recalcular() { _renderBadge(); }

    function open() {
        _renderPanel();
        _abrir('modal-onboarding');
    }
    function _abrir(id) { try { if (typeof openModal === 'function') openModal(id); else document.getElementById(id)?.classList.remove('hidden'); } catch {} }

    function init() {
        const btn = document.getElementById('btn-onboarding');
        if (btn) btn.addEventListener('click', () => open());
        document.getElementById('onboarding-dismiss')?.addEventListener('click', () => {
            try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
            try { closeModal('modal-onboarding'); } catch {}
            _renderBadge();
        });
        // recalcula quando o estado do app muda (auto-completa em tempo real)
        if (typeof EventBus !== 'undefined') {
            ['dataLoaded', 'storeChanged', 'tabChanged', 'productsChanged'].forEach(ev => EventBus.on(ev, () => _recalcular()));
        }
        _recalcular();
    }

    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);

    return { open, _recalcular, _renderPanel, _progresso };
})();
window.OnboardingModule = OnboardingModule;
