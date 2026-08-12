const HIGGSFIELD_ISSUER = 'https://mcp.higgsfield.ai';
const HIGGSFIELD_MCP = `${HIGGSFIELD_ISSUER}/mcp`;
const HIGGSFIELD_TOKEN = `${HIGGSFIELD_ISSUER}/oauth2/token`;
const HIGGSFIELD_CALLBACK = 'https://app-calculadora-lucas.pages.dev/higgsfield/callback';
const SESSION_TTL = 60 * 60 * 24 * 365;

export function allowedReturnUrl(raw) {
  try {
    const url = new URL(raw || 'https://app-calculadora-lucas.pages.dev/');
    const local = (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      && (url.protocol === 'http:' || url.protocol === 'https:');
    const pages = url.protocol === 'https:'
      && (url.hostname === 'app-calculadora-lucas.pages.dev'
        || url.hostname.endsWith('.app-calculadora-lucas.pages.dev'));
    if (!local && !pages) return 'https://app-calculadora-lucas.pages.dev/';
    url.searchParams.delete('higgsfield_session');
    url.searchParams.delete('higgsfield_connected');
    url.searchParams.delete('higgsfield_error');
    return url.toString();
  } catch {
    return 'https://app-calculadora-lucas.pages.dev/';
  }
}

export function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const permitido = origin === 'http://127.0.0.1:8765'
    || origin === 'http://localhost:8765'
    || /^https:\/\/([a-z0-9-]+\.)?app-calculadora-lucas\.pages\.dev$/i.test(origin);
  return {
    'Access-Control-Allow-Origin': permitido ? origin : 'https://app-calculadora-lucas.pages.dev',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Higgsfield-Session',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(request) },
  });
}

export function options(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function randomBase64Url(bytes = 32) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  let raw = '';
  arr.forEach(byte => { raw += String.fromCharCode(byte); });
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let raw = '';
  new Uint8Array(digest).forEach(byte => { raw += String.fromCharCode(byte); });
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function clientId(env) {
  return env.HIGGSFIELD_CLIENT_ID || '6csAgskUhQRlFByK';
}

export function callbackUrl() {
  return HIGGSFIELD_CALLBACK;
}

export function sessionIdFrom(request) {
  return (request.headers.get('X-Higgsfield-Session') || '').trim();
}

export async function loadSession(env, sessionId) {
  if (!sessionId || !env.SHOPIFY_TOKENS) return null;
  const raw = await env.SHOPIFY_TOKENS.get(`higgsfield:session:${sessionId}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export async function saveSession(env, sessionId, session) {
  await env.SHOPIFY_TOKENS.put(`higgsfield:session:${sessionId}`, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });
}

export async function refreshSession(env, sessionId, session) {
  if (!session) return null;
  if (!session.expiresAt || session.expiresAt > Date.now() + 60_000) return session;
  if (!session.refreshToken) return null;
  const form = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: session.refreshToken,
    client_id: clientId(env),
    resource: HIGGSFIELD_MCP,
  });
  const response = await fetch(HIGGSFIELD_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: form,
  });
  if (!response.ok) return null;
  const token = await response.json();
  const next = {
    ...session,
    accessToken: token.access_token,
    refreshToken: token.refresh_token || session.refreshToken,
    expiresAt: Date.now() + (Number(token.expires_in) || 3600) * 1000,
    scope: token.scope || session.scope,
    idToken: token.id_token || session.idToken,
    refreshedAt: Date.now(),
  };
  await saveSession(env, sessionId, next);
  return next;
}

export function publicIdentity(session) {
  const claims = decodeJwt(session?.idToken || session?.accessToken || '');
  return {
    name: claims.name || '',
    email: claims.email || '',
    subject: claims.sub || '',
    organizationId: claims.org_id || '',
  };
}

function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return {};
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch { return {}; }
}

function parseRpcBody(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const events = trimmed.split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim())
    .filter(Boolean);
  for (let i = events.length - 1; i >= 0; i--) {
    try { return JSON.parse(events[i]); } catch {}
  }
  return null;
}

async function mcpPost(accessToken, payload, mcpSessionId = '') {
  const headers = {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (mcpSessionId) headers['Mcp-Session-Id'] = mcpSessionId;
  const response = await fetch(HIGGSFIELD_MCP, {
    method: 'POST', headers, body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Higgsfield MCP ${response.status}: ${body.slice(0, 220)}`);
  return {
    data: parseRpcBody(body),
    sessionId: response.headers.get('Mcp-Session-Id') || mcpSessionId,
  };
}

export async function listMcpTools(accessToken) {
  const init = await mcpPost(accessToken, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'Tracker Commerce OS', version: '1.0.0' },
    },
  });
  const sid = init.sessionId;
  await mcpPost(accessToken, {
    jsonrpc: '2.0', method: 'notifications/initialized', params: {},
  }, sid);
  const listed = await mcpPost(accessToken, {
    jsonrpc: '2.0', id: 2, method: 'tools/list', params: {},
  }, sid);
  if (listed.data?.error) throw new Error(listed.data.error.message || 'Falha ao listar ferramentas');
  return listed.data?.result?.tools || [];
}

// Executa uma ferramenta em uma sessão MCP curta. Cada chamada HTTP do
// Tracker é independente, portanto inicializamos a sessão aqui em vez de
// expor o access token (ou o Mcp-Session-Id) ao navegador.
export async function callMcpTool(accessToken, name, args = {}) {
  const init = await mcpPost(accessToken, {
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'Tracker Commerce OS', version: '1.0.0' },
    },
  });
  const sid = init.sessionId;
  await mcpPost(accessToken, {
    jsonrpc: '2.0', method: 'notifications/initialized', params: {},
  }, sid);
  const called = await mcpPost(accessToken, {
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name, arguments: args || {} },
  }, sid);
  if (called.data?.error) throw new Error(called.data.error.message || 'Falha na Higgsfield');
  return called.data?.result || null;
}
