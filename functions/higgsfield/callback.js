import { callbackUrl, clientId, saveSession } from './_shared.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');
  if (!state || !env.SHOPIFY_TOKENS) return errorRedirect('missing_oauth_parameters');

  // KV replica entre regiões pode levar alguns instantes para enxergar o state
  // salvo no início do OAuth. Tentar novamente evita falso "state expirado".
  const raw = await getStateWithRetry(env, state);
  if (!raw) return errorRedirect('expired_oauth_state');
  const stateData = JSON.parse(raw);
  if (oauthError) {
    await env.SHOPIFY_TOKENS.delete(`higgsfield:state:${state}`);
    return errorRedirect(`provider_${safeErrorCode(oauthError)}`, stateData.returnUrl);
  }
  if (!code) return errorRedirect('missing_oauth_code', stateData.returnUrl);
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
    const failure = await response.text();
    let providerCode = 'exchange_failed';
    try { providerCode = safeErrorCode(JSON.parse(failure).error || providerCode); } catch {}
    console.error('[Higgsfield OAuth] token exchange failed', response.status, providerCode);
    return errorRedirect(`token_${providerCode}`, stateData.returnUrl);
  }
  const token = await response.json();
  if (!token.access_token) return errorRedirect('missing_access_token', stateData.returnUrl);
  await env.SHOPIFY_TOKENS.delete(`higgsfield:state:${state}`);
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

async function getStateWithRetry(env, state) {
  const key = `higgsfield:state:${state}`;
  for (const delay of [0, 250, 700, 1400]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    const raw = await env.SHOPIFY_TOKENS.get(key);
    if (raw) return raw;
  }
  return null;
}

function safeErrorCode(value) {
  return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 60) || 'unknown';
}

function errorRedirect(code, returnUrl = 'https://app-calculadora-lucas.pages.dev/') {
  const target = new URL(returnUrl);
  target.searchParams.set('higgsfield_error', code);
  return Response.redirect(target.toString(), 302);
}
