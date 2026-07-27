import {
  GAME_CATALOG_SCHEMA_VERSION,
  type GameCatalog,
  type GameCatalogMode,
} from '@dailydraft/contracts';

export type { GameCatalog, GameCatalogMode };

export type GameCatalogFreshness = 'error' | 'live' | 'loading' | 'stale';

/**
 * Safe first paint and total-failure fallback.
 *
 * Runtime-backed modes expose no action until the API proves them ready.
 * Fixture previews remain navigable because they cannot move funds or assets.
 */
export function fallbackGameCatalog(
  reason = 'Live capability checks are still loading. No value-bearing action is available.',
): GameCatalog {
  return {
    asOf: new Date(0).toISOString(),
    modes: [
      unavailableRuntimeMode({
        description:
          'Open the same sports pack tier against another wallet or an explicitly enabled house opponent.',
        id: 'duel',
        name: 'Card Duel',
        reason,
        source: 'duel-readiness',
      }),
      unavailableRuntimeMode({
        description:
          'Rip from a sealed sports-card inventory pool with committed odds and a verified deposit before reveal.',
        id: 'gacha',
        name: 'Sports Pack Gacha',
        reason,
        source: 'gacha-capability',
      }),
      {
        availableActions: [
          {
            href: '/games/marketplace-flip',
            id: 'view-preview',
            label: 'View fixture preview',
          },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description:
          'Trade against a committed marketplace quote once inventory, custody, pricing, and settlement are implemented.',
        id: 'flip',
        name: 'Marketplace Flip',
        reason:
          'Fixture preview only. Marketplace inventory, custody, pricing, and settlement are not live.',
        state: 'preview',
      },
      {
        availableActions: [
          { href: '/games/crash', id: 'view-preview', label: 'View fixture preview' },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description:
          'Build a card streak and choose whether to continue or cash out before a committed bust condition.',
        id: 'crash',
        name: 'Card Streak',
        reason:
          'Fixture preview only. Live card-stage economics, custody, and settlement are not enabled.',
        state: 'preview',
      },
    ],
    network: 'solana-devnet',
    schemaVersion: GAME_CATALOG_SCHEMA_VERSION,
  };
}

export function playableGameModes(catalog: GameCatalog): GameCatalogMode[] {
  return catalog.modes.filter(
    (mode) => mode.state === 'playable' && mode.availableActions.length > 0,
  );
}

export function roadmapGameModes(catalog: GameCatalog): GameCatalogMode[] {
  return catalog.modes.filter((mode) => mode.state !== 'playable');
}

export function gateRuntimeActions(
  catalog: GameCatalog,
  freshness: GameCatalogFreshness,
): GameCatalog {
  if (freshness === 'live' || freshness === 'error') return catalog;

  const reason =
    freshness === 'stale'
      ? 'The last capability response is stale. A current server check is required before play.'
      : 'Live capability is being refreshed. No action is available until the server confirms it.';

  return {
    ...catalog,
    modes: catalog.modes.map((mode) =>
      mode.capabilitySource.kind === 'runtime'
        ? {
            ...mode,
            availableActions: [],
            capabilitySource: { ...mode.capabilitySource, status: 'degraded' },
            reason,
            state: 'degraded',
          }
        : mode,
    ),
  };
}

function unavailableRuntimeMode(input: {
  description: string;
  id: 'duel' | 'gacha';
  name: string;
  reason: string;
  source: 'duel-readiness' | 'gacha-capability';
}): GameCatalogMode {
  return {
    availableActions: [],
    capabilitySource: { kind: 'runtime', name: input.source, status: 'degraded' },
    description: input.description,
    id: input.id,
    name: input.name,
    reason: input.reason,
    state: 'unavailable',
  };
}
