import { describe, expect, test } from 'bun:test';

import { PacksService } from './packs.service.js';

describe('PacksService', () => {
  test('lists the active preview pack by default', () => {
    const result = new PacksService().findAll({ limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('pokemon_50');
    expect(result.hasMore).toBe(false);
  });

  test('rejects unknown pack ids', () => {
    expect(() => new PacksService().findOne('missing')).toThrow('was not found');
  });
});
