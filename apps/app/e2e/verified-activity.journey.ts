import AxeBuilder from '@axe-core/playwright';

import { journeyApiOrigin } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

test.use({ journeySeed: 'verified-activity' });

test('shows only verified settled activity as a secondary mobile lobby surface', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('verified-activity');
  await page.setViewportSize({ height: 844, width: 390 });
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().startsWith(`${journeyApiOrigin}/games/activity?limit=4`),
    ),
    page.goto('/games'),
  ]);

  await expect(
    page.getByRole('heading', { level: 2, name: 'Verified recent activity' }),
  ).toBeVisible();
  await expect(page.getByText('Sports Pack Duel settled')).toBeVisible();
  await expect(page.getByText('Player 7K2M won a verified Sports Pack Duel.')).toBeVisible();
  await expect(page.getByText('Verified win')).toBeVisible();
  await expect(page.getByRole('link', { name: 'View verified receipt' })).toHaveAttribute(
    'href',
    /\/__journey\/v1\/duels\/duel_activity_[a-f0-9]{16}\/receipt$/,
  );
  await expect(page.getByText('Player 7K2M · Player P4Q9')).toBeVisible();
  await expect(page.getByText(/players online|live pot|jackpot/i)).toHaveCount(0);

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);

  const accessibility = await new AxeBuilder({ page }).exclude('[data-nextjs-toast]').analyze();
  expect(
    accessibility.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
});
