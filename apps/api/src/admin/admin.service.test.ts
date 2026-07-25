import { describe, expect, test } from 'bun:test';
import { OperatorReasonCode } from '@dailydraft/db';

import {
  assertPauseVersionUpdated,
  assertWithinRiskLimits,
  isPauseNoop,
  readRiskLimits,
} from './admin.service.js';

describe('devnet risk controls', () => {
  test('uses conservative deterministic defaults', () => {
    expect(readRiskLimits({})).toEqual({
      allowedTiers: [50],
      houseEnabled: false,
      maxActiveDuelsPerWallet: 3,
      maxConcurrentDuelsPerTier: 20,
    });
  });

  test('normalizes allowed tiers and bounds numeric configuration', () => {
    expect(
      readRiskLimits({
        DAILYDRAFT_ALLOWED_TIERS: '100,25,invalid,100',
        DAILYDRAFT_HOUSE_ENABLED: 'true',
        DAILYDRAFT_MAX_ACTIVE_DUELS_PER_WALLET: '0',
        DAILYDRAFT_MAX_CONCURRENT_DUELS_PER_TIER: '5000',
      }),
    ).toEqual({
      allowedTiers: [25, 100],
      houseEnabled: true,
      maxActiveDuelsPerWallet: 1,
      maxConcurrentDuelsPerTier: 1_000,
    });
  });

  test('rejects exposure at either wallet or tier concurrency limit', () => {
    const limits = readRiskLimits({});

    expect(() => assertWithinRiskLimits({ limits, tierActive: 19, walletActive: 3 })).toThrow(
      'Wallet active-duel limit reached',
    );
    expect(() => assertWithinRiskLimits({ limits, tierActive: 20, walletActive: 2 })).toThrow(
      'Pack-tier concurrent-duel limit reached',
    );
    expect(() => assertWithinRiskLimits({ limits, tierActive: 19, walletActive: 2 })).not.toThrow();
  });

  test('fails closed when an explicit tier configuration is empty or malformed', () => {
    expect(readRiskLimits({ DAILYDRAFT_ALLOWED_TIERS: '' }).allowedTiers).toEqual([]);
    expect(readRiskLimits({ DAILYDRAFT_ALLOWED_TIERS: 'invalid,0,500' }).allowedTiers).toEqual([]);
  });

  test('makes identical pause retries no-ops and detects a lost version race', () => {
    expect(
      isPauseNoop(
        { paused: true, reasonCode: OperatorReasonCode.PROVIDER_DEGRADED },
        true,
        OperatorReasonCode.PROVIDER_DEGRADED,
      ),
    ).toBe(true);
    expect(
      isPauseNoop(
        { paused: true, reasonCode: OperatorReasonCode.PROVIDER_DEGRADED },
        false,
        OperatorReasonCode.MAINTENANCE,
      ),
    ).toBe(false);
    expect(() => assertPauseVersionUpdated(0)).toThrow('changed concurrently');
    expect(() => assertPauseVersionUpdated(1)).not.toThrow();
  });
});
