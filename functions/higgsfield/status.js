import { json, options, loadSession, publicIdentity, refreshSession, sessionIdFrom } from './_shared.js';

export function onRequestOptions({ request }) { return options(request); }

export async function onRequestGet({ request, env }) {
  const sessionId = sessionIdFrom(request);
  const stored = await loadSession(env, sessionId);
  const session = await refreshSession(env, sessionId, stored);
  if (!session) return json(request, { connected: false }, 401);
  return json(request, {
    connected: true,
    identity: publicIdentity(session),
    scope: session.scope || '',
    expiresAt: session.expiresAt || null,
  });
}
