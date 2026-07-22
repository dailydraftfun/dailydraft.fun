import type { Locator, Page } from '@playwright/test';

import { journeyTestIds } from '../app/e2e/journey-test-ids';
import type { DuelJourneyFixture } from './fixtures/journey-fixture';
import { journeyApiOrigin, journeyRpcUrl } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

const entryTestIds = {
  authenticate: 'duel-entry-auth-prepare',
  confirmFunding: 'duel-entry-confirm-funding',
  connectWallet: 'duel-entry-connect-wallet',
  prepareFunding: 'duel-entry-prepare-funding',
  signAuthentication: 'duel-entry-auth-sign',
  stepper: 'duel-entry-stepper',
} as const;

const viewports = {
  desktop: { height: 900, width: 1440 },
  mobile: { height: 844, width: 390 },
} as const;

test.describe('critical duel visual states', () => {
  test.use({ journeySeed: 'critical-visual-states' });

  test('captures the six declared desktop visual states', async ({ journey, page }) => {
    await completeVisualJourney(page, journey, 'desktop');
  });

  test('completes the 390px journey with every primary action and result field intact', async ({
    journey,
    page,
  }) => {
    await completeVisualJourney(page, journey, 'mobile');
  });
});

async function completeVisualJourney(
  page: Page,
  journey: DuelJourneyFixture,
  viewport: keyof typeof viewports,
): Promise<void> {
  await page.setViewportSize(viewports[viewport]);
  await page.clock.install({ time: new Date('2099-01-01T00:00:00.000Z') });
  await openLobby(page);

  const lobby = page.getByTestId(journeyTestIds.lobby);
  const primaryAction = page.getByTestId(journeyTestIds.primaryAction);
  await expect(lobby).toBeVisible();
  await expect(page.getByTestId(journeyTestIds.entryTier)).toHaveText('$50.00');
  await expect(primaryAction).toHaveText(/Find a \$50 duel/);
  await expect(primaryAction).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectVisualState(page, lobby, `lobby-${viewport}.png`);

  await primaryAction.click();
  const stepper = page.getByTestId(entryTestIds.stepper);
  await stepper.getByTestId(entryTestIds.connectWallet).click();
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/auth/challenges`),
    stepper.getByTestId(entryTestIds.authenticate).click(),
  ]);
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/matchmaking/status`),
    stepper.getByTestId(entryTestIds.signAuthentication).click(),
  ]);
  await stepper.getByTestId(entryTestIds.prepareFunding).click();

  await expect(stepper).toHaveAttribute('data-stage', 'funding-review');
  await expect(stepper).toContainText('Value-bearing transaction');
  await expect(stepper.getByText('Pack purchase', { exact: true })).toBeVisible();
  await expect(stepper.getByText('Not charged in this devnet step', { exact: true })).toBeVisible();
  await expect(stepper.getByTestId(entryTestIds.confirmFunding)).toHaveText(
    'Approve 0.01 SOL in wallet',
  );
  await expectNoHorizontalOverflow(page);
  await expectVisualState(page, stepper, `funding-review-${viewport}.png`);

  await stepper.getByTestId(entryTestIds.confirmFunding).click();
  const battle = page.getByTestId(journeyTestIds.battle);
  await expect(battle).toBeVisible();
  await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText(
    'Outcome locked. Reveal in 3…',
  );
  await expect(page.getByTestId(journeyTestIds.duelPhase)).toContainText('Outcome committed');
  await expect(page.getByTestId(journeyTestIds.pull.you)).toBeVisible();
  await expect(page.getByTestId(journeyTestIds.pull.opponent)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectVisualState(page, battle.locator('.battle-shell'), `opening-${viewport}.png`);

  const settled = journey.snapshot().duel;
  if (!settled) throw new Error('The visual journey did not persist a duel.');
  expect(settled.status).toBe('settled');
  expect(settled.id).toBeTruthy();
  await page.clock.fastForward(6_000);

  const winner = page.getByTestId(journeyTestIds.pull.you);
  const loser = page.getByTestId(journeyTestIds.pull.opponent);
  await expect(page.getByTestId(journeyTestIds.winner.you)).toHaveText('Winner');
  await expect(winner.getByTestId(journeyTestIds.pullName.you)).toHaveText(
    'Charizard fixture pull',
  );
  await expect(winner.getByTestId(journeyTestIds.pullValue.you)).toHaveText('$72.5');
  await expect(loser.getByText('Runner-up')).toBeVisible();
  await expect(loser.getByTestId(journeyTestIds.pullName.opponent)).toHaveText(
    'Blastoise fixture pull',
  );
  await expect(loser.getByTestId(journeyTestIds.pullValue.opponent)).toHaveText('$41');
  await expect(page.getByTestId(journeyTestIds.resultMargin)).toHaveText('$31.5');
  await expect(page.getByTestId(journeyTestIds.resultTotalValue)).toHaveText('$113.5');
  await expect(page.getByTestId(journeyTestIds.resultShare)).toBeVisible();
  await expect(page.getByTestId(journeyTestIds.resultRematch)).toBeVisible();
  const receiptLink = page.getByRole('link', { name: 'Verified receipt' });
  await expect(receiptLink).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectVisualState(page, winner, `winner-${viewport}.png`);
  await expectVisualState(page, loser, `loser-${viewport}.png`);

  await Promise.all([page.waitForURL(`/duel/${settled.id}`), receiptLink.click()]);
  const receipt = page.locator('.receipt-artifact');
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText('Committed duel result');
  await expect(receipt).toContainText('Charizard fixture pull');
  await expect(receipt).toContainText('Blastoise fixture pull');
  await expect(receipt).toContainText('$113.5');
  await expectNoHorizontalOverflow(page);
  await expectVisualState(page, receipt, `verified-receipt-${viewport}.png`);
}

async function openLobby(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/health/capabilities`),
    page.waitForResponse(journeyRpcUrl),
    page.goto('/overview'),
  ]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

async function expectVisualState(page: Page, target: Locator, snapshotName: string): Promise<void> {
  await expect.soft(target).toHaveScreenshot(snapshotName, {
    animations: 'disabled',
    caret: 'hide',
    mask: unstableVisuals(page),
    maskColor: '#161a20',
    maxDiffPixelRatio: 0.001,
    scale: 'css',
  });
}

function unstableVisuals(page: Page): Locator[] {
  return [
    page.locator('code'),
    page.locator('pre'),
    page.locator('.font-mono'),
    page.locator('.receipt-serial'),
    page.locator('img'),
  ];
}
