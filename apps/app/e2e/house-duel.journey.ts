import { journeyTestIds } from '../app/e2e/journey-test-ids';
import { journeyApiOrigin, journeyRpcUrl } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

const entry = {
  authenticate: 'duel-entry-auth-prepare',
  confirmFunding: 'duel-entry-confirm-funding',
  connectWallet: 'duel-entry-connect-wallet',
  prepareFunding: 'duel-entry-prepare-funding',
  signAuthentication: 'duel-entry-auth-sign',
  stepper: 'duel-entry-stepper',
} as const;

test.describe('player win against House', () => {
  test.use({
    journeyHouseEnabled: true,
    journeyHouseWinner: 'player',
    journeySeed: 'house-player-win',
  });

  test('settles through the public House path with one payment submission', async ({
    journey,
    page,
  }) => {
    await completeHouseDuel(page);

    expect(journey.snapshot().duel).toEqual(
      expect.objectContaining({
        houseOpponent: true,
        matchmakingMode: 'house',
        result: expect.objectContaining({ winnerSide: 'creator' }),
        status: 'settled',
      }),
    );
    expect(requestCount(journey.snapshot().requests, '/submissions')).toBe(1);
    await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText('You won both pulls');
  });
});

test.describe('House win against player', () => {
  test.use({
    journeyHouseEnabled: true,
    journeyHouseWinner: 'house',
    journeySeed: 'house-wins',
  });

  test('uses the same valuation and settlement path without a privileged branch', async ({
    journey,
    page,
  }) => {
    await completeHouseDuel(page);

    expect(journey.snapshot().duel).toEqual(
      expect.objectContaining({
        houseOpponent: true,
        matchmakingMode: 'house',
        result: expect.objectContaining({
          comparisonMetric: 'insured-value',
          winnerSide: 'opponent',
        }),
        status: 'settled',
      }),
    );
    expect(requestCount(journey.snapshot().requests, '/submissions')).toBe(1);
    await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText(
      'Opponent takes the vault',
    );
  });
});

async function completeHouseDuel(page: import('@playwright/test').Page): Promise<void> {
  await page.clock.install({ time: new Date('2099-01-01T00:00:00.000Z') });
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/health/capabilities`),
    page.waitForResponse(journeyRpcUrl),
    page.goto('/overview'),
  ]);

  await page.getByTestId(journeyTestIds.mode.house).click();
  await expect(page.getByTestId(journeyTestIds.primaryAction)).toHaveText(
    'Play house · $50 demo pool',
  );
  await page.getByTestId(journeyTestIds.primaryAction).click();

  const stepper = page.getByTestId(entry.stepper);
  await stepper.getByTestId(entry.connectWallet).click();
  await stepper.getByTestId(entry.authenticate).click();
  await stepper.getByTestId(entry.signAuthentication).click();
  await expect(stepper).toHaveAttribute('data-stage', 'review');
  await expect(stepper).toContainText('DailyDraft House admission');
  await expect(stepper).toContainText(
    'Readiness is checked again immediately before duel creation',
  );
  await stepper.getByTestId(entry.prepareFunding).click();
  await expect(stepper).toHaveAttribute('data-stage', 'funding-review');
  await stepper.getByTestId(entry.confirmFunding).click();
  await expect(page.getByTestId(journeyTestIds.battle)).toBeVisible();
  await page.clock.fastForward(6_000);
}

function requestCount(requests: string[], suffix: string): number {
  return requests.filter((request) => request.endsWith(suffix)).length;
}
