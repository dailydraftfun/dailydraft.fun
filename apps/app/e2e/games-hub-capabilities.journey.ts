import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page, Route } from '@playwright/test';

import { journeyApiOrigin, journeyGameCatalog } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

const catalogUrl = `${journeyApiOrigin}/games/catalog`;

test.use({ journeySeed: 'games-hub' });

test('publishes the four-mode capability matrix without mobile or desktop overflow', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('games-hub');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ height: 844, width: 390 });
  await Promise.all([page.waitForResponse(catalogUrl), page.goto('/games')]);

  await expect(page.getByRole('heading', { level: 1, name: /One arena/ })).toBeVisible();
  await expect(page.getByText('Card Duel', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Sports Pack Gacha', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Marketplace Flip', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Card Streak', { exact: true }).first()).toBeVisible();
  const primaryDuelAction = page.getByRole('link', { name: 'Challenge a wallet' }).first();
  await expect(primaryDuelAction).toHaveAttribute('href', '/games/duel');
  await expect(page.getByRole('link', { name: 'Rip a sports pack' })).toHaveAttribute(
    'href',
    '/games/gacha',
  );
  await expect(page.locator('a[href="/games/marketplace-flip#rules"]')).toBeVisible();
  await expect(page.locator('a[href="/games/crash#rules"]')).toBeVisible();
  await expect(page.getByText('Playable', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Fixture preview', { exact: true })).toHaveCount(2);
  await expectNoOverflow(page);
  await expectKeyboardReachable(page, primaryDuelAction);
  await expectNoSeriousOrCriticalViolations(page);

  await page.setViewportSize({ height: 900, width: 1440 });
  await expectNoOverflow(page);
});

test('labels playable, preview, degraded, and unavailable states from server evidence', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('games-hub');
  const catalog = journeyGameCatalog();
  catalog.modes = catalog.modes.map((mode) => {
    if (mode.id === 'duel') {
      return {
        ...mode,
        availableActions: [],
        capabilitySource: { ...mode.capabilitySource, status: 'degraded' as const },
        reason: 'Duel readiness timed out.',
        state: 'degraded' as const,
      };
    }
    if (mode.id === 'gacha') {
      return {
        ...mode,
        availableActions: [],
        capabilitySource: { ...mode.capabilitySource, status: 'gated' as const },
        reason: 'Gacha settlement is unavailable.',
        state: 'unavailable' as const,
      };
    }
    return mode;
  });
  await page.route(catalogUrl, (route) => fulfillCatalog(route, catalog));

  await page.goto('/games');

  await expect(page.getByRole('heading', { name: 'No unverified play.' })).toBeVisible();
  await expect(page.getByText('Degraded', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Unavailable', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Fixture preview', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Challenge a wallet' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Rip a sports pack' })).toHaveCount(0);
});

test('withholds runtime actions while loading, then recovers to live capability', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('games-hub');
  let releaseCatalog: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseCatalog = resolve;
  });
  await page.route(catalogUrl, async (route) => {
    await gate;
    await fulfillCatalog(route, journeyGameCatalog());
  });

  await page.goto('/games');
  await expect(page.getByText('Refreshing', { exact: true })).toBeVisible();
  await expect(page.getByText('Live actions withheld', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Challenge a wallet' })).toHaveCount(0);

  releaseCatalog?.();
  await expect(page.getByText('Live capability', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Challenge a wallet' }).first()).toBeVisible();
});

test('keeps cached previews stale and fails malformed or timed-out catalogs closed before recovery', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('games-hub');
  await page.addInitScript((catalog) => {
    if (window.name !== 'games-cache-seeded') {
      window.sessionStorage.setItem('dailydraft.games-catalog.v1', JSON.stringify(catalog));
      window.name = 'games-cache-seeded';
    }
  }, journeyGameCatalog());
  await page.route(catalogUrl, (route) =>
    route.fulfill({
      body: JSON.stringify({ detail: 'fixture timeout' }),
      contentType: 'application/json',
      status: 504,
    }),
  );

  await page.goto('/games');
  await expect(page.getByText('Stale capability', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Challenge a wallet' })).toHaveCount(0);
  await expect(page.locator('a[href="/games/marketplace-flip#rules"]')).toBeVisible();

  await page.unroute(catalogUrl);
  await page.evaluate(() => window.sessionStorage.clear());
  await page.route(catalogUrl, (route) =>
    route.fulfill({
      body: JSON.stringify({ asOf: 'invalid', modes: [] }),
      contentType: 'application/json',
      status: 200,
    }),
  );
  await page.reload();
  await expect(page.getByText('Unavailable', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Live actions withheld', { exact: true })).toBeVisible();

  await page.unroute(catalogUrl);
  await page.route(catalogUrl, (route) => route.abort('timedout'));
  await page.reload();
  await expect(page.getByText('Server catalog unavailable · live actions withheld')).toBeVisible();

  await page.unroute(catalogUrl);
  await page.reload();
  await expect(page.getByText('Live capability', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Rip a sports pack' })).toBeVisible();
});

async function fulfillCatalog(route: Route, catalog: ReturnType<typeof journeyGameCatalog>) {
  await route.fulfill({
    body: JSON.stringify(catalog),
    contentType: 'application/json',
    status: 200,
  });
}

async function expectNoOverflow(page: Page): Promise<void> {
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
}

async function expectKeyboardReachable(page: Page, target: Locator): Promise<void> {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  for (let index = 0; index < 24; index += 1) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((element) => document.activeElement === element)) return;
  }
  expect(false, 'Primary Games action must be reachable by keyboard').toBe(true);
}

async function expectNoSeriousOrCriticalViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).exclude('[data-nextjs-toast]').analyze();
  expect(
    results.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
}
