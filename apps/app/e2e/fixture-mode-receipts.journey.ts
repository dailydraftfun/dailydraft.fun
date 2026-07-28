import type { Locator } from '@playwright/test';

import { expect, test } from './fixtures/playwright';

test.use({ journeySeed: 'fixture-mode-receipts' });

test('Flip reveals a public-safe receipt and a truthful local keep action', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('fixture-mode-receipts');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/games/marketplace-flip', { waitUntil: 'domcontentloaded' });

  const advanceScript = page.getByRole('button', { name: 'Advance local script' });
  await waitForReactHandler(advanceScript, 'onClick');
  await advanceScript.click();
  await page.getByRole('button', { name: 'Show scripted card' }).click();
  await expect(page.getByRole('heading', { name: 'Charizard · Base Set' })).toBeVisible();
  await page.getByRole('button', { name: 'Review script summary' }).click();

  const receipt = page.getByRole('region', { name: 'Acquisition evidence' });
  await expect(receipt).toContainText('flip-pool-17');
  await expect(receipt).toContainText('Chase · 7.5%');
  await expect(receipt).toContainText('Provider-confirmed · sensitive payload redacted');
  await expect(receipt).toContainText('Ownership confirmed');
  await expect(receipt.getByRole('button', { name: 'Listing unavailable' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  await receipt.getByRole('button', { name: 'Keep fixture card' }).click();
  await expect(receipt.getByRole('status')).toContainText('No custody action occurred');
});

test('Flip history filters terminal paths and loads the bounded older page', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('fixture-mode-receipts');
  await page.goto('/games/marketplace-flip', { waitUntil: 'domcontentloaded' });

  const history = page.locator('[data-flip-history-count]');
  await expect(page.locator('[data-flip-receipt-status]')).toHaveCount(3);
  const statusFilter = page.getByLabel('Receipt status');
  await waitForReactHandler(statusFilter, 'onChange');
  await statusFilter.selectOption('disputed');
  await expect(page.locator('[data-flip-receipt-status="disputed"]')).toHaveCount(1);
  await expect(history).toContainText('Human review required');

  await page.getByLabel('Receipt status').selectOption('all');
  await page.getByRole('button', { name: 'Load older receipts' }).click();
  await expect(page.locator('[data-flip-receipt-status]')).toHaveCount(6);
  await expect(page.locator('[data-flip-receipt-status="failed"]')).toContainText(
    'Session closed without purchase',
  );
});

test('Crash deterministically covers cash-out, reset, and bust terminal receipts', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('fixture-mode-receipts');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/games/crash', { waitUntil: 'domcontentloaded' });

  const crash = page.getByRole('region', { name: 'Crash preview' });
  const cashOut = crash.getByRole('button', { name: 'Cash out fixture pot' });
  await waitForReactHandler(cashOut, 'onClick');
  await cashOut.click();
  await expect(crash).toContainText('Fixture pot cashed out');
  await expect(crash).toContainText('Player cash-out');
  await expect(crash).toContainText('Settlement');

  await crash.getByRole('button', { name: 'Reset run' }).click();
  for (let stage = 1; stage < 4; stage += 1) {
    await crash.getByRole('button', { name: 'Reveal next scripted stage' }).click();
  }
  await crash.getByRole('button', { name: 'Attempt past final stage' }).click();
  await expect(crash).toContainText('scripted run ended past stage four');
  await expect(crash).toContainText('Scripted end after stage four');
  await expect(crash).toContainText('Preview only');
});

test('Crash reload fails closed to an active fixture and keeps private history undiscoverable', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('fixture-mode-receipts');
  await page.goto('/games/crash', { waitUntil: 'domcontentloaded' });

  const crash = page.getByRole('region', { name: 'Crash preview' });
  const revealNextStage = crash.getByRole('button', { name: 'Reveal next scripted stage' });
  await waitForReactHandler(revealNextStage, 'onClick');
  await revealNextStage.click();
  await expect(crash).toContainText('Stage 2 of 4');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('region', { name: 'Crash preview' })).toContainText('Stage 1 of 4');
  await expect(page.getByText('Wallet authentication required')).toBeVisible();
  await expect(page.getByText('No other wallet’s rounds are discoverable')).toBeVisible();
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
