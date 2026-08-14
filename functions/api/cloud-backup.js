import { authenticatedUser, decryptSnapshot, encryptSnapshot, json } from '../cloud/_shared.js';

// Encrypted JSON is base64 encoded before KV storage; keep enough headroom
// below Cloudflare KV's 25 MB per-value limit.
const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;

export async function onRequest({ request, env }) {
  if (!env.SHOPIFY_TOKENS) return json({ error: 'Cloud storage indisponível' }, 503);
  const user = await authenticatedUser(request);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const key = `cloud:${user.id}:snapshot`;

  if (request.method === 'GET') {
    const raw = await env.SHOPIFY_TOKENS.get(key);
    if (!raw) return json({ snapshot: null });
    try { return json({ snapshot: await decryptSnapshot(env, raw) }); }
    catch (error) { return json({ error: 'Não foi possível abrir o backup' }, 500); }
  }

  if (request.method === 'PUT') {
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > MAX_SNAPSHOT_BYTES) return json({ error: 'Backup estruturado maior que 16 MB' }, 413);
    const snapshot = await request.json().catch(() => null);
    if (!snapshot || typeof snapshot !== 'object') return json({ error: 'Backup inválido' }, 400);
    snapshot.userId = user.id;
    snapshot.updatedAt = new Date().toISOString();
    const encrypted = await encryptSnapshot(env, snapshot);
    await env.SHOPIFY_TOKENS.put(key, encrypted);
    return json({ ok: true, updatedAt: snapshot.updatedAt });
  }

  if (request.method === 'DELETE') {
    await env.SHOPIFY_TOKENS.delete(key);
    return json({ ok: true });
  }
  return json({ error: 'Método não permitido' }, 405);
}
