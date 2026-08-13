#!/usr/bin/env node
'use strict';
/* ==============================================================
   Codex Image Server — ponte local entre o app (navegador) e a
   geração de imagem da OpenAI usando a SUA conta ChatGPT (Codex).

   Fluxo:
     1) Você faz login no Codex com a conta ChatGPT  → grava tokens
        em ~/.codex/auth.json (auth_mode = "chatgpt").
     2) `node server.js`  → sobe este serviço em http://localhost:8791.
     3) O botão "Gerar" do app manda { prompt, images } pra cá.
     4) O servidor gera a imagem (Responses API + tool image_generation).
     5) A imagem é salva em ./saidas/ E devolvida pro app (base64).

   SEM dependências: usa só módulos nativos do Node 18+ (fetch global).

   AVISO: o caminho "conta ChatGPT" usa um endpoint INTERNO/NÃO-OFICIAL
   da OpenAI (o mesmo que o Codex usa). Pode parar de funcionar quando a
   OpenAI mudar, e é zona cinza de ToS da sua conta. Se ele falhar, o
   servidor cai automaticamente pro caminho oficial com OPENAI_API_KEY
   (esse custa por imagem). Você escolhe.
   ============================================================== */

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ── Config (tudo sobrescrevível por variável de ambiente) ──
const PORT = Number(process.env.PORT) || 8791;
const AUTH_PATH = process.env.CODEX_AUTH || path.join(os.homedir(), '.codex', 'auth.json');
const OUT_DIR = process.env.OUT_DIR || path.join(__dirname, 'saidas');
const MOCK = process.env.MOCK === '1';

// Endpoint interno do Codex (conta ChatGPT). É aqui que você ajusta se a
// sua versão do Codex usar outra base — veja o README.
const CHATGPT_URL = process.env.CHATGPT_URL || 'https://chatgpt.com/backend-api/codex/responses';
const CHATGPT_MODEL = process.env.CHATGPT_MODEL || 'gpt-5.6-terra';
// Caminho oficial (fallback), cobra por imagem.
const API_URL = process.env.API_URL || 'https://api.openai.com/v1/responses';
const API_MODEL = process.env.API_MODEL || 'gpt-5';

// PNG 1024x1024 cinza — usado só em MOCK=1 (testar o encanamento sem gastar).
const MOCK_PNG_B64 = (() => {
    // gera um PNG cinza minúsculo em runtime (evita colar um base64 gigante)
    const w = 8, h = 8;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 90; raw[o + 1] = 92; raw[o + 2] = 86; } }
    const zlib = require('zlib');
    const idat = zlib.deflateSync(raw);
    const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const t = Buffer.from(type); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0); return Buffer.concat([len, t, data, crc]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]).toString('base64');
})();
function crc32(buf) { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c; }

// ── Credenciais ──
function lerAuth() {
    try {
        const d = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
        return {
            authMode: d.auth_mode || (d.OPENAI_API_KEY ? 'apikey' : ''),
            accessToken: d?.tokens?.access_token || '',
            accountId: d?.tokens?.account_id || '',
            apiKey: d.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
        };
    } catch {
        return { authMode: '', accessToken: '', accountId: '', apiKey: process.env.OPENAI_API_KEY || '' };
    }
}

// ── Tamanho suportado pela tool image_generation ──
function normalizarSize(size) {
    const ok = ['1024x1024', '1536x1024', '1024x1536', 'auto'];
    if (ok.includes(size)) return size;
    if (!size || !/^\d+x\d+$/.test(size)) return '1024x1024';
    const [l, a] = size.split('x').map(Number);
    if (l > a * 1.2) return '1536x1024';
    if (a > l * 1.2) return '1024x1536';
    return '1024x1024';
}

// Monta o corpo da Responses API. `images` = [{b64, mime}].
function montarBody(model, prompt, images, size, format) {
    const content = [{ type: 'input_text', text: prompt || 'Generate an image.' }];
    (images || []).forEach(im => {
        if (im && im.b64) content.push({ type: 'input_image', image_url: `data:${im.mime || 'image/png'};base64,${im.b64}` });
    });
    return {
        model,
        input: [{ role: 'user', content }],
        tools: [{ type: 'image_generation', size: normalizarSize(size), output_format: (format || 'png') }],
        tool_choice: 'auto',
        stream: false,
    };
}

