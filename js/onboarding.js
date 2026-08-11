/* ===========================
   OnboardingModule — Configuração da loja (guiado, por perfil)
   - Header com % + barra de progresso, duas colunas (Essenciais / Recomendadas).
   - Checklist que AUTO-COMPLETA lendo o estado real de cada integração e mostra
     o VALOR configurado (domínio Shopify, email, nº de provedores, etc.).
   - Etapas por perfil: dono (todas) vs funcionário (entrar + orientação).
   - Botão fixo na linha de utilitários (acesso rápido) com badge dos essenciais;
     some quando os essenciais terminam.
   =========================== */

const OnboardingModule = (() => {
    const DISMISS_KEY = 'etracker_onboarding_dismissed';
    const ORIENT_KEY  = 'etracker_onboarding_orientado';
    const EQUIPE_KEY  = 'etracker_onboarding_equipe_ok';

    // ── detecções ──
    function _logado()    { try { return (typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn) || !!localStorage.getItem('etracker_skip_login'); } catch { return false; } }
    function _lojaCustom(){ try { return Array.isArray(AppState.stores) && (AppState.stores.length > 1 || AppState.stores.some(s => s && s.name && s.name !== 'Minha Loja')); } catch { return false; } }
    function _shopifyOk() { try { return !!(typeof ShopifyModule !== 'undefined' && ShopifyModule.isConfigured && ShopifyModule.isConfigured()); } catch { return false; } }
    function _facebookOk(){ try { return !!(typeof FacebookAds !== 'undefined' && FacebookAds.isConnected && FacebookAds.isConnected()); } catch { return false; } }
    function _googleAdsOk(){ try { return !!(typeof GoogleAdsModule !== 'undefined' && GoogleAdsModule._isConfigured && GoogleAdsModule._isConfigured()); } catch { return false; } }
    function _sheetsOk()  { try { return (typeof SheetsAPI !== 'undefined' && !!SheetsAPI.getAccessToken()) || (typeof AppState !== 'undefined' && AppState.sheetsConnected === true); } catch { return false; } }
    function _iaOk()      { try { return typeof AIAdGenerator !== 'undefined' && AIAdGenerator._PROVIDERS.some(p => !!AIAdGenerator._getKey(p.id)); } catch { return false; } }
    function _vinculoOk() { try { const sid = localStorage.getItem('currentStoreId') || ''; return Object.keys(JSON.parse(localStorage.getItem('etracker_shopify_links__' + sid) || '{}')).length > 0; } catch { return false; } }
    function _equipeOk()  { try { if (localStorage.getItem(EQUIPE_KEY)) return true; const t = JSON.parse(localStorage.getItem('etracker_team') || '[]'); return Array.isArray(t) && t.length > 0; } catch { return false; } }
    function _capturasOk(){ try { return typeof RemoteCapturesModule !== 'undefined' && RemoteCapturesModule.listCaptures().length > 0; } catch { return false; } }
    function _nCapturas() { try { return RemoteCapturesModule.listCaptures().length; } catch { return 0; } }

    // ── dados exibidos (o valor configurado de cada etapa) ──
    function _emailAtual()  { try { const e = (document.getElementById('profile-dropdown-email')?.textContent || '').trim(); return e.includes('@') ? e : ''; } catch { return ''; } }
    function _nomeLoja()    { try { const sid = localStorage.getItem('currentStoreId') || ''; const s = (AppState.stores || []).find(x => x.id === sid) || (AppState.stores || [])[0]; return (s && s.name) ? s.name : ''; } catch { return ''; } }
    function _shopDominio() { try { const c = ShopifyModule.getConfig ? ShopifyModule.getConfig() : null; return (c && c.shop) ? c.shop : ''; } catch { return ''; } }
    function _nProvedores() { try { return AIAdGenerator._PROVIDERS.filter(p => !!AIAdGenerator._getKey(p.id)).length; } catch { return 0; } }
    function _nEquipe()     { try { return (JSON.parse(localStorage.getItem('etracker_team') || '[]') || []).length; } catch { return 0; } }
    function _nVinculos()   { try { const sid = localStorage.getItem('currentStoreId') || ''; return Object.keys(JSON.parse(localStorage.getItem('etracker_shopify_links__' + sid) || '{}')).length; } catch { return 0; } }

    // ── ações ──
    function _fechar()   { try { closeModal('modal-onboarding'); } catch {} }
    function _clicar(id) { _fechar(); const el = document.getElementById(id); if (el) { try { el.click(); } catch {} } }
    function _irAba(tab) { _fechar(); const b = document.querySelector('.tab-btn[data-tab="' + tab + '"]') || document.querySelector('.app-sidebar .sidebar-link[data-tab="' + tab + '"]'); if (b) { try { b.click(); } catch {} } }
    function _abrirModal(id) { _fechar(); try { if (typeof openModal === 'function') openModal(id); } catch {} }

    // ── perfil ──
    function _isDono() {
        try {
            if (typeof TeamModule === 'undefined') return true;
            const r = TeamModule.getCurrentRole ? TeamModule.getCurrentRole() : null;
            return (TeamModule.isOwner && TeamModule.isOwner()) || r === 'admin' || r === null;
        } catch { return true; }
    }

    function _passosDono() {
        return [
            // ── Essenciais ──
            { id: 'identidade', grupo: 'ess', icon: 'store', titulo: 'Identidade da loja',
              done: _lojaCustom, linha: () => _lojaCustom() ? _nomeLoja() : 'Sem nome definido',
              acao: () => _clicar('btn-manage-stores'), botao: 'Configurar' },
            { id: 'shopify', grupo: 'ess', icon: 'shopping-bag', titulo: 'Loja Shopify',
              done: _shopifyOk, linha: () => _shopifyOk() ? (_shopDominio() || 'Conectada') : 'Não conectada',
              acao: () => { _fechar(); try { ShopifyModule.openConfigModal(); } catch {} }, botao: 'Conectar' },
            { id: 'facebook', grupo: 'ess', icon: 'megaphone', titulo: 'Facebook Ads',
              done: _facebookOk, linha: () => _facebookOk() ? 'Conta conectada' : 'Não conectado',
              acao: () => _clicar('btn-fb-global-config'), botao: 'Conectar' },
            { id: 'ia', grupo: 'ess', icon: 'sparkles', titulo: 'Inteligência artificial',
              done: _iaOk, linha: () => { const n = _nProvedores(); return n ? (n + ' provedor(es) da loja') : 'Nenhum provedor'; },
              acao: () => _abrirModal('api-keys-modal'), botao: 'Adicionar' },
            { id: 'acesso', grupo: 'ess', icon: 'user-check', titulo: 'Meu acesso e função',
              done: _logado, linha: () => { try { if (typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn) return _emailAtual() || 'Conta conectada'; } catch {} return localStorage.getItem('etracker_skip_login') ? 'Modo local (sem conta)' : 'Falta entrar na conta'; },
              acao: () => _clicar('btn-profile'), botao: 'Concluir' },
            // ── Recomendadas ──
            { id: 'equipe', grupo: 'rec', icon: 'users', titulo: 'Equipe da loja',
              done: _equipeOk, linha: () => _equipeOk() ? (_nEquipe() + ' membro(s)') : 'Somente você nesta loja',
              acao: () => _clicar('btn-team-panel'), pularKey: EQUIPE_KEY },
            { id: 'produtos', grupo: 'rec', icon: 'link-2', titulo: 'Vincular produtos',
              done: _vinculoOk, linha: () => _vinculoOk() ? (_nVinculos() + ' vínculo(s)') : 'Nenhum vínculo ainda',
              acao: () => _irAba('products') },
            { id: 'googleads', grupo: 'rec', icon: 'circle-dollar-sign', titulo: 'Google Ads',
              done: _googleAdsOk, linha: () => _googleAdsOk() ? 'Conectado' : 'Conexão recomendada',
              acao: () => { _fechar(); try { GoogleAdsModule.configure(); } catch {} } },
            { id: 'sheets', grupo: 'rec', icon: 'table-2', titulo: 'Google Sheets',
              done: _sheetsOk, linha: () => _sheetsOk() ? 'Conectado' : 'Backup na nuvem',
              acao: () => _clicar('btn-connect-sheets') },
            { id: 'capturas', grupo: 'rec', icon: 'chrome', titulo: 'Extensão de capturas',
              done: _capturasOk, linha: () => _capturasOk() ? (_nCapturas() + ' captura(s)') : 'Extensão não instalada',
              acao: () => _irAba('captures') },
        ];
    }
    function _passosFuncionario() {
        return [
            { id: 'acesso', grupo: 'ess', icon: 'user-check', titulo: 'Meu acesso',
              done: _logado, linha: () => { try { if (typeof SupabaseSync !== 'undefined' && SupabaseSync.isLoggedIn) return _emailAtual() || 'Conta conectada'; } catch {} return localStorage.getItem('etracker_skip_login') ? 'Modo local (sem conta)' : 'Falta entrar na conta'; },
              acao: () => _clicar('btn-profile'), botao: 'Entrar' },
            { id: 'orientacao', grupo: 'ess', icon: 'compass', titulo: 'Conheça seu painel',
              done: () => !!localStorage.getItem(ORIENT_KEY), linha: () => localStorage.getItem(ORIENT_KEY) ? 'Orientação vista' : 'As conexões ficam com o dono',
              acao: () => { try { localStorage.setItem(ORIENT_KEY, '1'); } catch {} _recalcular(); _renderPanel(); }, botao: 'Entendi' },
        ];
    }
    function _passos() { return _isDono() ? _passosDono() : _passosFuncionario(); }

    function _progresso() {
        const passos = _passos().map((p, i) => ({ ...p, _i: i, feito: (() => { try { return !!p.done(); } catch { return false; } })() }));
        const ess = passos.filter(p => p.grupo === 'ess');
        const rec = passos.filter(p => p.grupo === 'rec');
        return {
            passos, ess, rec,
            essFeitos: ess.filter(p => p.feito).length, essTotal: ess.length,
            recFeitos: rec.filter(p => p.feito).length, recTotal: rec.length,
        };
    }

    // ── badge (essenciais) ──
    function _renderBadge() {
        const btn = document.getElementById('btn-onboarding');
        if (!btn) return;
        if (localStorage.getItem(DISMISS_KEY)) { btn.classList.add('hidden'); return; }
        const badge = document.getElementById('onboarding-badge');
        const { essFeitos, essTotal } = _progresso();
        if (essTotal > 0 && essFeitos >= essTotal) {
            btn.classList.add('hidden');
            try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
            return;
        }
        btn.classList.remove('hidden');
        if (badge) { badge.textContent = essFeitos + '/' + essTotal; badge.style.display = ''; }
    }

    function _linha(p) { try { return (typeof p.linha === 'function') ? (p.linha() || '') : (p.linha || ''); } catch { return ''; } }

    // ── render do painel (header + duas colunas) ──
    function _render() {
        const P = _progresso();
        const pct = P.essTotal ? Math.round((P.essFeitos / P.essTotal) * 100) : 100;
        const ativoId = (P.ess.find(p => !p.feito) || P.rec.find(p => !p.feito) || {}).id;
        const nome = _nomeLoja();
        const titulo = (nome && nome !== 'Minha Loja') ? ('Prepare ' + _esc(nome)) : 'Configure sua operação';

        // Header
        const head = document.getElementById('onboarding-header');
        if (head) {
            head.innerHTML =
                '<button class="btn-close onb3-x" id="onboarding-close" aria-label="Fechar">&times;</button>' +
                '<div class="onb3-head-row">' +
                    '<div class="onb3-head-left">' +
                        '<div class="onb3-appicon"><i data-lucide="rocket" style="width:22px;height:22px"></i></div>' +
                        '<div class="onb3-head-text">' +
                            '<span class="onb3-eyebrow">Configuração da loja</span>' +
                            '<h2 class="onb3-title">' + titulo + '</h2>' +
                            '<p class="onb3-sub">Conclua a operação sem sair da tela atual.</p>' +
                        '</div>' +
                    '</div>' +
                    '<div class="onb3-head-right">' +
                        '<div class="onb3-pct">' + pct + '%</div>' +
                        '<div class="onb3-pct-lab">' + P.essFeitos + ' de ' + P.essTotal + '<br>essenciais</div>' +
                    '</div>' +
                '</div>' +
                '<div class="onb3-progress"><div class="onb3-progress-fill" style="width:' + pct + '%"></div></div>';
        }

        // Coluna Essenciais
        const essBox = document.getElementById('onboarding-essenciais');
        if (essBox) {
            essBox.innerHTML =
                '<div class="onb3-col-head"><div class="onb3-col-ico onb3-col-ico-blue"><i data-lucide="store" style="width:18px;height:18px"></i></div>' +
                '<div><div class="onb3-col-title">Etapas essenciais</div><div class="onb3-col-sub">O indicador desaparece quando todas terminarem.</div></div></div>' +
                '<div class="onb3-list">' + P.ess.map((p, idx) => _stepEss(p, idx, ativoId)).join('') + '</div>';
        }

        // Coluna Recomendadas
        const recBox = document.getElementById('onboarding-recomendadas');
        if (recBox) {
            if (!P.rec.length) { recBox.innerHTML = ''; recBox.style.display = 'none'; }
            else {
                recBox.style.display = '';
                recBox.innerHTML =
                    '<div class="onb3-col-head"><div class="onb3-col-ico onb3-col-ico-violet"><i data-lucide="sparkles" style="width:18px;height:18px"></i></div>' +
                    '<div><div class="onb3-col-title">Recomendadas</div><div class="onb3-col-sub">Amplie a automação depois.</div></div></div>' +
                    '<div class="onb3-list">' + P.rec.map(p => _stepRec(p)).join('') + '</div>' +
                    '<button type="button" class="onb3-manage" data-onb-acao="' + (P.rec.find(x=>x.id==='equipe')?._i ?? P.rec[0]._i) + '"><i data-lucide="store" style="width:14px;height:14px"></i> Gerenciar perfis</button>';
            }
        }

        _wire();
        if (typeof lucide !== 'undefined') try { lucide.createIcons(); } catch {}
    }

    function _stepEss(p, idx, ativoId) {
        const active = !p.feito && p.id === ativoId;
        const cls = 'onb3-step' + (p.feito ? ' is-done' : (active ? ' is-active' : ''));
        const status = p.feito
            ? '<span class="onb3-pill onb3-pill-ok">Concluída</span>'
            : (active ? '<span class="onb3-pill onb3-pill-pend">Pendente</span>' : '');
        const token = p.feito
            ? '<span class="onb3-tok onb3-tok-ok"><i data-lucide="check" style="width:15px;height:15px"></i></span>'
            : '<span class="onb3-tok' + (active ? ' onb3-tok-active' : '') + '">' + (idx + 1) + '</span>';
        let act;
        if (p.feito) act = '<button type="button" class="onb3-btn onb3-btn-ghost" data-onb-acao="' + p._i + '">Revisar <i data-lucide="arrow-right" style="width:13px;height:13px"></i></button>';
        else if (active) act = '<button type="button" class="onb3-btn onb3-btn-primary" data-onb-acao="' + p._i + '"><i data-lucide="user" style="width:14px;height:14px"></i> ' + (p.botao || 'Concluir') + '</button>';
        else act = '<button type="button" class="onb3-btn onb3-btn-ghost" data-onb-acao="' + p._i + '">' + (p.botao || 'Conectar') + '</button>';
        return '<div class="' + cls + '">' + token +
            '<div class="onb3-step-main"><div class="onb3-step-titlerow"><span class="onb3-step-title">' + _esc(p.titulo) + '</span>' + status + '</div>' +
            '<div class="onb3-step-linha">' + _esc(_linha(p)) + '</div></div>' +
            '<div class="onb3-step-act">' + act + '</div></div>';
    }

    function _stepRec(p) {
        const token = p.feito
            ? '<span class="onb3-rtok onb3-rtok-ok"><i data-lucide="check" style="width:12px;height:12px"></i></span>'
            : '<span class="onb3-rtok"></span>';
        return '<button type="button" class="onb3-rec" data-onb-acao="' + p._i + '">' + token +
            '<span class="onb3-rec-main"><span class="onb3-rec-title">' + _esc(p.titulo) + '</span>' +
            '<span class="onb3-rec-linha">' + _esc(_linha(p)) + '</span></span>' +
            '<i data-lucide="arrow-right" class="onb3-rec-arrow" style="width:16px;height:16px"></i></button>';
    }

    function _wire() {
        const modal = document.getElementById('modal-onboarding');
        if (!modal) return;
        modal.querySelectorAll('[data-onb-acao]').forEach(btn => {
            btn.addEventListener('click', (e) => { e.stopPropagation(); const p = _progresso().passos[parseInt(btn.dataset.onbAcao, 10)]; if (p && typeof p.acao === 'function') p.acao(); });
        });
        document.getElementById('onboarding-close')?.addEventListener('click', () => { try { closeModal('modal-onboarding'); } catch {} });
    }

    function _renderPanel() { _render(); }   // alias mantido
    function _recalcular() { _renderBadge(); }

    function _esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    function open() { _render(); try { if (typeof openModal === 'function') openModal('modal-onboarding'); else document.getElementById('modal-onboarding')?.classList.remove('hidden'); } catch {} }

    function init() {
        document.getElementById('btn-onboarding')?.addEventListener('click', () => open());
        document.getElementById('onboarding-dismiss')?.addEventListener('click', () => {
            try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
            try { closeModal('modal-onboarding'); } catch {}
            _renderBadge();
        });
        if (typeof EventBus !== 'undefined') {
            ['dataLoaded', 'storeChanged', 'tabChanged', 'productsChanged'].forEach(ev => EventBus.on(ev, () => _recalcular()));
        }
        _recalcular();
    }

    if (document.readyState !== 'loading') init();
    else document.addEventListener('DOMContentLoaded', init);

    return { open, _recalcular, _renderPanel, _render, _progresso };
})();
window.OnboardingModule = OnboardingModule;
