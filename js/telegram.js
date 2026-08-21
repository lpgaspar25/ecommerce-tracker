/* ===========================
   telegram.js — Integração Telegram
   Envia pro seu Telegram: lucro do dia, lucro por produto, variação
   intradiária (snapshots + alertas), resultado de testes e atualizações.

   Tudo é ADITIVO e defensivo: se o Telegram não estiver configurado ou
   qualquer dependência faltar, o app se comporta exatamente como antes.

   - Horário SEMPRE local do cliente (usa todayISO()/Date local, nunca UTC).
   - Reusa o cálculo canônico de lucro: DiaryModule.getEntryProfit (USD) e os
     conversores globais convertToUSD/convertCurrency/formatCurrency.
   - Persistência: config/estado em localStorage (etracker_*), snapshots em
     IndexedDB via KVStore (dado que cresce ao longo do dia).
   =========================== */

const TelegramModule = (() => {
    const CFG_KEY = 'etracker_telegram_config';
    const STATE_KEY = 'etracker_telegram_state';
    const SNAP_PREFIX = 'etracker_tg_snaps_'; // + YYYY-MM-DD  (KVStore)
    const PROXY_URL = '/api/telegram';
    const TG_LIMIT = 4096;

    const DEFAULTS = {
        enabled: false,
        mode: 'auto',            // 'auto' (proxy→direto) | 'proxy' | 'direct'
        botToken: '',            // usado só no modo direto (fica no navegador)
        chatId: '',
        // categorias
        notifyProfit: true,      // lucro do dia + variação
        notifyProductBreakdown: true,
        notifyTests: true,       // teste validado/reprovado
        notifyAnalyses: true,    // análises de IA / diagnósticos
        notifyUpdates: true,     // atualizações/alertas gerais (espelha toasts)
        // agendamento (HORÁRIO LOCAL DO CLIENTE)
        dailyTimes: ['09:00', '12:00', '15:00', '18:00', '21:00'],
        snapshotEveryMin: 60,    // captura + análise de variação a cada N min
        quietStart: '',          // ex.: '23:00' (opcional — silêncio)
        quietEnd: '',            // ex.: '07:00'
        // limiares de alerta (variação por produto)
        thr: {
            dropAbs: 100,        // R$ — queda de lucro vs. leitura anterior
            dropPct: 15,         // %  — queda de lucro vs. leitura anterior
            marginDropPp: 5,     // p.p. — queda de margem vs. leitura anterior
            marginMin: 15,       // %  — margem mínima aceitável
            spendNoSaleAbs: 80,  // R$ — gasto sem nenhuma venda
            cooldownMin: 90,     // min — intervalo mínimo entre alertas iguais
        },
    };

    let _timer = null;
    let _toastWrapped = false;

    // ── Config / estado ─────────────────────────────────────────────────
    function _readJSON(key, fallback) {
        try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; }
        catch { return fallback; }
    }
    function _writeJSON(key, val) {
        try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
    }
    function getConfig() {
        const raw = _readJSON(CFG_KEY, {}) || {};
        const cfg = { ...DEFAULTS, ...raw };
        cfg.thr = { ...DEFAULTS.thr, ...(raw.thr || {}) };
        if (!Array.isArray(cfg.dailyTimes)) cfg.dailyTimes = [...DEFAULTS.dailyTimes];
        return cfg;
    }
    function saveConfig(patch) {
        const cfg = { ...getConfig(), ...patch };
        _writeJSON(CFG_KEY, cfg);
        _updateStatusBadge();
        return cfg;
    }
    function _state() { return _readJSON(STATE_KEY, {}) || {}; }
    function _saveState(s) { _writeJSON(STATE_KEY, s); }

    function isConfigured() {
        const c = getConfig();
        return !!(c.chatId && (c.botToken || c.mode === 'proxy' || c.mode === 'auto'));
    }

    // ── Utils ───────────────────────────────────────────────────────────
    function _esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
    function _nowLocal() {
        // Data/hora LOCAL do cliente. Nada de UTC.
        const d = new Date();
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        return { date: (typeof todayISO === 'function' ? todayISO() : d.toISOString().slice(0, 10)), hhmm: `${hh}:${mm}`, ts: d.getTime() };
    }
    function _dmy(iso) { const [y, m, d] = String(iso || '').split('-'); return d && m ? `${d}/${m}` : iso; }
    function _brl(v) {
        if (typeof formatCurrency === 'function') return formatCurrency(v, 'BRL');
        return 'R$' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    function _pct(v) { return (v >= 0 ? '' : '') + Number(v || 0).toFixed(1).replace('.', ',') + '%'; }
    function _signedBrl(v) { return (v >= 0 ? '+' : '−') + _brl(Math.abs(v)).replace('R$', 'R$ ').trim(); }
    function _signedPp(v) { return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + ' p.p.'; }
    function _toBRL(valueUSD) {
        if (typeof convertCurrency === 'function') return convertCurrency(valueUSD, 'USD', 'BRL') || 0;
        return (valueUSD || 0) * 5.2;
    }
    function _inQuietHours(cfg, hhmm) {
        if (!cfg.quietStart || !cfg.quietEnd) return false;
        const [h, m] = hhmm.split(':').map(Number); const cur = h * 60 + m;
        const [sh, sm] = cfg.quietStart.split(':').map(Number); const st = sh * 60 + sm;
        const [eh, em] = cfg.quietEnd.split(':').map(Number); const en = eh * 60 + em;
        if (st === en) return false;
        return st < en ? (cur >= st && cur < en) : (cur >= st || cur < en); // janela que cruza a meia-noite
    }

    // ── Envio ───────────────────────────────────────────────────────────
    // Estratégia: modo 'proxy'/'auto' tenta a Pages Function (token fica no
    // servidor); se falhar e houver token local, cai pro modo direto. Modo
    // 'direct' fala direto com a Bot API (POST urlencoded evita preflight CORS).
    async function _viaProxy(payload) {
        const resp = await fetch(PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok || data.error || data.ok === false) {
            const err = new Error(data.error || data.description || ('HTTP ' + resp.status));
            err._status = resp.status;
            throw err;
        }
        return data;
    }
    async function _viaDirect(token, method, params) {
        const body = new URLSearchParams(params).toString();
        const resp = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        const data = await resp.json().catch(() => ({}));
        if (data && data.ok === false) throw new Error(data.description || 'Telegram recusou');
        return data;
    }

    // Envio bruto de texto (sem checar enabled/quiet). Retorna {ok, error}.
    async function _rawSend(text, { chatId } = {}) {
        const cfg = getConfig();
        const chat = chatId || cfg.chatId;
        if (!chat) return { ok: false, error: 'chat_id não configurado' };
        const chunks = _split(text, TG_LIMIT);
        try {
            for (const chunk of chunks) {
                if (cfg.mode === 'direct') {
                    if (!cfg.botToken) return { ok: false, error: 'Bot token ausente (modo direto)' };
                    await _viaDirect(cfg.botToken, 'sendMessage', { chat_id: chat, text: chunk, parse_mode: 'HTML', disable_web_page_preview: 'true' });
                } else {
                    try {
                        await _viaProxy({ action: 'sendMessage', chat_id: chat, text: chunk, parse_mode: 'HTML' });
                    } catch (e) {
                        // fallback pro direto se o proxy não estiver configurado/deployado
                        if (cfg.mode === 'auto' && cfg.botToken) {
                            await _viaDirect(cfg.botToken, 'sendMessage', { chat_id: chat, text: chunk, parse_mode: 'HTML', disable_web_page_preview: 'true' });
                        } else { throw e; }
                    }
                }
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: (e && e.message) || String(e) };
        }
    }
    function _split(text, max) {
        if (text.length <= max) return [text];
        const out = []; let cur = '';
        for (const line of text.split('\n')) {
            if ((cur + line + '\n').length > max) { if (cur) out.push(cur); cur = ''; }
            cur += line + '\n';
        }
        if (cur) out.push(cur);
        return out;
    }

    // Envio público (respeita enabled + horário de silêncio).
    async function send(text, { force = false } = {}) {
        const cfg = getConfig();
        if (!cfg.enabled && !force) return { ok: false, error: 'desativado' };
        if (!isConfigured()) return { ok: false, error: 'não configurado' };
        if (!force && _inQuietHours(cfg, _nowLocal().hhmm)) return { ok: false, error: 'silêncio' };
        return _rawSend(text);
    }

    // ── getMe / getUpdates (descobrir chat_id) ──────────────────────────
    async function _call(action, extra) {
        const cfg = getConfig();
        if (cfg.mode === 'direct') {
            if (!cfg.botToken) throw new Error('Bot token ausente');
            return _viaDirect(cfg.botToken, action, extra || {});
        }
        try { return await _viaProxy({ action, ...(extra || {}) }); }
        catch (e) {
            if (cfg.mode === 'auto' && cfg.botToken) return _viaDirect(cfg.botToken, action, extra || {});
            throw e;
        }
    }

    // ── Cálculo de lucro (reusa o motor do diário) ──────────────────────
    function _dayEntries(day) {
        const src = (typeof AppState !== 'undefined' && AppState)
            ? (AppState.diary && AppState.diary.length ? AppState.diary : AppState.allDiary) : null;
        if (!Array.isArray(src)) return [];
        const seen = new Map();
        src.forEach(e => {
            if (!e || e.isCampaign) return;
            if (e.date !== day) return;
            seen.set(`${e.date}|${e.productId}`, e); // dedup, último vence
        });
        return Array.from(seen.values());
    }
    function _entryProfitUSD(e) {
        try {
            if (typeof DiaryModule !== 'undefined' && DiaryModule.getEntryProfit) return DiaryModule.getEntryProfit(e) || 0;
        } catch {}
        // fallback grosseiro se o diário não estiver disponível
        const rUSD = (typeof convertToUSD === 'function') ? convertToUSD(e.revenue, e.revenueCurrency) : (e.revenue || 0);
        const bUSD = (typeof convertToUSD === 'function') ? convertToUSD(e.budget, e.budgetCurrency) : (e.budget || 0);
        return rUSD - bUSD;
    }
    function _productName(pid) {
        try { const p = (typeof getProductById === 'function') ? getProductById(pid) : null; if (p && p.name) return p.name; } catch {}
        return pid === '__STORE__' ? 'Loja' : (pid || 'Sem produto');
    }

    // Retorna { total, products:[...] } tudo em BRL para a mensagem.
    function computeByProduct(day) {
        const entries = _dayEntries(day);
        const byPid = new Map();
        entries.forEach(e => {
            const pid = e.productId || '—';
            const acc = byPid.get(pid) || { productId: pid, name: _productName(pid), profitUSD: 0, revenueUSD: 0, spendUSD: 0, sales: 0 };
            acc.profitUSD += _entryProfitUSD(e);
            acc.revenueUSD += (typeof convertToUSD === 'function') ? convertToUSD(e.revenue, e.revenueCurrency) : (e.revenue || 0);
            acc.spendUSD += (typeof convertToUSD === 'function') ? convertToUSD(e.budget, e.budgetCurrency) : (e.budget || 0);
            acc.sales += e.sales || 0;
            byPid.set(pid, acc);
        });
        const products = Array.from(byPid.values()).map(a => {
            const revenueBRL = _toBRL(a.revenueUSD);
            const profitBRL = _toBRL(a.profitUSD);
            const spendBRL = _toBRL(a.spendUSD);
            return {
                productId: a.productId, name: a.name, sales: a.sales,
                profitBRL, revenueBRL, spendBRL,
                marginPct: revenueBRL > 0 ? (profitBRL / revenueBRL) * 100 : 0,
                roas: spendBRL > 0 ? revenueBRL / spendBRL : 0,
            };
        }).sort((x, y) => y.profitBRL - x.profitBRL);

        const total = products.reduce((t, p) => {
            t.profitBRL += p.profitBRL; t.revenueBRL += p.revenueBRL; t.spendBRL += p.spendBRL; t.sales += p.sales; return t;
        }, { profitBRL: 0, revenueBRL: 0, spendBRL: 0, sales: 0 });
        total.marginPct = total.revenueBRL > 0 ? (total.profitBRL / total.revenueBRL) * 100 : 0;
        total.roas = total.spendBRL > 0 ? total.revenueBRL / total.spendBRL : 0;
        return { total, products };
    }

    // ── Snapshots (IndexedDB via KVStore) ───────────────────────────────
    async function _loadSnaps(day) {
        try { return (await (window.KVStore && KVStore.get(SNAP_PREFIX + day, []))) || []; } catch { return []; }
    }
    async function _saveSnap(day, snap) {
        try {
            const arr = await _loadSnaps(day);
            arr.push(snap);
            while (arr.length > 96) arr.shift();
            if (window.KVStore) await KVStore.set(SNAP_PREFIX + day, arr);
        } catch {}
    }
    function _snapshotFrom(data, hhmm, ts) {
        const products = {};
        data.products.forEach(p => { products[p.productId] = { name: p.name, profitBRL: p.profitBRL, marginPct: p.marginPct, revenueBRL: p.revenueBRL, spendBRL: p.spendBRL, sales: p.sales }; });
        return { t: hhmm, ts, total: { profitBRL: data.total.profitBRL, marginPct: data.total.marginPct, revenueBRL: data.total.revenueBRL, spendBRL: data.total.spendBRL, sales: data.total.sales }, products };
    }

    // ── Motor de variação / alertas por produto ─────────────────────────
    function _analyzeChanges(day, data, snaps) {
        const cfg = getConfig(); const thr = cfg.thr;
        const st = _state(); st.lastAlert = st.lastAlert || {};
        const now = Date.now();
        const prev = snaps.length ? snaps[snaps.length - 1] : null;      // leitura anterior
        const first = snaps.length ? snaps[0] : null;                     // abertura do dia
        const alerts = [];

        const canFire = (key) => {
            const last = st.lastAlert[key] || 0;
            return (now - last) >= thr.cooldownMin * 60000;
        };
        const fire = (key, text) => { alerts.push(text); st.lastAlert[key] = now; };

        data.products.forEach(p => {
            const pv = prev && prev.products[p.productId];
            const fv = first && first.products[p.productId];
            const label = `<b>${_esc(p.name)}</b>`;

            // 1) virou prejuízo
            if (p.profitBRL < 0 && (!pv || pv.profitBRL >= 0) && canFire(p.productId + '|loss')) {
                fire(p.productId + '|loss', `🔴 ${label} entrou no <b>prejuízo</b>: ${_brl(p.profitBRL)} (${_pct(p.marginPct)}) • gasto ${_brl(p.spendBRL)} • ${p.sales} venda(s)`);
            }
            // 2) queda forte de lucro vs. leitura anterior
            if (pv) {
                const dProfit = p.profitBRL - pv.profitBRL;
                const dropPct = pv.profitBRL > 0 ? (-dProfit / pv.profitBRL) * 100 : 0;
                if (dProfit < 0 && (Math.abs(dProfit) >= thr.dropAbs || dropPct >= thr.dropPct) && canFire(p.productId + '|drop')) {
                    fire(p.productId + '|drop',
                        `📉 ${label} — lucro caiu de ${_brl(pv.profitBRL)} (${_pct(pv.marginPct)}) às ${pv.t} → ${_brl(p.profitBRL)} (${_pct(p.marginPct)}) agora\n   Δ ${_signedBrl(dProfit)} / ${_signedPp(p.marginPct - pv.marginPct)}`);
                }
                // 3) queda de margem
                const dMargin = p.marginPct - pv.marginPct;
                if (dMargin <= -thr.marginDropPp && canFire(p.productId + '|margin')) {
                    fire(p.productId + '|margin', `⚠️ ${label} — margem caiu ${_signedPp(dMargin)} (${_pct(pv.marginPct)} → ${_pct(p.marginPct)}) desde ${pv.t}`);
                }
            }
            // 4) margem abaixo do mínimo (com receita relevante)
            if (p.revenueBRL > 0 && p.marginPct < thr.marginMin && p.profitBRL >= 0 && canFire(p.productId + '|lowmargin')) {
                fire(p.productId + '|lowmargin', `🟠 ${label} — margem baixa: ${_pct(p.marginPct)} (mín. ${thr.marginMin}%) • lucro ${_brl(p.profitBRL)}`);
            }
            // 5) gasto sem venda
            if (p.sales === 0 && p.spendBRL >= thr.spendNoSaleAbs && canFire(p.productId + '|nosale')) {
                fire(p.productId + '|nosale', `🟠 ${label} — ${_brl(p.spendBRL)} gastos e <b>0 vendas</b> hoje`);
            }
            void fv;
        });

        _saveState(st);
        return alerts;
    }

    // ── Formatação das mensagens ────────────────────────────────────────
    function _fmtProductLine(p, snaps) {
        const first = snaps.length ? snaps[0] : null;
        const fv = first && first.products[p.productId];
        let delta = '';
        if (fv) {
            const d = p.profitBRL - fv.profitBRL;
            const arrow = d > 0.005 ? '🔺' : (d < -0.005 ? '🔻' : '▪️');
            if (Math.abs(d) >= 0.01) delta = `  ${arrow} ${_signedBrl(d)} desde ${first.t}`;
        }
        return `• ${_esc(p.name)}: <b>${_brl(p.profitBRL)}</b> (${_pct(p.marginPct)})${delta}`;
    }
    function _buildDailyMessage(day, data, snaps, hhmm) {
        const cfg = getConfig();
        const t = data.total;
        const prev = snaps.length ? snaps[snaps.length - 1] : null;
        let head = `📊 <b>Lucro de hoje</b> (${_dmy(day)}) — ${hhmm}\n`;
        head += `Total: <b>${_brl(t.profitBRL)}</b> (${_pct(t.marginPct)}) • Fat. ${_brl(t.revenueBRL)} • Gasto ${_brl(t.spendBRL)} • ROAS ${t.roas.toFixed(2).replace('.', ',')} • ${t.sales} venda(s)`;
        if (prev) {
            const d = t.profitBRL - prev.total.profitBRL;
            const arrow = d > 0.005 ? '🔺' : (d < -0.005 ? '🔻' : '▪️');
            head += `\nvs ${prev.t}: ${arrow} ${_signedBrl(d)} (${_signedPp(t.marginPct - prev.total.marginPct)})`;
        }
        let body = '';
        if (cfg.notifyProductBreakdown && data.products.length) {
            const top = data.products.slice(0, 15).map(p => _fmtProductLine(p, snaps));
            body = `\n\n<b>Por produto</b>\n` + top.join('\n');
            if (data.products.length > 15) body += `\n… +${data.products.length - 15} produto(s)`;
        }
        return head + body;
    }

    // ── Ações de alto nível ─────────────────────────────────────────────
    // Captura leitura, salva snapshot, roda alertas. Retorna {data, alerts}.
    async function _captureAndAnalyze(day) {
        const data = computeByProduct(day);
        const snaps = await _loadSnaps(day);
        const alerts = _analyzeChanges(day, data, snaps);
        const now = _nowLocal();
        await _saveSnap(day, _snapshotFrom(data, now.hhmm, now.ts));
        return { data, alerts, snapsBefore: snaps };
    }

    // Envia o resumo de lucro de hoje (usado pelo agendador e pelo botão).
    // Só LÊ snapshots (pra linha "vs anterior"/"desde a abertura"); a escrita
    // de snapshot fica com a cadência (_sendVariationAlerts), evitando corrida.
    async function sendDailyProfit({ force = false } = {}) {
        const day = _nowLocal().date;
        const data = computeByProduct(day);
        if (!data.products.length) {
            return force ? send('📊 Nenhum lançamento no diário para hoje ainda.', { force }) : { ok: false, error: 'sem dados' };
        }
        const snaps = await _loadSnaps(day);
        const msg = _buildDailyMessage(day, data, snaps, _nowLocal().hhmm);
        return send(msg, { force });
    }

    // Envia os alertas de variação (chamado pelo agendador).
    async function _sendVariationAlerts(day) {
        const { alerts } = await _captureAndAnalyze(day);
        if (!alerts.length) return { ok: true, sent: 0 };
        const msg = `🚨 <b>Alertas de variação</b> — ${_dmy(day)} ${_nowLocal().hhmm}\n\n` + alerts.join('\n');
        const r = await send(msg);
        return { ...r, sent: alerts.length };
    }

    // ── Agendador (horário LOCAL do cliente) ────────────────────────────
    async function _tick() {
        try {
            const cfg = getConfig();
            if (!cfg.enabled || !isConfigured()) return;
            const { date, hhmm, ts } = _nowLocal();
            const st = _state();
            st.sentDaily = st.sentDaily || {};
            if (st.sentDaily.__day !== date) st.sentDaily = { __day: date }; // reset diário

            // 1) resumos em horários fixos
            if (cfg.notifyProfit && !_inQuietHours(cfg, hhmm)) {
                for (const time of cfg.dailyTimes) {
                    if (hhmm >= time && !st.sentDaily[time]) {
                        st.sentDaily[time] = true; _saveState(st);
                        await sendDailyProfit();
                    }
                }
            }
            // 2) snapshots + alertas de variação a cada N min
            if (cfg.notifyProfit && cfg.snapshotEveryMin > 0) {
                if (!st.lastSnapTs || (ts - st.lastSnapTs) >= cfg.snapshotEveryMin * 60000) {
                    st.lastSnapTs = ts; _saveState(st);
                    if (!_inQuietHours(cfg, hhmm)) await _sendVariationAlerts(date);
                    else await _captureAndAnalyze(date); // registra sem enviar
                }
            }
        } catch {}
    }

    // ── Hooks: testes, análises, atualizações ───────────────────────────
    function _onDiaryChanged() {
        try {
            const cfg = getConfig();
            if (!cfg.enabled || !cfg.notifyTests || !isConfigured()) return;
            const src = (typeof AppState !== 'undefined' && AppState) ? (AppState.allDiary || []) : [];
            const st = _state(); const prevMap = st.tests || {};
            const curMap = {};
            const news = [];
            src.forEach(e => {
                if (!e || !e.isTest) return;
                const v = String(e.testValidation || 'pendente').toLowerCase();
                curMap[e.id] = v;
                const was = prevMap[e.id];
                if (was === undefined) return; // criado agora → não spammar no boot
                if (was !== v && (v === 'validado' || v === 'nao_validado')) {
                    news.push({ e, v });
                }
            });
            st.tests = curMap; _saveState(st);
            if (!Object.keys(prevMap).length) return; // primeiro carregamento: só registra
            news.forEach(({ e, v }) => {
                const win = v === 'validado';
                const icon = win ? '✅' : '❌';
                const verdict = win ? 'VALIDADO' : 'REPROVADO';
                const goal = e.testGoal ? ` • Meta: ${_esc(e.testGoal)}` : '';
                send(`${icon} <b>Teste ${verdict}</b>\nProduto: ${_esc(_productName(e.productId))}${goal}`);
            });
        } catch {}
    }
    function _seedTestState() {
        try {
            const src = (typeof AppState !== 'undefined' && AppState) ? (AppState.allDiary || []) : [];
            const st = _state(); const map = {};
            src.forEach(e => { if (e && e.isTest) map[e.id] = String(e.testValidation || 'pendente').toLowerCase(); });
            st.tests = map; _saveState(st);
        } catch {}
    }

    // Espelha toasts relevantes como "atualizações"/"análises" (opt-in).
    const _MUTE = /(copiad|copiou|clipboard|salvo local|área de transf)/i;
    function _onToast(msg, type) {
        try {
            const cfg = getConfig();
            if (!cfg.enabled || !isConfigured()) return;
            if (!cfg.notifyUpdates && !cfg.notifyAnalyses) return;
            const t = String(type || 'info').toLowerCase();
            if (t === 'info') return;                      // ignora ruído informativo
            const plain = String(msg || '').replace(/<[^>]*>/g, '').trim();
            if (!plain || _MUTE.test(plain)) return;
            const st = _state(); const now = Date.now();
            st.toast = st.toast || {};
            if (st.toast.last === plain && (now - (st.toast.ts || 0)) < 60000) return; // dedupe 1min
            st.toast = { last: plain, ts: now }; _saveState(st);
            const icon = t === 'error' ? '❗' : (t === 'warning' || t === 'warn' ? '⚠️' : 'ℹ️');
            if (_inQuietHours(cfg, _nowLocal().hhmm) && t !== 'error') return;
            send(`${icon} ${_esc(plain)}`);
        } catch {}
    }
    function _wrapToast() {
        if (_toastWrapped) return;
        if (typeof window.showToast !== 'function') return;
        const orig = window.showToast;
        window.showToast = function (message, type) {
            try { _onToast(message, type); } catch {}
            return orig.apply(this, arguments);
        };
        _toastWrapped = true;
    }

    // API pública para outros módulos dispararem análises ricas.
    async function notifyAnalysis(title, text) {
        const cfg = getConfig();
        if (!cfg.enabled || !cfg.notifyAnalyses || !isConfigured()) return { ok: false };
        const body = String(text || '').replace(/<[^>]*>/g, '').trim().slice(0, 1500);
        return send(`🧠 <b>${_esc(title || 'Análise')}</b>\n${_esc(body)}`);
    }

    // ── Teste de conexão ────────────────────────────────────────────────
    async function sendTest() {
        const now = _nowLocal();
        const txt = `✅ <b>Telegram conectado!</b>\nSua ferramenta vai te mandar lucro do dia, variação por produto e alertas por aqui.\n🕒 ${now.hhmm} (horário do seu dispositivo) • ${_dmy(now.date)}`;
        return _rawSend(txt);
    }

    // ── UI (modal injetado + botão no menu do perfil) ───────────────────
    function _updateStatusBadge() {
        const badge = document.getElementById('telegram-status');
        if (!badge) return;
        const on = getConfig().enabled && isConfigured();
        badge.textContent = on ? 'Conectado' : 'Desconectado';
        badge.className = 'status-badge profile-dropdown-badge ' + (on ? 'status-connected' : 'status-disconnected');
    }
    function _injectDropdownButton() {
        const dd = document.getElementById('profile-dropdown');
        if (!dd || document.getElementById('btn-telegram-config')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-telegram-config';
        btn.className = 'profile-dropdown-item';
        btn.innerHTML = `<i data-lucide="send" style="width:14px;height:14px"></i> <span>Telegram</span> <span id="telegram-status" class="status-badge profile-dropdown-badge status-disconnected">Desconectado</span>`;
        // insere antes do logout, se existir
        const logout = dd.querySelector('#btn-logout, [id*="logout"]');
        if (logout && logout.parentElement === dd) dd.insertBefore(btn, logout);
        else dd.appendChild(btn);
        btn.addEventListener('click', () => { dd.classList.remove('open'); openConfigModal(); });
        if (typeof lucide !== 'undefined') { try { lucide.createIcons(); } catch {} }
        _updateStatusBadge();
    }
    function _ensureModal() {
        if (document.getElementById('telegram-modal')) return;
        const el = document.createElement('div');
        el.id = 'telegram-modal';
        el.className = 'modal hidden';
        el.innerHTML = `
        <div class="modal-overlay"></div>
        <div class="modal-content modal-sm" style="max-width:560px">
          <div class="modal-header">
            <h3><i data-lucide="send" style="width:18px;height:18px;vertical-align:-3px"></i> Telegram</h3>
            <button class="btn-close" id="telegram-modal-close">&times;</button>
          </div>
          <div style="padding:0 4px 8px;max-height:70vh;overflow:auto">
            <p id="tg-conn-status" style="margin:0 0 12px;font-size:.85rem;color:var(--text-secondary,#9aa)"></p>

            <details style="margin-bottom:12px">
              <summary style="cursor:pointer;font-size:.85rem">Como conectar (2 min)</summary>
              <ol style="font-size:.82rem;line-height:1.5;padding-left:1.1rem;color:var(--text-secondary,#9aa)">
                <li>No Telegram, abra <b>@BotFather</b> → <code>/newbot</code> → copie o <b>token</b>.</li>
                <li>Abra <b>@userinfobot</b> e envie qualquer coisa → copie seu <b>Chat ID</b>.</li>
                <li>Mande uma mensagem qualquer pro seu bot (destrava o 1º envio).</li>
                <li>Cole abaixo e clique <b>Enviar teste</b>.</li>
              </ol>
            </details>

            <div class="form-group"><label>Chat ID</label>
              <input type="text" id="tg-chat-id" class="input" placeholder="ex.: 123456789 ou -1001234567890"></div>
            <div class="form-group"><label>Bot Token <span style="opacity:.6">(modo direto / teste imediato)</span></label>
              <input type="password" id="tg-bot-token" class="input" placeholder="123456789:AAH..."></div>
            <div class="form-group"><label>Modo de envio</label>
              <select id="tg-mode" class="input">
                <option value="auto">Automático (servidor → direto)</option>
                <option value="proxy">Só servidor (token fica no Cloudflare)</option>
                <option value="direct">Direto (token no navegador)</option>
              </select></div>
            <div style="display:flex;gap:8px;margin:6px 0 14px">
              <button type="button" class="btn btn-secondary" id="tg-discover">Descobrir Chat ID</button>
              <button type="button" class="btn btn-secondary" id="tg-test">Enviar teste</button>
            </div>

            <label style="display:flex;align-items:center;gap:8px;font-weight:600;margin-bottom:10px">
              <input type="checkbox" id="tg-enabled"> Ativar notificações</label>

            <div style="font-size:.8rem;font-weight:600;margin:6px 0 4px;color:var(--text-secondary,#9aa)">O que enviar</div>
            <label class="tg-chk"><input type="checkbox" id="tg-notifyProfit"> Lucro do dia + variação intradiária</label>
            <label class="tg-chk"><input type="checkbox" id="tg-notifyProductBreakdown"> Detalhar lucro por produto</label>
            <label class="tg-chk"><input type="checkbox" id="tg-notifyTests"> Resultado de testes (validado/reprovado)</label>
            <label class="tg-chk"><input type="checkbox" id="tg-notifyAnalyses"> Análises</label>
            <label class="tg-chk"><input type="checkbox" id="tg-notifyUpdates"> Atualizações / alertas gerais</label>

            <div style="font-size:.8rem;font-weight:600;margin:14px 0 4px;color:var(--text-secondary,#9aa)">Horários (do seu dispositivo)</div>
            <div class="form-group"><label>Resumos diários (HH:MM, separados por vírgula)</label>
              <input type="text" id="tg-dailyTimes" class="input" placeholder="09:00, 12:00, 15:00, 18:00, 21:00"></div>
            <div style="display:flex;gap:8px">
              <div class="form-group" style="flex:1"><label>Snapshot a cada (min)</label>
                <input type="number" id="tg-snapshotEveryMin" class="input" min="0" step="15"></div>
              <div class="form-group" style="flex:1"><label>Silêncio de</label>
                <input type="text" id="tg-quietStart" class="input" placeholder="23:00"></div>
              <div class="form-group" style="flex:1"><label>até</label>
                <input type="text" id="tg-quietEnd" class="input" placeholder="07:00"></div>
            </div>

            <details style="margin:6px 0 12px">
              <summary style="cursor:pointer;font-size:.85rem">Limiares de alerta (avançado)</summary>
              <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
                <div class="form-group" style="flex:1 1 45%"><label>Queda de lucro (R$)</label><input type="number" id="tg-thr-dropAbs" class="input"></div>
                <div class="form-group" style="flex:1 1 45%"><label>Queda de lucro (%)</label><input type="number" id="tg-thr-dropPct" class="input"></div>
                <div class="form-group" style="flex:1 1 45%"><label>Queda de margem (p.p.)</label><input type="number" id="tg-thr-marginDropPp" class="input"></div>
                <div class="form-group" style="flex:1 1 45%"><label>Margem mínima (%)</label><input type="number" id="tg-thr-marginMin" class="input"></div>
                <div class="form-group" style="flex:1 1 45%"><label>Gasto sem venda (R$)</label><input type="number" id="tg-thr-spendNoSaleAbs" class="input"></div>
                <div class="form-group" style="flex:1 1 45%"><label>Cooldown (min)</label><input type="number" id="tg-thr-cooldownMin" class="input"></div>
              </div>
            </details>

            <div class="form-actions" style="display:flex;gap:8px;justify-content:space-between">
              <button type="button" class="btn btn-secondary" id="tg-send-now">Enviar lucro de hoje agora</button>
              <button type="button" class="btn btn-primary" id="tg-save">Salvar</button>
            </div>
          </div>
        </div>`;
        document.body.appendChild(el);
        el.querySelector('.modal-overlay').addEventListener('click', () => _close());
        el.querySelector('#telegram-modal-close').addEventListener('click', () => _close());
        el.querySelector('#tg-save').addEventListener('click', _saveFromModal);
        el.querySelector('#tg-test').addEventListener('click', _testFromModal);
        el.querySelector('#tg-discover').addEventListener('click', _discoverFromModal);
        el.querySelector('#tg-send-now').addEventListener('click', _sendNowFromModal);
        // injeta estilo mínimo pros checkboxes
        if (!document.getElementById('tg-style')) {
            const s = document.createElement('style'); s.id = 'tg-style';
            s.textContent = '.tg-chk{display:flex;align-items:center;gap:8px;font-size:.85rem;margin:4px 0}';
            document.head.appendChild(s);
        }
        if (typeof lucide !== 'undefined') { try { lucide.createIcons(); } catch {} }
    }
    function _open() { const m = document.getElementById('telegram-modal'); if (m) m.classList.remove('hidden'); }
    function _close() { const m = document.getElementById('telegram-modal'); if (m) m.classList.add('hidden'); }

    function _fill() {
        const c = getConfig(); const g = id => document.getElementById(id);
        g('tg-chat-id').value = c.chatId || '';
        g('tg-bot-token').value = c.botToken || '';
        g('tg-mode').value = c.mode || 'auto';
        g('tg-enabled').checked = !!c.enabled;
        ['notifyProfit', 'notifyProductBreakdown', 'notifyTests', 'notifyAnalyses', 'notifyUpdates'].forEach(k => { const el = g('tg-' + k); if (el) el.checked = !!c[k]; });
        g('tg-dailyTimes').value = (c.dailyTimes || []).join(', ');
        g('tg-snapshotEveryMin').value = c.snapshotEveryMin;
        g('tg-quietStart').value = c.quietStart || '';
        g('tg-quietEnd').value = c.quietEnd || '';
        Object.keys(DEFAULTS.thr).forEach(k => { const el = g('tg-thr-' + k); if (el) el.value = c.thr[k]; });
        _renderConnStatus();
    }
    function _renderConnStatus(extra) {
        const el = document.getElementById('tg-conn-status'); if (!el) return;
        const on = getConfig().enabled && isConfigured();
        el.innerHTML = (on ? '🟢 Conectado' : '⚪ Desconectado') + (extra ? ' — ' + _esc(extra) : '');
    }
    function _collectFromModal() {
        const g = id => document.getElementById(id);
        const times = (g('tg-dailyTimes').value || '').split(',').map(s => s.trim()).filter(s => /^\d{1,2}:\d{2}$/.test(s));
        const thr = {}; Object.keys(DEFAULTS.thr).forEach(k => { const v = parseFloat(g('tg-thr-' + k).value); thr[k] = isNaN(v) ? DEFAULTS.thr[k] : v; });
        return {
            chatId: g('tg-chat-id').value.trim(),
            botToken: g('tg-bot-token').value.trim(),
            mode: g('tg-mode').value,
            enabled: g('tg-enabled').checked,
            notifyProfit: g('tg-notifyProfit').checked,
            notifyProductBreakdown: g('tg-notifyProductBreakdown').checked,
            notifyTests: g('tg-notifyTests').checked,
            notifyAnalyses: g('tg-notifyAnalyses').checked,
            notifyUpdates: g('tg-notifyUpdates').checked,
            dailyTimes: times.length ? times : DEFAULTS.dailyTimes,
            snapshotEveryMin: Math.max(0, parseInt(g('tg-snapshotEveryMin').value, 10) || 0),
            quietStart: g('tg-quietStart').value.trim(),
            quietEnd: g('tg-quietEnd').value.trim(),
            thr,
        };
    }
    function _saveFromModal() {
        saveConfig(_collectFromModal());
        _renderConnStatus('salvo');
        if (typeof showToast === 'function') showToast('Telegram salvo!', 'success');
    }
    async function _testFromModal() {
        saveConfig(_collectFromModal());
        _renderConnStatus('enviando teste…');
        const r = await sendTest();
        _renderConnStatus(r.ok ? 'teste enviado ✅' : ('falhou: ' + r.error));
        if (typeof showToast === 'function') showToast(r.ok ? 'Teste enviado no Telegram!' : ('Falha: ' + r.error), r.ok ? 'success' : 'error');
    }
    async function _discoverFromModal() {
        saveConfig(_collectFromModal());
        _renderConnStatus('buscando…');
        try {
            const data = await _call('getUpdates', {});
            const list = (data && data.result) || [];
            const found = [];
            list.forEach(u => { const c = (u.message || u.channel_post || u.my_chat_member || {}).chat; if (c && !found.find(f => f.id === c.id)) found.push({ id: c.id, name: c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '' }); });
            if (found.length) {
                document.getElementById('tg-chat-id').value = String(found[0].id);
                _renderConnStatus(`Chat ID encontrado: ${found[0].id} (${found[0].name})`);
            } else {
                _renderConnStatus('nada encontrado — mande uma mensagem pro bot e tente de novo');
            }
        } catch (e) { _renderConnStatus('erro: ' + ((e && e.message) || e)); }
    }
    async function _sendNowFromModal() {
        saveConfig(_collectFromModal());
        _renderConnStatus('enviando lucro de hoje…');
        const r = await sendDailyProfit({ force: true });
        _renderConnStatus(r.ok ? 'enviado ✅' : ('falhou: ' + (r.error || '')));
        if (typeof showToast === 'function') showToast(r.ok ? 'Lucro de hoje enviado!' : ('Falha: ' + (r.error || '')), r.ok ? 'success' : 'error');
    }
    function openConfigModal() { _ensureModal(); _fill(); _open(); }

    // ── Init ────────────────────────────────────────────────────────────
    function init() {
        try {
            _injectDropdownButton();
            _wrapToast();
            _seedTestState();
            if (typeof EventBus !== 'undefined' && EventBus.on) {
                EventBus.on('diaryChanged', _onDiaryChanged);
                EventBus.on('dataLoaded', () => { _seedTestState(); _updateStatusBadge(); });
            }
            if (_timer) clearInterval(_timer);
            _timer = setInterval(_tick, 60000);
            // primeira verificação logo após o boot (dados já hidratados)
            setTimeout(_tick, 8000);
        } catch {}
    }

    return {
        init, openConfigModal,
        getConfig, saveConfig, isConfigured,
        send, sendTest, sendDailyProfit, computeByProduct, notifyAnalysis,
    };
})();

if (typeof window !== 'undefined') window.TelegramModule = TelegramModule;

// Auto-init (todos os scripts do app são `defer`, então o DOM já existe).
if (document.readyState !== 'loading') { try { TelegramModule.init(); } catch {} }
else document.addEventListener('DOMContentLoaded', () => { try { TelegramModule.init(); } catch {} });
