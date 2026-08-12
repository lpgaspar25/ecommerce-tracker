import { allowedReturnUrl, callbackUrl, clientId, randomBase64Url, sha256Base64Url } from './_shared.js';

export async function onRequestGet({ request, env }) {
  if (!env.SHOPIFY_TOKENS) return new Response('OAuth session storage is unavailable', { status: 500 });
  const url = new URL(request.url);
  const returnUrl = allowedReturnUrl(url.searchParams.get('return'));
  const state = randomBase64Url(24);
  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  await env.SHOPIFY_TOKENS.put(`higgsfield:state:${state}`, JSON.stringify({
    verifier, returnUrl, createdAt: Date.now(),
  }), { expirationTtl: 600 });

  const authorize = new URL('https://mcp.higgsfield.ai/oauth2/authorize');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId(env));
  authorize.searchParams.set('redirect_uri', callbackUrl());
  authorize.searchParams.set('scope', 'openid email offline_access');
  // OIDC exige consentimento explícito quando offline_access é solicitado.
  // O cliente MCP oficial segue a mesma regra.
  authorize.searchParams.set('prompt', 'consent');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('resource', 'https://mcp.higgsfield.ai/mcp');
  return Response.redirect(authorize.toString(), 302);
}
