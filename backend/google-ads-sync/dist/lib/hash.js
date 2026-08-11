import crypto from 'node:crypto';
function sortDeep(value) {
    if (Array.isArray(value)) {
        return value.map(sortDeep);
    }
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((acc, key) => {
            acc[key] = sortDeep(value[key]);
            return acc;
        }, {});
    }
    return value;
}
export function canonicalHash(input) {
    const normalized = sortDeep(input);
    const json = JSON.stringify(normalized);
    return crypto.createHash('sha256').update(json).digest('hex');
}
