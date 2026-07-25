import { describe, expect, test } from 'bun:test';

import { publicProductCapabilities } from './health.controller.js';

describe('public product capabilities', () => {
  test('keeps house play hidden until every devnet dependency is verified', () => {
    const capabilities = publicProductCapabilities(readiness({ treasuryVerified: false }));

    expect(capabilities.modes.direct).toEqual({ enabled: true, reason: null });
    expect(capabilities.modes.open).toEqual({ enabled: true, reason: null });
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
  treasuryVerified = true,
}: {
  providerMode?: string;
  providerVerified?: boolean;
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
