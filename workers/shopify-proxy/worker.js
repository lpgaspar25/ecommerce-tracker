/**
 * Shopify OAuth Partners + GraphQL Admin API Proxy
 *
 * Endpoints:
 *   GET  /oauth/start?shop=xxx.myshopify.com&return=<url>
 *        → redirects to Shopify authorize URL
 *   GET  /oauth/callback?code=...&shop=...&state=...&hmac=...
 *        → exchanges code for access_token, stores in KV, redirects to frontend
 *   POST /shop/graphql                 (headers: X-Shop-Session)
 *        → proxies GraphQL Admin API query
 *   GET  /shop/session?shop=...        (headers: X-Shop-Session)
 *        → returns whether session is valid + shop info
 *   POST /shop/disconnect              (headers: X-Shop-Session)
 *        → deletes token
 *
 * Bindings (wrangler.toml):
 *   KV: SHOPIFY_TOKENS
 *   Secrets: SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
 *   Vars: APP_URL, SCOPES, API_VERSION
 */

const DEFAULTS = {
  API_VERSION: '2026-01',
  SCOPES: 'read_orders,read_products,read_all_orders',
  APP_URL: 'https://app-calculadora-lucas.pages.dev',
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Shop-Session',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/oauth/start')    return await oauthStart(request, env, url);
      if (path === '/oauth/callback') return await oauthCallback(request, env, url);
      if (path === '/shop/session')   return await shopSession(request, env);
      if (path === '/shop/graphql')   return await shopGraphql(request, env);
      if (path === '/shop/disconnect')return await shopDisconnect(request, env);
      if (path === '/' || path === '') return json({ ok: true, service: 'shopify-proxy', version: DEFAULTS.API_VERSION });
      return json({ error: 'Unknown path: ' + path }, 404);
    } catch (err) {
      return json({ error: err.message || String(err) }, 500);
    }
  },
};

// ── OAuth: Start ─────────────────────────────────────────────

async function oauthStart(request, env, url) {
  const shop = normalizeShop(url.searchParams.get('shop'));
  const returnUrl = url.searchParams.get('return') || (env.APP_URL || DEFAULTS.APP_URL);

  if (!shop) {
    return json({ error: 'Missing ?shop=xxx.myshopify.com' }, 400);
  }

  const clientId = env.SHOPIFY_CLIENT_ID;
  if (!clientId) return json({ error: 'Worker missing SHOPIFY_CLIENT_ID secret' }, 500);

  const scopes = env.SCOPES || DEFAULTS.SCOPES;

  // state = random nonce + returnUrl (base64)
  const nonce = crypto.randomUUID();
  const state = btoa(JSON.stringify({ nonce, returnUrl, shop })).replace(/=+$/, '');

  // Store nonce in KV for 10 min for validation
  await env.SHOPIFY_TOKENS.put(`state:${nonce}`, JSON.stringify({ shop, returnUrl }), {
    expirationTtl: 600,
  });

  const redirectUri = getRedirectUri(request);
  const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', scopes);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  // Offline access is default; include grant_options[]=per-user for online tokens
  // authorizeUrl.searchParams.set('grant_options[]', 'per-user');

  return Response.redirect(authorizeUrl.toString(), 302);
}

// ── OAuth: Callback ──────────────────────────────────────────

