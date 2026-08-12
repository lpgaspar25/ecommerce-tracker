/* Higgsfield — OAuth + MCP connection for Tracker Commerce OS.
   Only an opaque Tracker session id is kept in the browser. Higgsfield tokens
   stay in the Cloudflare KV-backed OAuth bridge. */
const HiggsfieldConnection = (() => {
    const SESSION_KEY = 'etracker_higgsfield_session';
    const CLOUD_ORIGIN = 'https://app-calculadora-lucas.pages.dev';
    const state = { connected: false, loading: false, identity: null, tools: [], error: '', justConnected: false };

    function backendOrigin() {
        return (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
            ? CLOUD_ORIGIN
            : location.origin;
    }

    function sessionId() { return localStorage.getItem(SESSION_KEY) || ''; }

    function _consumeCallback() {
        const url = new URL(location.href);
        const session = url.searchParams.get('higgsfield_session');
        const connected = url.searchParams.get('higgsfield_connected');
        const error = url.searchParams.get('higgsfield_error');
        if (session) {
            localStorage.setItem(SESSION_KEY, session);
            state.justConnected = true;
        }
        if (session || connected || error) {
            ['higgsfield_session', 'higgsfield_connected', 'higgsfield_error'].forEach(key => url.searchParams.delete(key));
            history.replaceState({}, '', url.pathname + url.search + url.hash);
        }
        if (connected && typeof showToast === 'function') showToast('Higgsfield conectada com sucesso', 'success');
        if (error && typeof showToast === 'function') showToast(_oauthErrorMessage(error), 'error');
    }

    function connect() {
        const retorno = new URL(location.href);
        ['higgsfield_session', 'higgsfield_connected', 'higgsfield_error'].forEach(key => retorno.searchParams.delete(key));
        location.href = `${backendOrigin()}/higgsfield/start?return=${encodeURIComponent(retorno.toString())}`;
    }

    async function disconnect() {
        const current = sessionId();
        try {
            if (current) await fetch(`${backendOrigin()}/higgsfield/disconnect`, {
                method: 'POST', headers: { 'X-Higgsfield-Session': current },
            });
        } catch (error) { console.warn('[Higgsfield] disconnect', error); }
        localStorage.removeItem(SESSION_KEY);
        state.connected = false; state.identity = null; state.tools = []; state.error = '';
        render();
        if (typeof showToast === 'function') showToast('Higgsfield desconectada', 'success');
    }

    async function refresh() {
        const current = sessionId();
        state.loading = true; state.error = '';
        render();
        if (!current) {
            state.connected = false; state.loading = false; state.identity = null; state.tools = [];
            render(); return state;
        }
        try {
            const response = await _fetchStatusWithPropagationRetry(current);
            if (!response.ok) throw new Error('Sessão expirada');
            const data = await response.json();
            state.connected = !!data.connected;
            state.justConnected = false;
            state.identity = data.identity || null;
            state.loading = false;
            render();
            if (state.connected) await refreshTools();
        } catch (error) {
            localStorage.removeItem(SESSION_KEY);
            state.connected = false; state.loading = false; state.identity = null; state.tools = [];
            state.error = String(error.message || error);
            render();
        }
        return state;
    }

    async function _fetchStatusWithPropagationRetry(current) {
        const tentativas = state.justConnected ? [0, 350, 800, 1600] : [0];
        let response;
        for (const espera of tentativas) {
            if (espera) await new Promise(resolve => setTimeout(resolve, espera));
            response = await fetch(`${backendOrigin()}/higgsfield/status`, {
                headers: { 'X-Higgsfield-Session': current },
            });
            if (response.ok || response.status !== 401) return response;
        }
        return response;
    }

    function _oauthErrorMessage(code) {
        const mensagens = {
            provider_access_denied: 'A autorização da Higgsfield foi cancelada.',
            expired_oauth_state: 'A autorização expirou antes de concluir. Tente conectar novamente.',
            missing_oauth_code: 'A Higgsfield não devolveu a autorização. Tente novamente.',
            token_invalid_grant: 'A Higgsfield recusou o código de autorização. Inicie uma nova conexão.',
            token_exchange_failed: 'A Higgsfield recusou a autorização. Tente novamente.',
        };
        return mensagens[code] || 'Não foi possível conectar a Higgsfield. Tente novamente.';
    }

    async function refreshTools() {
        const current = sessionId();
        if (!current || !state.connected) return [];
        try {
            const response = await fetch(`${backendOrigin()}/higgsfield/tools`, {
                headers: { 'X-Higgsfield-Session': current },
            });
            const data = await response.json();
            state.tools = Array.isArray(data.tools) ? data.tools : [];
            if (data.error) state.error = 'Conta conectada; catálogo será carregado na primeira geração.';
        } catch {
            state.tools = [];
        }
        render();
        return state.tools;
    }

    function cardHtml() {
        const pessoa = state.identity?.name || state.identity?.email || 'Conta Higgsfield';
        const detalhe = state.loading
            ? 'Verificando conexão…'
            : state.connected
                ? `${pessoa}${state.tools.length ? ` · ${state.tools.length} ferramentas disponíveis` : ' · MCP autorizado'}`
                : 'Use sua conta e seus créditos da Higgsfield. Nenhuma API key é necessária.';
        return `
            <div class="higgsfield-connect-card ${state.connected ? 'is-connected' : ''}">
                <div class="higgsfield-connect-mark" aria-hidden="true">
                    <svg viewBox="0 0 36 36" fill="none"><path d="M7 11c3-5 7-6 11-2 4 4 7 3 11-2M7 25c3 5 7 6 11 2 4-4 7-3 11 2M10 18h16" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>
                </div>
                <div class="higgsfield-connect-copy">
                    <div class="higgsfield-connect-title">
                        <strong>Higgsfield</strong>
                        <span>${state.connected ? '<i data-lucide="check" aria-hidden="true"></i> Conectada' : 'MCP · imagens e vídeos'}</span>
                    </div>
                    <p>${_esc(detalhe)}</p>
                    ${state.error && state.connected ? `<small>${_esc(state.error)}</small>` : ''}
                </div>
                <div class="higgsfield-connect-actions">
                    ${state.connected
                        ? `<button type="button" class="btn btn-secondary btn-sm" data-higgsfield-action="refresh" ${state.loading ? 'disabled' : ''}>Atualizar</button>
                           <button type="button" class="btn btn-secondary btn-sm" data-higgsfield-action="disconnect">Desconectar</button>`
                        : `<button type="button" class="btn btn-primary btn-sm" data-higgsfield-action="connect" ${state.loading ? 'disabled' : ''}><i data-lucide="link" aria-hidden="true"></i> Conectar Higgsfield</button>`}
                </div>
            </div>`;
    }

    function render() {
        document.querySelectorAll('[data-higgsfield-card]').forEach(host => {
            host.innerHTML = cardHtml();
            host.querySelector('[data-higgsfield-action="connect"]')?.addEventListener('click', connect);
            host.querySelector('[data-higgsfield-action="disconnect"]')?.addEventListener('click', disconnect);
            host.querySelector('[data-higgsfield-action="refresh"]')?.addEventListener('click', refresh);
        });
        if (typeof lucide !== 'undefined' && lucide.createIcons) try { lucide.createIcons(); } catch {}
    }

    function _esc(value) {
        return String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    }

    function init() {
        _consumeCallback();
        render();
        refresh();
        if (typeof EventBus !== 'undefined') EventBus.on('tabChanged', tab => { if (tab === 'studio') render(); });
    }

    return { init, connect, disconnect, refresh, refreshTools, render, state, sessionId, backendOrigin };
})();

window.HiggsfieldConnection = HiggsfieldConnection;
document.addEventListener('DOMContentLoaded', () => HiggsfieldConnection.init());
