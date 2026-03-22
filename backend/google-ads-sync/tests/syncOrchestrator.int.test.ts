import { describe, expect, it } from 'vitest';
import { canonicalHash } from '../src/lib/hash.js';
import { QueueRow, RunSummary } from '../src/types.js';
import { SyncOrchestrator } from '../src/services/syncOrchestrator.js';

class FakeSheetsRepo {
  public rows: QueueRow[] = [];
  public runs: RunSummary[] = [];

  async ensureTabs() {}

  async loadQueueRows(): Promise<QueueRow[]> {
    return this.rows;
  }

  async writeQueueRow(row: QueueRow): Promise<void> {
    const idx = this.rows.findIndex((r) => r.rowNumber === row.rowNumber);
    if (idx >= 0) this.rows[idx] = { ...row };
  }

  async appendRun(run: RunSummary): Promise<void> {
    this.runs.unshift({ ...run });
  }

  async listRuns(limit = 20): Promise<RunSummary[]> {
    return this.runs.slice(0, limit);
  }
}

class FakeAdsClient {
  public created: string[] = [];
  public updated: string[] = [];
  public paused: string[] = [];

  async createPausedResponsiveDisplayAd(): Promise<string> {
    this.created.push('create');
    return '777';
  }

  async updatePausedResponsiveDisplayAd(_payload: unknown, googleAdId: string): Promise<void> {
    this.updated.push(googleAdId);
  }

  async pauseAdGroupAd(_customerId: string, _adGroupId: string, googleAdId: string): Promise<void> {
    this.paused.push(googleAdId);
  }
}

class FakeNotifier {
  public alerts = 0;

  async sendFailureAlert(): Promise<void> {
    this.alerts += 1;
  }
}

function baseRow(partial: Partial<QueueRow>): QueueRow {
  return {
    rowNumber: 2,
    id: 'id-1',
    storeId: 'store-1',
    productId: 'product-1',
    customerId: '1234567890',
    campaignId: '11',
    adGroupId: '22',
    adName: 'Ad Name',
    finalUrl: 'https://example.com',
    headlinesJson: '["H1"]',
    descriptionsJson: '["D1"]',
    marketingImageAssetIdsJson: '["999"]',
    squareMarketingImageAssetIdsJson: '["1000"]',
    logoImageAssetIdsJson: '[]',
    youtubeVideoAssetIdsJson: '[]',
    callToAction: 'LEARN_MORE',
    desiredState: 'READY',
    googleAdId: '',
    lastPayloadHash: '',
    syncStatus: '',
    lastSyncAt: '',
    lastError: '',
    updatedAt: '',
    ...partial
  };
}

async function waitForCompletion(orchestrator: SyncOrchestrator, runId: string): Promise<void> {
  const timeoutMs = 3000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const runs = await orchestrator.getRuns(10);
    const match = runs.find((run) => run.runId === runId);
    if (match && match.status !== 'RUNNING') {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  throw new Error('Run não concluiu no tempo esperado.');
}

describe('SyncOrchestrator integration', () => {
  it('executa create, no-op e pause com atualização de planilha e run', async () => {
    const repo = new FakeSheetsRepo();
    const ads = new FakeAdsClient();
    const notifier = new FakeNotifier();

    const payloadHash = canonicalHash({
      customerId: '1234567890',
      campaignId: '11',
      adGroupId: '22',
      adName: 'Ad Name',
      finalUrl: 'https://example.com',
      headlines: ['H1'],
      descriptions: ['D1'],
      marketingImageAssetIds: ['999'],
      squareMarketingImageAssetIds: ['1000'],
      logoImageAssetIds: [],
      youtubeVideoAssetIds: [],
      callToAction: 'LEARN_MORE'
    });

    repo.rows = [
      baseRow({ rowNumber: 2, id: 'create-1', googleAdId: '', desiredState: 'READY' }),
      baseRow({ rowNumber: 3, id: 'noop-1', googleAdId: '123', desiredState: 'READY', lastPayloadHash: payloadHash }),
      baseRow({ rowNumber: 4, id: 'pause-1', googleAdId: '456', desiredState: 'INACTIVE' })
    ];

    const orchestrator = new SyncOrchestrator(repo, ads, notifier);
    const runId = orchestrator.triggerRun('manual', 'tester');

    await waitForCompletion(orchestrator, runId);

    expect(ads.created).toHaveLength(1);
    expect(ads.updated).toHaveLength(0);
    expect(ads.paused).toEqual(['456']);

    expect(repo.rows.find((r) => r.id === 'create-1')?.googleAdId).toBe('777');
    expect(repo.rows.find((r) => r.id === 'noop-1')?.syncStatus).toBe('SKIPPED_NO_CHANGE');
    expect(repo.rows.find((r) => r.id === 'pause-1')?.syncStatus).toBe('SUCCESS');

    expect(repo.runs).toHaveLength(1);
    expect(repo.runs[0].status).toBe('SUCCESS');
    expect(notifier.alerts).toBe(0);
  });
});
