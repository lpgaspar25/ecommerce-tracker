import { env } from '../config.js';
import { QueuePayload } from '../types.js';
import { GoogleAuthProvider } from './googleAuth.js';
import { GoogleAdsApiError } from './googleAdsErrors.js';

interface MutateResponse {
  mutateOperationResponses?: Array<{
    adGroupAdResult?: { resourceName?: string };
    adResult?: { resourceName?: string };
  }>;
}

export class GoogleAdsClient {
  constructor(private readonly authProvider: GoogleAuthProvider) {}

  async createPausedResponsiveDisplayAd(payload: QueuePayload): Promise<string> {
    const customerId = sanitizeNumeric(payload.customerId || env.GADS_CUSTOMER_ID);

    const operation = {
      adGroupAdOperation: {
        create: {
          status: 'PAUSED',
          adGroup: `customers/${customerId}/adGroups/${sanitizeNumeric(payload.adGroupId)}`,
          ad: {
            name: payload.adName,
            finalUrls: [payload.finalUrl],
            responsiveDisplayAd: this.buildResponsiveDisplayAd(customerId, payload)
          }
        }
      }
    };

    const data = await this.mutate(customerId, [operation]);
    const resourceName = data.mutateOperationResponses?.[0]?.adGroupAdResult?.resourceName;
    if (!resourceName) {
      throw new Error('Google Ads não retornou resourceName para create.');
    }

    const parsedId = parseAdIdFromAdGroupAdResource(resourceName);
    if (!parsedId) {
      throw new Error(`Não foi possível extrair GoogleAdID de ${resourceName}`);
    }

    return parsedId;
  }

  async updatePausedResponsiveDisplayAd(payload: QueuePayload, googleAdId: string): Promise<void> {
    const customerId = sanitizeNumeric(payload.customerId || env.GADS_CUSTOMER_ID);
    const adId = sanitizeNumeric(googleAdId);
    const adGroupId = sanitizeNumeric(payload.adGroupId);

    const operations = [
      {
        adOperation: {
          update: {
            resourceName: `customers/${customerId}/ads/${adId}`,
            finalUrls: [payload.finalUrl],
            responsiveDisplayAd: this.buildResponsiveDisplayAd(customerId, payload)
          },
          updateMask: [
            'final_urls',
            'responsive_display_ad.headlines',
            'responsive_display_ad.long_headline',
            'responsive_display_ad.descriptions',
            'responsive_display_ad.marketing_images',
            'responsive_display_ad.square_marketing_images',
            'responsive_display_ad.logo_images',
            'responsive_display_ad.youtube_videos',
            'responsive_display_ad.call_to_action_text',
            'responsive_display_ad.business_name'
          ].join(',')
        }
      },
      {
        adGroupAdOperation: {
          update: {
            resourceName: `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`,
            status: 'PAUSED'
          },
          updateMask: 'status'
        }
      }
    ];

    await this.mutate(customerId, operations);
  }

  async pauseAdGroupAd(customerIdRaw: string, adGroupIdRaw: string, googleAdIdRaw: string): Promise<void> {
    const customerId = sanitizeNumeric(customerIdRaw || env.GADS_CUSTOMER_ID);
    const adGroupId = sanitizeNumeric(adGroupIdRaw);
    const adId = sanitizeNumeric(googleAdIdRaw);

    const operation = {
      adGroupAdOperation: {
        update: {
          resourceName: `customers/${customerId}/adGroupAds/${adGroupId}~${adId}`,
          status: 'PAUSED'
        },
        updateMask: 'status'
      }
    };

    await this.mutate(customerId, [operation]);
  }

  private buildResponsiveDisplayAd(customerId: string, payload: QueuePayload) {
    const fallbackHeadline = payload.headlines[0] || payload.adName;
    const headlines = payload.headlines.map((text) => ({ text }));
    const descriptions = payload.descriptions.map((text) => ({ text }));

    const marketingImages = payload.marketingImageAssetIds.map((id) => ({
      asset: `customers/${customerId}/assets/${sanitizeNumeric(id)}`
    }));

    const squareMarketingImages = payload.squareMarketingImageAssetIds.map((id) => ({
      asset: `customers/${customerId}/assets/${sanitizeNumeric(id)}`
    }));

    const logoImages = payload.logoImageAssetIds.map((id) => ({
      asset: `customers/${customerId}/assets/${sanitizeNumeric(id)}`
    }));

    const youtubeVideos = payload.youtubeVideoAssetIds.map((id) => ({
      asset: `customers/${customerId}/assets/${sanitizeNumeric(id)}`
    }));

    return {
      businessName: env.GADS_DEFAULT_BUSINESS_NAME,
      longHeadline: { text: fallbackHeadline },
      headlines,
      descriptions,
      marketingImages,
      squareMarketingImages,
      logoImages,
      youtubeVideos,
      ...(payload.callToAction ? { callToActionText: String(payload.callToAction).trim().toUpperCase() } : {})
    };
  }

  private async mutate(customerId: string, mutateOperations: unknown[]): Promise<MutateResponse> {
    const accessToken = await this.authProvider.getAccessToken();
    const url = `https://googleads.googleapis.com/${env.GOOGLE_ADS_API_VERSION}/customers/${customerId}/googleAds:mutate`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      'developer-token': env.GADS_DEVELOPER_TOKEN,
      'Content-Type': 'application/json'
    };

    if (env.GADS_LOGIN_CUSTOMER_ID) {
      headers['login-customer-id'] = sanitizeNumeric(env.GADS_LOGIN_CUSTOMER_ID);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mutateOperations,
        partialFailure: false,
        validateOnly: false,
        responseContentType: 'MUTABLE_RESOURCE'
      })
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = extractErrorMessage(body) || `Google Ads API falhou (${response.status})`;
      throw new GoogleAdsApiError(message, response.status, body);
    }

    return body as MutateResponse;
  }
}

function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;

  const candidate = body as {
    error?: {
      message?: string;
      details?: Array<{ errors?: Array<{ message?: string }> }>;
    };
  };

  const rootMessage = candidate.error?.message;
  if (rootMessage) return rootMessage;

  const detailedMessage = candidate.error?.details?.[0]?.errors?.[0]?.message;
  if (detailedMessage) return detailedMessage;

  return null;
}

function parseAdIdFromAdGroupAdResource(resourceName: string): string {
  const match = String(resourceName || '').match(/~(\d+)$/);
  return match ? match[1] : '';
}

export function sanitizeNumeric(value: string): string {
  return String(value || '').replace(/\D/g, '');
}
