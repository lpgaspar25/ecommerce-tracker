import { json } from '../cloud/_shared.js';

// Proxy same-origin para a Bot API do Telegram. O navegador nunca vê o token:
// ele fica como secret no Cloudflare.
//   Secret : env.TELEGRAM_BOT_TOKEN   (wrangler pages secret put TELEGRAM_BOT_TOKEN)
//   Var    : env.TELEGRAM_CHAT_ID     ([vars] no wrangler.toml — opcional, default)
//
// Ações aceitas (POST JSON):
//   { action:'sendMessage', chat_id, text, parse_mode? }   → envia mensagem
//   { action:'getMe' }                                      → valida o bot
//   { action:'getUpdates' }                                 → descobre chat_id
//
// Sem TELEGRAM_BOT_TOKEN configurado, responde 503 (o cliente cai no modo
// direto quando tem token local). Nada aqui quebra o resto do app.

const TG = 'https://api.telegram.org';

export async function onRequest({ request, env }) {
  if (request.method === 'GET') {
    // healthcheck simples (sem vazar o token)
    return json({ ok: true, configured: !!env.TELEGRAM_BOT_TOKEN });
  }
  if (request.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return json({ error: 'Telegram não configurado no servidor' }, 503);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Corpo inválido' }, 400);

  const action = String(body.action || 'sendMessage');

  try {
    if (action === 'getMe') {
      return json(await tg(token, 'getMe'));
    }
    if (action === 'getUpdates') {
      return json(await tg(token, 'getUpdates', { timeout: 0, allowed_updates: JSON.stringify(['message', 'channel_post', 'my_chat_member']) }));
    }
    if (action === 'sendMessage') {
      const chatId = String(body.chat_id || env.TELEGRAM_CHAT_ID || '').trim();
      const text = String(body.text || '').slice(0, 4096);
      if (!chatId || !text) return json({ error: 'chat_id e text são obrigatórios' }, 400);
      const data = await tg(token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: body.parse_mode || 'HTML',
        disable_web_page_preview: true,
      });
      return json(data, data && data.ok === false ? 502 : 200);
    }
    return json({ error: 'Ação desconhecida' }, 400);
  } catch (e) {
    return json({ error: (e && e.message) || 'Falha ao falar com o Telegram' }, 502);
  }
}

async function tg(token, method, payload) {
  const resp = await fetch(`${TG}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const data = await resp.json().catch(() => ({ ok: false, description: `HTTP ${resp.status}` }));
  return data;
}
