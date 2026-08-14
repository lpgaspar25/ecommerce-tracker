import { authenticatedUser, json, safeMediaId } from '../cloud/_shared.js';

const MAX_MEDIA_BYTES = 24 * 1024 * 1024;

async function loadIndex(env, userId) {
  const raw = await env.SHOPIFY_TOKENS.get(`cloud:${userId}:media:index`);
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}

async function saveIndex(env, userId, index) {
  await env.SHOPIFY_TOKENS.put(`cloud:${userId}:media:index`, JSON.stringify(index));
}

export async function onRequest({ request, env }) {
  if (!env.SHOPIFY_TOKENS) return json({ error: 'Cloud storage indisponível' }, 503);
  const user = await authenticatedUser(request);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const url = new URL(request.url);
  const id = safeMediaId(url.searchParams.get('id'));
  const index = await loadIndex(env, user.id);

  if (request.method === 'GET' && !id) return json({ media: Object.values(index) });
  if (!id) return json({ error: 'ID de mídia inválido' }, 400);
  const mediaKey = `cloud:${user.id}:media:${id}`;

  if (request.method === 'GET') {
    const value = await env.SHOPIFY_TOKENS.get(mediaKey, 'arrayBuffer');
    if (!value) return json({ error: 'Mídia não encontrada' }, 404);
    const meta = index[id] || {};
    return new Response(value, {
      headers: {
        'Content-Type': meta.type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${String(meta.name || id).replace(/["\r\n]/g, '')}"`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  if (request.method === 'PUT') {
    const length = Number(request.headers.get('Content-Length') || 0);
    if (length > MAX_MEDIA_BYTES) return json({ error: 'Arquivo maior que 24 MB' }, 413);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > MAX_MEDIA_BYTES) return json({ error: 'Arquivo inválido' }, 400);
    const type = String(request.headers.get('X-Media-Type') || 'application/octet-stream').slice(0, 120);
    let name = String(request.headers.get('X-Media-Name') || id);
    try { name = decodeURIComponent(name); } catch {}
    name = name.slice(0, 180);
    await env.SHOPIFY_TOKENS.put(mediaKey, bytes);
    index[id] = { id, type, name, size: bytes.byteLength, updatedAt: new Date().toISOString() };
    await saveIndex(env, user.id, index);
    return json({ ok: true, media: index[id] });
  }

  if (request.method === 'DELETE') {
    await env.SHOPIFY_TOKENS.delete(mediaKey);
    delete index[id];
    await saveIndex(env, user.id, index);
    return json({ ok: true });
  }
  return json({ error: 'Método não permitido' }, 405);
}
