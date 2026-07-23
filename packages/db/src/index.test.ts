import { describe, expect, test } from 'bun:test';

import { FlipInventoryExclusionReason } from './index.js';

describe('Flip inventory database contract', () => {
  test('exports every persisted exclusion reason', () => {
    expect(Object.values(FlipInventoryExclusionReason)).toEqual([
      'EXPLICIT_EXCLUSION',
      'COLLECTION_NOT_ALLOWED',
      'GRADER_NOT_ALLOWED',
      'INVENTORY_STALE',
      'INVENTORY_FROM_FUTURE',
      'LIQUIDITY_BELOW_MINIMUM',
      'VALUE_UNAVAILABLE',
      'VALUE_STALE',
      'VALUE_FROM_FUTURE',
      'VALUE_BELOW_MINIMUM',
      'VALUE_ABOVE_MAXIMUM',
      'MAXIMUM_ITEM_COUNT',
      'MAXIMUM_EXPOSURE',
    ]);
  });
});
