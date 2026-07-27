import { describe, expect, test } from 'bun:test';
import type {
  GachaInventoryEntry,
  GachaInventorySnapshot,
  GachaRip,
} from '../../solana/gacha-client';
import {
  describeFlipReveal,
  getFlipCardImageUrl,
  resolveFlipRarity,
} from './flip-reveal-presentation';

const MACHINE_KEY = 'dailydraft-devnet-football-50000000';
const MAC = 'a'.repeat(32);

/** The sealed bands the devnet odds calculator commits, in USDC minor units. */
const BAND_MINIMUMS = { base: '0', chase: '5000000', plus: '250000', premium: '1000000' };

function assetReference(cardId: string, machineKey = MACHINE_KEY): string {
  return `devnet:sports-pack:${machineKey}:${cardId}:${MAC}`;
}

function entry(overrides: Partial<GachaInventoryEntry> = {}): GachaInventoryEntry {
  return {
    assetReference: assetReference('base1-4'),
    displayName: 'Charizard',
    eligible: true,
    exclusionReasons: [],
    graded: true,
    graderReference: 'PSA-9',
    id: 'gachaitem_1',
    insuredValueCurrency: 'USDC',
    insuredValueDecimals: 6,
    insuredValueMinor: '1500000',
    insuredValueProviderReference: null,
    inventorySourceTimestamp: null,
    ordinal: 0,
    poolOpen: true,
    providerCardReference: 'base1-4',
    snapshotId: 'gachasnap_1',
    sport: 'FOOTBALL',
    tierEnabled: true,
    valuationSourceReference: null,
    valuationTimestamp: null,
    ...overrides,
  };
}

function snapshot(entries: GachaInventoryEntry[]): GachaInventorySnapshot {
  return {
    committedPoolSize: entries.length,
    contentHash: 'c'.repeat(64),
    eligibleCount: entries.length,
    eligibleValueMinor: '1500000',
    entries,
    evaluatedAt: '2026-07-26T00:00:00.000Z',
    excludedCount: 0,
    id: 'gachasnap_1',
    machine: {
      active: true,
      committedPoolSize: entries.length,
      displayName: 'Football $50',
      id: 'gachamachine_1',
      machineKey: MACHINE_KEY,
      sport: 'FOOTBALL',
      tierPriceCurrency: 'USDC',
      tierPriceDecimals: 6,
      tierPriceMinor: '50000000',
    },
    machineKey: MACHINE_KEY,
    policyHash: 'p'.repeat(64),
    policyVersion: 'dailydraft-devnet-valuation.v1',
    poolKey: 'dailydraft-devnet-sports-pack.v1',
    provider: 'dailydraft-devnet',
    revision: 1,
    schemaVersion: '1',
    sealedAt: '2026-07-26T00:00:00.000Z',
  };
}

function rip(overrides: Partial<GachaRip> = {}): GachaRip {
  return {
    acquiredAt: null,
    acquisitionReference: null,
    createdAt: '2026-07-26T00:00:00.000Z',
    failedAssetReference: null,
    failedAt: null,
    failureReason: null,
    id: 'gacharip_1',
    idempotencyKey: 'opd-rip-gachaseed_abc',
    insuredValueCurrency: 'USDC',
    insuredValueDecimals: 6,
    insuredValueMinor: '1500000',
    machineKey: MACHINE_KEY,
    oddsCommitmentId: 'gachaodds_1',
    oddsRulesHash: 'r'.repeat(64),
    revealedAt: '2026-07-26T00:00:01.000Z',
    seedCommitmentHash: 's'.repeat(64),
    selectedAssetReference: assetReference('base1-4'),
    selectedAt: '2026-07-26T00:00:00.500Z',
    settledAt: '2026-07-26T00:00:02.000Z',
    settlementReference: 'devnet:settlement:1',
    snapshotContentHash: 'c'.repeat(64),
    status: 'SETTLED',
    updatedAt: '2026-07-26T00:00:02.000Z',
    ...overrides,
  };
}

