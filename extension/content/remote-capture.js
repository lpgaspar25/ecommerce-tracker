/* =========================================================
   ETracker — Captura assistida de BK Dashboard / Payoneer
   Roda em bkdash.com.br e *.payoneer.com.
   Renderiza um botão flutuante. Ao clicar:
     1. Extrai snapshot da página (URL, título, tabelas, números com label)
     2. Empurra pro chrome.storage (queue 'etracker_ext_queue')
     3. App-bridge no app puxa quando você abrir o ETracker
   ========================================================= */

(function () {
    if (window.__etrackerCaptureLoaded) return;
    window.__etrackerCaptureLoaded = true;

    const QUEUE_KEY = 'etracker_ext_queue';

    // ── Identifica a plataforma pela URL ─────────────────────
    const host = location.hostname;
    let plataforma = 'desconhecida';
    if (/bkdash\.com\.br/i.test(host)) plataforma = 'bkdash';
    else if (/payoneer\.com/i.test(host)) plataforma = 'payoneer';
    else if (/flowborder\.com/i.test(host)) plataforma = 'flowborder';
    else if (/wiio\.io/i.test(host)) plataforma = 'wiio';

    const PLAT_LABEL = { bkdash: 'BK', payoneer: 'Payoneer', flowborder: 'Flowborder', wiio: 'Wiio' };

    // ── Detecta moeda dominante na página ────────────────────
    function detectarMoeda() {
        const txt = (document.body.innerText || '').slice(0, 50000);
        const counts = {
            GBP: (txt.match(/£|GBP\b/g) || []).length,
            EUR: (txt.match(/€|EUR\b/g) || []).length,
            USD: (txt.match(/\$|USD\b/g) || []).length,
            BRL: (txt.match(/R\$|BRL\b/g) || []).length,
        };
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        return top && top[1] > 0 ? top[0] : 'desconhecida';
    }

    // ── Extrai TODAS as tabelas visíveis em formato estruturado
    function extrairTabelas() {
        const tabelas = [];
        document.querySelectorAll('table').forEach((t, idx) => {
            const headers = [...t.querySelectorAll('thead th, thead td')].map(c => c.innerText.trim());
            const rows = [];
            t.querySelectorAll('tbody tr').forEach(tr => {
                const cells = [...tr.querySelectorAll('td, th')].map(c => c.innerText.trim());
                if (cells.length) rows.push(cells);
            });
            if (rows.length || headers.length) {
                tabelas.push({ id: `table-${idx}`, headers, rows: rows.slice(0, 1000) });
            }
        });
        return tabelas;
    }

    // ── Extrai valores monetários com o LABEL mais próximo ───
    function extrairValoresComLabel() {
        const moneyRegex = /(?:R\$|£|€|\$|GBP|EUR|USD|BRL)\s*[\d.,]+(?:\.\d{1,2})?/g;
        const results = [];
        const visit = (el) => {
            if (!el || el.nodeType !== 1) return;
            // Skip script/style/svg
            const tag = el.tagName?.toLowerCase();
            if (tag === 'script' || tag === 'style' || tag === 'svg' || tag === 'noscript') return;
            // For leaf-ish elements with text
            if (el.children.length <= 3) {
                const text = el.innerText?.slice(0, 200) || '';
                const matches = text.match(moneyRegex);
                if (matches) {
                    // Pega label do ancestral mais próximo (parent ou sibling anterior)
                    const moneyTest = /(?:R\$|£|€|\$|GBP|EUR|USD|BRL)\s*[\d.,]+/;
                    let label = '';
                    let cur = el.previousElementSibling;
                    while (cur && !label) {
                        const t = cur.innerText?.trim() || '';
                        if (t && t.length < 80 && !moneyTest.test(t)) { label = t; break; }
                        cur = cur.previousElementSibling;
                    }
                    if (!label && el.parentElement) {
                        const parentText = el.parentElement.innerText || '';
                        const firstLine = parentText.split('\n')[0]?.trim() || '';
                        if (firstLine && firstLine.length < 80) label = firstLine;
                    }
                    matches.forEach(valor => results.push({
                        valor: valor.trim(),
                        label: label.slice(0, 80),
                        tag: tag,
                    }));
                }
            }
            for (const child of el.children) visit(child);
        };
        visit(document.body);
        // Dedupe valores idênticos com mesmo label
        const seen = new Set();
        return results.filter(r => {
            const k = `${r.valor}|${r.label}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
        }).slice(0, 100);
    }

    // ── Extrai os principais ranges de data visíveis ─────────
    function extrairDatas() {
        const datePatterns = [
            /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
            /\b\d{4}-\d{2}-\d{2}\b/g,
            /\b\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s+\d{2,4}\b/gi,
            /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}\b/g,
        ];
        const text = document.body.innerText.slice(0, 30000);
        const found = new Set();
        for (const re of datePatterns) {
            (text.match(re) || []).forEach(d => found.add(d));
        }
        return Array.from(found).slice(0, 30);
    }

    // ── Snapshot completo ────────────────────────────────────
    function snapshot() {
        return {
            tipo: 'remote-capture',
            plataforma,
            url: location.href,
            titulo: document.title,
            moeda: detectarMoeda(),
            capturadoEm: new Date().toISOString(),
            tabelas: extrairTabelas(),
            valoresComLabel: extrairValoresComLabel(),
            datasVisiveis: extrairDatas(),
            // Texto bruto reduzido (pra IA conseguir interpretar depois)
            textoResumo: document.body.innerText?.slice(0, 12000) || '',
        };
    }

    // ── Empurra pra fila do extension storage ────────────────
    function enviar(snap) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(QUEUE_KEY, (data) => {
                const queue = Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
                queue.push(snap);
                chrome.storage.local.set({ [QUEUE_KEY]: queue }, () => {
                    if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
                    else resolve(queue.length);
                });
            });
        });
    }

    // ── UI: botão flutuante ──────────────────────────────────
    function montarOverlay() {
        const overlay = document.createElement('div');
        overlay.id = 'etracker-capture-overlay';
        overlay.innerHTML = `
            <button id="etracker-cap-btn" title="Capturar dados desta página pro ETracker">
                <span class="et-cap-icon">📥</span>
                <span class="et-cap-label">Capturar p/ ETracker</span>
                <span class="et-cap-plat">${PLAT_LABEL[plataforma] || '?'}</span>
            </button>
            <div id="etracker-cap-feedback" style="display:none"></div>
        `;
        document.documentElement.appendChild(overlay);

        const btn = overlay.querySelector('#etracker-cap-btn');
        const fb = overlay.querySelector('#etracker-cap-feedback');

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            const original = btn.querySelector('.et-cap-label').textContent;
            btn.querySelector('.et-cap-label').textContent = 'Capturando…';
            try {
                const snap = snapshot();
                const qLen = await enviar(snap);
                fb.style.display = 'block';
                fb.className = 'et-cap-success';
                fb.textContent = `✓ Snapshot ${qLen} salvo na fila. Abra o ETracker pra processar.`;
                btn.querySelector('.et-cap-label').textContent = '✓ Capturado';
                setTimeout(() => {
                    btn.querySelector('.et-cap-label').textContent = original;
                    btn.disabled = false;
                    fb.style.display = 'none';
                }, 4500);
            } catch (err) {
                fb.style.display = 'block';
                fb.className = 'et-cap-error';
                fb.textContent = `❌ Erro: ${err.message || err}`;
                btn.querySelector('.et-cap-label').textContent = original;
                btn.disabled = false;
                setTimeout(() => { fb.style.display = 'none'; }, 6000);
            }
        });
    }

    // ── AUTO-CAPTURA: 1x por dia por plataforma, ao visitar logado ──
    const AUTOCAP_KEY = 'etracker_autocap_log';
    function _hojeStr() { return new Date().toISOString().slice(0, 10); }

    function autoCapturarSePreciso() {
        if (plataforma === 'desconhecida') return;
        chrome.storage.local.get(AUTOCAP_KEY, (data) => {
            const log = data[AUTOCAP_KEY] || {};
            if (log[plataforma] === _hojeStr()) return; // já capturou hoje
            const snap = snapshot();
            // Só captura se a página tem conteúdo real (logado, dados carregados).
            // Evita capturar tela de login / página vazia.
            if ((snap.valoresComLabel || []).length < 3 && (snap.tabelas || []).length < 1) return;
            enviar(snap).then(() => {
                log[plataforma] = _hojeStr();
                chrome.storage.local.set({ [AUTOCAP_KEY]: log });
                const fb = document.getElementById('etracker-cap-feedback');
                if (fb) {
                    fb.style.display = 'block';
                    fb.className = 'et-cap-success';
                    fb.textContent = `✓ Captura automática do dia enviada (${PLAT_LABEL[plataforma]})`;
                    setTimeout(() => { fb.style.display = 'none'; }, 5000);
                }
            }).catch(() => {});
        });
    }

    // Atrasa um pouco pra DOM da SPA carregar
    function _boot() {
        montarOverlay();
        // SPA demora a popular os dados — espera mais pra auto-captura
        setTimeout(autoCapturarSePreciso, 6000);
    }
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(_boot, 1500);
    } else {
        window.addEventListener('DOMContentLoaded', () => setTimeout(_boot, 1500));
    }
})();
