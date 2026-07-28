import { journeyTestIds } from '../app/e2e/journey-test-ids';
import { journeyApiOrigin, journeyRpcUrl } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

test.use({ journeySeed: 'wallet-session-persistence' });

test('restores an authenticated wallet session after a same-tab refresh', async ({
  journey,
  page,
}) => {
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/health/capabilities`),
    page.waitForResponse(journeyRpcUrl),
    page.goto('/overview'),
  ]);

  await page.getByTestId(journeyTestIds.walletMenu).click();
  await page.getByTestId(journeyTestIds.walletOption).click();
  await page.getByTestId(journeyTestIds.walletMenu).click();
  await page.getByTestId(journeyTestIds.walletAuthenticationPrepare).click();
  await page.getByTestId(journeyTestIds.walletAuthenticationSign).click();
  await expect(page.getByTestId(journeyTestIds.walletDialog)).toContainText(
    'Authenticated to play',
  );

  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/auth/session`),
    page.reload({ waitUntil: 'domcontentloaded' }),
  ]);

  await page.getByTestId(journeyTestIds.walletMenu).click();
  const dialog = page.getByTestId(journeyTestIds.walletDialog);
  await expect(dialog).toContainText('Authenticated to play');
  await expect(dialog).not.toContainText('Authenticate wallet ownership');

  const requests = journey.snapshot().requests;
  expect(requests.filter((request) => request === 'POST /auth/challenges')).toHaveLength(1);
  expect(requests.filter((request) => request === 'POST /auth/sessions')).toHaveLength(1);
  expect(requests.filter((request) => request === 'GET /auth/session')).toHaveLength(1);
});
