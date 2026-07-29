import type { Locator } from '@playwright/test';

import { expect, test } from './fixtures/playwright';

test.use({ journeySeed: 'fixture-mode-receipts' });

test('Flip reveals a truthful local no-value round summary', async ({ journey, page }) => {
  expect(journey.seed).toBe('fixture-mode-receipts');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/games/marketplace-flip', { waitUntil: 'domcontentloaded' });

  const lockCall = page.getByRole('button', { name: 'Lock Core call' });
  await waitForReactHandler(lockCall, 'onClick');
  await lockCall.click();
  const flipCard = page.getByRole('button', { name: 'Flip the card' });
  await expect(flipCard).toBeFocused();
  await flipCard.click();
  await expect(page.getByRole('heading', { name: 'Charizard · Base Set' })).toBeVisible();
  const review = page.getByRole('button', { name: 'Review script summary' });
  await expect(review).toBeFocused();
  await review.click();
  await expect(page.getByRole('button', { name: 'Play next round' })).toBeFocused();

  const game = page.getByRole('region', { name: 'Marketplace Flip game' });
  await expect(game).toContainText('Fixture result computed for this run');
  await expect(game).toContainText('Local UI state only');
  await expect(game).toContainText('Not submitted');
  await expect(game).toContainText('Unchanged');
});

test('Card Streak deterministically covers cash-out, replay, and bust states', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('fixture-mode-receipts');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/games/crash', { waitUntil: 'domcontentloaded' });

  const crash = page.getByRole('region', { name: 'Card Streak game' });
  const cashOut = crash.getByRole('button', { name: 'End run' });
  await waitForReactHandler(cashOut, 'onClick');
  await cashOut.click();
  await expect(crash).toContainText('Run ended');
  await expect(crash).toContainText('demo score');

  const replay = crash.getByRole('button', { name: 'Play again' });
  await expect(replay).toBeFocused();
  await replay.click();
  await expect(crash.getByRole('button', { name: 'Continue streak' })).toBeFocused();
  for (let stage = 1; stage < 4; stage += 1) {
    await crash.getByRole('button', { name: 'Continue streak' }).click();
  }
  await crash.getByRole('button', { name: 'Push past the edge' }).click();
  await expect(crash).toContainText('Busted');
  await expect(crash).toContainText('demo score is gone');
  await expect(crash).toContainText('No wallet. No funds. No custody.');
});

test('Card Streak reload starts a clean no-wallet fixture run', async ({ journey, page }) => {
  expect(journey.seed).toBe('fixture-mode-receipts');
  await page.goto('/games/crash', { waitUntil: 'domcontentloaded' });

  const crash = page.getByRole('region', { name: 'Card Streak game' });
  const revealNextStage = crash.getByRole('button', { name: 'Continue streak' });
  await waitForReactHandler(revealNextStage, 'onClick');
  await revealNextStage.click();
  await expect(crash).toContainText('Mewtwo');

  await page.reload({ waitUntil: 'domcontentloaded' });
  const reset = page.getByRole('region', { name: 'Card Streak game' });
  await expect(reset).toContainText('Pikachu');
  await expect(reset).toContainText('No wallet. No funds. No custody.');
});

async function waitForReactHandler(
  locator: Locator,
  handler: 'onChange' | 'onClick',
): Promise<void> {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element, reactHandler) => {
        const propsKey = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
        if (!propsKey) return false;
        const props = (element as unknown as Record<string, Record<string, unknown>>)[propsKey];
        return typeof props?.[reactHandler] === 'function';
      }, handler),
    )
    .toBe(true);
}
