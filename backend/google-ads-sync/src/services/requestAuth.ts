import { OAuth2Client } from 'google-auth-library';
import { env } from '../config.js';

export function assertManualToken(token: string | undefined): void {
  if (!token || token !== env.PROJECT_SYNC_TOKEN) {
    throw new Error('Token manual inválido.');
  }
}

export async function assertSchedulerRequest(authHeader: string | undefined): Promise<void> {
  if (env.ALLOW_INSECURE_SCHEDULED) return;

  if (!env.SCHEDULER_OIDC_AUDIENCE) {
    throw new Error('SCHEDULER_OIDC_AUDIENCE não configurado.');
  }

  const raw = String(authHeader || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new Error('Authorization Bearer ausente no scheduled endpoint.');
  }

  const token = match[1];
  const client = new OAuth2Client();
  await client.verifyIdToken({
    idToken: token,
    audience: env.SCHEDULER_OIDC_AUDIENCE
  });
}