async function oauthCallback(request, env, url) {
  const code = url.searchParams.get('code');
  const shop = normalizeShop(url.searchParams.get('shop'));
  const state = url.searchParams.get('state');
  const hmac = url.searchParams.get('hmac');

  if (!code || !shop || !state || !hmac) {
    return htmlError('Missing OAuth params');
  }

  // Validate HMAC
  const valid = await validateHmac(url, env.SHOPIFY_CLIENT_SECRET);
  if (!valid) return htmlError('Invalid HMAC signature');

  // Validate state
  let parsed;
  try { parsed = JSON.parse(atob(state)); } catch { return htmlError('Invalid state'); }
  const nonceData = await env.SHOPIFY_TOKENS.get(`state:${parsed.nonce}`);
  if (!nonceData) return htmlError('State expired or invalid');
  await env.SHOPIFY_TOKENS.delete(`state:${parsed.nonce}`);

  if (parsed.shop !== shop) return htmlError('Shop mismatch');

  // Exchange code for token
  const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      client_id: env.SHOPIFY_CLIENT_ID,
      client_secret: env.SHOPIFY_CLIENT_SECRET,
      code,
    }),
  });

  if (!tokenResp.ok) {
    const txt = await tokenResp.text();
    return htmlError(`Token exchange failed: ${txt}`);
  }

  const tokenJson = await tokenResp.json();
  const accessToken = tokenJson.access_token;
  if (!accessToken) return htmlError('No access_token in response');

  // Generate session ID to hand back to frontend (hides the real token)
  const sessionId = crypto.randomUUID() + '-' + Date.now().toString(36);
  await env.SHOPIFY_TOKENS.put(`session:${sessionId}`, JSON.stringify({
    shop,
    accessToken,
    scope: tokenJson.scope,
    createdAt: Date.now(),
  }), {
    // 1 year — refresh by reinstall if needed
    expirationTtl: 60 * 60 * 24 * 365,
  });

  // Also keep a shop → session mapping so disconnect/reconnect can cleanup
  await env.SHOPIFY_TOKENS.put(`shop:${shop}`, sessionId, {
    expirationTtl: 60 * 60 * 24 * 365,
  });

  // Redirect back to app with sessionId
  const returnUrl = parsed.returnUrl || env.APP_URL || DEFAULTS.APP_URL;
  const finalUrl = new URL(returnUrl);
  finalUrl.searchParams.set('shopify_session', sessionId);
  finalUrl.searchParams.set('shopify_shop', shop);
  return Response.redirect(finalUrl.toString(), 302);
}

// ── Session check ────────────────────────────────────────────

async function shopSession(request, env) {
  const session = await getSession(request, env);
  if (!session) return json({ ok: false, error: 'Invalid or missing session' }, 401);

  // Fetch shop name via GraphQL
  try {
    const apiVersion = env.API_VERSION || DEFAULTS.API_VERSION;
    const resp = await fetch(`https://${session.shop}/admin/api/${apiVersion}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': session.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `{ shop { name currencyCode ianaTimezone myshopifyDomain primaryDomain { url } } }`,
      }),
    });
    const data = await resp.json();
    return json({
      ok: true,
      shop: session.shop,
      scope: session.scope,
      info: data?.data?.shop || null,
    });
  } catch (err) {
    return json({ ok: true, shop: session.shop, scope: session.scope, info: null, warning: err.message });
  }
}

// ── GraphQL proxy ────────────────────────────────────────────

async function shopGraphql(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST required' }, 405);
  const session = await getSession(request, env);
  if (!session) return json({ error: 'Invalid or missing session' }, 401);

  const body = await request.text();
  const apiVersion = env.API_VERSION || DEFAULTS.API_VERSION;

  const resp = await fetch(`https://${session.shop}/admin/api/${apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': session.accessToken,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body,
  });

  const respBody = await resp.text();
  return new Response(respBody, {
    status: resp.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// ── Disconnect ───────────────────────────────────────────────

async function shopDisconnect(request, env) {
  const sessionId = request.headers.get('X-Shop-Session');
  if (!sessionId) return json({ error: 'Missing X-Shop-Session' }, 400);
  const raw = await env.SHOPIFY_TOKENS.get(`session:${sessionId}`);
  if (raw) {
    const s = JSON.parse(raw);
    await env.SHOPIFY_TOKENS.delete(`shop:${s.shop}`);
  }
  await env.SHOPIFY_TOKENS.delete(`session:${sessionId}`);
  return json({ ok: true });
}

// ── Helpers ──────────────────────────────────────────────────

async function getSession(request, env) {
  const sessionId = request.headers.get('X-Shop-Session') || new URL(request.url).searchParams.get('session');
  if (!sessionId) return null;
  const raw = await env.SHOPIFY_TOKENS.get(`session:${sessionId}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function normalizeShop(shop) {
  if (!shop) return null;
  const d = shop.replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase().trim();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(d)) return null;
  return d;
}

function getRedirectUri(request) {
  const u = new URL(request.url);
  return `${u.origin}/oauth/callback`;
}

async function validateHmac(url, secret) {
  if (!secret) return false;
  const params = new URLSearchParams(url.search);
  const hmac = params.get('hmac');
  params.delete('hmac');
  params.delete('signature');
  // Sort lexicographically and rebuild
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

function htmlError(msg) {
  return new Response(`<!doctype html><meta charset="utf-8"><title>OAuth error</title>
    <body style="font-family:system-ui;padding:2rem;background:#111;color:#eee">
    <h1 style="color:#f87171">Shopify OAuth error</h1>
    <p>${escapeHtml(msg)}</p>
    <p><a href="javascript:history.back()" style="color:#60a5fa">Voltar</a></p>`, {
    status: 400,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
