import { describe, expect, test } from 'bun:test';

import {
  type GachaCapabilityGates,
  gachaDevnetCapabilities,
  gachaDevnetCapability,
  gachaDevnetModeEnabled,
  resolveGachaCapability,
} from './gacha-capability.js';

const HOUSE_TOKEN_ACCOUNT = 'Gk8Zk4hMS6z7USMLKSTP4pYVuqVFAU1zLczhBytBMQyW';
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

/**
 * Every capability reader takes its environment as a parameter, so these tests
 * pass explicit objects instead of mutating `process.env` — no save/restore
 * dance, and no cross-test leakage under Bun's shared process.
 */
const DEVNET_ENVIRONMENT: NodeJS.ProcessEnv = {
  DAILYDRAFT_HOUSE_DEVNET_USDC_MINT: USDC_MINT,
  DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT: HOUSE_TOKEN_ACCOUNT,
  DAILYDRAFT_NETWORK: 'solana-devnet',
  DAILYDRAFT_PROVIDER_MODE: 'dailydraft-devnet',
};

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

  test('reads devnet mode from the repo-wide provider selector', () => {
    expect(gachaDevnetModeEnabled(DEVNET_ENVIRONMENT)).toBe(true);
    expect(gachaDevnetModeEnabled({ DAILYDRAFT_PROVIDER_MODE: 'mock' })).toBe(false);
    expect(gachaDevnetModeEnabled({})).toBe(false);
  });

  test('opens every devnet gate once the deposit destination is configured', () => {
    expect(gachaDevnetCapabilities(DEVNET_ENVIRONMENT)).toEqual({
      acquisition: true,
      odds: true,
      provider: true,
      settlement: true,
    });
    expect(gachaDevnetCapability(DEVNET_ENVIRONMENT)).toMatchObject({
      availability: 'playable',
    });
  });

  test('keeps acquisition and settlement closed when the deposit rail is unconfigured', () => {
    const { DAILYDRAFT_HOUSE_DEVNET_USDC_TOKEN_ACCOUNT: _omitted, ...withoutTokenAccount } =
      DEVNET_ENVIRONMENT;

    expect(gachaDevnetCapabilities(withoutTokenAccount)).toEqual({
      acquisition: false,
      odds: true,
      provider: true,
      settlement: false,
    });
    expect(gachaDevnetCapability(withoutTokenAccount).reason).toContain('acquisition');
  });

  test('stays fail-closed outside devnet provider mode', () => {
    const production: NodeJS.ProcessEnv = {
      ...DEVNET_ENVIRONMENT,
      DAILYDRAFT_PROVIDER_MODE: 'mock',
    };

    expect(gachaDevnetCapabilities(production)).toEqual({
      acquisition: false,
      odds: false,
      provider: false,
      settlement: false,
    });
    expect(gachaDevnetCapability(production)).toMatchObject({ availability: 'preview' });
    expect(gachaDevnetCapability({})).toMatchObject({ availability: 'preview' });
  });
});
