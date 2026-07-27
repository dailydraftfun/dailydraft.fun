import type { Locator, Page } from '@playwright/test';

import { audioHapticsStorageKey } from '../app/components/audio-haptics/audio-haptics-cues';
import { journeyTestIds } from '../app/e2e/journey-test-ids';
import type { DuelJourneyFixture } from './fixtures/journey-fixture';
import { journeyApiOrigin, journeyRpcUrl } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

const animatedBeats = ['anticipation', 'hold', 'reveal', 'celebrate'] as const;
const fullBeatSequence = [...animatedBeats, 'settled'] as const;
const mobileViewport = { height: 844, width: 390 };
const entryTestIds = {
  authenticate: 'duel-entry-auth-prepare',
  confirmFunding: 'duel-entry-confirm-funding',
  connectWallet: 'duel-entry-connect-wallet',
  prepareFunding: 'duel-entry-prepare-funding',
  signAuthentication: 'duel-entry-auth-sign',
  stepper: 'duel-entry-stepper',
} as const;

type BeatCapture = {
  maxOverflowByBeat: Record<string, number>;
  samplesByBeat: Record<string, number>;
  sequence: string[];
};

test.use({ journeySeed: 'reveal-choreography' });

test('keyboard completes Flip and Crash reveals, mute, skip, and every 390px beat', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('reveal-choreography');
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, 'enabled');
  }, audioHapticsStorageKey);
  await page.setViewportSize(mobileViewport);
  await page.goto('/games/marketplace-flip', { waitUntil: 'domcontentloaded' });
  await installBeatCapture(page);

  const muteControl = page.locator('button[aria-keyshortcuts="Alt+M"]');
  await expect(muteControl).toHaveAttribute('aria-pressed', 'true');
  await keyboardActivate(page, muteControl);
  await expect(muteControl).toHaveAttribute('aria-pressed', 'false');
  await expect
    .poll(() =>
      page.evaluate((storageKey) => localStorage.getItem(storageKey), audioHapticsStorageKey),
    )
    .toBe('muted');
  await page.keyboard.press('Alt+M');
  await expect(muteControl).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Alt+M');
  await expect(muteControl).toHaveAttribute('aria-pressed', 'false');

  await keyboardActivate(page, page.getByRole('button', { name: 'Commit fixture draw' }));
  await keyboardActivate(page, page.getByRole('button', { name: 'Reveal selected fixture' }));

  const flipReveal = page.locator('figure[data-choreography-active="true"]');
  await expectFullBeatJourney(flipReveal);
  await expectNoOverflowForBeats(flipReveal, fullBeatSequence);
  await expect(flipReveal.getByRole('img', { name: 'Charizard · Base Set' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Charizard · Base Set' })).toBeVisible();
  await expect(page.getByText('$72.50', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip reveal animation' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  const crashLink = page.getByRole('link', { name: /Card Streak/ });
  await keyboardActivate(page, crashLink);
  await page.waitForURL('/games/crash');
  await installBeatCapture(page);

  const crashPreview = page.getByRole('region', { name: 'Crash preview' });
  const secondStage = crashPreview.locator('article').nth(1);
  const continueCrash = page.getByRole('button', { name: 'Continue fixture run' });
  await waitForReactClickHandler(continueCrash);
  await keyboardActivate(page, continueCrash);
  await expectFullBeatJourney(secondStage);
  await expectNoOverflowForBeats(secondStage, fullBeatSequence);
  await expect(secondStage.getByRole('img', { name: 'Mewtwo · Base Set' })).toHaveCount(1);
  await expect(secondStage).toContainText('Mewtwo');
  await expect(secondStage).toContainText('$42.00');

  const thirdStage = crashPreview.locator('article').nth(2);
  await keyboardActivate(page, page.getByRole('button', { name: 'Continue fixture run' }));
  await expectCapturedBeats(thirdStage, ['anticipation']);

  const thirdStageSkip = thirdStage.getByRole('button', { name: 'Skip animation' });
  await keyboardActivate(page, thirdStageSkip);
  await expectCapturedBeats(thirdStage, ['anticipation', 'settled']);
  await expectNoOverflowForBeats(thirdStage, ['anticipation', 'settled']);
  await expect(thirdStage.getByRole('img', { name: 'Blastoise · Base Set' })).toHaveCount(1);
  await expect(thirdStage).toContainText('Blastoise');
  await expect(thirdStage).toContainText('$54.00');
  await expect(thirdStageSkip).toHaveAttribute('aria-disabled', 'true');
  await expectNoRunningAnimations(thirdStage);
});

test('keyboard completes both Duel reveals through every beat at 390px', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('reveal-choreography');
  await page.setViewportSize(mobileViewport);
  await openDuelLobby(page);
  await installBeatCapture(page);
  await completeDuelEntry(page, (locator) => keyboardActivate(page, locator));

  const playerPull = page.getByTestId(journeyTestIds.pull.you);
  const opponentPull = page.getByTestId(journeyTestIds.pull.opponent);
  await Promise.all([expectFullBeatJourney(playerPull), expectFullBeatJourney(opponentPull)]);
  await expectNoOverflowForBeats(playerPull, fullBeatSequence);
  await expectNoOverflowForBeats(opponentPull, fullBeatSequence);

  await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText('You won both pulls');
  await expect(page.getByTestId(journeyTestIds.pullName.you)).toHaveText('Charizard fixture pull');
  await expect(page.getByTestId(journeyTestIds.pullValue.you)).toHaveText('$72.5');
  await expect(page.getByTestId(journeyTestIds.pullName.opponent)).toHaveText(
    'Blastoise fixture pull',
  );
  await expect(page.getByTestId(journeyTestIds.pullValue.opponent)).toHaveText('$41');
  await expect(page.getByTestId(journeyTestIds.resultMargin)).toHaveText('$31.5');
  await expect(page.getByTestId(journeyTestIds.resultTotalValue)).toHaveText('$113.5');
  await expectNoHorizontalOverflow(page);
});

test('reduced motion fast-forwards every mode with full terminal information', async ({
  journey,
  page,
}) => {
  expect(journey.seed).toBe('reveal-choreography');
  await page.setViewportSize(mobileViewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  await page.goto('/games/marketplace-flip', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('button[aria-keyshortcuts="Alt+M"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await installBeatCapture(page);
  const commitFlip = page.getByRole('button', { name: 'Commit fixture draw' });
  await waitForReactClickHandler(commitFlip);
  await commitFlip.click();
  await page.getByRole('button', { name: 'Reveal selected fixture' }).click();

  const flipReveal = page.locator('figure[data-choreography-active="true"]');
  await expectReducedMotionSettlement(flipReveal);
  await expect(flipReveal.getByRole('img', { name: 'Charizard · Base Set' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Charizard · Base Set' })).toBeVisible();
  await expect(page.getByText('$72.50', { exact: true })).toBeVisible();

  await page.goto('/games/crash', { waitUntil: 'domcontentloaded' });
  await installBeatCapture(page);
  const secondStage = page.getByRole('region', { name: 'Crash preview' }).locator('article').nth(1);
  const continueCrash = page.getByRole('button', { name: 'Continue fixture run' });
  await waitForReactClickHandler(continueCrash);
  await continueCrash.click();
  await expectReducedMotionSettlement(secondStage);
  await expect(secondStage.getByRole('img', { name: 'Mewtwo · Base Set' })).toHaveCount(1);
  await expect(secondStage).toContainText('Mewtwo');
  await expect(secondStage).toContainText('$42.00');

  await openDuelLobby(page);
  await installBeatCapture(page);
  await completeDuelEntry(page, (locator) => locator.click());

  const playerPull = page.getByTestId(journeyTestIds.pull.you);
  const opponentPull = page.getByTestId(journeyTestIds.pull.opponent);
  await Promise.all([
    expectReducedMotionSettlement(playerPull),
    expectReducedMotionSettlement(opponentPull),
  ]);
  await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText('You won both pulls');
  await expect(page.getByTestId(journeyTestIds.pullName.you)).toHaveText('Charizard fixture pull');
  await expect(page.getByTestId(journeyTestIds.pullValue.you)).toHaveText('$72.5');
  await expect(page.getByTestId(journeyTestIds.pullName.opponent)).toHaveText(
    'Blastoise fixture pull',
  );
  await expect(page.getByTestId(journeyTestIds.pullValue.opponent)).toHaveText('$41');
  await expect(page.getByTestId(journeyTestIds.resultMargin)).toHaveText('$31.5');
  await expect(page.getByTestId(journeyTestIds.resultTotalValue)).toHaveText('$113.5');
  await expectNoHorizontalOverflow(page);
});

test('reload during a Duel animation recovers the final reveal without replaying the outcome', async ({
  journey,
  page,
}) => {
  await openDuelLobby(page);
  await installBeatCapture(page);
  await completeDuelEntry(page, (locator) => locator.click());

  const playerPull = page.getByTestId(journeyTestIds.pull.you);
  await expectCapturedBeats(playerPull, ['anticipation']);
  expect(requestsEndingWith(journey, '/open-packs')).toHaveLength(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await authenticateFromWalletMenu(page);

  await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText('You won both pulls', {
    timeout: 12_000,
  });
  await expect(page.getByTestId(journeyTestIds.pull.you)).toHaveAttribute(
    'data-choreography-settled',
    'true',
  );
  await expect(page.getByTestId(journeyTestIds.pull.opponent)).toHaveAttribute(
    'data-choreography-settled',
    'true',
  );
  await expect(page.getByTestId(journeyTestIds.pullName.you)).toHaveText('Charizard fixture pull');
  await expect(page.getByTestId(journeyTestIds.pullName.opponent)).toHaveText(
    'Blastoise fixture pull',
  );
  await expect(page.getByTestId(journeyTestIds.resultMargin)).toHaveText('$31.5');
  await expect(page.getByTestId(journeyTestIds.resultTotalValue)).toHaveText('$113.5');
  expect(requestsEndingWith(journey, '/open-packs')).toHaveLength(1);
  await expectNoRunningAnimations(page.getByTestId(journeyTestIds.battle));
});

async function installBeatCapture(page: Page): Promise<void> {
  await page.evaluate(() => {
    type TrackedElement = Element & {
      __dailydraftBeatCapture?: BeatCapture;
      __dailydraftBeatObserver?: MutationObserver;
    };
    type CaptureWindow = Window & {
      __dailydraftCaptureObserver?: MutationObserver;
    };

    const captureWindow = window as CaptureWindow;
    captureWindow.__dailydraftCaptureObserver?.disconnect();

    function instrument(element: Element): void {
      const tracked = element as TrackedElement;
      if (tracked.__dailydraftBeatCapture) return;

      const capture: BeatCapture = {
        maxOverflowByBeat: {},
        samplesByBeat: {},
        sequence: [],
      };
      tracked.__dailydraftBeatCapture = capture;
      let sampling = true;

      function record(): void {
        const beat = element.getAttribute('data-choreography-beat') ?? 'missing';
        if (capture.sequence.at(-1) !== beat) capture.sequence.push(beat);
        const root = document.documentElement;
        const overflow = root.scrollWidth - root.clientWidth;
        capture.maxOverflowByBeat[beat] = Math.max(
          capture.maxOverflowByBeat[beat] ?? Number.NEGATIVE_INFINITY,
          overflow,
        );
        capture.samplesByBeat[beat] = (capture.samplesByBeat[beat] ?? 0) + 1;
        if (beat === 'settled') sampling = false;
      }

      function sampleFrame(): void {
        record();
        if (sampling) requestAnimationFrame(sampleFrame);
      }

      tracked.__dailydraftBeatObserver = new MutationObserver(record);
      tracked.__dailydraftBeatObserver.observe(element, {
        attributeFilter: ['data-choreography-beat'],
        attributes: true,
      });
      record();
      requestAnimationFrame(sampleFrame);
    }

    function instrumentAll(): void {
      for (const element of document.querySelectorAll('[data-choreography-beat]')) {
        instrument(element);
      }
    }

    instrumentAll();
    captureWindow.__dailydraftCaptureObserver = new MutationObserver(instrumentAll);
    captureWindow.__dailydraftCaptureObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

async function readBeatCapture(locator: Locator): Promise<BeatCapture | null> {
  return locator.evaluate((element) => {
    const tracked = element as Element & {
      __dailydraftBeatCapture?: BeatCapture;
    };
    return tracked.__dailydraftBeatCapture ?? null;
  });
}

async function expectFullBeatJourney(locator: Locator): Promise<void> {
  await expectCapturedBeats(locator, fullBeatSequence);
  const capture = await readBeatCapture(locator);
  expect(capture).not.toBeNull();
  expect(hasOrderedSequence(capture?.sequence ?? [], fullBeatSequence)).toBe(true);
}

async function expectCapturedBeats(
  locator: Locator,
  expectedBeats: readonly string[],
): Promise<void> {
  await expect(locator).toBeVisible();
  await expect
    .poll(
      async () => {
        const capture = await readBeatCapture(locator);
        return hasOrderedSequence(capture?.sequence ?? [], expectedBeats);
      },
      { timeout: 12_000 },
    )
    .toBe(true);
}

async function expectNoOverflowForBeats(
  locator: Locator,
  expectedBeats: readonly string[],
): Promise<void> {
  const capture = await readBeatCapture(locator);
  expect(capture).not.toBeNull();
  for (const beat of expectedBeats) {
    expect(capture?.samplesByBeat[beat] ?? 0).toBeGreaterThan(0);
    expect(capture?.maxOverflowByBeat[beat] ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(0);
  }
}

async function expectReducedMotionSettlement(locator: Locator): Promise<void> {
  await expect(locator).toHaveAttribute('data-choreography-settled', 'true');
  const capture = await readBeatCapture(locator);
  expect(capture).not.toBeNull();
  for (const beat of animatedBeats) expect(capture?.sequence).not.toContain(beat);
  await expectNoRunningAnimations(locator);
}

async function expectNoRunningAnimations(locator: Locator): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => ['pending', 'running'].includes(animation.playState)).length,
      ),
    )
    .toBe(0);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
}

function hasOrderedSequence(actual: readonly string[], expected: readonly string[]): boolean {
  let expectedIndex = 0;
  for (const beat of actual) {
    if (beat === expected[expectedIndex]) expectedIndex += 1;
  }
  return expectedIndex === expected.length;
}

async function openDuelLobby(page: Page): Promise<void> {
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/health/capabilities`),
    page.waitForResponse(journeyRpcUrl),
    page.goto('/overview', { waitUntil: 'domcontentloaded' }),
  ]);
  await expect(page.getByTestId(journeyTestIds.lobby)).toBeVisible();
}

async function waitForReactClickHandler(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const propsKey = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
        if (!propsKey) return false;
        const props = (element as unknown as Record<string, { onClick?: unknown }>)[propsKey];
        return typeof props?.onClick === 'function';
      }),
    )
    .toBe(true);
}

async function completeDuelEntry(
  page: Page,
  activate: (locator: Locator) => Promise<void>,
): Promise<void> {
  await activate(page.getByTestId(journeyTestIds.primaryAction));
  const stepper = page.getByTestId(entryTestIds.stepper);
  await expect(stepper).toHaveAttribute('data-stage', 'connect');

  await activate(stepper.getByTestId(entryTestIds.connectWallet));
  await expect(stepper).toHaveAttribute('data-stage', 'authenticate');

  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/auth/challenges`),
    activate(stepper.getByTestId(entryTestIds.authenticate)),
  ]);
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/matchmaking/status`),
    activate(stepper.getByTestId(entryTestIds.signAuthentication)),
  ]);
  await expect(stepper).toHaveAttribute('data-stage', 'review');

  await activate(stepper.getByTestId(entryTestIds.prepareFunding));
  await expect(stepper).toHaveAttribute('data-stage', 'funding-review');
  await activate(stepper.getByTestId(entryTestIds.confirmFunding));
  await expect(page.getByTestId(journeyTestIds.battle)).toBeVisible();
}

async function authenticateFromWalletMenu(page: Page): Promise<void> {
  await expect(page.getByTestId(journeyTestIds.walletMenu)).toContainText('1111…1111');
  await page.getByTestId(journeyTestIds.walletMenu).click();
  await page.getByTestId(journeyTestIds.walletAuthenticationPrepare).click();
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/auth/sessions`),
    page.getByTestId(journeyTestIds.walletAuthenticationSign).click(),
  ]);
}

async function keyboardActivate(page: Page, locator: Locator): Promise<void> {
  await tabTo(page, locator);
  await expect(locator).toBeFocused();
  await page.keyboard.press('Enter');
}

async function tabTo(page: Page, locator: Locator, limit = 100): Promise<void> {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    if (await isFocused(locator)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(
    `Keyboard focus did not reach ${await locator.evaluate((element) => element.outerHTML)}`,
  );
}

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element === document.activeElement).catch(() => false);
}

function requestsEndingWith(journey: DuelJourneyFixture, suffix: string): string[] {
  return journey.snapshot().requests.filter((request) => request.endsWith(suffix));
}
