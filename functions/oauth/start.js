import { normalizeShop } from '../_shared.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const shop = normalizeShop(url.searchParams.get('shop'));
  const returnUrl = url.searchParams.get('return') || url.origin + '/';

  // User-provided credentials override env defaults
  const clientId = url.searchParams.get('client_id') || env.SHOPIFY_CLIENT_ID;
  const clientSecret = url.searchParams.get('client_secret') || env.SHOPIFY_CLIENT_SECRET;

  if (!shop) {
    return new Response('Missing ?shop=xxx.myshopify.com', { status: 400 });
  }
  if (!clientId) {
    return new Response('Missing client_id (pass ?client_id=... or set env var)', { status: 400 });
  }
  if (!clientSecret) {
    return new Response('Missing client_secret (pass ?client_secret=... or set env var)', { status: 400 });
  }
  if (!env.SHOPIFY_TOKENS) {
    return new Response('Missing SHOPIFY_TOKENS KV binding', { status: 500 });
  }

  const scopes = url.searchParams.get('scopes') || env.SCOPES || 'read_orders,read_products,read_all_orders';
  const nonce = crypto.randomUUID();

  // Encode the minimal state client<->Shopify sees
  const state = btoa(JSON.stringify({ nonce, shop })).replace(/=+$/, '');

  // Store sensitive per-install data (returnUrl + credentials for callback) in KV, keyed by nonce
  await env.SHOPIFY_TOKENS.put(`state:${nonce}`, JSON.stringify({
    shop,
    returnUrl,
    clientId,
    clientSecret,
  }), {
    expirationTtl: 600,
  });

  const redirectUri = `${url.origin}/oauth/callback`;
  const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('scope', scopes);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);

  return Response.redirect(authorizeUrl.toString(), 302);
}
