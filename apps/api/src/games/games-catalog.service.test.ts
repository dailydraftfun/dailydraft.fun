import { describe, expect, test } from 'bun:test';

import type { AdminService } from '../admin/admin.service.js';
import type { GachaRipService } from '../gacha/gacha-rip.service.js';
import {
  GamesCatalogService,
  resolveDuelCatalogMode,
  resolveGachaCatalogMode,
} from './games-catalog.service.js';

describe('games catalog', () => {
  test('derives Duel actions from runtime readiness and keeps House inside Duel', () => {
    const mode = resolveDuelCatalogMode(readiness(), admission());

    expect(mode).toMatchObject({
      capabilitySource: { kind: 'runtime', name: 'duel-readiness', status: 'verified' },
      id: 'duel',
      state: 'playable',
    });
    expect(mode.availableActions.map((action) => action.id)).toEqual([
      'direct-challenge',
      'open-matchmaking',
      'house-opponent',
    ]);
    expect(mode.availableActions.every((action) => action.href === '/games/duel')).toBe(true);
  });

  test('fails Duel closed when no pack tier is ready', () => {
    const mode = resolveDuelCatalogMode(readiness({ providerVerified: false }), admission());

    expect(mode.state).toBe('unavailable');
    expect(mode.availableActions).toEqual([]);
    expect(mode.reason).toBe('Duel play is not ready on Solana devnet.');
  });

  test('fails Duel closed while an operator pause is active', () => {
    const mode = resolveDuelCatalogMode(readiness(), admission({ paused: true }));

    expect(mode.state).toBe('unavailable');
    expect(mode.availableActions).toEqual([]);
    expect(mode.reason).toBe('New Duel exposure is paused by an operator.');
  });

  test('fails Duel closed when risk controls admit no supported tier', () => {
    const mode = resolveDuelCatalogMode(readiness(), admission({ allowedTiers: [] }));

    expect(mode.state).toBe('unavailable');
    expect(mode.availableActions).toEqual([]);
    expect(mode.reason).toBe('No supported Duel tier is admitted by devnet risk controls.');
  });

  test('derives Gacha from its live capability service', () => {
    expect(
      resolveGachaCatalogMode({
        availability: 'playable',
        gates: { acquisition: true, odds: true, provider: true, settlement: true },
        providerMode: 'dailydraft-devnet',
        reason: 'All runtime gates passed.',
      }),
    ).toMatchObject({
      availableActions: [{ href: '/games/gacha', id: 'rip-pack', label: 'Rip a sports pack' }],
      id: 'gacha',
      reason: 'All runtime gates passed.',
      state: 'playable',
    });
  });

  test('publishes exactly four canonical modes and leaves fixtures preview-only', async () => {
    const service = serviceWith({
      gachaCapability: {
        availability: 'preview',
        gates: { acquisition: false, odds: true, provider: true, settlement: false },
        providerMode: 'dailydraft-devnet',
        reason: 'Pending Gacha capability gates: acquisition, settlement',
      },
      readiness: readiness(),
    });

    const catalog = await service.getCatalog(new Date('2026-07-27T20:00:00.000Z'));

    expect(catalog.asOf).toBe('2026-07-27T20:00:00.000Z');
    expect(catalog.modes.map((mode) => mode.id)).toEqual(['duel', 'gacha', 'flip', 'crash']);
    expect(catalog.modes.find((mode) => mode.id === 'gacha')).toMatchObject({
      availableActions: [],
      state: 'preview',
    });
    for (const id of ['flip', 'crash']) {
      expect(catalog.modes.find((mode) => mode.id === id)).toMatchObject({
        capabilitySource: { kind: 'fixture', status: 'gated' },
        state: 'preview',
      });
    }
    expect(catalog.modes.find((mode) => mode.id === 'flip')?.availableActions).toEqual([
      {
        href: '/games/marketplace-flip',
        id: 'view-preview',
        label: 'View fixture preview',
      },
    ]);
  });

  test('degrades individual runtime modes instead of advertising through a failed probe', async () => {
    const service = new GamesCatalogService(
      {
        getEmergencyPause: () => Promise.resolve({ paused: false }),
        getReadiness: () => Promise.reject(new Error('database unavailable')),
      } as AdminService,
      { capability: () => Promise.reject(new Error('provider unavailable')) } as never,
    );

    const catalog = await service.getCatalog(new Date('2026-07-27T20:00:00.000Z'));

    expect(catalog.modes.slice(0, 2).map((mode) => mode.state)).toEqual(['degraded', 'degraded']);
    expect(catalog.modes.slice(0, 2).every((mode) => mode.availableActions.length === 0)).toBe(
      true,
    );
  });
});

function serviceWith(input: {
  gachaCapability: ReturnType<GachaRipService['capability']>;
  readiness: Awaited<ReturnType<AdminService['getReadiness']>>;
}): GamesCatalogService {
  return new GamesCatalogService(
    {
      getEmergencyPause: () => Promise.resolve({ paused: false }),
      getReadiness: () => Promise.resolve(input.readiness),
    } as AdminService,
    { capability: () => input.gachaCapability } as GachaRipService,
  );
}

function admission({
  allowedTiers = [25, 50, 100],
  paused = false,
}: {
  allowedTiers?: number[];
  paused?: boolean;
} = {}) {
  return { allowedTiers, paused };
}

function readiness({
  providerVerified = true,
}: {
  providerVerified?: boolean;
} = {}): Awaited<ReturnType<AdminService['getReadiness']>> {
  return {
    database: { reachable: true },
    provider: {
      configured: true,
      credentialConfigured: true,
      mode: 'dailydraft-devnet',
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
      finalizedBalanceSnapshotFresh: true,
      finalizedBalanceVerifiedAt: '2026-07-27T20:00:00.000Z',
      fundingSignerConfigured: true,
      houseEnabled: true,
      houseWalletConfigured: true,
      separationOfDuties: true,
      usdcTokenAccountConfigured: true,
      verified: true,
      withdrawalAuthorityConfigured: true,
    },
    workers: { cronSecretConfigured: true },
  };
}
