import { describe, expect, test } from 'bun:test';
import { activityForProof, activityItems, previewCards } from './game-preview-data';

describe('game preview data', () => {
  test('keeps receipt examples separate from fixture-only previews', () => {
    const receipts = activityForProof('receipt');

    expect(receipts).toHaveLength(3);
    expect(receipts.every((item) => item.proof === 'receipt')).toBe(true);
    expect(activityForProof('fixture')).toHaveLength(2);
    expect(activityForProof('all')).toEqual([...activityItems]);
  });

  test('uses real card assets with fixture values', () => {
    expect(previewCards.charizard.imageUrl.startsWith('https://images.pokemontcg.io/')).toBe(true);
    expect(previewCards.charizard.value).toBe(72.5);
    expect(previewCards.blastoise.name).toContain('Base Set');
  });
});
