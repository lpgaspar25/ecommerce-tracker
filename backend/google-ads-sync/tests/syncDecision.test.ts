import { describe, expect, it } from 'vitest';
import { buildPayloadFromRow, computeSyncDecision } from '../src/services/syncDecision.js';
import { QueueRow } from '../src/types.js';

function makeRow(partial: Partial<QueueRow> = {}): QueueRow {
  return {
    rowNumber: 2,
    id: 'q-1',
    storeId: 'store-1',
    productId: 'p-1',
    customerId: '1234567890',
    campaignId: '222',
    adGroupId: '333',
    adName: 'My Ad',
    finalUrl: 'https://example.com',
    headlinesJson: '["Headline 1"]',
    descriptionsJson: '["Description 1"]',
    marketingImageAssetIdsJson: '["111"]',
    squareMarketingImageAssetIdsJson: '["112"]',
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

describe('computeSyncDecision', () => {
  it('retorna create quando READY e sem GoogleAdID', () => {
    const decision = computeSyncDecision(makeRow(), 'hash');
    expect(decision.action).toBe('create');
  });

  it('retorna update quando READY e hash mudou', () => {
    const decision = computeSyncDecision(makeRow({ googleAdId: '999', lastPayloadHash: 'old' }), 'new');
    expect(decision.action).toBe('update');
  });

  it('retorna noop quando READY e hash igual', () => {
    const decision = computeSyncDecision(makeRow({ googleAdId: '999', lastPayloadHash: 'same' }), 'same');
    expect(decision.action).toBe('noop');
  });

  it('retorna pause quando INACTIVE e tem GoogleAdID', () => {
    const decision = computeSyncDecision(makeRow({ desiredState: 'INACTIVE', googleAdId: '999' }), 'hash');
    expect(decision.action).toBe('pause');
  });
});

describe('buildPayloadFromRow', () => {
  it('valida payload READY com sucesso', () => {
    const { payload, errors } = buildPayloadFromRow(makeRow());
    expect(errors).toHaveLength(0);
    expect(payload?.adName).toBe('My Ad');
  });

  it('retorna erro quando JSON está inválido', () => {
    const { errors } = buildPayloadFromRow(makeRow({ headlinesJson: 'not-json' }));
    expect(errors.join(' | ')).toContain('HeadlinesJSON inválido');
  });

  it('retorna erro quando faltam campos obrigatórios para READY', () => {
    const { errors } = buildPayloadFromRow(makeRow({ adGroupId: '', finalUrl: '' }));
    expect(errors.join(' | ')).toContain('AdGroupID é obrigatório');
    expect(errors.join(' | ')).toContain('FinalURL é obrigatório');
  });
});
