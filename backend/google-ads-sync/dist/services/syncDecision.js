export function computeSyncDecision(row, nextHash) {
    const desired = String(row.desiredState || '').trim().toUpperCase();
    if (desired === 'READY') {
        if (!row.googleAdId) {
            return { action: 'create', reason: 'google_ad_id_missing' };
        }
        if (row.lastPayloadHash !== nextHash) {
            return { action: 'update', reason: 'payload_changed' };
        }
        return { action: 'noop', reason: 'payload_unchanged' };
    }
    if (desired === 'INACTIVE') {
        if (!row.googleAdId) {
            return { action: 'noop', reason: 'inactive_without_google_ad_id' };
        }
        return { action: 'pause', reason: 'requested_inactive' };
    }
    return { action: 'noop', reason: 'invalid_desired_state' };
}
function parseJsonArray(raw, label, errors) {
    const value = String(raw || '').trim();
    if (!value)
        return [];
    try {
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed)) {
            errors.push(`${label} deve ser um array JSON.`);
            return [];
        }
        return parsed
            .map((item) => String(item || '').trim())
            .filter(Boolean);
    }
    catch {
        errors.push(`${label} inválido: JSON malformado.`);
        return [];
    }
}
export function buildPayloadFromRow(row) {
    const errors = [];
    const customerId = String(row.customerId || '').trim();
    const campaignId = String(row.campaignId || '').trim();
    const adGroupId = String(row.adGroupId || '').trim();
    const adName = String(row.adName || '').trim();
    const finalUrl = String(row.finalUrl || '').trim();
    const callToAction = String(row.callToAction || '').trim();
    const desired = String(row.desiredState || '').trim().toUpperCase();
    const parseErrorsRef = desired === 'READY' ? errors : [];
    const headlines = parseJsonArray(row.headlinesJson, 'HeadlinesJSON', parseErrorsRef);
    const descriptions = parseJsonArray(row.descriptionsJson, 'DescriptionsJSON', parseErrorsRef);
    const marketingImageAssetIds = parseJsonArray(row.marketingImageAssetIdsJson, 'MarketingImageAssetIDsJSON', parseErrorsRef);
    const squareMarketingImageAssetIds = parseJsonArray(row.squareMarketingImageAssetIdsJson, 'SquareMarketingImageAssetIDsJSON', parseErrorsRef);
    const logoImageAssetIds = parseJsonArray(row.logoImageAssetIdsJson, 'LogoImageAssetIDsJSON', parseErrorsRef);
    const youtubeVideoAssetIds = parseJsonArray(row.youtubeVideoAssetIdsJson, 'YouTubeVideoAssetIDsJSON', parseErrorsRef);
    if (desired === 'READY') {
        if (!customerId)
            errors.push('CustomerID é obrigatório para READY.');
        if (!campaignId)
            errors.push('CampaignID é obrigatório para READY.');
        if (!adGroupId)
            errors.push('AdGroupID é obrigatório para READY.');
        if (!adName)
            errors.push('AdName é obrigatório para READY.');
        if (!finalUrl)
            errors.push('FinalURL é obrigatório para READY.');
        if (headlines.length === 0)
            errors.push('HeadlinesJSON precisa de ao menos 1 item.');
        if (descriptions.length === 0)
            errors.push('DescriptionsJSON precisa de ao menos 1 item.');
        if (marketingImageAssetIds.length === 0)
            errors.push('MarketingImageAssetIDsJSON precisa de ao menos 1 item.');
        if (squareMarketingImageAssetIds.length === 0)
            errors.push('SquareMarketingImageAssetIDsJSON precisa de ao menos 1 item.');
    }
    if (!['READY', 'INACTIVE'].includes(desired)) {
        errors.push('DesiredState deve ser READY ou INACTIVE.');
    }
    if (errors.length > 0) {
        return { payload: null, errors };
    }
    return {
        payload: {
            customerId,
            campaignId,
            adGroupId,
            adName,
            finalUrl,
            headlines,
            descriptions,
            marketingImageAssetIds,
            squareMarketingImageAssetIds,
            logoImageAssetIds,
            youtubeVideoAssetIds,
            callToAction
        },
        errors: []
    };
}
