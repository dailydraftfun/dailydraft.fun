import type { Locator, Page } from '@playwright/test';

import { DUEL_ENTRY_DRAFT_STORAGE_KEY } from '../app/duel/duel-entry-flow';
import { journeyTestIds } from '../app/e2e/journey-test-ids';
import { journeyWalletTelemetryKey } from '../app/e2e/journey-wallet';
import { journeyApiOrigin, journeyRpcUrl } from './fixtures/journey-fixture';
import { expect, test } from './fixtures/playwright';

const entryTestIds = {
  authenticate: 'duel-entry-auth-prepare',
  cancel: 'duel-entry-cancel',
  confirmFunding: 'duel-entry-confirm-funding',
  connectWallet: 'duel-entry-connect-wallet',
  prepareFunding: 'duel-entry-prepare-funding',
  recovery: 'duel-entry-recovery',
  signAuthentication: 'duel-entry-auth-sign',
  stepper: 'duel-entry-stepper',
} as const;

test.describe('deterministic duel failure recovery', () => {
  test.use({ journeySeed: 'fault-recovery' });

  test.describe('wallet rejection', () => {
    test.use({ journeySeed: 'wallet-rejection', journeyWalletRejections: 1 });

    test('preserves progress and retries only after an explicit second approval', async ({
      journey,
      page,
    }) => {
      const stepper = await enterFundingReview(page);

      await stepper.getByTestId(entryTestIds.confirmFunding).click();

      await expect(stepper).toHaveAttribute('data-stage', 'funding-review');
      await expect(stepper).toContainText(
        'Nothing was broadcast. Review the fresh unsigned transaction before trying again.',
      );
      await expect(stepper.getByTestId(entryTestIds.cancel)).toBeVisible();
      expect(requestsEndingWith(journey.snapshot().requests, '/submissions')).toHaveLength(0);
      expect(journey.snapshot().duel?.status).toBe('matched');
      await expectWalletTelemetry(page, 'wallet-rejection', {
        transactionRequests: 1,
        transactionSignatures: 0,
      });

      await stepper.getByTestId(entryTestIds.confirmFunding).click();

      await expect(page.getByTestId(journeyTestIds.battle)).toBeVisible();
      expect(requestsEndingWith(journey.snapshot().requests, '/submissions')).toHaveLength(1);
      expect(journey.snapshot().duel?.status).toBe('settled');
      await expectWalletTelemetry(page, 'wallet-rejection', {
        transactionRequests: 2,
        transactionSignatures: 1,
      });
    });
  });

  test('reconciles a transient RPC failure before allowing any second signature', async ({
    journey,
    page,
  }) => {
    const stepper = await enterFundingReview(page);
    await page.clock.install();
    journey.failNextReconciliations();
    const reconciliationsBefore = requestsEndingWith(
      journey.snapshot().requests,
      '/transactions/reconciliation',
    ).length;
    const failedConfirmation = page.waitForResponse(
      (response) =>
        response.url().endsWith('/transactions/reconciliation') && response.status() === 503,
    );

    await stepper.getByTestId(entryTestIds.confirmFunding).click();
    await failedConfirmation;
    expect(journey.snapshot().duel?.status).toBe('committing');
    expect(requestsEndingWith(journey.snapshot().requests, '/submissions')).toHaveLength(1);

    await page.clock.fastForward(2_100);

    await expect(page.getByTestId(journeyTestIds.battle)).toBeVisible();
    expect(requestsEndingWith(journey.snapshot().requests, '/submissions')).toHaveLength(1);
    expect(
      requestsEndingWith(journey.snapshot().requests, '/transactions/reconciliation'),
    ).toHaveLength(reconciliationsBefore + 2);
    expect(journey.snapshot().duel?.status).toBe('settled');
    await expectWalletTelemetry(page, 'fault-recovery', {
      transactionRequests: 1,
      transactionSignatures: 1,
    });
  });

  test('reloads while matchmaking and continues the same search without payment', async ({
    journey,
    page,
  }) => {
    journey.holdMatchmaking();
    const stepper = await enterEntryReview(page);
    await stepper.getByTestId(entryTestIds.prepareFunding).click();
    await expect(stepper).toHaveAttribute('data-stage', 'waiting');
    const duelId = journey.snapshot().duel?.id;
    expect(journey.snapshot().duel?.status).toBe('waiting');

    await page.reload();
    const restoredStepper = await authenticateRestoredStepper(page);

    await expect(restoredStepper).toHaveAttribute('data-stage', 'waiting');
    await expect(page.getByTestId(journeyTestIds.persistedDuel)).toContainText(
      'Looking for an opponent',
    );
    expect(journey.snapshot().duel).toEqual(expect.objectContaining({ id: duelId, status: 'waiting' }));
    expect(requestsEndingWith(journey.snapshot().requests, '/matchmaking/search')).toHaveLength(1);
    expect(requestsEndingWith(journey.snapshot().requests, '/transactions')).toHaveLength(0);
    expect(requestsEndingWith(journey.snapshot().requests, '/submissions')).toHaveLength(0);

    await restoredStepper.getByTestId('duel-entry-continue-later').click();
    journey.completeMatchmaking();
    await page.getByTestId(journeyTestIds.persistedDuelContinue).click();

    await expect(page.getByTestId(journeyTestIds.persistedDuel)).toContainText('Opponent found');
    expect(journey.snapshot().duel).toEqual(expect.objectContaining({ id: duelId, status: 'matched' }));
    expect(requestsEndingWith(journey.snapshot().requests, '/matchmaking/search')).toHaveLength(1);
    expect(requestsEndingWith(journey.snapshot().requests, '/submissions')).toHaveLength(0);
    await expectWalletTelemetry(page, 'fault-recovery', {
      transactionRequests: 0,
      transactionSignatures: 0,
    });
  });

  test('reloads after payment submission and resumes confirmation without signing again', async ({
    journey,
    page,
  }) => {
    const stepper = await enterFundingReview(page);
    journey.failNextReconciliations(20);
    const failedConfirmation = page.waitForResponse(
      (response) =>
        response.url().endsWith('/transactions/reconciliation') && response.status() === 503,
    );

    await stepper.getByTestId(entryTestIds.confirmFunding).click();
    await failedConfirmation;
    expect(journey.snapshot().duel?.status).toBe('committing');
    expect(requestsEndingWith(journey.snapshot().requests, '/submissions')).toHaveLength(1);

    await page.reload();
    const restoredStepper = await authenticateRestoredStepper(page);
    await expect(restoredStepper).toHaveAttribute('data-stage', 'recovery');
    await expect(restoredStepper).toContainText('Resume confirmation without signing');

    journey.failNextReconciliations(0);
    await restoredStepper.getByTestId(entryTestIds.recovery).click();

    await expect(page.getByTestId(journeyTestIds.battle)).toBeVisible();
    expect(requestsEndingWith(journey.snapshot().requests, '/submissions')).toHaveLength(1);
    expect(journey.snapshot().duel?.status).toBe('settled');
    await expectWalletTelemetry(page, 'fault-recovery', {
      transactionRequests: 1,
      transactionSignatures: 1,
    });
  });

  for (const checkpoint of ['opening', 'settling'] as const) {
    test(`reloads during ${checkpoint} without reopening packs or duplicating the outcome`, async ({
      journey,
      page,
    }) => {
      journey.holdLifecycleAt(checkpoint);
      const stepper = await enterFundingReview(page);

      await stepper.getByTestId(entryTestIds.confirmFunding).click();
      await expect(page.getByTestId(journeyTestIds.battle)).toBeVisible();
      await expect
        .poll(() => page.evaluate((key) => window.localStorage.getItem(key), DUEL_ENTRY_DRAFT_STORAGE_KEY))
        .toBeNull();
      expect(journey.snapshot().duel?.status).toBe(checkpoint);
      const committedHash = journey.snapshot().duel?.result?.resultHash;
      if (checkpoint === 'opening') expect(committedHash).toBeUndefined();
      else expect(committedHash).toBeTruthy();

      await page.reload();
      await authenticateFromWalletMenu(page);

      await expect(page.getByTestId(journeyTestIds.battle)).toBeVisible();
      expect(journey.snapshot().duel?.status).toBe(checkpoint);
      if (checkpoint === 'opening') expect(journey.snapshot().duel?.result).toBeNull();
      else expect(journey.snapshot().duel?.result?.resultHash).toBe(committedHash);
      expect(requestsEndingWith(journey.snapshot().requests, '/open-packs')).toHaveLength(1);

      journey.releaseLifecycle();
      await expect(page.getByTestId(journeyTestIds.duelHeadline)).toHaveText('You won both pulls', {
        timeout: 12_000,
      });

      const settledHash = journey.snapshot().duel?.result?.resultHash;
      expect(settledHash).toBeTruthy();
      if (committedHash) expect(settledHash).toBe(committedHash);
      expect(journey.snapshot().duel).toEqual(
        expect.objectContaining({
          result: expect.objectContaining({ resultHash: settledHash }),
          status: 'settled',
        }),
      );
      expect(requestsEndingWith(journey.snapshot().requests, '/open-packs')).toHaveLength(1);
      await expectWalletTelemetry(page, 'fault-recovery', {
        transactionRequests: 1,
        transactionSignatures: 1,
      });
    });
  }
});

