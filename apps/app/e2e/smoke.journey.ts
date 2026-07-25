import { journeyTestIds } from '../app/e2e/journey-test-ids';
import { journeyApiOrigin, journeyRpcUrl } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

test('boots an isolated actionable lobby without live wallet, RPC, or provider access', async ({
  journey,
  page,
}) => {
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/health/capabilities`),
    page.waitForResponse(journeyRpcUrl),
    page.goto('/overview'),
  ]);

  await expect(page.getByTestId(journeyTestIds.lobby)).toBeVisible();
  await expect(page.getByTestId(journeyTestIds.primaryAction)).toBeEnabled();
  await expect(page.getByTestId(journeyTestIds.mode.matchmaking)).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByTestId(journeyTestIds.walletMenu).click();
  await expect(page.getByTestId(journeyTestIds.walletDialog)).toContainText(
    'Solana devnet · online',
  );
  await expect(page.getByTestId(journeyTestIds.walletOption)).toContainText(
    'DailyDraft Journey Fixture',
  );
  await page.getByTestId(journeyTestIds.walletOption).click();
  await expect(page.getByTestId(journeyTestIds.walletMenu)).toContainText('1111…1111');

  expect(journey.snapshot().requests).toContain('RPC getGenesisHash');
  expect(journey.snapshot().requests).toContain('GET /health/capabilities');
});
