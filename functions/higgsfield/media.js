import { callMcpTool, json, loadSession, options, refreshSession, sessionIdFrom } from './_shared.js';

const MAX_BYTES = 12 * 1024 * 1024;
const MIME_OK = new Set(['image/jpeg', 'image/png', 'image/webp']);

export function onRequestOptions({ request }) { return options(request); }

export async function onRequestPost({ request, env }) {
  const sessionId = sessionIdFrom(request);
  const session = await refreshSession(env, sessionId, await loadSession(env, sessionId));
  if (!session) return json(request, { error: 'Higgsfield desconectada' }, 401);

  let file;
  try { file = (await request.formData()).get('file'); } catch { return json(request, { error: 'Upload inválido' }, 400); }
  if (!(file instanceof File)) return json(request, { error: 'Imagem ausente' }, 400);
  if (!MIME_OK.has(file.type)) return json(request, { error: 'Use PNG, JPEG ou WebP' }, 415);
  if (!file.size || file.size > MAX_BYTES) return json(request, { error: 'A imagem deve ter até 12 MB' }, 413);

  try {
    const prepared = await callMcpTool(session.accessToken, 'media_upload', {
      filename: String(file.name || 'tracker-reference.webp').replace(/[^a-z0-9._-]/gi, '_'),
      content_type: file.type,
    });
    const upload = prepared?.structuredContent?.uploads?.[0];
    if (!upload?.upload_url || !upload?.media_id) throw new Error('Higgsfield não preparou o upload');
    const sent = await fetch(upload.upload_url, {
      method: 'PUT', headers: { 'Content-Type': file.type }, body: file,
    });
    if (!sent.ok) throw new Error(`Upload recusado (${sent.status})`);
    await callMcpTool(session.accessToken, 'media_confirm', {
      type: 'image', media_id: upload.media_id,
    });
    return json(request, { mediaId: upload.media_id });
  } catch (error) {
    console.error('[Higgsfield MCP] media upload failed', error);
    return json(request, { error: String(error.message || error) }, 502);
  }
}
