import express, { Request, Response } from 'express';
import { z } from 'zod';
import { env } from './config.js';
import { logger } from './lib/logger.js';
import { EmailNotifier } from './services/emailNotifier.js';
import { GoogleAdsClient } from './services/googleAdsClient.js';
import { GoogleAuthProvider } from './services/googleAuth.js';
import { assertManualToken, assertSchedulerRequest } from './services/requestAuth.js';
import { extractAliExpressData, normalizeAliExpressUrl } from './services/aliexpressExtractor.js';
import { SheetsRepository } from './services/sheetsRepository.js';
import { SyncOrchestrator } from './services/syncOrchestrator.js';

const manualBodySchema = z.object({
  requestedBy: z.string().trim().min(1).max(120).optional(),
  storeId: z.string().trim().min(1).max(120).optional()
}).default({});

const supplierExtractBodySchema = z.object({
  url: z.string().trim().min(1).max(2000).url()
});

const authProvider = new GoogleAuthProvider();
const sheetsRepository = new SheetsRepository(authProvider.getOAuthClient());
const googleAdsClient = new GoogleAdsClient(authProvider);
const emailNotifier = new EmailNotifier();
const orchestrator = new SyncOrchestrator(sheetsRepository, googleAdsClient, emailNotifier);

export const app = express();

app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-sync-token,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'ok', service: 'google-ads-sync' });
});

app.post('/suppliers/aliexpress/extract', async (req: Request, res: Response) => {
  try {
    const parsedBody = supplierExtractBodySchema.parse(req.body || {});

    if (!normalizeAliExpressUrl(parsedBody.url)) {
      res.status(422).json({ error: 'URL não suportada. Envie o link do produto AliExpress (formato /item/123...html).' });
      return;
    }

    const extracted = await extractAliExpressData(parsedBody.url);
    res.status(200).json({
      ok: true,
      provider: 'aliexpress',
      data: {
        canonicalUrl: extracted.canonicalUrl,
        productId: extracted.productId,
        title: extracted.title,
        cost: extracted.cost,
        functions: extracted.functions,
        sources: extracted.sources
      },
      warnings: extracted.warnings
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    res.status(400).json({ error: message });
  }
});

app.post('/sync/manual', async (req: Request, res: Response) => {
  try {
    assertManualToken(req.header('x-sync-token'));

    const parsedBody = manualBodySchema.parse(req.body || {});
    const runId = orchestrator.triggerRun('manual', parsedBody.requestedBy || 'manual-trigger', parsedBody.storeId);

    res.status(202).json({ runId, status: 'accepted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    const status = message.includes('Token manual inválido') ? 401 : 400;
    res.status(status).json({ error: message });
  }
});

app.post('/sync/scheduled', async (req: Request, res: Response) => {
  try {
    await assertSchedulerRequest(req.header('authorization'));

    const runId = orchestrator.triggerRun('scheduled', 'cloud-scheduler');
    res.status(202).json({ runId, status: 'accepted' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    res.status(401).json({ error: message });
  }
});

app.get('/runs', async (req: Request, res: Response) => {
  try {
    assertManualToken(req.header('x-sync-token'));

    const limit = Number(req.query.limit || 20);
    const runs = await orchestrator.getRuns(limit);

    res.status(200).json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    const status = message.includes('Token manual inválido') ? 401 : 500;
    res.status(status).json({ error: message });
  }
});

app.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', error);
  res.status(500).json({ error: 'Erro interno' });
});

export function startServer() {
  const port = env.PORT;

  app.listen(port, () => {
    logger.info(`Google Ads Sync rodando na porta ${port}`);
  });
}
