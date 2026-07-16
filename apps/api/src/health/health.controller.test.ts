import { describe, expect, test } from 'bun:test';

import { publicProductCapabilities } from './health.controller.js';

describe('public product capabilities', () => {
  test('keeps house play hidden until every devnet dependency is verified', () => {
    const capabilities = publicProductCapabilities(readiness({ treasuryVerified: false }));

    expect(capabilities.modes.direct.enabled).toBe(true);
    expect(capabilities.modes.open.enabled).toBe(true);
    expect(capabilities.modes.house).toEqual({
      enabled: false,
      reason: 'House play is not ready on Solana devnet.',
    });
  });

  test('exposes house play only after provider, RPC, database, and treasury readiness', () => {
    expect(publicProductCapabilities(readiness()).modes.house).toEqual({
      enabled: true,
      reason: null,
    });
  });

  test('passes through future provider modes without widening the public response surface', () => {
    const capabilities = publicProductCapabilities(
      readiness({ providerMode: 'openpacksduel-devnet' }),
    );

    expect(capabilities.provider).toEqual({ mode: 'openpacksduel-devnet', ready: true });
  });
});

function readiness({
  providerMode = 'mock',
  treasuryVerified = true,
}: {
  providerMode?: string;
  treasuryVerified?: boolean;
} = {}) {
  return {
    database: { reachable: true },
    provider: {
      configured: true,
      credentialConfigured: false,
      mode: providerMode,
      verified: true,
    },
    recovery: { ready: true, unboundEscrowAlerts: 0 },
    rpc: {
      configured: true,
      reachable: true,
      usesPublicDefault: false,
      verifiedDevnet: true,
    },
    treasury: {
      configured: true,
      configurationErrors: [],
      entryEnabled: true,
      escrowProgramIdConfigured: true,
      finalizedBalanceSnapshotFresh: treasuryVerified,
      finalizedBalanceVerifiedAt: new Date().toISOString(),
      fundingSignerConfigured: true,
      houseEnabled: true,
      houseWalletConfigured: true,
      separationOfDuties: true,
      usdcTokenAccountConfigured: true,
      verified: treasuryVerified,
      withdrawalAuthorityConfigured: true,
    },
    workers: { cronSecretConfigured: true },
  };
}
