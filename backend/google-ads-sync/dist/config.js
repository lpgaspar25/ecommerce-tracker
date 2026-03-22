import dotenv from 'dotenv';
import { z } from 'zod';
dotenv.config();
const boolFromEnv = z.preprocess((v) => {
    if (typeof v === 'boolean')
        return v;
    const s = String(v || '').trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes';
}, z.boolean());
const schema = z.object({
    NODE_ENV: z.string().default('development'),
    PORT: z.string().default('8080').transform((v) => Number(v)),
    SPREADSHEET_ID: z.string().min(1),
    GOOGLE_ADS_API_VERSION: z.string().default('v18'),
    GADS_DEVELOPER_TOKEN: z.string().min(1),
    GADS_OAUTH_CLIENT_ID: z.string().min(1),
    GADS_OAUTH_CLIENT_SECRET: z.string().min(1),
    GADS_OAUTH_REFRESH_TOKEN: z.string().min(1),
    GADS_CUSTOMER_ID: z.string().min(1),
    GADS_LOGIN_CUSTOMER_ID: z.string().optional(),
    GADS_DEFAULT_BUSINESS_NAME: z.string().min(1),
    PROJECT_SYNC_TOKEN: z.string().min(1),
    ALERT_EMAIL_TO: z.string().optional(),
    ALERT_EMAIL_FROM: z.string().optional(),
    EMAIL_PROVIDER_API_KEY: z.string().optional(),
    SCHEDULER_OIDC_AUDIENCE: z.string().optional(),
    ALLOW_INSECURE_SCHEDULED: boolFromEnv.default(false)
});
export const env = schema.parse(process.env);
export const tabs = {
    queue: 'GoogleAdsQueue',
    runs: 'GoogleAdsRuns'
};
