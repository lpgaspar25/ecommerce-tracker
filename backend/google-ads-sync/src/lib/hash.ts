import crypto from 'node:crypto';

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortDeep);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }

  return value;
}

export function canonicalHash(input: unknown): string {
  const normalized = sortDeep(input);
  const json = JSON.stringify(normalized);
  return crypto.createHash('sha256').update(json).digest('hex');
}
