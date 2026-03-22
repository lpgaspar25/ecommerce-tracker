import { OAuth2Client } from 'google-auth-library';
import { google, sheets_v4 } from 'googleapis';
import { env, tabs } from '../config.js';
import { logger } from '../lib/logger.js';
import { QueueRow, RunSummary } from '../types.js';

const QUEUE_HEADERS = [
  'ID', 'StoreID', 'ProductID', 'CustomerID', 'CampaignID', 'AdGroupID',
  'AdName', 'FinalURL', 'HeadlinesJSON', 'DescriptionsJSON',
  'MarketingImageAssetIDsJSON', 'SquareMarketingImageAssetIDsJSON', 'LogoImageAssetIDsJSON',
  'YouTubeVideoAssetIDsJSON', 'CallToAction', 'DesiredState',
  'GoogleAdID', 'LastPayloadHash', 'SyncStatus', 'LastSyncAt', 'LastError', 'UpdatedAt'
];

const RUN_HEADERS = [
  'RunID', 'Mode', 'TriggeredBy', 'StartedAt', 'FinishedAt',
  'RowsRead', 'RowsProcessed', 'RowsSuccess', 'RowsFailed', 'Status', 'ErrorSummary'
];

export class SheetsRepository {
  private readonly sheetsApi: sheets_v4.Sheets;

  constructor(private readonly authClient: OAuth2Client) {
    this.sheetsApi = google.sheets({ version: 'v4', auth: authClient });
  }

  async ensureTabs(): Promise<void> {
    const spreadsheet = await this.sheetsApi.spreadsheets.get({
      spreadsheetId: env.SPREADSHEET_ID
    });

    const existing = new Set((spreadsheet.data.sheets || []).map((sheet) => sheet.properties?.title || ''));
    const missing = [tabs.queue, tabs.runs].filter((tab) => !existing.has(tab));

    if (missing.length > 0) {
      await this.sheetsApi.spreadsheets.batchUpdate({
        spreadsheetId: env.SPREADSHEET_ID,
        requestBody: {
          requests: missing.map((title) => ({ addSheet: { properties: { title } } }))
        }
      });

      logger.info('Sheets tabs criadas', missing);
    }

    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.SPREADSHEET_ID,
      range: `${tabs.queue}!A1:V1`,
      valueInputOption: 'RAW',
      requestBody: { values: [QUEUE_HEADERS] }
    });

    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.SPREADSHEET_ID,
      range: `${tabs.runs}!A1:K1`,
      valueInputOption: 'RAW',
      requestBody: { values: [RUN_HEADERS] }
    });
  }

  async loadQueueRows(storeId?: string): Promise<QueueRow[]> {
    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: env.SPREADSHEET_ID,
      range: `${tabs.queue}!A2:V`
    });

    const values = response.data.values || [];
    const rows = values.map((row, idx) => this.parseQueueRow(idx + 2, row));

    return rows.filter((row) => {
      const desiredState = String(row.desiredState || '').toUpperCase();
      if (!['READY', 'INACTIVE'].includes(desiredState)) return false;
      if (!storeId) return true;
      return String(row.storeId || '').trim() === storeId;
    });
  }

  async writeQueueRow(row: QueueRow): Promise<void> {
    await this.sheetsApi.spreadsheets.values.update({
      spreadsheetId: env.SPREADSHEET_ID,
      range: `${tabs.queue}!A${row.rowNumber}:V${row.rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [this.queueRowToArray(row)]
      }
    });
  }

  async appendRun(run: RunSummary): Promise<void> {
    await this.sheetsApi.spreadsheets.values.append({
      spreadsheetId: env.SPREADSHEET_ID,
      range: `${tabs.runs}!A:K`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [[
          run.runId,
          run.mode,
          run.triggeredBy,
          run.startedAt,
          run.finishedAt,
          run.rowsRead,
          run.rowsProcessed,
          run.rowsSuccess,
          run.rowsFailed,
          run.status,
          run.errorSummary
        ]]
      }
    });
  }

  async listRuns(limit = 20): Promise<RunSummary[]> {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));

    const response = await this.sheetsApi.spreadsheets.values.get({
      spreadsheetId: env.SPREADSHEET_ID,
      range: `${tabs.runs}!A2:K`
    });

    const rows = (response.data.values || []).map((row) => ({
      runId: row[0] || '',
      mode: (row[1] || 'manual') as RunSummary['mode'],
      triggeredBy: row[2] || '',
      startedAt: row[3] || '',
      finishedAt: row[4] || '',
      rowsRead: Number(row[5]) || 0,
      rowsProcessed: Number(row[6]) || 0,
      rowsSuccess: Number(row[7]) || 0,
      rowsFailed: Number(row[8]) || 0,
      status: (row[9] || 'FAILED') as RunSummary['status'],
      errorSummary: row[10] || ''
    }));

    rows.sort((a, b) => String(b.finishedAt || b.startedAt).localeCompare(String(a.finishedAt || a.startedAt)));
    return rows.slice(0, safeLimit);
  }

  private parseQueueRow(rowNumber: number, row: string[]): QueueRow {
    return {
      rowNumber,
      id: row[0] || '',
      storeId: row[1] || '',
      productId: row[2] || '',
      customerId: row[3] || '',
      campaignId: row[4] || '',
      adGroupId: row[5] || '',
      adName: row[6] || '',
      finalUrl: row[7] || '',
      headlinesJson: row[8] || '[]',
      descriptionsJson: row[9] || '[]',
      marketingImageAssetIdsJson: row[10] || '[]',
      squareMarketingImageAssetIdsJson: row[11] || '[]',
      logoImageAssetIdsJson: row[12] || '[]',
      youtubeVideoAssetIdsJson: row[13] || '[]',
      callToAction: row[14] || '',
      desiredState: row[15] || '',
      googleAdId: row[16] || '',
      lastPayloadHash: row[17] || '',
      syncStatus: row[18] || '',
      lastSyncAt: row[19] || '',
      lastError: row[20] || '',
      updatedAt: row[21] || ''
    };
  }

  private queueRowToArray(row: QueueRow): string[] {
    return [
      row.id,
      row.storeId,
      row.productId,
      row.customerId,
      row.campaignId,
      row.adGroupId,
      row.adName,
      row.finalUrl,
      row.headlinesJson,
      row.descriptionsJson,
      row.marketingImageAssetIdsJson,
      row.squareMarketingImageAssetIdsJson,
      row.logoImageAssetIdsJson,
      row.youtubeVideoAssetIdsJson,
      row.callToAction,
      String(row.desiredState || '').toUpperCase(),
      row.googleAdId,
      row.lastPayloadHash,
      row.syncStatus,
      row.lastSyncAt,
      row.lastError,
      row.updatedAt
    ];
  }
}
