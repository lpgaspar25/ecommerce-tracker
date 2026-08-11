export type SyncMode = 'manual' | 'scheduled';
export type DesiredState = 'READY' | 'INACTIVE';
export type SyncAction = 'create' | 'update' | 'pause' | 'noop';

export interface QueueRow {
  rowNumber: number;
  id: string;
  storeId: string;
  productId: string;
  customerId: string;
  campaignId: string;
  adGroupId: string;
  adName: string;
  finalUrl: string;
  headlinesJson: string;
  descriptionsJson: string;
  marketingImageAssetIdsJson: string;
  squareMarketingImageAssetIdsJson: string;
  logoImageAssetIdsJson: string;
  youtubeVideoAssetIdsJson: string;
  callToAction: string;
  desiredState: DesiredState | string;
  googleAdId: string;
  lastPayloadHash: string;
  syncStatus: string;
  lastSyncAt: string;
  lastError: string;
  updatedAt: string;
}

export interface QueuePayload {
  customerId: string;
  campaignId: string;
  adGroupId: string;
  adName: string;
  finalUrl: string;
  headlines: string[];
  descriptions: string[];
  marketingImageAssetIds: string[];
  squareMarketingImageAssetIds: string[];
  logoImageAssetIds: string[];
  youtubeVideoAssetIds: string[];
  callToAction: string;
}

export interface SyncDecision {
  action: SyncAction;
  reason: string;
}

export interface RunSummary {
  runId: string;
  mode: SyncMode;
  triggeredBy: string;
  startedAt: string;
  finishedAt: string;
  rowsRead: number;
  rowsProcessed: number;
  rowsSuccess: number;
  rowsFailed: number;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED' | 'REJECTED';
  errorSummary: string;
}

export interface RowProcessingResult {
  success: boolean;
  message: string;
}