describe('flip card art', () => {
  test('reads the card id out of a well-formed devnet asset reference', () => {
    expect(getFlipCardImageUrl(assetReference('base1-4'), MACHINE_KEY)).toBe(
      'https://images.pokemontcg.io/base1-4.png',
    );
  });

  test('strips the machine key rather than splitting on a fixed index', () => {
    // The server's machineKey validator permits colons, so an index-based split
    // would read the wrong segment as the card id for a key like this one.
    const colonKey = 'dailydraft:devnet:football:50000000';
    expect(getFlipCardImageUrl(assetReference('sv1-25', colonKey), colonKey)).toBe(
      'https://images.pokemontcg.io/sv1-25.png',
    );
  });

  test('falls back to the text card for a reference this surface cannot read', () => {
    for (const [reference, machineKey] of [
      [null, MACHINE_KEY],
      [undefined, MACHINE_KEY],
      ['', MACHINE_KEY],
      ['devnet:sports-pack:x', MACHINE_KEY],
      // Right shape, wrong machine — never borrow another pool's art.
      [assetReference('base1-4', 'dailydraft-devnet-soccer-50000000'), MACHINE_KEY],
      // Truncated: prefix present but no trailing signer segment.
      [`devnet:sports-pack:${MACHINE_KEY}:base1-4`, MACHINE_KEY],
      [`devnet:sports-pack:${MACHINE_KEY}::${MAC}`, MACHINE_KEY],
    ] as const) {
      expect(getFlipCardImageUrl(reference, machineKey)).toBeUndefined();
    }
  });

  test('refuses a card id that could walk out of the image path', () => {
    for (const cardId of ['../../secret', 'a/b', '..', 'base1.4', 'base1 4', 'base1_4']) {
      expect(getFlipCardImageUrl(assetReference(cardId), MACHINE_KEY)).toBeUndefined();
    }
  });
});

describe('flip rarity', () => {
  test('reports the highest sealed band the insured value cleared', () => {
    expect(resolveFlipRarity(BAND_MINIMUMS, '1500000')).toMatchObject({
      band: 'premium',
      label: 'Premium',
      minimumMinor: '1000000',
    });
    expect(resolveFlipRarity(BAND_MINIMUMS, '5000000')).toMatchObject({ band: 'chase' });
    expect(resolveFlipRarity(BAND_MINIMUMS, '249999')).toMatchObject({ band: 'base' });
    expect(resolveFlipRarity(BAND_MINIMUMS, '250000')).toMatchObject({ band: 'plus' });
  });

  test('ignores band labels outside the canonical four', () => {
    expect(resolveFlipRarity({ ...BAND_MINIMUMS, mythic: '1' }, '1500000')).toMatchObject({
      band: 'premium',
    });
  });

  test('returns null rather than guessing a tier the roll did not earn', () => {
    expect(resolveFlipRarity(BAND_MINIMUMS, null)).toBeNull();
    expect(resolveFlipRarity(BAND_MINIMUMS, 'not-a-number')).toBeNull();
    expect(resolveFlipRarity(null, '1500000')).toBeNull();
    // No band's minimum is cleared, so there is nothing the house committed to.
    expect(resolveFlipRarity({ chase: '5000000' }, '10')).toBeNull();
  });
});

describe('flip reveal description', () => {
  test('joins the settled rip to the sealed snapshot entry it drew from', () => {
    expect(describeFlipReveal(rip(), snapshot([entry()]), BAND_MINIMUMS)).toEqual({
      displayName: 'Charizard',
      graded: true,
      imageUrl: 'https://images.pokemontcg.io/base1-4.png',
      insuredValue: '1.5 USDC',
      rarity: {
        band: 'premium',
        blurb: 'Cleared the premium band minimum.',
        label: 'Premium',
        minimumMinor: '1000000',
      },
    });
  });

  test('falls back to the failed reference so a provider failure still shows the pick', () => {
    const failed = rip({
      failedAssetReference: assetReference('base1-4'),
      failureReason: 'provider timeout',
      insuredValueMinor: '0',
      selectedAssetReference: null,
      status: 'FAILED',
    });

    expect(describeFlipReveal(failed, snapshot([entry()]), BAND_MINIMUMS)).toMatchObject({
      displayName: 'Charizard',
      imageUrl: 'https://images.pokemontcg.io/base1-4.png',
      insuredValue: '0 USDC',
      rarity: { band: 'base' },
    });
  });

  test('degrades to placeholder copy when the snapshot carries no matching entry', () => {
    expect(describeFlipReveal(rip(), null, null)).toEqual({
      displayName: 'Vaulted card',
      graded: false,
      imageUrl: 'https://images.pokemontcg.io/base1-4.png',
      insuredValue: '1.5 USDC',
      rarity: null,
    });
    expect(
      describeFlipReveal(rip({ insuredValueMinor: 'nope' }), snapshot([]), BAND_MINIMUMS),
    ).toMatchObject({ displayName: 'Vaulted card', insuredValue: 'Value pending', rarity: null });
  });
});