// Extrai o base64 da imagem de várias formas possíveis da resposta.
function extrairImagem(data) {
    if (!data) return null;
    const out = data.output || data.response?.output || [];
    for (const item of out) {
        if (item?.type === 'image_generation_call' && item.result) return item.result;
        if (Array.isArray(item?.content)) {
            for (const c of item.content) {
                if (c?.type === 'output_image' && (c.result || c.image_base64)) return c.result || c.image_base64;
                if (c?.image_url && /^data:image\/[^;]+;base64,/.test(c.image_url)) return c.image_url.split(',')[1];
            }
        }
    }
    // formatos alternativos
    if (data?.data?.[0]?.b64_json) return data.data[0].b64_json;
    return null;
}

async function chamar(url, headers, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
    const txt = await r.text();
    let data; try { data = JSON.parse(txt); } catch { data = null; }
    if (!r.ok) { const e = new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`); e.status = r.status; throw e; }
    return data;
}

// Caminho 1 — conta ChatGPT (assinatura, experimental/não-oficial).
async function gerarViaChatGPT(auth, prompt, images, size, format) {
    const headers = {
        'Authorization': 'Bearer ' + auth.accessToken,
        'chatgpt-account-id': auth.accountId,
        'OpenAI-Beta': 'responses=experimental',
        'originator': 'codex_cli_rs',
        'session_id': crypto.randomUUID(),
        'User-Agent': 'codex-image-server',
    };
    const data = await chamar(CHATGPT_URL, headers, montarBody(CHATGPT_MODEL, prompt, images, size, format));
    const b64 = extrairImagem(data);
    if (!b64) throw new Error('resposta sem imagem (a conta ChatGPT pode não liberar image_generation por aqui)');
    return b64;
}

// Caminho 2 — API key oficial (cobra por imagem).
async function gerarViaApiKey(auth, prompt, images, size, format) {
    const data = await chamar(API_URL, { 'Authorization': 'Bearer ' + auth.apiKey }, montarBody(API_MODEL, prompt, images, size, format));
    const b64 = extrairImagem(data);
    if (!b64) throw new Error('resposta sem imagem');
    return b64;
}

async function gerar({ prompt, images, size, format }) {
    if (MOCK) { await new Promise(r => setTimeout(r, 300)); return { b64: MOCK_PNG_B64, via: 'mock' }; }
    const auth = lerAuth();
    // Prioriza a assinatura (intenção do usuário); cai pra API key se falhar.
    if (auth.accessToken) {
        try { return { b64: await gerarViaChatGPT(auth, prompt, images, size, format), via: 'chatgpt' }; }
        catch (e) { console.warn('[codex] caminho ChatGPT falhou:', e.message); if (!auth.apiKey) throw e; }
    }
    if (auth.apiKey) return { b64: await gerarViaApiKey(auth, prompt, images, size, format), via: 'apikey' };
    throw new Error('Sem credencial. Faça login no Codex com a conta ChatGPT, ou defina OPENAI_API_KEY.');
}

// ── HTTP ──
function cors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) { cors(res); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

    if (req.method === 'GET' && req.url === '/status') {
        const a = lerAuth();
        return json(res, 200, { ok: true, mock: MOCK, authMode: a.authMode, temTokenChatGPT: !!a.accessToken, temApiKey: !!a.apiKey, saidas: OUT_DIR });
    }

    if (req.method === 'POST' && req.url === '/gerar') {
        let body = '';
        req.on('data', c => { body += c; if (body.length > 60 * 1024 * 1024) req.destroy(); });
        req.on('end', async () => {
            let payload; try { payload = JSON.parse(body || '{}'); } catch { return json(res, 400, { ok: false, error: 'JSON inválido' }); }
            try {
                const { b64, via } = await gerar(payload);
                // salva local
                fs.mkdirSync(OUT_DIR, { recursive: true });
                const nome = `modelo-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
                fs.writeFileSync(path.join(OUT_DIR, nome), Buffer.from(b64, 'base64'));
                console.log(`[codex] gerada via ${via} → ${nome}`);
                return json(res, 200, { ok: true, b64, mime: 'image/png', arquivo: nome, via });
            } catch (e) {
                console.error('[codex] erro:', e.message);
                return json(res, 502, { ok: false, error: e.message });
            }
        });
        return;
    }

    json(res, 404, { ok: false, error: 'rota não encontrada' });
});

server.listen(PORT, '127.0.0.1', () => {
    const a = lerAuth();
    console.log(`\n  Codex Image Server em http://localhost:${PORT}`);
    console.log(`  saídas: ${OUT_DIR}`);
    console.log(`  auth: ${MOCK ? 'MOCK (não gera de verdade)' : (a.accessToken ? 'conta ChatGPT ✓' : (a.apiKey ? 'API key ✓' : 'NENHUMA — faça login no Codex'))}`);
    console.log(`  teste: curl http://localhost:${PORT}/status\n`);
});
