import { normalizeShop, validateHmac, htmlError } from '../_shared.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const shop = normalizeShop(url.searchParams.get('shop'));
  const state = url.searchParams.get('state');
  const hmac = url.searchParams.get('hmac');

  if (!code || !shop || !state || !hmac) return htmlError('Missing OAuth params');

  // Decode state (contains only nonce + shop; real credentials are in KV)
  let parsed;
  try { parsed = JSON.parse(atob(state)); } catch { return htmlError('Invalid state'); }

  const stateDataRaw = await env.SHOPIFY_TOKENS.get(`state:${parsed.nonce}`);
  if (!stateDataRaw) return htmlError('State expired or invalid (> 10min or already consumed)');
  await env.SHOPIFY_TOKENS.delete(`state:${parsed.nonce}`);

  const stateData = JSON.parse(stateDataRaw);
  if (stateData.shop !== shop) return htmlError('Shop mismatch');

  const clientId = stateData.clientId || env.SHOPIFY_CLIENT_ID;
  const clientSecret = stateData.clientSecret || env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return htmlError('Server misconfigured: missing client credentials');

  // Validate HMAC using the client_secret that was used in the original request
  const valid = await validateHmac(url, clientSecret);
  if (!valid) return htmlError('Invalid HMAC signature (client_secret mismatch?)');

  const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  if (!tokenResp.ok) {
    const txt = await tokenResp.text();
    return htmlError('Token exchange failed', txt);
  }

  const tokenJson = await tokenResp.json();
  const accessToken = tokenJson.access_token;
  if (!accessToken) return htmlError('No access_token in response', JSON.stringify(tokenJson));

  const sessionId = crypto.randomUUID() + '-' + Date.now().toString(36);
  await env.SHOPIFY_TOKENS.put(`session:${sessionId}`, JSON.stringify({
    shop,
    accessToken,
    scope: tokenJson.scope,
    createdAt: Date.now(),
  }), {
    expirationTtl: 60 * 60 * 24 * 365,
  });
  await env.SHOPIFY_TOKENS.put(`shop:${shop}`, sessionId, {
    expirationTtl: 60 * 60 * 24 * 365,
  });

  const returnUrl = stateData.returnUrl || url.origin + '/';
  const finalUrl = new URL(returnUrl);
  finalUrl.searchParams.set('shopify_session', sessionId);
  finalUrl.searchParams.set('shopify_shop', shop);
  return Response.redirect(finalUrl.toString(), 302);
}
