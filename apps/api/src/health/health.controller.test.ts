import { describe, expect, test } from 'bun:test';

import { publicProductCapabilities } from './public-product-capabilities.js';

describe('public product capabilities', () => {
  test('keeps house play hidden until every devnet dependency is verified', () => {
    const capabilities = publicProductCapabilities(readiness({ treasuryVerified: false }));

    expect(capabilities.modes.direct).toEqual({ enabled: true, reason: null });
    expect(capabilities.modes.open).toEqual({ enabled: true, reason: null });
    expect(capabilities.modes.house).toEqual({
      admission: expect.objectContaining({
        approvalStatus: 'devnet-preview-no-legal-or-live-provider-approval',
        network: 'solana-devnet',
        preFundingRecheck: 'immediately-before-duel-creation',
      }),
      enabled: false,
      reason: 'House admission is blocked until a fresh finalized treasury balance is verified.',
    });
  });

  test('exposes house play only after provider, RPC, database, and treasury readiness', () => {
    expect(publicProductCapabilities(readiness()).modes.house).toEqual({
      admission: expect.objectContaining({
        currency: 'USDC',
        decimals: 6,
        limits: expect.objectContaining({
          maxActivePerWallet: expect.any(Number),
          maxConcurrentPerTier: expect.any(Number),
        }),
        opponent: {
          label: 'DailyDraft House',
          wallet: null,
        },
        valuation: expect.objectContaining({
          comparisonMetric: 'insured-value',
          policyHash: expect.any(String),
          policyVersion: expect.any(String),
          tieRule: 'return-original-assets-and-refund-platform-fees',
        }),
      }),
      enabled: true,
      reason: null,
    });
  });

  test('publishes the exact live House admission blocker', () => {
    expect(
      publicProductCapabilities(
        readiness({
          treasuryConfigurationErrors: ['withdrawal_authority_not_separated'],
          treasuryVerified: false,
        }),
      ).modes.house.reason,
    ).toBe(
      'House admission is blocked by treasury configuration: withdrawal authority not separated.',
    );

    expect(
      publicProductCapabilities(readiness({ treasuryEntryEnabled: false })).modes.house.reason,
    ).toBe('House admission is disabled by the reviewed runtime configuration.');

    expect(
      publicProductCapabilities(
        readiness({ treasuryUnresolvedReconciliationDiscrepancies: 1, treasuryVerified: false }),
      ).modes.house.reason,
    ).toBe(
      'House admission is blocked until all treasury reconciliation discrepancies are resolved.',
    );
  });

  test('publishes one playable pack tier and explicit coming-soon alternatives', () => {
    expect(publicProductCapabilities(readiness()).packs).toEqual([
      {
        enabled: false,
        id: 'pokemon_25',
        name: 'Pokémon $25 Pack',
        reason: 'The $25 pack tier is coming soon.',
        tier: 25,
      },
      {
        enabled: true,
        id: 'pokemon_50',
        name: 'Pokémon $50 Pack',
        reason: null,
        tier: 50,
      },
      {
        enabled: false,
        id: 'pokemon_100',
        name: 'Pokémon $100 Pack',
        reason: 'The $100 pack tier is coming soon.',
        tier: 100,
      },
    ]);
  });

  test('fails every playable choice closed when core devnet readiness is unavailable', () => {
    const capabilities = publicProductCapabilities(readiness({ providerVerified: false }));

    expect(capabilities.modes.direct).toEqual({
      enabled: false,
      reason: 'Duel play is not ready on Solana devnet.',
    });
    expect(capabilities.modes.open).toEqual({
      enabled: false,
      reason: 'Duel play is not ready on Solana devnet.',
    });
    expect(capabilities.packs.find((pack) => pack.id === 'pokemon_50')).toEqual({
      enabled: false,
      id: 'pokemon_50',
      name: 'Pokémon $50 Pack',
      reason: 'Duel play is not ready on Solana devnet.',
      tier: 50,
    });
  });

  test('passes through future provider modes without widening the public response surface', () => {
    const capabilities = publicProductCapabilities(
      readiness({ providerMode: 'dailydraft-devnet' }),
    );

    expect(capabilities.provider).toEqual({ mode: 'dailydraft-devnet', ready: true });
  });
});

function readiness({
  providerMode = 'mock',
  providerVerified = true,
  treasuryConfigurationErrors = [],
  treasuryEntryEnabled = true,
  treasuryUnresolvedReconciliationDiscrepancies = 0,
  treasuryVerified = true,
}: {
  providerMode?: string;
  providerVerified?: boolean;
  treasuryConfigurationErrors?: string[];
  treasuryEntryEnabled?: boolean;
  treasuryUnresolvedReconciliationDiscrepancies?: number | null;
  treasuryVerified?: boolean;
} = {}) {
  return {
    database: { reachable: true },
    provider: {
      configured: true,
      credentialConfigured: false,
      mode: providerMode,
      verified: providerVerified,
    },
    recovery: { ready: true, unboundEscrowAlerts: 0 },
    rpc: {
      configured: true,
      reachable: true,
      usesPublicDefault: false,
      verifiedDevnet: true,
    },
    treasury: {
      configured: treasuryConfigurationErrors.length === 0,
      configurationErrors: treasuryConfigurationErrors,
      entryEnabled: treasuryEntryEnabled,
      escrowProgramIdConfigured: true,
      finalizedBalanceSnapshotFresh: treasuryVerified,
      finalizedBalanceVerifiedAt: new Date().toISOString(),
      fundingSignerConfigured: true,
      houseEnabled: treasuryEntryEnabled,
      houseWalletConfigured: true,
      separationOfDuties: true,
      usdcTokenAccountConfigured: true,
      unresolvedReconciliationDiscrepancies: treasuryUnresolvedReconciliationDiscrepancies,
      verified: treasuryVerified,
      withdrawalAuthorityConfigured: true,
    },
    workers: { cronSecretConfigured: true },
  };
}
