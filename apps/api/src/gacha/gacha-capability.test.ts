import { describe, expect, test } from 'bun:test';

import {
  GACHA_DEVNET_CAPABILITY,
  type GachaCapabilityGates,
  resolveGachaCapability,
} from './gacha-capability.js';

describe('Gacha capability resolver', () => {
  test('makes Gacha playable only when every capability passes', () => {
    expect(
      resolveGachaCapability({
        acquisition: true,
        odds: true,
        provider: true,
        settlement: true,
      }),
    ).toEqual({
      availability: 'playable',
      reason: 'Provider, odds, acquisition, and settlement gates are ready',
    });
  });

  test('keeps Gacha in preview for each independently missing capability', () => {
    for (const gate of ['provider', 'odds', 'acquisition', 'settlement'] as const) {
      const capabilities: GachaCapabilityGates = {
        acquisition: true,
        odds: true,
        provider: true,
        settlement: true,
      };
      capabilities[gate] = false;

      expect(resolveGachaCapability(capabilities)).toMatchObject({
        availability: 'preview',
      });
      expect(resolveGachaCapability(capabilities).reason).toContain(gate);
    }
  });

  test('keeps the real devnet capability fail-closed', () => {
    expect(GACHA_DEVNET_CAPABILITY).toMatchObject({ availability: 'preview' });
  });
});
