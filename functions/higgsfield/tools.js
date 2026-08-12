import { json, options, listMcpTools, loadSession, refreshSession, sessionIdFrom } from './_shared.js';

export function onRequestOptions({ request }) { return options(request); }

export async function onRequestGet({ request, env }) {
  const sessionId = sessionIdFrom(request);
  const session = await refreshSession(env, sessionId, await loadSession(env, sessionId));
  if (!session) return json(request, { connected: false, tools: [] }, 401);
  try {
    const tools = await listMcpTools(session.accessToken);
    return json(request, {
      connected: true,
      tools: tools.map(tool => ({ name: tool.name, title: tool.title || '', description: tool.description || '' })),
    });
  } catch (error) {
    console.error('[Higgsfield MCP] list tools failed', error);
    return json(request, { connected: true, tools: [], error: String(error.message || error) }, 502);
  }
}
