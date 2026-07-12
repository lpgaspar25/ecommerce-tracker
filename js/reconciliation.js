/* =========================================================
   ReconciliationModule — Conciliação de Caixa (£ Operação × R$ Brasil)

   Responde: "Meu lucro (BK) diz X, mas meu banco não cresce. Onde está o dinheiro?"

   MODELO (identidade contábil correta):
     O lucro do período AUMENTA seu caixa TOTAL, espalhado entre as contas:
        Shopify (pendente £) + Payoneer (£) + Banco BR (R$)
     Então:  Lucro ≈ ΔShopify + ΔPayoneer + ΔBanco  (± chargeback / FX)
     O banco BR sozinho só mostra a fatia REMETIDA — o resto está em £ lá fora.
     A "Diferença não explicada" é o que sobra: se for grande, tem erro
     (venda não recebida, taxa a mais, saída fantasma).

   Entrada de dados:
     - Manual (saldos início/fim de cada conta, por mês)
     - Import OFX / CSV do extrato bancário (calcula ΔBanco automático)

   Persistência: localStorage. Lucro do BK vem do RemoteCapturesModule.
   ========================================================= */

const ReconciliationModule = (() => {
    const STORAGE_KEY = 'etracker_reconciliation';

    const DEFAULT_STATE = {
        version: 2,
        fxGbpBrl: 6.50,          // câmbio GBP→BRL
        periodoAtivo: null,
        periodos: [],
    };

    function _novoPeriodo(label) {
        return {
            id: 'per_' + Math.abs(_hash(label + ':' + (state.periodos.length))).toString(36),
            label: label || 'Novo período',
            vendasGBP: 0,            // contexto (faturamento bruto) — não entra na identidade
            // ── Saldos das contas (início → fim) ──
            shopifyIniGBP: 0, shopifyFimGBP: 0,     // pendente / balance na Shopify
            payoneerIniGBP: 0, payoneerFimGBP: 0,   // Payoneer
            bancoIniBRL: 0, bancoFimBRL: 0,         // banco BR
            // ── Ajustes / referência ──
            chargebackGBP: 0,       // reembolso/chargeback do período
            lucroBKBRL: 0,          // lucro contábil do BK
            obs: '',
        };
    }

    let state = _clone(DEFAULT_STATE);

    // ── util ──
    function _clone(o) { return JSON.parse(JSON.stringify(o)); }
    function _hash(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = ((h << 5) - h + s.charCodeAt(i)) | 0; } return h; }
    function _n(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
    function fmtBRL(v) { return 'R$ ' + (_n(v)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function fmtGBP(v) { return '£ ' + (_n(v)).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    function $(id) { return document.getElementById(id); }

    function load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                // migração v1→v2: descarta modelo antigo incompatível, preserva fx e labels
                if (parsed && parsed.version >= 2) {
                    state = Object.assign(_clone(DEFAULT_STATE), parsed);
                } else if (parsed) {
                    state = _clone(DEFAULT_STATE);
                    state.fxGbpBrl = _n(parsed.fxGbpBrl) || 6.5;
                }
            }
        } catch (e) { /* keep default */ }
        if (!state.periodos.length) {
            const p = _novoPeriodo(_mesAtualLabel());
            state.periodos.push(p);
            state.periodoAtivo = p.id;
        }
        if (!state.periodoAtivo || !state.periodos.find(p => p.id === state.periodoAtivo)) {
            state.periodoAtivo = state.periodos[0].id;
        }
    }

    function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {} }

    function _mesAtualLabel() {
        const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const d = new Date();
        return `${meses[d.getMonth()]}/${d.getFullYear()}`;
    }

    function _periodoAtivo() { return state.periodos.find(p => p.id === state.periodoAtivo) || state.periodos[0]; }

    // ── CÁLCULO (identidade de caixa) ──
    function _calcular(p) {
        const fx = _n(state.fxGbpBrl) || 1;

        const dShopifyGBP = _n(p.shopifyFimGBP) - _n(p.shopifyIniGBP);
        const dPayoneerGBP = _n(p.payoneerFimGBP) - _n(p.payoneerIniGBP);
        const dShopifyBRL = dShopifyGBP * fx;
        const dPayoneerBRL = dPayoneerGBP * fx;
        const dBancoBRL = _n(p.bancoFimBRL) - _n(p.bancoIniBRL);

        const aumentoLaForaBRL = dShopifyBRL + dPayoneerBRL;      // dinheiro que ficou em £
        const aumentoTotalBRL = aumentoLaForaBRL + dBancoBRL;     // caixa total gerado
        const chargebackBRL = _n(p.chargebackGBP) * fx;

        const lucro = _n(p.lucroBKBRL);
        // Lucro deveria ≈ aumento de caixa total (+ chargeback já descontado no lucro do BK).
        const naoExplicado = lucro - aumentoTotalBRL - chargebackBRL;

        const pctNoBanco = aumentoTotalBRL !== 0 ? (dBancoBRL / aumentoTotalBRL) * 100 : 0;
        const laForaFimGBP = _n(p.shopifyFimGBP) + _n(p.payoneerFimGBP);

        return {
            fx, dShopifyBRL, dPayoneerBRL, dBancoBRL,
            aumentoLaForaBRL, aumentoTotalBRL, chargebackBRL,
            lucro, naoExplicado, pctNoBanco, laForaFimGBP,
        };
    }

    // ── IMPORT OFX / CSV → ΔBanco ──
    function _parseExtrato(text, filename) {
        const isOFX = /<OFX>|<STMTTRN>/i.test(text) || /\.ofx$/i.test(filename || '');
        let entradas = 0, saidas = 0, count = 0;
        if (isOFX) {
            const re = /<TRNAMT>\s*(-?[\d.,]+)/gi;
            let m;
            while ((m = re.exec(text)) !== null) {
                const v = parseFloat(String(m[1]).replace(/,/g, '')) || 0;
                if (v >= 0) entradas += v; else saidas += Math.abs(v);
                count++;
            }
        } else {
            const linhas = text.split(/\r?\n/).filter(l => l.trim());
            const sep = (linhas[0] && linhas[0].split(';').length > linhas[0].split(',').length) ? ';' : ',';
            for (let i = 0; i < linhas.length; i++) {
                const cols = linhas[i].split(sep);
                let val = null;
                for (let c = cols.length - 1; c >= 0; c--) {
                    const raw = cols[c].trim().replace(/["R$£€\s]/g, '');
                    if (/^-?[\d.]*,?\d+$/.test(raw) && /\d/.test(raw)) { val = _numBr(raw); break; }
                }
                if (val === null || !isFinite(val)) continue;
                if (val >= 0) entradas += val; else saidas += Math.abs(val);
                count++;
            }
        }
        return { entradas, saidas, liquido: entradas - saidas, count };
    }
    function _numBr(s) {
        s = String(s).trim();
        if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
        else s = s.replace(/,/g, '');
        return parseFloat(s) || 0;
    }

    async function _onImportFile(file) {
        if (!file) return;
        let text = '';
        try { text = await file.text(); } catch (e) { return; }
        const r = _parseExtrato(text, file.name);
        const p = _periodoAtivo();
        p.bancoFimBRL = _n(p.bancoIniBRL) + r.liquido;   // ΔBanco = líquido do extrato
        p.obs = (p.obs ? p.obs + ' | ' : '') + `Extrato ${file.name}: +${fmtBRL(r.entradas)} / −${fmtBRL(r.saidas)} (${r.count} lançamentos)`;
        save(); render();
        if (typeof showToast === 'function') showToast(`Extrato lido: ${r.count} lançamentos · líquido ${fmtBRL(r.liquido)}`, 'success');
    }

    function _puxarLucroBK() {
        try {
            if (typeof RemoteCapturesModule === 'undefined' || !RemoteCapturesModule.listCaptures) return null;
            const caps = RemoteCapturesModule.listCaptures() || [];
            return caps.find(c => /bk/i.test((c.plataforma || '') + ' ' + (c.url || ''))) || null;
        } catch (e) { return null; }
    }

    // ── HELPERS DE HTML ──
    function _esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function _campo(label, key, value, prefixo) {
        return `
        <div class="rec-field">
            <label>${label}</label>
            <div class="rec-input-wrap">
                <span class="rec-prefix">${prefixo}</span>
                <input type="number" step="0.01" data-rec-key="${key}" class="input rec-input" value="${_n(value)}">
            </div>
        </div>`;
    }
    function _derivGbp(c) {
        return `Δ Shopify: <b>${fmtBRL(c.dShopifyBRL)}</b> · Δ Payoneer: <b>${fmtBRL(c.dPayoneerBRL)}</b><br>` +
               `<span style="color:var(--text-muted)">Parado em £ no fim: ${fmtGBP(c.laForaFimGBP)} ≈ ${fmtBRL(c.laForaFimGBP * c.fx)}</span>`;
    }
    function _derivBrl(c) {
        return `Δ Banco BR: <b>${fmtBRL(c.dBancoBRL)}</b>`;
    }
    function _bate(c) { return Math.abs(c.naoExplicado) < Math.max(100, Math.abs(c.lucro) * 0.05); }
    function _bridgeHtml(c) {
        return `
            <h3><i data-lucide="git-compare" style="width:16px;height:16px;vertical-align:-2px"></i> A Ponte: onde foi o lucro</h3>
            <table class="rec-bridge-table">
                <tr><td>Lucro contábil (BK)</td><td class="rec-val">${fmtBRL(c.lucro)}</td></tr>
                <tr class="rec-sub"><td>&nbsp;&nbsp;↳ virou caixa em: Shopify (pendente)</td><td class="rec-val">${fmtBRL(c.dShopifyBRL)}</td></tr>
                <tr class="rec-sub"><td>&nbsp;&nbsp;↳ virou caixa em: Payoneer</td><td class="rec-val">${fmtBRL(c.dPayoneerBRL)}</td></tr>
                <tr class="rec-sub"><td>&nbsp;&nbsp;↳ virou caixa em: <b>Banco BR</b></td><td class="rec-val"><b>${fmtBRL(c.dBancoBRL)}</b></td></tr>
                <tr class="rec-total"><td>= Aumento REAL de caixa (todas as contas)</td><td class="rec-val">${fmtBRL(c.aumentoTotalBRL)}</td></tr>
                <tr class="rec-minus"><td>− Chargeback / reembolso</td><td class="rec-val">${fmtBRL(c.chargebackBRL)}</td></tr>
                <tr class="rec-diff"><td><b>Diferença NÃO explicada</b><br><span style="font-size:.78rem;color:var(--text-muted)">Se for alta: venda não recebida, taxa/FX a mais, saída não registrada…</span></td><td class="rec-val"><b>${fmtBRL(c.naoExplicado)}</b></td></tr>
            </table>
            <div class="rec-verdict">
                ${_bate(c)
                    ? '✅ <b>Bate.</b> O lucro está distribuído entre as contas — não é prejuízo, é dinheiro que ainda não chegou no banco BR.'
                    : '⚠️ <b>Não fecha.</b> Há uma diferença que os saldos não explicam. Reveja payout, taxas reais (FX) e lançamentos do banco.'}
            </div>
            ${c.aumentoTotalBRL !== 0 ? `<div class="rec-insight">📊 Do caixa gerado, <b>${c.pctNoBanco.toFixed(0)}%</b> chegou no banco BR (${fmtBRL(c.dBancoBRL)}). O resto — ${fmtBRL(c.aumentoLaForaBRL)} — está retido em £ (Shopify/Payoneer) lá fora.</div>` : ''}
        `;
    }

    // ── RENDER ──
    function render() {
        const panel = document.getElementById('tab-reconciliation');
        if (!panel) return;
        const p = _periodoAtivo();
        const c = _calcular(p);
        const opts = state.periodos.map(pp => `<option value="${pp.id}" ${pp.id === state.periodoAtivo ? 'selected' : ''}>${_esc(pp.label)}</option>`).join('');

        panel.innerHTML = `
        <div class="section-header">
            <h2><i data-lucide="scale" style="width:20px;height:20px;vertical-align:-3px"></i> Conciliação de Caixa</h2>
            <div style="display:flex;gap:.5rem;align-items:center">
                <select id="rec-periodo" class="input" style="width:auto;min-width:150px">${opts}</select>
                <button id="rec-add-periodo" class="btn btn-secondary btn-sm"><i data-lucide="plus" style="width:14px;height:14px;vertical-align:-2px"></i> Novo mês</button>
            </div>
        </div>

        <p style="color:var(--text-muted);margin:-.25rem 0 1rem;max-width:840px">
            Digite os <b>saldos de cada conta no início e no fim do mês</b>. O lucro do BK deveria aumentar seu
            <b>caixa total</b> (Shopify + Payoneer + Banco). A ferramenta mostra quanto ficou <b>retido em £ lá fora</b>
            e destaca a diferença que <b>não tem explicação</b>.
        </p>

        <div style="display:flex;gap:.75rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap">
            <label style="color:var(--text-muted);font-size:.85rem">Câmbio GBP→BRL:</label>
            <input id="rec-fx" type="number" step="0.01" class="input" style="width:110px" value="${state.fxGbpBrl}">
            <span id="rec-fx-label" style="color:var(--text-muted);font-size:.8rem">£1 = ${fmtBRL(c.fx)}</span>
            <button id="rec-import-btn" class="btn btn-secondary btn-sm"><i data-lucide="upload" style="width:14px;height:14px;vertical-align:-2px"></i> Importar extrato (OFX/CSV)</button>
            <input id="rec-import-file" type="file" accept=".ofx,.csv,.txt" style="display:none">
        </div>

        <div class="rec-grid">
            <div class="rec-col rec-col-gbp">
                <h3>🇬🇧 Operação UK — saldos (£)</h3>
                ${_campo('Shopify pendente — início', 'shopifyIniGBP', p.shopifyIniGBP, '£')}
                ${_campo('Shopify pendente — fim', 'shopifyFimGBP', p.shopifyFimGBP, '£')}
                ${_campo('Payoneer — início', 'payoneerIniGBP', p.payoneerIniGBP, '£')}
                ${_campo('Payoneer — fim', 'payoneerFimGBP', p.payoneerFimGBP, '£')}
                <div class="rec-derived" id="rec-deriv-gbp">${_derivGbp(c)}</div>
            </div>
            <div class="rec-col rec-col-brl">
                <h3>🇧🇷 Brasil — saldo banco (R$)</h3>
                ${_campo('Banco BR — saldo início', 'bancoIniBRL', p.bancoIniBRL, 'R$')}
                ${_campo('Banco BR — saldo fim', 'bancoFimBRL', p.bancoFimBRL, 'R$')}
                ${_campo('Chargeback / reembolso (£)', 'chargebackGBP', p.chargebackGBP, '£')}
                ${_campo('Faturamento bruto (contexto, £)', 'vendasGBP', p.vendasGBP, '£')}
                <div class="rec-derived" id="rec-deriv-brl">${_derivBrl(c)}</div>
            </div>
        </div>

        <div class="rec-bk-row">
            ${_campo('Lucro contábil (BK Dashboard)', 'lucroBKBRL', p.lucroBKBRL, 'R$')}
            <button id="rec-puxar-bk" class="btn btn-secondary btn-sm" title="Puxar da última captura do BK"><i data-lucide="download-cloud" style="width:14px;height:14px;vertical-align:-2px"></i> Puxar do BK</button>
        </div>

        <div class="rec-bridge ${_bate(c) ? 'rec-ok' : 'rec-warn'}" id="rec-bridge">${_bridgeHtml(c)}</div>

        <div style="margin-top:1rem">
            <label style="color:var(--text-muted);font-size:.85rem;display:block;margin-bottom:.25rem">Observações do período</label>
            <textarea id="rec-obs" class="input" rows="2" style="width:100%;resize:vertical">${_esc(p.obs || '')}</textarea>
        </div>
        `;

        _wire();
        if (window.lucide) window.lucide.createIcons();
    }

    function _wire() {
        document.querySelectorAll('#tab-reconciliation [data-rec-key]').forEach(inp => {
            inp.addEventListener('input', (e) => {
                _periodoAtivo()[e.target.getAttribute('data-rec-key')] = _n(e.target.value);
                save(); _atualizarPonte();
            });
        });
        $('rec-fx')?.addEventListener('input', (e) => { state.fxGbpBrl = _n(e.target.value); save(); _atualizarPonte(); });
        $('rec-obs')?.addEventListener('input', (e) => { _periodoAtivo().obs = e.target.value; save(); });
        $('rec-periodo')?.addEventListener('change', (e) => { state.periodoAtivo = e.target.value; save(); render(); });
        $('rec-add-periodo')?.addEventListener('click', () => {
            const label = prompt('Nome do período (ex: Jul/2026):', _mesAtualLabel());
            if (label === null) return;
            const np = _novoPeriodo(label.trim() || _mesAtualLabel());
            state.periodos.push(np); state.periodoAtivo = np.id; save(); render();
        });
        $('rec-import-btn')?.addEventListener('click', () => $('rec-import-file')?.click());
        $('rec-import-file')?.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) _onImportFile(f); e.target.value = ''; });
        $('rec-puxar-bk')?.addEventListener('click', () => {
            const bk = _puxarLucroBK();
            if (typeof showToast === 'function') {
                showToast(bk ? 'Abra Capturas → Ver detalhes pra confirmar o lucro. (Mapeamento auto em breve.)' : 'Nenhuma captura do BK. Capture pela extensão primeiro.', 'info');
            }
        });
    }

    function _atualizarPonte() {
        const c = _calcular(_periodoAtivo());
        const bridge = $('rec-bridge');
        if (!bridge) { render(); return; }
        bridge.classList.toggle('rec-ok', _bate(c));
        bridge.classList.toggle('rec-warn', !_bate(c));
        bridge.innerHTML = _bridgeHtml(c);
        const dg = $('rec-deriv-gbp'); if (dg) dg.innerHTML = _derivGbp(c);
        const db = $('rec-deriv-brl'); if (db) db.innerHTML = _derivBrl(c);
        const fxl = $('rec-fx-label'); if (fxl) fxl.textContent = `£1 = ${fmtBRL(c.fx)}`;
        if (window.lucide) window.lucide.createIcons();
    }

    function init() {
        load();
        if (typeof EventBus !== 'undefined') {
            EventBus.on('tabChanged', (tab) => { if (tab === 'reconciliation') render(); });
        }
        if (document.querySelector('#tab-reconciliation.active')) render();
    }

    return { init, render, getState: () => state };
})();

if (typeof window !== 'undefined') window.ReconciliationModule = ReconciliationModule;
