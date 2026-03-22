import { OAuth2Client } from 'google-auth-library';
import { env } from '../config.js';

export class GoogleAuthProvider {
  private readonly oauthClient: OAuth2Client;

  constructor() {
    this.oauthClient = new OAuth2Client({
      clientId: env.GADS_OAUTH_CLIENT_ID,
      clientSecret: env.GADS_OAUTH_CLIENT_SECRET
    });

    this.oauthClient.setCredentials({
      refresh_token: env.GADS_OAUTH_REFRESH_TOKEN
    });
  }

  getOAuthClient(): OAuth2Client {
    return this.oauthClient;
  }

  async getAccessToken(): Promise<string> {
    const token = await this.oauthClient.getAccessToken();
    const accessToken = token.token;
    if (!accessToken) {
      throw new Error('Não foi possível obter access token do Google OAuth.');
    }
    return accessToken;
  }
}
