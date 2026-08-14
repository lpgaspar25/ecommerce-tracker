const SUPABASE_URL = 'https://clqsjcestdvmdxsemwdc.supabase.co';
const SUPABASE_KEY = 'sb_publishable_zFJQV-ChQ6vOxpYrYfN8UA_jNe7tJqQ';

export async function authenticatedUser(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_KEY },
  });
  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? user : null;
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function bytesToBase64(bytes) {
  let raw = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    raw += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(raw);
}

function base64ToBytes(value) {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function vaultKey(env) {
  const secret = env.CLOUD_BACKUP_SECRET || env.SHOPIFY_CLIENT_SECRET;
  if (!secret) throw new Error('CLOUD_BACKUP_SECRET não configurado');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSnapshot(env, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(env), plain);
  return JSON.stringify({ v: 1, iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(encrypted)) });
}

export async function decryptSnapshot(env, raw) {
  const payload = JSON.parse(raw);
  if (payload?.v !== 1 || !payload.iv || !payload.data) throw new Error('Snapshot inválido');
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    await vaultKey(env),
    base64ToBytes(payload.data),
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function safeMediaId(value) {
  const id = String(value || '').trim();
  return id && id.length <= 180 && /^[a-zA-Z0-9_.:-]+$/.test(id) ? id : '';
}
