// Shared helpers for Pages Functions

export function normalizeShop(shop) {
  if (!shop) return null;
  const d = shop.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(d)) return null;
  return d;
}

export async function validateHmac(url, secret) {
  if (!secret) return false;
  const params = new URLSearchParams(url.search);
  const hmac = params.get('hmac');
  if (!hmac) return false;
  params.delete('hmac');
  params.delete('signature');
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const message = sorted.map(([k, v]) => `${k}=${v}`).join('&');

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, hmac);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function htmlError(msg, debug) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>OAuth error</title>
    <body style="font-family:system-ui;padding:2rem;background:#0b0b12;color:#eaeaf0;max-width:640px;margin:auto">
    <h1 style="color:#f87171">Shopify OAuth error</h1>
    <p style="font-size:1.05rem">${escapeHtml(msg)}</p>
    ${debug ? `<pre style="background:#1a1a24;padding:1rem;border-radius:8px;overflow:auto;font-size:0.8rem">${escapeHtml(debug)}</pre>` : ''}
    <p><a href="/" style="color:#60a5fa"><i data-lucide="arrow-left" style="width:14px;height:14px;vertical-align:-2px"></i> Voltar ao app</a></p>`, {
    status: 400,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
