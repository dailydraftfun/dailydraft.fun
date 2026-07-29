import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/playwright';

test.use({ journeySeed: 'post-duel-card-actions' });

test('renders independent available, pending, expired, and unsupported actions for every won card', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('post-duel-card-actions');
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/duel/duel_fixture_card_actions');

  const actionGroups = page.locator('.receipt-card-actions');
  const charizard = actionGroups.filter({ hasText: 'Charizard action card' });
  const pikachu = actionGroups.filter({ hasText: 'Pikachu action card' });

  await expect(actionGroups).toHaveCount(2);
  await expect(charizard).toContainText('Ownership reconciled');
  await expect(
    charizard.getByRole('link', { name: 'List card for Charizard action card' }),
  ).toHaveAttribute('href', '/cards/duel_fixture_card_actions/charizard/list');
  await expect(
    charizard.getByRole('button', { name: 'Sell back expired for Charizard action card' }),
  ).toBeDisabled();
  await expect(
    charizard.getByRole('button', {
      name: 'Redeem physical card unavailable for Charizard action card',
    }),
  ).toBeDisabled();
  await expect(
    pikachu.getByRole('button', { name: 'List card pending for Pikachu action card' }),
  ).toBeDisabled();
  await expect(
    pikachu.getByRole('link', { name: 'Sell back for Pikachu action card' }),
  ).toHaveAttribute('href', '/cards/duel_fixture_card_actions/pikachu/sell-back');

  const receiptLinks = page.getByRole('link', { name: /View source receipt for/ });
  await expect(receiptLinks).toHaveCount(2);
  await expect(receiptLinks.first()).toHaveAttribute(
    'href',
    '/v1/duels/duel_fixture_card_actions/receipt',
  );
  await expectNoOverflow(page);
  await expectNoSeriousOrCriticalViolations(page);
});

test('announces ownership mismatch without exposing actions and preserves the source receipt', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('post-duel-card-actions');
  await page.goto('/duel/duel_fixture_ownership_mismatch');

  const mismatch = page.locator('.receipt-artifact').getByRole('alert');
  await expect(mismatch).toContainText('recorded ownership disagrees with the canonical result');
  await expect(mismatch.getByRole('link', { name: 'View source receipt' })).toHaveAttribute(
    'href',
    '/v1/duels/duel_fixture_ownership_mismatch/receipt',
  );
  await expect(page.locator('.receipt-card-actions')).toHaveCount(0);
  await expectNoSeriousOrCriticalViolations(page);
});

async function expectNoOverflow(page: Page): Promise<void> {
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport.scrollWidth).toBe(viewport.clientWidth);
}

async function expectNoSeriousOrCriticalViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).exclude('[data-nextjs-toast]').analyze();
  expect(
    results.violations.filter((violation) =>
      ['critical', 'serious'].includes(violation.impact ?? ''),
    ),
  ).toEqual([]);
}
