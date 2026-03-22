# Google Ads Sync Service

Serviço Node.js + TypeScript para sincronizar anúncios Display/Demand Gen a partir da aba `GoogleAdsQueue` da planilha.

## Endpoints

- `POST /sync/manual` (header obrigatório `x-sync-token`)
- `POST /sync/scheduled` (OIDC via Cloud Scheduler)
- `GET /runs?limit=20` (header `x-sync-token`)
- `POST /suppliers/aliexpress/extract` (sem autenticação; uso de utilitário de extração)
- `GET /health`

## Execução local

```bash
cp .env.example .env
npm install
npm run dev
```

## Variáveis obrigatórias

- `SPREADSHEET_ID`
- `GADS_DEVELOPER_TOKEN`
- `GADS_OAUTH_CLIENT_ID`
- `GADS_OAUTH_CLIENT_SECRET`
- `GADS_OAUTH_REFRESH_TOKEN`
- `GADS_CUSTOMER_ID`
- `GADS_DEFAULT_BUSINESS_NAME`
- `PROJECT_SYNC_TOKEN`

## Deploy Cloud Run (resumo)

```bash
npm install
npm run build
gcloud run deploy google-ads-sync \
  --source . \
  --region us-central1 \
  --allow-unauthenticated=false
```

## Scheduler diário (00:00 Europe/London)

```bash
gcloud scheduler jobs create http gads-sync-daily \
  --schedule="0 0 * * *" \
  --time-zone="Europe/London" \
  --uri="https://<SERVICE-URL>/sync/scheduled" \
  --http-method=POST \
  --oidc-service-account-email="<SCHEDULER-SA>@<PROJECT>.iam.gserviceaccount.com" \
  --oidc-token-audience="https://<SERVICE-URL>/sync/scheduled"
```
