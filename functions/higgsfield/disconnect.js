import { json, options, sessionIdFrom } from './_shared.js';

export function onRequestOptions({ request }) { return options(request); }

export async function onRequestPost({ request, env }) {
  const sessionId = sessionIdFrom(request);
  if (sessionId && env.SHOPIFY_TOKENS) await env.SHOPIFY_TOKENS.delete(`higgsfield:session:${sessionId}`);
  return json(request, { connected: false });
}
