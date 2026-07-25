import { afterEach, describe, expect, test } from 'bun:test';
import type { DatabaseClient } from '@dailydraft/db';
import { OperatorReasonCode } from '@dailydraft/db';

import type { SolanaRpcGateway } from '../transactions/solana-rpc.client.js';
import {
  AdminService,
  assertPauseVersionUpdated,
  assertWithinRiskLimits,
  isPauseNoop,
  readRiskLimits,
} from './admin.service.js';

const PROVIDER_ENVIRONMENT_KEYS = [
  'COLLECTOR_CRYPT_API_KEY',
  'DAILYDRAFT_DEVNET_PROVIDER_KEYPAIR_JSON',
  'DAILYDRAFT_PROVIDER_ASSET_STANDARD',
  'DAILYDRAFT_PROVIDER_MODE',
  'ESCROW_PROVIDER_SIGNER',
] as const;

const originalProviderEnvironment = new Map(
  PROVIDER_ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
);

afterEach(() => {
  for (const [key, value] of originalProviderEnvironment) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

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

describe('readiness reporting', () => {
  test('defaults to the mock provider and reports an unreachable database', async () => {
    for (const key of PROVIDER_ENVIRONMENT_KEYS) delete process.env[key];

    const readiness = await readinessService().getReadiness();

    expect(readiness.provider).toMatchObject({
      configured: true,
      credentialConfigured: false,
      mode: 'mock',
      verified: true,
    });
    expect(readiness.database.reachable).toBe(false);
  });

  test('refuses to call the demo provider ready without its devnet credentials', async () => {
    for (const key of PROVIDER_ENVIRONMENT_KEYS) delete process.env[key];
    process.env.DAILYDRAFT_PROVIDER_ASSET_STANDARD = 'legacy-spl-nft';
    process.env.DAILYDRAFT_PROVIDER_MODE = 'dailydraft-devnet';

    const readiness = await readinessService().getReadiness();

    expect(readiness.provider).toMatchObject({
      configured: false,
      credentialConfigured: false,
      mode: 'dailydraft-devnet',
      verified: false,
    });
  });
});

// Readiness deliberately swallows every dependency failure so the probe still answers, so
// empty stubs exercise the reporting itself without standing up Prisma or an RPC endpoint.
function readinessService(): AdminService {
  return new AdminService({} as unknown as DatabaseClient, {} as unknown as SolanaRpcGateway);
}
