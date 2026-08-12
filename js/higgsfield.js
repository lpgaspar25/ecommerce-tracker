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

    async function callTool(tool, args = {}) {
        const current = sessionId();
        if (!current || !state.connected) throw new Error('Conecte sua conta Higgsfield primeiro');
        const response = await fetch(`${backendOrigin()}/higgsfield/call`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Higgsfield-Session': current },
            body: JSON.stringify({ tool, args }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error) throw new Error(data.error || `Higgsfield respondeu ${response.status}`);
        return data.result;
    }

    async function uploadImage(blob, filename = 'tracker-reference.webp') {
        const current = sessionId();
        if (!current || !state.connected) throw new Error('Conecte sua conta Higgsfield primeiro');
        const fd = new FormData();
        fd.append('file', blob, filename);
        const response = await fetch(`${backendOrigin()}/higgsfield/media`, {
            method: 'POST', headers: { 'X-Higgsfield-Session': current }, body: fd,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.error || !data.mediaId) throw new Error(data.error || 'Falha ao enviar a imagem');
        return data.mediaId;
    }

    function _resultText(result) {
        return (result?.content || []).filter(x => x?.type === 'text').map(x => x.text || '').join('\n');
    }

    function _assertGeneration(result) {
        const message = _resultText(result);
        if (result?.isError || /not supported|not available|rejected|failed|error/i.test(message)) {
            if (/unlimited|unlim/i.test(message)) {
                throw new Error('O Unlimited 2.5 está ativo no site, mas a Higgsfield ainda não o disponibilizou nesta conexão MCP. Nenhum crédito foi usado.');
            }
            throw new Error(message || 'A Higgsfield recusou a geração');
        }
        return result;
    }

    function _findJob(value) {
        if (!value || typeof value !== 'object') return '';
        for (const [key, item] of Object.entries(value)) {
            if (/^(job_id|jobId|id)$/i.test(key) && typeof item === 'string'
                && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(item)) return item;
        }
        for (const item of Object.values(value)) {
            const found = Array.isArray(item) ? item.map(_findJob).find(Boolean) : _findJob(item);
            if (found) return found;
        }
        return '';
    }

    function _findUrl(value) {
        if (!value) return '';
        if (typeof value === 'string') return value.match(/https?:\/\/[^\s'"<>]+/i)?.[0]?.replace(/[),.;]+$/, '') || '';
        if (typeof value !== 'object') return '';
        for (const key of ['output_url', 'asset_url', 'download_url', 'media_url', 'url']) {
            if (typeof value[key] === 'string' && /^https?:\/\//i.test(value[key])) return value[key];
        }
        for (const item of Object.values(value)) {
            const found = Array.isArray(item) ? item.map(_findUrl).find(Boolean) : _findUrl(item);
            if (found) return found;
        }
        return '';
    }

    async function _waitForAsset(jobId) {
        for (let attempt = 0; attempt < 40; attempt++) {
            const result = _assertGeneration(await callTool('jobs_wait', {
                jobs: [{ index: 0, job_id: jobId }], timeout_seconds: 15,
            }));
            const url = _findUrl(result?.structuredContent || result);
            if (url) return url;
        }
        throw new Error('O vídeo demorou mais que o esperado. Ele continua salvo na sua conta Higgsfield.');
    }

    async function generateSeedance(blob, options = {}) {
        if (!state.connected) throw new Error('Conecte sua conta Higgsfield primeiro');
        const mediaId = await uploadImage(blob, 'tracker-seedance-start.webp');
        const params = {
            model: 'seedance_2_5',
            prompt: options.prompt || 'Cinematic product video. Preserve the exact product identity, shape, colours, logos and text. Natural camera motion and realistic lighting.',
            count: 1,
            mode: 'omni_reference',
            medias: [{ value: mediaId, role: 'start_image' }],
            duration: Math.min(30, Math.max(4, Number(options.duration) || 5)),
            resolution: '720p',
            aspect_ratio: options.aspectRatio || '1:1',
            generate_audio: options.generateAudio !== false,
            bitrate_mode: 'high',
            use_unlim: true,
        };
        const submitted = _assertGeneration(await callTool('generate_video', { params }));
        const jobId = _findJob(submitted?.structuredContent || submitted);
        if (!jobId) throw new Error(_resultText(submitted) || 'A Higgsfield não devolveu o código do vídeo');
        return { jobId, url: await _waitForAsset(jobId) };
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
        window.dispatchEvent(new CustomEvent('higgsfield:state', { detail: { connected: state.connected } }));
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

    return { init, connect, disconnect, refresh, refreshTools, callTool, uploadImage, generateSeedance, render, state, sessionId, backendOrigin };
})();

window.HiggsfieldConnection = HiggsfieldConnection;
document.addEventListener('DOMContentLoaded', () => HiggsfieldConnection.init());
