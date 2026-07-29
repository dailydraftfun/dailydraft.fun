import { describe, expect, test } from 'bun:test';
import { GAME_CATALOG_SCHEMA_VERSION, type GameCatalog } from '@dailydraft/contracts/game-catalog';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  PolicyStatusSurface,
  type PolicySurfaceState,
  resolvePolicySurface,
} from './policy-status';

describe('responsible-play policy status', () => {
  test.each([
    ['enabled', 'Devnet capability'],
    ['denied', 'Unavailable by policy'],
    ['loading', 'Checking policy'],
    ['malformed', 'Policy unavailable'],
  ] as const)('renders the %s state accessibly', (status, label) => {
    const state = {
      reason: `${status} player-facing reason`,
      status,
    } as PolicySurfaceState;
    const markup = renderToStaticMarkup(<PolicyStatusSurface state={state} />);

    expect(markup).toContain(`data-policy-state="${status}"`);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain(label);
    expect(markup).toContain(`${status} player-facing reason`);
    expect(markup).toContain('<summary');
    if (status === 'denied' || status === 'malformed') {
      expect(markup).toContain('aria-disabled="true"');
    }
  });

  test('labels devnet without implying production approval', () => {
    expect(resolvePolicySurface(catalog(true))).toEqual({
      reason:
        'Devnet test assets only. Availability does not imply legal, provider, or mainnet approval.',
      status: 'enabled',
    });
  });

  test('surfaces the stable public reason when every runtime action is denied', () => {
    expect(resolvePolicySurface(catalog(false))).toEqual({
      reason: 'Play is unavailable under the current responsible-play policy.',
      status: 'denied',
    });
  });
});

function catalog(enabled: boolean): GameCatalog {
  return {
    asOf: '2026-07-29T00:00:00.000Z',
    modes: [
      {
        availableActions: enabled
          ? [{ href: '/games/duel', id: 'direct-challenge', label: 'Challenge a wallet' }]
          : [],
        capabilitySource: { kind: 'runtime', name: 'duel-readiness', status: 'verified' },
        description: 'Runtime-backed mode.',
        id: 'duel',
        name: 'Card Duel',
        reason: enabled
          ? 'Devnet action ready.'
          : 'Play is unavailable under the current responsible-play policy.',
        state: enabled ? 'playable' : 'unavailable',
      },
      {
        availableActions: [],
        capabilitySource: { kind: 'runtime', name: 'gacha-capability', status: 'gated' },
        description: 'Runtime-backed mode.',
        id: 'gacha',
        name: 'Sports Pack Gacha',
        reason: 'Unavailable.',
        state: 'unavailable',
      },
      {
        availableActions: [
          { href: '/games/marketplace-flip', id: 'view-preview', label: 'View preview' },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Fixture mode.',
        id: 'flip',
        name: 'Marketplace Flip',
        reason: 'Fixture only.',
        state: 'preview',
      },
      {
        availableActions: [{ href: '/games/crash', id: 'view-preview', label: 'View preview' }],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Fixture mode.',
        id: 'crash',
        name: 'Card Streak',
        reason: 'Fixture only.',
        state: 'preview',
      },
    ],
    network: 'solana-devnet',
    schemaVersion: GAME_CATALOG_SCHEMA_VERSION,
  };
}
