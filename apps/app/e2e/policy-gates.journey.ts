import type { GameCatalog } from '@dailydraft/contracts/game-catalog';

import { expect, test } from './fixtures/playwright';

const GAME_CATALOG_SCHEMA_VERSION = 'dailydraft.game-catalog.v1' as const;
const catalogUrl = '**/__journey/v1/games/catalog';

test.use({ journeySeed: 'policy-gates' });

test('unapproved real-value policy cannot render an action', async ({ journey, page }) => {
  expect(journey.seed).toBe('policy-gates');
  await page.route(catalogUrl, (route) =>
    route.fulfill({ body: JSON.stringify(catalog(false)), contentType: 'application/json' }),
  );

  await page.goto('/games');

  const status = page.locator('[data-policy-state="denied"]');
  await expect(status).toBeVisible();
  await expect(status).toContainText('Unavailable by policy');
  await status.locator('summary').click();
  await expect(status).toContainText('responsible-play policy');
  await expect(page.getByRole('link', { name: 'Challenge a wallet' })).toHaveCount(0);
});

test('a stale client claim is withheld until a fresh server response', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('policy-gates');
  let serveFresh = true;
  await page.route(catalogUrl, (route) => {
    if (!serveFresh) return route.abort('failed');
    return route.fulfill({
      body: JSON.stringify(catalog(true)),
      contentType: 'application/json',
    });
  });

  await page.goto('/games');
  await expect(page.locator('[data-policy-state="enabled"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Challenge a wallet' }).first()).toBeVisible();

  serveFresh = false;
  await page.reload();

  await expect(page.getByRole('link', { name: 'Challenge a wallet' })).toHaveCount(0);
  await expect(page.getByText('Stale capability')).toBeVisible();
});

test('malformed policy evidence fails closed while fixture routes remain testable', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('policy-gates');
  await page.route(catalogUrl, (route) =>
    route.fulfill({ body: '{"schemaVersion":"wrong"}', contentType: 'application/json' }),
  );

  await page.goto('/games');

  await expect(page.locator('[data-policy-state="malformed"]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Challenge a wallet' })).toHaveCount(0);
  await page.goto('/games/marketplace-flip');
  await expect(page.getByRole('heading', { name: 'Marketplace Flip' })).toBeVisible();
});

function catalog(enabled: boolean): GameCatalog {
  return {
    asOf: '2026-07-29T00:00:00.000Z',
    modes: [
      {
        availableActions: enabled
          ? [{ href: '/games/duel', id: 'direct-challenge', label: 'Challenge a wallet' }]
          : [],
        capabilitySource: {
          kind: 'runtime',
          name: 'duel-readiness',
          status: enabled ? 'verified' : 'gated',
        },
        description: 'Runtime-backed Duel.',
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
        description: 'Runtime-backed Gacha.',
        id: 'gacha',
        name: 'Sports Pack Gacha',
        reason: 'Unavailable by policy.',
        state: 'unavailable',
      },
      {
        availableActions: [
          {
            href: '/games/marketplace-flip',
            id: 'play-demo',
            label: 'Play free demo',
          },
        ],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Playable no-value Marketplace Flip demo.',
        id: 'flip',
        name: 'Marketplace Flip',
        reason: 'Playable no-value devnet demo.',
        state: 'playable',
      },
      {
        availableActions: [{ href: '/games/crash', id: 'play-demo', label: 'Play free demo' }],
        capabilitySource: { kind: 'fixture', name: 'rgs-fixture', status: 'gated' },
        description: 'Playable no-value Card Streak demo.',
        id: 'crash',
        name: 'Card Streak',
        reason: 'Playable no-value devnet demo.',
        state: 'playable',
      },
    ],
    network: 'solana-devnet',
    schemaVersion: GAME_CATALOG_SCHEMA_VERSION,
  };
}
