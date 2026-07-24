import type { Locator, Page } from '@playwright/test';

import { journeyTestIds } from '../app/e2e/journey-test-ids';
import { journeyApiOrigin, journeyRpcUrl } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

const appOrigin = 'http://127.0.0.1:3001';
const entryTestIds = {
  authenticate: 'duel-entry-auth-prepare',
  cancel: 'duel-entry-cancel',
  close: 'duel-entry-close',
  confirmFunding: 'duel-entry-confirm-funding',
  connectWallet: 'duel-entry-connect-wallet',
  prepareFunding: 'duel-entry-prepare-funding',
  signAuthentication: 'duel-entry-auth-sign',
  stepper: 'duel-entry-stepper',
} as const;

test.use({ journeySeed: 'keyboard-reduced-motion' });

test('completes tabs, dialogs, cancellation, disclosure, share, and rematch without a pointer', async ({
  context,
  journey,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: appOrigin });
  await page.clock.install({ time: new Date('2099-01-01T00:00:00.000Z') });
  await disableNativeShare(page);
  await openLobby(page);

  const walletMenu = page.getByTestId(journeyTestIds.walletMenu);
  await tabTo(page, walletMenu);
  await expectFocusVisible(walletMenu);
  await page.keyboard.press('Enter');

  const walletDialog = page.getByTestId(journeyTestIds.walletDialog);
  const walletClose = walletDialog.getByRole('button', { name: 'Close wallet dialog' });
  const walletOption = walletDialog.getByTestId(journeyTestIds.walletOption);
  await expect(walletDialog).toBeVisible();
  await expectFocusVisible(walletClose);
  await page.keyboard.press('Shift+Tab');
  await expectFocusVisible(walletOption);
  await page.keyboard.press('Tab');
  await expectFocusVisible(walletClose);
  await page.keyboard.press('Escape');
  await expect(walletDialog).not.toBeVisible();
  await expectFocusVisible(walletMenu);

  const matchmakingTab = page.getByTestId(journeyTestIds.mode.matchmaking);
  const directTab = page.getByTestId(journeyTestIds.mode.direct);
  await tabTo(page, matchmakingTab);
  await expectFocusVisible(matchmakingTab);
  await page.keyboard.press('ArrowLeft');
  await page.clock.fastForward(16);
  await expect(directTab).toHaveAttribute('aria-selected', 'true');
  await expectFocusVisible(directTab);
  await page.keyboard.press('ArrowRight');
  await page.clock.fastForward(16);
  await expect(matchmakingTab).toHaveAttribute('aria-selected', 'true');
  await expectFocusVisible(matchmakingTab);

  const primaryAction = page.getByTestId(journeyTestIds.primaryAction);
  await keyboardActivate(page, primaryAction);

  const stepper = page.getByTestId(entryTestIds.stepper);
  const stepperClose = stepper.getByTestId(entryTestIds.close);
  const cancelEntry = stepper.getByTestId(entryTestIds.cancel);
  await expect(stepper).toHaveAttribute('data-stage', 'connect');
  await expectFocusVisible(stepperClose);
  await page.keyboard.press('Shift+Tab');
  await expectFocusVisible(cancelEntry);
  await page.keyboard.press('Tab');
  await expectFocusVisible(stepperClose);
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(stepper).not.toBeVisible();
  await expectFocusVisible(primaryAction);

  await page.keyboard.press('Enter');
  await expect(stepper).toHaveAttribute('data-stage', 'connect');
  await completeEntry(page, (locator) => keyboardActivate(page, locator), async () => {
    const technicalDetails = stepper.locator('details.duel-technical-details');
    const technicalSummary = technicalDetails.locator('summary');
    await keyboardActivate(page, technicalSummary);
    await expect(technicalDetails).toHaveAttribute('open', '');
    await expect(technicalDetails).toContainText('Funding side');
  });

  const settled = journey.snapshot().duel;
  expect(settled?.status).toBe('settled');
  await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText(
    'Outcome locked. Reveal in 3…',
  );
  await expect(page.getByTestId(journeyTestIds.duelPhase)).toContainText('Outcome committed');
  await page.clock.fastForward(6_000);
  await expect(page.getByTestId(journeyTestIds.resultMargin)).toHaveText('$31.5');

  const share = page.getByTestId(journeyTestIds.resultShare);
  await keyboardActivate(page, share);
  await expect(page.getByText('Result link copied with its status-aware social preview.')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
    `I won a $50 Pack Duel with Charizard fixture pull at $72.5.\n${appOrigin}/duel/${settled?.id}`,
  );

  const receipt = page.getByRole('link', { name: 'Verified receipt' });
  await tabTo(page, receipt);
  await expectFocusVisible(receipt);
  await expect(receipt).toHaveAttribute('href', `/duel/${settled?.id}`);

  const rematch = page.getByTestId(journeyTestIds.resultRematch);
  await shiftTabTo(page, rematch);
  await expectFocusVisible(rematch);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId(journeyTestIds.lobby)).toBeVisible();
  await expect(directTab).toHaveAttribute('aria-selected', 'true');
  await expect(primaryAction).toHaveText(/Review \$50 rematch/);
});

