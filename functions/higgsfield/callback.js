import { callbackUrl, clientId, saveSession } from './_shared.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || !env.SHOPIFY_TOKENS) return errorRedirect('missing_oauth_parameters');

  const raw = await env.SHOPIFY_TOKENS.get(`higgsfield:state:${state}`);
  if (!raw) return errorRedirect('expired_oauth_state');
  await env.SHOPIFY_TOKENS.delete(`higgsfield:state:${state}`);
  const stateData = JSON.parse(raw);
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: callbackUrl(),
    client_id: clientId(env),
    code_verifier: stateData.verifier,
    resource: 'https://mcp.higgsfield.ai/mcp',
  });
  const response = await fetch('https://mcp.higgsfield.ai/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: form,
  });
  if (!response.ok) {
    console.error('[Higgsfield OAuth] token exchange failed', response.status, (await response.text()).slice(0, 300));
    return errorRedirect('token_exchange_failed', stateData.returnUrl);
  }
  const token = await response.json();
  if (!token.access_token) return errorRedirect('missing_access_token', stateData.returnUrl);
  const sessionId = `${crypto.randomUUID()}-${Date.now().toString(36)}`;
  await saveSession(env, sessionId, {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || '',
    idToken: token.id_token || '',
    scope: token.scope || 'openid email offline_access',
    expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000,
    createdAt: Date.now(),
  });
  const target = new URL(stateData.returnUrl || 'https://app-calculadora-lucas.pages.dev/');
  target.searchParams.set('higgsfield_session', sessionId);
  target.searchParams.set('higgsfield_connected', '1');
  return Response.redirect(target.toString(), 302);
}

function errorRedirect(code, returnUrl = 'https://app-calculadora-lucas.pages.dev/') {
  const target = new URL(returnUrl);
  target.searchParams.set('higgsfield_error', code);
  return Response.redirect(target.toString(), 302);
}
