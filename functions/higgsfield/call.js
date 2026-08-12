import { callMcpTool, json, loadSession, options, refreshSession, sessionIdFrom } from './_shared.js';

const ALLOWED_TOOLS = new Set([
  'models_explore',
  'generate_image',
  'generate_video',
  'jobs_wait',
  'job_display',
  'show_generation_by_ids',
]);

const ALLOWED_IMAGE_MODELS = new Set([
  'nano_banana_2', 'nano_banana_pro', 'gpt_image_2',
  'seedream_v5_lite', 'seedream_v5_pro', 'seedream_v4_5',
]);
const ALLOWED_VIDEO_MODELS = new Set(['seedance_2_5']);

export function onRequestOptions({ request }) { return options(request); }

export async function onRequestPost({ request, env }) {
  const sessionId = sessionIdFrom(request);
  const session = await refreshSession(env, sessionId, await loadSession(env, sessionId));
  if (!session) return json(request, { error: 'Higgsfield desconectada' }, 401);

  let body;
  try { body = await request.json(); } catch { return json(request, { error: 'JSON inválido' }, 400); }
  const tool = String(body?.tool || '');
  const args = body?.args && typeof body.args === 'object' ? body.args : {};
  if (!ALLOWED_TOOLS.has(tool)) return json(request, { error: 'Ferramenta não permitida' }, 400);

  // Restringe a ponte aos modelos que aparecem no Estúdio. Isso evita que
  // uma chamada adulterada use a sessão conectada em operações arbitrárias.
  const model = args?.params?.model;
  if (tool === 'generate_image' && !ALLOWED_IMAGE_MODELS.has(model)) {
    return json(request, { error: 'Modelo de imagem não permitido' }, 400);
  }
  if (tool === 'generate_video' && !ALLOWED_VIDEO_MODELS.has(model)) {
    return json(request, { error: 'Modelo de vídeo não permitido' }, 400);
  }

  try {
    const result = await callMcpTool(session.accessToken, tool, args);
    return json(request, { result });
  } catch (error) {
    console.error(`[Higgsfield MCP] ${tool} failed`, error);
    return json(request, { error: String(error.message || error) }, 502);
  }
}
