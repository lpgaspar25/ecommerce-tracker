import crypto from 'node:crypto';
import { canonicalHash } from '../lib/hash.js';
import { logger } from '../lib/logger.js';
import { withRetry } from '../lib/retry.js';
import { QueuePayload, QueueRow, RowProcessingResult, RunSummary, SyncMode } from '../types.js';
import { GoogleAdsApiError } from './googleAdsErrors.js';
import { buildPayloadFromRow, computeSyncDecision } from './syncDecision.js';

export interface SheetsRepositoryPort {
  ensureTabs(): Promise<void>;
  loadQueueRows(storeId?: string): Promise<QueueRow[]>;
  writeQueueRow(row: QueueRow): Promise<void>;
  appendRun(run: RunSummary): Promise<void>;
  listRuns(limit?: number): Promise<RunSummary[]>;
}

export interface GoogleAdsClientPort {
  createPausedResponsiveDisplayAd(payload: QueuePayload): Promise<string>;
  updatePausedResponsiveDisplayAd(
    payload: QueuePayload,
    googleAdId: string
  ): Promise<void>;
  pauseAdGroupAd(customerIdRaw: string, adGroupIdRaw: string, googleAdIdRaw: string): Promise<void>;
}

export interface EmailNotifierPort {
  sendFailureAlert(run: RunSummary): Promise<void>;
}

export class SyncOrchestrator {
  private readonly runningRuns = new Map<string, RunSummary>();

  constructor(
    private readonly sheetsRepository: SheetsRepositoryPort,
    private readonly googleAdsClient: GoogleAdsClientPort,
    private readonly notifier: EmailNotifierPort
  ) {}

  triggerRun(mode: SyncMode, triggeredBy: string, storeId?: string): string {
    const runId = crypto.randomUUID();

    const run: RunSummary = {
      runId,
      mode,
      triggeredBy,
      startedAt: new Date().toISOString(),
      finishedAt: '',
      rowsRead: 0,
      rowsProcessed: 0,
      rowsSuccess: 0,
      rowsFailed: 0,
      status: 'RUNNING',
      errorSummary: ''
    };

    this.runningRuns.set(runId, run);
    void this.executeRun(runId, storeId);

    return runId;
  }

  async getRuns(limit = 20): Promise<RunSummary[]> {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));

    const persisted = await this.sheetsRepository.listRuns(safeLimit);
    const running = [...this.runningRuns.values()]
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));

    const merged = [
      ...running,
      ...persisted.filter((run) => !this.runningRuns.has(run.runId))
    ];

    return merged.slice(0, safeLimit);
  }

  private async executeRun(runId: string, storeId?: string): Promise<void> {
    const run = this.runningRuns.get(runId);
    if (!run) return;

    const collectedErrors: string[] = [];

    try {
      await this.sheetsRepository.ensureTabs();
      const queueRows = await this.sheetsRepository.loadQueueRows(storeId);
      run.rowsRead = queueRows.length;

      for (const row of queueRows) {
        const result = await this.processRow(row);
        run.rowsProcessed += 1;

        if (result.success) {
          run.rowsSuccess += 1;
        } else {
          run.rowsFailed += 1;
          collectedErrors.push(`[${row.id || `row-${row.rowNumber}`}] ${result.message}`);
        }
      }

      run.status = run.rowsFailed > 0 ? 'FAILED' : 'SUCCESS';
      run.errorSummary = collectedErrors.slice(0, 5).join(' | ');
    } catch (error) {
      run.status = 'FAILED';
      run.errorSummary = stringifyError(error);
      logger.error('Run finalizado com erro fatal', error);
    } finally {
      run.finishedAt = new Date().toISOString();

      try {
        await this.sheetsRepository.appendRun(run);
      } catch (appendError) {
        logger.error('Falha ao gravar run no GoogleAdsRuns', appendError);
      }

      if (run.rowsFailed > 0) {
        try {
          await this.notifier.sendFailureAlert(run);
        } catch (mailError) {
          logger.error('Falha ao enviar email de alerta', mailError);
        }
      }

      this.runningRuns.delete(runId);
    }
  }

  private async processRow(row: QueueRow): Promise<RowProcessingResult> {
    const nowIso = new Date().toISOString();

    const { payload, errors } = buildPayloadFromRow(row);
    if (errors.length > 0 || !payload) {
      row.syncStatus = 'FAILED';
      row.lastError = errors.join(' | ') || 'Payload inválido';
      row.lastSyncAt = nowIso;
      row.updatedAt = nowIso;
      await this.sheetsRepository.writeQueueRow(row);
      return { success: false, message: row.lastError };
    }

    const payloadHash = canonicalHash(payload);
    const decision = computeSyncDecision(row, payloadHash);

    try {
      if (decision.action === 'create') {
        const googleAdId = await withRetry(
          () => this.googleAdsClient.createPausedResponsiveDisplayAd(payload),
          { shouldRetry: shouldRetryGoogleAdsError, attempts: 3, baseDelayMs: 700 }
        );

        row.googleAdId = googleAdId;
        row.lastPayloadHash = payloadHash;
        row.syncStatus = 'SUCCESS';
        row.lastError = '';
      } else if (decision.action === 'update') {
        await withRetry(
          () => this.googleAdsClient.updatePausedResponsiveDisplayAd(payload, row.googleAdId),
          { shouldRetry: shouldRetryGoogleAdsError, attempts: 3, baseDelayMs: 700 }
        );

        row.lastPayloadHash = payloadHash;
        row.syncStatus = 'SUCCESS';
        row.lastError = '';
      } else if (decision.action === 'pause') {
        await withRetry(
          () => this.googleAdsClient.pauseAdGroupAd(payload.customerId, row.adGroupId, row.googleAdId),
          { shouldRetry: shouldRetryGoogleAdsError, attempts: 3, baseDelayMs: 700 }
        );

        row.syncStatus = 'SUCCESS';
        row.lastError = '';
      } else {
        row.syncStatus = decision.reason === 'payload_unchanged' ? 'SKIPPED_NO_CHANGE' : 'SKIPPED';
        row.lastError = '';
      }

      row.lastSyncAt = nowIso;
      row.updatedAt = nowIso;
      row.desiredState = String(row.desiredState).toUpperCase();
      await this.sheetsRepository.writeQueueRow(row);

      return { success: true, message: decision.reason };
    } catch (error) {
      row.syncStatus = 'FAILED';
      row.lastError = stringifyError(error);
      row.lastSyncAt = nowIso;
      row.updatedAt = nowIso;
      await this.sheetsRepository.writeQueueRow(row);

      return { success: false, message: row.lastError };
    }
  }
}

function shouldRetryGoogleAdsError(error: unknown): boolean {
  if (error instanceof GoogleAdsApiError) {
    return [429, 500, 502, 503, 504].includes(error.status);
  }

  return false;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
