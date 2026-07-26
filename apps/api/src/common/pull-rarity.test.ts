import { describe, expect, test } from 'bun:test';

import { rarityForSerializedValue } from './pull-rarity.js';

describe('rarityForSerializedValue', () => {
  test('derives rarity only from canonical serialized minor units', () => {
    expect(rarityForSerializedValue('9999999', 6)).toBe('common');
    expect(rarityForSerializedValue('10000000', 6)).toBe('uncommon');
    expect(rarityForSerializedValue('50000000', 6)).toBe('rare');
    expect(rarityForSerializedValue('150000000', 6)).toBe('chase');
  });

  test('fails closed instead of fabricating missing or malformed value data', () => {
    for (const [valueMinor, decimals] of [
      [undefined, 6],
      [null, 6],
      ['', 6],
      ['01', 6],
      ['not-a-number', 6],
      ['150000000', undefined],
      ['150000000', null],
      [150000000, 6],
    ]) {
      expect(rarityForSerializedValue(valueMinor, decimals)).toBe('common');
    }
  });
});