async function enterFundingReview(page: Page): Promise<Locator> {
  const stepper = await enterEntryReview(page);
  await stepper.getByTestId(entryTestIds.prepareFunding).click();
  await expect(stepper).toHaveAttribute('data-stage', 'funding-review');
  return stepper;
}

async function enterEntryReview(page: Page): Promise<Locator> {
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/health/capabilities`),
    page.waitForResponse(journeyRpcUrl),
    page.goto('/overview'),
  ]);
  await page.getByTestId(journeyTestIds.primaryAction).click();

  const stepper = page.getByTestId(entryTestIds.stepper);
  await expect(stepper).toHaveAttribute('data-stage', 'connect');
  await stepper.getByTestId(entryTestIds.connectWallet).click();
  await authenticateStepper(stepper, page);
  await expect(stepper).toHaveAttribute('data-stage', 'review');
  return stepper;
}

async function authenticateRestoredStepper(page: Page): Promise<Locator> {
  const stepper = page.getByTestId(entryTestIds.stepper);
  await expect(stepper).toHaveAttribute('data-stage', 'authenticate');
  await authenticateStepper(stepper, page);
  return stepper;
}

async function authenticateStepper(stepper: Locator, page: Page): Promise<void> {
  await stepper.getByTestId(entryTestIds.authenticate).click();
  await Promise.all([
    page.waitForResponse(`${journeyApiOrigin}/auth/sessions`),
    stepper.getByTestId(entryTestIds.signAuthentication).click(),
  ]);
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

function requestsEndingWith(requests: string[], suffix: string): string[] {
  return requests.filter((request) => request.endsWith(suffix));
}

async function expectWalletTelemetry(
  page: Page,
  seed: string,
  expected: { transactionRequests: number; transactionSignatures: number },
): Promise<void> {
  const telemetry = await page.evaluate((key) => {
    const stored = window.sessionStorage.getItem(key);
    return stored
      ? (JSON.parse(stored) as unknown)
      : { transactionRequests: 0, transactionSignatures: 0 };
  }, journeyWalletTelemetryKey(seed));
  expect(telemetry).toEqual(expected);
}