test('exposes the same committed result without cinematic motion', async ({ journey, page }) => {
  expect(journey.seed).toBe('keyboard-reduced-motion');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.install({ time: new Date('2099-01-01T00:00:00.000Z') });
  await openLobby(page);

  await page.getByTestId(journeyTestIds.primaryAction).click();
  await completeEntry(page, (locator) => locator.click());

  await expect.poll(() => page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText(
    'Your committed pull is revealed',
  );
  await expect(page.locator('.reveal-countdown')).toHaveCount(0);
  await expect(page.getByTestId(journeyTestIds.pullName.you)).toHaveText('Charizard fixture pull');
  await expect(page.getByTestId(journeyTestIds.pullName.opponent)).toHaveText('Result pending');
  await expectRevealMotionDisabled(page);

  await page.clock.fastForward(600);
  await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText(
    'Both committed values are visible',
  );
  await expect(page.getByTestId(journeyTestIds.pullName.opponent)).toHaveText(
    'Blastoise fixture pull',
  );
  await expect(page.getByTestId(journeyTestIds.resultMargin)).not.toBeVisible();

  await page.clock.fastForward(600);
  await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText('You won both pulls');
  await expect(page.getByTestId(journeyTestIds.winner.you)).toHaveText('Winner');
  await expect(page.getByTestId(journeyTestIds.resultMargin)).toHaveText('$31.5');
  await expect(page.getByTestId(journeyTestIds.resultTotalValue)).toHaveText('$113.5');
  await expectRevealMotionDisabled(page);
});

async function openLobby(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/health/capabilities`),
    page.waitForResponse(journeyRpcUrl),
    page.goto('/overview'),
  ]);
  await expect(page.getByTestId(journeyTestIds.lobby)).toBeVisible();
}

async function completeEntry(
  page: Page,
  activate: (locator: Locator) => Promise<void>,
  beforeConfirm?: () => Promise<void>,
): Promise<void> {
  const stepper = page.getByTestId(entryTestIds.stepper);

  await activate(stepper.getByTestId(entryTestIds.connectWallet));
  await expect(stepper).toHaveAttribute('data-stage', 'authenticate');

  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/auth/challenges`),
    activate(stepper.getByTestId(entryTestIds.authenticate)),
  ]);
  await expect(stepper.getByTestId(entryTestIds.signAuthentication)).toBeVisible();

  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/matchmaking/status`),
    activate(stepper.getByTestId(entryTestIds.signAuthentication)),
  ]);
  await expect(stepper).toHaveAttribute('data-stage', 'review');

  await activate(stepper.getByTestId(entryTestIds.prepareFunding));
  await expect(stepper).toHaveAttribute('data-stage', 'funding-review');
  await beforeConfirm?.();

  await activate(stepper.getByTestId(entryTestIds.confirmFunding));
  await expect(page.getByTestId(journeyTestIds.battle)).toBeVisible();
}

async function keyboardActivate(page: Page, locator: Locator): Promise<void> {
  await tabTo(page, locator);
  await expectFocusVisible(locator);
  await page.keyboard.press('Enter');
}

async function tabTo(page: Page, locator: Locator, limit = 50): Promise<void> {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    if (await isFocused(locator)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Keyboard focus did not reach ${await locator.evaluate((element) => element.outerHTML)}`);
}

async function shiftTabTo(page: Page, locator: Locator, limit = 50): Promise<void> {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    if (await isFocused(locator)) return;
    await page.keyboard.press('Shift+Tab');
  }
  throw new Error(
    `Reverse keyboard focus did not reach ${await locator.evaluate((element) => element.outerHTML)}`,
  );
}

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element === document.activeElement).catch(() => false);
}

async function expectFocusVisible(locator: Locator): Promise<void> {
  await expect(locator).toBeFocused();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const style = getComputedStyle(element);
        const visibleOutline =
          style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
        return visibleOutline || style.boxShadow !== 'none';
      }),
    )
    .toBe(true);
}

async function expectRevealMotionDisabled(page: Page): Promise<void> {
  const styles = await page.locator('.reveal-grid').evaluate((grid) =>
    [...grid.querySelectorAll<HTMLElement>('.pack-shell, .pull-shell, .pull-meta')].map(
      (element) => ({
        animationName: getComputedStyle(element).animationName,
        transitionDuration: getComputedStyle(element).transitionDuration,
      }),
    ),
  );
  expect(styles.length).toBeGreaterThan(0);
  expect(styles.every((style) => style.animationName === 'none')).toBe(true);
  expect(styles.every((style) => style.transitionDuration === '0s')).toBe(true);
}

async function disableNativeShare(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    });
  });
}
