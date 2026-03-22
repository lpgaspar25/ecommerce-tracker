import { describe, expect, it } from 'vitest';
import { canonicalHash } from '../src/lib/hash.js';

describe('canonicalHash', () => {
  it('gera o mesmo hash para objetos com mesma estrutura e ordem de chaves diferente', () => {
    const a = {
      b: 2,
      a: 1,
      nested: {
        z: 9,
        y: ['x', 'w']
      }
    };

    const b = {
      nested: {
        y: ['x', 'w'],
        z: 9
      },
      a: 1,
      b: 2
    };

    expect(canonicalHash(a)).toBe(canonicalHash(b));
  });

  it('gera hash diferente quando payload muda', () => {
    const base = { adName: 'Ad 1', headlines: ['A'] };
    const changed = { adName: 'Ad 1', headlines: ['B'] };

    expect(canonicalHash(base)).not.toBe(canonicalHash(changed));
  });
});
